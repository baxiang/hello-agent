# STDIO MCP 服务端 - 最简单的本地子进程工具服务

> **源码路径**：[`trpc-agent-go/examples/mcptool/stdioserver/`](../../../../trpc-agent-go/examples/mcptool/stdioserver)
> **示例类型**：MCP 服务端（stdio） · **难度**：入门

## 概述

`stdioserver/main.go` 是整个 MCP 系列里**最简单的服务端**：一个不到 120 行的程序，通过标准输入/输出（stdin/stdout）对外暴露两个工具（`echo`、`add`）。它没有 HTTP、没有端口、没有信号处理，启动后即"挂"在 stdin 上等待 JSON-RPC 消息。

与其它三个 sub 示例对比：

| 维度 | stdioserver（本文件） | sseserver | streamableserver |
|------|------------------------|-----------|------------------|
| 传输 | stdin/stdout | HTTP SSE 长连接 | HTTP（streamable） |
| 启动方式 | 由客户端作为**子进程**拉起 | 自己监听端口 | 自己监听端口 |
| Server 构造器 | `mcp.NewStdioServer` | `mcp.NewSSEServer` | `mcp.NewServer` + addr |
| 适合场景 | 本地工具、CLI、零网络 | 兼容旧 SSE 服务 | 新部署、生产推荐 |

## 核心概念

### `mcp.NewStdioServer`：基于标准流的 MCP 服务

STDIO 是 MCP 协议最朴素的传输——客户端把 MCP JSON-RPC 消息写到子进程的 stdin，从子进程的 stdout 读响应。无需开端口、无需 TLS、无需 DNS，**同机最低延迟**：

```go
server := mcp.NewStdioServer("simple-stdio-server", "1.0.0",
    mcp.WithStdioServerLogger(mcp.GetDefaultLogger()),
)
```

第一个参数是服务名（仅用于日志和 MCP `serverInfo`），第二个是版本号。客户端通过 `mcp.ConnectionConfig{Transport: "stdio", Command: "go", Args: []string{"run", "./stdioserver/main.go"}}` 由主程序拉起本服务。

### 声明式工具注册：`mcp.NewTool` + `RegisterTool`

工具由两部分组成——**参数 schema 声明** + **处理回调**：

```go
echoTool := mcp.NewTool("echo",
    mcp.WithDescription("Simple echo tool that returns the input message with an optional prefix"),
    mcp.WithString("message", mcp.Required(), mcp.Description("The message to echo")),
    mcp.WithString("prefix", mcp.Description("Optional prefix, default is 'Echo: '")),
)
server.RegisterTool(echoTool, handleEcho)
```

`mcp.WithString` / `mcp.WithNumber` 等构造器逐字段声明参数；`mcp.Required()` 标记必填；`mcp.Description(...)` 描述字段（也会暴露给 LLM 作为参数提示）。框架会把这些声明编译成 JSON Schema，随 `tools/list` 返回给客户端。

### Handler 签名与 `CallToolResult`

每个回调函数都遵循同一签名：

```go
func(ctx context.Context, req *mcp.CallToolRequest) (*mcp.CallToolResult, error)
```

参数通过 `req.Params.Arguments["name"]` 取值（类型断言后使用）；返回值用 `mcp.NewTextContent(text)` 包成 `Content` 列表：

```go
return &mcp.CallToolResult{
    Content: []mcp.Content{mcp.NewTextContent(result)},
}, nil
```

## 代码解析

### `handleEcho`：字符串字段读取 + 默认值

```go
message := ""
if msgArg, ok := req.Params.Arguments["message"]; ok {
    if msgStr, ok := msgArg.(string); ok {
        message = msgStr
    }
}
if message == "" {
    return nil, fmt.Errorf("missing required parameter: message")
}

prefix := "Echo: "
if prefixArg, ok := req.Params.Arguments["prefix"]; ok {
    if prefixStr, ok := prefixArg.(string); ok && prefixStr != "" {
        prefix = prefixStr
    }
}
```

注意 `Arguments` 是 `map[string]any`，读字段需要**两层类型断言**（先判存在、再判类型）。`prefix` 虽然没标 `Required`，但代码里给了一个隐式默认值 `"Echo: "`——这是 MCP 工具常见的做法（schema 里不写 default，handler 里兜底）。

### `handleAdd`：数值字段的 int/float 兼容

JSON 数字在不同客户端可能解析为 `float64` 或 `int`，handler 同时兼容两者：

```go
var a float64
if aArg, ok := req.Params.Arguments["a"]; ok {
    if aFloat, ok := aArg.(float64); ok {
        a = aFloat
    } else if aInt, ok := aArg.(int); ok {
        a = float64(aInt)
    } else {
        return nil, fmt.Errorf("invalid parameter 'a': must be a number")
    }
}
```

输出格式化字符串 `%.2f + %.2f = %.2f` 直接展示在 `NewTextContent` 里——返回结构由你决定，文本、JSON 字符串都可以。

### `server.Start()` 是阻塞的

```go
if err := server.Start(); err != nil {
    log.Fatalf("Server error: %v", err)
}
```

`Start()` 阻塞在 stdin 上读 MCP 消息，直到 stdin 关闭（客户端关闭子进程）或出错。无需自己处理信号——子进程由父进程管理生命周期。

## 运行方式

### 单独运行（仅做编译/调试验证）

```bash
cd examples/mcptool/stdioserver
go run main.go      # 会卡在 stdin 等待 MCP 消息
# 手动按 Ctrl+D 发 EOF 退出
```

直接 `go run` 时它读 stdin、写 stdout，但因为没有合法 MCP 客户端发握手消息，所以正常情况下看不到工具调用效果——它**设计上就是被客户端拉起的子进程**。

### 正确用法：由 [`mcptool-main`](./mcptool-main.md) 自动拉起

```bash
# 先起 HTTP 类服务（与本子进程无关，但主程序会一起连）
cd examples/mcptool/streamalbeserver && go run main.go &
cd examples/mcptool/sseserver         && go run main.go &

# 主程序会以 `go run ./stdioserver/main.go` 作为子进程拉起 STDIO 服务
export OPENAI_API_KEY="your-key"
cd examples/mcptool && go run main.go
```

主程序的对应配置（在 `mcptool/main.go`）：

```go
mcp.ConnectionConfig{
    Transport: "stdio",
    Command:   "go",
    Args:      []string{"run", "./stdioserver/main.go"},
    Timeout:   10 * time.Second,
}
```

### 命令行参数

本服务**没有** flag。端口、超时等概念不适用 STDIO。

### 预期日志

启动时会打印（写到 stderr，stdout 留给 MCP 协议本身）：

```
2025/... Starting Simple STDIO MCP Server...
2025/... Available tools: echo, add
2025/... Using simplified implementation
```

## 适用场景与对比

### 选 STDIO 当...

- 工具是**本地 CLI / 脚本**，无需网络
- 需要最低延迟、避免端口占用
- 客户端能直接管理子进程生命周期（如桌面 Agent、IDE 插件）
- 单机调试 / 开发期

### 选 SSE / Streamable HTTP 当...

- 工具部署在**远程服务**，跨机访问
- 多个客户端共享同一个 MCP 服务
- 需要 HTTP 中间件（认证、限流、追踪）
- 参见 [`sseserver`](./mcptool-sseserver.md) / [`streamableserver`](./mcptool-streamableserver.md)

| 维度 | STDIO | SSE | Streamable HTTP |
|------|-------|-----|-----------------|
| 网络开销 | 无 | 有 | 有 |
| 跨机部署 | ❌ | ✅ | ✅ |
| 客户端重试 | ❌ | ✅ | ✅ |
| 服务发现 | 客户端配 Command/Args | 客户端配 URL | 客户端配 URL |
| 服务端构造器 | `NewStdioServer` | `NewSSEServer` | `NewServer + addr` |

## 关键要点

1. **最简服务端**：`mcp.NewStdioServer` + `RegisterTool` + `Start()`，三步即可
2. **声明式 schema**：`WithString` / `WithNumber` + `Required()` + `Description()` 自动生成 JSON Schema
3. **Handler 统一签名**：`func(ctx, *CallToolRequest) (*CallToolResult, error)`
4. **类型断言防御**：`Arguments` 是 `map[string]any`，数值字段要同时兼容 `int` / `float64`
5. **默认值在 handler 内兜底**：schema 不写 default 时，handler 里给 fallback
6. **不要直接 `go run`**：设计上是被父进程拉起的子进程，stdin/stdout 是协议通道

## 总结

`stdioserver` 是 MCP 服务端最小可用样板——掌握了 `NewTool` + `RegisterTool` + `CallToolResult` 这三件事，再去写 HTTP 类服务端只是换 Server 构造器、加端口监听和信号处理。下一步建议对比 [`sseserver`](./mcptool-sseserver.md) 看 HTTP 服务的差异，或直接跳到 [`streamableserver`](./mcptool-streamableserver.md) 学习更现代的 struct-first API。
