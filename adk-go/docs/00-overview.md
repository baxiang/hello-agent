# ADK-Go 项目总览

## 项目简介

ADK-Go（Agent Development Kit for Go）是 Google 开源的语言优先（Language-First）Go AI Agent 开发工具包，当前版本 v1.2.0，采用 Apache 2.0 许可证发布。它为开发者提供了一套完整的框架，用于构建、组合和部署基于大语言模型（LLM）的智能体应用。

ADK-Go 的核心目标是让 Go 开发者能够以惯用的 Go 风格来构建 AI Agent，而非简单地将 Python 版本的概念翻译过来。项目充分利用了 Go 1.23+ 引入的迭代器协议（`iter.Seq2`）、接口组合等语言特性，使得 Agent 的定义与编排既类型安全又富有表现力。

## 设计哲学

ADK-Go 的设计围绕以下核心原则展开：

- **Code-First（代码优先）**：所有 Agent、Tool、配置均通过 Go 代码定义，而非依赖 YAML/JSON 等外部声明式配置。这意味着你可以充分利用 IDE 的自动补全、类型检查和重构能力。
- **模块化（Modular）**：每个核心功能（会话、记忆、制品、模型）都被拆分为独立的包，你可以按需引入，也可以替换默认实现。
- **可组合（Composable）**：Agent 支持嵌套组合——LLMAgent、SequentialAgent、ParallelAgent、LoopAgent 可以自由编排，形成复杂的 Agent 树。
- **模型无关（Model-Agnostic）**：通过 `model.LLM` 接口抽象 LLM 调用，目前已内置 Gemini 支持，也可自行适配其他模型。
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

`Run()` 方法返回 `iter.Seq2[*session.Event, error]`，这是 Go 1.23+ 的迭代器协议，支持惰性求值和流式处理。`internal()` 是框架内部方法，用户不应直接调用。Agent 的主要实现包括：

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
| 流式协议 | `iter.Seq2`（Go 1.23+） | Async Generator | Reactive Streams |
| 接口风格 | 接口组合 + 结构体嵌入 | Protocol/ABC | Interface + CompletableFuture |
| 并发模型 | goroutine + channel | asyncio | 虚拟线程 |
| 部署体积 | 单二进制，MB 级 | 需要 Python 运行时 | 需要 JVM |
| 侧重点 | 性能和云原生 | 快速原型和生态丰富 | 企业级集成 |

Go 版本最大的特色在于：所有核心接口的返回值都使用 `iter.Seq2`，这是一种惰性迭代器，消费者可以随时中断，天然适配 LLM 的流式输出和工具调用循环。

## 模块一览表

| 模块 | 路径 | 说明 |
|------|------|------|
| agent | `agent/` | Agent 核心接口与基类，包含 llmagent、workflowagents 子包 |
| runner | `runner/` | 运行器，编排 Agent 执行与事件管理 |
| model | `model/` | LLM 接口定义与 Gemini 实现 |
| tool | `tool/` | Tool 接口与内置工具（functiontool、geminitool、agenttool） |
| session | `session/` | 会话管理与事件模型 |
| memory | `memory/` | 跨会话记忆服务 |
| artifact | `artifact/` | 制品（文件）存储服务 |
| plugin | `plugin/` | 插件系统，支持生命周期回调 |
| server | `server/` | HTTP/A2A 服务器 |
| telemetry | `telemetry/` | 可观测性（OpenTelemetry 集成） |
| cmd | `cmd/` | 命令行工具（launcher） |
| examples | `examples/` | 官方示例集合 |
