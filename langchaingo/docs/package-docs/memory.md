# Memory 记忆系统详解

LangChainGo 的 Memory 系统为 Chain 和 Agent 提供了对话上下文的持久化与检索能力。通过记忆机制，LLM 应用能够在多轮交互中维持状态，实现连贯的对话体验。

---

## 1. Memory 接口

`schema.Memory` 是所有记忆实现的核心接口，定义于 `schema/memory.go:6`：

```go
// Memory 是链中记忆的接口
type Memory interface {
    GetMemoryKey(ctx context.Context) string
    MemoryVariables(ctx context.Context) []string
    LoadMemoryVariables(ctx context.Context, inputs map[string]any) (map[string]any, error)
    SaveContext(ctx context.Context, inputs map[string]any, outputs map[string]any) error
    Clear(ctx context.Context) error
}
```

### 方法详解

| 方法 | 行号 | 说明 |
|------|------|------|
| `GetMemoryKey` | `schema/memory.go:8` | 返回记忆在上下文中的键名（如 `"history"`），Chain 通过此键获取记忆内容 |
| `MemoryVariables` | `schema/memory.go:10` | 声明该 Memory 将向 Chain 输入注入哪些变量，通常返回 `[MemoryKey]` |
| `LoadMemoryVariables` | `schema/memory.go:13` | 在 Chain 调用前加载记忆，返回的键值对会合并到 Chain 的输入中 |
| `SaveContext` | `schema/memory.go:15` | 在 Chain 调用后保存输入/输出上下文，通常分别保存为 Human 和 AI 消息 |
| `Clear` | `schema/memory.go:17` | 重置记忆状态，清空所有存储的消息 |

接口设计遵循"加载-使用-保存"的生命周期：Chain 在执行前调用 `LoadMemoryVariables`，执行后调用 `SaveContext`。

---

## 2. ChatMessageHistory 接口

`ChatMessageHistory` 是消息存储的底层接口，定义于 `schema/chat_message_history.go:10`：

```go
type ChatMessageHistory interface {
    AddMessage(ctx context.Context, message llms.ChatMessage) error
    AddUserMessage(ctx context.Context, message string) error
    AddAIMessage(ctx context.Context, message string) error
    Clear(ctx context.Context) error
    Messages(ctx context.Context) ([]llms.ChatMessage, error)
    SetMessages(ctx context.Context, messages []llms.ChatMessage) error
}
```

### 内置实现：ChatMessageHistory

`memory/chat.go:11` 提供了基于内存切片的默认实现：

```go
type ChatMessageHistory struct {
    messages []llms.ChatMessage
}
```

关键实现细节：

- `AddUserMessage`（`memory/chat.go:35`）：将文本包装为 `llms.HumanChatMessage` 并追加到切片
- `AddAIMessage`（`memory/chat.go:29`）：将文本包装为 `llms.AIChatMessage` 并追加到切片
- `AddMessage`（`memory/chat.go:45`）：直接追加任意类型的 `llms.ChatMessage`
- `SetMessages`（`memory/chat.go:50`）：直接替换消息切片，用于窗口裁剪等场景
- `Clear`（`memory/chat.go:40`）：创建新的空切片

### 持久化实现

| 实现 | 路径 | 说明 |
|------|------|------|
| SQLite | `memory/sqlite3/` | 基于 SQLite 的持久化存储 |
| MongoDB | `memory/mongo/` | 基于 MongoDB 的持久化存储 |
| Zep | `memory/zep/` | 基于 Zep 记忆服务的存储 |
| AlloyDB | `memory/alloydb/` | 基于 Google AlloyDB 的存储 |
| CloudSQL | `memory/cloudsql/` | 基于 Google CloudSQL 的存储 |

### 创建方式

使用函数式选项模式创建（`memory/chat_options.go:17`）：

```go
history := memory.NewChatMessageHistory()

history := memory.NewChatMessageHistory(
    memory.WithPreviousMessages([]llms.ChatMessage{
        llms.HumanChatMessage{Content: "你好"},
        llms.AIChatMessage{Content: "你好！有什么可以帮助你的？"},
    }),
)
```

`WithPreviousMessages` 选项（`memory/chat_options.go:11`）允许在创建时注入预置消息。

---

## 3. Buffer 模式

### 3.1 ConversationBuffer

`ConversationBuffer` 完整保留所有对话历史。定义于 `memory/buffer.go:16`：

```go
type ConversationBuffer struct {
    ChatHistory    schema.ChatMessageHistory
    ReturnMessages bool
    InputKey       string
    OutputKey      string
    HumanPrefix    string
    AIPrefix       string
    MemoryKey      string
}
```

- **LoadMemoryVariables**（`memory/buffer.go:44`）：返回消息列表或格式化字符串
- **SaveContext**（`memory/buffer.go:75`）：提取输入输出并保存为 Human/AI 消息

```go
buffer := memory.NewConversationBuffer(
    memory.WithMemoryKey("chat_history"),
    memory.WithReturnMessages(true),
)
```

可选配置项（`memory/buffer_options.go`）：

| 选项 | 行号 | 默认值 | 说明 |
|------|------|--------|------|
| `WithChatHistory` | `:10` | `NewChatMessageHistory()` | 自定义消息存储后端 |
| `WithReturnMessages` | `:17` | `false` | 返回消息对象而非字符串 |
| `WithInputKey` | `:24` | `""` | 指定输入键名 |
| `WithOutputKey` | `:31` | `""` | 指定输出键名 |
| `WithHumanPrefix` | `:38` | `"Human"` | 人类消息前缀 |
| `WithAIPrefix` | `:45` | `"AI"` | AI 消息前缀 |
| `WithMemoryKey` | `:52` | `"history"` | 记忆键名 |

默认值在 `applyBufferOptions`（`memory/buffer_options.go:58`）中设置。

### 3.2 ConversationWindowBuffer

`ConversationWindowBuffer` 增加滑动窗口限制，只保留最近 K 轮对话。定义于 `memory/window_buffer.go:18`：

```go
type ConversationWindowBuffer struct {
    ConversationBuffer
    ConversationWindowSize int  // 保留的对话轮数
}
```

常量（`memory/window_buffer.go:10`）：`defaultConversationWindowSize=5`，`defaultMessageSize=2`

`cutMessages`（`:92`）：消息数超过 `WindowSize*2` 时截取最后 N 条。

```go
windowBuffer := memory.NewConversationWindowBuffer(2,
    memory.WithMemoryKey("chat_history"),
    memory.WithReturnMessages(true),
)
```

### 3.3 ConversationTokenBuffer

基于 Token 数量限制裁剪记忆。定义于 `memory/token_buffer.go:11`：

```go
type ConversationTokenBuffer struct {
    ConversationBuffer
    LLM           llms.Model
    MaxTokenLimit int
}
```

`SaveContext`（`:48`）：保存后计算 Token 总数（`getNumTokensFromMessages`，`:93`），超过限制时循环移除最早消息。

---

## 4. Summary 模式

> 注意：当前 langchaingo 的 memory 包未提供独立的 `ConversationSummary` 实现。如需摘要记忆，可通过组合 `LLMChain` 和 `ConversationBuffer` 自行实现。

典型的摘要记忆实现思路：

```go
type ConversationSummary struct {
    Buffer  memory.ConversationBuffer
    LLM     llms.Model
    Summary string
}

func (s *ConversationSummary) SaveContext(ctx context.Context, inputs, outputs map[string]any) error {
    newSummary, _ := llms.GenerateFromSinglePrompt(ctx, s.LLM,
        fmt.Sprintf("请根据以下对话历史生成简洁摘要：%s", s.Summary))
    s.Summary = newSummary
    return nil
}
```

`ConversationalRetrievalQA` 链（`chains/conversational_retrieval_qa.go:18`）提供了另一种思路：通过 `CondenseQuestionChain` 将历史对话和新问题压缩为一个独立问题。

---

## 5. 与 Chain/Agent 的集成

### 5.1 Chain 接口

`Chain` 接口要求实现 `GetMemory()` 方法（`chains/chains.go:22`）：

```go
type Chain interface {
    Call(ctx context.Context, inputs map[string]any, options ...ChainCallOption) (map[string]any, error)
    GetMemory() schema.Memory
    GetInputKeys() []string
    GetOutputKeys() []string
}
```

### 5.2 Chain 调用流程中的 Memory

`chains.Call` 函数（`chains/chains.go:30`）展示了记忆的完整生命周期：

```go
func Call(ctx context.Context, c Chain, inputValues map[string]any, ...) (map[string]any, error) {
    fullValues := make(map[string]any)
    // 1. 复制用户输入
    for key, value := range inputValues {
        fullValues[key] = value
    }
    // 2. 从记忆中加载变量（chains/chains.go:36）
    newValues, err := c.GetMemory().LoadMemoryVariables(ctx, inputValues)
    for key, value := range newValues {
        fullValues[key] = value
    }
    // 3. 执行链逻辑
    outputValues, err := callChain(ctx, c, fullValues, options...)
    // 4. 保存到记忆（chains/chains.go:62）
    c.GetMemory().SaveContext(ctx, inputValues, outputValues)
    return outputValues, nil
}
```

### 5.3 LLMChain 中的 Memory

`LLMChain`（`chains/llm.go:16`）默认使用 `Simple` 记忆（空实现）：

```go
func NewLLMChain(llm llms.Model, prompt prompts.FormatPrompter, ...) *LLMChain {
    chain := &LLMChain{
        Memory: memory.NewSimple(), // 默认无记忆（chains/llm.go:41）
    }
    return chain
}
```

要为 LLMChain 启用记忆，需要手动设置：

```go
llmChain := chains.NewLLMChain(llm, prompt)
llmChain.Memory = memory.NewConversationBuffer()
```

### 5.4 ConversationalRetrievalQA 中的 Memory

`ConversationalRetrievalQA`（`chains/conversational_retrieval_qa.go:18`）是记忆集成的典型示例，在 `Call` 方法中（`chains/conversational_retrieval_qa.go:91`）从 Memory 获取聊天历史：

```go
chatHistoryStr, ok := values[c.Memory.GetMemoryKey(ctx)].(string)
if !ok {
    chatHistory, _ := values[c.Memory.GetMemoryKey(ctx)].([]llms.ChatMessage)
    chatHistoryStr, _ = llms.GetBufferString(chatHistory, "Human", "AI")
}
```

### 5.5 Agent Executor 中的 Memory

`Executor`（`agents/executor.go:18`）通过 `WithMemory` 选项（`agents/options.go:143`）注入记忆：

```go
executor := agents.NewExecutor(
    agent,
    agents.WithMemory(memory.NewConversationBuffer()),
)
```

### 5.6 Simple 空实现

`memory/simple.go:11` 提供了空实现，所有方法均为空操作。

### 5.7 完整集成示例

```go
chatMemory := memory.NewConversationWindowBuffer(
    5,
    memory.WithMemoryKey("chat_history"),
    memory.WithReturnMessages(true),
)
prompt := prompts.NewChatPromptTemplate([]prompts.MessageFormatter{
    prompts.NewSystemMessagePromptTemplate("你是一个有用的助手", nil),
    prompts.MessagesPlaceholder{VariableName: "chat_history"},
    prompts.NewHumanMessagePromptTemplate("{{.question}}", []string{"question"}),
})
llmChain := chains.NewLLMChain(llm, prompt)
llmChain.Memory = chatMemory

// 第一次对话
chains.Call(ctx, llmChain, map[string]any{"question": "langchaingo 是什么？"})
// 第二次对话 - 记忆自动包含历史
chains.Call(ctx, llmChain, map[string]any{"question": "它有哪些主要功能？"})
```

---

## 记忆类型对比

| 类型 | 结构体 | 裁剪策略 | 适用场景 |
|------|--------|----------|----------|
| 完整缓冲 | `ConversationBuffer` | 无裁剪 | 短对话、需要完整历史 |
| 滑动窗口 | `ConversationWindowBuffer` | 按 K 轮裁剪 | 中等长度对话 |
| Token 限制 | `ConversationTokenBuffer` | 按 Token 数裁剪 | 需要精确控制上下文长度 |
| 空实现 | `Simple` | 无操作 | 无状态链 |
