# RalphLoop 示例 - 迭代式任务循环直到完成承诺

## 概述

本示例演示 `RalphLoop` 模式——一种防止 LLM 过早停止的迭代机制。当 Agent 处理复杂任务时，LLM 可能在任务未完成时就认为自己"完成了"。RalphLoop 通过检测输出中的"完成承诺"标记（如 `<promise>DONE</promise>`），强制 Agent 继续迭代直到明确表示完成。

## 核心概念

### RalphLoop 模式

RalphLoop 的工作原理：

1. Agent 生成一轮响应
2. Runner 检查响应中是否包含完成承诺标记
3. 如果未包含 → 自动触发下一轮迭代
4. 如果包含 → 停止循环，返回最终结果
5. 安全阀：达到 `MaxIterations` 上限时强制停止

```
用户输入 → Agent 响应 → 检查承诺 → [未完成] → 继续迭代 → Agent 响应 → ...
                                    → [完成]   → 返回结果
```

### 配置参数

| 参数 | 说明 |
|------|------|
| `CompletionPromise` | 完成标记文本，Agent 输出 `<promise>标记</promise>` 表示完成 |
| `MaxIterations` | 最大迭代次数，安全上限 |
| `MaxLLMCalls` | 最大模型调用次数（含工具调用轮次），0 = 自动计算 |

### 与 MaxLLMCalls 的关系

`MaxLLMCalls` 控制单次用户消息处理中 LLM 的最大调用次数。在 RalphLoop 模式下，每次迭代至少调用一次 LLM，如果有工具调用可能更多。默认值为 `MaxIterations + 2`，留有余量。

## 代码解析

**1. 构造带 RalphLoop 的 Runner**

```go
llmAgent := llmagent.New(
    agentName,
    llmagent.WithModel(modelInstance),
    llmagent.WithInstruction(instruction),
    llmagent.WithGenerationConfig(genConfig),
    llmagent.WithMaxLLMCalls(callLimit),
)

c.runner = runner.NewRunner(
    appName,
    llmAgent,
    runner.WithRalphLoop(runner.RalphLoopConfig{
        MaxIterations:     c.maxIterations,    // 最多 10 轮
        CompletionPromise: c.completionPromise, // "DONE"
    }),
)
```

通过 `runner.WithRalphLoop` 在 Runner 层启用循环模式。Agent 的 Instruction 中也需要告知 LLM 何时输出完成标记。

**2. Instruction 中嵌入完成条件**

```go
instruction := fmt.Sprintf(
    "%s\n\nStop only when you output %s%s%s.",
    agentInstruction,
    promiseTagOpen,        // <promise>
    c.completionPromise,   // DONE
    promiseTagClose,       // </promise>
)
```

在 System Prompt 中明确告知 LLM：只有输出 `<promise>DONE</promise>` 才会被认为完成。

**3. 事件消费与终止判断**

```go
for evt := range eventChan {
    // 打印内容...
    if evt.IsFinalResponse() {
        finalSeen = true  // 单轮迭代结束
    }
    if evt.IsRunnerCompletion() {
        break             // 整个 RalphLoop 结束
    }
}
```

RalphLoop 模式下事件流更复杂：

- `IsFinalResponse()`: 单轮 LLM 响应结束（但循环可能继续）
- `IsRunnerCompletion()`: Runner 层面确认运行结束（循环已终止）

需要使用 `IsRunnerCompletion()` 而非 `IsFinalResponse()` 来判断最终退出。

## 运行方式

```bash
cd examples/ralphloop
export OPENAI_API_KEY="your-api-key"

# DeepSeek
go run . -model deepseek-v4-flash -variant deepseek

# OpenAI
go run . -model gpt-4o -variant openai

# 自定义参数
go run . -max-iterations 5 -completion-promise FINISHED
```

**示例交互：**

```
👤 You: Write a haiku about Go programming
🤖 Assistant: Binary streams compile,
Goroutines dance in channels,
Memory stays lean.

<promise>DONE</promise>
```

Agent 在输出完成后自行添加 `<promise>DONE</promise>` 标记，RalphLoop 检测到后停止迭代。

## 总结

RalphLoop 是 tRPC-Agent-Go 针对 **任务完成度控制** 的独特机制，核心收获：

- 通过 `CompletionPromise` 让 LLM 自主判断任务是否完成
- `MaxIterations` 作为安全阀防止无限循环
- 使用 `IsRunnerCompletion()` 而非 `IsFinalResponse()` 判断循环结束
- 适合多步骤任务、代码生成验证等需要确保完成度的场景

进阶使用：可以通过 `runner.RalphLoopConfig.Verifiers` 注入自定义验证器（如运行测试），实现客观的完成度验证。
