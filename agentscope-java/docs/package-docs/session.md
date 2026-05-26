# io.agentscope.core.session — 会话包文档

## Session 接口

提供键值存储用于 Agent 状态：
- `save(sessionKey, key, object)` — 持久化状态
- `get(sessionKey, key, Class<T>)` → `Optional<T>` — 加载状态
- `getList(sessionKey, key, Class<T>)` → `List<T>` — 加载列表状态

## 实现

| 实现 | 说明 |
|---|---|
| `JsonSession` | 基于文件的 JSON 存储，增量追加（对大对话历史高效）。每个会话是一个 JSONL 文件。支持列表条目的哈希去重 |
| `InMemorySession` | 易失性内存存储，用于测试和开发 |

## 使用模式

```java
Session session = new JsonSession(Path.of("sessions"));
SessionKey key = SimpleSessionKey.of("user-123");

// 保存 Agent 状态
agent.saveTo(session, key);

// 恢复 Agent 状态
agent.loadFrom(session, key);
```

## 扩展实现

在 `agentscope-extensions` 中可用的外部会话实现：
- `agentscope-extensions-session-mysql` — MySQL 后端会话
- `agentscope-extensions-session-redis` — Redis 后端会话

## 相关文档

- [核心包](../core.md)
- [状态包](state.md)
