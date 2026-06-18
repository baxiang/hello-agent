# ReAct规划 - 让Agent按照思考-行动-观察循环解决问题

## 概述

`react` 示例演示了如何使用 ReAct（Reasoning + Acting）规划器，让 Agent 按照"思考→行动→观察"的循环结构化地解决复杂问题。ReAct 模式通过在系统提示中注入规划指令，引导模型将复杂任务分解为可执行的步骤。

## 核心概念

**ReAct 规划器** 是 trpc-agent-go 提供的内置规划器之一。它在 Agent 的 Instruction 中注入结构化的推理指导，要求模型按以下模式工作：

1. **Thought（思考）**：分析当前问题，确定需要什么信息
2. **Action（行动）**：调用合适的工具获取信息
3. **Observation（观察）**：分析工具返回的结果
4. 重复以上步骤，直到获得足够信息给出最终答案

使用方式非常简单：

```go
reactPlanner := react.New()
llmagent.WithPlanner(reactPlanner)
```

## 代码解析

**Agent 配置：**

```go
reactPlanner := react.New()

llmAgent := llmagent.New(
    agentName,
    llmagent.WithModel(modelInstance),
    llmagent.WithInstruction("You are a helpful research assistant. "+
        "Use the React planning approach to break down complex questions."),
    llmagent.WithTools([]tool.Tool{searchTool, calculatorTool, weatherTool}),
    llmagent.WithPlanner(reactPlanner),
)
```

示例提供了三个模拟工具：
- `search` - 搜索信息（内置了东京、纽约等城市的模拟数据）
- `calculator` - 数学计算（支持加减乘除和幂运算）
- `get_weather` - 获取天气信息

流式响应处理 `processStreamingResponse` 可以区分展示工具调用、工具结果和 Agent 的思考/回答内容。

## 运行方式

```bash
cd examples

export OPENAI_API_KEY="your-key"

go run ./react -model=deepseek-v4-flash
```

启动后尝试以下复杂问题：
- "东京和纽约的人口分别是多少？哪个更大？"
- "投资1000美元，年利率5%，10年后值多少？"
- "巴黎天气怎么样？需要带伞吗？"

模型会先思考需要什么信息，然后调用工具，最后综合回答。

## 总结

ReAct 规划器让 Agent 的推理过程透明化和结构化。对于需要多步推理、多次工具调用的复杂任务，ReAct 比简单的单次回答更可靠。与 `thinking` 示例中的内部推理不同，ReAct 的"思考"是通过提示工程在输出中显式体现的，更适合需要可审计推理链的场景。
