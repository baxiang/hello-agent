# io.agentscope.core.memory — 内存包文档

## Memory 接口

定义四个操作：
- `addMessage(Msg)` — 存储消息
- `getMessages()` — 检索所有消息（永不 null，可能为空）
- `deleteMessage(int index)` — 按索引移除（越界无操作）
- `clear()` — 移除所有消息

## 实现

| 实现 | 说明 |
|---|---|
| `InMemoryMemory` | 线程安全内存存储，使用 `CopyOnWriteArrayList`。`ReActAgent` 默认。支持通过 `Session` 状态持久化 |

## 长期记忆

`LongTermMemory` 支持跨会话持久化：

```java
LongTermMemory ltm = Mem0LongTermMemory.builder()
    .apiKey(System.getenv("MEM0_API_KEY"))
    .userId("user_123")
    .build();

ReActAgent agent = ReActAgent.builder()
    .longTermMemory(ltm)
    .longTermMemoryMode(LongTermMemoryMode.BOTH) // STATIC_CONTROL, AGENT_CONTROL, 或 BOTH
    .build();
```

## 内存模式

| 模式 | 说明 |
|---|---|
| `STATIC_CONTROL` | 框架通过 Hook 自动检索和记录记忆 |
| `AGENT_CONTROL` | Agent 通过注册的工具决定何时使用记忆 |
| `BOTH` | 结合两种方式（默认） |

## 线程安全

`InMemoryMemory` 通过 `CopyOnWriteArrayList` 线程安全。长期记忆实现应确保自身的线程安全。

## 相关文档

- [核心包](../core.md)
