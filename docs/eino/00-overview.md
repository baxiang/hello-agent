# Eino 项目概览

> Eino（发音 "I-know"）是字节跳动 CloudWeGo 团队开源的 Go 语言 LLM 应用开发框架。

## 1. 项目简介

Eino 提供了一套类型安全的组件抽象、流式处理机制、图编排能力和 Agent 开发套件，旨在让开发者以 Go 语言构建生产级 LLM 应用。框架核心理念是：**用编译时类型检查代替运行时反射错误，用流式优先设计代替事后补丁，用可组合的图编排代替硬编码流程**。

```go
// 最简示例：构建一个带工具调用的 ChatModel Agent
agent, _ := adk.NewChatModelAgent(ctx, &adk.ChatModelAgentConfig{
    Model:       chatModel,      // 实现 model.BaseChatModel 接口
    Tools:       []tool.BaseTool{searchTool, calcTool},
    MaxIterations: 5,
})
runner := adk.NewRunner(agent)
iter := runner.Run(ctx, "今天北京天气如何？")
```

源码入口：`adk/chatmodel.go:484`（NewChatModelAgent）、`adk/runner.go:55`（TypedRunner）。

---

## 2. 设计哲学

### 2.1 类型安全

Eino 大量使用 Go 1.18+ 泛型，在编译期约束数据流转。核心接口均为泛型参数化：

```go
// compose/runnable.go:32-37
type Runnable[I, O any] interface {
    Invoke(ctx context.Context, input I, opts ...Option) (output O, err error)
    Stream(ctx context.Context, input I, opts ...Option) (output *schema.StreamReader[O], err error)
    Collect(ctx context.Context, input *schema.StreamReader[I], opts ...Option) (output O, err error)
    Transform(ctx context.Context, input *schema.StreamReader[I], opts ...Option) (output *schema.StreamReader[O], err error)
}
```

模型接口同样参数化（`components/model/interface.go:36`）：

```go
type BaseModel[M messageType] interface {
    Generate(ctx context.Context, input []M, opts ...Option) (M, error)
    Stream(ctx context.Context, input []M, opts ...Option) (*schema.StreamReader[M], error)
}
```

### 2.2 流式优先

流式处理不是事后补丁，而是框架的基石。`schema.StreamReader[T]` / `schema.StreamWriter[T]` 贯穿所有组件，支持 Token 级别的增量输出。四种数据流模式（Invoke/Stream/Collect/Transform）通过自动降级机制互联互通。

### 2.3 可组合性

三种编排方式满足不同复杂度：

- **Chain**：线性管道，适合 Prompt → Model → Output 等顺序流程
- **Graph**：有向图，支持分支、循环、并发，适合复杂 DAG
- **Workflow**：声明式依赖映射，通过字段绑定自动推导执行顺序

### 2.4 回调可观测性

5 种回调时机（`callbacks/interface.go:114-134`）覆盖组件全生命周期，支持日志、追踪、指标采集等可观测性需求。框架自动处理流式回调的 StreamReader 拷贝，开发者只需实现 `Handler` 接口。

---

## 3. 核心概念

### 3.1 Schema — 统一数据模型

Schema 层定义了所有组件共享的数据结构，位于 `schema/` 包。

```go
// schema/message.go:497 — 消息结构
msg := &schema.Message{
    Role:    schema.User,
    Content: "你好，Eino！",
}

// 多模态输入
msg := &schema.Message{
    Role: schema.User,
    UserInputMultiContent: []schema.MessageInputPart{
        {Type: schema.ChatMessagePartTypeText, Text: "描述这张图片"},
        {Type: schema.ChatMessagePartTypeImageURL, Image: &schema.MessageInputImage{
            MessagePartCommon: schema.MessagePartCommon{URL: ptr("https://example.com/img.png")},
        }},
    },
}
```

关键类型：

| 类型 | 位置 | 说明 |
|------|------|------|
| `Message` | `schema/message.go:497` | 统一消息模型，支持文本/多模态/工具调用 |
| `RoleType` | `schema/message.go:108` | 角色：User/Assistant/System/Tool |
| `ToolCall` | `schema/message.go:132` | 工具调用结构（ID, Type, Function） |
| `FormatType` | `schema/message.go:96` | 模板格式：FString/GoTemplate/Jinja2 |
| `Document` | `schema/document.go:40` | 文档结构（ID, Content, MetaData） |
| `ToolInfo` | `schema/tool.go:128` | 工具元信息（Name, Desc, ParamsOneOf） |
| `ToolChoice` | `schema/tool.go:48` | 工具选择策略：forbidden/allowed/forced |
| `StreamReader[T]` | `schema/stream.go:168` | 流式读取器 |
| `StreamWriter[T]` | `schema/stream.go:115` | 流式写入器 |

### 3.2 Components — 组件接口

7 种组件接口定义了 LLM 应用的标准构建块，位于 `components/` 包。

```go
// 组件接口速览
model.BaseChatModel      // Generate + Stream（components/model/interface.go:71，类型别名 = BaseModel[*Message]）
tool.InvokableTool       // Info + InvokableRun（components/tool/interface.go:42）
prompt.ChatTemplate      // Format（components/prompt/interface.go:43）
retriever.Retriever      // Retrieve
embedding.Embedder       // EmbedStrings
indexer.Indexer          // Store
document.Loader          // Load
document.Transformer     // Transform
```

工具接口层次（`components/tool/interface.go:32-79`）：

```go
// 基础：只提供元数据
type BaseTool interface {
    Info(ctx context.Context) (*schema.ToolInfo, error)
}

// 可调用：同步执行
type InvokableTool interface {
    BaseTool
    InvokableRun(ctx context.Context, argumentsInJSON string, opts ...Option) (string, error)
}

// 流式工具：流式输出
type StreamableTool interface {
    BaseTool
    StreamableRun(ctx context.Context, argumentsInJSON string, opts ...Option) (*schema.StreamReader[string], error)
}

// 增强工具：多模态结果
type EnhancedInvokableTool interface {
    BaseTool
    InvokableRun(ctx context.Context, toolArgument *schema.ToolArgument, opts ...Option) (*schema.ToolResult, error)
}
```

### 3.3 Compose — 编排方式

三种编排方式编译后均产生 `Runnable[I, O]`，拥有统一的 Invoke/Stream/Collect/Transform 调用接口。

```go
// Chain：线性管道
chain := compose.NewChain[map[string]any, *schema.Message]()
chain.AppendChatTemplate(template).AppendChatModel(model)

// Graph：有向图
graph := compose.NewGraph[map[string]any, *schema.Message]()
graph.AddChatModelNode("model", model)
graph.AddRetrieverNode("retriever", retriever)
graph.AddEdge(compose.START, "retriever")
graph.AddEdge("retriever", "model")
graph.AddEdge("model", compose.END)

// Workflow：声明式依赖
wf := compose.NewWorkflow[map[string]any, *schema.Message]()
wf.AddChatModelNode("model", model)
wf.AddRetrieverNode("retriever", retriever)
```

### 3.4 Callbacks — 回调体系

5 种回调时机（`callbacks/interface.go:114-134`）：

| 时机 | 说明 | 触发场景 |
|------|------|---------|
| `TimingOnStart` | 组件开始处理前 | Invoke 调用 |
| `TimingOnEnd` | 组件成功返回后 | Invoke 调用 |
| `TimingOnError` | 组件返回错误时 | 任意调用 |
| `TimingOnStartWithStreamInput` | 组件接收流式输入时 | Collect/Transform |
| `TimingOnEndWithStreamOutput` | 组件返回流式输出时 | Stream/Transform |

```go
// 使用 HandlerBuilder 创建回调
handler := callbacks.NewHandlerBuilder().
    OnStart(func(ctx context.Context, info *callbacks.RunInfo, input callbacks.CallbackInput) context.Context {
        log.Printf("组件 %s 开始执行", info.Name)
        return ctx
    }).
    OnEndWithStreamOutput(func(ctx context.Context, info *callbacks.RunInfo, output *schema.StreamReader[callbacks.CallbackOutput]) context.Context {
        // 处理流式输出回调
        return ctx
    }).
    Build()
```

### 3.5 Flow — 预构建流程

Flow 层提供开箱即用的 Agent 和 RAG 流程：

| 流程 | 位置 | 说明 |
|------|------|------|
| **React Agent** | `flow/agent/react/` | ReAct 循环（推理→行动→观察） |
| **MultiQuery** | `flow/retriever/multiquery/` | 多查询检索增强 |
| **RetrieverRouter** | `flow/retriever/router/` | 检索器路由 |
| **ParentIndexer** | `flow/indexer/parent/` | 父子文档索引 |
| **MultiAgent Host** | `flow/agent/multiagent/host/` | 多 Agent 编排宿主 |

### 3.6 ADK — Agent 开发套件

ADK（Agent Development Kit）是 Eino 的高层抽象，提供完整的 Agent 开发体验。

核心类型（`adk/interface.go:453`）：

```go
// 统一 Agent 接口
type TypedAgent[M MessageType] interface {
    Name(ctx context.Context) string
    Description(ctx context.Context) string
    Run(ctx context.Context, input *TypedAgentInput[M], options ...AgentRunOption) *AsyncIterator[*TypedAgentEvent[M]]
}
```

关键组件：

| 组件 | 说明 |
|------|------|
| **ChatModelAgent** | 基于 ChatModel 的 ReAct Agent（`adk/chatmodel.go:457`） |
| **Runner** | Agent 执行入口，管理生命周期和检查点（`adk/runner.go:55`） |
| **NewAgentTool** | 将 Agent 包装为工具，实现多 Agent 协作（`adk/agent_tool.go:93`） |
| **Middleware** | 拦截器模式，支持重试/降级/日志等横切关注点（`adk/middlewares/`） |
| **Prebuilt Agents** | 预构建 Agent：Deep、PlanExecute、Supervisor（`adk/prebuilt/`） |

---

## 4. 模块总览表

| 模块 | 包路径 | 职责 | 关键接口/类型 |
|------|--------|------|--------------|
| **Schema** | `github.com/cloudwego/eino/schema` | 统一数据模型 | `Message`, `Document`, `ToolInfo`, `StreamReader[T]`, `StreamWriter[T]` |
| **Components** | `github.com/cloudwego/eino/components` | 组件类型系统 | `Component`, `Typer`, `Checker` |
| **Model** | `github.com/cloudwego/eino/components/model` | 大语言模型 | `BaseModel[M]`, `ToolCallingChatModel`, `AgenticModel` |
| **Tool** | `github.com/cloudwego/eino/components/tool` | 工具调用 | `BaseTool`, `InvokableTool`, `StreamableTool`, `EnhancedInvokableTool` |
| **Prompt** | `github.com/cloudwego/eino/components/prompt` | 提示词模板 | `ChatTemplate`, `AgenticChatTemplate` |
| **Retriever** | `github.com/cloudwego/eino/components/retriever` | 文档检索 | `Retriever` |
| **Embedding** | `github.com/cloudwego/eino/components/embedding` | 向量嵌入 | `Embedder` |
| **Indexer** | `github.com/cloudwego/eino/components/indexer` | 文档索引 | `Indexer` |
| **Document** | `github.com/cloudwego/eino/components/document` | 文档加载/转换 | `Loader`, `Transformer` |
| **Compose** | `github.com/cloudwego/eino/compose` | 流程编排 | `Runnable[I,O]`, `Graph`, `Chain`, `Workflow` |
| **Callbacks** | `github.com/cloudwego/eino/callbacks` | 可观测性回调 | `Handler`, `CallbackTiming`, `TimingChecker` |
| **Flow** | `github.com/cloudwego/eino/flow` | 预构建流程 | `react.Agent`, `multiquery.MultiQuery`, `router.Router` |
| **ADK** | `github.com/cloudwego/eino/adk` | Agent 开发套件 | `TypedAgent[M]`, `TypedRunner[M]`, `AgentTool`, `ChatModelAgentMiddleware` |
| **Internal** | `github.com/cloudwego/eino/internal` | 内部工具 | `generic`, `safe`, `core`, `serialization` |

---

## 5. 快速上手

```go
package main

import (
    "context"
    "fmt"

    "github.com/cloudwego/eino/adk"
    "github.com/cloudwego/eino/components/model"
    "github.com/cloudwego/eino/schema"
)

func main() {
    ctx := context.Background()

    // 1. 创建 ChatModel（需引入具体实现，如 openai）
    // chatModel, _ := openai.NewChatModel(ctx, &openai.ChatModelConfig{...})

    // 2. 创建 Agent
    agent, err := adk.NewChatModelAgent(ctx, &adk.ChatModelAgentConfig{
        Model:         chatModel,  // 实现 model.BaseChatModel
        MaxIterations: 5,
    })
    if err != nil {
        panic(err)
    }

    // 3. 创建 Runner 并执行
    runner := adk.NewRunner(agent)
    iter := runner.Run(ctx, "介绍一下 Eino 框架")

    // 4. 迭代消费 Agent 事件
    for iter.Next() {
        event := iter.Event()
        if event.Err != nil {
            fmt.Println("错误:", event.Err)
            continue
        }
        if event.Output != nil && event.Output.MessageOutput != nil {
            msg, _ := event.Output.MessageOutput.GetMessage()
            fmt.Println(msg.Content)
        }
    }
}
```
