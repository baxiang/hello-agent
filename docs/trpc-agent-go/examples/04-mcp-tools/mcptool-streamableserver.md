# Streamable HTTP MCP 服务端 - 结构化输入输出与类型安全

> **源码路径**：[`trpc-agent-go/examples/mcptool/streamalbeserver/`](../../../../trpc-agent-go/examples/mcptool/streamalbeserver)
> **示例类型**：MCP 服务端（streamable_http） · **难度**：进阶

## 概述

`streamalbeserver/main.go`（源码目录名拼写有历史遗留问题，README 已注明保留兼容）是一个 Streamable HTTP MCP 服务端，监听 `:3000`，暴露两个工具：`get_weather`（带**结构化输入/输出**）和 `get_news`（纯文本）。它是四个服务端示例里**唯一演示 struct-first API 与 OutputSchema** 的，代表了 MCP 服务端推荐的现代写法。

Streamable HTTP 是 MCP 2025 规范定义的新传输：标准 HTTP + SSE 流，双向通信、可走 CDN/反代，语义比 SSE 更标准。新项目首选。

| 维度 | streamableserver（本文件） | sseserver | stdioserver |
|------|------------------------------|-----------|-------------|
| 传输 | HTTP streamable | HTTP SSE | stdin/stdout |
| Server 构造器 | `mcp.NewServer` + `WithServerAddress` | `mcp.NewSSEServer` | `mcp.NewStdioServer` |
| 端口 | `:3000`（hard-code） | `:8080`（`-port`） | — |
| API 风格 | struct-first + OutputSchema | 字符串声明 | 字符串声明 |
| 阻塞 `Start()` | ✅ 阻塞 | ❌ goroutine | ✅ 阻塞 |

## 核心概念

### `mcp.NewServer` + `WithServerAddress`：通用 Server

与 `NewSSEServer` / `NewStdioServer` 不同，`NewServer` 是通用构造器，默认走 Streamable HTTP：

```go
server := mcp.NewServer("mcp-example-server", "1.0.0",
    mcp.WithServerAddress(":3000"),
)
```

监听端口由 `WithServerAddress` 指定。`server.Start()` **阻塞**——这点像 STDIO、不像 SSE。客户端连接配置：

```go
mcp.ConnectionConfig{
    Transport: "streamable_http",
    ServerURL: "http://localhost:3000/mcp",
    Timeout:   10 * time.Second,
}
```

### struct-first API：用 Go 结构体替代逐字段声明

传统写法（如 [`stdioserver`](./mcptool-stdioserver.md) 的 `WithString` / `WithNumber`）逐字段声明参数 schema；struct-first API 直接把整个 Go 结构体作为输入/输出 schema，**从 jsonschema tag 自动推导**：

```go
type WeatherRequest struct {
    Location string `json:"location" jsonschema:"required,description=City name or location"`
    Units    string `json:"units,omitempty" jsonschema:"description=Temperature units,enum=celsius,enum=fahrenheit,default=celsius"`
}

type WeatherResponse struct {
    Location    string `json:"location"     jsonschema:"required,description=Requested location"`
    Temperature int    `json:"temperature"  jsonschema:"required,description=Current temperature in degrees"`
    Condition   string `json:"condition"    jsonschema:"required,description=Weather condition"`
    Humidity    int    `json:"humidity"     jsonschema:"required,description=Humidity percentage"`
    WindSpeed   int    `json:"windSpeed"    jsonschema:"required,description=Wind speed in km/h"`
    Units       string `json:"units"        jsonschema:"required,description=Temperature units"`
}

weatherTool := mcp.NewTool("get_weather",
    mcp.WithDescription("Get current weather for a location with structured output"),
    mcp.WithInputStruct[WeatherRequest](),
    mcp.WithOutputStruct[WeatherResponse](),
)
```

优点：

- **类型安全**：编译期检查字段，避免字符串拼写错误
- **代码即文档**：Go 类型直接对应 JSON Schema，无重复维护
- **OutputSchema**：`WithOutputStruct` 让客户端提前知道工具**返回结构**，便于 LLM 决策（普通 MCP 工具只暴露输入 schema）

### Typed Handler：编译期类型检查的回调

```go
server.RegisterTool(weatherTool, mcp.NewTypedToolHandler(
    func(ctx context.Context, req *mcp.CallToolRequest, input WeatherRequest) (WeatherResponse, error) {
        units := input.Units
        if units == "" {
            units = "celsius"
        }
        return WeatherResponse{
            Location:    input.Location,
            Temperature: 22,
            Condition:   "Sunny",
            Humidity:    45,
            WindSpeed:   10,
            Units:       units,
        }, nil
    },
))
```

`mcp.NewTypedToolHandler` 把 `(*CallToolRequest, T) → (R, error)` 包装成标准 `(*CallToolRequest) → (*CallToolResult, error)`，框架自动完成 JSON ↔ 结构体的反序列化/序列化。你**不再需要**手动从 `req.Params.Arguments["location"].(string)` 取值。

## 代码解析

### 两种风格并存

本服务同时展示了 struct-first 和传统 string-first 两种写法，便于对比：

```go
// 风格 A：struct-first + TypedToolHandler（推荐）
weatherTool := mcp.NewTool("get_weather",
    mcp.WithInputStruct[WeatherRequest](),
    mcp.WithOutputStruct[WeatherResponse](),
)
server.RegisterTool(weatherTool, mcp.NewTypedToolHandler(func(...) {...}))

// 风格 B：字符串声明 + 普通 handler（兼容写法）
newsTool := mcp.NewTool("get_news",
    mcp.WithString("category", mcp.Description("News category"), mcp.Default("general")),
)
server.RegisterTool(newsTool, func(ctx context.Context, req *mcp.CallToolRequest) (*mcp.CallToolResult, error) {
    category, _ := req.Params.Arguments["category"].(string)
    if category == "" {
        category = "general"
    }
    result := fmt.Sprintf("Latest %s news headlines:\n1. ...\n2. ...\n3. ...\n", category)
    return mcp.NewTextResult(result), nil
})
```

风格 B 中的 `mcp.Default("general")` 是 schema 级 default——这点比 [`sseserver`](./mcptool-sseserver.md) 的"handler 兜底"更显式，客户端能感知到。

### `NewTextResult` 快捷构造

对于纯文本结果，`mcp.NewTextResult(text)` 等价于 `&CallToolResult{Content: []Content{NewTextContent(text)}}`，更简洁。

### 阻塞 `Start()`

```go
if err := server.Start(); err != nil {
    log.Fatalf("Server failed to start: %v", err)
}
fmt.Printf("Starting MCP server on http://localhost:%d\n", 3000)
```

**注意**：因为 `Start()` 阻塞，所以紧跟在后面的两行 `fmt.Printf` **实际不会执行**（除非服务退出）。这是源码中的小瑕疵，真实启动日志由 trpc-mcp-go 内部打印。要打印自定义启动信息，应在 `Start()` **之前**输出。

## 运行方式

### 启动服务端

```bash
cd examples/mcptool/streamalbeserver
go run main.go
```

### 命令行参数

本服务**没有** flag。端口 `:3000` 在源码中 hard-code（`mcp.WithServerAddress(":3000")`）。如需改端口，要修改源码。

### 环境变量

本服务端**不需要** `OPENAI_API_KEY`——只对外提供工具，不调 LLM。

### 配合主程序使用

```bash
# Terminal 1: 启动本 Streamable HTTP 服务
cd examples/mcptool/streamalbeserver && go run main.go

# Terminal 2: 启动 SSE 服务（主程序还要它）
cd examples/mcptool/sseserver && go run main.go

# Terminal 3: 启动主程序
export OPENAI_API_KEY="your-key"
cd examples/mcptool && go run main.go
```

在主程序里问"What's the weather in Shenzhen?"会触发 `get_weather`，问"What's the latest tech news?"触发 `get_news`。

### 客户端重试验证

主程序为本服务配置了 `tmcp.WithSimpleRetry(3)`——手动 kill 本服务再问天气，客户端会在 500ms → 1s → 2s 间隔重试，3 次都失败才报错。重启服务后下次请求即恢复。

## 适用场景与对比

### 选 Streamable HTTP（本服务）当...

- **新项目首选**：MCP 2025 规范推荐
- 需要双向 HTTP 流，能走标准 CDN / 反向代理
- 想用 struct-first API 享受类型安全
- 想暴露 OutputSchema 让 LLM 提前知道返回结构

### struct-first vs 字符串声明

| 维度 | struct-first（`get_weather`） | 字符串声明（`get_news`） |
|------|-------------------------------|--------------------------|
| Schema 来源 | Go 结构体 tag 自动推导 | `WithString` / `WithNumber` 逐字段 |
| 类型安全 | ✅ 编译期 | ❌ 运行时类型断言 |
| OutputSchema | ✅ `WithOutputStruct` | ❌ 仅输入 |
| Handler 签名 | `NewTypedToolHandler` 强类型 | 普通 `(*CallToolRequest)` |
| 适合场景 | 复杂结构、严格契约 | 简单参数、快速原型 |

### 三种服务端全景对比

| 维度 | streamableserver | sseserver | stdioserver |
|------|------------------|-----------|-------------|
| Server 构造 | `NewServer + addr` | `NewSSEServer` | `NewStdioServer` |
| 端口配置 | `WithServerAddress` | `-port` flag | 无 |
| 启动阻塞 | ✅ 阻塞 | ❌ goroutine | ✅ 阻塞 |
| 信号退出 | 由 Start 阻塞处理 | 需 SIGINT/SIGTERM | 由父进程关 stdin |
| Schema 风格 | struct-first + OutputSchema | 字符串声明 | 字符串声明 |
| 客户端重试 | `WithSimpleRetry` | `WithRetry` | ❌ |
| 推荐度 | ⭐⭐⭐ 新项目 | ⭐⭐ 兼容 | ⭐⭐ 本地 |

## 关键要点

1. **通用 Server**：`mcp.NewServer + WithServerAddress` 是 streamable_http 的标准构造方式
2. **struct-first API**：`WithInputStruct[T]()` / `WithOutputStruct[T]()` 从结构体 tag 推导 JSON Schema
3. **OutputSchema 是新增能力**：让客户端提前知道工具返回结构，传统 MCP 只暴露输入 schema
4. **Typed Handler**：`NewTypedToolHandler` 消除手动类型断言，编译期类型检查
5. **`Start()` 阻塞**：与 STDIO 相同，启动日志要在 `Start()` 之前打印
6. **schema 级 default**：`mcp.Default("general")` 比 handler 内兜底更显式
7. **`NewTextResult`**：纯文本结果的快捷构造

## 总结

`streamableserver` 是 MCP 服务端示例里**信息密度最高**的一个——它把 struct-first API、OutputSchema、Typed Handler、schema 级 default、`NewTextResult` 这些现代特性一次性讲清楚。理解它就掌握了 MCP 服务端的"最佳实践"写法。如果想进一步学习如何在每次请求里注入动态 Header（认证、追踪），接着读 [`http_headers`](./mcptool-httpheaders.md)；想看完客户端如何把这些服务组合起来，回到 [`mcptool-main`](./mcptool-main.md)。
