# genai.Content 多模态消息 — ADK-Go 的数据流通货

## 1. genai 包：ADK-Go 消息格式的基石

在深入 adk-go 之前，必须先理解它所依赖的上游包：`google.golang.org/genai`。这是 Google 官方提供的生成式 AI Go SDK，adk-go 直接复用了 genai 包中的类型——**genai.Content** 和 **genai.Part** 就是整个框架中信息流转的核心数据结构。无论你使用 DeepSeek、Gemini 还是其他模型，ADK-Go 内部的消息格式统一以 genai 类型表示。

如果你来自其他 Go AI 框架（如 eino），可能会习惯框架自定义的 `schema.Message` 类型。但 adk-go 选择了另一条路：**直接拥抱 genai 包的类型系统**，减少了中间转换层，也意味着你必须对 genai 包的类型有清晰认识。

## 2. genai.Content 结构：Role + Parts 列表

`genai.Content` 是一条消息的顶层容器，由两个字段组成：

```go
// genai 包中的 Content 定义
type Content struct {
    Parts []*Part  // 消息内容片段列表
    Role  string   // 发送者角色："user" 或 "model"
}
```

- **Role**：标识消息的发送方。`genai.RoleUser`（值为 `"user"`）表示用户输入，`genai.RoleModel`（值为 `"model"`）表示模型响应。
- **Parts**：一个 `[]*genai.Part` 切片，承载消息的实际内容。一条消息可以包含多个 Part，实现多模态混合。

在 adk-go 中，`Runner.Run()` 的 `msg` 参数类型就是 `*genai.Content`（runner/runner.go:131）：

```go
func (r *Runner) Run(ctx context.Context, userID, sessionID string,
    msg *genai.Content, cfg agent.RunConfig, opts ...RunOption,
) iter.Seq2[*session.Event, error]
```

用户发送的每一条消息，无论是纯文本还是包含图片，都被包装为一个 `*genai.Content` 传入 Runner。

## 3. genai.Part 联合类型：多模态内容的瑞士军刀

`genai.Part` 是 genai 包中最精巧的设计。它采用**联合类型（union type）**模式——一个 Part 结构体包含多个互斥字段，同一时刻只有一个字段有值：

```go
type Part struct {
    // 文本内容
    Text string

    // 二进制内联数据（图片、音频、视频）
    InlineData *Blob

    // 文件引用（Google Cloud Storage 或其他文件服务）
    FileData *FileData

    // 函数调用（模型请求调用工具）
    FunctionCall *FunctionCall

    // 函数响应（工具执行结果返回给模型）
    FunctionResponse *FunctionResponse

    // 代码执行结果
    CodeExecutionResult *CodeExecutionResult

    // 思考过程（模型内部推理）
    Thought bool

    // ...其他字段省略
}
```

理解 Part 的联合类型特性至关重要：**一个 Part 要么是文本、要么是图片、要么是函数调用，绝不会同时是两种**。框架通过 nil 检查判断 Part 的具体类型。

### 构造 Part 的常见方式

```go
// 纯文本 Part
textPart := &genai.Part{Text: "你好，请分析这张图片"}

// 图片 Part（内联二进制数据）
imagePart := &genai.Part{
    InlineData: &genai.Blob{
        MIMEType: "image/png",
        Data:     imageBytes,
    },
}

// 文件引用 Part
filePart := &genai.Part{
    FileData: &genai.FileData{
        FileURI:  "gs://my-bucket/document.pdf",
        MIMEType: "application/pdf",
    },
}
```

## 4. adk-go 中 genai.Content 的使用轨迹

### 4.1 LLMRequest.Contents — 发送给模型的消息历史

在 `model/llm.go:32-38`，`LLMRequest` 携带发给 LLM 的全部内容：

```go
type LLMRequest struct {
    Model    string
    Contents []*genai.Content   // 对话历史：用户消息 + 模型响应交替排列
    Config   *genai.GenerateContentConfig
    Tools    map[string]any `json:"-"`
}
```

`Contents` 是一个 `[]*genai.Content` 切片，按时间顺序排列整个对话历史。每个 Content 的 Role 标识是 user 还是 model 发送的。这就是 LLM 理解上下文的基础。

### 4.2 LLMResponse.Content — 模型的响应内容

在 `model/llm.go:42-68`，`LLMResponse` 的核心字段就是 `Content`：

```go
type LLMResponse struct {
    Content             *genai.Content   // 模型生成的内容
    CitationMetadata    *genai.CitationMetadata
    GroundingMetadata   *genai.GroundingMetadata
    UsageMetadata       *genai.GenerateContentResponseUsageMetadata
    Partial             bool             // 流式场景下是否为部分响应
    TurnComplete        bool             // 流式场景下本轮是否完成
    Interrupted         bool             // 是否被用户中断
    ErrorCode           string
    ErrorMessage        string
    FinishReason        genai.FinishReason
    // ...
}
```

注意 `ErrorCode` 和 `ErrorMessage` 字段——这是 LLM 层面返回的错误信息，与 Go 的 error 接口是两个不同的概念。`Content` 可能为 nil（当发生错误时），所以访问前必须检查。

### 4.3 Event 中嵌入 LLMResponse

在 `session/session.go:92-118`，`Event` 结构体嵌入了 `model.LLMResponse`：

```go
type Event struct {
    model.LLMResponse          // 嵌入 LLM 响应，包含 Content

    ID           string
    Timestamp    time.Time
    InvocationID string
    Branch       string
    Author       string
    Actions      EventActions
    LongRunningToolIDs []string
}
```

这意味着每个 Event 天然携带了 `Content` 字段。在 Runner 消费迭代器时（runner/runner.go:234），它检查 Event 中的 Content.Parts 来判断是否包含函数调用：

```go
for event, err := range agentToRun.Run(ctx) {
    if err != nil {
        if !yield(event, err) {
            return
        }
        continue
    }
    // ...
}
```

### 4.4 Runner.Run() 的 msg 参数

Runner.Run() 的第四个参数 `msg *genai.Content`（runner/runner.go:131）就是用户输入。Runner 会将其包装为一个 Event 并追加到 Session 中（runner/runner.go:574-586）：

```go
event := session.NewEvent(ctx.InvocationID())
event.Author = "user"
event.LLMResponse = model.LLMResponse{
    Content: msg,
}
if stateDelta != nil {
    event.Actions.StateDelta = stateDelta
}
if err := r.sessionService.AppendEvent(ctx, storedSession, event); err != nil {
    return ctx, fmt.Errorf("failed to append event to sessionService: %w", err)
}
```

## 5. FunctionCall / FunctionResponse：工具调用流程

当模型决定调用工具时，`LLMResponse.Content.Parts` 中会包含 `FunctionCall` 类型的 Part：

```go
// 模型请求调用工具
&genai.Part{
    FunctionCall: &genai.FunctionCall{
        Name: "get_weather",
        Args: map[string]any{"city": "北京"},
        ID:   "call_abc123",     // 调用标识，用于匹配响应
    },
}
```

工具执行完成后，需要构造 `FunctionResponse` 类型的 Part 返回给模型：

```go
// 工具执行结果
&genai.Part{
    FunctionResponse: &genai.FunctionResponse{
        Name: "get_weather",
        Response: map[string]any{
            "temperature": "25°C",
            "condition":   "晴",
        },
        ID:   "call_abc123",     // 与 FunctionCall.ID 对应
    },
}
```

adk-go 在内部处理这个流程。在 `session/session.go:181-191`，`hasFunctionCalls` 辅助函数通过遍历 Content.Parts 检查是否存在 FunctionCall：

```go
func hasFunctionCalls(resp *model.LLMResponse) bool {
    if resp == nil || resp.Content == nil {
        return false
    }
    for _, part := range resp.Content.Parts {
        if part.FunctionCall != nil {
            return true
        }
    }
    return false
}
```

类似地，`hasFunctionResponses`（session/session.go:193-203）检查 FunctionResponse。`Event.IsFinalResponse()`（session/session.go:124-130）利用这两个检查来判断事件是否为最终响应——包含函数调用或函数响应的事件不是最终响应，agent 还需要继续处理。

## 6. 多模态 Parts：Blob 与 FileData

### 6.1 Blob — 内联二进制数据

`genai.Blob` 用于承载图片、音频、视频等内联二进制数据：

```go
type Blob struct {
    MIMEType string  // MIME 类型，如 "image/png"、"audio/wav"
    Data     []byte  // 原始二进制数据
}
```

在 Runner 中，当 `SaveInputBlobsAsArtifacts` 选项启用时，用户消息中的 Blob 会被保存为 Artifact，然后替换为文本占位符（runner/runner.go:558-571）：

```go
if artifactsService != nil && saveInputBlobsAsArtifacts {
    for i, part := range msg.Parts {
        if part.InlineData == nil {
            continue
        }
        fileName := fmt.Sprintf("artifact_%s_%d", ctx.InvocationID(), i)
        if _, err := artifactsService.Save(ctx, fileName, part); err != nil {
            return ctx, fmt.Errorf("failed to save artifact %s: %w", fileName, err)
        }
        msg.Parts[i] = &genai.Part{
            Text: fmt.Sprintf("Uploaded file: %s. It has been saved to the artifacts", fileName),
        }
    }
}
```

### 6.2 FileData — 文件引用

`genai.FileData` 用于引用已上传到 Google Cloud 的文件，避免在消息中传输大量二进制数据：

```go
type FileData struct {
    FileURI  string  // 文件 URI，如 "gs://bucket/file.pdf"
    MIMEType string  // MIME 类型
}
```

## 7. 与 eino schema.Message 对比

如果你之前使用过 eino 框架，以下是关键差异：

| 特性 | adk-go | eino |
|------|--------|------|
| 消息类型 | `genai.Content` | `schema.Message` |
| 内容载体 | `[]*genai.Part`（联合类型） | `[]schema.MessageContent` |
| 函数调用 | `genai.Part.FunctionCall` | 独立的 `schema.ToolCall` |
| 多模态 | `genai.Blob` / `genai.FileData` | `schema.ImageURL` / `schema.Binary` |
| 类型来源 | 上游 genai SDK | 框架自定义 |

adk-go 选择直接使用 genai 包的类型，**优势**是与 Google API 零转换开销，**代价**是与 Google 生态强耦合。这意味着当你切换到非 Google 的 LLM 后端时，需要一个适配层将其他 API 的消息格式转换为 genai.Content。

## 8. 常见陷阱

### 8.1 Part 类型的 nil 检查

由于 `genai.Part` 是联合类型，访问前必须检查具体字段是否为 nil：

```go
// 错误：直接访问 FunctionCall 可能 panic
name := part.FunctionCall.Name  // FunctionCall 可能为 nil！

// 正确：先做 nil 检查
if part.FunctionCall != nil {
    name := part.FunctionCall.Name
}
```

adk-go 内部到处都是这种模式，例如 session/session.go:185-189 的 `hasFunctionCalls` 函数。

### 8.2 Content.Role 设置

`genai.Content.Role` 必须正确设置为 `"user"` 或 `"model"`。在 agent/agent.go:238-243，框架通过 Role 判断 Event 的 Author：

```go
func getAuthorForEvent(ctx InvocationContext, event *session.Event) string {
    if event.LLMResponse.Content != nil && event.LLMResponse.Content.Role == genai.RoleUser {
        return genai.RoleUser
    }
    return ctx.Agent().Name()
}
```

如果你构造 Content 时忘了设置 Role，可能导致 Author 判断错误，进而影响 agent 路由逻辑。

### 8.3 Content 为 nil 的场景

在流式响应或错误场景中，`LLMResponse.Content` 可能为 nil。在 session/session.go:206-211，`hasTrailingCodeExecutionResult` 函数展示了正确的防御性编程：

```go
func hasTrailingCodeExecutionResult(resp *model.LLMResponse) bool {
    if resp == nil || resp.Content == nil || len(resp.Content.Parts) == 0 {
        return false
    }
    lastPart := resp.Content.Parts[len(resp.Content.Parts)-1]
    return lastPart.CodeExecutionResult != nil
}
```

### 8.4 修改 Content.Parts 的副作用

在 runner/runner.go:559-571 中，Runner 会直接修改 `msg.Parts`（将 Blob 替换为文本占位符）。这意味着传入的 `*genai.Content` 在 Run 之后可能已经变了。如果你需要在 Run 之后引用原始消息，应该提前做深拷贝。
