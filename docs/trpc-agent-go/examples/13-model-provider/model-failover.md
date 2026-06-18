# 故障转移（Failover）- 主备模型在首 chunk 前自动切换

> **源码路径**：[`trpc-agent-go/examples/model/failover/`](../../../../trpc-agent-go/examples/model/failover)
> **示例类型**：多模型可靠性 · **难度**：进阶

## 概述

`failover/` 演示**主备模型链**：主模型（如 OpenAI）出错时，自动切换到备用模型（如 DeepSeek）继续服务。所有切换逻辑封装在模型层（`failover.New`），上层 `LLMAgent` + `Runner` 完全无感——把它当成普通模型使用即可。

与兄弟策略的关键区别：
- 相对 [`retry`](./model-retry.md)：failover 切换到**另一个模型**而非重试同一个
- 相对 [`hedge`](./model-hedge.md)：failover 是**串行**（主失败才用备），hedge 是**并发竞速**
- 相对 [`switch`](./model-switch.md)：failover 是**自动**触发，switch 是用户手动

## 核心概念

### Failover 切换规则

`failover` 包装器**只在以下三个条件同时满足**时切换到备用模型：

1. 主模型在产出**第一个非错误 chunk 之前**失败
2. 主模型返回了函数级错误，或带非空 `Message`/`Type` 的 `Response.Error`
3. 备用模型成功启动

一旦任何非错误 chunk 已经交付给调用方，后续失败会**直接冒泡**，不会重放到备用模型——这是为了避免同一个请求被双方都计费、且输出错乱。

### 不可分割的三段接线

```go
// 1. 构造主/备 OpenAI 模型（可指向不同提供商）
primary := openai.New(config.primaryModelName,
    openai.WithBaseURL(config.primaryBaseURL))
backup := openai.New(config.backupModelName,
    openai.WithBaseURL(config.backupBaseURL))

// 2. 用 failover.New 包装成单一 model.Model
llm, err := failover.New(
    failover.WithCandidates(primary, backup),
)

// 3. 像普通模型一样接入 LLMAgent + Runner
agentInstance := llmagent.New(agentName,
    llmagent.WithModel(llm),
    llmagent.WithGenerationConfig(model.GenerationConfig{Stream: true}),
)
r := runner.NewRunner(appName, agentInstance,
    runner.WithSessionService(sessioninmemory.NewSessionService()))
```

主备模型可以指向**完全不同的提供商**（OpenAI vs DeepSeek），只要都实现 `model.Model` 接口即可。

### 请求克隆隔离

每次尝试前，failover 会**克隆请求**，确保主模型在请求里的任何修改（如 SDK 注入的 header）不会泄漏到备用尝试。这是默认开启的安全行为，无需用户配置。

## 代码解析

示例拆成 4 个文件，职责清晰：

| 文件 | 职责 |
|------|------|
| `main.go` | 解析 CLI flag，构造 `appConfig` |
| `model.go` | `newFailoverModel()` — 构造 failover 包装器 |
| `agent.go` | `failoverChat` — Agent/Runner/Session 接线 + 交互循环 |
| `print.go` | Banner、命令提示、流式响应消费 |

### 模型构造（`model.go`）

```go
func newFailoverModel(config appConfig) (model.Model, error) {
    primary := openai.New(config.primaryModelName,
        openai.WithBaseURL(config.primaryBaseURL))
    backup := openai.New(config.backupModelName,
        openai.WithBaseURL(config.backupBaseURL))
    return failover.New(
        failover.WithCandidates(primary, backup),
    )
}
```

`WithCandidates` 接受可变参数，理论上可以串更多备用模型（按顺序尝试）。

### 交互循环（`agent.go`）

```go
eventChan, err := c.runner.Run(
    ctx,
    c.userID,
    c.sessionID,
    model.NewUserMessage(userMessage),
)
```

调用方代码**和单一模型场景完全一致**——failover 完全藏在模型层背后。

### 流式响应消费（`print.go`）

```go
func (c *failoverChat) extractContent(choice model.Choice) string {
    if c.config.streaming {
        return choice.Delta.Content
    }
    return choice.Message.Content
}
```

按 `-streaming` 标志分别取 `Delta`（流式）或 `Message`（非流式）内容。

## 运行方式

### 环境变量

| 变量 | 必需 | 说明 |
|------|------|------|
| `OPENAI_API_KEY` | 是 | 主模型（OpenAI 端点）API Key |
| `DEEPSEEK_API_KEY` | 是 | 备用模型（DeepSeek 端点）API Key |

> 与单提供商示例不同，failover 需要**两套独立凭证**，因为主备是不同厂商。

### 命令行参数

| 参数 | 说明 | 默认值 |
|------|------|--------|
| `-primary-model` | 主模型名 | `gpt-4o-mini` |
| `-backup-model` | 备用模型名 | `deepseek-v4-flash` |
| `-primary-base-url` | 主模型端点 | `https://api.openai.com/v1` |
| `-backup-base-url` | 备用模型端点 | `https://api.deepseek.com/v1` |
| `-streaming` | 是否流式 | `true` |

### 运行命令

```bash
export OPENAI_API_KEY="your-openai-key"
export DEEPSEEK_API_KEY="your-deepseek-key"

cd examples/model/failover
go run . -primary-model gpt-4o-mini -backup-model deepseek-v4-flash
```

### 交互命令

- 直接输入文本对话
- `/new` — 开启新会话
- `/exit` — 退出

### 预期输出

```
🚀 Model failover chat with LLMAgent and Runner
Primary model: gpt-4o-mini (https://api.openai.com/v1)
Backup model: deepseek-v4-flash (https://api.deepseek.com/v1)
Streaming: true
Failover policy: switch before the first non-error chunk only.
==================================================
✅ Chat ready! Session: failover-session-1703123456789

👤 You: Hello
🤖 Assistant: Hi there! How can I help you today?
```

（如果主端点返回错误，会看到备用模型无缝接管，对话不中断。）

## 适用场景与对比

**选 failover 当：**
- 主模型偶尔宕机/限流，但有可用的备用模型
- 不能接受高并发开销（hedge 要同时付两份钱）
- 可以接受切换带来的轻微延迟（主失败后才启动备）

**不应选 failover 当：**
- 对尾延迟极敏感（主失败才发现要切换已经太晚）→ [`hedge`](./model-hedge.md)
- 主备频繁同时出问题 → 加 [`retry`](./model-retry.md) 提升瞬时容忍度

### 与 hedge 的关键区别（最易混淆）

| 维度 | failover | hedge |
|------|----------|-------|
| 启动方式 | 主先跑，失败才启动备 | 主立即跑，延迟后并行启动备 |
| 并发度 | 1（任一时刻） | ≥2 |
| 成本 | 平时只付主模型 | 每次至少付 2 份（取消的一方也计入） |
| 切换时机 | 主**失败**之后 | 主**慢**或**失败** |
| 适用故障 | 主端点完全不可用 | 主端点慢、超时、偶发抖动 |

## 关键要点

1. **切换只发生在首 chunk 前**：避免重复计费和输出错乱
2. **完全在模型层封装**：上层 `LLMAgent`/`Runner` 无需任何改动
3. **请求自动克隆**：主模型的请求污染不会泄漏到备用尝试
4. **支持多备用**：`WithCandidates(a, b, c, ...)` 按顺序尝试
5. **可跨提供商**：主用 OpenAI、备用 DeepSeek 是典型场景

## 总结

failover 是性价比最高的多模型容错方案：常态只用主模型（省钱），主模型真出问题才切换（保可用）。如果对延迟也敏感，看 [`hedge`](./model-hedge.md)；如果只是想扛瞬时抖动，看 [`retry`](./model-retry.md)；如果想在同一次对话里按阶段路由不同模型，看 [`selector`](./model-selector.md)。
