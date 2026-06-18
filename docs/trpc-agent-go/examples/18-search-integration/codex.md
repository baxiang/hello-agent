# Codex CLI 集成 - 将 OpenAI Codex 作为 Agent 后端

## 概述

Codex 示例演示了如何使用 tRPC-Agent-Go 的 `agent/codex` 包将 OpenAI Codex CLI 工具作为 Agent 后端运行。与 Claude Code 示例类似，该方案将 Codex CLI 的代码生成和执行能力封装为标准 Agent 接口，并通过 Streamable HTTP MCP Server 扩展工具能力。适用于需要沙箱化代码执行环境的 AI 编程场景。

## 核心概念

### Codex Agent 适配器

`agent/codex` 包通过子进程调用 Codex CLI，支持线程（Thread）机制实现多轮对话。Codex 特有的配置包括：审批策略（approval-policy）、沙箱模式（sandbox）和工作目录（work-dir）。

### Streamable HTTP MCP Server

与 Claude Code 使用 STDIO MCP Server 不同，Codex 示例使用 Streamable HTTP MCP Server，通过 HTTP 端点提供工具服务。这种方式适合需要远程部署 MCP Server 的场景。

## 代码解析

### Agent 创建（agent.go）

通过 `codexSettings` 结构体统一管理配置项：

```go
type codexSettings struct {
    bin, model, mcpURL  string
    approvalPolicy      string
    sandbox, workDir    string
    logDir              string
}

func newCodexAgent(settings codexSettings) (agent.Agent, error) {
    opts := []codex.Option{codex.WithBin(settings.bin)}
    opts = appendRemoteMCPServer(opts, settings.mcpURL)
    // 设置审批策略、模型、沙箱模式等
    return codex.New(opts...)
}
```

### 远程 MCP Server 注入

通过 Codex CLI 的 `-c` 参数动态注入 MCP Server 配置，无需修改 Codex 配置文件：

```go
func appendRemoteMCPServer(opts []codex.Option, mcpURL string) []codex.Option {
    return append(opts, codex.WithGlobalArgs(
        "-c", fmt.Sprintf("mcp_servers.codex_cli_example.url=%q", mcpURL),
        "-c", `mcp_servers.codex_cli_example.default_tools_approval_mode="approve"`,
    ))
}
```

### 线程状态追踪

Codex 使用 Thread ID 管理对话上下文，通过 `StateDelta` 事件追踪状态变化：

```go
func printThreadState(evt *event.Event) {
    if evt.StateDelta == nil { return }
    threadID := string(evt.StateDelta[codex.StateKeyThreadID])
    fmt.Printf("Thread state: %s=%s\n", codex.StateKeyThreadID, threadID)
}
```

### HTTP MCP Server（mcpserver/）

基于 `trpc-mcp-go` 实现的 HTTP MCP Server：

```go
server := mcp.NewServer(
    "codex-cli-example-calculator", "1.0.0",
    mcp.WithServerAddress(*addr),
    mcp.WithServerPath("/mcp"),
)
server.RegisterTool(mcp.NewTool(calculatorToolName, ...), handleCalculator)
```

与 Claude Code 的 STDIO Server 对比，HTTP Server 支持独立部署和远程访问。

## 运行方式

**环境准备**：

1. 安装 Codex CLI
2. 启动 MCP Server：

```bash
go run ./examples/codex/mcpserver/ --addr :3002
```

**运行命令**：

```bash
go run ./examples/codex/ \
    --codex-bin codex \
    --mcp-url "http://localhost:3002/mcp" \
    --approval-policy never \
    --sandbox workspace-write
```

**交互示例**：

```
You: Calculate 100 / 7
🔧 Tool call: calculator args={"operation":"divide","a":100,"b":7}
✅ Tool result: calculator content={"result":14.285714}
Thread state: codex_thread_id=thread_abc123
Assistant: 100 / 7 ≈ 14.29
```

## 总结

Codex 示例与 Claude Code 示例采用相同的架构模式（CLI 适配器 + MCP Server），但在实现细节上体现了不同 CLI 工具的特性差异：Codex 支持线程状态、审批策略和沙箱模式，MCP Server 使用 HTTP 而非 STDIO。这种对比清晰展示了框架适配器模式的灵活性。
