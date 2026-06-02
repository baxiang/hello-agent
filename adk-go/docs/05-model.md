# LLM 接入层

LLM 接入层定义了 ADK-Go 与大语言模型交互的标准接口，内置了 Gemini 实现，同时通过 `model.LLM` 接口支持接入任意 LLM 提供商（如 DeepSeek、OpenAI 等）。

## 1. model.LLM 接口

定义于 `source/model/llm.go:26-29`：

```go
type LLM interface {
    Name() string
    GenerateContent(ctx context.Context, req *LLMRequest, stream bool) iter.Seq2[*model.LLMResponse, error]
}
```

- **`Name()`**：返回模型名称标识（如 `"deepseek-chat"`），用于请求路由和日志
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

`Contents` 遵循 ADK 的多轮对话格式，`Role` 字段区分 `user` 和 `model` 轮次。`Config` 中的工具声明应通过 ADK 的 `Tools` 字段配置而非直接设置。

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

## 4. 内置 Gemini 模型（参考）

定义于 `source/model/gemini/gemini.go`，是 ADK-Go 默认内建的 LLM 实现。此处保留作为参考，本章后续以 **DeepSeek 自定义模型** 作为主要实战示例。

### NewModel 创建（Gemini 专用）

```go
model, err := gemini.NewModel(ctx, "gemini-2.5-flash", &genai.ClientConfig{
    Backend: genai.BackendGeminiAPI,
})
```

### Gemini 可用模型列表

| 模型名称 | 特点 | 推荐场景 |
|----------|------|----------|
| `gemini-2.5-flash` | 最新、快速、便宜 | 日常开发首选 |
| `gemini-2.5-pro` | 最强推理能力 | 复杂任务、需要深度思考 |
| `gemini-2.0-flash` | 稳定版 | 生产环境 |
| `gemini-2.0-flash-lite` | 最快最便宜 | 简单分类、提取等 |

## 5. DeepSeek 自定义模型接入（实战）

ADK-Go 通过 `model.LLM` 接口支持接入任意 LLM。下面以 **DeepSeek** 为例，展示完整的自定义模型实现。

### DeepSeek 模型列表

| 模型名称 | 特点 | 推荐场景 |
|----------|------|----------|
| `deepseek-chat` | 最新、快速、便宜 | **日常开发首选** |
| `deepseek-reasoner` | 最强推理能力（DeepSeek-R1） | 复杂任务、需要深度思考 |

### API Key 认证

在 [DeepSeek 开放平台](https://platform.deepseek.com/) 获取 API Key：

```bash
export DEEPSEEK_API_KEY="sk-your-api-key"
export DEEPSEEK_BASE_URL="https://api.deepseek.com"
```

### 实现 model.LLM 接口

```go
package deepseek

import (
    "bytes"
    "context"
    "encoding/json"
    "fmt"
    "io"
    "iter"
    "net/http"

    "google.golang.org/genai"

    "google.golang.org/adk/model"
)

type DeepSeekModel struct {
    name    string
    apiKey  string
    baseURL string
}

func New(name, apiKey, baseURL string) model.LLM {
    return &DeepSeekModel{name: name, apiKey: apiKey, baseURL: baseURL}
}

func (m *DeepSeekModel) Name() string { return m.name }

func (m *DeepSeekModel) GenerateContent(ctx context.Context, req *model.LLMRequest, stream bool) iter.Seq2[*model.LLMResponse, error] {
    return func(yield func(*model.LLMResponse, error) bool) {
        // 1. 将 genai.Content 转换为 DeepSeek Chat API 格式
        messages := m.convertContents(req.Contents)

        // 2. 构建 DeepSeek API 请求
        body := map[string]any{
            "model":    m.name,
            "messages": messages,
            "stream":   stream,
        }

        jsonBody, _ := json.Marshal(body)
        httpReq, _ := http.NewRequestWithContext(ctx, "POST",
            m.baseURL+"/chat/completions", bytes.NewReader(jsonBody))
        httpReq.Header.Set("Content-Type", "application/json")
        httpReq.Header.Set("Authorization", "Bearer "+m.apiKey)

        // 3. 发送请求，解析响应为 model.LLMResponse
        resp, err := http.DefaultClient.Do(httpReq)
        if err != nil {
            yield(nil, err)
            return
        }
        defer resp.Body.Close()

        respBytes, _ := io.ReadAll(resp.Body)
        // 解析 DeepSeek 响应为 LLMResponse...
        llmResp := &model.LLMResponse{
            Content: &genai.Content{
                Role:  "model",
                Parts: []*genai.Part{{Text: extractText(respBytes)}},
            },
        }
        yield(llmResp, nil)
    }
}

func (m *DeepSeekModel) convertContents(contents []*genai.Content) []map[string]string {
    var messages []map[string]string
    for _, c := range contents {
        role := "user"
        if c.Role == "model" {
            role = "assistant"
        }
        for _, p := range c.Parts {
            if p.Text != "" {
                messages = append(messages, map[string]string{
                    "role":    role,
                    "content": p.Text,
                })
            }
        }
    }
    return messages
}
```

### 注册到 LLMAgent

```go
import "my-app/model/deepseek"

model := deepseek.New(
    "deepseek-chat",
    os.Getenv("DEEPSEEK_API_KEY"),
    os.Getenv("DEEPSEEK_BASE_URL"),
)

agent, err := llmagent.New(llmagent.Config{
    Name:        "my_agent",
    Model:       model,
    Description: "使用 DeepSeek 模型的 Agent",
    Instruction: "你是一个有帮助的助手。",
})
```

### 实现要点

1. **Content 格式转换**：`genai.Content` 使用 `user`/`model` Role，需转换为 DeepSeek 的 `user`/`assistant` 格式
2. **工具调用处理**：`genai.Part` 中的 `FunctionCall` 需转换为 DeepSeek 的 tool_calls 格式
3. **流式响应**：DeepSeek 支持 SSE 流式，需逐步收集片段并聚合为 `LLMResponse`
4. **错误处理**：yield `(nil, error)` 传递错误，LLMAgent 的 `OnModelErrorCallbacks` 会接收并处理

## 6. 通用自定义 Model 模板

除了 DeepSeek，你也可以用同样模式接入任何 LLM：

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

## 7. Go 版本已知限制

| 功能 | Go 支持情况 | 说明 |
|------|------------|------|
| LlmAgent | ✅ 完整 | 全部 Config 参数可用 |
| Gemini 模型（内置） | ✅ 完整 | API Key + Vertex AI |
| DeepSeek 等第三方模型 | ✅ 可实现 | 通过 `model.LLM` 接口自定义接入 |
| Ollama 本地模型 | ❌ 不支持 | 仅 Python 通过 LiteLLM 集成 |
| Planner（计划器） | ❌ 不支持 | 仅 Python/Java |
| CodeExecutor | ❌ 不支持 | 仅 Python/Java |
| Interactions API | ❌ 不支持 | 仅 Python/Java |
