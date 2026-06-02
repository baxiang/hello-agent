# 可观测性与追踪

ADK-Go 基于 OpenTelemetry 提供完整的可观测性方案，覆盖追踪（Tracing）和日志（Logging）。Telemetry 模块位于 `source/telemetry/`，对接 GCP Cloud Trace 和标准 OTLP 导出。

## 1. Telemetry 初始化

### 创建 Providers

`telemetry.New(ctx, opts...)` 是入口函数，根据选项构建 Tracer 和 Logger Providers：

```go
import (
    "context"
    "log"
    "time"

    "go.opentelemetry.io/otel/sdk/resource"
    semconv "go.opentelemetry.io/otel/semconv/v1.36.0"
    "google.golang.org/adk/telemetry"
)

ctx := context.Background()

res, err := resource.New(ctx, resource.WithAttributes(
    semconv.ServiceNameKey.String("my-agent"),
    semconv.ServiceVersionKey.String("1.0.0"),
))
if err != nil {
    log.Fatal(err)
}

providers, err := telemetry.New(ctx,
    telemetry.WithOtelToCloud(true),
    telemetry.WithResource(res),
)
if err != nil {
    log.Fatal(err)
}
defer func() {
    shutdownCtx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
    defer cancel()
    if err := providers.Shutdown(shutdownCtx); err != nil {
        log.Printf("telemetry shutdown failed: %v", err)
    }
}()

providers.SetGlobalOtelProviders()
```

### Provider 选项（Option）

`config.go` 定义了所有可用选项：

| 选项 | 说明 |
|------|------|
| `WithOtelToCloud(bool)` | 启用/禁用 GCP Cloud Trace 导出 |
| `WithResource(*resource.Resource)` | 自定义 OTel Resource，与默认检测器合并 |
| `WithGcpResourceProject(string)` | 设置 `gcp.project_id` 资源属性 |
| `WithGcpQuotaProject(string)` | 设置 GCP 配额项目 |
| `WithGoogleCredentials(*google.Credentials)` | 覆盖 ADC 默认凭据 |
| `WithSpanProcessors(...)` | 注册额外的 Span Processor（用于自定义导出器） |
| `WithLogRecordProcessors(...)` | 注册额外的 Log Processor |
| `WithTracerProvider(*sdktrace.TracerProvider)` | 完全覆盖默认 TracerProvider |
| `WithLoggerProvider(*sdklog.LoggerProvider)` | 完全覆盖默认 LoggerProvider |
| `WithGenAICaptureMessageContent(bool)` | 控制是否在日志中记录消息内容 |

### Providers 结构

```go
type Providers struct {
    TracerProvider *sdktrace.TracerProvider
    LoggerProvider *sdklog.LoggerProvider
    // 内部字段
}
```

`Providers` 仅暴露已配置的 Provider 实例。若未启用任何导出器，对应字段为 nil。

### SetGlobalOtelProviders()

将 Providers 注册为全局 OTel Providers：

```go
providers.SetGlobalOtelProviders()
```

调用后，`otel.Tracer(...)` 和 `otelglobal.LoggerProvider()` 会使用这些 Provider。同时设置全局的 `genAICaptureMessageContent` 标志，控制 ADK 内部 GenAI 语义日志是否包含消息内容。

如果你的库不使用全局 Provider，也可以直接传递 `providers.TracerProvider` 给被插桩的库。

### 优雅关闭

```go
defer func() {
    ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
    defer cancel()
    if err := providers.Shutdown(ctx); err != nil {
        log.Printf("shutdown failed: %v", err)
    }
}()
```

`Shutdown()` 依次关闭 TracerProvider 和 LoggerProvider，刷新缓存并释放资源。所有错误通过 `errors.Join` 合并返回。

## 2. OpenTelemetry 集成

### 自动配置的导出器

`setup_otel.go` 中的 `configureExporters` 自动根据环境变量和配置启用导出器：

- **OTLP HTTP**：当设置 `OTEL_EXPORTER_OTLP_ENDPOINT` 或 `OTEL_EXPORTER_OTLP_TRACES_ENDPOINT` 时，启用 OTLP HTTP Trace 导出器
- **OTLP Logs**：当设置 `OTEL_EXPORTER_OTLP_ENDPOINT` 或 `OTEL_EXPORTER_OTLP_LOGS_ENDPOINT` 时，启用 OTLP HTTP Log 导出器
- **GCP Cloud Trace**：启用 `WithOtelToCloud(true)` 时，使用 ADC 凭据导出到 `https://telemetry.googleapis.com/v1/traces`，自动添加 `x-goog-user-project` 头处理配额

### Resource 自动检测

`resolveResource` 按以下顺序构建 Resource，后者覆盖前者：

1. `resource.Default()`：从 `OTEL_SERVICE_NAME` 和 `OTEL_RESOURCE_ATTRIBUTES` 环境变量加载
2. `gcp.project_id` 属性（来自 `gcpResourceProject` 配置）
3. GCP Detector：在 GCE/GKE/Cloud Run 上自动添加运行时属性
4. 用户通过 `WithResource()` 提供的自定义 Resource

### GenAI 语义约定

ADK-Go 遵循 OpenTelemetry GenAI 语义约定。`OTEL_INSTRUMENTATION_GENAI_CAPTURE_MESSAGE_CONTENT` 环境变量（或 `WithGenAICaptureMessageContent` 选项）控制是否在 Span 和日志中记录消息内容。生产环境通常应设为 `false` 避免敏感信息泄露。

## 3. 内置追踪点

ADK-Go 在 Agent 执行的关键路径上自动产生 Span，无需用户手动埋点。

### Agent invocation Span

`source/agent/agent.go:164` 处，每次 Agent 调用产生一个 Span：

```go
spanCtx, span := telemetry.StartInvokeAgentSpan(ctx, a, ctx.Session().ID(), ctx.InvocationID())
yield, endSpan := telemetry.WrapYield(span, yield, func(span trace.Span, event *session.Event, err error) {
    telemetry.TraceAgentResult(span, telemetry.TraceAgentResultParams{...})
})
```

涉及的内部 API（位于 `internal/telemetry/`）：

- **StartInvokeAgentSpan(ctx, agent, sessionID, invocationID)**：创建符合 GenAI semconv 的 `invoke_agent` Span，附加 Agent 名称、Session ID、Invocation ID 等属性
- **WrapYield(span, yield, finalize)**：包装迭代器的 yield 函数，在迭代器结束时自动结束 Span。返回包装后的 yield 和 endSpan 函数
- **TraceAgentResult(span, params)**：记录 Agent 执行结果，包括状态码、错误信息、Token 用量等

### Model Call Span

LLM 调用层会创建独立的 Span，记录模型名称、请求参数、Token 使用量、首字延迟等指标。错误时设置 Span 状态为 `Error` 并附加错误详情。

### Tool Execution Span

每次工具调用产生一个 Span，记录工具名称、参数、执行时长和结果。错误时记录异常类型和堆栈。

### Span 层次结构

典型的调用链（trace tree）：

```
invoke_agent (root_agent)
├─ invoke_agent (sub_agent_1)
│  ├─ chat (deepseek-chat)
│  └─ execute_tool (search_web)
└─ invoke_agent (sub_agent_2)
   └─ chat (deepseek-chat)
```

## 4. 配置示例

### 通过 Launcher 自动启用 Telemetry

最简方式：把 `TelemetryOptions` 加入 `launcher.Config`，Launcher 会自动初始化和关闭 Telemetry：

```go
import (
    "go.opentelemetry.io/otel/sdk/resource"
    semconv "go.opentelemetry.io/otel/semconv/v1.36.0"
    "google.golang.org/adk/cmd/launcher"
    "google.golang.org/adk/cmd/launcher/full"
    "google.golang.org/adk/telemetry"
)

func main() {
    ctx := context.Background()
    // ... 创建 model 和 agent ...

    res, err := resource.New(ctx, resource.WithAttributes(
        semconv.ServiceNameKey.String("weather-agent"),
        semconv.ServiceVersionKey.String("1.0.0"),
    ))
    if err != nil {
        log.Fatal(err)
    }

    config := &launcher.Config{
        AgentLoader: agent.NewSingleLoader(a),
        TelemetryOptions: []telemetry.Option{
            telemetry.WithResource(res),
            telemetry.WithOtelToCloud(true),
        },
    }

    l := full.NewLauncher()
    if err := l.Execute(ctx, config, os.Args[1:]); err != nil {
        log.Fatal(err)
    }
}
```

参考完整示例：`source/examples/telemetry/main.go`。

### 手动管理 Telemetry

需要更细粒度控制时（例如自定义 Span Processor、与 ADK REST API 的调试追踪集成）：

```go
providers, err := telemetry.New(ctx,
    telemetry.WithResource(res),
    telemetry.WithSpanProcessors(restServer.SpanProcessor()),
    telemetry.WithLogRecordProcessors(restServer.LogProcessor()),
)
if err != nil {
    log.Fatal(err)
}
providers.SetGlobalOtelProviders()
defer providers.Shutdown(context.Background())
```

### 环境变量驱动

仅依赖标准 OTel 环境变量：

```bash
export OTEL_SERVICE_NAME=my-agent
export OTEL_RESOURCE_ATTRIBUTES="env=production,team=ai"
export OTEL_EXPORTER_OTLP_ENDPOINT=https://otlp.example.com
export OTEL_INSTRUMENTATION_GENAI_CAPTURE_MESSAGE_CONTENT=false
```

代码中只需调用 `telemetry.New(ctx)`，无需任何选项即可获得正确配置的 Providers。
