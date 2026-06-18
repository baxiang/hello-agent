# Token 用量追踪 - 实时监控每轮对话的 Token 消耗

## 概述

TokenTracker 示例演示了如何在 tRPC-Agent-Go 中追踪每轮对话的 Token 用量，包括 Prompt Tokens、Completion Tokens、缓存命中量等细粒度指标。这对于成本控制、性能优化和用量审计等场景非常实用。

## 核心概念

Token 追踪基于框架的事件流机制实现：

- **Event.Response.Usage**：每个事件中携带的 Token 用量信息，包含 `PromptTokens`、`CompletionTokens`、`TotalTokens` 以及缓存相关的详细字段。
- **PromptTokensDetails**：Prompt Token 的细分信息，包括 `CachedTokens`（缓存命中）、`CacheReadTokens`（缓存读取）和 `CacheCreationTokens`（缓存写入）。
- **SessionTokenUsage**：会话级别的累积统计结构，汇总所有轮次的 Token 消耗。

## 代码解析

### 核心数据结构

```go
type TurnUsage struct {
    TurnNumber        int
    PromptTokens      int
    PromptCached      int
    PromptCacheRead   int
    PromptCacheWrite  int
    CompletionTokens  int
    TotalTokens       int
    Model             string
    InvocationID      string
    Timestamp         time.Time
}

type SessionTokenUsage struct {
    TotalPromptTokens     int
    TotalPromptCached     int
    TotalPromptCacheRead  int
    TotalPromptCacheWrite int
    TotalCompletionTokens int
    TotalTokens           int
    TurnCount             int
    UsageHistory          []TurnUsage
}
```

`TurnUsage` 记录单轮对话的 Token 用量，`SessionTokenUsage` 汇总整个会话的累积消耗。

### 从事件流中提取 Token 信息

```go
for event := range eventChan {
    if event.Response != nil && event.Response.Usage != nil {
        if turnUsage == nil {
            turnUsage = &TurnUsage{
                TurnNumber:   c.turnCount,
                Model:        event.Response.Model,
                InvocationID: event.InvocationID,
                Timestamp:    event.Response.Timestamp,
            }
        }
        turnUsage.PromptTokens = event.Response.Usage.PromptTokens
        turnUsage.PromptCached = event.Response.Usage.PromptTokensDetails.CachedTokens
        turnUsage.PromptCacheRead = event.Response.Usage.PromptTokensDetails.CacheReadTokens
        turnUsage.PromptCacheWrite = event.Response.Usage.PromptTokensDetails.CacheCreationTokens
        turnUsage.CompletionTokens = event.Response.Usage.CompletionTokens
        turnUsage.TotalTokens = event.Response.Usage.TotalTokens
    }

    if event.Done {
        if turnUsage != nil {
            c.addTurnUsage(*turnUsage)
        }
        break
    }
}
```

在流式模式下，Token 用量信息通常出现在最后一个事件中。代码通过持续更新 `turnUsage` 来确保获取最终的完整统计值，并在 `event.Done` 时完成本轮统计。

### 累积统计与展示

```go
func (c *tokenTrackerChat) addTurnUsage(usage TurnUsage) {
    c.sessionUsage.TotalPromptTokens += usage.PromptTokens
    c.sessionUsage.TotalPromptCached += usage.PromptCached
    c.sessionUsage.TotalCompletionTokens += usage.CompletionTokens
    c.sessionUsage.TotalTokens += usage.TotalTokens
    c.sessionUsage.TurnCount++
    c.sessionUsage.UsageHistory = append(c.sessionUsage.UsageHistory, usage)
}

func (c *tokenTrackerChat) showStats() {
    fmt.Printf("   Total Turns: %d\n", c.sessionUsage.TurnCount)
    fmt.Printf("   Total Prompt Tokens: %d\n", c.sessionUsage.TotalPromptTokens)
    fmt.Printf("   Total Completion Tokens: %d\n", c.sessionUsage.TotalCompletionTokens)
    if c.sessionUsage.TurnCount > 0 {
        avgTotal := float64(c.sessionUsage.TotalTokens) / float64(c.sessionUsage.TurnCount)
        fmt.Printf("   Average Total Tokens per Turn: %.1f\n", avgTotal)
    }
}
```

### Agent 和 Runner 搭建

```go
modelInstance := openai.New(c.modelName)
llmAgent := llmagent.New("token-tracker-assistant",
    llmagent.WithModel(modelInstance),
    llmagent.WithGenerationConfig(model.GenerationConfig{
        MaxTokens:   intPtr(1000),
        Temperature: floatPtr(0.7),
        Stream:      c.streaming,
    }),
)
c.runner = runner.NewRunner("token-tracker-demo", llmAgent,
    runner.WithSessionService(inmemory.NewSessionService()),
)
```

示例使用最简配置，不带工具，专注于展示 Token 追踪能力。

## 运行方式

```bash
export OPENAI_API_KEY="sk-..."
cd examples/tokentracker

# 默认使用 deepseek-v4-flash，流式模式
go run main.go

# 指定模型
go run main.go -model gpt-4o-mini

# 非流式模式
go run main.go -streaming=false
```

交互命令：
- `/stats` - 查看当前会话的 Token 统计
- `/new` - 开启新会话并重置统计
- `/exit` - 退出

预期输出：

```
You: Hello, how are you?
Assistant: Hello! I'm doing well...

Turn 1 Token Usage:
   Prompt: 15 (cached: 0, cache_read: 0, cache_write: 0), Completion: 25, Total: 40

/stats
Session Token Usage Statistics:
   Total Turns: 1
   Total Prompt Tokens: 15
   Total Completion Tokens: 25
   Average Total Tokens per Turn: 40.0
```

## 总结

Token 用量追踪是 Agent 应用成本管理的基础能力，关键收获：

- **非侵入式采集**：直接从 Runner 的事件流中提取 Usage 信息，无需修改 Agent 逻辑
- **细粒度统计**：支持 Prompt 缓存命中、缓存读写等详细指标，有助于优化缓存策略
- **会话级汇总**：自动累积计算均值，便于横向对比不同模型和 Prompt 的 Token 效率

可结合 Telemetry 模块将 Token 用量导出到 Prometheus 进行长期监控和告警，也可结合 Callbacks 模块在 Token 超限时自动截断对话。
