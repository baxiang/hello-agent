# 推理思考模式 - 展示模型的推理链(Reasoning)能力

## 概述

`thinking` 示例演示了如何在 trpc-agent-go 中启用模型的推理/思考模式（Reasoning Mode），让模型在生成最终回答前先输出推理过程。该示例支持流式输出，可以实时展示推理内容和正式回答，并提供工具调用能力。

## 核心概念

**推理模式**（Thinking/Reasoning Mode）允许模型在回答前进行"思考"，输出一段内部推理过程。这对于复杂问题（数学计算、逻辑推理等）特别有用。框架通过 `GenerationConfig` 中的以下字段控制：

- `ThinkingEnabled` - 是否启用推理模式
- `ThinkingTokens` - 推理部分的最大 Token 数

推理内容的历史管理通过 `WithReasoningContentMode` 配置：
- `keep_all` - 保留所有历史推理内容
- `discard_previous` - 仅保留最近一轮的推理内容（推荐，节省 Token）
- `discard_all` - 完全丢弃所有推理内容

## 代码解析

**启用推理模式配置：**

```go
genConfig := model.GenerationConfig{
    Stream:          c.streaming,
    ThinkingEnabled: thinkingEnabled,
    ThinkingTokens:  thinkingTokens,
}
agentOpts = append(agentOpts, llmagent.WithReasoningContentMode(resolveReasoningMode()))
```

**流式输出中区分推理和正式内容：**

```go
if rc := ch.Delta.ReasoningContent; rc != "" {
    fmt.Printf("\x1b[2m%s\x1b[0m", rc)  // 暗淡样式显示推理
    printedReasoning = true
}
content := c.extractContent(ch)
if content != "" {
    if c.streaming && printedReasoning && !reasoningClosed {
        fmt.Print("\n\n")  // 推理与正文之间插入换行
        reasoningClosed = true
    }
    fmt.Print(content)
}
```

**debug.go** 中的请求回调可以检查发送给模型 API 的消息中是否包含 `reasoning_content` 字段，帮助验证推理内容的历史管理策略是否正确生效。

**tools.go** 提供了 `calculator` 和 `current_time` 两个工具，模型在推理过程中可以决定是否需要调用工具辅助回答。

## 运行方式

```bash
cd examples

export OPENAI_API_KEY="your-key"

# 使用 DeepSeek 推理模型
go run ./thinking -model=deepseek-reasoner -variant=deepseek

# 使用 OpenAI 模型
go run ./thinking -model=o1-mini -variant=openai

# 禁用推理模式对比
go run ./thinking -model=deepseek-v4-flash -thinking=false

# 调整推理内容历史策略
go run ./thinking -reasoning-mode=discard_previous
```

交互式聊天支持 `/history` 查看对话历史、`/new` 开启新会话、`/exit` 退出。

## 总结

推理模式为复杂任务提供了可观察的思考过程，结合 `ReasoningContentMode` 的历史管理策略可以在推理质量和 Token 消耗之间取得平衡。此特性与 `react` 示例的规划能力互补——React 是显式的结构化规划，Thinking 是模型内部的隐式推理。
