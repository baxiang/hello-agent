# 追踪（Tracing）

OpenAI Agents SDK 内置完整的追踪系统——不需要额外集成 OpenTelemetry、Langfuse 等外部工具，SDK 自动追踪每次 Agent 运行并生成结构化 Span/Trace 数据。

## 1. 自动追踪（零配置）

```python
from agents import Agent, Runner

# 不需要任何配置，自动追踪每次 run()
agent = Agent(name="assistant", model="gpt-4o")
result = await Runner.run(agent, "What is the weather?")
# Trace 自动包含：Span 树、Token 用量、工具调用、延迟
```

## 2. Trace 结构

```
Trace: "assistant run"
├── Span: agent_run
│     ├── Span: model_call (gpt-4o)
│     │     ├── tokens_in: 150
│     │     ├── tokens_out: 30
│     │     └── latency_ms: 1200
│     ├── Span: tool_call (get_weather)
│     │     ├── input: {"city": "Tokyo"}
│     │     ├── output: "sunny, 22°C"
│     │     └── latency_ms: 45
│     └── Span: model_call (gpt-4o)  ← 第二次模型调用（含工具结果）
│           ├── tokens_in: 250
│           ├── tokens_out: 80
│           └── latency_ms: 900
```

## 3. 自定义 Trace

```python
from agents import trace

# 创建命名 trace 分组多个 Agent 调用
with trace("customer_support_workflow"):
    result1 = await Runner.run(triage, "Billing question")
    result2 = await Runner.run(billing, "Refund order #123")
    # 两个 run 属于同一个 trace
```

```python
# 带元数据的 trace
with trace("workflow", metadata={"user_id": "u-123", "tier": "premium"}):
    result = await Runner.run(agent, "Hello")
```

## 4. 配置追踪

```python
from agents import set_tracing_export_api_key, set_trace_processors
from agents.tracing import ConsoleSpanExporter

# 控制台输出 trace（开发调试）
set_trace_processors([ConsoleSpanExporter()])

# 或其他导出方式
set_tracing_export_api_key("your-api-key")
```

### 自定义 Processor

```python
from agents.tracing import TracingProcessor, Trace, Span

class MyProcessor(TracingProcessor):
    def on_trace_start(self, trace: Trace):
        print(f"[Trace] {trace.name} started")

    def on_trace_end(self, trace: Trace):
        print(f"[Trace] {trace.name} ended, {len(trace.spans)} spans")

    def on_span_start(self, span: Span):
        print(f"  [Span] {span.name} started")

    def on_span_end(self, span: Span):
        print(f"  [Span] {span.name} ended ({span.duration_ms}ms)")

    def force_flush(self):
        pass

    def shutdown(self):
        pass

set_trace_processors([MyProcessor()])
```

## 5. 追踪数据内容

每个 Span 包含：

| 字段 | 说明 |
|------|------|
| `span_id` | Span 唯一 ID |
| `trace_id` | 所属 Trace ID |
| `parent_id` | 父 Span ID |
| `name` | 如 `agent_run`、`model_call`、`tool_call` |
| `started_at / ended_at` | 时间戳 |
| `duration_ms` | 耗时毫秒 |
| `error` | 错误信息（如有） |
| `span_data` | 类型化数据（token 用量、工具参数等） |

## 6. Span 类型

| Span 类型 | 触发时机 | 关键数据 |
|-----------|---------|----------|
| `agent_run` | Agent 开始执行 | agent_name, input |
| `model_call` | LLM 调用 | model_name, tokens_in/out, request/response |
| `tool_call` | 工具执行 | tool_name, input_args, output |
| `handoff` | Agent 转移 | from_agent, to_agent |
| `guardrail` | 护栏检查 | guardrail_name, result |

## 7. 禁用追踪

```python
from agents import set_tracing_disabled

set_tracing_disabled(True)  # 全局禁用
```

或通过环境变量：
```bash
export OPENAI_AGENTS_DISABLE_TRACING=1
```

## 8. 集成外部平台

虽然 SDK 内置追踪，但可通过自定义 Processor 导出到外部系统：

```python
# 导出到自定义后端
class CustomExporter(TracingProcessor):
    def on_span_end(self, span: Span):
        requests.post("https://my-metrics.example.com/traces", json={
            "trace_id": span.trace_id,
            "span_name": span.name,
            "duration_ms": span.duration_ms,
            "data": span.span_data,
        })

set_trace_processors([CustomExporter()])
```

## 9. 常见问题

**Q：追踪性能开销大吗？**

A：很小。Span 数据在内存中构建，Processor 异步处理，不应影响 Agent 执行性能。

**Q：可以同时使用多个 Processor 吗？**

A：可以。`set_trace_processors([ConsoleExporter(), CustomExporter()])`，所有 Processor 并行接收事件。

**Q：追踪数据保存在哪里？**

A：默认只在内存中。通过 Processor 可以导出到控制台、文件、HTTP 端点或外部平台。
