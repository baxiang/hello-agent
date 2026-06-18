# MCP 动态 HTTP Header - 基于上下文的 per-request 认证注入

> **源码路径**：[`trpc-agent-go/examples/mcptool/http_headers/`](../../../../trpc-agent-go/examples/mcptool/http_headers)
> **示例类型**：客户端 + 服务端（streamable） · **难度**：进阶

## 概述

`http_headers/` 是一个**自带服务端**的客户端示例，专门演示 trpc-mcp-go 的 `HTTPBeforeRequest` 钩子：每次发往 MCP 服务端的 HTTP 请求（包括 `initialize`、`tools/list`、`tools/call`、GET SSE）触发前，回调函数可以从 `context.Context` 取出业务字段，动态设置 HTTP Header（如 `X-Request-ID`、`X-User-ID`、`Authorization`）。这是接入企业级 MCP 网关时的关键能力——**每次请求带不同认证/追踪信息**。

目录里有两个程序协同：

| 程序 | 角色 | 说明 |
|------|------|------|
| `http_headers/main.go` | 客户端 | 注入 4 个动态 Header，跑交互式对话 |
| `http_headers/mcpserver/main.go` | 服务端 | Streamable HTTP 服务（`:3000/mcp`），打印收到的 Header 用于验证 |

| 维度 | 本示例（http_headers） | 其它三个 sub 示例 |
|------|-------------------------|------------------|
| 焦点 | 客户端 **Header 注入** | 服务端 **传输实现** |
| 自带服务端 | ✅（mcpserver/） | ❌（共用 streamalbeserver/sseserver） |
| 必备概念 | `context.Context` 传递 | Server 构造器 |
| 典型用途 | 认证 token、链路追踪 | 工具注册、协议差异 |

## 核心概念

### `HTTPBeforeRequest`：请求拦截器

trpc-mcp-go 暴露的钩子签名：

```go
type HTTPBeforeRequestFunc func(ctx context.Context, req *http.Request) error
```

- **输入**：context + 即将发出的 `*http.Request`
- **输出**：返回 error 会**中止**该请求
- **触发时机**：所有 HTTP 请求（工具调用、通知、SSE 连接握手）

通过 `tmcp.WithHTTPBeforeRequest(fn)` 注入：

```go
c.mcpToolSet = mcp.NewMCPToolSet(
    mcp.ConnectionConfig{
        Transport: "streamable",
        ServerURL: "http://localhost:3000/mcp",
        Timeout:   10 * time.Second,
    },
    mcp.WithMCPOptions(
        tmcp.WithHTTPBeforeRequest(beforeRequest),
    ),
)
```

> 注意：源码中 `Transport` 字段值是 `"streamable"`（不是 [`mcptool-main`](./mcptool-main.md) 用的 `"streamable_http"`）。两者都被框架接受。

### Context 传递链：从 `runner.Run` 到 HTTP 层

动态 Header 的精髓在于 **context 贯穿整个调用链**：

```
runner.Run(ctx, ...)              ← 你在 ctx 里塞值
    ↓ context 流经
MCP ToolSet 工具调用
    ↓ context 流经
HTTPBeforeRequest(ctx, req)       ← 在这里取出来
    ↓ 提取 ctx 值
req.Header.Set("X-Request-ID", v) ← 注入 HTTP Header
```

只要你在调 `runner.Run` 前把数据塞进 ctx，钩子函数就能拿到。

### 两种 Agent 集成方式

本示例**显式对比**了两种把 MCP 工具接入 Agent 的方式（在 `http_headers/main.go:171-188` 的注释里详细说明）：

| 方式 | 调用 | `initialize`/`tools/list` Header | `tools/call` Header | 适合 |
|------|------|----------------------------------|---------------------|------|
| **A（推荐，本示例用）** | `WithTools(tools)` + 手动 `toolSet.Tools(setupCtx)` | ✅ 动态 | ✅ 动态 | per-request 认证 |
| **B（简单）** | `WithToolSets([]tool.ToolSet{...})` | ❌ 默认用 `context.Background()` | ✅ 动态 | 静态 API Key |

方式 A 多写一行手动 `Tools(ctx)`，但能保证**所有** MCP 请求（包括初始化握手）都带上动态 Header；方式 B 简单，但握手阶段用 `context.Background()`，业务字段传不到。方式 B 可叠加 `WithRefreshToolSetsOnRun(true)` 让发现阶段也走 run context，代价是每次都刷新工具列表。

## 代码解析（客户端 `main.go`）

### 定义 context key

```go
type contextKey string

const (
    requestIDKey contextKey = "request-id"
    userIDKey    contextKey = "user-id"
    sessionIDKey contextKey = "session-id"
    timestampKey contextKey = "timestamp"
)
```

用自定义类型 `contextKey` 避免和别人的 key 冲突。

### `HTTPBeforeRequest` 实现

```go
beforeRequest := func(ctx context.Context, req *http.Request) error {
    if requestID, ok := ctx.Value(requestIDKey).(string); ok {
        req.Header.Set("X-Request-ID", requestID)
        fmt.Printf("📤 Setting header: X-Request-ID = %s\n", requestID)
    }
    if userID, ok := ctx.Value(userIDKey).(string); ok {
        req.Header.Set("X-User-ID", userID)
    }
    // ... X-Session-ID / X-Timestamp 同理
    fmt.Printf("📤 HTTP %s %s\n", req.Method, req.URL.Path)
    return nil
}
```

四个 Header 都用同样的"取值 → set → 打印"模式。

### Setup 阶段：把 ctx 值传给 `Tools()`

方式 A 的关键——**setup 阶段也构造带值的 ctx**，让 `initialize` / `tools/list` 也带 Header：

```go
setupCtx := context.WithValue(ctx, requestIDKey, setupRequestID)
setupCtx = context.WithValue(setupCtx, userIDKey, c.userID)
setupCtx = context.WithValue(setupCtx, sessionIDKey, c.sessionID)
setupCtx = context.WithValue(setupCtx, timestampKey, setupTimestamp)

// 这一句会触发 initialize / tools/list / GET SSE，全部带上 Header
tools := c.mcpToolSet.Tools(setupCtx)
```

注意**没有调用 `toolSet.Init(ctx)`**——方式 A 下 `Tools(ctx)` 隐式完成初始化。

### 运行时：每条消息生成新 ctx

```go
func (c *httpHeadersChat) processMessage(ctx context.Context, userMessage string) error {
    requestID := fmt.Sprintf("req-%d", time.Now().UnixNano())
    timestamp := time.Now().Format(time.RFC3339)

    ctx = context.WithValue(ctx, requestIDKey, requestID)
    ctx = context.WithValue(ctx, userIDKey, c.userID)
    ctx = context.WithValue(ctx, sessionIDKey, c.sessionID)
    ctx = context.WithValue(ctx, timestampKey, timestamp)

    eventChan, err := c.runner.Run(ctx, c.userID, c.sessionID, message)
    // ...
}
```

每条用户消息都生成**唯一的 `requestID` 和 `timestamp`**，使得每次 MCP 工具调用的 Header 都不同——这是 per-request 链路追踪的标准做法。

### 注入 Agent（方式 A）

```go
agent := llmagent.New(agentName,
    llmagent.WithModel(modelInstance),
    llmagent.WithTools(tools),   // ⚠️ 用 WithTools，不是 WithToolSets
)
```

## 代码解析（服务端 `mcpserver/main.go`）

服务端的作用是**验证 Header 真的被发出去了**——它把 HTTP handler 包了一层，先打印所有自定义 Header 再转给 MCP 处理：

```go
originalHandler := server.HTTPHandler()
http.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {
    logHeaders(r)
    originalHandler.ServeHTTP(w, r)
})
```

`logHeaders` 专门检查四个目标 Header：

```go
customHeaders := []string{"X-Request-ID", "X-User-ID", "X-Session-ID", "X-Timestamp"}
for _, header := range customHeaders {
    if value := r.Header.Get(header); value != "" {
        fmt.Printf("   %s: %s\n", header, value)
    }
}
```

它还读出 body 字符串打印后**重新塞回** `r.Body`（因为 `io.ReadAll` 会消耗 body）：

```go
bodyBytes, _ := io.ReadAll(r.Body)
fmt.Printf("Body: %s\n", string(bodyBytes))
r.Body = io.NopCloser(bytes.NewBuffer(bodyBytes))  // 恢复
```

服务端用通用 Server 构造器，监听 `:3000`，路径 `/mcp`：

```go
server := mcp.NewServer("header-demo-server", "1.0.0",
    mcp.WithServerAddress(":3000"),
    mcp.WithServerPath("/mcp"),
)
```

注册了 `get_weather` 和 `echo` 两个工具，便于客户端测试不同工具调用路径。

## 运行方式

### 启动服务端

```bash
cd examples/mcptool/http_headers/mcpserver
go run main.go
```

输出：

```
🚀 Starting SSE MCP Server with HTTP Header Logging...
Listening on http://localhost:3000/mcp
✅ Registered tool: get_weather
✅ Registered tool: echo
✅ Server ready
```

### 启动客户端

```bash
export OPENAI_API_KEY="your-key"
cd examples/mcptool/http_headers
go run main.go
```

### 命令行参数与环境变量

| 参数/变量 | 必需 | 说明 | 默认值 |
|-----------|------|------|--------|
| `OPENAI_API_KEY` | 是 | 模型 API Key | — |
| `OPENAI_BASE_URL` | 否 | 模型端点 | `https://api.openai.com/v1` |

客户端和服务端**都没有** flag。模型名 hard-code 为 `deepseek-v4-flash`，端口 hard-code 为 `:3000`。

### 预期输出

客户端（每条消息都注入 4 个 Header）：

```
🔧 Setup phase - initializing MCP connection:
   Request ID: req-setup-1750000000000000000
   User ID: user-123
   Session ID: session-1750000000
   Timestamp: 2025-...

📤 Setting header: X-Request-ID = req-setup-...
📤 Setting header: X-User-ID = user-123
📤 Setting header: X-Session-ID = session-...
📤 Setting header: X-Timestamp = 2025-...
📤 HTTP POST /mcp

✅ Loaded 2 tools from MCP server
```

服务端（每次请求都打印收到的 Header，证明链路通畅）：

```
📥 Received POST /mcp
Headers:
   X-Request-ID: req-1750000000000000000
   X-User-ID: user-123
   X-Session-ID: session-1750000000
   X-Timestamp: 2025-06-17T...
```

交互命令：输入 `exit` 退出。

## 适用场景与对比

### 选 `HTTPBeforeRequest`（动态 Header）当...

- 接入**企业 MCP 网关**需要 per-request 认证 token（如 OAuth、JWT）
- 需要全链路追踪（每条用户消息唯一 `X-Request-ID`）
- 需要传业务上下文（user-id / session-id / tenant-id）给服务端做权限校验

### 选静态 Header 当...

- 只有固定的 API Key（用 `mcp.ConnectionConfig.Headers` 或 `tmcp.WithRequestHeader`）

### 方式 A vs 方式 B 完整对比

| 维度 | 方式 A `WithTools` | 方式 B `WithToolSets` |
|------|---------------------|------------------------|
| 初始化代码 | 多一行手动 `Tools(ctx)` | 简洁 |
| `initialize` Header | ✅ 动态 | ❌ 默认静态 |
| `tools/list` Header | ✅ 动态 | ❌ 默认静态 |
| `tools/call` Header | ✅ 动态 | ✅ 动态 |
| GET SSE Header | ✅ 动态 | ❌ 默认静态 |
| 强制刷新工具列表 | 否 | `WithRefreshToolSetsOnRun(true)` 后是 |
| 适合 | per-request auth | 静态 API Key |

### 与其它 sub 示例的关系

| 示例 | 焦点 | 与本示例的互补 |
|------|------|----------------|
| [`stdioserver`](./mcptool-stdioserver.md) | STDIO 服务端 | STDIO 无 HTTP Header 概念 |
| [`sseserver`](./mcptool-sseserver.md) | SSE 服务端 | 本示例的 Header 机制同样适用于 SSE 客户端 |
| [`streamableserver`](./mcptool-streamableserver.md) | struct-first API | 本示例服务端用 string-first 风格 |
| [`mcptool-main`](./mcptool-main.md) | 综合集成 | 本示例在其基础上加了 Header 维度 |

## 关键要点

1. **`HTTPBeforeRequest` 是 per-request 拦截器**：所有 HTTP MCP 请求都会过这个钩子
2. **Context 是数据载体**：业务字段从 `runner.Run(ctx)` 一路流到钩子函数
3. **方式 A（`WithTools`）能覆盖所有请求**：包括 `initialize` 握手；方式 B 默认只覆盖 `tools/call`
4. **每条消息独立 ctx**：`requestID` / `timestamp` 用纳秒生成，保证唯一
5. **返回 error 即中止请求**：可用于"token 失效就拒绝调用"
6. **自定义 context key 类型**：避免与第三方库冲突
7. **服务端 `HTTPHandler()` 可包装**：用于日志、限流、Header 校验等横切关注

## 总结

`http_headers` 是 MCP 系列里**唯一讲客户端工程化**的示例——它把"如何把业务身份/追踪信息从用户请求一路带到 MCP 工具调用"这件事讲透了。掌握方式 A（`WithTools` + 手动 `Tools(ctx)`）和 context 传递链，就能把任意 trpc-mcp-go 客户端接入企业级网关。返回 [`mcptool-main`](./mcptool-main.md) 看综合集成，或回到 [索引](./mcptool.md) 选下一个学习目标。
