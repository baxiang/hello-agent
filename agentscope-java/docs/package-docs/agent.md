# io.agentscope.core.agent — Agent 包文档

## 类层次结构

```
Agent (接口)
  ├── CallableAgent    — call(msgs) → Mono<Msg>
  ├── StreamableAgent  — stream(msgs, options) → Flux<Event>
  └── ObservableAgent  — observe(msg) → Mono<Void>
      │
      ▼
AgentBase (抽象类)
  ├── ReActAgent       — ReAct 推理-执行循环（核心实现）
  ├── StructuredOutputCapableAgent — 添加结构化输出支持
  └── UserAgent        — 人机协同输入收集
```

## AgentBase 职责

- **Hook 集成** — PreCall/PostCall/Error 事件通知所有子类
- **中断机制** — 通过 `interruptFlag` 协作式中断，在检查点通过 `checkInterruptedAsync()` 检查。通过 Mono 链返回 `InterruptedException`，由 `call()` 捕获并委托给 `handleInterrupt()`
- **MsgHub 广播** — 每次 `call()` 后，消息自动广播给通过 `MsgHub` 注册的订阅者
- **流式输出** — `stream()` 用临时 `StreamingHook` 包装 `call()`，将执行事件转为 `Flux<Event>`
- **状态管理** — 实现 `StateModule` 接口，通过 Session 保存/加载状态

## 线程安全

Agent 实例**不是**线程安全的。`acquireExecution()/releaseExecution()` 模式（通过 `Mono.using`）防止同一实例上的并发 `call()` 调用。`checkRunning` 标志（默认 `true`）在第一个调用仍在运行时尝试第二次调用会抛出 `IllegalStateException`。

## 扩展 AgentBase

子类必须实现：
- `doCall(List<Msg> msgs)` — 消息处理核心逻辑
- `handleInterrupt(InterruptContext, Msg...)` — 中断恢复逻辑

## 中断机制详解

```java
// 外部调用中断
agent.interrupt(userMsg);

// 在 Agent 的 Mono 链中，在检查点：
return checkInterruptedAsync()
    .then(doWork())
    .flatMap(result -> checkInterruptedAsync().thenReturn(result));

// AgentBase.call() 捕获异常：
.onErrorResume(error -> {
    if (error instanceof InterruptedException) {
        return handleInterrupt(context, msg);
    }
    ...
});
```

## 相关文档

- [核心包](core.md)
- [Pipeline 包](pipeline.md)
