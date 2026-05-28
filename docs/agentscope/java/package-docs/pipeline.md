# Pipeline 编排

`io.agentscope.core.pipeline` 包提供了多 Agent 编排的核心抽象，支持顺序执行、并行扇出和消息广播三种模式。

---

## 1. Pipeline 基础接口

```java
// Pipeline.java:29
public interface Pipeline<T> {
    Mono<T> execute(Msg input);                          // :37
    Mono<T> execute(Msg input, Class<?> structuredOutputClass);  // :46
    default Mono<T> execute() { ... }                    // :53
    default String getDescription() { ... }              // :72
}
```

泛型接口，`T` 为执行结果类型。支持结构化输出（仅最终阶段 Agent 使用）。

---

## 2. SequentialPipeline：顺序执行

```java
// SequentialPipeline.java:39
public class SequentialPipeline implements Pipeline<Msg> {
    private final List<AgentBase> agents;  // :41
}
```

链式执行：每个 Agent 的输出作为下一个 Agent 的输入。

```
Input → Agent1 → Agent2 → ... → AgentN → Output
```

### 2.1 执行逻辑

`SequentialPipeline.java:60` — `execute(Msg, Class<?>)` 实现：

1. **空列表**: 直接返回输入（`:61`）
2. **单 Agent**: 使用结构化输出参数直接调用（`:66-73`）
3. **多 Agent**: 前 N-1 个 Agent 正常调用，最后一个使用结构化输出（`:77-93`）

```java
// 使用 Builder 构建
SequentialPipeline pipeline = SequentialPipeline.builder()   // :140
    .addAgent(agent1)                                         // :156
    .addAgent(agent2)
    .addAgents(List.of(agent3, agent4))                      // :169
    .build();                                                 // :181
```

---

## 3. FanoutPipeline：扇出并行

```java
// FanoutPipeline.java:49
public class FanoutPipeline implements Pipeline<List<Msg>> {
    private final List<AgentBase> agents;          // :51
    private final boolean enableConcurrent;         // :52
    private final Scheduler scheduler;              // :54
}
```

将同一输入分发给多个 Agent，收集所有结果。

```
Input → [Agent1, Agent2, ..., AgentN] → [Output1, Output2, ..., OutputN]
```

### 3.1 并发模式

`FanoutPipeline.java:127` — `executeConcurrent()`:

- 每个 Agent 的调用在不同线程上订阅（`subscribeOn(scheduler)`），实现真正并行
- 使用 `Flux.merge()` 合并结果，事件可能交错
- 错误隔离：单个 Agent 失败不影响其他，错误收集到 `CompositeAgentException`
- 默认使用 `Schedulers.boundedElastic()`，适合 I/O 密集型操作

### 3.2 顺序模式

`FanoutPipeline.java:178` — `executeSequential()`:

- 使用 `Flux.concat()` 串联执行
- 事件按 Agent 顺序依次发出

### 3.3 流式 API

`FanoutPipeline.java:232-355` — 支持 `stream()` 方法：

```java
// 并行流式
Flux<Event> events = fanoutPipeline.stream(input, StreamOptions.defaults());

// 顺序流式
Flux<Event> events = fanoutPipeline.stream(input, options, structuredOutputClass);
```

### 3.4 Builder

```java
FanoutPipeline pipeline = FanoutPipeline.builder()    // :371
    .addAgent(agent1)
    .addAgent(agent2)
    .concurrent()          // 并发模式（默认）:435
    // .sequential()      // 顺序模式:444
    .scheduler(custom)     // 自定义调度器:425
    .build();              // :453
```

---

## 4. MsgHub：消息广播

```java
// MsgHub.java:100
public class MsgHub implements AutoCloseable {
    private final String name;                        // :104
    private final List<AgentBase> participants;       // :105
    private final List<Msg> announcement;             // :106
    private boolean enableAutoBroadcast;              // :107
}
```

MsgHub 实现多 Agent 对话中的消息共享与广播。当 Agent 加入 MsgHub 后，自动观察其他 Agent 的消息，无需手动传递。

### 4.1 核心功能

| 功能 | 方法 | 位置 |
|------|------|------|
| 进入 Hub | `enter()` | MsgHub.java:158 |
| 退出 Hub | `exit()` | MsgHub.java:182 |
| 添加参与者 | `add(AgentBase...)` | MsgHub.java:211 |
| 移除参与者 | `delete(AgentBase...)` | MsgHub.java:244 |
| 广播消息 | `broadcast(Msg)` | MsgHub.java:282 |
| 切换自动广播 | `setAutoBroadcast(boolean)` | MsgHub.java:305 |

### 4.2 自动广播机制

`MsgHub.java:323-333` — `resetSubscribers()`:

当 `enableAutoBroadcast=true`（默认），每个参与者的订阅者被设为所有其他参与者（不含自身）。Agent 回复时自动广播给其他所有 Agent。

### 4.3 生命周期管理

```java
// 使用 try-with-resources
try (MsgHub hub = MsgHub.builder()                    // :340
        .name("讨论组")                                // :360
        .participants(alice, bob)                      // :371
        .announcement(announcement)                    // :393
        .enableAutoBroadcast(true)                     // :416
        .build()) {                                    // :427

    hub.enter().block();   // 初始化订阅关系，广播公告

    alice.call().block();  // Alice 的回复自动广播给 Bob
    bob.call().block();    // Bob 的回复自动广播给 Alice
}
// close() 自动调用 exit() 清理订阅
```

### 4.4 对比手动传递

```java
// 没有 MsgHub（冗长且易出错）
Msg x1 = alice.call().block();
bob.observe(x1).block();
Msg x2 = bob.call().block();
alice.observe(x2).block();

// 使用 MsgHub（简洁）
try (MsgHub hub = MsgHub.builder().participants(alice, bob).build()) {
    hub.enter().block();
    alice.call().block();  // 自动广播
    bob.call().block();    // 自动广播
}
```

---

## 5. Pipelines 工具类

```java
// Pipelines.java:32
public class Pipelines {
    // 顺序执行
    public static Mono<Msg> sequential(List<AgentBase>, Msg);           // :47
    public static Mono<Msg> sequential(List<AgentBase>, Msg, Class<?>); // :69

    // 并行扇出
    public static Mono<List<Msg>> fanout(List<AgentBase>, Msg);          // :94
    public static Mono<List<Msg>> fanout(List<AgentBase>, Msg, Class<?>);// :116

    // 顺序扇出
    public static Mono<List<Msg>> fanoutSequential(List<AgentBase>, Msg);          // :142
    public static Mono<List<Msg>> fanoutSequential(List<AgentBase>, Msg, Class<?>); // :164

    // 创建可复用 Pipeline
    public static SequentialPipeline createSequential(List<AgentBase>);  // :188
    public static FanoutPipeline createFanout(List<AgentBase>);          // :198
    public static FanoutPipeline createFanoutSequential(List<AgentBase>);// :208

    // 组合 Pipeline
    public static Pipeline<Msg> compose(SequentialPipeline, SequentialPipeline);  // :219
}
```

提供函数式风格的一次性操作和可复用 Pipeline 工厂方法。

---

## 6. Pipeline 组合模式

### 6.1 嵌套顺序

```java
Pipeline<Msg> composed = Pipelines.compose(pipeline1, pipeline2);
// 等价于: pipeline1.execute(input).flatMap(pipeline2::execute)
```

`Pipelines.java:226-251` — `ComposedSequentialPipeline` 内部类实现组合，结构化输出仅在第二个 Pipeline 生效。

### 6.2 扇出 + 汇聚

```java
// 多个 Agent 并行处理后，结果汇聚给汇总 Agent
FanoutPipeline fanout = FanoutPipeline.builder()
    .addAgent(researcher1)
    .addAgent(researcher2)
    .build();

List<Msg> results = fanout.execute(query).block();
Msg merged = merger.call(aggregateMsg(results)).block();
```

### 6.3 MsgHub 多轮对话

```java
try (MsgHub hub = MsgHub.builder()
        .participants(writer, reviewer, editor)
        .announcement(instructions)
        .build()) {
    hub.enter().block();
    // 多轮自动广播对话
    for (int i = 0; i < 3; i++) {
        writer.call().block();
        reviewer.call().block();
        editor.call().block();
    }
}
```

---

## 7. 与其他框架对比

### 7.1 vs Google ADK-go Workflow

| 特性 | AgentScope Pipeline | ADK-go Workflow |
|------|-------------------|-----------------|
| 编排模型 | Pipeline 接口 + MsgHub | DAG 有向无环图 |
| 顺序执行 | `SequentialPipeline` | `SequentialWorkflow` |
| 并行执行 | `FanoutPipeline` | `ParallelWorkflow` |
| 消息传递 | 自动广播（MsgHub） | 显式 edge 连接 |
| 条件分支 | 自定义 Pipeline | 内置 `ConditionalWorkflow` |
| 流式支持 | 原生 Flux 流 | 有限 |

### 7.2 vs ByteDance Eino Graph

| 特性 | AgentScope Pipeline | Eino Graph |
|------|-------------------|------------|
| 编排模型 | Pipeline + MsgHub | Graph（节点+边） |
| 顺序执行 | `SequentialPipeline` | Chain |
| 并行执行 | `FanoutPipeline` | Graph 并行节点 |
| 状态管理 | Session + StateModule | 内置 State |
| 类型安全 | 泛型 `Pipeline<T>` | 泛型 `Graph<I,O>` |
| 人机交互 | Hook stopAgent() | 内置 HumanInterrupt |

### 7.3 设计哲学差异

- **AgentScope**: 以 Agent 为中心，Pipeline 是 Agent 的编排层；MsgHub 强调自动消息广播
- **ADK-go**: 以 Workflow 为中心，Agent 是 DAG 节点；强调显式依赖声明
- **Eino**: 以 Graph 为中心，强调类型安全的流式数据流；内置更多编排原语
