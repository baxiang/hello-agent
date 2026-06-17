# 回调系统 - 通过 Agent/Model/Tool 三级回调实现运行时观测与控制

## 概述

tRPC-Agent-Go 提供了三级回调机制（AgentCallbacks、ModelCallbacks、ToolCallbacks），允许开发者在 Agent 执行、模型推理和工具调用的前后插入自定义逻辑。该机制广泛应用于日志记录、性能监控、参数修改、结果拦截等场景。

## 核心概念

回调系统由三个层级组成，每个层级都包含 Before 和 After 两个钩子：

- **AgentCallbacks**：Agent 执行级别。`BeforeAgent` 在 Agent 开始处理前触发，`AfterAgent` 在 Agent 完成后触发。可获取 `Invocation` 对象，包含 Agent 名称、调用 ID 和用户消息。
- **ModelCallbacks**：模型推理级别。`BeforeModel` 在 LLM 请求发送前触发，可拦截请求并返回自定义响应；`AfterModel` 在 LLM 响应返回后触发，可覆盖响应内容。
- **ToolCallbacks**：工具调用级别。`BeforeTool` 在工具执行前触发，可修改参数或返回自定义结果；`AfterTool` 在工具执行后触发，可格式化或替换工具结果。

每个回调函数都通过 `context.Context` 传递调用上下文，可通过 `agent.InvocationFromContext(ctx)` 获取当前调用信息。

## 代码解析

### 注册回调

```go
modelCallbacks := model.NewCallbacks()
modelCallbacks.RegisterBeforeModel(beforeModelFn)
modelCallbacks.RegisterAfterModel(afterModelFn)

toolCallbacks := tool.NewCallbacks()
toolCallbacks.RegisterBeforeTool(beforeToolFn)
toolCallbacks.RegisterAfterTool(afterToolFn)

agentCallbacks := agent.NewCallbacks()
agentCallbacks.RegisterBeforeAgent(beforeAgentFn)
agentCallbacks.RegisterAfterAgent(afterAgentFn)

llmAgent := llmagent.New("chat-assistant",
    llmagent.WithAgentCallbacks(agentCallbacks),
    llmagent.WithModelCallbacks(modelCallbacks),
    llmagent.WithToolCallbacks(toolCallbacks),
    // ...
)
```

### BeforeModel：拦截请求并返回自定义响应

```go
func createBeforeModelCallback() model.BeforeModelCallbackStructured {
    return func(ctx context.Context, args *model.BeforeModelArgs) (*model.BeforeModelResult, error) {
        userMsg := args.Request.Messages[len(args.Request.Messages)-1].Content
        if strings.Contains(userMsg, "custom model") {
            return &model.BeforeModelResult{
                CustomResponse: &model.Response{
                    Choices: []model.Choice{{
                        Message: model.Message{
                            Role:    model.RoleAssistant,
                            Content: "[Custom response from callback]",
                        },
                    }},
                },
            }, nil
        }
        return nil, nil // 返回 nil 继续正常流程
    }
}
```

返回 `BeforeModelResult.CustomResponse` 时，框架跳过实际的 LLM 调用，直接使用回调提供的响应。返回 `nil` 则继续正常流程。

### BeforeTool：修改工具参数或返回自定义结果

```go
func createBeforeToolCallback() tool.BeforeToolCallbackStructured {
    return func(ctx context.Context, args *tool.BeforeToolArgs) (*tool.BeforeToolResult, error) {
        // 参数标准化：将 operation 转小写
        if args.ToolName == "calculator" {
            var calcArgs calculatorArgs
            json.Unmarshal(args.Arguments, &calcArgs)
            calcArgs.Operation = strings.ToLower(calcArgs.Operation)
            modifiedArgs, _ := json.Marshal(calcArgs)
            args.Arguments = modifiedArgs
            return &tool.BeforeToolResult{ModifiedArguments: modifiedArgs}, nil
        }
        // 特殊值拦截：参数包含 42 时返回自定义结果
        if strings.Contains(string(args.Arguments), "42") {
            return &tool.BeforeToolResult{
                CustomResult: calculatorResult{Operation: "custom", Result: 4242},
            }, nil
        }
        return nil, nil
    }
}
```

`BeforeToolResult` 支持两种干预方式：`ModifiedArguments` 修改传入参数后继续执行工具；`CustomResult` 直接跳过工具执行。

### 结合 OpenTelemetry 的计时回调

`callbacks/timer` 子示例展示了将回调与 OpenTelemetry 结合的实战模式：

```go
func (e *toolTimerExample) createBeforeToolCallback() tool.BeforeToolCallbackStructured {
    return func(ctx context.Context, args *tool.BeforeToolArgs) (*tool.BeforeToolResult, error) {
        inv, _ := agent.InvocationFromContext(ctx)
        startTime := time.Now()
        key := fmt.Sprintf("tool:%s:%s:start_time", args.ToolName, args.ToolCallID)
        inv.SetState(key, startTime)

        _, span := atrace.Tracer.Start(ctx, "tool_execution",
            trace.WithAttributes(
                attribute.String("tool.name", args.ToolName),
                attribute.String("tool.call_id", args.ToolCallID),
            ),
        )
        inv.SetState(fmt.Sprintf("tool:%s:%s:span", args.ToolName, args.ToolCallID), span)
        return nil, nil
    }
}
```

通过 `Invocation.SetState/GetState` 在 Before 和 After 回调之间传递临时状态（如开始时间和 Span 对象）。该机制支持并发安全，`ToolCallID` 确保多个并行工具调用不会互相干扰。

After 回调中计算耗时并上报到 OpenTelemetry Metrics：

```go
e.toolDurationHistogram.Record(ctx, durationSeconds,
    metric.WithAttributes(attribute.String("tool.name", args.ToolName)),
)
e.toolCounter.Add(ctx, 1,
    metric.WithAttributes(attribute.String("tool.name", args.ToolName)),
)
span.End()
```

## 运行方式

```bash
export OPENAI_API_KEY="sk-..."

# 基础回调示例
cd examples/callbacks
go run main.go -model deepseek-v4-flash

# 带 OpenTelemetry 计时的回调示例（需先启动 Collector）
cd examples/callbacks/timer
go run main.go -model deepseek-v4-flash
```

交互时输入 "custom model" 触发 BeforeModel 拦截，输入包含 42 的计算触发 BeforeTool 拦截。

预期输出：

```
BeforeAgentCallback: agent=chat-assistant, invocationID=xxx
BeforeModelCallback: model=deepseek-v4-flash, lastUserMsg="calculate 2+3"
BeforeToolCallback: tool=calculator, args={"operation":"add","a":2,"b":3}
AfterToolCallback: tool=calculator, result={...}
AfterModelCallback: model=deepseek-v4-flash has finished
AfterAgentCallback: agent=chat-assistant, completed
```

## 总结

回调系统是 tRPC-Agent-Go 可观测性和可控性的基石，关键收获：

- **三级粒度**：Agent/Model/Tool 三层回调覆盖了 Agent 执行的全链路
- **双向干预**：Before 回调可修改输入或跳过执行，After 回调可修改输出
- **状态传递**：`Invocation.SetState/GetState` 提供了在 Before/After 之间传递状态的安全机制
- **Context 驱动**：通过 `InvocationFromContext` 在任意回调中获取完整的调用上下文

回调系统与 Telemetry 和 TokenTracker 互为补充：Callbacks 提供应用层的精细控制钩子，Telemetry 提供平台级的链路追踪，TokenTracker 专注于 Token 维度的成本观测。
