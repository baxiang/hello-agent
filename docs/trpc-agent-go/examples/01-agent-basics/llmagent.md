# LLMAgent 示例 - 使用内置 Agent 实现快速构建交互式对话

## 概述

本示例演示如何使用框架内置的 `LLMAgent` 实现，快速搭建一个支持流式响应的多轮交互式对话应用。`LLMAgent` 是 `agent.Agent` 接口的标准实现，封装了 LLM 调用的完整流程，适合需要快速上手、不需要复杂定制的场景。

## 核心概念

### LLMAgent

`LLMAgent` 是 tRPC-Agent-Go 框架提供的开箱即用的 Agent 实现，内部基于 `llmflow` 包处理执行流程。它通过 functional options 模式配置，支持以下核心选项：

- **WithModel**: 指定底层模型实例（如 OpenAI 兼容模型）
- **WithInstruction**: 设置 Agent 的行为指令（System Prompt）
- **WithDescription**: Agent 描述信息
- **WithGenerationConfig**: 控制生成参数（温度、最大 Token 数、是否流式等）

### Runner

`Runner` 是框架的执行调度器，负责管理 Agent 的生命周期、会话状态和事件分发。通过 `runner.NewRunner(appName, agent)` 创建，调用 `Run()` 方法驱动 Agent 执行并返回事件通道。

### Event 事件机制

Agent 的输出通过 `<-chan *event.Event` 事件通道返回。每个事件包含：
- `Response.Choices`: LLM 的响应内容
- `Delta.Content`: 流式模式下的增量文本
- `Message.Content`: 非流式模式下的完整文本
- `Done`: 标记是否为最终事件
- `Error`: 错误信息

## 代码解析

**1. 创建模型实例**

```go
modelInstance := openai.New(c.modelName)
```

使用 `model/openai` 包创建兼容 OpenAI API 的模型实例。SDK 自动读取 `OPENAI_API_KEY` 和 `OPENAI_BASE_URL` 环境变量。

**2. 配置并创建 LLMAgent**

```go
llmAgent := llmagent.New(
    "demo-llm-agent",
    llmagent.WithModel(modelInstance),
    llmagent.WithDescription("A helpful AI assistant"),
    llmagent.WithInstruction("You are a helpful AI assistant..."),
    llmagent.WithGenerationConfig(genConfig),
)
```

通过 functional options 模式组装 Agent，`GenerationConfig` 控制温度 (0.7)、最大 Token (1000) 和流式模式。

**3. 创建 Runner 并执行**

```go
c.runner = runner.NewRunner(appName, llmAgent)
// ...
eventChan, err := c.runner.Run(ctx, c.userID, c.sessionID, message)
```

Runner 接收用户消息后，驱动 Agent 执行并返回事件通道。

**4. 消费事件流**

```go
for event := range eventChan {
    if event.Error != nil { /* 处理错误 */ }
    if c.streaming {
        content = choice.Delta.Content   // 流式：增量内容
    } else {
        content = choice.Message.Content // 非流式：完整内容
    }
}
```

根据模式选择读取 `Delta`（流式增量）或 `Message`（完整响应）。

## 运行方式

**环境准备：**

```bash
export OPENAI_API_KEY="your-api-key"
export OPENAI_BASE_URL="https://api.deepseek.com/v1"  # 可选
```

**运行命令：**

```bash
cd examples/llmagent
go run .                      # 默认流式模式
go run . -model gpt-4o        # 指定模型
go run . -streaming=false     # 非流式模式
```

**预期输出：**

```
🚀 Interactive Chat with LLMAgent
Model: deepseek-v4-flash
Streaming: true
✅ Chat ready!

👤 You: Hello!
🤖 Assistant: Hello! How can I help you today?
```

## 总结

本示例是 tRPC-Agent-Go 最简单的入门示例，展示了 **LLMAgent + Runner + Event** 三个核心组件的基本用法。掌握这三个概念后，可以进一步学习：

- **customagent** 示例：了解如何自定义实现 `agent.Agent` 接口
- **runner** 示例：了解如何集成工具调用和会话管理
- **debugagent** 示例：了解如何为 Agent 添加文件操作工具和代码执行能力
