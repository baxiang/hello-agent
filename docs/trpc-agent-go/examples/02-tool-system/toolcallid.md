# 工具调用 ID 插件 - 统一追踪工具调用的全生命周期

## 概述

`toolcallid` 示例演示如何使用 `toolcallid` 插件为每次工具调用分配一个框架管理的唯一 ID，并在工具执行上下文和 Runner 事件流中保持一致。这对于日志追踪、审计和调试 Agent 的工具调用链路非常有用。

## 核心概念

在默认情况下，工具调用 ID 由 LLM 提供商生成（如 OpenAI 的 `call_xxx`）。`toolcallid` 插件会将其重写为框架管理的规范化 ID，确保在以下三个阶段保持一致：

1. **事件流中的 tool_call**：LLM 发起工具调用时的事件
2. **工具执行上下文**：工具函数内部通过 `tool.ToolCallIDFromContext(ctx)` 获取
3. **事件流中的 tool_result**：工具执行完成返回结果时的事件

## 代码解析

### 注册插件

插件通过 `runner.WithPlugins` 注册，只需一行代码：

```go
run := runner.NewRunner(
    appName,
    ag,
    runner.WithPlugins(toolcallid.New()),
)
```

### 在工具内获取调用 ID

工具执行函数中，通过 context 获取当前调用的 ID：

```go
func calculate(ctx context.Context, args calculatorArgs) (calculatorResult, error) {
    callID, _ := tool.ToolCallIDFromContext(ctx)
    fmt.Printf("[tool] call_id=%s\n", callID)
    // ... 业务逻辑
}
```

### 事件流中观察 ID

事件流处理代码中，可以从不同阶段提取相同的 ID：

```go
// 工具调用事件
if evt.IsToolCallResponse() {
    for _, toolCall := range choice.Message.ToolCalls {
        fmt.Printf("[event] tool_call call_id=%s\n", toolCall.ID)
    }
}

// 工具结果事件
if evt.IsToolResultResponse() {
    fmt.Printf("[event] tool_result call_id=%s\n", choice.Message.ToolID)
}
```

### 预期输出

运行后可以看到相同的 call_id 贯穿整个调用链路：

```
[event] tool_call tool=calculator call_id=abc123 args={"operation":"multiply","a":17,"b":23}
[tool]  tool=calculator call_id=abc123 operation=multiply a=17 b=23
[event] tool_result call_id=abc123 result={"result":391}
```

## 运行方式

```bash
cd examples/toolcallid
export OPENAI_API_KEY="your-key"
go run .

# 自定义提示词
go run . -prompt "Calculate 100 + 200"

# 启用流式模式
go run . -streaming=true
```

## 总结

- `toolcallid` 插件是一个轻量级的横切关注点，通过 `runner.WithPlugins` 即插即用
- 它为工具调用提供了端到端的 ID 追踪能力，无需修改工具代码即可集成
- `tool.ToolCallIDFromContext(ctx)` 是工具内部获取调用 ID 的标准 API
- 该插件适合与日志系统、监控系统结合，构建可观测的 Agent 应用
