# LLM 模型层详解

langchaingo 的 llms 包是整个框架的核心抽象层，为 16+ 种大语言模型提供统一的调用接口。本文从源码层面深入解析 Model 接口、消息体系、选项配置、错误处理、推理模型支持等核心机制。

---

## 1. Model 接口

**源码位置**: llms/llms.go:15-29

```go
type Model interface {
    GenerateContent(ctx context.Context, messages []MessageContent, options ...CallOption) (*ContentResponse, error)
    Call(ctx context.Context, prompt string, options ...CallOption) (string, error)
}
```

- **GenerateContent** (llms.go:19): 核心方法，接受 []MessageContent 消息序列和可变 CallOption，返回 *ContentResponse。支持多模态输入。
- **Call** (llms.go:28): 向后兼容的简化接口，仅支持纯文本。已标记 Deprecated。

LLM 类型是 Model 的别名（llms.go:12），同样已废弃。

### GenerateFromSinglePrompt (llms.go:47-64)

将 prompt 包装为 MessageContent，调用 GenerateContent 后提取第一个 Choice 的内容。

### ReasoningModel 接口 (llms.go:34-41)

```go
type ReasoningModel interface {
    Model
    SupportsReasoning() bool
}
```

支持推理的模型（OpenAI o1/o3、Anthropic Claude 3.7+）同时实现此接口。

---

## 2. CallOptions 调用选项 (options.go:10-76)

```go
type CallOptions struct {
    Model            string
    CandidateCount   int
    MaxTokens        int
    Temperature      float64
    StopWords        []string
    StreamingFunc    func(ctx context.Context, chunk []byte) error
    StreamingReasoningFunc func(ctx context.Context, reasoningChunk, chunk []byte) error
    TopK             int
    TopP             float64
    Seed             int
    MinLength        int
    MaxLength        int
    N                int
    RepetitionPenalty float64
    FrequencyPenalty  float64
    PresencePenalty   float64
    JSONMode         bool
    Tools            []Tool
    ToolChoice       any
    Functions        []FunctionDefinition         // 已废弃
    FunctionCallBehavior FunctionCallBehavior      // 已废弃
    Metadata         map[string]interface{}
    ResponseMIMEType string
    WebSearchOptions *WebSearchOptions
}
```

### With*() 选项函数 (options.go:157-343)

| 选项函数 | 行号 | 说明 |
|---------|------|------|
| WithModel | :157 | 设置模型名称 |
| WithMaxTokens | :164 | 设置最大令牌数 |
| WithCandidateCount | :171 | 设置候选数量 |
| WithTemperature | :179 | 设置采样温度 |
| WithStopWords | :186 | 设置停止词 |
| WithStreamingFunc | :200 | 设置流式回调 |
| WithStreamingReasoningFunc | :207 | 设置推理流式回调 |
| WithTopK | :214 | 设置 Top-K |
| WithTopP | :221 | 设置 Top-P |
| WithSeed | :228 | 设置确定性种子 |
| WithMinLength | :235 | 设置最小长度 |
| WithMaxLength | :242 | 设置最大长度 |
| WithN | :249 | 设置补全选择数 |
| WithRepetitionPenalty | :256 | 设置重复惩罚 |
| WithFrequencyPenalty | :263 | 设置频率惩罚 |
| WithPresencePenalty | :270 | 设置存在惩罚 |
| WithToolChoice | :294 | 设置工具选择策略 |
| WithTools | :302 | 设置工具列表 |
| WithJSONMode | :310 | 启用 JSON 模式 |
| WithMetadata | :318 | 设置请求元数据 |
| WithResponseMIMEType | :326 | 设置响应 MIME 类型 |
| WithWebSearch | :335 | 启用网页搜索 |

### Tool 与 FunctionDefinition (options.go:79-97)

```go
type Tool struct { Type string; Function *FunctionDefinition }
type FunctionDefinition struct {
    Name string; Description string; Parameters any; Strict bool
}
```

### WebSearchOptions (options.go:117-147)

支持 gpt-4o-search-preview 等模型，配置搜索上下文大小（low/medium/high）和用户位置。

---

## 3. ChatMessage 体系 (chat_messages.go)

### ChatMessageType (chat_messages.go:18-31)

| 类型常量 | 行号 | 值 | 说明 |
|---------|------|----|------|
| ChatMessageTypeAI | :20 | ai | AI 消息 |
| ChatMessageTypeHuman | :22 | human | 人类消息 |
| ChatMessageTypeSystem | :24 | system | 系统指令消息 |
| ChatMessageTypeGeneric | :26 | generic | 通用消息 |
| ChatMessageTypeFunction | :28 | function | 函数返回消息（已废弃） |
| ChatMessageTypeTool | :30 | tool | 工具返回消息 |

### ChatMessage 接口 (chat_messages.go:34-39)

```go
type ChatMessage interface { GetType() ChatMessageType; GetContent() string }
```

### AIChatMessage (chat_messages.go:57-69)

```go
type AIChatMessage struct {
    Content          string        // 文本内容
    FunctionCall     *FunctionCall // 函数调用（已废弃）
    ToolCalls       []ToolCall    // 工具调用列表
    ReasoningContent string       // 推理内容（DeepSeek reasoner）
}
```

### ToolChatMessage (chat_messages.go:116-121)

```go
type ToolChatMessage struct {
    ID      string // 对应的工具调用 ID
    Content string // 工具返回内容
}
```

GetID() 方法（:125）返回工具调用 ID，用于将结果与 ToolCall 关联。

### 其他消息类型

- HumanChatMessage (chat_messages.go:76-78): Content string
- SystemChatMessage (chat_messages.go:84-86): Content string
- GenericChatMessage (chat_messages.go:92-96): Content, Role, Name
- FunctionChatMessage (chat_messages.go:104-109): 已废弃，Name, Content

### GetBufferString (chat_messages.go:128-146)

将消息列表序列化为带角色前缀的字符串。AI 消息含 FunctionCall 时追加 JSON。

### ChatMessageModel (chat_messages.go:173-204)

提供 BSON/JSON 序列化，ToChatMessage() 方法（:183）从存储模型还原。

---

## 4. MessageContent + ContentPart (generatecontent.go)

### MessageContent (generatecontent.go:14-17)

```go
type MessageContent struct { Role ChatMessageType; Parts []ContentPart }
```

GenerateContent API 的输入单元，每条消息可包含多个 ContentPart。

### ContentPart 接口 (generatecontent.go:49-51)

```go
type ContentPart interface { isPart() }
```

| 类型 | 行号 | 说明 | 创建函数 |
|------|------|------|---------|
| TextContent | :54 | 纯文本 | TextPart(s) (:20) |
| ImageURLContent | :65 | 图片 URL + Detail | ImageURLPart(url) (:34) |
| BinaryContent | :77 | 二进制数据 + MIME | BinaryPart(mime, data) (:26) |
| ToolCall | :98 | 工具调用请求 | 直接构造 |
| ToolCallResponse | :110 | 工具调用结果 | 直接构造 |

辅助函数：TextParts(role, parts...) (:153)、ShowMessageContents (:165)

---

## 5. ContentResponse + ContentChoice (generatecontent.go:121-149)

```go
type ContentResponse struct { Choices []*ContentChoice }
type ContentChoice struct {
    Content          string
    StopReason       string
    GenerationInfo  map[string]any
    FuncCall        *FunctionCall     // 已废弃
    ToolCalls       []ToolCall
    ReasoningContent string
}
```

GenerationInfo 包含提供商特定信息：
- **OpenAI**: CompletionTokens, PromptTokens, TotalTokens, ReasoningTokens, PromptCachedTokens
- **Anthropic**: InputTokens, OutputTokens, CacheCreationInputTokens, CacheReadInputTokens

FuncCall 为向后兼容（:141-143），多个 ToolCalls 时指向第一个。

---

## 6. 16+ 种 LLM 实现

| 实现包 | 目录 | 说明 |
|--------|------|------|
| OpenAI | llms/openai/ | GPT-4o, GPT-4, o1/o3 推理模型 |
| Anthropic | llms/anthropic/ | Claude 3.7+, Claude 4 推理模型 |
| Google AI | llms/googleai/ | Gemini 系列 |
| Ollama | llms/ollama/ | 本地模型运行 |
| Bedrock | llms/bedrock/ | AWS Bedrock 托管模型 |
| Cohere | llms/cohere/ | Cohere Command 系列 |
| Mistral | llms/mistral/ | Mistral/Mixtral 系列 |
| Ernie | llms/ernie/ | 百度文心一言 |
| HuggingFace | llms/huggingface/ | HuggingFace 推理 API |
| Cloudflare | llms/cloudflare/ | Cloudflare Workers AI |
| Watsonx | llms/watsonx/ | IBM watsonx.ai |
| Maritaca | llms/maritaca/ | Maritaca AI |
| Llamafile | llms/llamafile/ | 本地 llamafile 运行 |
| Local | llms/local/ | 本地模型执行 |
| Fake | llms/fake/ | 测试用模拟模型 |


---

## 7. OpenAI 实现 (llms/openai/)

### LLM 结构体 (openai/openaillm.go:16-20)

```go
type LLM struct {
    CallbacksHandler callbacks.Handler
    client           *openaiclient.Client
    model            string
}
```

同时实现 Model 和 ReasoningModel 接口（:80-83）。

### ModelCapability (openai/openaillm.go:31-78)

```go
type ModelCapability struct {
    Pattern          string // 正则匹配模型名
    SupportsSystem   bool   // 支持系统消息
    SupportsThinking bool   // 支持推理
    SupportsCaching  bool   // 支持提示缓存
}
```

| 模型模式 | SupportsSystem | SupportsThinking | SupportsCaching |
|---------|---------------|-----------------|----------------|
| o1/o3 | false | true | false |
| GPT-4 | true | false | false |
| GPT-3.5 | true | false | false |

getModelCapabilities()（:66-78）根据模型名匹配能力，不匹配时返回默认值。

### GenerateContent 核心流程 (openai/openaillm.go:104-386)

1. 获取模型能力 (:114-121)
2. 系统消息处理：o1/o3 模型合并系统消息到首条用户消息 (:124-139)
3. 消息转换：MessageContent 转为 OpenAI ChatMessage (:141-204)
4. 令牌字段：默认 max_completion_tokens，可切旧版 max_tokens (:206-211)
5. 构建请求：温度、工具、响应格式 (:264-297)
6. 调用 API (:328-331)
7. 结果映射：提取令牌使用信息 (:336-380)

### OpenAI 特有选项

| 选项 | 行号 | 说明 |
|------|------|------|
| WithToken | :63 | API 令牌 (OPENAI_API_KEY) |
| WithModel | :72 | 模型名 (OPENAI_MODEL) |
| WithEmbeddingModel | :79 | 嵌入模型名 |
| WithEmbeddingDimensions | :89 | 嵌入维度 |
| WithBaseURL | :98 | API 基础 URL |
| WithOrganization | :106 | 组织 ID |
| WithAPIType | :114 | API 类型 (OpenAI/Azure/AzureAD) |
| WithAPIVersion | :122 | API 版本 (默认 2023-05-15) |
| WithHTTPClient | :130 | 自定义 HTTP 客户端 |
| WithCallback | :137 | 回调处理器 |
| WithResponseFormat | :144 | 响应格式（JSON Schema 结构化输出） |
| WithMaxCompletionTokens | options.go:16 | max_completion_tokens（推荐） |
| WithLegacyMaxTokensField | options.go:32 | 强制旧版 max_tokens |

---

## 8. Anthropic 实现 (llms/anthropic/)

### LLM 结构体 (anthropic/anthropicllm.go:33-37)

```go
type LLM struct {
    CallbacksHandler callbacks.Handler
    client           *anthropicclient.Client
    model            string
}
```

### GenerateContent (anthropic/anthropicllm.go:84-98)

支持两种 API：旧版文本补全 API（useLegacyTextCompletionsAPI）和 Messages API。默认使用 Messages API。

### 消息处理 (anthropic/anthropicllm.go:267-303)

processMessages 将 MessageContent 转为 Anthropic ChatMessage：
- System 消息提取为独立 systemPrompt
- Human 消息处理 TextContent 和 BinaryContent（转 base64）
- AI 消息处理 ToolCall 和 TextContent
- Tool 消息处理 ToolCallResponse
- 支持 CachedContent 包装（:310-356），提取 CacheControl

### ReasoningModel 支持 (anthropic/anthropicllm.go:439-476)

SupportsReasoning 检测 Claude 3.7+、Claude 4+、Claude 5+ 模型。

extractThinkingOptions（:479-533）从 CallOptions 的 Metadata 中提取思考配置，计算 BudgetTokens（最低 1024，最高 128000），支持 interleaved thinking。

### Anthropic 特有选项

| 选项 | 行号 | 说明 |
|------|------|------|
| WithPromptCaching | options.go:18 | 启用提示缓存 |
| WithExtendedOutput | options.go:37 | 启用 128K 输出 |
| WithInterleavedThinking | options.go:61 | 启用交错思考 |
| WithBetaHeader | options.go:83 | 自定义 Beta 头 |
| WithToken | anthropicllm_option.go:31 | API 令牌 |
| WithModel | anthropicllm_option.go:38 | 模型名 |
| WithBaseURL | anthropicllm_option.go:46 | 基础 URL |
| WithHTTPClient | anthropicllm_option.go:54 | HTTP 客户端 |
| WithLegacyTextCompletionsAPI | :61 | 旧版 API |
| WithAnthropicBetaHeader | :68 | Beta 头 |

### 错误映射 (anthropic/errors.go:17-58)

定义 Anthropic 特定错误映射（认证、限流、令牌限制等），MapError 函数将提供商错误转为标准化 ErrorCode。

---

## 9. Reasoning 模型 (llms/reasoning.go)

### ThinkingMode (reasoning.go:6-23)

```go
type ThinkingMode string
const (
    ThinkingModeNone   = "none"    // 禁用思考
    ThinkingModeLow    = "low"     // 20% max tokens
    ThinkingModeMedium = "medium"  // 50% max tokens
    ThinkingModeHigh   = "high"    // 80% max tokens
    ThinkingModeAuto   = "auto"    // 模型自决
)
```

### ThinkingConfig (reasoning.go:26-45)

```go
type ThinkingConfig struct {
    Mode              ThinkingMode
    BudgetTokens      int
    ReturnThinking    bool
    StreamThinking    bool
    InterleaveThinking bool
}
```

### 思考选项函数

| 函数 | 行号 | 说明 |
|------|------|------|
| WithThinking | :57 | 设置完整思考配置 |
| WithThinkingMode | :93 | 设置思考模式 |
| WithThinkingBudget | :101 | 设置思考令牌预算 |
| WithReturnThinking | :109 | 返回思考内容 |
| WithStreamThinking | :117 | 流式输出思考 |
| WithInterleaveThinking | :125 | 交错思考 |

### CalculateThinkingBudget (reasoning.go:197-211)

根据模式计算令牌预算：Low=20%, Medium=50%, High=80%, Auto=0（模型自决）。

### 模型检测 (reasoning.go:138-194)

IsReasoningModel 检测推理模型：OpenAI o1/o3/GPT-5、Anthropic Claude 3.7+/4+、DeepSeek R1、Grok reasoning。

### ThinkingTokenUsage (reasoning.go:214-232)

```go
type ThinkingTokenUsage struct {
    ThinkingTokens        int
    ThinkingInputTokens   int
    ThinkingOutputTokens  int
    ThinkingCachedTokens  int
    ThinkingBudgetUsed    int
    ThinkingBudgetAllocated int
}
```

ExtractThinkingTokens（:235-270）从 GenerationInfo 中提取思考令牌使用信息。

---

## 10. Error 体系 (llms/errors.go)

### ErrorCode (errors.go:10-48)

```go
type ErrorCode string
const (
    ErrCodeUnknown            = "unknown"
    ErrCodeAuthentication     = "authentication"
    ErrCodeRateLimit          = "rate_limit"
    ErrCodeInvalidRequest     = "invalid_request"
    ErrCodeResourceNotFound   = "resource_not_found"
    ErrCodeTimeout            = "timeout"
    ErrCodeCanceled           = "canceled"
    ErrCodeQuotaExceeded      = "quota_exceeded"
    ErrCodeContentFilter      = "content_filter"
    ErrCodeTokenLimit         = "token_limit"
    ErrCodeProviderUnavailable = "provider_unavailable"
    ErrCodeNotImplemented     = "not_implemented"
)
```

### Error 结构体 (errors.go:51-66)

```go
type Error struct {
    Code    ErrorCode
    Message string
    Provider string
    Details  map[string]interface{}
    Cause    error
}
```

Error() 方法（:69-74）格式化为 "provider: code: message"。Unwrap()（:77-79）、Is()（:82-101）支持 errors.Is/As 链式检查。

### 错误判断函数 (errors.go:129-186)

IsAuthenticationError、IsRateLimitError、IsTimeoutError 等 9 个函数，使用 errors.As 匹配 ErrorCode。

### ErrorMapper (errors_mapper.go:11-153)

```go
type ErrorMapper struct {
    provider string
    matchers []ErrorMatcher
}
```

ErrorMapper 提供通用错误映射框架：
- defaultMatchers()（:35-96）：上下文错误 + 字符串模式匹配
- AddMatcher()（:115-119）：添加自定义匹配器（优先于默认）
- WrapError/Map()（:122-153）：包装错误为标准化 Error

预定义 Mapper：OpenAIErrorMapper（:156-183）、AnthropicErrorMapper（:186-213）、GoogleAIErrorMapper（:216-240）

---

## 11. Token 计数 (llms/count_tokens.go)

### GetModelContextSize (count_tokens.go:65-71)

返回模型上下文窗口大小。支持 GPT-3.5 (16K)、GPT-4 (8K/32K)、GPT-4 Turbo (128K)、GPT-4o (128K) 等，未识别模型默认 2048。

### CountTokens (count_tokens.go:74-84)

使用 tiktoken-go 库计算令牌数。无法识别模型时回退到 gpt2 编码，再失败则按 4 字符/令牌估算。

### CalculateMaxTokens (count_tokens.go:87-89)

```go
func CalculateMaxTokens(model, text string) int
```

计算模型上下文窗口减去已用令牌后的剩余可用令牌数。

---

## 12. Prompt Caching (llms/prompt_caching.go)

### CacheControl (prompt_caching.go:6-12)

```go
type CacheControl struct {
    Type     string        // 如 "ephemeral"
    Duration time.Duration // 缓存生命周期
}
```

### CachedContent (prompt_caching.go:15-18)

```go
type CachedContent struct {
    ContentPart
    CacheControl *CacheControl
}
```

实现 ContentPart 接口，可包装任何内容并添加缓存控制指令。

### WithCacheControl (prompt_caching.go:23-28)

将 ContentPart 包装为 CachedContent。Anthropic 实现中处理此类型以添加 cache_control 字段。

### WithPromptCaching (prompt_caching.go:33-40)

通用选项，在 Metadata 中设置 prompt_caching=true。提供商各自处理此标记。
