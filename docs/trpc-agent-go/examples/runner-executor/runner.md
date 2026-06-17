# Runner 示例 - 带工具调用和会话管理的多轮对话

## 概述

本示例展示了 `Runner` 组件的核心能力：多轮对话上下文保持、自定义 Function Tool 集成、流式/非流式响应切换，以及内存会话后端的使用。这是一个比 `llmagent` 更完整的实战示例，涵盖了构建对话式 AI 应用的关键要素。

## 核心概念

### Function Tool

`function.NewFunctionTool` 允许将普通 Go 函数注册为 Agent 可调用的工具。框架通过结构体 tag 自动生成 JSON Schema，LLM 根据 Schema 决定何时调用工具以及传递什么参数。

```go
type calculatorArgs struct {
    Operation string  `json:"operation" jsonschema:"description=The operation to perform,enum=add,..."`
    A         float64 `json:"a" jsonschema:"description=First number"`
    B         float64 `json:"b" jsonschema:"description=Second number"`
}
```

`jsonschema` tag 提供工具参数的描述和约束，帮助 LLM 正确生成调用参数。

### SessionService 会话服务

`session/inmemory.NewSessionService()` 提供内存级会话存储，Runner 通过它在多轮对话中保持上下文。生产环境可替换为 Redis、PostgreSQL 等持久化后端。

### 并行工具执行

`WithEnableParallelTools(true)` 启用后，当 LLM 在单次响应中发起多个工具调用时，框架会使用 goroutine 并发执行，提升响应速度。

## 代码解析

**1. 定义 Function Tool**

```go
calculatorTool := function.NewFunctionTool(
    c.calculate,                    // Go 函数
    function.WithName("calculator"),
    function.WithDescription("Perform basic mathematical calculations"),
)
```

`c.calculate` 方法签名为 `func(ctx context.Context, args calculatorArgs) (calculatorResult, error)`。框架自动处理 JSON 序列化/反序列化。

**2. 配置 Runner 和 Session**

```go
sessionService := sessioninmemory.NewSessionService()

c.runner = runner.NewRunner(
    appName,
    llmAgent,
    runner.WithSessionService(sessionService),
)
```

通过 `runner.WithSessionService` 注入会话服务，Runner 自动在每轮对话后将消息持久化到 Session。

**3. 使用 RequestID**

```go
requestID := uuid.New().String()
eventChan, err := c.runner.Run(ctx, c.userID, c.sessionID, message,
    agent.WithRequestID(requestID),
)
```

`agent.WithRequestID` 为每次执行分配唯一标识，便于追踪和管理（如在 ManagedRunner 中按 ID 取消执行）。

**4. 处理工具调用事件**

事件流中会依次出现三类事件：
- **工具调用请求**：`Message.ToolCalls` 非空，包含工具名和参数
- **工具执行结果**：`Message.Role == model.RoleTool`，包含执行结果
- **最终响应**：Agent 综合工具结果生成的自然语言回复

```go
// 检测工具调用
if len(evt.Response.Choices[0].Message.ToolCalls) > 0 { ... }
// 检测工具结果
if choice.Message.Role == model.RoleTool { ... }
// 检测最终响应
if evt.IsFinalResponse() { break }
```

## 运行方式

```bash
cd examples/runner
export OPENAI_API_KEY="your-api-key"

go run .                                # 默认流式 + 串行工具
go run . -streaming=false               # 非流式模式
go run . -enable-parallel=true          # 并行工具执行
go run . -model gpt-4o -variant openai  # 指定模型和变体
```

**示例交互：**

```
👤 You: What's 25 times 4?
🔧 Tool calls initiated:
   • calculator (ID: call_abc123)
     Args: {"operation":"multiply","a":25,"b":4}
🔄 Executing tools...
✅ Tool response: {"result":100}
🤖 Assistant: 25 × 4 = 100
```

## 总结

本示例是 tRPC-Agent-Go 最核心的实战示例，完整展示了 **Runner + Agent + Tool + Session** 的协作模式：

- 使用 `function.NewFunctionTool` 注册自定义工具
- 使用 `SessionService` 实现多轮对话上下文保持
- 通过 `RequestID` 追踪每次执行
- 使用 `IsFinalResponse()` 判断响应结束

进阶学习可关注 **managedrunner**（运行控制）和 **runwithmessages**（外部消息注入）示例。
