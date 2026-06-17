# MCP 综合示例 - 一个 Agent 同时消费三种 MCP 传输

> **源码路径**：[`trpc-agent-go/examples/mcptool`](../../../../trpc-agent-go/examples/mcptool)
> **示例类型**：客户端集成（stdio + sse + streamable_http） · **难度**：进阶

## 概述

`mcptool/main.go` 是整个 MCP 示例目录的**综合主程序**：一个交互式多轮对话助手，同时把**两个本地 Function Tool** 与**三个 MCP ToolSet**（STDIO、Streamable HTTP、SSE）注入同一个 LLM Agent。它回答了新手最常见的问题——"如何在同一个 Agent 里混用本地函数工具和远程 MCP 工具？"

与 4 个 sub 子示例的区别：那 4 个 sub 只演示**服务端**（或单一传输的细节），而本主程序是**客户端集成层**，把所有服务端拼装起来。先读懂本主程序的接线，再去对照各服务端实现会非常自然。

| 角色 | main.go（本文件） | stdioserver / sseserver / streamableserver |
|------|-------------------|-------------------------------------------|
| 定位 | 客户端 / Agent | 服务端 |
| 依赖 | 需要 OpenAI Key | 不需要 OpenAI Key |
| 启动顺序 | 最后启动 | 先启动（STDIO 由本程序自动拉起） |

## 核心概念

### Tool 与 ToolSet 的双轨注入

trpc-agent-go 区分两种工具来源：

- `llmagent.WithTools([]tool.Tool{...})` —— **单个工具**（如 `function.NewFunctionTool` 包装的本地函数）
- `llmagent.WithToolSets([]tool.ToolSet{...})` —— **工具集**（如一个 MCP 连接，背后可能暴露 N 个工具）

两者对 Agent 完全透明，模型看到的是统一的工具列表。

```go
llmAgent := llmagent.New(
    agentName,
    llmagent.WithModel(modelInstance),
    llmagent.WithTools([]tool.Tool{calculatorTool, timeTool}),                 // 本地函数
    llmagent.WithToolSets([]tool.ToolSet{stdioToolSet, streamableToolSet, sseToolSet}), // 三个 MCP
)
```

### 三种 MCP 传输的 ConnectionConfig

主程序同时展示了三种传输的典型配置——**只是 `Transport` 字段和几个专属字段不同**：

```go
// 1) STDIO：以子进程方式启动 stdioserver，走 stdin/stdout
stdioToolSet := mcp.NewMCPToolSet(
    mcp.ConnectionConfig{
        Transport: "stdio",
        Command:   "go",
        Args:      []string{"run", "./stdioserver/main.go"},
        Timeout:   10 * time.Second,
    },
    mcp.WithToolFilterFunc(tool.NewIncludeToolNamesFilter("echo", "add")),
)

// 2) Streamable HTTP：连远程 HTTP 服务，带简单重试
streamableToolSet := mcp.NewMCPToolSet(
    mcp.ConnectionConfig{
        Transport: "streamable_http",
        ServerURL: "http://localhost:3000/mcp",
        Timeout:   10 * time.Second,
    },
    mcp.WithToolFilterFunc(tool.NewIncludeToolNamesFilter("get_weather", "get_news")),
    mcp.WithMCPOptions(tmcp.WithSimpleRetry(3)),
)

// 3) SSE：HTTP 长连接，带自定义 Header、会话重连、精细重试
sseToolSet := mcp.NewMCPToolSet(
    mcp.ConnectionConfig{
        Transport: "sse",
        ServerURL: "http://localhost:8080/sse",
        Timeout:   10 * time.Second,
        Headers:   map[string]string{"User-Agent": "trpc-agent-go/1.0.0"},
    },
    mcp.WithToolFilterFunc(tool.NewIncludeToolNamesFilter("sse_recipe", "sse_health_tip")),
    mcp.WithSessionReconnect(3),
    mcp.WithMCPOptions(tmcp.WithRetry(tmcp.RetryConfig{
        MaxRetries: 5, InitialBackoff: 1 * time.Second,
        BackoffFactor: 1.5, MaxBackoff: 15 * time.Second,
    })),
)
```

> **每个 ToolSet 必须显式调用 `toolSet.Init(ctx)`** 建立 MCP 会话、枚举远端工具，否则 `Tools()` 返回空。

### 工具过滤：只暴露需要的工具

一个 MCP 服务端可能注册十几个工具，但当前 Agent 只关心其中两个。`WithToolFilterFunc(tool.NewIncludeToolNamesFilter("echo", "add"))` 用白名单按名字过滤，避免无关工具污染 Agent 上下文、节省 token、提升决策准确度。

## 代码解析

### 整体结构

主程序用 `multiTurnChat` 结构体持有 Runner 与三个 MCP ToolSet（供退出时 `Close()`）：

```go
type multiTurnChat struct {
    modelName  string
    runner     runner.Runner
    userID     string
    sessionID  string
    mcpToolSet []*mcp.ToolSet
}
```

生命周期：`run()` → `setup()`（创建并 Init 所有 ToolSet）→ `startChat()`（读 stdin 循环）→ 退出时 `toolSet.Close()`。

### 流式响应 + 工具调用可视化

`processStreamingResponse` 处理三类事件——**工具调用发起**、**工具响应**、**普通文本流**：

```go
for event := range eventChan {
    // 1) 工具调用发起
    if len(event.Response.Choices[0].Message.ToolCalls) > 0 {
        fmt.Printf("🔧 CallableTool calls initiated:\n")
        for _, tc := range event.Response.Choices[0].Message.ToolCalls {
            fmt.Printf("   • %s (ID: %s)\n     Args: %s\n",
                tc.Function.Name, tc.ID, tc.Function.Arguments)
        }
    }
    // 2) 工具响应
    if choice.Message.Role == model.RoleTool && choice.Message.ToolID != "" {
        fmt.Printf("✅ Tool response (ID: %s): %s\n", ...)
    }
    // 3) 文本流
    if choice.Delta.Content != "" {
        fmt.Print(choice.Delta.Content)
    }
}
```

这段代码是排查 MCP 工具是否被正确调用、参数是否正确、响应是否符合预期的关键调试样板。

### Function Tool 的结构体推导

`calculator` 工具的参数 schema 由 Go 结构体 tag 自动推导：

```go
type calculatorArgs struct {
    Operation string  `json:"operation" description:"The operation to perform"`
    A         float64 `json:"a" description:"First number"`
    B         float64 `json:"b" description:"Second number"`
}
```

`function.NewFunctionTool(c.calculate, ...)` 会把这个结构体转成 JSON Schema 暴露给 LLM。

## 运行方式

### 前置启动

主程序需要先把两个 HTTP 类 MCP 服务端起来（STDIO 子进程会由主程序自动拉起）：

```bash
# Terminal 1: Streamable HTTP 服务（:3000）
cd examples/mcptool/streamalbeserver && go run main.go

# Terminal 2: SSE 服务（:8080）
cd examples/mcptool/sseserver && go run main.go
```

### 运行主程序

```bash
# Terminal 3
export OPENAI_API_KEY="your-api-key"
cd examples/mcptool
go run main.go                              # 默认 deepseek-v4-flash
go run main.go -model gpt-4o                # 换模型
```

### 环境变量

| 变量 | 必需 | 说明 | 默认值 |
|------|------|------|--------|
| `OPENAI_API_KEY` | 是 | 模型 API Key | — |
| `OPENAI_BASE_URL` | 否 | 模型端点 | `https://api.openai.com/v1` |

### 命令行参数

| 参数 | 说明 | 默认值 |
|------|------|--------|
| `-model` | 模型名 | `deepseek-v4-flash` |

### 预期输出

```
🚀 MCP tools usage (STDIO, Streamable HTTP, and SSE)
Available tools: calculator, current_time, echo, add, get_weather, get_news, sse_echo, sse_info
==================================================
STDIO MCP Toolset initialized successfully
Streamable MCP Toolset initialized successfully
✅ Chat ready! Session: chat-session-1751367391

👤 You: What's the weather in Shenzhen?
🤖 Assistant: 🔧 CallableTool calls initiated:
   • get_weather (ID: call_0_d2b56dbb...)
     Args: {"location":"Shenzhen"}
✅ Tool response (ID: ...): {"text":"Weather for Shenzhen: 22°C, Sunny..."}
🤖 Assistant: The current weather in Shenzhen is 22°C and Sunny.
```

交互命令：直接输入文本对话；输入 `exit` 退出。

## 适用场景与对比

| 维度 | 本主程序（综合） | 单 sub 示例 |
|------|------------------|-------------|
| 学习目标 | 客户端集成、多协议混用 | 单一传输的服务端实现细节 |
| 启动复杂度 | 需起 2 个 HTTP 服务 | 单进程即可 |
| 适合复用 | ToolSet 接线、流式可视化样板 | Server 构造器、工具注册样板 |

**何时参考本主程序：**
- 需要在同一个 Agent 内组合多种工具来源
- 想看 ToolSet 的重试 / 重连 / 过滤如何配置
- 调试 MCP 工具调用链时复用流式可视化代码

**何时转去看子示例：**
- 要自己实现一个 MCP 服务端 → [`stdioserver`](./mcptool-stdioserver.md) / [`sseserver`](./mcptool-sseserver.md) / [`streamableserver`](./mcptool-streamableserver.md)
- 要在每个请求里注入动态 Header → [`http_headers`](./mcptool-httpheaders.md)

## 关键要点

1. **协议无关**：STDIO / SSE / Streamable HTTP 共用 `mcp.NewMCPToolSet`，只差 `Transport` 字段
2. **双轨注入**：`WithTools` 喂单个工具、`WithToolSets` 喂 MCP 连接，两者对 Agent 透明
3. **Init 必须显式调用**：每个 ToolSet 创建后要 `Init(ctx)`，否则工具列表为空
4. **过滤即节流**：`IncludeToolNamesFilter` 防止无关工具污染上下文
5. **可靠性分层**：HTTP 类传输可叠加 `WithSimpleRetry` / `WithRetry` / `WithSessionReconnect`，STDIO 不支持
6. **生命周期**：退出时记得 `toolSet.Close()`，否则子进程不退出、连接泄漏

## 总结

本主程序是 MCP 系列的"中枢"——理解了它，就理解了 trpc-agent-go 把三种传输统一成一个 ToolSet 接口的全部精华。接下来按需深入：想自己写 MCP 服务端，从最简单的 [`stdioserver`](./mcptool-stdioserver.md) 起步；想搞清楚 struct-first API 与 OutputSchema，看 [`streamableserver`](./mcptool-streamableserver.md)；想掌握 per-request 认证注入，看 [`http_headers`](./mcptool-httpheaders.md)。工具数量多到上下文爆炸时，再升级到 [MCP Broker](./mcpbroker.md)。
