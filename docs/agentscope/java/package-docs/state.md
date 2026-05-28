# State 管理

`io.agentscope.core.state` 包提供 AgentScope 有状态组件的持久化框架，定义状态标记接口、模块接口和持久化配置。

---

## 1. State 接口

```java
// State.java:47
public interface State {}
```

标记接口，表示可序列化的状态对象。实现类可被 `Session` 存储和恢复。

推荐使用 Java Record 实现简单状态：

```java
public record AgentMetaState(
    String id,
    String name,
    String description
) implements State {}
```

已有领域对象（如 `Msg`）可直接实现此接口，避免转换开销。

内置 State 实现位于同包：

| 类 | 位置 | 说明 |
|------|------|------|
| `AgentMetaState` | AgentMetaState.java | Agent 元信息 |
| `PlanNotebookState` | PlanNotebookState.java | 计划本状态 |
| `ToolkitState` | ToolkitState.java | 工具集状态 |

---

## 2. StateModule 接口

```java
// StateModule.java:45
public interface StateModule {
    default void saveTo(Session session, SessionKey sessionKey);     // :56
    default void saveTo(Session session, String sessionId);          // :67
    default void loadFrom(Session session, SessionKey sessionKey);   // :80
    default void loadFrom(Session session, String sessionId);        // :91
    default boolean loadIfExists(Session session, SessionKey sessionKey);  // :102
    default boolean loadIfExists(Session session, String sessionId);       // :117
}
```

所有有状态组件的基础接口。提供 `saveTo`/`loadFrom` 方法用于状态持久化。

### 2.1 方法说明

| 方法 | 位置 | 说明 |
|------|------|------|
| `saveTo(Session, SessionKey)` | StateModule.java:56 | 保存状态到会话 |
| `saveTo(Session, String)` | StateModule.java:67 | 便捷方法，自动转为 `SimpleSessionKey` |
| `loadFrom(Session, SessionKey)` | StateModule.java:80 | 从会话加载状态 |
| `loadFrom(Session, String)` | StateModule.java:91 | 便捷方法 |
| `loadIfExists(Session, SessionKey)` | StateModule.java:102 | 仅会话存在时加载，返回是否成功 |
| `loadIfExists(Session, String)` | StateModule.java:117 | 便捷方法 |

### 2.2 实现 StateModule 的组件

| 组件 | 说明 |
|------|------|
| `InMemoryMemory` | 保存/加载消息列表 |
| `PlanNotebook` | 保存/加载当前计划 |
| `Toolkit` | 保存/加载活跃工具组 |
| `ReActAgent` | 协调所有子组件的持久化 |

### 2.3 使用示例

```java
Session session = new JsonSession(Path.of("sessions"));

// 加载状态
agent.loadIfExists(session, "user_123");

// ... 使用 Agent ...

// 保存状态
agent.saveTo(session, "user_123");
```

---

## 3. SessionKey

```java
// SessionKey.java:46
public interface SessionKey {
    default String toIdentifier();  // :59
}
```

会话标识符接口。默认使用 JSON 序列化为字符串标识。

### 3.1 SimpleSessionKey

```java
// SimpleSessionKey.java
public record SimpleSessionKey(String sessionId) implements SessionKey {
    @Override
    public String toIdentifier() {
        return sessionId;  // 直接返回字符串，更可读
    }
}
```

默认实现，使用简单字符串 ID。

### 3.2 自定义 SessionKey

多租户场景可自定义：

```java
public record TenantSessionKey(
    String tenantId,
    String userId,
    String sessionId
) implements SessionKey {
    // toIdentifier() 默认使用 JSON 序列化
    // {"tenantId":"t001","userId":"u123","sessionId":"s456"}
}
```

自定义 `Session` 实现可解析 `SessionKey` 结构决定存储策略（如分库分表）。

---

## 4. StatePersistence 配置

```java
// StatePersistence.java:70
public record StatePersistence(
    boolean memoryManaged,          // :71
    boolean toolkitManaged,         // :72
    boolean planNotebookManaged,    // :73
    boolean statefulToolsManaged    // :74
) {
    public static StatePersistence all();         // :77  管理所有组件
    public static StatePersistence none();        // :82  不管理任何组件
    public static StatePersistence memoryOnly();  // :87  仅管理 Memory
    public static Builder builder();              // :96
}
```

控制 `ReActAgent` 管理哪些组件的状态持久化。默认管理所有组件。

### 4.1 配置项

| 配置 | 默认值 | 说明 |
|------|--------|------|
| `memoryManaged` | `true` | 管理 Memory 消息列表状态 |
| `toolkitManaged` | `true` | 管理 Toolkit 活跃工具组状态 |
| `planNotebookManaged` | `true` | 管理 PlanNotebook 计划状态 |
| `statefulToolsManaged` | `true` | 管理有状态 Tool 状态 |

### 4.2 使用场景

```java
// 默认：管理所有组件
ReActAgent agent = ReActAgent.builder()
    .name("assistant").model(model)
    .build();

// 排除 PlanNotebook（用户自行管理）
ReActAgent agent = ReActAgent.builder()
    .name("assistant").model(model)
    .statePersistence(StatePersistence.builder()
        .planNotebookManaged(false)
        .build())
    .build();

// 仅管理 Memory
ReActAgent agent = ReActAgent.builder()
    .name("assistant").model(model)
    .statePersistence(StatePersistence.memoryOnly())
    .build();

// 不管理任何组件（用户完全控制）
ReActAgent agent = ReActAgent.builder()
    .name("assistant").model(model)
    .statePersistence(StatePersistence.none())
    .build();
```

### 4.3 Builder

`StatePersistence.java:101-161` — Builder 支持细粒度控制：

```java
StatePersistence config = StatePersistence.builder()
    .memoryManaged(true)
    .toolkitManaged(false)
    .planNotebookManaged(true)
    .statefulToolsManaged(false)
    .build();
```
