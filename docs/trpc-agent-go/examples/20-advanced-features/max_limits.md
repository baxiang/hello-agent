# 调用限制 - 控制Agent的LLM调用次数和工具迭代次数

## 概述

在生产环境中，防止 Agent 进入无限循环或过度消耗资源至关重要。`max_limits` 示例演示了如何使用 `WithMaxLLMCalls` 和 `WithMaxToolIterations` 设置单次 Agent 调用的资源上限，当超出限制时框架会自动终止执行。

## 核心概念

trpc-agent-go 提供了两个维度的限制：

- **MaxLLMCalls**：单次 Agent 调用中最多允许的 LLM 请求次数。每次调用模型 API 计数一次，包括工具调用后的重新请求。
- **MaxToolIterations**：单次 Agent 调用中最多允许的工具迭代轮次。每完成一轮"模型请求→工具调用→工具返回"的循环计数一次。

当任一限制触发时，框架会发出一个带错误信息的事件，告知调用方执行因超限而终止。

## 代码解析

**配置限制参数：**

```go
llmAgent := llmagent.New(
    "limits-demo-agent",
    llmagent.WithModel(modelInstance),
    llmagent.WithInstruction(
        "You are a math assistant that MUST NOT do any arithmetic in your head. "+
        "All arithmetic must go through the `calculator` tool..."),
    llmagent.WithTools([]tool.Tool{calculatorTool}),
    llmagent.WithMaxLLMCalls(5),
    llmagent.WithMaxToolIterations(2),
)
```

示例设计了一个精巧的测试场景：让 Agent 计算 `2^8`，要求每步只做一次乘法并必须使用 `calculator` 工具。完成 2^8 需要 8 次乘法迭代，但 `MaxToolIterations` 限制为 2，因此 Agent 会在第 2 次工具迭代后被终止。

**事件处理中捕获错误：**

```go
for evt := range eventChan {
    printEvent(evt)
    if evt.IsFinalResponse() {
        break
    }
}

func printEvent(evt *event.Event) {
    if evt.Error != nil {
        fmt.Printf("❌ Error event: type=%s message=%s\n",
            evt.Error.Type, evt.Error.Message)
        return
    }
    // ...
}
```

## 运行方式

```bash
cd examples

export OPENAI_API_KEY="your-key"

go run ./max_limits
```

预期输出会显示 Agent 成功执行前 2 轮工具调用，然后因超出 `MaxToolIterations` 限制而终止，并输出错误信息。

## 总结

调用限制是生产环境中的安全护栏。合理设置限制可以防止异常情况下的资源浪费，同时在错误事件中提供清晰的终止原因。建议根据实际业务场景调整限制值——简单问答可设置较小值，复杂多步任务需要适当放宽。此功能与 `plugin` 示例中的自定义拦截逻辑互补，共同构成 Agent 的安全控制体系。
