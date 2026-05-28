# 优雅关闭

`io.agentscope.core.shutdown` 包实现 AgentScope 的优雅关闭机制，确保正在执行的 Agent 请求在安全点完成或保存状态后退出，避免数据丢失。

---

## 1. 关闭流程

### 1.1 三阶段状态机

```java
// ShutdownState.java:21
public enum ShutdownState {
    RUNNING,        // :22  正常运行
    SHUTTING_DOWN,  // :23  关闭中（拒绝新请求，等待活跃请求完成）
    TERMINATED      // :24  已终止
}
```

状态转换：

```
RUNNING ──→ SHUTTING_DOWN ──→ TERMINATED
              ↑                   │
              └───────────────────┘ (resetForTesting)
```

### 1.2 完整关闭流程

1. **触发关闭**: `GracefulShutdownManager.performGracefulShutdown()` (`GracefulShutdownManager.java:198`)
   - 状态从 `RUNNING` 转为 `SHUTTING_DOWN`
   - 记录关闭开始时间
   - 启动超时监控线程

2. **拒绝新请求**: `isAcceptingRequests()` 返回 `false`，新请求抛出 `AgentShuttingDownException`

3. **等待活跃请求**: 在安全点（PostReasoning/PostActing/PostSummary）中断 Agent

4. **超时强制中断**: 到达 `shutdownTimeout` 后，强制中断所有活跃请求并保存状态

5. **终止**: 所有活跃请求完成后，状态转为 `TERMINATED`

6. **清理**: 关闭 HTTP 传输层

### 1.3 JVM Shutdown Hook

```java
// AgentScopeJvmShutdownHook.java:34
public final class AgentScopeJvmShutdownHook {
    public static void register(GracefulShutdownManager manager);  // :43
}
```

自动注册 JVM 关闭钩子（`AgentScopeJvmShutdownHook.java:47-68`），响应 SIGTERM 信号：

1. 触发优雅关闭
2. 等待活跃请求完成（超时 + 5秒宽限期）
3. 关闭 HTTP 传输层（仅所有 Agent 完成后）

宽限期 `INTERRUPT_GRACE_PERIOD = 5s`（`AgentScopeJvmShutdownHook.java:39`），给 Agent 额外时间处理中断和清理。

---

## 2. GracefulShutdownManager

```java
// GracefulShutdownManager.java:41
public final class GracefulShutdownManager {
    private static final GracefulShutdownManager INSTANCE = new GracefulShutdownManager();  // :44

    private final AtomicReference<ShutdownState> state;           // :46
    private final AtomicReference<GracefulShutdownConfig> config; // :48
    private final ConcurrentHashMap<String, ActiveRequestContext> activeRequestsByAgentId;  // :50
    private final ConcurrentHashMap<String, ShutdownSessionBinding> sessionBindings;        // :52
}
```

单例模式，全局管理关闭生命周期和活跃请求追踪。

### 2.1 核心方法

| 方法 | 位置 | 说明 |
|------|------|------|
| `getInstance()` | GracefulShutdownManager.java:73 | 获取单例 |
| `performGracefulShutdown()` | GracefulShutdownManager.java:198 | 触发优雅关闭 |
| `isAcceptingRequests()` | GracefulShutdownManager.java:135 | 是否接受新请求 |
| `ensureAcceptingRequests()` | GracefulShutdownManager.java:143 | 不接受则抛异常 |
| `registerRequest(Agent)` | GracefulShutdownManager.java:149 | 注册活跃请求 |
| `unregisterRequest(Agent)` | GracefulShutdownManager.java:164 | 注销活跃请求 |
| `interruptIfShuttingDown(Agent)` | GracefulShutdownManager.java:180 | 关闭中时中断 Agent |
| `saveOnInterruptObserved(Agent)` | GracefulShutdownManager.java:194 | 中断时保存状态 |
| `awaitTermination(Duration)` | GracefulShutdownManager.java:284 | 阻塞等待终止 |
| `getShutdownTimeoutSignal()` | GracefulShutdownManager.java:93 | 超时信号 Mono |

### 2.2 Session 绑定

`bindSession(Agent, Session, SessionKey)` (`GracefulShutdownManager.java:97`) — 绑定 Agent 到 Session，使关闭时能自动保存状态。

`checkAndClearShutdownInterrupted(Agent)` (`GracefulShutdownManager.java:113`) — 检测并清除"关闭中断"标记。客户端重试时，用于去重输入消息。

### 2.3 超时监控

`GracefulShutdownManager.java:222-265` — 每秒检查一次，超时后：
1. 发出 `shutdownTimeoutSignal`（`Sinks.Empty.tryEmitEmpty()`）
2. 保存所有活跃请求的状态到 Session
3. 强制中断所有活跃 Agent

---

## 3. GracefulShutdownConfig

```java
// GracefulShutdownConfig.java:36
public record GracefulShutdownConfig(
    Duration shutdownTimeout,            // :37
    PartialReasoningPolicy partialReasoningPolicy  // :37
) {
    public static final GracefulShutdownConfig DEFAULT =
        new GracefulShutdownConfig(null, PartialReasoningPolicy.SAVE);  // :48
}
```

### 3.1 配置项

| 参数 | 默认值 | 说明 |
|------|--------|------|
| `shutdownTimeout` | `null`（无限等待） | 关闭超时时间，必须为正数或 null |
| `partialReasoningPolicy` | `SAVE` | 部分推理结果的处理策略 |

### 3.2 验证规则

`GracefulShutdownConfig.java:63-68` — 紧凑构造函数验证：
- `partialReasoningPolicy` 不能为 null
- `shutdownTimeout` 如果指定，必须为正数

---

## 4. PartialReasoningPolicy

```java
// PartialReasoningPolicy.java:21
public enum PartialReasoningPolicy {
    SAVE,     // 保存部分推理结果到记忆
    DISCARD   // 丢弃部分推理结果
}
```

| 策略 | 说明 |
|------|------|
| `SAVE` | 关闭中断时保存已产生的部分推理内容到 Memory，恢复时可继续 |
| `DISCARD` | 关闭中断时丢弃未完成的推理内容，恢复时从头开始 |

---

## 5. GracefulShutdownHook

```java
// GracefulShutdownHook.java:54
public final class GracefulShutdownHook implements Hook {
    @Override
    public int priority() { return 0; }  // :100  最高优先级
}
```

将优雅关闭集成到 Agent 生命周期的系统 Hook。

### 5.1 安全检查点

`GracefulShutdownHook.java:64-81` — 在以下事件后检查是否需要中断：

| 检查点 | 位置 | 说明 |
|--------|------|------|
| `PostReasoningEvent` | GracefulShutdownHook.java:72 | LLM 输出全部接收完毕 |
| `PostActingEvent` | GracefulShutdownHook.java:74 | 工具执行完毕 |
| `PostSummaryEvent` | GracefulShutdownHook.java:76 | 摘要生成完毕 |

设计理念：Reasoning/Acting/Summary 阶段**允许完成**后才中断，不浪费已生成的输出 token。仅当全局超时到达时才会强制中途中断。

### 5.2 输入去重

`GracefulShutdownHook.java:88-97` — `deduplicateIfResuming()`:

如果 Agent 的 Session 之前被关闭中断过，客户端重试时可能发送相同的用户输入。此方法检测"关闭中断"标记，将输入替换为空列表，让 Agent 从已保存的 Memory 上下文恢复。

---

## 6. ActiveRequestContext

```java
// ActiveRequestContext.java:29
final class ActiveRequestContext {
    private final String requestId;                              // :33
    private final AgentBase agent;                                // :34
    private final AtomicBoolean shutdownInterruptIssued;         // :35
    private final Session session;                                // :37
    private final SessionKey sessionKey;                          // :38
}
```

单个活跃请求的运行时上下文。

### 6.1 关键方法

| 方法 | 位置 | 说明 |
|------|------|------|
| `saveToSession()` | ActiveRequestContext.java:58 | 保存 Agent 状态 + 关闭中断标记到 Session |
| `interruptForShutdown()` | ActiveRequestContext.java:70 | 发送 `SYSTEM` 中断信号（仅一次） |

### 6.2 关闭中断标记

`SHUTDOWN_INTERRUPTED_KEY = "shutdown_interrupted"` (`ActiveRequestContext.java:56`) — 保存到 Session 的标记，下次 `PreCallEvent` 时由 `GracefulShutdownHook` 检测并清除。

---

## 7. 使用示例

```java
// 配置关闭超时
GracefulShutdownManager manager = GracefulShutdownManager.getInstance();
manager.setConfig(new GracefulShutdownConfig(
    Duration.ofSeconds(30),     // 30秒超时
    PartialReasoningPolicy.SAVE // 保存部分推理
));

// 绑定 Session（关闭时自动保存）
manager.bindSession(agent, session, sessionKey);

// 手动触发关闭
manager.performGracefulShutdown();
boolean terminated = manager.awaitTermination(Duration.ofSeconds(60));
```
