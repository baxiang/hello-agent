# 计时与遥测回调（Timer）- 三级耗时测量 + OpenTelemetry 上报

> **源码路径**：[`trpc-agent-go/examples/callbacks/timer/`](../../../../trpc-agent-go/examples/callbacks/timer)
> **示例类型**：交互式 Chat + 遥测栈 · **难度**：进阶

## 概述

`timer/` 子示例展示回调系统最具生产价值的用法：**把 Agent / Model / Tool 三层 Before/After 钩子全部接入 OpenTelemetry**，实现实时计时输出 + Metrics（Prometheus）+ Traces（Jaeger）三合一的可观测体系。配套 `docker-compose.yaml` 一键拉起 OTEL Collector + Prometheus + Jaeger。

与兄弟示例的差别：

| 示例 | State Key 风格 | 主要产物 |
|------|----------------|----------|
| [`basic`](./callbacks-basic.md) | 不用 State | 控制台日志 |
| [`auth`](./callbacks-auth.md) | `custom:*` | 鉴权决策 + 审计日志 |
| **本文（timer）** | `agent:model:tool:*` | Histogram + Counter + Span |
| [`imagetool`](./callbacks-imagetool.md) | 不用 State | 改写消息 |

## 核心概念

### Invocation State 用作"计时载体"

timer 复用了 auth 的 `Invocation.State` 机制，但承载的不是用户身份，而是**开始时间和 trace span**：

```go
startTime := time.Now()
inv.SetState("tool:calculator:call_abc:start_time", startTime)

_, span := atrace.Tracer.Start(ctx, "tool_execution", ...)
inv.SetState("tool:calculator:call_abc:span", span)
```

After 回调取出后算耗时、上报、再 `DeleteState` 清理。

### State Key 命名约定

为了避免并发工具调用互相覆盖，key 必须包含 **ToolCallID**：

| 层级 | Key 模式 | 示例 |
|------|----------|------|
| Agent | `agent:start_time`、`agent:span` | 一次 Invocation 只有一个 Agent 段 |
| Model | `model:start_time`、`model:span` | 同上 |
| Tool | `tool:<name>:<callID>:start_time`、`tool:<name>:<callID>:span` | `tool:calculator:call_abc:start_time` |

### 并发工具调用的关键：ToolCallID

LLM 可以在单次响应里返回多个 tool_call（甚至同一个工具多次），框架会**并发**执行它们。timer 用 `args.ToolCallID`（`tool.BeforeToolArgs` / `tool.AfterToolArgs` 自带字段）来隔离每次调用的 State：

```go
toolCallID := args.ToolCallID
if toolCallID == "" {
    toolCallID = "default"    // 老版本兼容兜底
}
key := fmt.Sprintf("tool:%s:%s:start_time", args.ToolName, toolCallID)
```

> 对比 [`basic`](./callbacks-basic.md) 和 [`auth`](./callbacks-auth.md) 都没处理并发分支——它们要么是单工具调用，要么只读固定 key；timer 是唯一演示并发安全的示例。

### 遥测产物

**Metrics（Prometheus，端点 `localhost:9090`）：**

| 指标 | 类型 | 维度 |
|------|------|------|
| `agent_duration_seconds` | Histogram | `agent.name`、`invocation.id` |
| `model_duration_seconds` | Histogram | `messages.count` |
| `tool_duration_seconds` | Histogram | `tool.name`、`tool.call_id` |
| `agent_executions_total` | Counter | `agent.name` |
| `model_inferences_total` | Counter | — |
| `tool_executions_total` | Counter | `tool.name` |

**Traces（Jaeger，UI `localhost:16686`）：**

| Span | 关键属性 |
|------|----------|
| `agent_execution` | `agent.name`、`invocation.id`、`user.message`、`duration.seconds`、`status` |
| `model_inference` | `messages.count`、`duration.seconds`、`status` |
| `tool_execution` | `tool.name`、`tool.call_id`、`tool.args`、`duration.seconds`、`status` |

## 代码解析

### 文件结构

- `main.go`：CLI、遥测初始化、Runner 接线、交互循环
- `callbacks.go`：所有 Before/After 回调（含计时 + Span 创建/结束 + Metrics 上报）
- `metrics.go`：OTEL SDK 初始化（`initTelemetry`）与 6 个指标创建（`initMetrics`）
- `tools.go`：`calculator` 工具
- `docker-compose.yaml` / `otel-collector.yaml` / `prometheus.yaml`：本地遥测栈

### 遥测初始化

`initTelemetry` 启动 trace（gRPC `localhost:4317`）和 metric（HTTP `localhost:4318`）：

```go
cleanTrace, err := atrace.Start(ctx, atrace.WithEndpoint("localhost:4317"))
mp, err := ametric.NewMeterProvider(ctx,
    ametric.WithEndpoint("localhost:4318"),
    ametric.WithProtocol("http"),
)
ametric.InitMeterProvider(mp)
```

`initMetrics` 用返回的 `metric.Meter` 创建 3 个 Histogram + 3 个 Counter，全部存在 `toolTimerExample` 结构体上。

### Agent 回调：span 生命周期与 State 同步

```go
// Before
startTime := time.Now()
args.Invocation.SetState("agent:start_time", startTime)

_, span := atrace.Tracer.Start(ctx, "agent_execution",
    trace.WithAttributes(
        attribute.String("agent.name", args.Invocation.AgentName),
        attribute.String("invocation.id", args.Invocation.InvocationID),
        attribute.String("user.message", args.Invocation.Message.Content),
    ),
)
args.Invocation.SetState("agent:span", span)
```

```go
// After
startTimeVal, _ := args.Invocation.GetState("agent:start_time")
startTime := startTimeVal.(time.Time)
duration := time.Since(startTime)

// 上报 Metrics
e.agentDurationHistogram.Record(ctx, duration.Seconds(),
    metric.WithAttributes(
        attribute.String("agent.name", args.Invocation.AgentName),
        attribute.String("invocation.id", args.Invocation.InvocationID),
    ),
)
e.agentCounter.Add(ctx, 1, ...)

// 结束 Span 并清理
if spanVal, ok := args.Invocation.GetState("agent:span"); ok {
    span := spanVal.(trace.Span)
    if args.Error != nil {
        span.RecordError(args.Error)
    }
    span.SetAttributes(
        attribute.Float64("duration.seconds", duration.Seconds()),
        attribute.String("status", statusOf(args.Error)),
    )
    span.End()
    args.Invocation.DeleteState("agent:span")
}
args.Invocation.DeleteState("agent:start_time")
```

Model 回调模式完全一致，只是 key 前缀换成 `model:`、span 名换成 `model_inference`、维度换成 `messages.count`。

### Tool 回调：处理并发分支

```go
// 取出 ToolCallID（关键）
toolCallID := args.ToolCallID
if toolCallID == "" {
    toolCallID = "default"
}

// 用带 ToolCallID 的 key 写 State
startTime := time.Now()
key := fmt.Sprintf("tool:%s:%s:start_time", args.ToolName, toolCallID)
inv.SetState(key, startTime)

_, span := atrace.Tracer.Start(ctx, "tool_execution",
    trace.WithAttributes(
        attribute.String("tool.name", args.ToolName),
        attribute.String("tool.call_id", toolCallID),
        attribute.String("tool.args", string(args.Arguments)),
    ),
)
spanKey := fmt.Sprintf("tool:%s:%s:span", args.ToolName, toolCallID)
inv.SetState(spanKey, span)
```

After 用同样的 key 拼装方式取出，算耗时、上报、结束 span。这种"前缀 + 名字 + ID + 字段"的 key 规范是处理并发工具调用 State 隔离的通用范式。

### 控制台同步输出

除了遥测上报，每个回调还会实时打印计时，便于无 OTEL 环境下也能看到效果：

```
⏱️  BeforeAgentCallback: tool-timer-assistant started at 11:05:53.759
   InvocationID: invocation-...
   UserMsg: "calculate 10 + 20"

⏱️  BeforeModelCallback: model started at 11:05:53.760
   Messages: 2

⏱️  AfterModelCallback: model completed in 5.965324643s

⏱️  BeforeToolCallback: calculator (call call_abc) started at 11:05:59.725
   Args: {"a":10,"b":20,"operation":"add"}

⏱️  AfterToolCallback: calculator (call call_abc) completed in 28.224µs
   Result: {add 10 20 30}

⏱️  AfterAgentCallback: tool-timer-assistant completed in 5.965402104s
```

## 运行方式

### 前置依赖

1. **Docker Compose V2**（用于拉起遥测栈）
2. **API Key**：`export OPENAI_API_KEY="your-api-key"`

### 启动遥测栈

```bash
cd examples/callbacks/timer
docker compose up -d
```

启动后可访问：

- OTEL Collector：`localhost:4317`（gRPC trace）、`localhost:4318`（HTTP metric）
- Jaeger UI：http://localhost:16686
- Prometheus：http://localhost:9090

### 命令行参数

| 参数 | 说明 | 默认值 |
|------|------|--------|
| `-model` | 模型名 | `deepseek-v4-flash` |
| `-streaming` | 是否流式输出 | `false`（注意与 basic 不同） |

### 运行命令

```bash
go run .                              # 默认配置
go run . -model gpt-4o-mini
go run . -streaming=true              # 启用流式（计时输出会被多次切片）
```

### 交互命令

| 输入 | 效果 |
|------|------|
| `calculate 10 + 20` | 触发一次完整 Agent→Model→Tool→Model→Agent 链路 |
| `calculate 123 * 321` | 不同运算场景 |
| `/history` | 让 Agent 复述历史 |
| `/new` | 开启新会话 |
| `/exit` | 退出 |

### 查看遥测数据

- 打开 http://localhost:16686 → Service 选 `trpc_agent_go.app` → Search → 看到含 `agent_execution` / `model_inference` / `tool_execution` 三个嵌套 span 的 trace
- 打开 http://localhost:9090 → 查询 `agent_duration_seconds_bucket` / `tool_executions_total` 等

## 适用场景与对比

**选 timer 当：**
- 生产环境需要 SLA 指标（P50/P99 耗时）
- 想定位慢调用的瓶颈（模型 vs 工具）
- 已有 Prometheus / Jaeger 基础设施，希望接入 Agent 链路
- 需要并发工具调用的耗时统计

**对比兄弟示例：**

| 维度 | timer | basic | auth | imagetool |
|------|-------|-------|------|-----------|
| 输出形式 | 控制台 + OTEL | 控制台 | 控制台 | 模型回复 |
| 并发安全 | ✅（ToolCallID） | — | — | — |
| 外部依赖 | docker 栈 | 无 | 无 | 多模态模型 |
| 代码模板 | 最完整 | 入门 | 中等 | 单文件 |
| Span | ✅ | ❌ | ❌ | ❌ |

### 复用到自己项目的步骤

1. 复制 `metrics.go`：改一改指标名、维度，对接你自己的 OTEL 端点
2. 复制 `callbacks.go`：把 `toolTimerExample` 换成你的结构体，保留 key 拼装逻辑
3. 在 Agent 构造时挂上三套 callbacks
4. （可选）去掉控制台 `fmt.Printf`，只保留 OTEL 上报

## 关键要点

1. **Invocation.State 是 Before/After 之间传递计时和 span 的天然载体**：线程安全、自动回收
2. **Key 必须包含 ToolCallID**：否则并发工具调用会互相覆盖 State
3. **`tool.ToolCallIDFromContext(ctx)` 或 `args.ToolCallID`** 是获取当前 tool call 唯一 ID 的两种方式，老版本无该字段时用 `"default"` 兜底
4. **Span 必须显式 `.End()`**：否则 trace 永远不会闭合
5. **State 用完显式 `DeleteState`**：避免长生命周期 Invocation 的内存堆积
6. **Histogram + Counter 组合**：前者看耗时分布、后者看吞吐量，二者配合是可观测的标配

## 总结

timer 示例把"三级回调"从控制台玩具升级为**生产级可观测管道**，并示范了处理并发工具调用的关键技巧（ToolCallID + 多级 State key）。理解了它，就能把任何业务自定义指标（成本、Token、缓存命中率等）以同样的方式埋进 Agent 全链路。回到 [`basic`](./callbacks-basic.md) 重看一遍基础干预手法，或到 [`callbacks`](./callbacks.md) 索引页查看完整导航。
