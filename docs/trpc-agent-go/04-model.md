# Model 模型层 — 源码·实战·原理

Model 模块是 LLM 的统一抽象层，屏蔽不同供应商 API 差异。本文深入 OpenAI 和 Anthropic 适配器源码、Token 管理策略、以及接入自定义模型实战。

## 1. 概念概述

### 1.1 Model 接口层次

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

### 1.2 两种流式模式对比

| | Channel 流式 (`GenerateContent`) | 迭代器流式 (`GenerateContentIter`) |
|----|----|----|
| **实现** | `go func() { for... { ch <- chunk } }()` | 同步 `yield(chunk)` |
| **开销** | goroutine + channel 同步 | 零分配回调 |
| **适用** | 一般场景 | 高频流式（每 token 一个 chunk） |
| **优先级** | 默认 | 框架自动检测 IterModel 接口优先使用 |

---

## 2. 源码走读：OpenAI 适配器

### 2.1 结构

```go
// model/openai/openai.go
type Model struct {
    client      *openai.Client   // 官方 Go SDK
    name        string
    baseURL     string
    apiKey      string
    variant     Variant          // 平台适配策略
    callbacks   *Callbacks
    retryPolicy *RetryPolicy
    headers     map[string]string
    extraFields map[string]any
}
```

### 2.2 GenerateContent 核心逻辑

```go
func (m *Model) GenerateContent(ctx context.Context, req *model.Request) (<-chan *model.Response, error) {
    ch := make(chan *model.Response, 256)

    go func() {
        defer close(ch)

        // 1. 转换内部 message 为 OpenAI SDK 格式
        messages := m.convertMessages(req.Messages)

        // 2. 构建请求参数
        params := openai.ChatCompletionNewParams{
            Model:       m.name,
            Messages:    messages,
            Temperature: req.Temperature,
            MaxTokens:   req.MaxTokens,
            Stream:      req.Stream,
            Tools:       m.convertTools(req.Tools),
            // ... extra fields
        }

        // 3. 请求前回调
        if m.callbacks != nil {
            m.callbacks.OnChatRequest(ctx, &params)
        }

        // 4. 调用 API
        if req.Stream {
            // 流式：逐 chunk 回调
            stream := m.client.Chat.Completions.NewStreaming(ctx, params)
            acc := &openai.ChatCompletionAccumulator{}
            for stream.Next() {
                chunk := stream.Current()
                acc.AddChunk(chunk)
                m.callbacks.OnChatChunk(ctx, &params, &chunk)
                ch <- m.convertChunk(&chunk)
            }
            // 流式完成
            m.callbacks.OnChatStreamComplete(ctx, &params, acc, stream.Err())
        } else {
            // 非流式：一次性返回
            completion, err := m.client.Chat.Completions.New(ctx, params)
            m.callbacks.OnChatResponse(ctx, &params, completion)
            ch <- m.convertCompletion(completion)
        }
    }()

    return ch, nil
}
```

### 2.3 Variant 适配机制

不同平台的 API 有细微差异，Variant 模式通过策略函数处理：

```go
// model/openai/variant.go
type Variant int

const (
    VariantDefault  Variant = iota  // 标准 OpenAI
    VariantDeepSeek                  // DeepSeek 平台
    VariantHunyuan                  // 腾讯混元
)

// 注册到 Model 的适配函数
func (m *Model) applyVariant(params *openai.ChatCompletionNewParams, req *model.Request) {
    switch m.variant {
    case VariantDeepSeek:
        // DeepSeek 不支持 Temperature=0（改为 1e-6）
        if params.Temperature != nil && *params.Temperature == 0 {
            *params.Temperature = 1e-6
        }
        // reasoning_content 处理
    case VariantHunyuan:
        // 混元部分字段名不同
        // tool_choice 格式适配
    }
}
```

**Variant 的设计考量**：通过枚举+switch 而非接口继承——不同平台的差异点有限（5-10 处），枚举模式比多态更简单直接。

### 2.4 Anthropic 适配器

```go
// model/anthropic/anthropic.go
type Model struct {
    client    *anthropic.Client
    name      string
    callbacks *Callbacks
}

func (m *Model) GenerateContent(ctx context.Context, req *model.Request) (<-chan *model.Response, error) {
    ch := make(chan *model.Response, 256)
    go func() {
        defer close(ch)
        // 转换消息格式：OpenAI 格式 → Anthropic 格式
        messages := m.convertMessages(req.Messages)
        // Anthropic 特有参数：max_thinking_tokens
        // 回调注入点
        // ...
    }()
    return ch, nil
}
```

**适配器模式的设计**：通过将不同 API 封装为同一 `model.Model` 接口，Agent 不关心底层调用的是 OpenAI 还是 Anthropic。

---

## 3. 实战

### 3.1 接入自定义 OpenAI 兼容模型

```go
// 任何兼容 OpenAI Chat Completions API 的服务都可直接接入
model := openai.New("custom-model",
    openai.WithBaseURL("https://your-service.com/v1"),
    openai.WithAPIKey("your-api-key"),
    openai.WithExtraFields(map[string]any{
        "custom_param": "value",
    }),
)
```

### 3.2 动态 Header + Per-Request 模型切换

```go
events, _ := r.Run(ctx, userID, sessionID, msg,
    agent.WithModelName("smart"),                      // 按名称切换模型
    agent.WithModelRequestHeader("X-Trace-ID", traceID), // 注入链路 ID
    agent.WithModelRequestHeader("X-User-ID", userID),
)
```

### 3.3 Model Failover 实战

```go
primary := openai.New("gpt-4o")
fallback := openai.New("gpt-4o-mini")

model := model.NewFailoverModel(
    primary,
    fallback,
    model.WithFailoverMaxRetries(2),
    model.WithFailoverOnErrors([]string{
        "rate_limit_exceeded",
        "server_error",
        "model_overloaded",
    }),
)

agent := llmagent.New("reliable-agent",
    llmagent.WithModel(model),
)
```

### 3.4 Token Tailoring 实战

```go
model := openai.New("gpt-4o-mini",
    openai.WithEnableTokenTailoring(true),
    openai.WithTokenTailoringConfig(&openai.TokenTailoringConfig{
        MaxInputTokens:       100000,
        ReserveOutputTokens:  4096,
        Strategy:             openai.TailoringStrategyMiddleOut,
        Counter:              openai.NewSimpleTokenCounter(),
    }),
)
```

**裁剪策略详解**：

| 策略 | 行为 | 适用场景 |
|------|------|----------|
| `TailoringStrategyHead` | 保留前 N token | 以 system prompt 为主 |
| `TailoringStrategyTail` | 保留后 N token | 以最新对话为主 |
| `TailoringStrategyMiddleOut` | 保留头+尾，裁剪中间 | 平衡历史与最新（推荐） |

### 3.5 自定义模型接入（Provider 注册）

```go
import "trpc.group/trpc-go/trpc-agent-go/model/provider"

// 注册自定义 Provider
provider.Register("my-llm", provider.Config{
    BaseURL: "https://my-llm-service.com",
    APIKey:  os.Getenv("MY_LLM_KEY"),
    DefaultModel: "my-model-v2",
})

// 通过 provider 获取模型
m, err := provider.Model("my-llm", "my-model-v2")
```

---

## 4. 设计原理

### 4.1 为什么不在 Model 接口中包含 Token 计数？

Token 计数与平台强相关（OpenAI 用 tiktoken，Anthropic 用 claude-tokenizer），甚至与模型版本相关。放在接口中会破坏抽象，必须由各实现自行计算。

框架选择了"可选能力"模式：
- `SimpleTokenCounter` 提供近似估算（1 token ≈ 4 chars）
- 各 Model 实现可提供更精确的 CountTokens 方法
- Tailoring 接受 `Counter` 接口，可替换

### 4.2 流式回调的时机设计

4 个回调的生命周期：

```
请求前：WithChatRequestCallback     → 可修改 params
流式：  WithChatChunkCallback       → 每个 chunk 触发（每 token 一次）
非流式：WithChatResponseCallback    → 完整响应到达
完成：  WithChatStreamCompleteCallback → 流结束（含 accumulator）
```

**StreamComplete 回调的 Accumulator**：流式模式下无法在一次回调中获得完整响应，Accumulator 拼接了所有 chunk——包括完整的 `content` 和 `tool_calls`。

### 4.3 ReasoningEffort 的跨平台适配

不同平台对推理努力程度的定义不同：

| ReasoningEffort | OpenAI o-series | DeepSeek v4 | Anthropic |
|-----------------|-----------------|-------------|-----------|
| `"low"` | 最少推理 token | 映射为 `"high"` | 最少 thinking |
| `"medium"` | 中等 | 映射为 `"high"` | 中等 |
| `"high"` | 较多推理 | ✅ 原生支持 | 较多 thinking |
| `"max"` | 最多推理 | ✅ 原生支持 | 最多 thinking |
| `"xhigh"` | — | 映射为 `"max"` | 仅支持机型 |

框架在 Variant 层处理这些映射，Agent 代码无需关心。

---

## 5. 配置速查

### OpenAI 配置

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

### GenerationConfig

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
