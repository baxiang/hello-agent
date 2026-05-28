# LangChainGo 项目总览

## 1. 项目简介

`tmc/langchaingo` 是 Go 语言实现的 LangChain 框架，为开发者提供构建大语言模型（LLM）应用所需的核心抽象与工具集。项目模块路径为 `github.com/tmc/langchaingo`（见 `go.mod:1`），要求 Go 1.24+。

LangChainGo 的目标是将 LLM 与外部数据源、工具、记忆系统组合成强大的应用，覆盖从简单对话到复杂 RAG（检索增强生成）的全场景。得益于 Go 的模块图剪枝机制（见 `go.mod:7-12`），用户只需导入特定包即可获得最小依赖，不会拉入全部提供商的 SDK。

## 2. 设计哲学

### 2.1 接口驱动

LangChainGo 的核心抽象全部基于 Go 接口定义：

- `llms.Model` — 模型接口（`llms/llms.go:15`）
- `chains.Chain` — 链接口（`chains/chains.go:16`）
- `agents.Agent` — 智能体接口（`agents/agents.go:12`）
- `tools.Tool` — 工具接口（`tools/tool.go:6`）
- `schema.Memory` — 记忆接口（`schema/memory.go:6`）
- `embeddings.Embedder` — 嵌入接口（`embeddings/embedding.go:27`）
- `vectorstores.VectorStore` — 向量存储接口（`vectorstores/vectorstores.go:12`）

所有具体实现均通过接口解耦，遵循 Go 的"接受接口，返回结构体"惯例。

### 2.2 函数选项模式

项目中大量使用 `With*` 函数选项模式（Functional Options），而非构造函数参数列表：

```go
// llms/options.go:157 - 模型选项
func WithModel(model string) CallOption

// llms/options.go:179 - 温度选项
func WithTemperature(temperature float64) CallOption

// llms/openai/openaillm_option.go:63 - Token 选项
func WithToken(token string) Option

// chains/options.go:87 - Chain 温度选项
func WithTemperature(temperature float64) ChainCallOption

// agents/options.go:93 - 最大迭代次数
func WithMaxIterations(iterations int) Option
```

该模式使 API 具备良好的向后兼容性：新增选项不会破坏已有调用。

### 2.3 组合优于继承

Go 没有类继承，LangChainGo 充分利用结构体嵌入和接口组合：

- `ConversationWindowBuffer` 嵌入 `ConversationBuffer`（`memory/window_buffer.go:18-21`）
- `RetrievalQA` 组合 `schema.Retriever` + `Chain`（`chains/retrieval_qa.go:21-34`）
- `ConversationalRetrievalQA` 组合两条 Chain + Retriever + Memory（`chains/conversational_retrieval_qa.go:18-52`）
- `Executor` 组合 `Agent` + `Memory`（`agents/executor.go:18-26`）

## 3. 核心概念

### 3.1 Model — LLM 接口

`llms.Model` 是所有 LLM 提供商必须实现的核心接口（`llms/llms.go:15-29`）：

```go
type Model interface {
    GenerateContent(ctx context.Context, messages []MessageContent, 
        options ...CallOption) (*ContentResponse, error)
    Call(ctx context.Context, prompt string, options ...CallOption) (string, error)
}
```

- `GenerateContent` 是多模态通用接口，支持聊天、图片、工具调用等
- `Call` 是向后兼容的纯文本简化接口（已标记 Deprecated）

此外还有 `ReasoningModel` 接口（`llms/llms.go:34-41`），用于支持推理/思考 Token 的模型（如 o1/o3 系列）。

**CallOptions** 结构体（`llms/options.go:10-76`）定义了 20+ 个调用参数，包括 `Temperature`、`MaxTokens`、`TopK`、`TopP`、`Tools`、`ToolChoice`、`StreamingFunc`、`JSONMode`、`WebSearchOptions` 等。

**已支持的 LLM 提供商**（`llms/` 子目录）：

| 提供商 | 包路径 | 说明 |
|--------|--------|------|
| OpenAI | `llms/openai` | GPT-4/3.5，含 Azure 支持 |
| Anthropic | `llms/anthropic` | Claude 系列 |
| Google AI | `llms/googleai` | Gemini |
| Ollama | `llms/ollama` | 本地模型运行 |
| Bedrock | `llms/bedrock` | AWS Bedrock |
| Cohere | `llms/cohere` | Cohere |
| Mistral | `llms/mistral` | Mistral AI |
| HuggingFace | `llms/huggingface` | HF 推理 API |
| Cloudflare | `llms/cloudflare` | Workers AI |
| Ernie | `llms/ernie` | 百度文心 |
| WatsonX | `llms/watsonx` | IBM WatsonX |
| Llamafile | `llms/llamafile` | 本地 Llamafile |
| Maritaca | `llms/maritaca` | Maritaca AI |
| Local | `llms/local` | 本地执行 |
| Fake | `llms/fake` | 测试用 |

### 3.2 Chain — 链接口

`chains.Chain` 是所有链的核心接口（`chains/chains.go:16-27`）：

```go
type Chain interface {
    Call(ctx context.Context, inputs map[string]any, 
        options ...ChainCallOption) (map[string]any, error)
    GetMemory() schema.Memory
    GetInputKeys() []string
    GetOutputKeys() []string
}
```

Chain 的输入输出均为 `map[string]any`，形成数据流管道。

**核心 Chain 类型**：

| Chain | 文件 | 说明 |
|-------|------|------|
| `LLMChain` | `chains/llm.go:16` | 最基础的链：Prompt → LLM → OutputParser |
| `SequentialChain` | `chains/sequential.go:19` | 顺序执行多条链，前链输出作为后链输入 |
| `SimpleSequentialChain` | `chains/sequential.go:143` | 单入单出的简化顺序链 |
| `APIChain` | `chains/api.go:32` | LLM 生成 API 请求 → 执行 → LLM 总结响应 |
| `RetrievalQA` | `chains/retrieval_qa.go:21` | 检索增强问答：检索文档 → 组合 → LLM 回答 |
| `ConversationalRetrievalQA` | `chains/conversational_retrieval_qa.go:18` | 带对话历史的 RAG |
| `StuffDocuments` | `chains/stuff_documents.go:23` | 将文档拼接到 Prompt 上下文 |
| `MapReduce` / `RefineDocuments` | `chains/map_reduce.go` / `chains/refine_documents.go` | 分块处理后汇总 |
| `LLMMath` | `chains/llm_math.go` | LLM 数学推理 |
| `Constitutional` | `chains/constitutional.go` | 基于原则的自我修正 |

### 3.3 Agent — 智能体

`agents.Agent` 接口（`agents/agents.go:12-19`）：

```go
type Agent interface {
    Plan(ctx context.Context, intermediateSteps []schema.AgentStep, 
        inputs map[string]string, options ...ChainCallOption) 
        ([]schema.AgentAction, *schema.AgentFinish, error)
    GetInputKeys() []string
    GetOutputKeys() []string
    GetTools() []tools.Tool
}
```

`Executor`（`agents/executor.go:18-26`）负责驱动 Agent 的执行循环，它本身也实现了 `chains.Chain` 接口。

**4 种 Agent 类型**：

| Agent | 文件 | 说明 |
|-------|------|------|
| `OneShotZeroAgent` | `agents/mrkl.go:26` | 基于 MRKL 提示的 ReAct Agent |
| `ConversationalAgent` | `agents/conversational.go:29` | 支持对话交互的 Agent |
| `OpenAIFunctionsAgent` | `agents/openai_functions_agent.go:20` | 基于 OpenAI Function Calling 的 Agent |
| `Initialize` (已废弃) | `agents/initialize.go:26` | 工厂方法，通过 AgentType 创建 |

### 3.4 Tool — 工具接口

`tools.Tool` 接口（`tools/tool.go:6-9`）极简：

```go
type Tool interface {
    Name() string
    Description() string
    Call(ctx context.Context, input string) (string, error)
}
```

**内置工具**（`tools/` 子目录）：

| 工具 | 包路径 | 说明 |
|------|--------|------|
| Calculator | `tools/calculator.go` | 数学表达式计算 |
| SerpAPI | `tools/serpapi/` | Google 搜索 |
| DuckDuckGo | `tools/duckduckgo/` | 隐私搜索 |
| Wikipedia | `tools/wikipedia/` | 维基百科查询 |
| SQL Database | `tools/sqldatabase/` | SQL 数据库查询 |
| Scraper | `tools/scraper/` | 网页抓取 |
| Zapier | `tools/zapier/` | Zapier 集成 |
| Metaphor | `tools/metaphor/` | Metaphor 搜索 |
| Perplexity | `tools/perplexity/` | Perplexity AI |

### 3.5 Memory — 记忆接口

`schema.Memory` 接口（`schema/memory.go:6-17`）：

```go
type Memory interface {
    GetMemoryKey(ctx context.Context) string
    MemoryVariables(ctx context.Context) []string
    LoadMemoryVariables(ctx context.Context, inputs map[string]any) (map[string]any, error)
    SaveContext(ctx context.Context, inputs map[string]any, outputs map[string]any) error
    Clear(ctx context.Context) error
}
```

**记忆实现**：

| 类型 | 文件 | 说明 |
|------|------|------|
| `Simple` | `memory/simple.go:11` | 空实现，默认使用 |
| `ConversationBuffer` | `memory/buffer.go:16` | 保存完整对话历史 |
| `ConversationWindowBuffer` | `memory/window_buffer.go:18` | 保留最近 K 轮对话 |
| `ConversationTokenBuffer` | `memory/token_buffer.go:11` | 按 Token 数限制记忆 |
| 持久化后端 | `memory/sqlite3/`、`memory/mongo/`、`memory/zep/` 等 | 数据库存储 |

### 3.6 Prompt — 提示模板

`prompts.FormatPrompter` 接口（`prompts/prompts.go:18-21`）：

```go
type FormatPrompter interface {
    FormatPrompt(values map[string]any) (llms.PromptValue, error)
    GetInputVariables() []string
}
```

`PromptTemplate`（`prompts/prompt_template.go:30-48`）是核心实现，支持 Go 模板语法和 Jinja2 格式。`ChatPromptTemplate` 支持多轮对话消息模板。

### 3.7 Embeddings — 嵌入接口

`embeddings.Embedder` 接口（`embeddings/embedding.go:27-32`）：

```go
type Embedder interface {
    EmbedDocuments(ctx context.Context, texts []string) ([][]float32, error)
    EmbedQuery(ctx context.Context, text string) ([]float32, error)
}
```

支持 OpenAI、HuggingFace、VoyageAI、Cybertron、Jina、Bedrock 等提供商。

### 3.8 VectorStore — 向量存储接口

`vectorstores.VectorStore` 接口（`vectorstores/vectorstores.go:12-15`）：

```go
type VectorStore interface {
    AddDocuments(ctx context.Context, docs []schema.Document, options ...Option) ([]string, error)
    SimilaritySearch(ctx context.Context, query string, numDocuments int, options ...Option) ([]schema.Document, error)
}
```

支持 16+ 种向量数据库：Chroma、Pinecone、Milvus、PGVector、Qdrant、Redis、Weaviate、OpenSearch 等。

## 4. 包总览表

| 包路径 | 职责 | 关键类型 |
|--------|------|----------|
| `llms` | LLM 抽象与提供商 | `Model`, `CallOptions`, `MessageContent` |
| `chains` | Chain 编排 | `Chain`, `LLMChain`, `RetrievalQA` |
| `agents` | Agent 执行 | `Agent`, `Executor` |
| `tools` | 外部工具 | `Tool` |
| `memory` | 对话记忆 | `ConversationBuffer`, `ConversationWindowBuffer` |
| `prompts` | 提示模板 | `PromptTemplate`, `ChatPromptTemplate` |
| `embeddings` | 向量嵌入 | `Embedder`, `EmbedderImpl` |
| `vectorstores` | 向量存储 | `VectorStore`, `Retriever` |
| `schema` | 核心类型定义 | `Memory`, `Document`, `Retriever`, `AgentAction` |
| `callbacks` | 回调钩子 | `Handler`, `HandlerHaver` |
| `outputparser` | 输出解析 | `OutputParser[T]`, `Structured` |
| `documentloaders` | 文档加载 | `Loader` |
| `textsplitter` | 文本分割 | `TextSplitter`, `MarkdownSplitter` |
| `jsonschema` | JSON Schema | — |

## 5. 与 Python LangChain 对比

| 维度 | Python LangChain | LangChainGo |
|------|-----------------|-------------|
| 语言 | Python（动态类型） | Go（静态类型） |
| 抽象方式 | 基类继承（`BaseModel`, `BaseChain`） | 接口组合（`Chain`, `Model`） |
| 配置模式 | 构造函数参数 + `**kwargs` | 函数选项（`With*` 模式） |
| 输出解析 | `BaseOutputParser` | 泛型 `OutputParser[T]`（`schema/output_parsers.go:6`） |
| 并发模型 | asyncio | goroutine + `sync.WaitGroup`（`chains/chains.go:176-208`） |
| 错误处理 | Exception 层级 | `error` 接口 + `errors.Is`/`errors.As` |
| 性能特征 | 启动快，运行时动态分发 | 编译时检查，零开销抽象 |
| 生态丰富度 | 更丰富的集成 | 正在快速追赶，16+ LLM、16+ 向量库 |
| 流式支持 | async generator | `StreamingFunc` 回调（`llms/options.go:22-23`） |

Go 泛型 `OutputParser[T]`（`schema/output_parsers.go:6`）是相较 Python 版本的类型安全改进：

```go
type OutputParser[T any] interface {
    Parse(text string) (T, error)
    ParseWithPrompt(text string, prompt llms.PromptValue) (T, error)
    GetFormatInstructions() string
    Type() string
}
```

## 6. 与 adk-go / eino 对比

| 维度 | LangChainGo | adk-go (Google) | eino (字节跳动) |
|------|-------------|-----------------|----------------|
| 项目性质 | 社区开源 | Google 官方 | 字节跳动官方 |
| 设计风格 | Python LangChain 的 Go 移植 | 原生 Go 设计，Agent 优先 | 原生 Go 设计，流式优先 |
| 核心抽象 | Chain + Agent + Tool | Agent + Tool + Session | Graph + Chain + Tool |
| 编排模型 | Chain 线性管道 | Agent 循环 + 委托 | DAG 图编排 |
| LLM 支持 | 16+ 提供商 | 主要是 Gemini | 主要是豆包/火山引擎 |
| 流式处理 | Callback 回调 | 原生流式 | 原生流式（核心设计） |
| 生产就绪 | 成熟稳定 | 较新，快速发展 | 较新，快速发展 |
| 适用场景 | 通用 LLM 应用，RAG | Google 生态 Agent 应用 | 字节生态 Agent 应用 |

LangChainGo 的优势在于广泛的提供商支持和成熟的 Chain 抽象；adk-go 在 Agent 交互和 Google 生态集成上更深入；eino 则在图编排和流式处理上更具特色。三者各有所长，选择取决于目标生态和架构偏好。
