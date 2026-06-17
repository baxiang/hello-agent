# MCP 工具集成 - 多协议工具调用的统一抽象

> **源码路径**：[`trpc-agent-go/examples/mcptool/`](../../../../trpc-agent-go/examples/mcptool)
> **子示例数**：5 个 · 本页为分类索引，每个子示例有独立详解

## 概述

MCP（Model Context Protocol）是连接 LLM 与外部工具/资源的标准协议。trpc-agent-go 的 `mcptool/` 示例目录用 **1 个综合主程序 + 4 个独立子示例** 完整展示了如何作为**客户端**消费四种传输协议（STDIO / SSE / Streamable HTTP），以及如何作为**服务端**用 `trpc-mcp-go` 实现这些协议的 MCP Server。

主程序 [`mcptool-main`](./mcptool-main.md) 同时接入三种 MCP 服务端 + 两个本地 Function Tool，构建一个完整的多轮对话助手；而四个子示例各自聚焦一种传输或一类能力：

- [`stdioserver`](./mcptool-stdioserver.md) — STDIO MCP 服务端（最简单的本地子进程模式）
- [`sseserver`](./mcptool-sseserver.md) — SSE MCP 服务端（HTTP 长连接 + 信号优雅退出）
- [`streamableserver`](./mcptool-streamableserver.md) — Streamable HTTP MCP 服务端（结构化输入/输出）
- [`http_headers`](./mcptool-httpheaders.md) — 动态 HTTP Header 注入（context 传递 + `HTTPBeforeRequest`）

## 子示例导航

| 子示例 | 角色 | 传输 | 难度 | 一句话说明 |
|--------|------|------|------|-----------|
| [`mcptool-main`](./mcptool-main.md) | 客户端（综合） | stdio + sse + streamable | 进阶 | 一个 Agent 同时消费三种 MCP 服务 + 本地工具 |
| [`stdioserver`](./mcptool-stdioserver.md) | 服务端 | stdio | 入门 | `mcp.NewStdioServer` 注册 echo / add |
| [`sseserver`](./mcptool-sseserver.md) | 服务端 | sse | 入门 | `mcp.NewSSEServer` + 信号优雅退出 |
| [`streamableserver`](./mcptool-streamableserver.md) | 服务端 | streamable_http | 进阶 | 结构化输入/输出（struct-first API + OutputSchema） |
| [`http_headers`](./mcptool-httpheaders.md) | 客户端 + 服务端 | streamable | 进阶 | 每次请求动态注入认证/追踪 Header |

> **目录名拼写提示**：源码中 `streamalbeserver/` 存在历史拼写问题（缺字母 `e`），官方 README 已注明为兼容旧代码保留。文档中目录路径沿用源码真实名 `streamalbeserver`，文章标题使用规范名 `streamableserver`。

## 选型建议

### 客户端：该用哪种 MCP 传输？

```
你的 MCP 工具在哪里？
├── 同机本地子进程（CLI 工具、脚本）
│   └── → STDIO        （零网络、最低延迟，主程序自动拉起子进程）
├── 远程 HTTP 服务
│   ├── 需要流式/双向                  → streamable_http （MCP 2025 新协议，推荐）
│   └── 老旧服务只支持单向推送         → sse             （HTTP 长连接 + POST 回传）
└── 同时有多个                         → 参考 mcptool-main 的 ToolSet 组合
```

| 维度 | STDIO | SSE | Streamable HTTP |
|------|-------|-----|-----------------|
| 通信方式 | 子进程 stdin/stdout | HTTP 长连接 + POST | HTTP（SSE 流 + POST） |
| 部署形态 | 本地、同机 | 远程、跨机 | 远程、跨机 |
| 网络开销 | 无 | 有 | 有 |
| 支持重试 | ❌（进程崩溃即失败） | ✅ `WithRetry` | ✅ `WithSimpleRetry` |
| 支持会话重连 | ❌ | ✅ `WithSessionReconnect` | ✅ |
| 典型用途 | 本地工具、CLI | 兼容旧 SSE 服务 | 新部署、生产推荐 |
| 服务端 API | `mcp.NewStdioServer` | `mcp.NewSSEServer` | `mcp.NewServer` + `WithServerAddress` |

### 服务端：该用哪种 Server 构造器？

- **`mcp.NewStdioServer(name, ver)`** — 读 stdin、写 stdout，最简单
- **`mcp.NewSSEServer(name, ver)`** — 启动 HTTP，监听 SSE 端点
- **`mcp.NewServer(name, ver, WithServerAddress(":port"))`** — 通用 Server，默认走 Streamable HTTP；可叠加 `WithServerPath("/mcp")` 自定义路径

## 核心概念

### 客户端：统一的 ToolSet 抽象

无论底层是 STDIO、SSE 还是 Streamable HTTP，客户端都通过同一个 `mcp.NewMCPToolSet` 接入，只需改 `ConnectionConfig.Transport` 字段：

```go
toolSet := mcp.NewMCPToolSet(
    mcp.ConnectionConfig{
        Transport: "stdio" | "sse" | "streamable_http",
        // STDIO 专属：Command / Args
        // HTTP  专属：ServerURL / Headers
        Timeout:   10 * time.Second,
    },
    mcp.WithToolFilterFunc(tool.NewIncludeToolNamesFilter("echo", "add")),
)
toolSet.Init(ctx)                       // 建立连接、枚举工具
llmagent.WithToolSets([]tool.ToolSet{toolSet})  // 注入 Agent
```

### 服务端：声明式工具注册

服务端用 `mcp.NewTool` 声明参数 schema，用回调函数处理调用：

```go
server.RegisterTool(
    mcp.NewTool("echo",
        mcp.WithDescription("..."),
        mcp.WithString("message", mcp.Required(), mcp.Description("...")),
    ),
    func(ctx context.Context, req *mcp.CallToolRequest) (*mcp.CallToolResult, error) {
        return &mcp.CallToolResult{
            Content: []mcp.Content{mcp.NewTextContent("hello")},
        }, nil
    },
)
```

Streamable HTTP 还支持 **struct-first API**（`WithInputStruct[T]()` / `WithOutputStruct[T]()` + `NewTypedToolHandler`），把 JSON Schema 直接从 Go 结构体 tag 推导出来——详见 [`streamableserver`](./mcptool-streamableserver.md)。

### 可靠性增强（仅 HTTP 类传输）

| 能力 | 配置 | 作用 |
|------|------|------|
| 简单重试 | `tmcp.WithSimpleRetry(3)` | 默认参数指数退避，最多 N 次 |
| 精细重试 | `tmcp.WithRetry(tmcp.RetryConfig{...})` | 自定义 MaxRetries / Backoff / Factor |
| 会话重连 | `mcp.WithSessionReconnect(3)` | 服务端重启 / 会话过期后自动重建 |
| 动态 Header | `tmcp.WithHTTPBeforeRequest(fn)` | 每次请求前注入认证/追踪头 |

> STDIO 因基于进程，**不支持** 重试 / 重连——子进程崩了就是崩了，需要业务层处理。

## 共通的运行方式

```bash
# 通用前置
export OPENAI_API_KEY="your-api-key"

# 主程序：需先起 HTTP 类服务端，STDIO 子进程会自动拉起
cd examples/mcptool/streamalbeserver && go run main.go &  # :3000 streamable
cd examples/mcptool/sseserver         && go run main.go &  # :8080 sse
cd examples/mcptool                   && go run main.go    # 综合主程序

# 单独跑某个服务端
cd examples/mcptool/stdioserver && go run main.go          # 由主程序作为子进程启动
```

### 共同的环境变量与参数

| 变量/参数 | 必需 | 说明 | 默认值 |
|-----------|------|------|--------|
| `OPENAI_API_KEY` | 是 | 模型 API Key（仅客户端程序需要） | — |
| `OPENAI_BASE_URL` | 否 | 模型端点 | `https://api.openai.com/v1` |
| `-model` | 否 | 模型名（仅客户端主程序） | `deepseek-v4-flash` |
| `-port` | 否 | SSE 服务端口（仅 sseserver） | `8080` |

## 深度原理

> 本节源自原「核心组件」深度文（15-mcp.md），整合接口源码、设计哲学与配置速查。子示例（mcptool-main/stdio/sse/streamable/httpheaders）负责具体走读，本节只回答「接口长什么样、为什么这么设计、配置怎么填」。

### MCP 协议核心接口

tRPC-Agent-Go 的 MCP 客户端位于 `mcp` 包，核心抽象是 `MCPToolSet`——它实现 `tool.ToolSet` 接口，把任意 MCP 服务器包装成 Agent 可消费的工具集合。整体调用链：

```
Agent（LLMAgent / GraphAgent）
    │
    ├─ WithToolSets([]tool.ToolSet{...})
    │       │
    │       ▼
    │   MCPToolSet
    │       │
    │       ├─ Transport: STDIO / SSE / Streamable HTTP
    │       │
    │       ▼
    │   MCP Server（任何语言实现）
    │       ├─ tools/list → Tool Declarations
    │       ├─ tools/call → Tool Execution
    │       └─ resources/*, prompts/*, ...
    │
    ▼
LLM 看到 MCP 工具 → 调用 → MCPToolSet 转发 → MCP Server 执行 → 返回结果
```

关键 API 签名（不含走读）：

```go
// 构造一个 MCP 工具集；连接配置 + 可选过滤/重试 options
func NewMCPToolSet(config ConnectionConfig, opts ...MCPToolSetOption) *MCPToolSet

// 连接配置：传输方式 + 传输专属参数
type ConnectionConfig struct {
    Transport   string            // "stdio" | "sse" | "streamable_http"
    Command     string            // STDIO 专属：可执行文件
    Args        []string          // STDIO 专属：命令行参数
    Env         []string          // STDIO 专属：子进程环境变量
    ServerURL   string            // HTTP  专属：服务地址
    HTTPHeaders map[string]string // HTTP  专属：请求头
    Timeout     time.Duration     // 通用：单次调用超时
}

// MCPToolSet 实现 tool.ToolSet，可与 Function Tool 混合注入 Agent
llmagent.WithToolSets([]tool.ToolSet{ts, builtinTool, ...})

// Broker：把多个 MCP 服务器聚合成单个 ToolSet，实现按需发现
func NewBroker(opts ...BrokerOption) *Broker
```

MCP 协议的 `annotations` 自动映射到 tRPC-Agent-Go 的 `ToolMetadata`，无需手工对齐：

| MCP Annotation | ToolMetadata 字段 | 用途 |
|----------------|-------------------|------|
| `readOnlyHint` | `ReadOnly` | 权限策略判断 |
| `destructiveHint` | `Destructive` | 审批流程触发 |
| `openWorldHint` | `OpenWorld` | 结果范围预估 |

### 传输模式设计

三种传输并非简单并列，而是针对不同部署形态的差异化设计。每种传输的内部机制与设计取舍如下（usage 代码见各子示例）。

#### STDIO：本地子进程

```
tRPC-Agent-Go                     MCP Server（子进程）
    │                                    │
    ├─ os/exec 启动子进程                 │
    │   cmd.StdinPipe() ────────────────→ stdin
    │   cmd.StdoutPipe() ←────────────── stdout
    │                                    │
    ├─ JSON-RPC Request ───────────────→ │
    │   {"method":"tools/list", ...}      │
    │                                    ├─ 处理请求
    │  ←──────────────── JSON-RPC Response
    │   {"result":{"tools":[...]}}        │
    │                                    │
    ├─ ts.Close() → cmd.Process.Kill() ─→ 进程终止
```

设计取舍：零网络开销（进程内管道通信）；子进程生命周期与 ToolSet 绑定；串行执行（stdin/stdout 单工通道）；需要本地安装依赖（Python、Node 等运行时）；进程崩溃即失败，**不支持**重试/重连。

#### SSE：远程工具服务

```
tRPC-Agent-Go                     MCP Server
    │                                    │
    ├─ GET /sse ──────────────────────→  │
    │  ←────────── SSE 连接建立 ────────  │
    │     event: endpoint                 │
    │     data: /message?sessionId=xxx    │
    │                                    │
    ├─ POST /message?sessionId=xxx ────→ │
    │     {"method":"tools/list", ...}     │
    │  ←────────── SSE event ──────────── │
    │     event: message                   │
    │     data: {"result":{...}}           │
```

设计取舍：远程部署，解耦 Agent 和工具；并发调用（HTTP 连接池）；支持 HTTP 标准认证（Header/Bearer Token）；支持 `WithRetry` 与 `WithSessionReconnect`。

#### Streamable HTTP：现代替代方案

相比 SSE 的设计优势：单一 HTTP 端点（无需先 `GET /sse` 再 `POST /message`）；原生支持双向流式响应；更容易穿透负载均衡器与服务网格；标准 HTTP Auth。MCP 2025 新协议，新部署推荐。

#### 传输选择指南

| 场景 | 推荐传输 | 原因 |
|------|---------|------|
| 开发/测试 | STDIO | 最简单，零配置 |
| 同一台机器 | STDIO | 零网络开销 |
| 微服务架构 | SSE 或 Streamable HTTP | 独立部署和扩缩 |
| 需要认证 | Streamable HTTP | 标准 HTTP Auth |
| 高并发 | SSE / Streamable HTTP | 连接池并发 |

### 设计哲学

#### 为什么用 MCP：协议而非 API

核心价值是**协议无关的抽象**——客户端只面对 `NewMCPToolSet`，服务端只面对 `NewServer/NewStdioServer/NewSSEServer`，传输差异被收敛到 `Transport` 一个字段。任何实现了 MCP 协议（Python / Node / Go / Rust）的服务都能被 tRPC-Agent-Go 调用，工具生态不再被语言绑定。

#### Broker：按需发现，避免上下文爆炸

当 MCP 服务器数量爆炸时，直接把所有工具暴露给 LLM 会超出 token 限制。Broker 把多个服务器聚合成 **4 个 broker 工具**，让 LLM 渐进式发现：

```
第 1 步：mcp_list_servers       → 列出可用服务器（含描述）
第 2 步：mcp_describe_server    → 查看该服务器有哪些工具
第 3 步：mcp_connect_server     → 建立连接，工具可用
第 4 步：mcp_disconnect_server  → 释放连接
```

设计优势：LLM 只看到 4 个 broker 工具而非所有服务器的全部工具；按需连接节省连接资源；支持动态 URL（Skill 场景：用户安装新 MCP 服务器后 URL 动态变化）。

#### Dynamic Tool Discovery：运行时获取工具

让 Agent 在运行时动态获取 MCP 工具，无需预先配置。启用后 LLM 自行判断是否需要工具，需要时才发起 `tools/list` 拉取最新列表，再 `tools/call` 执行：

```go
llmagent.WithDynamicMCPToolDiscovery(true)
```

#### 懒连接 + 自动重连

```
ToolSet 创建 ──→ 未连接（懒连接）
                    │
    首次 Tools() 调用 │
                    ▼
              MCP Initialize 握手
                    ↓
              tools/list 获取工具
                    ↓
              连接就绪（缓存工具列表）
                    │
     后续 Tools() 调用 → 返回缓存（不重新连接）
                    │
              Close() │
                    ▼
              断开连接 + 清理资源
```

- **懒连接**：如果 Agent 整个会话从未调用该 ToolSet 的工具，连接永不建立，节省资源。
- **重连机制**：连接意外断开时，下次 `Tools()` 调用自动重连；SSE 和 Streamable HTTP 支持 session reconnection。

### 配置速查

#### ConnectionConfig 字段

| 字段 | 类型 | 适用传输 | 说明 |
|------|------|----------|------|
| `Transport` | `string` | 全部 | `"stdio"` / `"sse"` / `"streamable_http"` |
| `Command` | `string` | STDIO | 可执行文件名 |
| `Args` | `[]string` | STDIO | 命令行参数 |
| `Env` | `[]string` | STDIO | 子进程环境变量（如 `API_KEY=xxx`） |
| `ServerURL` | `string` | SSE / Streamable | 服务端地址 |
| `HTTPHeaders` | `map[string]string` | SSE / Streamable | 请求头（认证、追踪等） |
| `Timeout` | `time.Duration` | 全部 | 单次调用超时 |

#### MCPToolSetOption（客户端 ToolSet）

| Option | 作用 | 适用传输 |
|--------|------|----------|
| `mcp.WithToolFilterFunc(fn)` | ToolSet 级别过滤工具（按 name 判断） | 全部 |
| `mcp.WithSessionReconnect(n)` | 会话过期/服务端重启后自动重连 | 仅 HTTP |
| `tmcp.WithSimpleRetry(n)` | 指数退避简单重试，最多 N 次 | 仅 HTTP |
| `tmcp.WithRetry(cfg)` | 精细重试：自定义 MaxRetries / Backoff / Factor | 仅 HTTP |
| `tmcp.WithHTTPBeforeRequest(fn)` | 每次请求前动态注入 Header | 仅 HTTP |

#### BrokerOption

| Option | 作用 |
|--------|------|
| `mcp.WithBrokerServers([]string)` | 声明可发现的 MCP 服务器 URL 列表 |
| `mcp.WithBrokerAuthHook(fn)` | Per-Run 认证钩子：按 URL 返回 Header map |

```go
mcp.WithBrokerAuthHook(func(ctx context.Context, url string) map[string]string {
    return map[string]string{"Authorization": "Bearer " + getTokenForService(ctx, url)}
})
```

#### Agent / Per-Run 级别 option

| Option | 作用 |
|--------|------|
| `llmagent.WithToolSets([]tool.ToolSet)` | 注入 ToolSet（MCPToolSet / Broker / Function 混合） |
| `llmagent.WithToolFilter(fn)` | Agent 级别过滤工具（构建 messages 时生效） |
| `llmagent.WithDynamicMCPToolDiscovery(true)` | 启用运行时工具动态发现 |
| `agent.WithToolFilter(fn)` | Per-Run 级别过滤（最灵活，可基于上下文做权限判断） |

**过滤层级效果**：ToolSet 级别最早生效（减少 `Tools()` 调用开销）→ Agent 级别在构建 messages 时生效 → Per-Run 级别最灵活（可基于 userID / 权限动态决定）。

---

## 学习路径建议

1. **先读 [`mcptool-main`](./mcptool-main.md)**：俯瞰客户端如何用一个 `ToolSet` 接口接入三种传输 + 重试/重连配置，这是理解 MCP 价值的最佳入口
2. **再读 [`stdioserver`](./mcptool-stdioserver.md)**：用最少代码理解服务端的工具注册流程
3. **接着读 [`sseserver`](./mcptool-sseserver.md)**：对比 STDIO，学习 HTTP 类服务端的信号处理
4. **进阶 [`streamableserver`](./mcptool-streamableserver.md)**：掌握 struct-first API 和 OutputSchema
5. **最后 [`http_headers`](./mcptool-httpheaders.md)**：理解 context 在 MCP 调用链中的传递，掌握动态 Header 注入

## 总结

MCP 示例的核心价值在于**协议无关的抽象**：客户端只面对 `mcp.NewMCPToolSet`，服务端只面对 `mcp.NewServer/NewStdioServer/NewSSEServer`，传输差异被收敛到 `Transport` 一个字段。当工具数量爆炸、需要按需发现时，再看同目录下的 [MCP Broker](./mcpbroker.md)——它在 ToolSet 之上又加了一层"声明需求、按需加载"的代理，进一步压缩 Agent 上下文。
