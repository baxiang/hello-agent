# 上下文压缩恢复 - 通过Session加载恢复被压缩的工具结果

## 概述

`context_compaction_recovery` 示例验证了一个关键场景：当上下文压缩和 Token 裁剪同时启用时，被压缩为占位符的工具结果可以通过 `session_load` 工具恢复原始内容。这对于需要回溯历史工具输出的 Agent 工作流至关重要。

## 核心概念

压缩占位符中会嵌入 `event_id` 和 `tool_call_id` 两个恢复标识。当模型需要访问被压缩的原始数据时，可以调用框架内置的 `session_load` 工具，通过这些标识从 Session 存储中按需加载指定偏移量和长度的内容。

本示例同时启用了两个特性：
- **上下文压缩**（Context Compaction）：替换历史大工具结果
- **Token 裁剪**（Token Tailoring）：当总输入超过 `maxInputTokens` 时裁剪历史消息

这确保了即使在双重压缩下，原始工具结果依然可恢复。

## 代码解析

`buildRunner` 函数构建了完整的测试环境：

```go
agentInstance := llmagent.New(
    agentName,
    llmagent.WithEnableOnDemandSession(true),
    llmagent.WithEnableContextCompaction(true),
    llmagent.WithContextCompactionKeepRecentRequests(0),
    llmagent.WithContextCompactionToolResultMaxTokens(*compactionTokens),
    llmagent.WithContextCompactionOversizedToolResultMaxTokens(*oversizedTokens),
    llmagent.WithMaxLLMCalls(4),
    llmagent.WithMaxToolIterations(3),
)
```

`seedTailoringHistory` 向 Session 中注入大量合成历史消息，确保 Token 裁剪会生效。工具 `emit_large_result` 生成包含 head/tail 哨兵字符串的大型负载（约32KB），用于验证恢复的准确性。

验证流程包括：
1. `verifyOriginalToolResult` - 确认 Session 中存储的原始事件未被压缩
2. `verifySessionLoadWasUsed` - 确认模型调用了 `session_load` 并获取到尾部哨兵
3. `verifyCapturedRequests` - 检查捕获的模型请求中压缩占位符和恢复数据的正确性

## 运行方式

```bash
cd examples

export OPENAI_API_KEY="your-key"

go run ./context_compaction_recovery -model=gpt-4o-mini

# 自定义参数
go run ./context_compaction_recovery \
  -model=gpt-4o-mini \
  -max-input-tokens=1800 \
  -payload-bytes=32000 \
  -filler-messages=80
```

成功运行后会输出 `PASS: recovered compacted tool result with context compaction and token tailoring enabled`。

## 总结

这个示例证明了框架的上下文管理是"无损"的——压缩只影响发送给模型的请求投影，原始数据始终保留在 Session 中。结合 `session_load` 工具，Agent 可以在需要时按需恢复任何被压缩的工具结果。这与 `context_compaction` 示例形成互补，完整展示了上下文压缩的存储与恢复机制。
