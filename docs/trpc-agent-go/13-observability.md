# 可观测性 — 监控·追踪·调试

tRPC-Agent-Go 内置 OpenTelemetry 全链路追踪，支持 Langfuse 可视化分析。本文深入 Span 创建链路和监控搭建实战。

## 1. OpenTelemetry 集成

### 1.1 追踪层次

```
Request ──── Runner Span ──── Agent Span ──── Model Span
                         │                │
                         ├─ Session Span  ├─ Tool Span
                         └─ Memory Span   └─ Planner Span
```

每个组件在调用时自动创建子 Span，通过 `SpanContext` 串联。

### 1.2 配置

```go
import (
    "go.opentelemetry.io/otel"
    "go.opentelemetry.io/otel/exporters/otlp/otlptrace/otlptracegrpc"
    "go.opentelemetry.io/otel/sdk/trace"
    "trpc.group/trpc-go/trpc-agent-go/telemetry"
)

func initTelemetry() func() {
    // 1. 创建 Exporter
    exporter, _ := otlptracegrpc.New(ctx,
        otlptracegrpc.WithEndpoint("localhost:4317"),
        otlptracegrpc.WithInsecure(),
    )

    // 2. 创建 TracerProvider
    tp := trace.NewTracerProvider(
        trace.WithBatcher(exporter),
        trace.WithResource(resource.NewWithAttributes(
            semconv.ServiceName("my-agent-service"),
        )),
    )
    otel.SetTracerProvider(tp)

    return func() { tp.Shutdown(ctx) }
}
```

### 1.3 Span 属性

每个 Span 自动携带的属性：

```go
// Runner Span
attribute.String("runner.app", "my-app")
attribute.String("runner.user_id", "user-1")
attribute.String("runner.session_id", "session-1")
attribute.String("runner.request_id", "req-123")

// Agent Span
attribute.String("agent.name", "assistant")
attribute.String("agent.type", "llmagent")

// Model Span
attribute.String("model.name", "gpt-4o-mini")
attribute.Int("model.prompt_tokens", 150)
attribute.Int("model.completion_tokens", 80)
attribute.String("model.finish_reason", "stop")

// Tool Span
attribute.String("tool.name", "get_weather")
attribute.String("tool.call_id", "call_abc123")
attribute.Bool("tool.success", true)
```

### 1.4 在 Runner.Run 中附加自定义属性

```go
events, _ := r.Run(ctx, userID, sessionID, message,
    agent.WithSpanAttributes(
        attribute.String("custom.user_tier", "premium"),
        attribute.String("custom.feature_flag", "new_model"),
    ),
)
```

---

## 2. Langfuse 集成

### 2.1 概述

Langfuse 是 LLM 应用的可观测平台，提供：
- **Tracing**：完整调用链可视化
- **Evaluation**：LLM 输出质量评分
- **Prompt Management**：集中管理 prompt 版本

### 2.2 集成

```go
import "trpc.group/trpc-go/trpc-agent-go/telemetry/langfuse"

clean, _ := langfuse.Start(ctx,
    langfuse.WithPublicKey(os.Getenv("LANGFUSE_PUBLIC_KEY")),
    langfuse.WithSecretKey(os.Getenv("LANGFUSE_SECRET_KEY")),
    langfuse.WithHost("https://cloud.langfuse.com"),
)
defer clean(ctx)

// Run 时注入 Langfuse 属性
events, _ := r.Run(ctx, "user-1", "session-1", message,
    agent.WithSpanAttributes(
        attribute.String("langfuse.user.id", "user-1"),
        attribute.String("langfuse.session.id", "session-1"),
        attribute.String("langfuse.trace.metadata", `{"env":"production"}`),
    ),
)
```

### 2.3 Langfuse Trace 视图

在 Langfuse Dashboard 中可以查看：
- Agent Run 的完整调用链
- 每次 LLM 调用的 prompt/completion tokens 和 cost
- 工具调用的参数、结果和耗时
- 用户维度的使用统计

---

## 3. Debug Server 调试

```go
import "trpc.group/trpc-go/trpc-agent-go/examples/debugserver"

// 启动调试服务器（带 Web UI）
debugServer := debugserver.New(
    debugserver.WithRunner(r),
    debugserver.WithPort(3000),
)
debugServer.Start()
```

提供：
- 可视化对话界面
- 实时事件流查看
- Tool call 参数和结果展示
- Session 状态查看

---

## 4. 执行 Trace

```go
import "trpc.group/trpc-go/trpc-agent-go/agent/trace"

// 获取完整执行 Trace
traceData := agent.GetExecutionTrace(invocation)

// traceData 包含：
// - Invocation 树（父子关系）
// - 每个 Invocation 的 LLM 调用次数
// - 每个 Invocation 的工具调用列表
// - 开始/结束时间
```

执行 Trace 与 OTel Span 互补：
- **OTel Span**：实时的调用链追踪（接入 Jaeger/Prometheus）
- **Execution Trace**：执行完成后的完整结构（分析、审计）

---

## 5. 结构化日志

```go
// 通过 Plugin 实现全局日志拦截
type StructuredLogPlugin struct{}

func (p *StructuredLogPlugin) AfterAgent(ctx context.Context, inv *agent.Invocation, err error) error {
    log.Info("agent completed",
        "agent", inv.AgentName,
        "invocation_id", inv.InvocationID,
        "session_id", inv.Session.ID,
        "user_id", inv.Session.UserID,
        "duration_ms", time.Since(startTime).Milliseconds(),
        "error", err,
    )
    return nil
}
```

---

## 6. 可观测性架构总览

```
Agent 应用
    │
    ├─ OpenTelemetry SDK
    │   ├─ Trace Exporter → Jaeger / Grafana Tempo
    │   ├─ Metric Exporter → Prometheus
    │   └─ Log Exporter → Loki / ELK
    │
    ├─ Langfuse SDK
    │   └─ Langfuse Cloud / Self-Hosted
    │
    ├─ Debug Server (开发/调试)
    │   └─ Web UI: localhost:3000
    │
    └─ Execution Trace (审计)
        └─ 结构化输出 → 数据库
```

**选型建议**：
- 生产监控 → OTel + Grafana 全家桶
- LLM 质量分析 → Langfuse
- 开发调试 → Debug Server
- 安全审计 → Execution Trace
