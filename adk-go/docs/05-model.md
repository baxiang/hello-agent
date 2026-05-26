# LLM 接入层

LLM 接入层定义了 ADK-Go 与大语言模型交互的标准接口，并提供 Gemini 和 Apigee 两种内置实现。通过实现 `model.LLM` 接口，可以接入任意 LLM 提供商。

## 1. model.LLM 接口

定义于 `source/model/llm.go:26-29`：

```go
type LLM interface {
    Name() string
    GenerateContent(ctx context.Context, req *LLMRequest, stream bool) iter.Seq2[*model.LLMResponse, error]
}
```

- **`Name()`**：返回模型名称标识（如 `"gemini-2.5-flash"`），用于请求路由和日志
- **`GenerateContent()`**：核心生成方法，返回迭代器。`stream` 参数区分流式与非流式模式：
  - `stream == false`：迭代器仅 yield 一次完整响应
  - `stream == true`：迭代器逐步 yield 部分响应，最后 yield 完整响应

迭代器设计使得调用方可以统一处理两种模式，无需分支逻辑。

## 2. LLMRequest

定义于 `source/model/llm.go:32-38`：

```go
type LLMRequest struct {
    Model    string
    Contents []*genai.Content
    Config   *genai.GenerateContentConfig
    Tools    map[string]any `json:"-"`
}
```

| 字段 | 说明 |
|------|------|
| `Model` | 模型名称，可由 `BeforeModelCallback` 动态修改 |
| `Contents` | 对话内容列表，包含完整的对话历史 |
| `Config` | 生成配置（温度、Top-P、安全设置等） |
| `Tools` | 工具映射，`json:"-"` 标记不参与 JSON 序列化 |

`Contents` 遵循 Gemini API 的多轮对话格式，`Role` 字段区分 `user` 和 `model` 轮次。`Config` 中的工具声明应通过 ADK 的 `Tools` 字段配置而非直接设置。

## 3. LLMResponse

定义于 `source/model/llm.go:42-68`，包含模型返回的完整信息：

```go
type LLMResponse struct {
    Content             *genai.Content
    CitationMetadata    *genai.CitationMetadata
    GroundingMetadata   *genai.GroundingMetadata
    UsageMetadata       *genai.GenerateContentResponseUsageMetadata
    CustomMetadata      map[string]any
    LogprobsResult      *genai.LogprobsResult
    InputTranscription  *genai.Transcription
    OutputTranscription *genai.Transcription
    ModelVersion        string
    Partial             bool
    TurnComplete        bool
    Interrupted         bool
    SessionResumptionHandle string
    ErrorCode           string
    ErrorMessage        string
    FinishReason        genai.FinishReason
    AvgLogprobs         float64
}
```

### 内容与元数据

| 字段 | 说明 |
|------|------|
| `Content` | 模型生成的内容，包含文本、函数调用、函数响应等 Parts |
| `CitationMetadata` | 引用元数据，标识内容来源 |
| `GroundingMetadata` | 搜索 grounding 元数据，包含检索的网页片段 |
| `UsageMetadata` | Token 用量统计（输入/输出/缓存 token 数） |
| `CustomMetadata` | 自定义元数据，供扩展使用 |
| `LogprobsResult` | 对数概率结果，用于分析模型置信度 |
| `ModelVersion` | 模型版本标识 |

### 流式控制

| 字段 | 说明 |
|------|------|
| `Partial` | 是否为流式中间片段。Runner 仅持久化 `Partial == false` 的最终事件 |
| `TurnComplete` | 是否为本轮对话的完整响应（仅流式模式） |
| `Interrupted` | 是否被用户中断（通常在双向流式中发生） |

### 音频转录

| 字段 | 说明 |
|------|------|
| `InputTranscription` | 用户输入音频的转录文本 |
| `OutputTranscription` | 模型输出音频的转录文本 |

Runner 在 Live 模式下使用这些字段实现事件排序：转录事件优先输出，工具调用/响应事件在转录完成后输出。

### 错误处理

| 字段 | 说明 |
|------|------|
| `ErrorCode` | 错误码 |
| `ErrorMessage` | 错误消息 |
| `FinishReason` | 生成终止原因（如 `Stop`、`MaxTokens`、`Safety` 等） |
| `AvgLogprobs` | 平均对数概率，低值可能指示幻觉 |
| `SessionResumptionHandle` | 会话恢复句柄，用于断线重连 |

## 4. Gemini 模型实现

定义于 `source/model/gemini/gemini.go`，是 ADK-Go 的默认 LLM 实现。

### NewModel 创建

```go
model, err := gemini.NewModel(ctx, "gemini-2.5-flash", &genai.ClientConfig{
    Backend: genai.BackendGeminiAPI,
})
```

创建过程：
1. 通过 `genai.NewClient()` 创建底层客户端
2. 注入 `mergeHeadersInterceptor` 到 HTTP Transport，确保自定义 header 被正确合并
3. 生成版本 header：`google-adk/{version} gl-go/{goversion}`

### GenerateContent 实现

```go
func (m *geminiModel) GenerateContent(ctx context.Context, req *model.LLMRequest, stream bool) iter.Seq2[*model.LLMResponse, error]
```

执行流程：
1. **maybeAppendUserContent**：自动补全 user turn。若 Contents 为空，添加默认提示 "Handle the requests as specified in the System Instruction"；若最后一条 Content 的 Role 不是 `user`，添加 "Continue processing previous requests as instructed."
2. 初始化 `Config` 和 `HTTPOptions`，调用 `addHeaders` 设置版本标识
3. 根据 `stream` 参数选择 `generateStream` 或 `generate`

### generateStream 流式生成

使用 `llminternal.NewStreamingResponseAggregator()` 聚合流式响应：

```go
func (m *geminiModel) generateStream(ctx context.Context, req *model.LLMRequest) iter.Seq2[*model.LLMResponse, error] {
    aggregator := llminternal.NewStreamingResponseAggregator()
    return func(yield func(*model.LLMResponse, error) bool) {
        for resp, err := range m.client.Models.GenerateContentStream(...) {
            // 将底层响应送入聚合器
            for llmResponse, err := range aggregator.ProcessResponse(ctx, resp) {
                if !yield(llmResponse, err) { return }
            }
        }
        // 聚合器关闭时产出最终完整响应
        if closeResult := aggregator.Close(); closeResult != nil {
            yield(closeResult, nil)
        }
    }
}
```

聚合器负责将多个 partial 响应片段合并为有意义的 `LLMResponse`，处理函数调用的分段拼接等复杂逻辑。

### mergeHeadersInterceptor

HTTP RoundTripper 拦截器，解决 Go 标准库 `http.Header.Set` 覆盖而非合并的问题。对 `x-goog-api-client` 和 `user-agent` header，将多个值用空格合并后设置，确保 ADK 版本信息与底层 SDK 版本信息同时保留。

### 版本标识

每次请求携带 header：
```
x-goog-api-client: google-adk/1.2.0 gl-go/1.23.0
user-agent: google-adk/1.2.0 gl-go/1.23.0
```

实际版本号由 `internal/version` 包的 `Version` 常量决定，当前值为 `1.2.0`。

## 5. Apigee 模型

定义于 `source/model/apigee/apigee.go`，通过 Apigee 代理网关访问 Gemini API：

```go
model, err := apigee.NewModel(ctx, "apigee/gemini/gemini-2.5-flash",
    apigee.WithProxyURL("https://my-apigee-proxy.example.com"),
)
```

特性：
- 模型名称格式：`apigee/gemini/{model_id}` 或 `apigee/vertex_ai/{model_id}`，支持 `apigee/{version}/{model_id}` 格式
- 代理 URL 通过参数或 `APIGEE_PROXY_URL` 环境变量配置
- 支持 Gemini API 和 Vertex AI 两种后端，后者需要 `GOOGLE_CLOUD_PROJECT` 和 `GOOGLE_CLOUD_LOCATION` 环境变量
- 内部委托给 `gemini.NewModel`，通过自定义 `BaseURL` 和 header 将请求路由到 Apigee 代理
- 支持通过 `WithCustomHeaders` 注入自定义 HTTP header

## 6. 自定义 Model

实现 `model.LLM` 接口即可接入任意 LLM：

```go
type myModel struct {
    apiKey string
    name   string
}

func (m *myModel) Name() string { return m.name }

func (m *myModel) GenerateContent(ctx context.Context, req *model.LLMRequest, stream bool) iter.Seq2[*model.LLMResponse, error] {
    if stream {
        return m.generateStream(ctx, req)
    }
    return func(yield func(*model.LLMResponse, error) bool) {
        resp, err := callMyLLM(ctx, req)
        yield(resp, err)
    }
}

func (m *myModel) generateStream(ctx context.Context, req *model.LLMRequest) iter.Seq2[*model.LLMResponse, error] {
    return func(yield func(*model.LLMResponse, error) bool) {
        ch := makeSSEChannel(ctx, req)
        for partial := range ch {
            resp := &model.LLMResponse{
                Content:     partial.Content,
                Partial:     !partial.Done,
                TurnComplete: partial.Done,
            }
            if !yield(resp, nil) { return }
        }
    }
}
```

关键实现要点：

1. **迭代器语义**：非流式模式 yield 一次完整响应；流式模式逐步 yield partial 响应，最后一个 `Partial: false` 的响应标记完成
2. **Content 格式**：`genai.Content` 需包含正确的 `Role`（`model`）和 `Parts`（文本用 `Text`，函数调用用 `FunctionCall`）
3. **错误处理**：yield `(nil, error)` 传递错误，LLMAgent 的 `OnModelErrorCallbacks` 会接收并处理
4. **Tools 传递**：`req.Tools` 中的工具定义需按目标 API 格式转换

将自定义模型注册到 LLMAgent：

```go
myLLM := &myModel{apiKey: "...", name: "my-llm-v1"}
agent, err := llmagent.New(llmagent.Config{
    Name:        "custom_agent",
    Description: "使用自定义 LLM 的 Agent",
    Model:       myLLM,
    Instruction: "你是一个自定义模型驱动的助手。",
})
```
