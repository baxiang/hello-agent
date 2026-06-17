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

## 学习路径建议

1. **先读 [`mcptool-main`](./mcptool-main.md)**：俯瞰客户端如何用一个 `ToolSet` 接口接入三种传输 + 重试/重连配置，这是理解 MCP 价值的最佳入口
2. **再读 [`stdioserver`](./mcptool-stdioserver.md)**：用最少代码理解服务端的工具注册流程
3. **接着读 [`sseserver`](./mcptool-sseserver.md)**：对比 STDIO，学习 HTTP 类服务端的信号处理
4. **进阶 [`streamableserver`](./mcptool-streamableserver.md)**：掌握 struct-first API 和 OutputSchema
5. **最后 [`http_headers`](./mcptool-httpheaders.md)**：理解 context 在 MCP 调用链中的传递，掌握动态 Header 注入

## 总结

MCP 示例的核心价值在于**协议无关的抽象**：客户端只面对 `mcp.NewMCPToolSet`，服务端只面对 `mcp.NewServer/NewStdioServer/NewSSEServer`，传输差异被收敛到 `Transport` 一个字段。当工具数量爆炸、需要按需发现时，再看同目录下的 [MCP Broker](./mcpbroker.md)——它在 ToolSet 之上又加了一层"声明需求、按需加载"的代理，进一步压缩 Agent 上下文。
