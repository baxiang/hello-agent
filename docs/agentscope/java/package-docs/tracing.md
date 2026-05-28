# 可观测性

`io.agentscope.core.tracing` 包提供 OpenTelemetry 风格的可观测性集成，支持 Agent 调用、模型推理、工具执行和格式化的追踪。

---

## 1. Tracer 接口

```java
// Tracer.java:35
public interface Tracer {
    default Mono<Msg> callAgent(...);       // :37
    default Flux<ChatResponse> callModel(...);  // :42
    default Mono<ToolResultBlock> callTool(...); // :51
    default <TReq, TResp, TParams> List<TReq> callFormat(...); // :58
    default <TResp> TResp runWithContext(...);  // :65
    default void shutdown() {}               // :69
}
```

所有方法提供默认实现（直接调用 supplier），实现类可选择性覆盖。

### 1.1 追踪点

| 方法 | 位置 | 追踪目标 |
|------|------|----------|
| `callAgent` | Tracer.java:37 | Agent 调用生命周期 |
| `callModel` | Tracer.java:42 | LLM 推理请求/响应 |
| `callTool` | Tracer.java:51 | 工具执行 |
| `callFormat` | Tracer.java:58 | 消息格式化 |
| `runWithContext` | Tracer.java:65 | 在 Reactor 上下文中运行（传播 trace 信息） |

### 1.2 方法签名

```java
// Tracer.java:37-40
default Mono<Msg> callAgent(
    AgentBase instance,
    List<Msg> inputMessages,
    Supplier<Mono<Msg>> agentCall)

// Tracer.java:42-49
default Flux<ChatResponse> callModel(
    ChatModelBase instance,
    List<Msg> inputMessages,
    List<ToolSchema> toolSchemas,
    GenerateOptions options,
    Supplier<Flux<ChatResponse>> modelCall)

// Tracer.java:51-56
default Mono<ToolResultBlock> callTool(
    Toolkit toolkit,
    ToolCallParam toolCallParam,
    Supplier<Mono<ToolResultBlock>> toolKitCall)
```

每个追踪方法接收上下文参数和一个 `Supplier`，实现类可在调用前后添加 span、日志、指标等。

---

## 2. NoopTracer

```java
// NoopTracer.java:19
public class NoopTracer implements Tracer {}
```

空实现，所有方法使用默认行为（直接调用 supplier）。作为默认 Tracer，零开销。

---

## 3. TracerRegistry

```java
// TracerRegistry.java:40
public class TracerRegistry {
    private static volatile Tracer tracer = new NoopTracer();  // :139

    public static void register(Tracer tracer);     // :141
    public static void resetToNoop();                // :150
    public static Tracer get();                      // :157
}
```

全局 Tracer 注册中心。

### 3.1 注册/注销

| 方法 | 位置 | 说明 |
|------|------|------|
| `register(Tracer)` | TracerRegistry.java:141 | 注册自定义 Tracer，自动启用/禁用 Reactor Hook |
| `resetToNoop()` | TracerRegistry.java:150 | 重置为 NoopTracer，关闭 Hook，调用 `previousTracer.shutdown()` |
| `get()` | TracerRegistry.java:157 | 获取当前 Tracer |

### 3.2 Reactor 全局 Hook

`TracerRegistry.java:74-126` — `enableTracingHook()`:

注册 Reactor `Hooks.onEachOperator` 全局钩子，确保追踪上下文在异步操作之间自动传播。

**机制**:
- 拦截每个 Reactor 操作符创建
- 包装 Subscriber，确保 `onNext`/`onError`/`onComplete` 信号在追踪上下文中处理
- 上下文从上游 Subscriber 的 `currentContext()` 捕获

**性能影响**:
- 对 JVM 中所有 Reactor 操作符生效（不仅是 AgentScope 的）
- 涉及对象分配（包装 Subscriber）和上下文捕获/恢复
- 仅在需要自动上下文传播时启用

**安全保证**: `register(Tracer)` 时自动判断——非 NoopTracer 启用 Hook，NoopTracer 禁用 Hook。

### 3.3 禁用 Hook

`TracerRegistry.java:132-137` — `disableTracingHook()`:

移除 `HOOK_KEY = "agentscope-trace-context"` 对应的全局钩子。`resetToNoop()` 时自动调用。

---

## 4. OpenTelemetry 集成

实现 OpenTelemetry 追踪只需实现 `Tracer` 接口：

```java
public class OpenTelemetryTracer implements Tracer {
    private final Tracer otelTracer;

    @Override
    public Mono<Msg> callAgent(
            AgentBase instance,
            List<Msg> inputMessages,
            Supplier<Mono<Msg>> agentCall) {
        Span span = otelTracer.spanBuilder("agent.call")
            .setAttribute("agent.name", instance.getName())
            .setAttribute("agent.id", instance.getAgentId())
            .setAttribute("input.count", inputMessages.size())
            .startSpan();
        try {
            return agentCall.get()
                .doOnNext(msg -> span.setAttribute("output.role", msg.getRole().name()))
                .doOnError(span::recordException)
                .doFinally(signal -> span.end());
        } catch (Exception e) {
            span.recordException(e);
            span.end();
            throw e;
        }
    }

    @Override
    public Flux<ChatResponse> callModel(
            ChatModelBase instance,
            List<Msg> inputMessages,
            List<ToolSchema> toolSchemas,
            GenerateOptions options,
            Supplier<Flux<ChatResponse>> modelCall) {
        Span span = otelTracer.spanBuilder("model.call")
            .setAttribute("model.name", instance.getModelName())
            .setAttribute("tools.count", toolSchemas.size())
            .startSpan();
        try {
            return modelCall.get()
                .doOnError(span::recordException)
                .doFinally(signal -> span.end());
        } catch (Exception e) {
            span.recordException(e);
            span.end();
            throw e;
        }
    }

    @Override
    public Mono<ToolResultBlock> callTool(
            Toolkit toolkit,
            ToolCallParam toolCallParam,
            Supplier<Mono<ToolResultBlock>> toolKitCall) {
        Span span = otelTracer.spanBuilder("tool.call")
            .setAttribute("tool.name", toolCallParam.name())
            .startSpan();
        try {
            return toolKitCall.get()
                .doOnError(span::recordException)
                .doFinally(signal -> span.end());
        } catch (Exception e) {
            span.recordException(e);
            span.end();
            throw e;
        }
    }

    @Override
    public <TResp> TResp runWithContext(ContextView reactorCtx, Supplier<TResp> inner) {
        // 从 Reactor 上下文提取并传播 trace 上下文
        try (Scope scope = propagateContext(reactorCtx)) {
            return inner.get();
        }
    }

    @Override
    public void shutdown() {
        // 关闭 OpenTelemetry SDK
        GlobalOpenTelemetry.get().close();
    }
}
```

注册：

```java
TracerRegistry.register(new OpenTelemetryTracer(otelTracer));
// 自动启用 Reactor Hook 传播追踪上下文
```

---

## 5. Tracing 配置

### 5.1 全局配置

```java
// 启用追踪
TracerRegistry.register(myTracer);

// 重置为无操作
TracerRegistry.resetToNoop();
```

### 5.2 Reactor Hook 控制

```java
// 手动启用（通常 register 时自动调用）
TracerRegistry.enableTracingHook();

// 手动禁用（通常 resetToNoop 时自动调用）
TracerRegistry.disableTracingHook();
```

### 5.3 最佳实践

- 生产环境推荐使用 OpenTelemetry + Jaeger/Zipkin/Tempo
- 开发环境可使用简单日志 Tracer
- `runWithContext()` 确保跨异步边界的追踪上下文传播
- `shutdown()` 在应用退出时清理 SDK 资源
- 避免在 `callModel`/`callTool` 中记录完整的消息内容（可能包含敏感信息）
