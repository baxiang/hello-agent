# SSE MCP 服务端 - HTTP 长连接工具服务与优雅退出

> **源码路径**：[`trpc-agent-go/examples/mcptool/sseserver/`](../../../../trpc-agent-go/examples/mcptool/sseserver)
> **示例类型**：MCP 服务端（sse） · **难度**：入门

## 概述

`sseserver/main.go` 是一个 SSE（Server-Sent Events）MCP 服务端，通过 HTTP 长连接对外暴露两个工具：`sse_recipe`（中式菜谱查询）和 `sse_health_tip`（健康建议）。相比 [`stdioserver`](./mcptool-stdioserver.md)，它多了三件事：**HTTP 端口监听**、**命令行端口参数**、**信号优雅退出**。

SSE 是 MCP 协议中较早期的 HTTP 传输——服务端用 SSE 推送事件、客户端用 POST 回传请求。新一代 MCP 推荐改用 **Streamable HTTP**（见 [`streamableserver`](./mcptool-streamableserver.md)），但 SSE 服务端在存量系统中仍大量存在，本示例主要服务于**兼容与对比学习**。

| 维度 | sseserver（本文件） | stdioserver | streamableserver |
|------|---------------------|-------------|------------------|
| 传输 | HTTP SSE | stdin/stdout | HTTP（streamable） |
| 端口 | `:8080`（`-port` 可配） | — | `:3000`（hard-code） |
| 信号处理 | ✅ SIGINT/SIGTERM | ❌（子进程） | ❌ |
| Server 构造器 | `mcp.NewSSEServer` | `mcp.NewStdioServer` | `mcp.NewServer + addr` |

## 核心概念

### `mcp.NewSSEServer`：HTTP 长连接 MCP 服务

一行构造，命名后即可注册工具：

```go
server := mcp.NewSSEServer("SSE Example Server", "1.0.0")
```

底层会自动暴露 SSE 端点（默认 `/sse`）供客户端订阅，同时提供 POST 端点接收客户端的工具调用请求。客户端连接配置对应：

```go
mcp.ConnectionConfig{
    Transport: "sse",
    ServerURL: "http://localhost:8080/sse",
    Timeout:   10 * time.Second,
    Headers:   map[string]string{"User-Agent": "trpc-agent-go/1.0.0"},
}
```

### 端口参数与信号优雅退出

服务端要做两件 STDIO 不需要的事——**接受端口参数** + **响应终止信号**：

```go
port := flag.Int("port", 8080, "Listen port")
flag.Parse()

// 注册 SIGINT / SIGTERM
ctx, cancel := context.WithCancel(context.Background())
defer cancel()
signalChan := make(chan os.Signal, 1)
signal.Notify(signalChan, syscall.SIGINT, syscall.SIGTERM)
go func() {
    <-signalChan
    cancel()
}()

// 非阻塞启动，等信号后 Shutdown
addr := fmt.Sprintf(":%d", *port)
go server.Start(addr)
<-ctx.Done()
server.Shutdown(context.Background())
```

Ctrl+C 或 `kill` 会触发 `cancel()`，主流程跳出阻塞并调用 `Shutdown`，给在途请求一个收尾机会。这是任何生产级 HTTP MCP 服务都必须做的。

### 非阻塞 `Start(addr)`

注意与 [`stdioserver`](./mcptool-stdioserver.md) 的关键差别——SSE 的 `server.Start(addr)` 是**非阻塞**的（在 goroutine 里跑），需要主流程自己 `select` 等待退出信号。STDIO 的 `Start()` 则直接阻塞在 stdin 上：

| 调用 | 阻塞行为 | 谁负责退出 |
|------|---------|-----------|
| `stdioServer.Start()` | 阻塞 | 父进程关 stdin |
| `sseServer.Start(addr)` | 非阻塞（goroutine） | 自身信号 → `Shutdown` |

## 代码解析

### 工具注册

```go
recipeTool := mcp.NewTool("sse_recipe",
    mcp.WithDescription("Chinese recipe query tool"),
    mcp.WithString("dish", mcp.Description("Dish name")),
)
server.RegisterTool(recipeTool, handleRecipe)

healthTipTool := mcp.NewTool("sse_health_tip",
    mcp.WithDescription("Health tip tool"),
    mcp.WithString("category", mcp.Description("Category")),
)
server.RegisterTool(healthTipTool, handleHealthTip)
```

注意两个参数都没有 `mcp.Required()`——意味着客户端可以不传，handler 内部会兜底。

### Handler：兜底默认值

```go
func handleRecipe(ctx context.Context, req *mcp.CallToolRequest) (*mcp.CallToolResult, error) {
    dish := "Red braised pork"           // 默认值
    if dishArg, ok := req.Params.Arguments["dish"]; ok {
        if dishStr, ok := dishArg.(string); ok && dishStr != "" {
            dish = dishStr
        }
    }
    result := "【Red braised pork】\n" + /* ... */
    log.Printf("Recipe request: dish=%s", dish)
    return &mcp.CallToolResult{
        Content: []mcp.Content{mcp.NewTextContent(result)},
    }, nil
}
```

返回固定模板字符串（菜谱步骤），不真正按 `dish` 内容变化——这是 demo 的简化处理，生产环境应替换为真实数据源。`log.Printf` 写到 stderr 便于排查。

### 主流程

```go
go server.Start(addr)
<-ctx.Done()
server.Shutdown(context.Background())
```

三行收尾：goroutine 启动监听 → 等信号 → 关闭。

## 运行方式

### 启动服务端

```bash
cd examples/mcptool/sseserver
go run main.go                # 默认 :8080
go run main.go -port 9090     # 自定义端口
```

### 命令行参数

| 参数 | 说明 | 默认值 |
|------|------|--------|
| `-port` | 监听端口 | `8080` |

### 环境变量

本服务端**不需要** `OPENAI_API_KEY`——它只是工具服务，不直接调用 LLM。

### 启动日志

```
Start SSE server, port: 8080
Available tools: sse_recipe, sse_health_tip
```

### 配合主程序使用

```bash
# Terminal 1: 启动本 SSE 服务
cd examples/mcptool/sseserver && go run main.go

# Terminal 2: 启动 streamable 服务（主程序还需要它）
cd examples/mcptool/streamalbeserver && go run main.go

# Terminal 3: 启动主程序
export OPENAI_API_KEY="your-key"
cd examples/mcptool && go run main.go
```

在主程序里问"给我一个红烧肉菜谱"或"给个运动健康建议"会触发对应 SSE 工具。主程序为 SSE 配置了 `WithSessionReconnect(3)` + 自定义 `WithRetry`——SSE 服务器重启后客户端能自动重连，验证重启即可观察。

## 适用场景与对比

### 选 SSE 当...

- 已有 SSE 基础设施（网关、负载均衡器已配 SSE）
- 客户端是老版本 MCP SDK，不支持 streamable_http
- 单向事件推送为主的场景

### 选 Streamable HTTP 当...

- 新部署、新客户端（**推荐**）
- 需要更标准的 HTTP 语义（双向、可走 CDN/反代）
- 想用 struct-first API + OutputSchema

### 选 STDIO 当...

- 本地工具，不需要跨机

| 维度 | SSE | Streamable HTTP | STDIO |
|------|-----|-----------------|-------|
| 协议版本 | MCP 早期 | MCP 2025 推荐 | MCP 早期 |
| 连接方向 | 服务端推 + 客户端 POST | 双向 HTTP | stdin/stdout |
| Server 构造器 | `NewSSEServer` | `NewServer + addr` | `NewStdioServer` |
| 客户端 `Transport` 字段 | `"sse"` | `"streamable_http"` | `"stdio"` |
| 推荐度 | 兼容旧系统 | ⭐ 首选 | 本地工具 |

## 关键要点

1. **HTTP 服务三件套**：端口参数 + 信号监听 + `Shutdown`，缺一不可进生产
2. **非阻塞 `Start(addr)`**：SSE 在 goroutine 里跑，主流程要自己等信号
3. **兜底默认值**：handler 内对未传参数给 fallback，比 schema `Default` 更灵活
4. **stderr 日志、stdout 协议**：`log.Printf` 走 stderr，不污染 MCP 通道
5. **配合客户端重连**：客户端配 `WithSessionReconnect(3)` 后，本服务可热重启而不丢请求

## 总结

`sseserver` 在 [`stdioserver`](./mcptool-stdioserver.md) 的基础上加了 HTTP 服务该有的工程要素——端口、信号、优雅退出。理解了它，再去读 [`streamableserver`](./mcptool-streamableserver.md) 的 struct-first API 与 OutputSchema，就能掌握 MCP 服务端的全部主流写法。新项目建议直接用 Streamable HTTP；本 SSE 示例主要用于兼容历史系统与对比学习。
