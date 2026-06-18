# Claude Code CLI 集成 - 将 Claude Code 作为 Agent 后端

## 概述

Claude Code 示例演示了如何使用 tRPC-Agent-Go 的 `agent/claudecode` 包将 Claude Code CLI 工具作为 Agent 后端运行。该集成方案将 Claude Code 的代码理解、文件操作和终端交互能力封装为标准 Agent 接口，同时支持通过 MCP Server 扩展工具能力。适用于构建 AI 编程助手、代码审查系统等场景。

## 核心概念

### CLI Agent 适配器

`agent/claudecode` 包通过调用 Claude Code CLI 的可执行文件与其交互，支持两种输出格式：`json`（完整 transcript）和 `stream-json`（流式 transcript）。CLI Agent 与 LLM Agent 的区别在于：不直接调用 LLM API，而是委托给外部 CLI 工具处理。

### MCP Server 扩展

示例包含一个 STDIO MCP Server（`mcpserver/`），通过 `.mcp.json` 配置文件注册到 Claude Code。MCP Server 提供了计算器工具，展示了如何通过 MCP 协议扩展 CLI Agent 的能力。

## 代码解析

### Agent 创建（agent.go）

通过选项模式配置 Claude Code CLI：

```go
func newClaudeAgent(bin, outputFormat, logDir string) (agent.Agent, error) {
    opts := []claudecode.Option{
        claudecode.WithBin(strings.TrimSpace(bin)),
        claudecode.WithOutputFormat(claudecode.OutputFormat(outputFormat)),
        claudecode.WithExtraArgs("--permission-mode", "bypassPermissions"),
    }
    if logDir != "" {
        opts = append(opts, claudecode.WithRawOutputHook(newLogHook(logDir)))
    }
    return claudecode.New(opts...)
}
```

`WithRawOutputHook` 注册原始输出钩子，将 CLI 的 stdout/stderr 持久化到日志文件，便于调试。

### 日志钩子实现

日志钩子按 CLI Session ID 分文件存储，记录每次调用的完整上下文：

```go
func newLogHook(outDir string) claudecode.RawOutputHook {
    return func(_ context.Context, args *claudecode.RawOutputHookArgs) error {
        // 按 CLI Session ID 创建日志文件
        // 记录 invocation_id、prompt、stdout、stderr、error
    }
}
```

### 事件处理（main.go）

处理三种特殊事件类型：

```go
func printToolEvents(evt *event.Event) {
    // 1. Transfer 事件：Agent 之间的控制转移
    if evt.Object == model.ObjectTypeTransfer {
        fmt.Printf("Transfer: %s\n", evt.Choices[0].Message.Content)
    }
    // 2. 工具调用事件
    if evt.IsToolCallResponse() { ... }
    // 3. 工具结果事件
    if evt.IsToolResultResponse() { ... }
}
```

### MCP Server（mcpserver/）

基于 `trpc-mcp-go` 实现的 STDIO MCP Server，提供计算器工具：

```go
server := mcp.NewStdioServer("cli-example-calculator", "1.0.0")
server.RegisterTool(
    mcp.NewTool(calculatorToolName,
        mcp.WithDescription("Perform arithmetic operations..."),
        mcp.WithString("operation", mcp.Required(), ...),
        mcp.WithNumber("a", mcp.Required(), ...),
        mcp.WithNumber("b", mcp.Required(), ...),
    ),
    handleCalculator,
)
```

## 运行方式

**环境准备**：

1. 安装 Claude Code CLI：`npm install -g @anthropic-ai/claude-code`
2. 确保 `claude` 命令可用

**运行命令**：

```bash
go run ./examples/claudecode/ --claude-bin claude --output-format json
```

**交互示例**：

```
You: Calculate 42 * 17
Tool call: calculator args={"operation":"multiply","a":42,"b":17}
Tool result: calculator content={"result":714}
Assistant: 42 * 17 = 714
```

## 总结

Claude Code 示例展示了框架对 CLI 工具的适配能力，将外部 AI 编程工具的全部能力引入到 Agent 系统中。通过 MCP Server 可进一步扩展工具集。该方案与 `codex` 示例形成对照——两者采用相同的架构模式，但对接不同的 CLI 工具，体现了适配器模式的复用价值。
