# 模型配置 - 从单次调用到多模型路由与可靠性策略

> **源码路径**：[`trpc-agent-go/examples/model/`](../../../../trpc-agent-go/examples/model)
> **子示例数**：7 个 · 本页为分类索引，每个子示例有独立详解

## 概述

`model/` 示例集合演示 trpc-agent-go **模型层**的完整能力光谱：从最基础的流式/非流式调用，到运行时模型切换、按阶段路由、再到生产级的重试、故障转移、对冲请求和批量处理。主目录 `main.go` 是入门 demo，7 个子目录分别对应一种独立策略。

所有策略都围绕同一个核心抽象：`model.Model` 接口（`GenerateContent(ctx, *Request) <-chan *Response`）。理解了这个接口，就能把任意模型包装成框架可用的形态。

## 子示例导航

| 子示例 | 类型 | 难度 | 一句话说明 |
|--------|------|------|-----------|
| [`retry/`](./model-retry.md) | 单模型可靠性 | 入门 | SDK 级自动重试 408/409/429/5xx |
| [`switch/`](./model-switch.md) | 运行时控制 | 入门 | 用户主动切换 Agent 默认模型（永久/单次） |
| [`selector/`](./model-selector.md) | 精细化路由 | 进阶 | 按 Invocation 状态每次 LLM 调用选模型 |
| [`failover/`](./model-failover.md) | 多模型可靠性 | 进阶 | 主模型失败自动切到备用（串行） |
| [`hedge/`](./model-hedge.md) | 多模型可靠性 | 进阶 | 多模型并行竞速，先到先得 |
| [`promptmap/`](./model-promptmap.md) | 模型适配 | 入门 | 同一 Agent 按模型名自动切 system prompt |
| [`batch/`](./model-batch.md) | 规模化异步 | 进阶 | OpenAI Batch API 异步处理大批请求 |

## 选型决策树

模型层策略众多，**最容易混淆的是 retry / failover / hedge / switch / selector 这五个**。下面的决策树按"为什么需要切/重试模型"分类：

```
你的痛点是什么？
│
├── 瞬时故障（偶发 429/5xx、网络抖动）
│   └── 同一端点反复试就行 → retry
│
├── 主端点真的会挂（需要备用模型兜底）
│   ├── 可以接受主失败后再切（省钱）        → failover
│   └── 必须极致低延迟（接受多付钱）        → hedge
│
├── 想让用户/调用方控制用哪个模型
│   ├── 切一次影响整个 Agent 或单次请求     → switch
│   └── 想按 LLM 调用阶段自动路由          → selector
│
└── 不想换模型，只想换 system prompt
    └── promptmap
```

### 五种可靠性/路由策略速查表

| 策略 | 候选数 | 触发方 | 触发时机 | 并发度 | 平时成本 | 解决问题 |
|------|--------|--------|---------|--------|---------|---------|
| **retry** | 1 | SDK 自动 | 错误码可重试 | 1 | 1 份 | 瞬时抖动 |
| **failover** | ≥2 | 包装器自动 | 主**首 chunk 前**失败 | 1 | 1 份 | 主端点宕机 |
| **hedge** | ≥2 | 包装器自动 | 延迟到期 / 早期失败 | ≥2 | ≥2 份 | 尾延迟、超时 |
| **switch** | ≥2 | 用户手动 | CLI / 调用方输入 | 1 | 1 份 | 用户偏好、A/B |
| **selector** | ≥2 | 代码回调 | 每次 LLM 调用 | 1 | 1 份 | 阶段化路由 |

> 记忆口诀：**retry 对着自己重试，failover 串行兜底，hedge 并发竞速，switch 人来切，selector 代码切**。

## 核心概念

### model.Model 接口

所有策略的根基——一个返回响应通道的接口：

```go
llm := openai.New("gpt-4o-mini")  // 创建实例

request := &model.Request{
    Messages: []model.Message{
        model.NewSystemMessage("You are helpful."),
        model.NewUserMessage("Hello"),
    },
    GenerationConfig: model.GenerationConfig{
        Temperature: &temperature,
        MaxTokens:   &maxTokens,
        Stream:      false,
    },
}

responseChan, err := llm.GenerateContent(ctx, request)
for resp := range responseChan {
    // 消费响应（流式 chunk 或完整 message）
}
```

`failover` / `hedge` 等高级策略本质上都是**实现了同一接口的包装器**——上层无感。

### 包装器模式（Wrapper Pattern）

模型层的可靠性策略都用同一种结构：把多个 `model.Model` 包装成一个新的 `model.Model`：

```
┌─────────────────────────────────┐
│   hedge.New / failover.New      │ ← 包装器，实现 model.Model
│   ┌───────────┐  ┌───────────┐  │
│   │ primary   │  │ backup    │  │ ← 被包装的底层模型
│   │ openai.New│  │ openai.New│  │
│   └───────────┘  └───────────┘  │
└─────────────────────────────────┘
            ↓
       LLMAgent / Runner            ← 上层完全感知不到包装
```

这意味着任何包装器都可以**无缝替换**普通模型，接入 `LLMAgent` + `Runner` 后无需改一行上层代码。

### GenerationConfig 生成配置

| 字段 | 类型 | 作用 |
|------|------|------|
| `Temperature` | `*float64` | 输出随机性（0.0 确定性 → 1.2+ 高创造性） |
| `MaxTokens` | `*int` | 最大生成 token 数 |
| `TopP` | `*float64` | 核采样参数 |
| `Stream` | `bool` | 是否启用流式响应 |

> 注意是指针类型——传 `nil` 表示不覆盖服务端默认值。

### 环境变量的统一约定

OpenAI SDK 自动读取这两个环境变量，**无需手动配置客户端**：

| 变量 | 说明 | 默认值 |
|------|------|--------|
| `OPENAI_API_KEY` | 模型 API Key | — |
| `OPENAI_BASE_URL` | 模型端点 | `https://api.openai.com/v1` |

切换 DeepSeek 时只需改 `OPENAI_BASE_URL=https://api.deepseek.com/v1`；多提供商场景（如 [`failover`](./model-failover.md)）则用代码里的 `openai.WithBaseURL` 显式指定，并配独立的 `*_API_KEY`。

## 深度原理

> 本节源自原「核心组件」深度文（04-model.md），提炼 Model 层的接口契约、流式机制与设计考量；各可靠性策略（retry/failover/hedge/switch/selector/promptmap/batch）的具体实现代码见对应子示例详解。

### Model 核心接口

Model 层的根基是两个接口加一个回调式序列类型：

```go
// model/model.go
type Model interface {
    GenerateContent(ctx context.Context, request *Request) (<-chan *Response, error)
    Info() Info
}

// model/iter_model.go — 可选迭代器优化
type IterModel interface {
    Model
    GenerateContentIter(ctx context.Context, request *Request) (Seq[*Response], error)
}

// Seq 是回调式序列 —— 同步推送，避免 goroutine+channel 开销
type Seq[T any] func(yield func(T) bool)
```

`GenerateContent` 统一返回 `<-chan *Response`，使流式与非流式、原始模型与包装器对外形态完全一致。`IterModel` 是可选优化接口，框架自动检测并优先使用，规避高频流式下 goroutine+channel 的开销。

**GenerationConfig**（请求侧生成参数，均为指针类型——传 `nil` 表示不覆盖服务端默认值）：

| 字段 | 类型 | 说明 |
|------|------|------|
| `Stream` | bool | 流式输出（默认 false） |
| `Temperature` | *float64 | 0.0-2.0 |
| `MaxTokens` | *int | 最大输出 token |
| `TopP` | *float64 | 核采样 |
| `Stop` | []string | 停止词 |
| `FrequencyPenalty` | *float64 | 频率惩罚 |
| `PresencePenalty` | *float64 | 存在惩罚 |
| `ReasoningEffort` | *string | 推理努力程度 |
| `ThinkingEnabled` | *bool | 启用思维模式 |
| `ThinkingTokens` | *int | 思维 token 限制 |

### 消息与流式设计

同一接口下存在两种流式实现，框架按场景自动择优：

| | Channel 流式 (`GenerateContent`) | 迭代器流式 (`GenerateContentIter`) |
|----|----|----|
| **实现** | `go func() { for... { ch <- chunk } }()` | 同步 `yield(chunk)` |
| **开销** | goroutine + channel 同步 | 零分配回调 |
| **适用** | 一般场景 | 高频流式（每 token 一个 chunk） |
| **优先级** | 默认 | 框架自动检测 IterModel 接口优先使用 |

流式回调按生命周期分 4 个注入点，覆盖请求全过程：

```
请求前：WithChatRequestCallback        → 可修改 params
流式：  WithChatChunkCallback          → 每个 chunk 触发（每 token 一次）
非流式：WithChatResponseCallback       → 完整响应到达
完成：  WithChatStreamCompleteCallback → 流结束（含 accumulator）
```

其中 `WithChatStreamCompleteCallback` 携带的 Accumulator 会拼接所有 chunk，输出完整的 `content` 与 `tool_calls`——这是流式模式下获取整体视图的唯一途径。

### 包装器模式

retry / failover / hedge / switch / selector / promptmap 等策略之所以能"上层无感"地叠加，关键在于它们**都实现了同一个 `model.Model` 接口**——这是经典的装饰器（Decorator）模式：包装器持有底层 `model.Model`，对外暴露相同的 `GenerateContent` 签名，在调用前后插入重试、故障转移、对冲或路由逻辑。由此带来两个工程红利：

- **可任意嵌套**：`hedge(failover(retry(primary)))` 这类组合天然成立，每层只依赖接口而非具体实现。
- **零侵入替换**：任何包装器接入 `LLMAgent` + `Runner` 后，上层代码无需改动一行。

平台差异则由 **Variant 策略**吸收：不同供应商（OpenAI / DeepSeek / 混元）的 API 差异点有限（约 5–10 处），框架用枚举 + `switch` 在请求出海前做字段映射（如 DeepSeek 不支持 `Temperature=0` 自动改为 `1e-6`），而非为每个平台派生接口子类。差异点稀少时，这种取舍比多态更简单直接。

### 设计哲学

**为什么不把 Token 计数放进 Model 接口？** Token 计数与平台强相关（OpenAI 用 tiktoken，Anthropic 用 claude-tokenizer），甚至与模型版本相关；强行进接口会破坏抽象。框架采用"可选能力"模式：`SimpleTokenCounter` 给出近似估算（1 token ≈ 4 chars），各 Model 实现可提供更精确的计数，Token Tailoring 接受 `Counter` 接口可任意替换。裁剪对应三档策略——`Head`（保前 N，适合 system prompt 为主）、`Tail`（保后 N，适合最新对话为主）、`MiddleOut`（保头尾裁中间，平衡历史与最新，推荐）。

**适配器模式的边界**：将不同厂商 API 封装为同一 `model.Model` 接口，Agent 完全不必关心底层是 OpenAI 还是 Anthropic——但这层只做"协议翻译"，不做"能力对齐"。

**ReasoningEffort 的跨平台适配**也由 Variant 层吸收，Agent 代码无需关心映射细节：

| ReasoningEffort | OpenAI o-series | DeepSeek v4 | Anthropic |
|-----------------|-----------------|-------------|-----------|
| `"low"` | 最少推理 token | 映射为 `"high"` | 最少 thinking |
| `"medium"` | 中等 | 映射为 `"high"` | 中等 |
| `"high"` | 较多推理 | 原生支持 | 较多 thinking |
| `"max"` | 最多推理 | 原生支持 | 最多 thinking |
| `"xhigh"` | — | 映射为 `"max"` | 仅支持机型 |

### 配置速查

**OpenAI 适配器 functional options**（客户端构造侧）：

| 选项 | 说明 |
|------|------|
| `openai.New(name, opts...)` | 创建实例，name 为实际模型名 |
| `WithBaseURL(url)` | 自定义 API 地址 |
| `WithAPIKey(key)` | API 密钥 |
| `WithVariant(v)` | 平台适配（DeepSeek/混元） |
| `WithExtraFields(m)` | 附加 JSON 字段 |
| `WithHeaders(m)` | 固定 HTTP Header |
| `WithRetryPolicy(p)` | 自动重试配置 |
| `WithChatRequestCallback(f)` | 请求前回调 |
| `WithChatResponseCallback(f)` | 非流式回调 |
| `WithChatChunkCallback(f)` | 流式 chunk 回调 |
| `WithChatStreamCompleteCallback(f)` | 流式完成回调 |
| `WithEnableTokenTailoring(b)` | 启用 Token 裁剪 |
| `WithTokenTailoringConfig(c)` | 裁剪策略配置 |

> 请求侧生成参数见上文「Model 核心接口」的 GenerationConfig 表。

## 学习路径建议

1. **先读 [`retry`](./model-retry.md)**：理解最轻量的可靠性策略，建立"SDK 自动重试"的直觉
2. **再读 [`switch`](./model-switch.md)**：掌握预注册 + 两种切换 API，这是 [`selector`](./model-selector.md) 和 [`promptmap`](./model-promptmap.md) 的基础
3. **对比读 [`failover`](./model-failover.md) ↔ [`hedge`](./model-hedge.md)**：这两个最容易混，**对比着读**才能分清串行 vs 并发
4. **进阶读 [`selector`](./model-selector.md)**：理解 Invocation 状态共享，看懂数据如何在工具和 selector 之间流动
5. **按需读 [`promptmap`](./model-promptmap.md)**：模型适配工具，常和 switch/selector 组合
6. **规模化读 [`batch`](./model-batch.md)**：离线场景才需要，但成本优化明显

### 推荐组合（生产落地）

| 场景 | 推荐组合 |
|------|---------|
| 在线聊天（单一模型） | retry |
| 在线聊天（主备容灾） | retry + failover |
| 在线聊天（极致低延迟） | retry + hedge |
| 工具型 Agent（成本优化） | selector（工具规划用大模型、答复用小模型） |
| 多用户多模型 SaaS | switch + promptmap |
| 离线数据标注 | batch |

## 共通的运行约定

所有交互式子示例（switch / failover / hedge）支持统一的会话命令：

- 直接输入文本对话
- `/new` — 开启新会话
- `/exit` — 退出

`switch` 额外提供 `/switch <model>` 和 `/model <model>` 两个独有命令。

```bash
# 通用前置
export OPENAI_API_KEY="your-api-key"

# 各子示例入口
cd examples/model             && go run main.go -model gpt-4o-mini    # 基础 demo
cd examples/model/retry       && go run main.go -retries 3 -timeout 30s
cd examples/model/switch      && go run main.go -model deepseek-v4-flash
cd examples/model/selector    && go run .
cd examples/model/failover    && go run . -primary-model gpt-4o-mini -backup-model deepseek-v4-flash
cd examples/model/hedge       && go run . -hedge-delay=100ms
cd examples/model/promptmap   && go run . -a gpt-4o-mini -b gpt-4o
cd examples/model/batch       && go run main.go -action list
```

## 总结

模型层策略虽多，但本质上回答的是三个问题：**调用谁**（switch / selector / promptmap）、**怎么容错**（retry / failover / hedge）、**怎么规模化**（batch）。

- 想清楚是**容错**还是**路由**问题，决策树一走就明白
- 容错看预算：省钱选 retry → failover，烧钱换体验选 hedge
- 路由看决策方：人选 switch、代码选 selector、按模型配 prompt 选 promptmap

掌握这套分类，再去看 [`provider`](./provider.md) 的跨厂商抽象就更顺——provider 解决的是"统一接入不同厂商"，本目录解决的是"接入后如何调度"。
