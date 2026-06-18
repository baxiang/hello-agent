# 遥测集成 - 基于 OpenTelemetry 的 Agent 链路追踪与指标采集

## 概述

tRPC-Agent-Go 提供了开箱即用的 OpenTelemetry 遥测集成，支持将 Agent 的调用链路（Trace）和运行指标（Metrics）导出到 Jaeger、Prometheus、Langfuse 等主流可观测性平台。该能力对于生产环境中排查 Agent 行为、分析性能瓶颈和监控运行状态至关重要。

## 核心概念

框架的遥测能力基于以下核心模块：

- **telemetry/trace**：封装了 OpenTelemetry Trace SDK，提供 `atrace.Start()` 快速启动链路追踪，内置全局 `atrace.Tracer` 实例用于创建 Span。
- **telemetry/metric**：封装了 OpenTelemetry Metrics SDK，通过 `ametric.NewMeterProvider()` 创建指标提供器，支持 Counter、Histogram 等指标类型。
- **telemetry/langfuse**：专门对接 Langfuse 平台的集成模块，通过 `langfuse.Start()` 一行代码完成初始化，支持 Langfuse 特有的 session、user、metadata 等属性。

## 代码解析

### Jaeger + Prometheus 集成

`jaeger-prometheus` 示例展示了同时启用 Trace 和 Metrics 的标准模式：

```go
// 初始化 Metrics Provider
mp, _ := ametric.NewMeterProvider(
    context.Background(),
    ametric.WithEndpoint("localhost:4318"),
    ametric.WithProtocol("http"),
)
defer mp.Shutdown(context.Background())
ametric.InitMeterProvider(mp)
meter := mp.Meter("trpc_agent_go.app")

// 初始化 Trace
clean, _ := atrace.Start(
    context.Background(),
    atrace.WithEndpoint("localhost:4318"),
    atrace.WithProtocol("http"),
)
defer clean()
```

Trace 和 Metrics 都通过 OTLP 协议导出到 OpenTelemetry Collector，再由 Collector 分发到 Jaeger（Trace）和 Prometheus（Metrics）。

### 创建 Span 和记录指标

```go
commonAttrs := []attribute.KeyValue{
    attribute.String("agentName", agentName),
    attribute.String("modelName", *modelName),
}

// 创建消息计数器
userMessageCount, _ := meter.Int64Counter("run",
    metric.WithDescription("the number of user message that the agent processed"))

// 创建根 Span
ctx, span := atrace.Tracer.Start(ctx, agentName,
    trace.WithAttributes(commonAttrs...),
)
defer span.End()

// 每条消息创建子 Span 并记录指标
for _, msg := range userMessage {
    userMessageCount.Add(ctx, 1, metric.WithAttributes(commonAttrs...))
    ctx, span := atrace.Tracer.Start(ctx, "process-message")
    span.SetAttributes(attribute.String("user-message", msg))
    result, err := a.ProcessMessage(ctx, msg)
    span.SetAttributes(attribute.String("output", result))
    span.End()
}
```

通过 Span 的父子关系自动构建出 Agent 的完整调用链路，每个消息处理过程都是根 Span 的子 Span。

### Langfuse 集成

Langfuse 示例展示了面向 LLM 可观测性平台的专项集成：

```go
// 一行初始化（通过环境变量配置 Langfuse 连接信息）
clean, _ := langfuse.Start(context.Background())
defer clean(context.Background())

// 通过 Baggage 传播 Langfuse 特有属性
mSession, _ := baggage.NewMemberRaw("langfuse.session.id", "session-1")
mUser, _ := baggage.NewMemberRaw("langfuse.user.id", "user-1")
bag, _ := baggage.New(mSession, mUser)
ctx := baggage.ContextWithBaggage(context.Background(), bag)

// Span 级别设置 Langfuse 属性
ctx, span := atrace.Tracer.Start(ctx, agentName,
    trace.WithAttributes(
        attribute.String("langfuse.environment", "development"),
        attribute.String("langfuse.trace.input", msg),
    ),
)
```

Langfuse 的 session、user、metadata 等属性通过 OpenTelemetry Baggage 机制传播，确保所有子 Span 都能继承这些上下文信息。

### 共享 Agent 实现

`telemetry/agent/` 包封装了一个带多种工具（计算器、时间、文本处理、文件操作、DuckDuckGo 搜索）的通用 Agent，供两个遥测示例共享使用：

```go
a := agent.NewMultiToolChatAgent("multi-tool-assistant", *modelName)
defer a.Close()
result, err := a.ProcessMessage(ctx, msg)
```

## 运行方式

### Jaeger + Prometheus 方案

需要先启动 OpenTelemetry Collector、Jaeger 和 Prometheus：

```bash
# 启动基础设施（参考 docker-compose 配置）
docker-compose up -d

export OPENAI_API_KEY="sk-..."
cd examples/telemetry/jaeger-prometheus
go run main.go -model deepseek-v4-flash
```

访问 Jaeger UI（默认 http://localhost:16686）查看调用链路，Prometheus（默认 http://localhost:9090）查看指标。

### Langfuse 方案

```bash
export LANGFUSE_PUBLIC_KEY="pk-..."
export LANGFUSE_SECRET_KEY="sk-..."
export LANGFUSE_HOST="https://cloud.langfuse.com"
export OPENAI_API_KEY="sk-..."

cd examples/telemetry/langfuse
go run main.go -model deepseek-v4-flash
```

登录 Langfuse 平台查看 Agent 的完整调用轨迹、输入输出和 Token 用量。

## 总结

tRPC-Agent-Go 的遥测集成提供了生产级的可观测性能力，关键收获：

- **标准化接入**：基于 OpenTelemetry 标准，一套埋点代码对接多个观测平台
- **零侵入**：Trace 和 Metrics 通过 Context 传播，不影响业务逻辑
- **灵活选型**：Jaeger/Prometheus 适合自建监控体系，Langfuse 适合 LLM 专项观测
- **开箱即用**：框架封装了初始化逻辑，最少一行代码即可启用

该模块与 Callbacks 和 TokenTracker 互补：Telemetry 提供外部平台集成，Callbacks 提供应用内钩子，TokenTracker 专注 Token 用量追踪。
