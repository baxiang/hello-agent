# Tool 工具系统 - 让 Agent 拥有调用外部能力的手

> **源码路径**：[`trpc-agent-go/examples/tool/`](../../../../trpc-agent-go/examples/tool)
> **子示例数**：4 个 · 本页为分类索引，每个子示例有独立详解

## 概述

Tool 是 Agent 与外部世界交互的"手"——模型通过 Tool Call 主动决定何时执行代码、跑命令、查知识库、抓网页。trpc-agent-go 的 `tool/` 示例目录用 **4 个独立子示例**展示了内置工具生态的完整光谱：从本机代码执行到外部检索服务，从单一工具到工具集，从本地 HTTP 到云端智能抓取。

## 子示例导航

| 子示例 | 文章 | 类型 | 一句话说明 |
|--------|------|------|-----------|
| [`codeexec/`](./tool-codeexec.md) | [`tool-codeexec`](./tool-codeexec.md) | `tool.Tool`（单工具） | 让模型自主通过 Tool Call 执行 Python / Bash 代码 |
| [`hostexec/`](./tool-hostexec.md) | [`tool-hostexec`](./tool-hostexec.md) | `tool.ToolSet`（工具集） | 让模型在 base dir 里跑 shell，支持长任务与轮询 |
| [`openviking/`](./tool-openviking.md) | [`tool-openviking`](./tool-openviking.md) | 外部服务 ToolSet | 对接 OpenViking 知识库，"先搜后读"+ Profile 分级 |
| [`webfetch/`](./tool-webfetch.md) | [`tool-webfetch`](./tool-webfetch.md) | `tool.Tool`（两套实现） | HTTP 直抓 vs Gemini 服务端抓取，含原文对照 |

## 选型决策树

```
需要让 Agent 调用外部能力？
├── 纯计算 / 数据分析（Python、Bash 代码片段）
│   ├── 需要沙箱隔离 / 云端执行            → codeexec（local / jupyter / e2b）
│   └── 只在本机跑、可信环境               → codeexec（local）
│
├── 本机工程作业（跑测试、看目录、起服务）
│   ├── 需要长任务 + stdin 交互            → hostexec
│   └── 一次性命令                         → hostexec（yield_time_ms=0）
│
├── 查询数据
│   ├── 私有知识库（已建索引）             → openviking（search then read）
│   └── 开放网页
│       ├── 需要原文 / 精确限额            → webfetch/httpfetch
│       └── 需要智能总结 / 对比            → webfetch/geminifetch
```

## 核心概念

### Tool vs ToolSet

trpc-agent-go 工具系统有两个基础抽象，**注册 API 不同**：

| 抽象 | 接口 | 构造样例 | 注册方式 |
|------|------|---------|---------|
| **Tool**（单一工具） | `tool.Tool` | `codeexec.NewTool(...)` | `llmagent.WithTools([]tool.Tool{...})` |
| **ToolSet**（工具集） | `tool.ToolSet` | `hostexec.NewToolSet(...)` | `llmagent.WithToolSets([]tool.ToolSet{...})` |

ToolSet 内部可暴露多个协同工具（如 `hostexec` 的 exec/write_stdin/kill），模型看到的是一组工具。本目录的 4 个示例里，`codeexec` 和 `webfetch` 用 Tool，`hostexec` 和 `openviking` 用 ToolSet。

### 四类内置工具的能力光谱

| 维度 | codeexec | hostexec | openviking | webfetch |
|------|----------|----------|-----------|----------|
| 解决问题 | 算 / 处理 | 本机执行 | 查私库 | 查公网 |
| 数据来源 | 代码沙箱 | 宿主机 | OpenViking 服务 | 互联网 |
| 抽象层级 | 代码块 | shell 会话 | 检索 API | URL |
| 注册方式 | `WithTools` | `WithToolSets` | `WithToolSets` | `WithTools` |
| 内含工具数 | 1（execute_code） | 3（exec/write_stdin/kill） | 6~10（按 Profile） | 1（web_fetch / gemini_web_fetch） |
| 是否有状态 | 否 | ✅ session | ✅ 服务端 | 否 |
| 后端可插拔 | ✅ local/jupyter/e2b | ❌ | ❌ | ✅ http/gemini |
| 外部依赖 | 可选（jupyter/e2b） | 无 | openviking-server | 可选（GEMINI_API_KEY） |

### 共通的接线模式

无论用 Tool 还是 ToolSet，所有示例都遵循同样的"三件套"接线：

```go
// 1. 创建工具 / 工具集
fetchTool := httpfetch.NewTool(httpfetch.WithMaxContentLength(50000))

// 2. 注册给 LLM Agent
llmAgent := llmagent.New(
    "my-agent",
    llmagent.WithModel(modelInstance),
    llmagent.WithTools([]tool.Tool{fetchTool}),         // 或 WithToolSets
    llmagent.WithInstruction("...如何使用工具的指引..."),
)

// 3. 绑定到 Runner
r := runner.NewRunner("my-app", llmAgent)
```

`Instruction` 是这套模式里**容易被忽略但极其重要**的一环：模型如何使用工具（要不要先搜后读、要不要先用 overview、要不要避免递归 browse）全靠 system prompt 约束。每个子示例都有专门的 Instruction 段落说明这一点。

## 共通的运行约定

### 通用环境变量

| 变量 | 适用 | 说明 |
|------|------|------|
| `OPENAI_API_KEY` | 全部 | 对话模型 API Key |
| `OPENAI_BASE_URL` | 全部（可选） | 模型端点（兼容服务用） |
| `GEMINI_API_KEY` | 仅 geminifetch | Gemini 抓取模型 API Key |
| `E2B_API_KEY` | 仅 codeexec 的 e2b 后端 | E2B / CubeSandbox Key |
| `OPENVIKING_API_KEY` | 仅 openviking | OpenViking 鉴权 |

### 通用退出命令

所有 4 个示例都支持 `exit`（大小写不敏感）退出交互循环。

### 启动命令速查

```bash
# codeexec
cd examples/tool/codeexec       && go run . -executor local

# hostexec
cd examples/tool/hostexec       && go run . -base-dir .

# openviking（需先启动 openviking-server）
cd examples/tool/openviking     && go run . -profile agent

# webfetch（两套实现二选一）
cd examples/tool/webfetch/httpfetch   && go run .
cd examples/tool/webfetch/geminifetch && go run . -gemini-model gemini-2.5-flash
```

## 深度原理

> 本节源自原「核心组件」深度文（05-tool.md + 06-tool-advanced.md），整合接口源码、设计哲学与配置速查。

### Tool 核心接口

#### 接口层次

```go
// tool/tool.go
type Tool interface {
    Declaration() *Declaration
}

type CallableTool interface {
    Call(ctx context.Context, jsonArgs []byte) (any, error)
    Tool
}

type StreamableTool interface {
    StreamableCall(ctx context.Context, jsonArgs []byte) (*StreamReader, error)
    Tool
}

type ToolSet interface {
    Tools(context.Context) []tool.Tool
    Close() error
    Name() string
}
```

四层抽象的语义边界：

| 接口 | 角色 | 何时使用 |
|------|------|---------|
| `Tool` | 抽象基类 | 只声明"我是做什么的"（元数据），LLM 调用前可见 |
| `CallableTool` | 同步调用 | 一次性 API 请求 |
| `StreamableTool` | 流式调用 | LLM 可渐进消费结果（如日志查询） |
| `ToolSet` | 批量管理 | 一组工具共享生命周期（如 MCP 连接） |

#### Declaration 元数据

```go
type Declaration struct {
    Name         string   // 工具名——LLM 用于 Function Calling 的参数
    Description  string   // 工具描述——LLM 据此决定是否调用
    InputSchema  *Schema  // 入参 JSON Schema
    OutputSchema *Schema  // 出参 JSON Schema（可选）
}
```

> **最重要的设计原则**：Name 和 Description 的准确性直接决定工具调用精度。模糊的描述 → LLM 调用错误率显著上升。

#### FunctionTool 的 Schema 自动生成

`function.NewFunctionTool[I, O any]` 使用反射从 Go struct 生成 JSON Schema，省去手写声明：

```go
type MyInput struct {
    Name    string   `json:"name" jsonschema:"description=用户名,required"`
    Age     int      `json:"age" jsonschema:"description=年龄,minimum=0,maximum=150"`
    Tags    []string `json:"tags" jsonschema:"description=标签列表"`
    Enabled bool     `json:"enabled" jsonschema:"description=是否启用"`
}
```

**jsonschema tag 支持的关键字**：
`description`、`required`、`enum`、`minimum`、`maximum`、`minLength`、`maxLength`、`pattern`、`format`、`default`

> 注意：jsonschema tag 以逗号 `,` 分隔，**description 值不能包含逗号**。

### ToolSet 与工具编排

#### ToolSet 生命周期（懒连接）

ToolSet 创建时不建立连接，避免未使用的 MCP 服务白白占用资源。首次 `Tools()` 调用时才连接、列出工具并缓存：

```
[创建 ToolSet] → [首次 Tools()] → [连接 + Initialize + ListTools] → [缓存]
                                                                       ↓
                                                                [Close] → [断开连接]
```

#### 三种 MCP 传输实现差异

| | STDIO | SSE | Streamable HTTP |
|----|----|----|----|
| **底层** | `os/exec` 子进程 | `net/http` + EventSource | `net/http` |
| **适用** | 本地工具 | 远程工具服务 | 远程 + 复杂认证 |
| **重连** | 重启子进程 | 重建 SSE 连接 | 重建 HTTP 连接 |
| **认证** | 无（进程内部） | HTTP Header | HTTP Header / Token |
| **并发** | 串行（管道特性） | 并发 | 并发 |

**STDIO 的串行限制**：子进程的 stdin/stdout 是单工通道，多个并发工具调用需要加锁排队。SSE 和 Streamable HTTP 无此限制。

#### MCP Broker — 按需发现

Broker 暴露 4 个 LLM 可见工具：`mcp_list_servers` → `mcp_describe_server` → `mcp_connect_server` → `mcp_disconnect_server`，实现渐进式发现——LLM 先看有哪些服务器，再查看特定服务器的工具，最后按需连接。

### 权限与过滤模型

框架在「LLM 看到工具」到「工具真正执行」之间布置了三层控制点，每一层解决不同维度的安全问题：

```
┌──────────────────────────────────────────┐
│  Layer 1: ToolFilter（可见性控制）         │
│  - 决定哪些工具对 LLM 可见                │
│  - LLM 只能调用 Filter 放行的工具          │
└──────────────┬───────────────────────────┘
               ▼
┌──────────────────────────────────────────┐
│  Layer 2: ToolPermissionPolicy（权限检查） │
│  - LLM 请求调用后、执行前检查              │
│  - 可返回 Allow / Deny / AskPermission    │
└──────────────┬───────────────────────────┘
               ▼
┌──────────────────────────────────────────┐
│  Layer 3: ToolExecutionFilter（执行拦截）  │
│  - 标记需要外部执行的工具                 │
│  - 框架不自动执行，交由调用方处理          │
└──────────────────────────────────────────┘
```

#### 三层各自解决的问题

| 控制点 | 解决的问题 | 执行时机 |
|--------|-----------|---------|
| `ToolFilter` | 不希望 LLM 知道某些工具存在（防止误用） | LLM 调用前（被过滤的工具不进入 tools 声明，LLM 无从知晓） |
| `ToolPermissionPolicy` | 已知工具被调用时做权限/合规检查（破坏性操作审批、参数大小限制） | 参数解析后、BeforeTool 回调前 |
| `ToolExecutionFilter` | 不让框架自动执行，交由调用方处理（如 human-in-the-loop） | 框架执行前 |

#### PermissionDecision 三态语义

```go
type PermissionDecision int
const (
    AllowDecision  PermissionDecision = iota  // 允许执行
    DenyDecision                               // 拒绝执行
    AskDecision                                // 需要审批
)
```

| 决策 | 行为 | LLM 收到的反馈 |
|------|------|---------------|
| `AllowPermission()` | 正常执行工具 | 正常的 tool result |
| `DenyPermission(reason)` | 跳过执行 | `{"error": "denied", "reason": "..."}` |
| `AskPermission(reason)` | 跳过执行 | `{"error": "approval_required", "reason": "..."}` |

> 工具如果实现了 `PermissionChecker` 接口，其 Checker 优先于全局 Policy。

#### 并发工具执行

同一轮对话中 LLM 可能返回多个 `tool_calls`。框架默认并行执行它们——只有当工具标记了 `ConcurrencySafe` 时才真正并行，否则串行执行（默认安全）。

### 设计哲学

#### 为什么 arguments 是 JSON 字符串而非结构化对象？

LLM 的 Function Calling 返回的 `function.arguments` 本就是 JSON 字符串。将接口参数设计为 `jsonArgs []byte` 而非已解析结构体的三个原因：

1. **零解析开销传递**：Agent 仅是 MCP 代理时（调用外部 API，不关心参数内容），可原样转发
2. **延迟解析**：权限检查可在原始 JSON 上执行（如检查参数大小），无需先解析
3. **容错**：LLM 可能生成非严格 JSON，框架层可以先修复再传递

#### Tool vs ToolSet 的边界

- **Tool** = 一个原子能力（如"计算器"）
- **ToolSet** = 一组相关能力的容器（如"某个 MCP 服务器提供的所有工具"）

ToolSet 的核心价值在于**生命周期管理**：

- `Close()` 清理连接——MCP client 断开、进程 kill
- `Tools()` 缓存——避免每次 LLM 调用都重新获取工具列表
- `Name()` 用于冲突检测和多 ToolSet 合并时的去重

#### 为什么默认重试策略保守？

工具可能产生副作用（写入数据库、发送通知），盲目重试可能导致重复操作。默认 `DefaultRetryOn` 只重试网络层面的瞬时错误：

- 重试：`io.EOF` / `io.ErrUnexpectedEOF` / `net.Error.Timeout()` / `net.Error.Temporary()`
- 不重试：`nil` error、`context.Canceled`、`context.DeadlineExceeded`

重试范围仅限当前工具调用——不会重跑整个 Agent 或 Graph 流程。

#### Tool Call ID 链路

每次 LLM 工具调用都会携带唯一的 `tool_call_id`，框架在 BeforeTool 回调之前将其注入 `context.Context`：

- **日志关联**：通过 `tool.ToolCallIDFromContext(ctx)` 读取后写入日志，串联同一调用
- **状态隔离**：并发工具调用时用作 state key 避免互相覆盖
- **子 Agent 归属**：工具内启动子 Agent 时传递 `parent_tool_call_id`，前端可渲染嵌套调用树（Coordinator → Tool Call 卡片 → Child Agent 输出）
- **Invocation 关系**：`InvocationID` + `ParentInvocationID` 构建 Agent 执行树

> 注意：如果 BeforeTool 回调创建了新的裸 context（未继承），下游工具代码会丢失 `tool_call_id`。

#### JSON 参数修复

开启 `WithToolCallArgumentsJSONRepairEnabled(true)` 后，框架在 PermissionPolicy 检查**之前**修复 LLM 输出的非严格 JSON：

- 未引号的 object key：`{name: "test"}` → `{"name": "test"}`
- 尾随逗号：`{"a": 1,}` → `{"a": 1}`
- 单引号：`{'name': 'test'}` → `{"name": "test"}`
- 缺失闭合引号（best-effort）

执行时机在 PermissionPolicy 之前，意味着策略检查的是修复后的合法 JSON。

### 配置速查

#### FunctionTool options

| Option | 作用 |
|--------|------|
| `function.WithName(s)` | 工具名（LLM 用于 Function Calling） |
| `function.WithDescription(s)` | 工具描述（LLM 据此决定是否调用） |

构造器：`function.NewFunctionTool[I,O](fn, opts...)` / `function.NewStreamableFunctionTool[I,O](fn, opts...)`

#### LLMAgent Tool 相关 options

| Option | 作用 |
|--------|------|
| `llmagent.WithTools([]tool.Tool)` | 注册单一工具 |
| `llmagent.WithToolSets([]tool.ToolSet)` | 注册工具集（MCP / hostexec 等） |
| `llmagent.WithToolFilter(fn)` | Agent 级工具过滤 |
| `llmagent.WithToolCallRetryPolicy(*tool.RetryPolicy)` | 工具调用重试策略 |
| `llmagent.WithToolPermissionPolicyFunc(fn)` | 运行时权限策略 |
| `llmagent.WithToolExecutionFilter(fn)` | 执行拦截器（标记 pending） |

#### Runner Run Per-Run options（覆盖 Agent 级别）

| Option | 作用 |
|--------|------|
| `agent.WithToolFilter(fn)` | 本次运行的工具过滤 |
| `agent.WithToolPermissionPolicyFunc(fn)` | 本次运行的权限策略 |
| `agent.WithToolExecutionFilter(fn)` | 本次运行的执行拦截 |
| `agent.WithToolCallArgumentsJSONRepairEnabled(true)` | 启用 JSON 参数修复 |

#### RetryPolicy 字段

```go
type RetryPolicy struct {
    MaxAttempts     int           // 总尝试次数（含首次）
    InitialInterval time.Duration // 首次重试前的等待
    BackoffFactor   float64       // 退避因子（指数增长）
    MaxInterval     time.Duration // 最大间隔
    Jitter          bool          // 是否加入随机抖动
    RetryOn         func(ctx context.Context, info *RetryInfo) (bool, error) // 自定义重试条件
}
```

`RetryInfo` 提供 `ToolName`、`Attempt`、`RawError`、`ResultError`（结果级错误）、`Elapsed`，自定义 `RetryOn` 可先调 `tool.DefaultRetryOn` 再叠加业务规则。

#### Graph ToolsNode

```go
sg.AddToolsNode("tools", tools, graph.WithToolCallRetryPolicy(policy))
```

#### 内置工具 options 速查

| 工具 | 关键 options |
|------|--------------|
| `duckduckgo.NewTool` | `WithBaseURL` / `WithHTTPClient` |
| `claudecode.NewToolSet` | `WithBaseDir` / `WithReadOnly` / `WithMaxFileSize` |
| `mcp.NewMCPToolSet` | `ConnectionConfig{Transport, Command, Args, Env, ServerURL, HTTPHeaders, Timeout}` + `WithToolFilterFunc` |
| `mcp.NewBroker` | `WithBrokerServers` / `WithBrokerAuthHook` |
| `todo.New()` | 软约束直接用；硬约束配 `todoenforcer.New()` extension |

## 学习路径建议

1. **先读 [`codeexec`](./tool-codeexec.md)**：理解最基础的 "Tool 定义 + WithTools 注册 + 事件三段式分发" 模式，这是所有工具示例的骨架
2. **再读 [`hostexec`](./tool-hostexec.md)**：看 ToolSet 如何暴露多个协同工具、`yield_time_ms` 如何支撑长任务，理解 `WithToolSets` 与 `WithTools` 的差异
3. **进阶读 [`openviking`](./tool-openviking.md)**：外部服务对接、Profile 分级、search-then-read 范式，是构建企业级 Agent 的关键参考
4. **对照读 [`webfetch`](./tool-webfetch.md)**：同一问题的两种实现（本地 vs 云端），理解工具的可替换性

## 总结

Tool 系统的设计精髓在于**抽象统一、实现可换**：同一套 `tool.Tool` / `tool.ToolSet` 接口，下层可以是本机代码、宿主机 shell、外部检索服务、开放网页；上层注册方式只有 `WithTools` / `WithToolSets` 两种。理解了 codeexec 的最简骨架，其它三个示例都是在这个骨架上替换"工具来源"和"事件处理细节"。

Tool 与 [`06-memory-system/`](../06-memory-system/memory.md) 紧密配合：Memory 让 Agent 跨会话记住信息，Tool 让 Agent 在单次会话里调用外部能力。生产环境通常会把多个 Tool / ToolSet 一起注册给同一个 Agent——比如同时给模型 `execute_code` + `web_fetch` + `memory_search`，让它在一次对话中自由组合。
