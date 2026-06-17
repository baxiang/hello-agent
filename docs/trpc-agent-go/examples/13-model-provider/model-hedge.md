# 对冲请求（Hedge）- 多模型并行竞速，先到先得

> **源码路径**：[`trpc-agent-go/examples/model/hedge/`](../../../../trpc-agent-go/examples/model/hedge)
> **示例类型**：多模型可靠性 · **难度**：进阶

## 概述

`hedge/` 演示**对冲请求**（hedged requests）：主模型立即启动，备用模型在配置的延迟后并行启动；**第一个返回非错误响应的候选获胜**，其余被取消。这是用**带宽换延迟**的策略——常态多花一点钱，换 P99 尾延迟大幅下降。

与兄弟策略的核心区别：
- 相对 [`failover`](./model-failover.md)：hedge 是**并行**竞速，failover 是**串行**等待主失败
- 相对 [`retry`](./model-retry.md)：hedge 同时打多个**不同模型**，retry 反复打**同一个**
- `hedge-delay=0` 时退化为"全员同时起跑"的纯竞速模式

## 核心概念

### Hedge 的四条规则

`hedge` 包装器的行为定义（来自 `hedge/README.md`）：

1. **立即启动主候选**
2. **延迟后或所有活跃候选都失败时**，启动下一个候选
3. **第一个产出有效非错误响应的候选被选为 winner**
4. winner 一旦确定，**取消其他候选**，只转发 winner 的流

### 关键 API

```go
import "trpc.group/trpc-go/trpc-agent-go/model/hedge"

llm, err := hedge.New(
    hedge.WithName("hedge-chat-model"),
    hedge.WithCandidates(primary, backup),
    hedge.WithDelay(100*time.Millisecond),   // 关键参数
)
```

| 选项 | 作用 |
|------|------|
| `WithName` | 包装器的名字（用于日志/调试） |
| `WithCandidates` | 候选模型列表（可变参数） |
| `WithDelay` | **启动下一个候选前的延迟** |

### `hedge-delay` 的物理含义

| 取值 | 行为 | 适用场景 |
|------|------|---------|
| `0` | 所有候选立即并发 | 纯竞速、最求低延迟 |
| `100ms`（默认） | 主先跑，100ms 内无响应则启动备 | 兼顾成本和延迟 |
| `500ms+` | 主基本跑完才启动备 | 接近 failover 行为 |

### 接线模式（与 failover 一致）

```go
primary := openai.New(config.primaryModelName,
    openai.WithBaseURL(config.primaryBaseURL))
backup := openai.New(config.backupModelName,
    openai.WithBaseURL(config.backupBaseURL))

llm, err := hedge.New(
    hedge.WithName("hedge-chat-model"),
    hedge.WithCandidates(primary, backup),
    hedge.WithDelay(config.hedgeDelay),
)

agentInstance := llmagent.New(agentName,
    llmagent.WithModel(llm),
    llmagent.WithGenerationConfig(model.GenerationConfig{Stream: true}),
)
r := runner.NewRunner(appName, agentInstance,
    runner.WithSessionService(sessioninmemory.NewSessionService()))
```

调用方代码与 [`failover`](./model-failover.md)、单一模型完全一致——hedge 也完全封装在模型层。

## 代码解析

示例拆成 5 个文件，结构清晰：

| 文件 | 职责 |
|------|------|
| `main.go` | 解析 flag（含 `-hedge-delay`），构造 `appConfig` |
| `model.go` | `newHedgeModel()` — 构造 hedge 包装器 |
| `agent.go` | `newHedgeAgent()` — Agent 接线 |
| `chat.go` | `hedgeChat` — Runner/Session + 交互循环 |
| `print.go` | Banner、命令、流式响应消费 |

### 模型构造（`model.go`）

```go
func newHedgeModel(config appConfig) (model.Model, error) {
    primary := openai.New(config.primaryModelName,
        openai.WithBaseURL(config.primaryBaseURL))
    backup := openai.New(config.backupModelName,
        openai.WithBaseURL(config.backupBaseURL))
    return hedge.New(
        hedge.WithName("hedge-chat-model"),
        hedge.WithCandidates(primary, backup),
        hedge.WithDelay(config.hedgeDelay),
    )
}
```

与 failover 的 `model.go` 几乎一致，**唯一区别**是用 `hedge.New` + `WithDelay` 替代了 `failover.New`。

### Banner 提示策略（`print.go`）

```go
fmt.Printf("Hedge policy: launch the primary immediately, " +
    "then hedge backups on delay or early failure.\n")
```

运行时打印的这句话总结了整个 hedge 行为契约。

### 请求克隆隔离

每个候选收到的是**克隆后的请求**，所以某个候选在请求上的修改（headers、metadata）不会泄漏给其他候选。这与 [`failover`](./model-failover.md) 的隔离设计一脉相承。

## 运行方式

### 环境变量

| 变量 | 必需 | 说明 |
|------|------|------|
| `OPENAI_API_KEY` | 是 | 主模型（OpenAI 端点）API Key |
| `DEEPSEEK_API_KEY` | 是 | 备用模型（DeepSeek 端点）API Key |

### 命令行参数

| 参数 | 说明 | 默认值 |
|------|------|--------|
| `-primary-model` | 主模型名 | `gpt-4o-mini` |
| `-backup-model` | 备用模型名 | `deepseek-v4-flash` |
| `-primary-base-url` | 主模型端点 | `https://api.openai.com/v1` |
| `-backup-base-url` | 备用模型端点 | `https://api.deepseek.com/v1` |
| `-hedge-delay` | 启动下一个候选前的延迟 | `100ms` |
| `-streaming` | 是否流式 | `true` |

### 运行命令

```bash
export OPENAI_API_KEY="your-openai-key"
export DEEPSEEK_API_KEY="your-deepseek-key"

cd examples/model/hedge
go run . -primary-model gpt-4o-mini -backup-model deepseek-v4-flash -hedge-delay=100ms

# 纯竞速模式：所有候选同时跑
go run . -hedge-delay=0
```

### 交互命令

- 直接输入文本对话
- `/new` — 开启新会话
- `/exit` — 退出

### 预期输出

```
🚀 Model hedge chat with LLMAgent and Runner
Primary model: gpt-4o-mini (https://api.openai.com/v1)
Backup model: deepseek-v4-flash (https://api.deepseek.com/v1)
Hedge delay: 100ms
Streaming: true
Hedge policy: launch the primary immediately, then hedge backups on delay or early failure.
==================================================
✅ Chat ready! Session: hedge-session-1703123456789

👤 You: Hello
🤖 Assistant: Hi! How can I help?
```

## 适用场景与对比

**选 hedge 当：**
- 对 P99 尾延迟极敏感（用户能感知的卡顿大多来自尾部）
- 主模型偶发慢响应，但平均响应正常
- 预算能承受并发计费（被取消的候选也可能计入 token）

**不应选 hedge 当：**
- 成本敏感（每次至少付 2 份钱）→ [`failover`](./model-failover.md)
- 主备质量差异大（劣质模型先返回反而拖累结果）→ [`selector`](./model-selector.md)
- 主要担心的是限流而非延迟 → [`retry`](./model-retry.md)

### hedge vs failover（最易混淆）

| 维度 | failover | hedge |
|------|----------|-------|
| 候选启动 | 主先跑，**失败后**才起备 | 主立即跑，**延迟后**起备 |
| 并发度 | 1 | ≥2 |
| 平时成本 | 1 份 | ≥2 份 |
| 切换触发 | 主**错误** | 主**慢**或**错误** |
| 解决问题 | 主端点不可用 | 主端点慢/抖动 |

简单记忆：**failover 是"故障保险"，hedge 是"速度保险"**。

## 关键要点

1. **首个非错误响应获胜**：胜者通吃，其他候选被取消
2. **延迟可调**：`WithDelay` 在成本和延迟间权衡
3. **`delay=0` = 全员竞速**：极致低延迟，最高成本
4. **请求自动克隆**：候选间请求互不污染
5. **完全模型层封装**：上层代码无感知

## 总结

hedge 是用资源换体验的极致策略：常态并发请求让最快的那个赢，把 P99 延迟压到接近 P50。如果预算吃紧、只需扛主端点宕机，看 [`failover`](./model-failover.md)；如果想按调用阶段路由模型，看 [`selector`](./model-selector.md)；想用户手动切，看 [`switch`](./model-switch.md)。
