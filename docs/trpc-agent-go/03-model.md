# Model 模型层详解

Model 模块是 tRPC-Agent-Go 的 LLM 抽象层，提供统一的模型调用接口，屏蔽不同供应商的 API 差异。

## 1. Model 接口

### 1.1 基础接口

```go
type Model interface {
    GenerateContent(ctx context.Context, request *Request) (<-chan *Response, error)
    Info() Info
}
```

- **GenerateContent**：发送请求，返回响应 channel
- **Info**：返回模型名称等信息

### 1.2 迭代器接口（可选）

```go
type IterModel interface {
    Model
    GenerateContentIter(ctx context.Context, request *Request) (Seq[*Response], error)
}
```

`IterModel` 是可选扩展，使用回调式迭代替代 channel，减少高频流式场景中的 goroutine 和 channel 同步开销。模型实现了 `IterModel` 时框架优先使用 `GenerateContentIter`。

### 1.3 Info 结构

```go
type Info struct {
    Name string // 模型名称
}
```

---

## 2. 请求与响应

### 2.1 Request

```go
type Request struct {
    Messages         []Message          `json:"messages"`
    GenerationConfig                     `json:",inline"`
    Tools            map[string]tool.Tool `json:"-"`
}
```

### 2.2 GenerationConfig

```go
type GenerationConfig struct {
    Stream            bool     `json:"stream"`
    Temperature       *float64 `json:"temperature,omitempty"`
    MaxTokens         *int     `json:"max_tokens,omitempty"`
    TopP              *float64 `json:"top_p,omitempty"`
    Stop              []string `json:"stop,omitempty"`
    FrequencyPenalty  *float64 `json:"frequency_penalty,omitempty"`
    PresencePenalty   *float64 `json:"presence_penalty,omitempty"`
    ReasoningEffort   *string  `json:"reasoning_effort,omitempty"`   // "low"/"medium"/"high"/"max"/"xhigh"
    ThinkingEnabled   *bool    `json:"thinking_enabled,omitempty"`
    ThinkingTokens    *int     `json:"thinking_tokens,omitempty"`
}
```

- **Stream**：默认 `false`，需显式开启
- **ReasoningEffort**：OpenAI o 系列 / DeepSeek / Anthropic 推理努力程度
- **ThinkingEnabled / ThinkingTokens**：思维模式控制

### 2.3 Response

```go
type Response struct {
    ID                string         `json:"id"`
    Object            string         `json:"object"`      // "chat.completion" / "chat.completion.chunk"
    Created           int64          `json:"created"`
    Model             string         `json:"model"`
    SystemFingerprint *string        `json:"system_fingerprint"`
    Choices           []Choice       `json:"choices"`
    Usage             *Usage         `json:"usage"`
    Error             *ResponseError `json:"error"`
    Done              bool           `json:"-"`
    IsPartial         bool           `json:"-"`
}

type Usage struct {
    PromptTokens            int                     `json:"prompt_tokens"`
    CompletionTokens        int                     `json:"completion_tokens"`
    TotalTokens             int                     `json:"total_tokens"`
    PromptTokensDetails     PromptTokensDetails     `json:"prompt_tokens_details"`
    CompletionTokensDetails CompletionTokensDetails `json:"completion_tokens_details"`
}

type PromptTokensDetails struct {
    CachedTokens int `json:"cached_tokens"` // 享受 50% 折扣
}

type CompletionTokensDetails struct {
    ReasoningTokens int `json:"reasoning_tokens"` // 推理 token，单独计费
}
```

---

## 3. 支持的平台

### 3.1 OpenAI 兼容

```go
import "trpc.group/trpc-go/trpc-agent-go/model/openai"

// 环境变量方式（推荐）
// export OPENAI_API_KEY="sk-xxx"
// export OPENAI_BASE_URL="https://api.openai.com/v1"
modelInstance := openai.New("gpt-4o")

// 代码配置
modelInstance := openai.New("deepseek-v4-flash",
    openai.WithBaseURL("https://api.deepseek.com"),
    openai.WithAPIKey("your-api-key"),
    openai.WithExtraFields(map[string]interface{}{
        "tool_choice": "auto",
    }),
)
```

| 平台 | 模型示例 | Base URL |
|------|---------|----------|
| OpenAI | `gpt-4o`, `gpt-4o-mini` | `https://api.openai.com/v1` |
| DeepSeek | `deepseek-v4-flash`, `deepseek-v4-pro` | `https://api.deepseek.com` |
| 腾讯混元 | `hunyuan-2.0-thinking-*` | `https://api.hunyuan.cloud.tencent.com/v1` |
| 通义千问 | `qwen-*` | `https://dashscope.aliyuncs.com/compatible-mode/v1` |

### 3.2 Anthropic

```go
import "trpc.group/trpc-go/trpc-agent-go/model/anthropic"

modelInstance := anthropic.New("claude-sonnet-4-20250514",
    anthropic.WithAPIKey("your-api-key"),
)
```

### 3.3 Provider 机制

```go
import "trpc.group/trpc-go/trpc-agent-go/model/provider"

m, _ := provider.Model("openai", "gpt-4o-mini")

// 注册自定义 Provider
provider.Register("my-provider", myProviderConfig)
```

---

## 4. OpenAI 模型高级特性

### 4.1 回调函数

```go
modelInstance := openai.New("deepseek-v4-flash",
    // 请求前回调 — 可修改请求参数
    openai.WithChatRequestCallback(func(ctx context.Context, req *openai.ChatCompletionNewParams) {
        req.SetExtraFields(map[string]any{"user": userID})
    }),

    // 非流式响应回调
    openai.WithChatResponseCallback(func(ctx context.Context,
        req *openai.ChatCompletionNewParams,
        resp *openai.ChatCompletion) {
        log.Printf("Response ID: %s, Tokens: %d", resp.ID, resp.Usage.TotalTokens)
    }),

    // 流式 chunk 回调
    openai.WithChatChunkCallback(func(ctx context.Context,
        req *openai.ChatCompletionNewParams,
        chunk *openai.ChatCompletionChunk) {
        log.Printf("Chunk ID: %s", chunk.ID)
    }),

    // 流式完成回调（含 accumulator 和 error）
    openai.WithChatStreamCompleteCallback(func(ctx context.Context,
        req *openai.ChatCompletionNewParams,
        acc *openai.ChatCompletionAccumulator,
        streamErr error) {
        if streamErr != nil {
            log.Printf("Stream failed: %v", streamErr)
        }
    }),
)
```

### 4.2 模型切换

**Agent 级别**：

```go
// 方式 A：直接切换
agent := llmagent.New("assistant",
    llmagent.WithModel(openai.New("gpt-4o-mini")),
)

// 方式 B：注册 Registry，按名称切换
agent := llmagent.New("assistant",
    llmagent.WithModelRegistry(map[string]model.Model{
        "fast":  openai.New("gpt-4o-mini"),
        "smart": openai.New("gpt-4o"),
    }),
)
```

**Per-Request 级别**：

```go
// 方式 A：直接传入实例
events, _ := r.Run(ctx, userID, sessionID, msg,
    agent.WithModel(openai.New("gpt-4o")),
)

// 方式 B：按名称选择（推荐）
events, _ := r.Run(ctx, userID, sessionID, msg,
    agent.WithModelName("smart"),
)
```

### 4.3 重试机制

```go
modelInstance := openai.New("gpt-4o-mini",
    openai.WithRetryPolicy(&model.RetryPolicy{
        MaxRetries:       3,
        InitialInterval:  500 * time.Millisecond,
        BackoffFactor:    2.0,
        MaxInterval:      10 * time.Second,
        RetryableErrors:  []string{"rate_limit_exceeded", "server_error"},
    }),
)
```

### 4.4 自定义 HTTP Header

```go
// 固定 Header
modelInstance := openai.New("gpt-4o-mini",
    openai.WithHeaders(map[string]string{
        "X-Custom-Header": "value",
    }),
)

// Per-Request Header（通过 RunOptions）
events, _ := r.Run(ctx, userID, sessionID, msg,
    agent.WithModelRequestHeader("X-Trace-ID", traceID),
)
```

### 4.5 Batch 批量处理

```go
batchService := openai.NewBatchService(modelInstance)

// 提交批量请求
batchID, _ := batchService.CreateBatch(ctx, requests,
    openai.WithBatchMetadata(map[string]string{"job": "eval"}),
)

// 查询状态
status, _ := batchService.GetBatch(ctx, batchID)

// 获取结果
results, _ := batchService.GetBatchResults(ctx, batchID)
```

### 4.6 Token Tailoring

自动裁剪消息以适应模型上下文窗口：

```go
modelInstance := openai.New("gpt-4o-mini",
    openai.WithEnableTokenTailoring(true),
    openai.WithTokenTailoringConfig(&openai.TokenTailoringConfig{
        MaxInputTokens:  128000,
        ReserveOutputTokens: 4096,
        Strategy:        openai.TailoringStrategyMiddleOut,
    }),
)
```

**裁剪策略**：
- `TailoringStrategyHead`：保留头部消息
- `TailoringStrategyTail`：保留尾部消息
- `TailoringStrategyMiddleOut`：删除中间（推荐）

### 4.7 Variant 平台适配

自动适配不同平台的 API 差异：

```go
// DeepSeek 变体
modelInstance := openai.New("deepseek-v4-flash",
    openai.WithVariant(openai.VariantDeepSeek),
)

// 混元变体
modelInstance := openai.New("hunyuan-2.0-instruct",
    openai.WithVariant(openai.VariantHunyuan),
)
```

**变体差异示例**：
- DeepSeek：温度参数行为、reasoning_content 处理
- 混元：额外字段映射、function calling 差异

---

## 5. Model Failover（故障转移）

```go
modelInstance := model.NewFailoverModel(
    openai.New("gpt-4o"),
    openai.New("gpt-4o-mini"), // 备用
    model.WithFailoverMaxRetries(2),
)
```

主模型失败时自动切换到备用模型。

## 6. Model Hedge（对冲请求）

```go
modelInstance := model.NewHedgeModel(
    openai.New("gpt-4o"),
    openai.New("claude-sonnet-4-20250514"),
    model.WithHedgeDelay(500*time.Millisecond),
)
```

同时向多个模型发送请求，采用最先返回的结果。适合对延迟敏感的场景。

---

## 7. 直接使用 Model（非 Agent 场景）

```go
llm := openai.New("deepseek-v4-flash")

request := &model.Request{
    Messages: []model.Message{
        model.NewSystemMessage("You are a professional assistant."),
        model.NewUserMessage("Explain Go's concurrency features."),
    },
    GenerationConfig: model.GenerationConfig{
        Temperature: floatPtr(0.7),
        MaxTokens:   intPtr(1000),
        Stream:      false,
    },
}

responseChan, _ := llm.GenerateContent(ctx, request)
for response := range responseChan {
    if response.Error != nil {
        log.Printf("API error: %s", response.Error.Message)
        return
    }
    if len(response.Choices) > 0 {
        fmt.Println(response.Choices[0].Message.Content)
    }
    if response.Done { break }
}
```

### 结构化输出

```go
type StageParseResult struct {
    Stage  string `json:"stage"`
    Reason string `json:"reason"`
}

request := model.NewRequest(
    []model.Message{
        model.NewUserMessage("Classify the current user intent stage."),
    },
    model.WithStructuredOutputJSON(
        new(StageParseResult), true,
        "Return stage parse result as JSON.",
    ),
)
```

---

## 8. 流式输出

```go
request := &model.Request{
    Messages: []model.Message{...},
    GenerationConfig: model.GenerationConfig{
        Stream: true,
    },
}

responseChan, _ := llm.GenerateContent(ctx, request)
for response := range responseChan {
    if len(response.Choices) > 0 && response.Choices[0].Delta.Content != "" {
        fmt.Print(response.Choices[0].Delta.Content)
    }
    if response.Done { break }
}
```

### ModelSelector

```go
selector := model.NewModelSelector(
    model.WithModels(map[string]model.Model{
        "cheap":  openai.New("gpt-4o-mini"),
        "smart": openai.New("gpt-4o"),
    }),
    model.WithDefaultModel("cheap"),
)

// 运行时选择
modelInstance := selector.Select(ctx,
    model.WithPreferSpeed(),
    model.WithMaxTokens(1000),
)
```
