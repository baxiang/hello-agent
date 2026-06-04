# ADK-Go 项目总览

## 项目简介

ADK-Go（Agent Development Kit for Go）是 Google 开源的语言优先（Language-First）Go AI Agent 开发工具包，当前版本 v1.2.0，采用 Apache 2.0 许可证发布。它为开发者提供了一套完整的框架，用于构建、组合和部署基于大语言模型（LLM）的智能体应用。

ADK-Go 的核心目标是让 Go 开发者能够以惯用的 Go 风格来构建 AI Agent，而非简单地将 Python 版本的概念翻译过来。项目充分利用了 Go 1.23 引入的迭代器协议（`iter.Seq2`）、接口组合等语言特性，使得 Agent 的定义与编排既类型安全又富有表现力。当前版本要求 Go 1.25+。

### 什么是 AI Agent？

如果你想用 AI 帮你自动查天气、分析数据、管理日程——不是那种"你问一句它答一句"的聊天机器人，而是能**自主思考、调用工具、完成复杂任务**的智能体，这就是 **AI Agent（智能体）**。

打个比方：如果大模型（如 DeepSeek、Gemini、GPT）是一个"大脑"，那 ADK 就是给这个大脑装上：

- **"手脚"（工具）**：让 Agent 调用外部 API、数据库、搜索引擎
- **"记事本"（记忆）**：跨会话的记忆与上下文管理
- **"团队协作系统"（多 Agent）**：多个 Agent 之间相互发现、委托、协作

你不需要从零实现这些能力，ADK 全都帮你准备好了。

### ADK 支持的语言

ADK 是一个多语言 AI Agent 框架，目前支持四种语言：

| 语言 | 版本 | 成熟度 |
|------|------|--------|
| Python | v2.0 Beta | ⭐⭐⭐⭐⭐ 最成熟，支持 Workflows、Agent Teams |
| TypeScript | v1.0 | ⭐⭐⭐⭐ 稳定版 |
| **Go** | **v1.2.0** | **⭐⭐⭐ 功能完整，快速发展中** |
| Java | 持续更新 | ⭐⭐⭐ 积极开发中 |

本系列聚焦 **Go 版本**。为什么选 Go？因为 Go 天生适合构建高性能后端服务，如果你要做"一个人用 AI 做一家全球化公司"，Go + ADK 是非常理想的技术组合。

## 设计哲学

ADK-Go 的设计围绕以下核心原则展开：

- **Code-First（代码优先）**：所有 Agent、Tool、配置均通过 Go 代码定义，而非依赖 YAML/JSON 等外部声明式配置。这意味着你可以充分利用 IDE 的自动补全、类型检查和重构能力。
- **模块化（Modular）**：每个核心功能（会话、记忆、制品、模型）都被拆分为独立的包，你可以按需引入，也可以替换默认实现。
- **可组合（Composable）**：Agent 支持嵌套组合——LLMAgent、SequentialAgent、ParallelAgent、LoopAgent 可以自由编排，形成复杂的 Agent 树。
- **模型无关（Model-Agnostic）**：通过 `model.LLM` 接口抽象 LLM 调用，内置了 Gemini 实现，可通过接口轻松接入 DeepSeek、OpenAI 等任意模型。
- **部署无关（Deployment-Agnostic）**：支持 Console、REST API、A2A 协议、Web UI 等多种运行模式，可运行在本地开发机，也可部署到云端。

## 核心概念

### Agent（智能体）

Agent 是 ADK-Go 的核心抽象，由 `agent.Agent` 接口定义（`source/agent/agent.go:43`）：

```go
type Agent interface {
    Name() string
    Description() string
    Run(InvocationContext) iter.Seq2[*session.Event, error]
    SubAgents() []Agent
    FindAgent(name string) Agent
    FindSubAgent(name string) Agent
    internal() *agent
}
```

`Run()` 方法返回 `iter.Seq2[*session.Event, error]`，这是 Go 1.23 引入的迭代器协议，支持惰性求值和流式处理。`internal()` 是框架内部方法，用户不应直接调用。Agent 的主要实现包括：

- **LLMAgent**：基于大语言模型的智能体，通过 `llmagent.New()` 创建，支持工具调用、回调钩子、指令模板等。
- **SequentialAgent**：顺序执行子 Agent 的编排器。
- **ParallelAgent**：并行执行子 Agent 的编排器。
- **LoopAgent**：循环执行子 Agent 的编排器。
- **Custom Agent**：通过 `agent.New()` 创建自定义逻辑的 Agent。

### Tool（工具）

Tool 赋予 Agent 与外部世界交互的能力，由 `tool.Tool` 接口定义（`source/tool/tool.go:42`）：

```go
type Tool interface {
    Name() string
    Description() string
    IsLongRunning() bool
}
```

内置工具类型包括：

- **FunctionTool**：通过 `functiontool.New()` 创建，将普通 Go 函数封装为工具，自动推导参数和返回值的 JSON Schema。
- **GoogleSearch**：内置的 Google 搜索工具。
- **AgentTool**：将一个 Agent 封装为另一个 Agent 可调用的工具，实现 Agent 间委托。
- **Toolset**：工具集合，支持动态过滤和权限控制。

Tool 执行时通过 `tool.Context` 访问会话状态、记忆搜索和人机确认（HITL）等能力。

### Session（会话）

Session 管理对话状态与事件历史，由 `session.Session` 接口定义（`source/session/session.go:32`）：

```go
type Session interface {
    ID() string
    AppName() string
    UserID() string
    State() State
    Events() Events
    LastUpdateTime() time.Time
}
```

State 提供了带作用域前缀的键值存储：
- `app:` — 应用级状态，跨用户共享
- `user:` — 用户级状态，跨会话共享
- `temp:` — 临时状态，仅当前调用有效

### Model（模型）

Model 抽象了 LLM 调用，由 `model.LLM` 接口定义（`source/model/llm.go:26`）：

```go
type LLM interface {
    Name() string
    GenerateContent(ctx context.Context, req *LLMRequest, stream bool) iter.Seq2[*LLMResponse, error]
}
```

`GenerateContent` 同样使用 `iter.Seq2` 协议，天然支持流式响应。`LLMResponse` 携带内容、引用元数据、grounding 信息、使用量统计等完整信息。

### Runner（运行器）

Runner 是编排中心，负责协调 Agent 执行、事件提交、服务协调，由 `runner.Runner` 结构体实现。它连接 Session Service、Artifact Service、Memory Service 和 Plugin 系统，提供 `Run()`（文本模式）和 `RunLive()`（双向流式模式）两种运行入口。

## 适用场景

ADK-Go 特别适合以下场景：

- **云原生 Agent 应用**：Go 的编译型特性和小内存占用，使其天然适合容器化部署和 Kubernetes 编排。
- **高并发场景**：Go 的 goroutine 模型使得 Agent 可以高效处理大量并发请求，适合构建服务端 Agent 网关。
- **微服务集成**：ADK-Go 的 Service 接口设计（Session、Memory、Artifact）允许你将状态管理委托给外部服务，如 Redis、PostgreSQL、GCS 等。
- **实时流式应用**：通过 `RunLive()` 支持 Live 模式，可用于语音对话、实时翻译等双向流式场景。

## 与 Python/Java ADK 的对比

| 特性 | ADK-Go | ADK-Python | ADK-Java |
|------|--------|------------|----------|
| 语言特性 | 静态类型、编译型、goroutine | 动态类型、解释型、asyncio | 静态类型、JVM、虚拟线程 |
| 流式协议 | `iter.Seq2`（Go 1.25+） | Async Generator | Reactive Streams |
| 接口风格 | 接口组合 + 结构体嵌入 | Protocol/ABC | Interface + CompletableFuture |
| 并发模型 | goroutine + channel | asyncio | 虚拟线程 |
| 部署体积 | 单二进制，MB 级 | 需要 Python 运行时 | 需要 JVM |
| 侧重点 | 性能和云原生 | 快速原型和生态丰富 | 企业级集成 |

Go 版本最大的特色在于：所有核心接口的返回值都使用 `iter.Seq2`，这是一种惰性迭代器，消费者可以随时中断，天然适配 LLM 的流式输出和工具调用循环。

## ADK vs 竞品框架

市面上 AI Agent 框架已经很多了，ADK 到底有什么不同？

### 主流 Agent 框架对比

| 维度 | **ADK (Google)** | LangChain/LangGraph | CrewAI | AutoGen (Microsoft) | Dify | Coze (字节) | OpenAI Agents SDK |
|------|-----------|---------------------|--------|---------------------|------|------------|-------------------|
| **定位** | 全能 Agent 框架 | 全能 Agent 框架 | 多 Agent 协作 | 多 Agent 框架 | 可视化 AI 平台 | Bot 开发平台 | 轻量 Agent SDK |
| **支持语言** | **Go/Python/TS/Java** | Python/JS | Python | Python/.NET | Web 平台 | 平台+API | Python/JS |
| **开源** | Apache 2.0 | MIT | ✅ | MIT | Apache 2.0 | 闭源 | MIT |
| **GitHub Stars** | 7.8k (Go) | 100k+ | 50.9k | 57.8k | 140.6k | N/A | 26.1k |
| **模型绑定** | 模型无关（内置 Gemini，可扩展 DeepSeek 等） | 多模型 | 多模型 | OpenAI/Azure | 所有主流 | 平台绑定 | OpenAI 优先 |
| **Agent 编排** | ⭐⭐⭐⭐ | ⭐⭐⭐⭐⭐ | ⭐⭐⭐⭐ | ⭐⭐⭐⭐ | ⭐⭐⭐ | ⭐⭐ | ⭐⭐⭐⭐ |
| **Go 语言支持** | ✅ **原生** | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| **上手难度** | 低 | 中高 | 低 | 中 | 低 | 极低 | 低 |

### ADK 的独特价值

**1. 唯一同时原生支持 Go 的主流 Agent 框架**

这是 ADK 最核心的差异化优势。如果你是 Go 开发者，想在现有 Go 服务中集成 AI Agent 能力，ADK-Go 是目前**唯一**成熟的选择。LangChain、CrewAI、AutoGen、OpenAI Agents SDK 都不支持 Go。

这意味着你可以把 AI Agent 直接嵌入到你的 PocketBase 后端、Go 微服务、CLI 工具中，不需要引入 Python 运行时，不需要额外的服务间通信。

**2. 模型无关 + DeepSeek/Gemini 深度集成**

ADK 对 Google Gemini 模型和 DeepSeek 模型的集成都很友好——内置了 Gemini 实现，同时通过 `model.LLM` 接口可轻松接入 DeepSeek。Gemini 的 Google Search Grounding、Code Execution、Vertex AI 等能力开箱即用；DeepSeek 则通过实现接口即可无缝接入。

**3. 标准协议先行：MCP + A2A**

ADK 原生支持两大标准协议：
- **MCP（Model Context Protocol）**：让 Agent 调用外部工具和数据源
- **A2A（Agent-to-Agent）**：让不同 Agent 之间互相发现和协作

你用 ADK 构建的 Agent，可以和任何支持这些协议的第三方 Agent 互通，不会被锁定在某个平台里。

**4. 简洁的设计哲学**

相比 LangChain 的"概念爆炸"（Chain、Agent、Tool、Retriever、Memory、Callback... 几十个抽象层），ADK 的核心概念只有三个：**Agent、Tool、Runner**。三个概念就覆盖了从简单到复杂的全部场景，学习曲线非常平缓。

**5. 真正的"代码优先"**

Dify、Coze 这类平台虽然上手快，但本质上是"用别人的平台"。你的 Agent 逻辑、数据、用户都跑在别人的服务器上。ADK 是纯代码框架，你的代码跑在你自己的基础设施上，完全可控。

### 选型建议

| 你的需求 | 推荐框架 |
|----------|----------|
| **Go 后端集成 AI Agent** | ✅ **ADK-Go**（唯一选择） |
| 需要最灵活的图编排 | LangGraph |
| 角色扮演式多 Agent 协作 | CrewAI |
| 非技术人员快速搭建 AI 应用 | Dify / Coze |
| 以 OpenAI 模型为核心 | OpenAI Agents SDK |
| 微软 .NET 技术栈企业 | Semantic Kernel |
| 现有 AutoGen 项目维护 | AutoGen（⚠️ 已进入维护模式） |

## 模块一览表

| 模块 | 路径 | 说明 |
|------|------|------|
| agent | `agent/` | Agent 核心接口与基类，包含 llmagent、workflowagents 子包 |
| runner | `runner/` | 运行器，编排 Agent 执行与事件管理 |
| model | `model/` | LLM 接口定义，内置 Gemini 实现，可通过接口接入 DeepSeek |
| tool | `tool/` | Tool 接口与内置工具（functiontool、geminitool、agenttool） |
| session | `session/` | 会话管理与事件模型 |
| memory | `memory/` | 跨会话记忆服务 |
| artifact | `artifact/` | 制品（文件）存储服务 |
| plugin | `plugin/` | 插件系统，支持生命周期回调 |
| server | `server/` | HTTP/A2A 服务器 |
| telemetry | `telemetry/` | 可观测性（OpenTelemetry 集成） |
| cmd | `cmd/` | 命令行工具（launcher） |
| examples | `examples/` | 官方示例集合 |

## 常见问题

**Q：ADK-Go 支持 DeepSeek、OpenAI、Claude 等非 Gemini 模型吗？**

A：ADK 设计上是模型无关的（通过 `model.LLM` 接口抽象）。目前 Go 版本内置了 Gemini 实现，DeepSeek、OpenAI 等模型可通过实现 `model.LLM` 接口接入（参考本文档 05-model 章节的 DeepSeek 实战示例）。Python 版本通过 LiteLLM 已经支持 100+ 模型。

**Q：ADK-Go 适合生产环境吗？**

A：目前 v1.2.0，核心功能（Agent、Tool、Runner、Session）已经稳定，可以用于生产。但 A2A、Agent Config 等功能还处于实验阶段，使用时需要注意。

**Q：Go 版本和 Python 版本功能差距大吗？**

A：有差距。Python 是最成熟的（v2.0 Beta，支持 Workflows、Agent Teams、Evaluation 等），Go 版本目前覆盖了核心功能但缺少一些高级特性（如 Evaluation 框架、RouterAgent 等）。Go 版本暂无内置评估工具，可以在 Agent 外部通过 LLM-as-Judge 脚本来实现评估。不过 Go 版本在快速追赶中。

**Q：ADK 和 LangChain Go (langchaingo) 有什么区别？**

A：LangChain Go 是社区维护的 LangChain 移植版，主要聚焦 RAG 和 Chain 抽象。ADK-Go 是 Google 官方维护，聚焦 Agent 开发，提供了更完整的 Agent 编排（多 Agent、工作流）、运行时（Web/CLI/API）和协议支持（MCP/A2A）。
