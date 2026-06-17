# MCP Tool 集成 - 多协议工具调用的统一抽象

## 概述

本示例演示了 tRPC-Agent-Go 框架如何统一集成三种 MCP（Model-Client-Protocol）传输协议的工具：STDIO、SSE（Server-Sent Events）和 Streamable HTTP。通过一个交互式多轮对话助手，展示了如何将本地函数工具与远程 MCP 工具无缝组合，构建功能丰富的 AI Agent。

## 核心概念

### MCP ToolSet

框架通过 `mcp.NewMCPToolSet` 提供了统一的 MCP 工具集抽象，开发者只需指定 `ConnectionConfig` 中的 `Transport` 字段即可切换不同协议：

- **STDIO**：通过标准输入/输出与本地子进程通信，适合本地工具服务
- **SSE**：基于 HTTP 的 Server-Sent Events，支持长连接和会话重连
- **Streamable HTTP**：基于 HTTP 的流式传输，适合远程服务调用

### 工具过滤

`mcp.WithToolFilterFunc` 允许按名称筛选 MCP 服务器暴露的工具，避免将不需要的工具注入 Agent 的上下文。

### 重试与会话重连

框架内置指数退避重试机制（`tmcp.WithSimpleRetry` / `tmcp.WithRetry`）和会话重连能力（`mcp.WithSessionReconnect`），增强网络工具的可靠性。

## 代码解析

### 1. 创建本地函数工具

```go
calculatorTool := function.NewFunctionTool(
    c.calculate,
    function.WithName("calculator"),
    function.WithDescription("Perform basic mathematical calculations"),
)
```

通过 `function.NewFunctionTool` 将普通 Go 函数包装为工具，框架自动从结构体 tag 推导参数 JSON Schema。

### 2. 配置 STDIO MCP 工具集

```go
stdioToolSet := mcp.NewMCPToolSet(
    mcp.ConnectionConfig{
        Transport: "stdio",
        Command:   "go",
        Args:      []string{"run", "./stdioserver/main.go"},
        Timeout:   10 * time.Second,
    },
    mcp.WithToolFilterFunc(tool.NewIncludeToolNamesFilter("echo", "add")),
)
```

STDIO 模式会启动一个子进程，框架通过标准输入/输出与之通信。`stdioserver/main.go` 使用 `mcp.NewStdioServer` 注册 echo 和 add 两个工具。

### 3. 配置 Streamable HTTP 工具集（含重试）

```go
streamableToolSet := mcp.NewMCPToolSet(
    mcp.ConnectionConfig{
        Transport: "streamable_http",
        ServerURL: "http://localhost:3000/mcp",
        Timeout:   10 * time.Second,
    },
    mcp.WithMCPOptions(tmcp.WithSimpleRetry(3)),
)
```

Streamable HTTP 服务端通过 `mcp.NewServer` 创建，支持结构化输入/输出（`mcp.WithInputStruct` / `mcp.WithOutputStruct`）。

### 4. 配置 SSE 工具集（含会话重连）

```go
sseToolSet := mcp.NewMCPToolSet(
    mcp.ConnectionConfig{
        Transport: "sse",
        ServerURL: "http://localhost:8080/sse",
        Headers:   map[string]string{"User-Agent": "trpc-agent-go/1.0.0"},
    },
    mcp.WithSessionReconnect(3),
    mcp.WithMCPOptions(tmcp.WithRetry(tmcp.RetryConfig{
        MaxRetries: 5, InitialBackoff: 1 * time.Second,
        BackoffFactor: 1.5, MaxBackoff: 15 * time.Second,
    })),
)
```

SSE 模式支持自定义 HTTP 头、自动会话重连和精细化的重试配置。

### 5. 组装 LLMAgent

```go
llmAgent := llmagent.New(agentName,
    llmagent.WithModel(modelInstance),
    llmagent.WithTools([]tool.Tool{calculatorTool, timeTool}),
    llmagent.WithToolSets([]tool.ToolSet{stdioToolSet, streamableToolSet, sseToolSet}),
)
```

通过 `WithTools` 注入本地函数工具，`WithToolSets` 注入 MCP 工具集，两者对 Agent 完全透明。

## 运行方式

```bash
# 1. 启动 Streamable HTTP 服务
cd examples/mcptool/streamalbeserver && go run main.go

# 2. 启动 SSE 服务
cd examples/mcptool/sseserver && go run main.go

# 3. 运行主程序（STDIO 子进程自动启动）
export OPENAI_API_KEY="your-key"
go run examples/mcptool/main.go -model deepseek-v4-flash
```

输入 "What is the weather in Shenzhen?" 可观察 Streamable HTTP 工具调用，输入 "echo hello" 触发 STDIO 工具。

## 总结

本示例的核心价值在于展示了 tRPC-Agent-Go 框架对 MCP 协议的完整抽象：无论底层传输是 STDIO、SSE 还是 HTTP，开发者使用统一的 `NewMCPToolSet` 接口即可接入。重试机制和会话重连为生产环境提供了必要的容错保障。下一篇 mcpbroker 示例将展示如何通过 Broker 模式实现按需发现和调用 MCP 工具，进一步降低 Agent 上下文的工具膨胀问题。
