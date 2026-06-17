# Prompt Cache 示例 - 利用提示词缓存降低成本

## 概述

本示例包含四个子示例，全面展示了 tRPC-Agent-Go 框架中的 Prompt 缓存优化策略。涵盖 **Anthropic 三阶段缓存控制**、**OpenAI 多轮对话缓存**、**会话摘要注入模式对缓存的影响**以及**时间处理器对缓存友好性的优化**。通过合理利用缓存机制，可显著降低 Token 消耗和 API 成本。

## 核心概念

### Prompt Cache 原理

大模型 API 提供商（OpenAI、Anthropic）支持对请求中的稳定前缀进行缓存。当连续请求共享相同的系统提示、工具定义等前缀内容时，缓存命中的 Token 可享受 50%~90% 的费用折扣。关键约束：

- **最低 Token 阈值**：通常需要 1024 个 Token 以上才能触发缓存
- **缓存 TTL**：约 5~10 分钟自动过期
- **前缀匹配**：只有从头开始完全匹配的部分才能命中缓存

### Anthropic 三级缓存控制

Anthropic 提供三个独立的缓存断点选项：

- `WithCacheSystemPrompt(true)`：缓存系统提示（推荐始终开启）
- `WithCacheTools(true)`：缓存工具定义（工具不常变化时推荐）
- `WithCacheMessages(true)`：缓存对话历史，断点自动移动到最新的 assistant 消息

### 缓存友好的系统设计

框架提供了两种对缓存友好的设计模式：

- **会话摘要注入模式**（`SessionSummaryInjectionMode`）：`User` 模式将动态摘要注入到用户消息附近，保持系统提示前缀稳定
- **时间处理器**（`WithAddCurrentTime`）：默认仅注入日期（每天变化一次），而非完整时间戳，避免每次请求都破坏缓存前缀

## 代码解析

### Anthropic 三阶段验证

**Phase 1：仅缓存系统提示**

```go
llm1 := anthropic.New("claude-4-5-sonnet-20250929",
    anthropic.WithCacheSystemPrompt(true),
)
```

第一轮请求创建缓存，第二轮请求命中缓存。缓存读取成本仅为正常输入的 10%。

**Phase 2：系统提示 + 工具缓存**

```go
llm2 := anthropic.New("claude-4-5-sonnet-20250929",
    anthropic.WithCacheSystemPrompt(true),
    anthropic.WithCacheTools(true),
)
```

工具定义也被缓存，覆盖更多 Token。

**Phase 3：全部缓存（动态消息断点）**

```go
llm3 := anthropic.New("claude-4-5-sonnet-20250929",
    anthropic.WithCacheSystemPrompt(true),
    anthropic.WithCacheTools(true),
    anthropic.WithCacheMessages(true),
)
```

消息缓存断点随对话推进自动前移：Turn 2 时断点在 Turn 1 的 assistant 消息处，Turn 3 时移到 Turn 2 处，缓存命中率逐轮提升。

### OpenAI 多轮对话缓存

```go
llm := openai.New(*modelName, openai.WithAPIKey(apiKey))
```

OpenAI 的缓存优化默认启用，无需额外配置。示例通过 6 轮混合查询（普通问题 + 工具调用）验证了缓存在多轮对话和工具调用场景下的有效性。缓存命中的 Token 享受 50% 的费用折扣。

### 会话摘要注入模式对比

```go
llmagent.WithSessionSummaryInjectionMode(llmagent.SessionSummaryInjectionSystem) // 默认
llmagent.WithSessionSummaryInjectionMode(llmagent.SessionSummaryInjectionUser)   // 缓存友好
```

- **System 模式**：摘要合并到系统消息中，不同会话的摘要不同导致前缀变化，缓存失效
- **User 模式**：摘要注入到用户消息附近，系统提示保持稳定，缓存命中率更高

### 时间处理器缓存优化

```go
llmagent.WithAddCurrentTime(true)                         // 仅日期，缓存友好
llmagent.WithTimeFormat("2006-01-02 15:04:05 MST")       // 完整时间戳，每秒变化
```

示例对比了四种模式：无时间处理器（基线）、仅日期、完整时间戳、日期+时间工具。仅日期模式的缓存命中率显著优于完整时间戳模式。

## 运行方式

**环境准备：**

```bash
# Anthropic 示例
export ANTHROPIC_API_KEY="your-anthropic-key"

# OpenAI 示例
export OPENAI_API_KEY="your-openai-key"
```

**运行命令：**

```bash
# Anthropic 三阶段验证
cd examples/promptcache/anthropic
go run .

# OpenAI 多轮缓存
cd examples/promptcache/openai
go run .

# 会话摘要注入模式对比
cd examples/promptcache/summaryinjection
go run . -case all

# 时间处理器对比
cd examples/promptcache/timeprocessor
go run . -case all
```

**预期输出（Anthropic Phase 3 节选）：**

```
[Turn 3] system+tools+Turn1-2 history from cache
   Tokens - total_input: 2048, new: 128, cache_read: 1920, cache_creation: 0
   Cache hit rate: 93.8%
```

## 总结

Prompt 缓存是生产环境中降低 LLM 调用成本的重要手段。核心建议：**始终开启系统提示缓存**，工具定义稳定时开启工具缓存，3 轮以上的多轮对话开启消息缓存。设计系统提示时应将稳定内容放在前面、动态内容放在后面或移至用户消息中，以最大化缓存命中率。可结合 **placeholder** 和 **prompt** 示例，构建既灵活又缓存友好的 Prompt 体系。
