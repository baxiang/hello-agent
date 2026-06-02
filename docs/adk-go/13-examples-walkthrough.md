# 示例代码导读

ADK-Go 在 `source/examples/` 下提供了丰富的示例，涵盖从最简 Agent 到生产部署的各种场景。每个示例都是可独立运行的 Go 程序。

> **注意**：本目录的示例侧重功能验证，与 [google/adk-samples](https://github.com/google/adk-samples) 中的端到端示例不同。

## 运行方式

大多数示例使用 Launcher 系统，支持多种运行模式：

```bash
# 终端交互模式
go run ./examples/quickstart/main.go console

# REST API 模式
go run ./examples/quickstart/main.go restapi

# A2A 模式
go run ./examples/quickstart/main.go a2a

# Web UI 模式（包含 REST API 和 A2A）
go run ./examples/quickstart/main.go webui

# 查看所有可用模式
go run ./examples/quickstart/main.go help
```

## 1. quickstart

**路径**：`examples/quickstart/main.go`

最简 Agent 示例。创建一个天气/时间查询 Agent，使用 DeepSeek 或 Gemini 模型，通过 `full.NewLauncher()` 支持所有运行模式。

**关键 API**：`llmagent.New()`、`model.LLM` 接口、`agent.NewSingleLoader()`

## 2. tools/

### tools/multipletools

演示在一个 Agent 中组合使用多个工具。

**关键 API**：`functiontool.New()`、`llmagent.Config.Tools`

### tools/loadartifacts

演示在工具中加载和保存产物（Artifact），通过 `tool.Context` 访问 `ArtifactService`。

**关键 API**：`tool.Context` 的 `Artifacts()` 方法

### tools/loadmemory

演示在工具中搜索记忆，通过 `tool.Context` 访问 `MemoryService`。

**关键 API**：`tool.Context` 的 `SearchMemory()` 方法

## 3. mcp/

**路径**：`examples/mcp/main.go`

演示 MCP（Model Context Protocol）工具集成，展示两种使用方式：

1. **本地 MCP Server**：使用 `mcp.NewInMemoryTransports()` 创建进程内 MCP Server，注册自定义 `GetWeather` 工具
2. **GitHub 远程 MCP Server**：使用 OAuth2 认证连接 GitHub MCP 端点（需设置 `GITHUB_PAT` 环境变量）

通过 `AGENT_MODE=github` 环境变量切换模式。

**关键 API**：`mcptoolset.New()`、`mcp.NewInMemoryTransports()`、`llmagent.Config.Toolsets`

## 4. bidi/

**路径**：`examples/bidi/main.go`

双向流式通信示例。通过 WebSocket 实现 Live 模式，支持实时语音交互。包含自定义 `camera_toggle` 工具演示流式场景下的工具调用。

子目录：
- **sequential/**：流式场景下的顺序执行
- **streamingtool/**：流式工具输出
- **static/**：前端 UI 静态文件

**关键 API**：`controllers.NewRuntimeAPIController()`、`RunLiveHandler()`、`agent.LiveRunConfig`

## 5. workflowagents/

### workflowagents/sequential

顺序执行 Workflow Agent。多个子 Agent 按顺序依次执行，前一个 Agent 的输出作为后一个的输入。

**关键 API**：`sequentialagent.New()`、`sequentialagent.Config`

### workflowagents/parallel

并行执行 Workflow Agent。多个子 Agent 同时执行，结果合并输出。示例中子 Agent 带有随机延迟模拟并发场景。

**关键 API**：`parallelagent.New()`、`parallelagent.Config`

### workflowagents/loop

循环执行 Workflow Agent。子 Agent 重复执行直到达到最大迭代次数（`MaxIterations`）。

**关键 API**：`loopagent.New()`、`loopagent.Config`、`loopagent.Config.MaxIterations`

### workflowagents/sequentialCode

使用代码逻辑编排的顺序 Workflow，更灵活地控制子 Agent 的执行流程。

## 6. a2a/

**路径**：`examples/a2a/main.go`

Agent-to-Agent 协议示例。完整演示：

1. 启动一个 A2A Server，将天气 Agent 通过 A2A 协议暴露
2. 使用 `remoteagent.NewA2A()` 创建远程 Agent 客户端
3. 通过 A2A 协议调用远程 Agent

**关键 API**：`adka2a.NewExecutor()`、`adka2a.BuildAgentSkills()`、`remoteagent.NewA2A()`、`a2asrv.NewHandler()`

## 7. telemetry/

**路径**：`examples/telemetry/main.go`

可观测性示例。展示如何配置 Telemetry 并通过 Launcher 自动初始化。创建带有 OpenTelemetry 追踪的天气 Agent。

**关键 API**：`telemetry.WithResource()`、`launcher.Config.TelemetryOptions`

## 8. vertexai/

Vertex AI 集成示例：

- **agent.go**：使用 Vertex AI 后端创建模型
- **imagegenerator/**：使用 Imagen 模型生成图片
- **vertexengine/**：Vertex AI Engine 部署

**关键 API**：`genai.BackendVertexAI`、`genai.ClientConfig.Project`/`Location`

## 9. agentengine/

**路径**：`examples/agentengine/main.go`

Cloud Agent Engine 部署示例。展示：

- 使用 Vertex AI Session 和 Memory 服务替代内存实现
- 创建自动保存记忆的 Plugin（`BeforeRunCallback` 设置时间戳，`AfterRunCallback` 调用 `AddSessionToMemory`）
- 使用 `agentengine.NewLauncher()` 适配 Agent Engine 运行环境

**关键 API**：`session/vertexai.NewSessionService()`、`memory/vertexai.NewService()`、`agentengine.NewLauncher()`

## 10. rest/

**路径**：`examples/rest/main.go`

REST API 服务示例。不使用 Launcher，直接创建 `adkrest.NewServer()` 并集成到标准 `http.ServeMux`，展示如何将 ADK REST API 嵌入自定义 HTTP 服务。

**关键 API**：`adkrest.NewServer()`、`adkrest.ServerConfig`、`http.StripPrefix()`

## 11. skills/

**路径**：`examples/skills/main.go`

Skills 示例。使用 `skilltoolset` 从文件系统加载预定义技能（Skills），让 Agent 根据用户请求动态选择执行。`skills/` 子目录包含技能定义文件。

**关键 API**：`skill.NewFileSystemSource()`、`skill.WithCompletePreloadSource()`、`skilltoolset.New()`、`llmagent.Config.Toolsets`

## 12. toolconfirmation/

**路径**：`examples/toolconfirmation/main.go`

HITL（Human-in-the-Loop）工具确认示例。实现一个请假审批工具，完整演示：

1. 工具调用时通过 `ctx.ToolConfirmation()` 检查确认状态
2. 首次调用时通过 `ctx.RequestConfirmation()` 请求人工确认
3. 人工确认/拒绝后，工具根据确认结果继续执行
4. 支持部分批准（批准天数可少于请求数）

示例提供交互式菜单，可同时操作聊天和审批流程。

**关键 API**：`tool.Context.ToolConfirmation()`、`tool.Context.RequestConfirmation()`、`toolconfirmation.OriginalCallFrom()`、`functiontool.Config`

## 13. web/

**路径**：`examples/web/main.go`

Web UI 示例。展示多 Agent Web 应用：

- 使用 `agent.NewMultiLoader()` 加载多个 Agent（天气 Agent、审计 Agent、图片生成 Agent）
- 配置 `ArtifactService` 和 `AuthInterceptor`
- 通过 `full.NewLauncher()` 启动包含 Web UI、REST API 和 A2A 的完整服务

**关键 API**：`agent.NewMultiLoader()`、`a2asrv.WithCallInterceptors()`、`llmagent.Config.AfterModelCallbacks`

## 示例对照表

| 示例 | 核心功能 | 主要 API |
|------|----------|----------|
| quickstart | 最简 Agent | `llmagent.New` |
| tools/multipletools | 多工具组合 | `functiontool.New` |
| tools/loadartifacts | 产物存取 | `tool.Context.Artifacts` |
| tools/loadmemory | 记忆搜索 | `tool.Context.SearchMemory` |
| mcp | MCP 协议集成 | `mcptoolset.New` |
| bidi | 双向流式 | `RunLiveHandler` |
| workflowagents/sequential | 顺序编排 | `sequentialagent.New` |
| workflowagents/parallel | 并行编排 | `parallelagent.New` |
| workflowagents/loop | 循环编排 | `loopagent.New` |
| a2a | Agent 互操作 | `adka2a.NewExecutor` |
| telemetry | 可观测性 | `telemetry.New` |
| vertexai | Vertex AI | `genai.BackendVertexAI` |
| agentengine | Cloud 部署 | `agentengine.NewLauncher` |
| rest | REST 服务 | `adkrest.NewServer` |
| skills | 技能系统 | `skilltoolset.New` |
| toolconfirmation | 人机确认 | `RequestConfirmation` |
| web | Web UI | `agent.NewMultiLoader` |
