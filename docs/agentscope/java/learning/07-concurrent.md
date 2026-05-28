# Java 并发编程

agentscope-java 使用并发机制保证线程安全和高效执行，理解并发编程是阅读 AgentBase、Toolkit 等核心类的关键。

## 并发编程概览

| 概念 | 项目应用 | 说明 |
|---|---|---|
| `AtomicBoolean` | `AgentBase.running` | 原子布尔，无锁线程安全 |
| `AtomicReference` | `interruptFlag` | 原子引用，无锁更新对象 |
| `CopyOnWriteArrayList` | `hooks`, `memory` | 写时复制列表，读多写少场景 |
| `ConcurrentHashMap` | `hubSubscribers` | 并发安全 Map |
| `volatile` | 字段可见性 | 跨线程可见性保证 |
| `synchronized` | 方法/块同步 | 互斥锁 |

## 1. 原子类 (Atomic*)

### AtomicBoolean

```java
// AgentBase.java
private final AtomicBoolean running = new AtomicBoolean(false);

// 检查并设置 (CAS - Compare And Set)
public Mono<Msg> call(List<Msg> msgs) {
    if (checkRunning && !running.compareAndSet(false, true)) {
        // 如果 running 是 false，设为 true，返回 true
        // 如果 running 已经是 true，返回 false (说明已经在运行)
        throw new IllegalStateException("Agent is already running");
    }
    
    return doWork()
        .doFinally(signal -> running.set(false));  // 完成后重置
}
```

### AtomicBoolean 常用方法

| 方法 | 说明 |
|---|---|
| `get()` | 获取当前值 |
| `set(boolean)` | 设置值 |
| `compareAndSet(expected, new)` | CAS：如果当前值=expected，设为 new |
| `getAndSet(new)` | 设置新值，返回旧值 |

### AtomicReference

```java
// AgentBase.java
private final AtomicReference<Msg> userInterruptMessage = new AtomicReference<>(null);
private final AtomicReference<InterruptSource> interruptSource = new AtomicReference<>(InterruptSource.USER);

// 设置中断消息
public void interrupt(Msg message) {
    interruptFlag.set(true);
    userInterruptMessage.set(message);
    interruptSource.set(InterruptSource.USER);
}

// 获取中断消息
public Msg getInterruptMessage() {
    return userInterruptMessage.get();
}
```

### AtomicInteger / AtomicLong

```java
// 计数器
AtomicInteger counter = new AtomicInteger(0);

// 增加并返回新值
int newValue = counter.incrementAndGet();  // counter++, 返回新值

// 增加并返回旧值
int oldValue = counter.getAndIncrement();  // counter++, 返回旧值

// 增加指定值
counter.addAndGet(10);
```

## 2. CopyOnWriteArrayList

### 原理

**写时复制**：每次修改时复制整个数组，适合读多写少场景。

```
读操作 → 直接读原数组 (无锁，高性能)
写操作 → 复制新数组，修改后替换引用
```

### 项目中的使用

```java
// AgentBase.java
private final List<Hook> hooks;  // 实际是 CopyOnWriteArrayList

public AgentBase(String name, ...) {
    this.hooks = new CopyOnWriteArrayList<>(hooks);
}

// 添加 Hook (写操作 → 复制)
public void addHook(Hook hook) {
    hooks.add(hook);  // 内部复制数组
    hooks.sort(HOOK_COMPARATOR);  // 排序也触发复制
}

// 读取 Hook (读操作 → 无锁)
public List<Hook> getHooks() {
    return hooks;  // 直接返回，无需加锁
}

// 遍历 Hook (读操作 → 无锁，迭代器安全)
hooks.forEach(h -> h.onEvent(event));
```

### CopyOnWriteArrayList 特性

| 特性 | 说明 |
|---|---|
| **线程安全** | 写操作互斥，读操作无锁 |
| **读高性能** | 读无锁，直接访问 |
| **写低性能** | 写需复制整个数组 |
| **迭代器安全** | 迭代器基于创建时的数组，不受后续修改影响 |
| **适合场景** | 读多写少 (Hook 注册少，遍历频繁) |

## 3. ConcurrentHashMap

### 项目中的使用

```java
// AgentBase.java
private final Map<String, List<AgentBase>> hubSubscribers = new ConcurrentHashMap<>();

// 添加订阅者 (线程安全)
public void subscribe(String hubId, AgentBase subscriber) {
    hubSubscribers.computeIfAbsent(hubId, k -> new CopyOnWriteArrayList<>())
        .add(subscriber);
}

// 获取订阅者 (线程安全)
public List<AgentBase> getSubscribers(String hubId) {
    return hubSubscribers.getOrDefault(hubId, List.of());
}

// 广播消息 (线程安全)
public void broadcast(String hubId, Msg msg) {
    List<AgentBase> subscribers = hubSubscribers.get(hubId);
    if (subscribers != null) {
        subscribers.forEach(agent -> agent.observe(msg).subscribe());
    }
}
```

### ConcurrentHashMap 常用方法

| 方法 | 说明 |
|---|---|
| `put(key, value)` | 线程安全写入 |
| `get(key)` | 线程安全读取 |
| `getOrDefault(key, default)` | 获取或默认值 |
| `computeIfAbsent(key, function)` | 如果不存在，计算并写入 |
| `remove(key)` | 线程安全删除 |

## 4. 线程安全设计原则

### 项目的设计原则

```java
// 原则1：Agent 实例非线程安全
public abstract class AgentBase {
    private final AtomicBoolean running = new AtomicBoolean(false);
    
    public Mono<Msg> call(List<Msg> msgs) {
        // 单 Agent 实例禁止并发调用
        if (checkRunning && !running.compareAndSet(false, true)) {
            throw new IllegalStateException("Already running");
        }
        ...
    }
}

// 原则2：共享组件线程安全
public class Toolkit {
    // CopyOnWriteArrayList 保证线程安全
    private final CopyOnWriteArrayList<AgentTool> tools;
    
    // 方法可被多线程调用
    public void registerTool(Object toolObject) {
        tools.add(...);  // 线程安全
    }
}

// 原则3：不可变对象天然线程安全
public record Msg(...) {
    // 所有字段 final，不可修改
    // 可安全跨线程共享
}
```

### 线程安全策略对照

| 组件 | 策略 | 原因 |
|---|---|---|
| `AgentBase` | 非线程安全，单实例单调用 | 状态复杂，允许并发会增加复杂度 |
| `Toolkit` | CopyOnWriteArrayList | 注册少，查询多 |
| `InMemoryMemory` | CopyOnWriteArrayList | 消息追加少，读取多 |
| `Msg` | 不可变 | 天然线程安全 |
| `AtomicBoolean` | CAS 无锁 | 高性能，简单状态 |

## 5. volatile 关键字

### volatile 的作用

```java
// volatile 保证可见性
private volatile boolean shutdownRequested = false;

// 线程1：请求关闭
shutdownRequested = true;

// 线程2：检查关闭
while (!shutdownRequested) {
    doWork();
}
// volatile 保证线程2能立即看到线程1的修改
```

### volatile vs Atomic*

| 特性 | volatile | Atomic* |
|---|---|---|
| **可见性** | ✅ 保证 | ✅ 保证 |
| **原子性** | ❌ 不保证 | ✅ 保证 |
| **复合操作** | ❌ 不安全 | ✅ 安全 |

```java
// volatile 不安全的例子
volatile int counter = 0;

// 多线程执行 counter++
// counter++ 实际是：读取 → 加1 → 写入
// 三步不是原子操作，可能丢失更新

// Atomic 保证原子性
AtomicInteger counter = new AtomicInteger(0);
counter.incrementAndGet();  // 原子操作，线程安全
```

## 6. synchronized 关键字

### 项目中较少使用

agentscope-java 优先使用 Atomic* 和 CopyOnWrite*，避免 synchronized 的性能开销。

```java
// 传统方式 (项目少用)
public synchronized void addHook(Hook hook) {
    hooks.add(hook);
}

// 项目方式 (CopyOnWriteArrayList 内部已处理)
public void addHook(Hook hook) {
    hooks.add(hook);  // CopyOnWriteArrayList 保证线程安全
}
```

### synchronized 适用场景

| 场景 | 推荐方式 |
|---|---|
| 简单计数 | `AtomicInteger` |
| 简单布尔 | `AtomicBoolean` |
| 读多写少列表 | `CopyOnWriteArrayList` |
| 读多写少 Map | `ConcurrentHashMap` |
| 复合操作 | `synchronized` 或 `ReentrantLock` |

## 源码对照

| 文件 | 并发机制 | 行号 |
|---|---|---|
| `AgentBase.java` | `AtomicBoolean running` | ~98 |
| `AgentBase.java` | `CopyOnWriteArrayList hooks` | ~100 |
| `AgentBase.java` | `ConcurrentHashMap hubSubscribers` | ~104 |
| `Toolkit.java` | `CopyOnWriteArrayList tools` | 内部类 |
| `InMemoryMemory.java` | `CopyOnWriteArrayList messages` | 字段定义 |

## 自检问题

1. `AtomicBoolean.compareAndSet()` 的作用是什么？
2. `CopyOnWriteArrayList` 为什么适合读多写少场景？
3. `volatile` 和 `Atomic*` 的区别是什么？
4. 为什么 Agent 实例设计为非线程安全？

## 动手实践

```java
// 1. AtomicBoolean 使用
AtomicBoolean flag = new AtomicBoolean(false);

if (flag.compareAndSet(false, true)) {
    System.out.println("成功设置为 true");
} else {
    System.out.println("已经是 true，无法设置");
}

// 2. CopyOnWriteArrayList 使用
CopyOnWriteArrayList<String> list = new CopyOnWriteArrayList<>();
list.add("a");
list.add("b");

// 遍历安全 (迭代器基于创建时的数组)
Iterator<String> iter = list.iterator();
list.add("c");  // 修改不影响迭代器
while (iter.hasNext()) {
    System.out.println(iter.next());  // 只输出 a, b
}

// 3. ConcurrentHashMap 使用
ConcurrentHashMap<String, Integer> map = new ConcurrentHashMap<>();
map.put("a", 1);
map.computeIfAbsent("b", k -> 2);  // 如果不存在，设为 2
map.computeIfAbsent("a", k -> 3);  // 已存在，不修改
```

---

**下一步**：阅读 [08-reactive.md](08-reactive.md) (核心，最重要)