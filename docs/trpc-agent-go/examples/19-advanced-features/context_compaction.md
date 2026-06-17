# 上下文压缩 - 自动压缩历史工具结果以节省Token

## 概述

当 Agent 在多轮对话中反复调用工具时，历史工具返回的大量文本会快速消耗上下文窗口。`context_compaction` 示例演示了如何启用上下文压缩功能，在发送请求给模型前自动将历史工具结果替换为紧凑的占位符，同时保持原始数据在 Session 中不变。

## 核心概念

上下文压缩是一个 **Prompt 投影** 特性，它在两个阶段工作：

- **Pass 1（历史结果替换）**：对于超过 `ToolResultMaxTokens` 阈值的历史工具结果，用简短占位符替换其内容。通过 `KeepRecentRequests` 和 `SkipRecentFunc` 控制哪些请求被视为"近期"而受保护。
- **Pass 2（当前结果截断）**：当 `OversizedToolResultMaxTokens > 0` 时，对当前请求中超大的工具结果进行 head+tail 截断。

关键配置选项包括：

- `WithEnableContextCompaction(true)` - 启用压缩功能
- `WithContextCompactionToolResultMaxTokens` - Pass 1 Token 阈值
- `WithContextCompactionOversizedToolResultMaxTokens` - Pass 2 Token 阈值
- `WithToolResultCompactionConfig` - 精细控制，包括 `ForceCleanToolNames`（强制清理指定工具）和 `KeepToolNames`（保护指定工具不被压缩）

## 代码解析

示例的核心在 `newDemo()` 中配置 LLMAgent：

```go
llmAgent := llmagent.New(
    agentName,
    llmagent.WithEnableContextCompaction(true),
    llmagent.WithContextCompactionKeepRecentRequests(*keepRecentRequests),
    llmagent.WithContextCompactionToolResultMaxTokens(*toolResultMaxTokens),
    llmagent.WithContextCompactionOversizedToolResultMaxTokens(*oversizedToolResultMaxTokens),
    llmagent.WithToolResultCompactionConfig(&llmagent.ToolResultCompactionConfig{
        ForceCleanToolNames: forceCleanToolNames,
        KeepToolNames:       []string{"session_load", "session_search"},
        SkipRecentFunc:      skipRecentFunc,
    }),
)
```

`makeLargeLog` 工具生成大量合成日志行，模拟真实场景中工具返回大文本的情况。示例运行两轮对话：第一轮让模型调用 `large_log` 工具并总结内容，第二轮询问前一次工具结果——此时第一轮的工具结果已变为"历史"数据，会被压缩。

通过 `model.NewCallbacks()` 注册 `BeforeModel` 回调，可以在 debug 模式下打印投影后的请求内容，直观看到压缩效果。

## 运行方式

```bash
cd examples

export OPENAI_API_KEY="your-key"
export MODEL_NAME="gpt-4o-mini"

# 默认开启 debug 输出
go run ./context_compaction -model=gpt-4o-mini

# 保护最近 3 个事件不被 Pass 1 压缩
go run ./context_compaction -model=gpt-4o-mini -skip-recent-events=3

# 强制清理 large_log 工具的历史结果
go run ./context_compaction -model=gpt-4o-mini -force-clean-large-log
```

预期输出会包含 `--- Model Request ---` 调试块，显示每条消息的 role、content_bytes 等信息。第二轮请求中，历史的 `large_log` 工具结果应显示为被压缩后的较小内容。

## 总结

上下文压缩是管理长对话 Token 消耗的有效手段。它在不丢失 Session 原始数据的前提下，智能地缩减发送给模型的上下文大小。配合 `context_compaction_recovery` 示例，可以进一步了解如何通过 `session_load` 恢复被压缩的工具结果原文。
