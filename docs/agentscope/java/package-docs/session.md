# Session 管理

`io.agentscope.core.session` 包提供 Agent 状态的持久化存储接口和实现，支持跨应用运行或用户交互的状态保存与恢复。

---

## 1. Session 接口

```java
// Session.java:53
public interface Session {
    void save(SessionKey sessionKey, String key, State value);                     // :64
    void save(SessionKey sessionKey, String key, List<? extends State> values);    // :82
    <T extends State> Optional<T> get(SessionKey sessionKey, String key, Class<T> type);    // :93
    <T extends State> List<T> getList(SessionKey sessionKey, String key, Class<T> itemType); // :104
    boolean exists(SessionKey sessionKey);                  // :112
    void delete(SessionKey sessionKey);                     // :119
    void delete(SessionKey sessionKey, String key);         // :127
    Set<SessionKey> listSessionKeys();                      // :136
    default void close() {}                                 // :142
}
```

### 1.1 核心方法

| 方法 | 位置 | 说明 |
|------|------|------|
| `save(key, String, State)` | Session.java:64 | 保存单值（全量替换） |
| `save(key, String, List)` | Session.java:82 | 保存列表（实现决定策略：增量追加或全量替换） |
| `get(key, String, Class)` | Session.java:93 | 获取单值，返回 `Optional` |
| `getList(key, String, Class)` | Session.java:104 | 获取列表，返回空列表而非 null |
| `exists(key)` | Session.java:112 | 检查会话是否存在 |
| `delete(key)` | Session.java:119 | 删除整个会话 |
| `delete(key, String)` | Session.java:127 | 删除单个状态条目 |
| `listSessionKeys()` | Session.java:136 | 列出所有会话键 |

### 1.2 使用示例

```java
Session session = new JsonSession(Path.of("sessions"));
SessionKey key = SimpleSessionKey.of("user_123");

// 保存
session.save(key, "agent_meta", new AgentMetaState("id", "name", "desc", "prompt"));
session.save(key, "memory_messages", messages);  // 增量追加

// 加载
Optional<AgentMetaState> meta = session.get(key, "agent_meta", AgentMetaState.class);
List<Msg> msgs = session.getList(key, "memory_messages", Msg.class);
```

---

## 2. JsonSession

```java
// JsonSession.java:58
public class JsonSession implements Session {
    private final Path sessionDirectory;  // :60
}
```

基于 JSON 文件的持久化实现。每个会话存储在以 session ID 命名的目录中。

### 2.1 存储结构

```
sessionDirectory/
└── user_123/                    # SessionKey.toIdentifier()
    ├── agent_meta.json          # 单值 → {key}.json
    ├── memory_messages.jsonl    # 列表 → {key}.jsonl（每行一个 JSON 对象）
    ├── memory_messages.hash     # 列表哈希 → {key}.hash（增量检测）
    └── toolkit_activeGroups.json
```

### 2.2 单值存储

`JsonSession.java:98` — `save(SessionKey, String, State)`:

- 路径: `{sessionDir}/{key}.json`
- 格式: Pretty JSON（UTF-8）
- 策略: 全量替换

### 2.3 列表增量追加

`JsonSession.java:127` — `save(SessionKey, String, List)`:

基于哈希的变更检测机制：

| 条件 | 行为 |
|------|------|
| 哈希变化（列表被修改） | 全量重写 |
| 列表缩短 | 全量重写 |
| 列表仅增长（追加） | 仅追加新项 |
| 无变化 | 跳过写入 |

关键实现：
- `ListHashUtil.computeHash(values)` 计算当前哈希（`:135`）
- `ListHashUtil.needsFullRewrite()` 判断是否需要全量重写（`:144`）
- 追加模式使用 `StandardOpenOption.APPEND`（`:198-212`）

### 2.4 会话键安全编码

`JsonSession.java:342` — `getSessionDir()`:

- 仅含安全字符（字母数字、下划线、连字符、点）的 ID 直接用作目录名
- 含特殊字符的 ID 使用 Base64 URL 安全编码

### 2.5 构造函数

```java
// 默认目录: ~/.agentscope/sessions
new JsonSession();                           // JsonSession.java:68

// 自定义目录
new JsonSession(Path.of("/data/sessions"));  // JsonSession.java:77
```

---

## 3. InMemorySession

```java
// InMemorySession.java:58
public class InMemorySession implements Session {
    private final Map<String, SessionData> sessions = new ConcurrentHashMap<>();  // :61
}
```

内存实现，适合单进程应用。

### 3.1 与 JsonSession 的差异

| 维度 | JsonSession | InMemorySession |
|------|-------------|-----------------|
| 持久性 | 跨 JVM 重启 | JVM 退出即丢失 |
| 列表存储 | 增量追加（JSONL） | 全量替换（`List.copyOf`） |
| 线程安全 | 文件系统保证 | ConcurrentHashMap |
| 分布式 | 不支持 | 不支持 |
| 内存占用 | 磁盘空间 | 随会话数增长 |

### 3.2 内部结构

```java
// InMemorySession.java:224
private static class SessionData {
    private final Map<String, State> singleStates = new ConcurrentHashMap<>();    // :225
    private final Map<String, List<State>> listStates = new ConcurrentHashMap<>(); // :226
}
```

`setListState()` 使用 `List.copyOf()` 创建不可变副本，防止外部修改。

### 3.3 辅助方法

| 方法 | 位置 | 说明 |
|------|------|------|
| `getSessionCount()` | InMemorySession.java:210 | 获取活跃会话数 |
| `clearAll()` | InMemorySession.java:219 | 清空所有会话 |

---

## 4. SessionManager

```java
// SessionManager.java:61
public class SessionManager {
    public static SessionManager forSessionId(String sessionId);  // :80
    public SessionManager withSession(Session session);            // :97
    public SessionManager addComponent(StateModule component);     // :114
}
```

流式 API，简化会话状态的加载和保存。

### 4.1 核心操作

| 方法 | 位置 | 说明 |
|------|------|------|
| `loadIfExists()` | SessionManager.java:130 | 会话存在时加载 |
| `loadOrThrow()` | SessionManager.java:145 | 加载，不存在则抛异常 |
| `saveSession()` | SessionManager.java:163 | 保存所有组件状态 |
| `saveOrThrow()` | SessionManager.java:179 | 保存，失败则抛异常 |
| `saveIfExists()` | SessionManager.java:195 | 仅会话存在时保存 |
| `sessionExists()` | SessionManager.java:210 | 检查会话是否存在 |
| `deleteIfExists()` | SessionManager.java:231 | 存在时删除 |
| `deleteOrThrow()` | SessionManager.java:246 | 删除，不存在则抛异常 |

### 4.2 使用示例

```java
// 加载
SessionManager.forSessionId("user123")
    .withSession(new JsonSession(Path.of("sessions")))
    .addComponent(agent)
    .addComponent(memory)
    .loadIfExists();

// 保存
SessionManager.forSessionId("user123")
    .withSession(new JsonSession(Path.of("sessions")))
    .addComponent(agent)
    .addComponent(memory)
    .saveSession();
```

---

## 5. SessionInfo

```java
// SessionInfo.java:25
public class SessionInfo {
    private final String sessionId;       // :27
    private final long size;              // :28
    private final long lastModified;      // :29
    private final int componentCount;     // :30
}
```

会话元数据，包含 ID、大小、最后修改时间和组件数量。

---

## 6. 扩展存储

实现自定义 Session 只需实现 `Session` 接口：

```java
public class RedisSession implements Session {
    private final JedisPool pool;

    @Override
    public void save(SessionKey key, String stateKey, State value) {
        try (Jedis jedis = pool.getResource()) {
            String json = JsonUtils.getJsonCodec().toJson(value);
            jedis.hset(key.toIdentifier(), stateKey, json);
        }
    }

    @Override
    public <T extends State> Optional<T> get(SessionKey key, String stateKey, Class<T> type) {
        try (Jedis jedis = pool.getResource()) {
            String json = jedis.hget(key.toIdentifier(), stateKey);
            return json != null
                ? Optional.of(JsonUtils.getJsonCodec().fromJson(json, type))
                : Optional.empty();
        }
    }
    // ... 其他方法
}
```

扩展方向：
- **数据库**: MySQL、PostgreSQL（JDBC）
- **NoSQL**: Redis、MongoDB
- **云存储**: S3、OSS
- **多租户**: 自定义 `SessionKey` 实现分片路由
