# io.agentscope.core.pipeline — Pipeline 包文档

## Pipeline 接口

定义：
- `execute(Msg input)` → `Mono<R>` — 非阻塞执行
- `execute(Msg input, Class<T>)` — 带结构化输出

## SequentialPipeline

链式模式：每个 Agent 的输出成为下一个 Agent 的输入。

```
Input → Agent1 → Agent2 → ... → AgentN → Output
```

```java
SequentialPipeline pipeline = SequentialPipeline.builder()
    .addAgent(researcher)
    .addAgent(summarizer)
    .addAgent(reviewer)
    .build();

Msg result = pipeline.execute(input).block();
```

## FanoutPipeline

扇出模式：相同输入分发给多个 Agent，结果聚合。

```
Input → [Agent1, Agent2, ..., AgentN] → [Output1, Output2, ..., OutputN]
```

支持并发（默认，通过 `boundedElastic` 调度器）或顺序执行：

```java
FanoutPipeline pipeline = FanoutPipeline.builder()
    .addAgent(techAnalyst)
    .addAgent(businessAnalyst)
    .addAgent(ethicsAnalyst)
    .concurrent() // 或 .sequential()
    .build();

List<Msg> results = pipeline.execute(input).block();
```

## MsgHub

Agent 间自动消息广播。实现 `AutoCloseable` 支持 try-with-resources 生命周期管理：

```java
try (MsgHub hub = MsgHub.builder()
        .participants(alice, bob)
        .announcement(startMsg)
        .enableAutoBroadcast(true)
        .build()) {
    hub.enter().block();
    alice.call(input).block(); // bob 自动观察
    bob.call(input).block();   // alice 自动观察
}
```

## Pipelines 工具类

`Pipelines` 提供流式工厂方法：
```java
Pipelines.sequential(researcher, summarizer, reviewer).execute(input)
Pipelines.fanout(agent1, agent2, agent3).execute(input)
```

## 线程安全

Pipeline 在构造时创建不可变 Agent 列表。`FanoutPipeline` 并发模式使用 `Scheduler` 进行并行执行。**单个 Agent 实例不得在多个 Pipeline 或并发调用间共享。**

## 相关文档

- [核心包](../core.md)
- [Agent 包](agent.md)
