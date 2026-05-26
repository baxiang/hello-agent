# Project Reactor 响应式编程

**这是 agentscope-java 的核心技术**。所有 I/O 操作返回 `Mono<T>` 或 `Flux<T>`，理解响应式编程是阅读源码的前提。

## 响应式编程核心概念

| 概念 | 说明 | 项目应用 |
|---|---|---|
| **Mono<T>** | 0 或 1 个元素的异步流 | `Agent.call()` 返回值 |
| **Flux<T>** | 0 到 N 个元素的异步流 | `Model.stream()` 返回值 |
| **Publisher** | 数据源 (Mono/Flux 都是 Publisher) | Reactor 核心 |
| **Subscriber** | 数据消费者 | `.subscribe()` |
| **Operator** | 中间操作 (map, filter, flatMap) | 数据转换 |
| **Scheduler** | 执行调度器 | 线程池管理 |

## 1. Mono vs Flux

### Mono<T> — 单值异步流

```java
// Mono 表示异步返回一个值 (或空)
Mono<Msg> result = agent.call(input);

// 类似于 Future<Msg>，但更强大
```

### Flux<T> — 多值异步流

```java
// Flux 表示异步返回多个值 (流式)
Flux<Event> events = agent.stream(input, options);

// 类似于 Stream<Event>，但异步
```

### 项目中的使用

```java
// AgentBase.java — Mono 单值返回
public Mono<Msg> call(List<Msg> msgs);

// Model.java — Flux 流式返回
public Flux<ChatResponse> stream(List<Msg> messages, List<ToolSchema> tools, GenerateOptions options);

// ReActAgent.java — Mono 链式操作
return Mono.just(input)
    .flatMap(msg -> model.stream(...).collectList())
    .map(response -> buildMsg(response));
```

## 2. Mono 基本操作

### 创建 Mono

| 方法 | 说明 | 示例 |
|---|---|---|
| `Mono.just(value)` | 直接包装值 | `Mono.just("hello")` |
| `Mono.empty()` | 空 Mono | `Mono.empty()` |
| `Mono.error(exception)` | 错误 Mono | `Mono.error(new RuntimeException())` |
| `Mono.fromSupplier(supplier)` | 从 Supplier 创建 | `Mono.fromSupplier(() -> fetch())` |
| `Mono.defer(supplier)` | 延迟创建 | `Mono.defer(() -> Mono.just(getValue()))` |
| `Mono.using(resource, function, cleanup)` | 资源管理 | `Mono.using(this::acquire, agent -> doCall(), this::release)` |

### 项目中的 Mono 创建

```java
// AgentBase.java
return Mono.using(
    this::acquireExecution,     // 创建/获取资源
    agent -> doCall(msgs),      // 使用资源执行
    this::releaseExecution      // 清理资源
);

// ReActAgent.java
return Mono.just(input)         // 包装输入
    .flatMap(msg -> process(msg));
```

### Mono 转换操作

| 操作 | 说明 | 签名 |
|---|---|---|
| `map(Function)` | 同步转换值 | `Mono<R> map(Function<T, R>)` |
| `flatMap(Function)` | 异步转换 (返回 Mono) | `Mono<R> flatMap(Function<T, Mono<R>>)` |
| `filter(Predicate)` | 过滤 (不满足返回 empty) | `Mono<T> filter(Predicate<T>)` |
| `switchIfEmpty(Mono)` | 空时切换 | `Mono<T> switchIfEmpty(Mono<T>)` |
| `defaultIfEmpty(value)` | 空时默认值 | `Mono<T> defaultIfEmpty(T)` |

### 项目中的 Mono 转换

```java
// ReActAgent.java
return model.stream(msgs, tools, options)    // Flux<ChatResponse>
    .collectList()                           // Mono<List<ChatResponse>>
    .map(responses -> buildMsg(responses))   // Mono<Msg>
    .flatMap(msg -> {
        if (isFinished(msg)) {
            return Mono.just(msg);
        }
        return acting().then(reasoning());   // Mono<Msg>
    });

// AgentBase.java
return Mono.just(input)
    .filter(msg -> msg.getContent().size() > 0)  // 过滤空消息
    .switchIfEmpty(Mono.just(emptyResponse));    // 空时返回默认
```

### Mono 错误处理

| 操作 | 说明 |
|---|---|---|
| `onErrorResume(Function)` | 错误时切换到备用 Mono | `mono.onErrorResume(e -> fallback())` |
| `onErrorReturn(value)` | 错误时返回默认值 | `mono.onErrorReturn(defaultValue)` |
| `onErrorContinue(consumer)` | 错误时继续 (Flux 常用) | `flux.onErrorContinue(e -> log(e))` |
| `doOnError(consumer)` | 错误时执行操作 (不处理) | `mono.doOnError(e -> log.error(e))` |

### 项目中的错误处理

```java
// AgentBase.java
return Mono.using(...)
    .onErrorResume(error -> {
        if (error instanceof InterruptedException) {
            return handleInterrupt(ctx, msgs);
        }
        if (error instanceof AgentShuttingDownException) {
            return Mono.error(error);  // 传播关闭异常
        }
        return handleError(error);
    });

// Toolkit.java
return executeTool(toolUse)
    .onErrorResume(e -> {
        log.error("Tool execution failed", e);
        return Mono.just(ToolResultBlock.error(e.getMessage()));
    });
```

## 3. Flux 基本操作

### 创建 Flux

| 方法 | 说明 |
|---|---|---|
| `Flux.just(values)` | 包装多个值 |
| `Flux.fromIterable(iterable)` | 从 Iterable 创建 |
| `Flux.fromStream(stream)` | 从 Stream 创建 |
| `Flux.range(start, count)` | 整数范围 |
| `Flux.interval(duration)` | 定时发射 |

### Flux 转换操作

| 操作 | 说明 |
|---|---|---|
| `map(Function)` | 同步转换 |
| `flatMap(Function)` | 异步转换 (返回 Flux/Mono) |
| `filter(Predicate)` | 过滤 |
| `take(n)` | 取前 n 个 |
| `skip(n)` | 跳过前 n 个 |
| `collectList()` | 收集为 Mono<List> |
| `reduce(accumulator)` | 聚合为 Mono |

### 项目中的 Flux 使用

```java
// Model.java — 流式推理
public Flux<ChatResponse> stream(List<Msg> messages, ...) {
    // 流式返回 LLM 响应块
    return Flux.create(emitter -> {
        // 每个 token 触发 emitter.next(chunk)
        emitter.next(chunk1);
        emitter.next(chunk2);
        emitter.complete();
    });
}

// ReActAgent.java — 收集流式响应
return model.stream(msgs, tools, options)
    .collectList()  // 收集所有块为 List
    .map(list -> buildMsg(list));

// Hook.java — 流式事件
return Flux.fromIterable(hooks)
    .flatMap(hook -> hook.onEvent(event));  // 每个 Hook 处理事件
```

## 4. flatMap vs map (关键区别)

### map — 同步转换

```java
// map: T → R (同步)
Mono<String> mono = Mono.just("hello");
Mono<Integer> lengthMono = mono.map(s -> s.length());  // String → Integer

// 内部：直接在当前线程执行 s.length()
```

### flatMap — 异步转换

```java
// flatMap: T → Mono<R> (异步)
Mono<String> mono = Mono.just("hello");
Mono<String> resultMono = mono.flatMap(s -> fetchFromDB(s));  // String → Mono<String>

// 内部：
// 1. 执行 s → fetchFromDB(s)
// 2. fetchFromDB 返回 Mono<String>
// 3. 等待 Mono<String> 完成
// 4. 取出 Mono 内部的值继续
```

### 项目中的 flatMap 链

```java
// ReActAgent.java
return model.stream(msgs, tools, options)  // Flux<ChatResponse>
    .collectList()                         // Mono<List<ChatResponse>>
    .flatMap(responses -> {                // List → Mono<Msg>
        Msg msg = buildMsg(responses);
        if (isFinished(msg)) {
            return Mono.just(msg);         // 直接返回
        }
        return acting()                    // Mono<ToolResult>
            .then(reasoning());            // Mono<Msg>
    });
```

### flatMap 什么时候用？

| 场景 | 使用 |
|---|---|
| 转换函数返回普通值 | `map()` |
| 转换函数返回 Mono/Flux | `flatMap()` |
| 需要异步 I/O (HTTP, DB) | `flatMap()` |
| 需要串联多个 Mono | `flatMap()` |

## 5. Mono 链式组合

### then() — 忽略上游，执行下游

```java
// then: 忽略上游结果，执行下游 Mono
Mono<String> first = Mono.just("hello");
Mono<Integer> second = Mono.just(42);

Mono<Integer> combined = first.then(second);  // 执行 first，忽略结果，执行 second

// 项目中使用
return acting()                // 执行工具
    .then(reasoning());        // 忽略工具结果，执行推理
```

### when() — 并行执行多个 Mono

```java
// when: 并行执行多个 Mono，等待全部完成
Mono<String> mono1 = fetchFromService1();
Mono<String> mono2 = fetchFromService2();

Mono<Tuple2<String, String>> combined = Mono.when(mono1, mono2);
// 并行执行 mono1 和 mono2，等待两者完成

// 项目中使用 (FanoutPipeline)
Mono<List<Msg>> results = Mono.when(
    agent1.call(input),
    agent2.call(input),
    agent3.call(input)
).map(tuple -> List.of(tuple.getT1(), tuple.getT2(), tuple.getT3()));
```

## 6. Scheduler (调度器)

### Scheduler 类型

| Scheduler | 说明 | 适用场景 |
|---|---|---|
| `Schedulers.immediate()` | 当前线程 | 无切换 |
| `Schedulers.single()` | 单线程 | 顺序执行 |
| `Schedulers.boundedElastic()` | 有界弹性线程池 | I/O 操作 (默认) |
| `Schedulers.parallel()` | 固定并行线程池 | CPU 密集计算 |

### 项目中的 Scheduler 使用

```java
// 在指定线程池执行
return Mono.fromSupplier(() -> blockingIO())
    .subscribeOn(Schedulers.boundedElastic());  // 在弹性线程池执行阻塞操作

// 在指定线程池处理结果
return model.stream(...)
    .publishOn(Schedulers.parallel());  // 在并行线程池处理

// 项目中的阻塞操作
return Mono.fromCallable(() -> {
    Thread.sleep(1000);  // 阻塞操作
    return result;
}).subscribeOn(Schedulers.boundedElastic());  // 避免阻塞主线程
```

## 7. subscribe (消费 Mono)

### subscribe 方式

```java
// 1. 简单消费
mono.subscribe(value -> System.out.println(value));

// 2. 完整消费 (值、错误、完成)
mono.subscribe(
    value -> System.out.println("收到: " + value),
    error -> System.err.println("错误: " + error),
    () -> System.out.println("完成")
);

// 3. 返回 Disposable (可取消)
Disposable disposable = mono.subscribe(value -> process(value));
disposable.dispose();  // 取消订阅

// 项目中通常不直接 subscribe
// 由上层调用者决定如何消费
```

### ❌ 不要在业务代码中使用 .block()

```java
// ❌ 错误：阻塞等待结果
Msg result = agent.call(input).block();  // 阻塞当前线程

// ✅ 正确：链式组合
return agent.call(input)
    .flatMap(msg -> nextStep(msg))
    .subscribe(result -> handleResult(result));

// ✅ 仅在 main() 或测试中使用 block()
public static void main(String[] args) {
    Msg result = agent.call(input).block();  // OK，main 方法可以阻塞
    System.out.println(result);
}

@Test
void testAgent() {
    Msg result = agent.call(input).block();  // OK，测试可以阻塞
    assertNotNull(result);
}
```

## 8. 响应式编程的好处

| 好处 | 说明 |
|---|---|
| **非阻塞** | 不阻塞线程，提高资源利用率 |
| **背压** | 消费者控制数据流速度 (Flux) |
| **组合性** | Mono/Flux 链式组合，代码简洁 |
| **错误处理** | 集中式错误处理，不散落各处 |
| **资源管理** | `Mono.using` 自动清理资源 |

## 源码对照

| 文件 | Mono/Flux 使用 | 行号 |
|---|---|---|
| `AgentBase.java` | `Mono.using(...)` | `call()` 方法 |
| `ReActAgent.java` | `flatMap` 链 | `reasoning()`, `acting()` |
| `Model.java` | `Flux<ChatResponse>` | `stream()` 方法 |
| `Toolkit.java` | `Mono<ToolResult>` | `executeTool()` |

## 自检问题

1. `Mono<T>` 和 `Flux<T>` 的区别是什么？
2. `map` 和 `flatMap` 的区别是什么？什么时候用 flatMap？
3. 为什么不能在业务代码中使用 `.block()`？
4. `Mono.using()` 的作用是什么？三个参数分别是什么？

## 动手实践

```java
// 1. Mono 基本操作
Mono.just("hello")
    .map(s -> s.toUpperCase())
    .filter(s -> s.length() > 3)
    .subscribe(s -> System.out.println(s));

// 2. flatMap 链
Mono.just("user123")
    .flatMap(id -> fetchUser(id))      // 返回 Mono<User>
    .flatMap(user -> fetchOrders(user))  // 返回 Mono<List<Order>>
    .subscribe(orders -> System.out.println(orders));

// 3. 错误处理
Mono.just("hello")
    .map(s -> {
        if (s.isEmpty()) throw new RuntimeException("Empty");
        return s;
    })
    .onErrorResume(e -> Mono.just("fallback"))
    .subscribe(s -> System.out.println(s));

// 4. 组合多个 Mono
Mono.when(
    fetchFromService1(),
    fetchFromService2()
).subscribe(tuple -> {
    System.out.println(tuple.getT1() + ", " + tuple.getT2());
});

// 5. Scheduler
Mono.fromCallable(() -> blockingOperation())
    .subscribeOn(Schedulers.boundedElastic())
    .subscribe(result -> System.out.println(result));
```

---

**下一步**：阅读 [09-jackson.md](09-jackson.md)