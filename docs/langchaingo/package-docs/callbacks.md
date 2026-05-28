# Callback 回调系统详解

LangChainGo 的 Callback 系统提供了贯穿整个 LLM 应用生命周期的钩子机制，允许开发者在 Chain、Agent、LLM、Tool 等组件的关键节点注入自定义逻辑，实现日志记录、监控、流式输出等功能。

---

## 1. Handler 接口

`callbacks.Handler` 是回调系统的核心接口，定义于 `callbacks/callbacks.go:14`：

```go
type Handler interface {
    HandleText(ctx context.Context, text string)
    HandleLLMStart(ctx context.Context, prompts []string)
    HandleLLMGenerateContentStart(ctx context.Context, ms []llms.MessageContent)
    HandleLLMGenerateContentEnd(ctx context.Context, res *llms.ContentResponse)
    HandleLLMError(ctx context.Context, err error)
    HandleChainStart(ctx context.Context, inputs map[string]any)
    HandleChainEnd(ctx context.Context, outputs map[string]any)
    HandleChainError(ctx context.Context, err error)
    HandleToolStart(ctx context.Context, input string)
    HandleToolEnd(ctx context.Context, output string)
    HandleToolError(ctx context.Context, err error)
    HandleAgentAction(ctx context.Context, action schema.AgentAction)
    HandleAgentFinish(ctx context.Context, finish schema.AgentFinish)
    HandleRetrieverStart(ctx context.Context, query string)
    HandleRetrieverEnd(ctx context.Context, query string, documents []schema.Document)
    HandleStreamingFunc(ctx context.Context, chunk []byte)
}
```

### 回调方法分类

#### LLM 相关

| 方法 | 行号 | 触发时机 | 参数说明 |
|------|------|----------|----------|
| `HandleLLMStart` | `callbacks.go:16` | LLM 调用开始 | `prompts`：发送给 LLM 的提示列表 |
| `HandleLLMGenerateContentStart` | `callbacks.go:17` | 内容生成开始 | `ms`：消息内容列表 |
| `HandleLLMGenerateContentEnd` | `callbacks.go:18` | 内容生成结束 | `res`：完整响应 |
| `HandleLLMError` | `callbacks.go:19` | LLM 调用出错 | `err`：错误信息 |
| `HandleStreamingFunc` | `callbacks.go:30` | 流式输出块 | `chunk`：字节块 |

#### Chain 相关

| 方法 | 行号 | 触发时机 | 参数说明 |
|------|------|----------|----------|
| `HandleChainStart` | `callbacks.go:20` | Chain 开始执行 | `inputs`：输入键值对 |
| `HandleChainEnd` | `callbacks.go:21` | Chain 执行完成 | `outputs`：输出键值对 |
| `HandleChainError` | `callbacks.go:22` | Chain 执行出错 | `err`：错误信息 |

#### Tool 相关

| 方法 | 行号 | 触发时机 | 参数说明 |
|------|------|----------|----------|
| `HandleToolStart` | `callbacks.go:23` | Tool 开始执行 | `input`：工具输入 |
| `HandleToolEnd` | `callbacks.go:24` | Tool 执行完成 | `output`：工具输出 |
| `HandleToolError` | `callbacks.go:25` | Tool 执行出错 | `err`：错误信息 |

#### Agent 相关

| 方法 | 行号 | 触发时机 | 参数说明 |
|------|------|----------|----------|
| `HandleAgentAction` | `callbacks.go:26` | Agent 决定动作 | `action`：AgentAction（工具名+输入） |
| `HandleAgentFinish` | `callbacks.go:27` | Agent 完成执行 | `finish`：AgentFinish（最终返回值） |

#### Retriever 相关

| 方法 | 行号 | 触发时机 | 参数说明 |
|------|------|----------|----------|
| `HandleRetrieverStart` | `callbacks.go:28` | 检索开始 | `query`：查询字符串 |
| `HandleRetrieverEnd` | `callbacks.go:29` | 检索完成 | `query`+`documents`：查询和结果文档 |

#### 通用

| 方法 | 行号 | 触发时机 |
|------|------|----------|
| `HandleText` | `callbacks.go:15` | 处理任意文本 |

### HandlerHaver 接口

`callbacks/callbacks.go:34` 定义了获取回调处理器的接口：

```go
type HandlerHaver interface {
    GetCallbackHandler() Handler
}
```

实现了此接口的组件（如 `LLMChain`、`Executor`）可自动将回调注入到 `chains.Call` 流程中。

---

## 2. LogHandler 日志回调

`callbacks.LogHandler` 是最常用的回调实现，将所有事件打印到标准输出。定义于 `callbacks/log.go:14`：

```go
type LogHandler struct{}
```

### 各方法输出格式

| 方法 | 行号 | 输出示例 |
|------|------|----------|
| `HandleLLMStart` | `:62` | `Entering LLM with prompts: [...]` |
| `HandleLLMGenerateContentStart` | `:18` | `Entering LLM with messages:` + Role/Text |
| `HandleLLMGenerateContentEnd` | `:33` | `Exiting LLM with response:` + Content/StopReason/FuncCall |
| `HandleLLMError` | `:66` | `Exiting LLM with error: ...` |
| `HandleChainStart` | `:70` | `Entering chain with inputs: ...` |
| `HandleChainEnd` | `:74` | `Exiting chain with outputs: ...` |
| `HandleChainError` | `:78` | `Exiting chain with error: ...` |
| `HandleToolStart` | `:82` | `Entering tool with input: ...` |
| `HandleToolEnd` | `:86` | `Exiting tool with output: ...` |
| `HandleToolError` | `:90` | `Exiting tool with error: ...` |
| `HandleAgentAction` | `:94` | `Agent selected action: "tool_name" with input "..."` |
| `HandleAgentFinish` | `:98` | `Agent finish: ...` |
| `HandleRetrieverStart` | `:102` | `Entering retriever with query: ...` |
| `HandleRetrieverEnd` | `:106` | `Exiting retriever with documents for query: ...` |
| `HandleStreamingFunc` | `:54` | 直接打印 chunk 字符串 |
| `HandleText` | `:58` | 直接打印文本 |

### 辅助函数

- `formatChainValues`（`:110`）：格式化 Chain 输入/输出为字符串
- `formatAgentAction`（`:119`）：格式化 Agent 动作
- `removeNewLines`（`:123`）：移除换行符，使输出更紧凑

---

## 3. Handler 动态切换

### 3.1 SimpleHandler 空实现

`callbacks/simple.go:11` 提供了所有方法均为空操作的实现：

```go
type SimpleHandler struct{}
```

所有 16 个方法均为空实现，用作嵌入其他 Handler 的基础，只需覆盖感兴趣的方法。

### 3.2 StreamLogHandler 流式日志

`callbacks/log_stream.go:10` 继承 `SimpleHandler`，仅覆盖流式输出方法：

```go
type StreamLogHandler struct {
    SimpleHandler
}
```

`HandleStreamingFunc`（`:16`）打印流式块，其余方法静默。

### 3.3 CombiningHandler 组合回调

`callbacks/combining.go:11` 允许同时使用多个 Handler：

```go
type CombiningHandler struct {
    Callbacks []Handler
}
```

每个方法都遍历 `Callbacks` 切片，依次调用对应方法。例如 `HandleLLMStart`（`:23`）：

```go
func (l CombiningHandler) HandleLLMStart(ctx context.Context, prompts []string) {
    for _, handle := range l.Callbacks {
        handle.HandleLLMStart(ctx, prompts)
    }
}
```

使用方式：

```go
handler := callbacks.CombiningHandler{
    Callbacks: []callbacks.Handler{
        callbacks.LogHandler{},
        myCustomHandler{},
    },
}
```

### 3.4 AgentFinalStreamHandler Agent 流式输出

`callbacks/agent_final_stream.go:13` 专门用于捕获 Agent 的最终输出流：

```go
type AgentFinalStreamHandler struct {
    SimpleHandler
    egress          chan []byte
    Keywords        []string
    LastTokens      string
    KeywordDetected bool
    PrintOutput     bool
}
```

#### 工作原理

1. `NewFinalStreamHandler`（`:32`）创建处理器，默认监听 `"Final Answer:"`、`"Final:"`、`"AI:"` 关键词
2. `HandleStreamingFunc`（`:76`）：
   - 累积接收到的 chunk 到 `LastTokens`
   - 检测是否包含关键词
   - 一旦检测到关键词，开始将后续数据发送到 `egress` 通道
3. `GetEgress`（`:47`）获取输出通道
4. `ReadFromEgress`（`:57`）从通道读取数据并调用回调

```go
handler := callbacks.NewFinalStreamHandler()
go handler.ReadFromEgress(ctx, func(ctx context.Context, chunk []byte) {
    fmt.Print(string(chunk))
})
```

---

## 4. 与 Chain/Agent/Model 的集成点

### 4.1 Chain 中的回调

`chains.Call`（`chains/chains.go:30`）在关键节点触发回调：

```go
func Call(ctx context.Context, c Chain, inputValues map[string]any, ...) (map[string]any, error) {
    // 获取回调处理器
    callbacksHandler := getChainCallbackHandler(c)  // chains/chains.go:45

    callbacksHandler.HandleChainStart(ctx, inputValues)    // :47

    outputValues, err := callChain(ctx, c, fullValues, options...)

    if err != nil {
        callbacksHandler.HandleChainError(ctx, err)       // :53
    }

    callbacksHandler.HandleChainEnd(ctx, outputValues)     // :59
}
```

`getChainCallbackHandler`（`chains/chains.go:255`）检查 Chain 是否实现了 `HandlerHaver` 接口。

### 4.2 LLMChain 中的回调

`LLMChain`（`chains/llm.go:16`）实现了 `HandlerHaver`：

```go
type LLMChain struct {
    // ...
    CallbacksHandler callbacks.Handler  // :20
}

func (c LLMChain) GetCallbackHandler() callbacks.Handler {  // :77
    return c.CallbacksHandler
}
```

### 4.3 Agent Executor 中的回调

`Executor`（`agents/executor.go:18`）同样实现了 `HandlerHaver`：

```go
type Executor struct {
    // ...
    CallbacksHandler callbacks.Handler  // :21
}
```

在执行循环中触发 Agent 相关回调：

- `HandleAgentAction`（`agents/executor.go:127`）：Agent 选择工具时触发
- `HandleAgentFinish`（`agents/executor.go:67`）：Agent 完成时触发

### 4.4 Retriever 中的回调

`vectorstores.Retriever`（`vectorstores/vectorstores.go:18`）在检索前后触发回调：

```go
func (r Retriever) GetRelevantDocuments(ctx context.Context, query string) ([]schema.Document, error) {
    if r.CallbacksHandler != nil {
        r.CallbacksHandler.HandleRetrieverStart(ctx, query)   // :30
    }
    docs, _ := r.v.SimilaritySearch(ctx, query, r.numDocs, r.options...)
    if r.CallbacksHandler != nil {
        r.CallbacksHandler.HandleRetrieverEnd(ctx, query, docs)  // :39
    }
    return docs, nil
}
```

### 4.5 完整使用示例

```go
package main

import (
    "context"
    "github.com/tmc/langchaingo/callbacks"
    "github.com/tmc/langchaingo/chains"
    "github.com/tmc/langchaingo/llms/openai"
    "github.com/tmc/langchaingo/prompts"
)

// 自定义回调处理器
type MyHandler struct {
    callbacks.SimpleHandler
}

func (h MyHandler) HandleChainStart(_ context.Context, inputs map[string]any) {
    fmt.Printf("Chain 开始执行，输入: %v\n", inputs)
}

func (h MyHandler) HandleChainEnd(_ context.Context, outputs map[string]any) {
    fmt.Printf("Chain 执行完成，输出: %v\n", outputs)
}

func (h MyHandler) HandleStreamingFunc(_ context.Context, chunk []byte) {
    fmt.Print(string(chunk))
}

func main() {
    ctx := context.Background()
    llm, _ := openai.New()

    prompt := prompts.NewPromptTemplate(
        "用一句话解释{{.concept}}",
        []string{"concept"},
    )

    chain := chains.NewLLMChain(llm, prompt)
    chain.CallbacksHandler = MyHandler{}  // 注入自定义回调

    result, _ := chains.Call(ctx, chain, map[string]any{
        "concept": "Go 语言的 goroutine",
    })
    _ = result
}
```

### 4.6 回调集成总结

| 组件 | 集成方式 | 触发的回调 |
|------|----------|------------|
| Chain | `GetCallbackHandler()` 实现 `HandlerHaver` | ChainStart/End/Error |
| LLMChain | `CallbacksHandler` 字段 | Chain + LLM 回调 |
| Agent Executor | `CallbacksHandler` 字段 | AgentAction/Finish + Tool 回调 |
| Retriever | `CallbacksHandler` 字段 | RetrieverStart/End |
