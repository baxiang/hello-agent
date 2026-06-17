# 模型重试（Retry）- SDK 级别的瞬时故障自动重试

> **源码路径**：[`trpc-agent-go/examples/model/retry/`](../../../../trpc-agent-go/examples/model/retry)
> **示例类型**：单次调用增强 · **难度**：入门

## 概述

`retry/` 演示如何为 OpenAI 兼容模型配置 **HTTP 层自动重试**。它通过 `openai.WithOpenAIOptions` 把重试参数透传给底层 OpenAI SDK，由 SDK 自动处理 `408`/`409`/`429`/`5xx` 等可重试错误。这是所有可靠性策略里**最轻量**的一种——单一模型、单一端点，只在瞬时故障时重试。

与兄弟示例的核心区别：[`failover`](./model-failover.md) 切换到**另一个模型**；[`hedge`](./model-hedge.md) 并发**竞速多个模型**；而 retry 始终**对着同一个模型反复尝试**，是最便宜的容错手段。

## 核心概念

### 重试配置的透传模式

trpc-agent-go 框架本身**不实现**重试逻辑，而是把 OpenAI SDK 成熟的重试机制直接暴露给用户。配置通过 `openaiopt` 选项传入：

```go
import openaiopt "github.com/openai/openai-go/option"

llm := openai.New(*modelName,
    openai.WithOpenAIOptions(
        openaiopt.WithMaxRetries(*maxRetries),
        openaiopt.WithRequestTimeout(*timeout),
    ),
)
```

- `WithMaxRetries(n)`：最大重试次数（不含首次请求）
- `WithRequestTimeout(d)`：单次请求超时

### 可重试的错误码

OpenAI 客户端自动识别以下错误并按指数退避 + `Retry-After` 头重试：

| HTTP 状态 | 含义 | 是否重试 |
|----------|------|---------|
| `408` | Request Timeout | ✅ |
| `409` | Conflict | ✅ |
| `429` | Too Many Requests（限流） | ✅（遵循 `Retry-After`） |
| `500+` | 服务端错误 | ✅ |
| `4xx`（其他） | 客户端错误（如鉴权失败） | ❌ |

### 智能退避

SDK 优先读取响应里的 `Retry-After` 头；如果没有，则使用指数退避。这意味着面对 `429` 限流时，SDK 会按服务端建议的节奏重试，而不是死循环。

## 代码解析

`retry/main.go` 是一个**单文件**演示，依次跑 4 个子场景，全部复用同一个 `llm` 实例：

| 函数 | 场景 | 关键点 |
|------|------|--------|
| `basicRetryExample` | 最简调用 | 只发一条 `Hello` |
| `advancedRetryExample` | 带温度/MaxTokens | 验证重试不破坏生成参数 |
| `streamingWithRetryExample` | 流式响应 | 流中遇到错误会冒泡给调用方 |
| `rateLimitingRetryExample` | 模拟限流 | 演示 429 自动恢复 |

响应通道的标准消费模式：

```go
responseChan, err := llm.GenerateContent(ctx, request)
if err != nil {
    return fmt.Errorf("failed to generate content: %w", err)
}

for response := range responseChan {
    if response.Error != nil {
        return fmt.Errorf("API error: %s", response.Error.Message)
    }
    if len(response.Choices) > 0 {
        choice := response.Choices[0]
        fmt.Printf("🤖 Response: %s\n", choice.Message.Content)
    }
    if response.Done {
        break
    }
}
```

> 注意：SDK 的重试发生在 `GenerateContent` 返回通道**之前**。一旦通道开始吐 chunk，后续流中的错误就不再触发重试——这正是 [`failover`](./model-failover.md) 只在"首个非错误 chunk 前"切换的原因。

## 运行方式

### 环境变量

| 变量 | 必需 | 说明 | 默认值 |
|------|------|------|--------|
| `OPENAI_API_KEY` | 是 | 模型 API Key | — |
| `OPENAI_BASE_URL` | 否 | 模型端点 | `https://api.openai.com/v1` |

### 命令行参数

| 参数 | 说明 | 默认值 |
|------|------|--------|
| `-model` | 模型名 | `gpt-4o-mini` |
| `-retries` | 最大重试次数 | `3` |
| `-timeout` | 单次请求超时 | `30s` |

### 运行命令

```bash
cd examples/model/retry
export OPENAI_API_KEY="your-api-key"

go run main.go                                # 默认配置
go run main.go -model gpt-4 -retries 5 -timeout 60s   # 加强重试
```

### 预期输出

```
🚀 Using configuration:
   📝 Model Name: gpt-4o-mini
   🔄 Max Retries: 3
   ⏱️ Request Timeout: 30s
   🔑 OpenAI SDK will automatically read OPENAI_API_KEY and OPENAI_BASE_URL from environment

🔄 === Basic Retry Example ===
💬 Sending basic request...
🤖 Response: Hello! I'm doing well, thank you for asking!
🏁 Finish reason: stop

⚡ === Advanced Retry Example ===
...

🚦 === Rate Limiting Retry Example ===
🚦 Testing retry mechanism for potential rate limiting scenarios...
🤖 Response: ...
🎉 === Demo Complete ===
```

## 适用场景与对比

**选 retry 当：**
- 只对接单一模型/端点
- 主要担心瞬时网络抖动、服务端 5xx、被限流
- 想要零成本的"保底"可靠性

**不应只依赖 retry 当：**
- 主端点长时间宕机（重试只会越试越糟）→ 加 [`failover`](./model-failover.md)
- 对尾延迟敏感（重试反而拉高 P99）→ 用 [`hedge`](./model-hedge.md)

### 与兄弟策略对比

| 策略 | 候选数 | 触发时机 | 成本 | 解决的问题 |
|------|--------|---------|------|-----------|
| **retry** | 1 | 错误码可重试 | 极低（同一端点） | 瞬时抖动 / 限流 |
| [`failover`](./model-failover.md) | ≥2 | 主模型在首 chunk 前失败 | 低（备用付费） | 主端点故障 |
| [`hedge`](./model-hedge.md) | ≥2 | 延迟到期 / 早期失败 | 高（并发计费） | 尾延迟、超时 |
| [`switch`](./model-switch.md) | ≥2 | 用户主动切换 | 无 | A/B 测试、用户偏好 |
| [`selector`](./model-selector.md) | ≥2 | 每次调用按状态路由 | 无 | 不同阶段用不同模型 |

## 关键要点

1. **框架不重试，SDK 重试**：trpc-agent-go 把重试责任交给 OpenAI SDK，避免重复造轮子
2. **`WithOpenAIOptions` 是透传入口**：所有 `openaiopt.Option` 都可借此传入
3. **重试只发生在流开始之前**：一旦首 chunk 落地，后续错误不再重试
4. **智能遵守 `Retry-After`**：应对 429 不会硬闯
5. **是最廉价的容错**：所有生产部署都建议先开 retry，再叠加 failover/hedge

## 总结

retry 是模型可靠性策略的**第一道防线**，配置一行代码、零额外成本，就能扛住绝大多数瞬时故障。但要应对主端点真正宕机、长尾延迟等场景，需要继续看 [`failover`](./model-failover.md) 和 [`hedge`](./model-hedge.md)；需要按阶段路由模型则看 [`selector`](./model-selector.md)；需要用户主动切模型则看 [`switch`](./model-switch.md)。
