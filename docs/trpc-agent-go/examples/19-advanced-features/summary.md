# 会话总结 - 基于LLM的对话摘要与管理

## 概述

长对话会导致 Token 消耗不断增长。`summary` 示例演示了如何使用 LLM 自动生成对话摘要，并在后续对话中用摘要替代完整历史，实现长对话的高效管理。该示例包含主入口和多个子示例（contextaware、filterkey、injection、subagent、toolcalls），覆盖了摘要功能的各种高级场景。

## 核心概念

会话总结系统由三个核心组件构成：

1. **Summarizer**：使用 LLM 对历史对话生成摘要，支持自定义 prompt 模板
2. **触发条件**：通过 `ChecksAny` 组合多种触发策略：
   - `CheckEventThreshold` - 事件数量阈值
   - `CheckTokenThreshold` - Token 数量阈值
   - `CheckTimeThreshold` - 时间间隔阈值
3. **异步处理**：摘要生成在独立 worker 中异步执行，不阻塞对话流

关键配置包括：
- `WithSkipRecent` - 跳过最近的 N 个事件（保证最新上下文不被摘要化）
- `WithMaxSummaryWords` - 限制摘要长度
- `WithAddSessionSummary` - 是否在系统消息中注入摘要
- `WithMaxHistoryRuns` - 当不使用摘要时，限制历史消息数量

## 代码解析

**创建 Summarizer 和 Session Service：**

```go
sum := summary.NewSummarizer(llm,
    summary.WithMaxSummaryWords(*flagMaxWords),
    summary.WithSkipRecent(func(_ []event.Event) int {
        return *flagSkipRecent
    }),
    summary.WithChecksAny(
        summary.CheckEventThreshold(*flagEvents),
        summary.CheckTokenThreshold(*flagTokens),
        summary.CheckTimeThreshold(time.Duration(*flagTimeSec)*time.Second),
    ),
)

sessService := inmemory.NewSessionService(
    inmemory.WithSummarizer(sum),
    inmemory.WithAsyncSummaryNum(2),
    inmemory.WithSummaryQueueSize(100),
    inmemory.WithSummaryJobTimeout(60*time.Second),
)
```

**Agent 配置摘要注入：**

```go
ag := llmagent.New("summary-demo-agent",
    llmagent.WithAddSessionSummary(*flagAddSum),
    llmagent.WithMaxHistoryRuns(*flagMaxHist),
)
```

示例支持 `/summary` 命令强制生成摘要，`/show` 命令查看当前摘要内容。子目录中的示例分别演示了上下文感知摘要、按关键字过滤、摘要注入方式、子Agent场景和包含工具调用的摘要场景。

## 运行方式

```bash
cd examples

export OPENAI_API_KEY="your-key"

# 基础用法：每 1 条事件触发摘要
go run ./summary -model=deepseek-v4-flash -events=1

# 按 Token 和时间触发
go run ./summary -events=5 -tokens=500 -time-sec=60

# 保留最近 2 条事件不被摘要
go run ./summary -skip-recent=2

# 子示例
go run ./summary/contextaware
go run ./summary/filterkey
go run ./summary/toolcalls
```

## 总结

会话总结是管理长对话成本和质量的核心机制。通过灵活的触发条件和异步处理，它能在不影响用户体验的前提下显著降低 Token 消耗。配合 `context_compaction` 的工具结果压缩和 `tailor` 的 Token 裁剪，可以构建完整的上下文管理策略。
