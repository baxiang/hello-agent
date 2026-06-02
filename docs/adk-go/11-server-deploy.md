# 服务化部署

ADK-Go 提供多种部署方式，从本地开发调试到生产环境运行。核心服务层包括 REST API、A2A 协议、Agent Engine 集成，以及 CLI 工具和 Launcher 系统。

## 1. REST API 服务

ADK REST 协议的实现位于 `source/server/adkrest/`，基于 `gorilla/mux` 路由，实现 `http.Handler` 接口，可无缝集成到任何 Go HTTP 服务中。

### Server 创建

```go
restServer, err := adkrest.NewServer(adkrest.ServerConfig{
    AgentLoader:     agent.NewSingleLoader(myAgent),
    SessionService:  session.InMemoryService(),
    MemoryService:   memService,
    ArtifactService: artifact.InMemoryService(),
    SSEWriteTimeout: 120 * time.Second,
    PluginConfig:    runner.PluginConfig{},
    DebugConfig:     adkrest.DebugTelemetryConfig{TraceCapacity: 10000},
})
if err != nil {
    log.Fatal(err)
}

// 集成到标准 HTTP 服务
mux := http.NewServeMux()
mux.Handle("/api/", http.StripPrefix("/api", restServer))
http.ListenAndServe(":8080", mux)
```

### ServerConfig 参数

| 字段 | 说明 |
|------|------|
| SessionService | 会话管理服务 |
| MemoryService | 记忆服务（可选） |
| AgentLoader | Agent 加载器，支持单 Agent 和多 Agent |
| ArtifactService | 产物存储服务（可选） |
| SSEWriteTimeout | SSE 流式响应的写入超时 |
| PluginConfig | 插件配置 |
| DebugConfig | 调试追踪配置（TraceCapacity 控制内存中保留的追踪数量） |

### Controller 结构

`controllers/` 目录下包含各 API 控制器：

- **RuntimeAPIController**：核心运行时，提供三个端点：
  - `RunHandler`：非流式 Agent 执行，返回完整事件列表
  - `RunSSEHandler`：SSE 流式 Agent 执行，逐事件推送
  - `RunLiveHandler`：WebSocket 双向实时通信（Live 模式），支持音频流输入输出
- **SessionsAPIController**：会话 CRUD 操作
- **AppsAPIController**：Agent 应用信息查询
- **ArtifactsAPIController**：产物管理
- **DebugAPIController**：调试追踪端点

### SSE 流式响应

`RunSSEHandler` 使用 Server-Sent Events 协议，设置 `Content-Type: text/event-stream`，每个事件以 `data: {json}\n\n` 格式推送。出错时发送 `event: error\n` 事件。

### WebSocket Live 模式

`RunLiveHandler` 通过 WebSocket 升级实现双向通信，支持：
- 二进制消息：作为 `audio/pcm;rate=16000` 音频输入发送至 LLM Live API
- 文本消息：JSON 格式的 `LiveRequest`，支持 `Content`、`ActivityStart/End`、`Blob` 等输入类型

### 调试追踪

`Server` 提供 `SpanProcessor()` 和 `LogProcessor()` 方法，返回的处理器可注册到应用的 TracerProvider/LoggerProvider 中，为 `/debug/trace` 端点提供追踪数据。

## 2. A2A 服务

Agent-to-Agent 协议实现位于 `source/server/adka2a/`，允许 ADK Agent 通过 A2A 标准协议与其他 Agent 互操作。

### Executor

`Executor` 实现 `a2asrv.AgentExecutor` 接口，将 A2A 请求映射到 ADK Agent 调用：

```go
executor := adka2a.NewExecutor(adka2a.ExecutorConfig{
    RunnerConfig: runner.Config{
        AppName:        agent.Name(),
        Agent:          agent,
        SessionService: session.InMemoryService(),
    },
    OutputMode: adka2a.OutputArtifactPerRun,
})
```

### ExecutorConfig 配置

| 字段 | 说明 |
|------|------|
| RunnerConfig | Runner 基础配置 |
| RunnerProvider | 自定义 Runner 创建函数，覆盖默认行为 |
| RunConfig | 传递给 `runner.Run()` 的运行配置 |
| BeforeExecuteCallback | 执行前的回调，可用于注入上下文或阻止执行 |
| AfterEventCallback | 事件转换后的回调，可丰富元数据或中止执行 |
| AfterExecuteCallback | 执行完成后的回调 |
| A2APartConverter | 自定义 A2A Part → GenAI Part 转换 |
| GenAIPartConverter | 自定义 GenAI Part → A2A Part 转换 |
| OutputMode | 产物输出模式 |
| A2AExecutionCleanupCallback | 执行清理回调 |

### OutputMode

- **OutputArtifactPerRun**（默认）：每次 `runner.Run` 产生一个 Artifact
- **OutputArtifactPerEvent**：每个非 partial 事件产生一个 Artifact，支持增量构建

### Conversion 工具函数

`conversions.go` 提供双向转换工具：

- **ToGenAIPart / ToGenAIParts**：A2A Part → GenAI Part
- **ToA2APart / ToA2AParts**：GenAI Part → A2A Part（支持 Long Running Tool ID 元数据）
- **ToSessionEvent**：A2A Event → Session Event
- **EventToMessage**：Session Event → A2A Message
- **BuildAgentSkills**：从 Agent 描述生成 A2A AgentSkill 列表，用于 AgentCard
- **ToCustomMetadata / GetA2ATaskInfo**：A2A Task ID 与 Session Event 元数据的互转

### v2 子包

`source/server/adka2a/v2/` 包含 A2A v2 协议的完整实现，包括 Executor、事件处理、Part 转换、Artifact 管理等。v1 包（`adka2a`）是 v2 的薄包装，自动处理 v1/v2 之间的类型转换。

## 3. AgentEngine 部署

位于 `source/server/agentengine/`，提供 Google Cloud Agent Engine 集成。

`NewHandler` 创建一个 `http.Handler`，支持流式和非流式方法：

- **非流式方法**：`async_create_session`、`async_get_session`、`async_list_sessions`、`async_delete_session`
- **流式方法**：`async_stream_query`

`ListClassMethods()` 返回支持的方法描述列表（`[]*structpb.Struct`），用于部署时向 Agent Engine 注册能力。

## 4. CLI 工具

### adkgo CLI

位于 `source/cmd/adkgo/`，提供部署相关子命令：

```bash
adkgo deploy agentengine  # 部署到 Agent Engine
adkgo deploy cloudrun     # 部署到 Cloud Run
```

### Launcher 系统

Launcher 位于 `source/cmd/launcher/`，是 ADK 应用的运行管理框架。

#### Launcher 接口

```go
type Launcher interface {
    Execute(ctx context.Context, config *Config, args []string) error
    CommandLineSyntax() string
}
```

#### SubLauncher 接口

每个 SubLauncher 对应一种运行模式：

```go
type SubLauncher interface {
    Keyword() string
    Parse(args []string) ([]string, error)
    CommandLineSyntax() string
    SimpleDescription() string
    Run(ctx context.Context, config *Config) error
}
```

#### Config 配置

```go
type Config struct {
    SessionService   session.Service
    ArtifactService  artifact.Service
    MemoryService    memory.Service
    AgentLoader      agent.Loader
    A2AOptions       []a2asrv.RequestHandlerOption
    PluginConfig     runner.PluginConfig
    TelemetryOptions []telemetry.Option
}
```

#### full.NewLauncher()

开发模式 Launcher，包含所有运行方式：

- **console**：终端交互模式
- **api**：REST API 服务
- **a2a**：A2A 协议服务
- **webui**：Web UI 界面（可独立运行，或与 api/a2a 共存）

```go
l := full.NewLauncher()
l.Execute(ctx, config, os.Args[1:])
```

#### prod.NewLauncher()

生产模式 Launcher，仅包含生产所需的服务接口：

- **api**：REST API 服务
- **a2a**：A2A 协议服务

不包含 console 和 webui，适合最小化部署：

```go
l := prod.NewLauncher()
l.Execute(ctx, config, os.Args[1:])
```

运行 `go run ./main.go help` 可查看所有可用子命令。

## 5. 容器化部署

使用 Docker 构建 Go Agent 服务：

```dockerfile
FROM golang:1.24-alpine AS builder
WORKDIR /app
COPY go.mod go.sum ./
RUN go mod download
COPY . .
RUN CGO_ENABLED=0 go build -o /agent ./cmd/agent

FROM alpine:3.19
RUN apk --no-cache add ca-certificates
COPY --from=builder /agent /agent
EXPOSE 8080
ENTRYPOINT ["/agent"]
```

建议使用 `prod.NewLauncher()` 作为容器入口，避免引入开发依赖：

```go
func main() {
    ctx := context.Background()
    config := &launcher.Config{
        AgentLoader:    agent.NewSingleLoader(myAgent),
        SessionService: session.InMemoryService(),
    }
    l := prod.NewLauncher()
    if err := l.Execute(ctx, config, os.Args[1:]); err != nil {
        log.Fatalf("运行失败: %v\n%s", err, l.CommandLineSyntax())
    }
}
```

## 6. Cloud Run 部署建议

使用 `adkgo deploy cloudrun` 或手动部署到 Cloud Run：

1. **设置环境变量**：`DEEPSEEK_API_KEY`、`GOOGLE_API_KEY` 等模型 API Key，或 `GOOGLE_CLOUD_PROJECT`、`GOOGLE_CLOUD_LOCATION`
2. **启用 Vertex AI 后端**：使用 `genai.BackendVertexAI` 代替 API Key，利用 Workload Identity 自动认证
3. **Session 存储**：生产环境建议使用 `session/vertexai` 代替内存存储，确保会话持久化
4. **Memory 服务**：使用 `memory/vertexai` 实现跨会话记忆
5. **Telemetry**：启用 `telemetry.WithOtelToCloud(true)` 将追踪数据导出到 Cloud Trace
6. **并发与超时**：根据 Agent 复杂度调整 Cloud Run 的请求超时（最长 60 分钟）和并发数
