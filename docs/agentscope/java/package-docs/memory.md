# 记忆系统

`io.agentscope.core.memory` 包实现了 AgentScope 的双层记忆架构：短期记忆（对话历史）和长期记忆（跨会话持久化）。

---

## 1. Memory 接口

```java
// Memory.java:29
public interface Memory extends StateModule {
    void addMessage(Msg message);      // :36
    List<Msg> getMessages();           // :43
    void deleteMessage(int index);     // :53
    void clear();                      // :61
}
```

Memory 继承 `StateModule`，支持通过 Session 进行状态持久化。核心方法：

| 方法 | 位置 | 说明 |
|------|------|------|
| `addMessage(Msg)` | Memory.java:36 | 添加消息到记忆 |
| `getMessages()` | Memory.java:43 | 获取所有消息（不含 null） |
| `deleteMessage(int)` | Memory.java:53 | 按索引删除消息，越界为 no-op |
| `clear()` | Memory.java:61 | 清空所有消息 |

---

## 2. 短期记忆：InMemoryMemory

```java
// InMemoryMemory.java:33
public class InMemoryMemory implements Memory {
    private final List<Msg> messages = new CopyOnWriteArrayList<>();  // :35
}
```

线程安全的内存实现，使用 `CopyOnWriteArrayList` 保证并发安全。

### 2.1 StateModule 实现

| 方法 | 位置 | 说明 |
|------|------|------|
| `saveTo(Session, SessionKey)` | InMemoryMemory.java:58 | 保存完整消息列表，key 为 `memory_messages` |
| `loadFrom(Session, SessionKey)` | InMemoryMemory.java:70 | 加载消息列表，先 clear 再 addAll |

`saveTo` 总是保存（包括空列表），确保清空状态也被持久化。Session 实现负责增量存储（如 `JsonSession` 根据文件行数仅追加新项）。

---

## 3. 长期记忆：LongTermMemory

```java
// LongTermMemory.java:67
public interface LongTermMemory {
    Mono<Void> record(List<Msg> msgs);     // :87
    Mono<String> retrieve(Msg msg);        // :106
}
```

长期记忆跨会话持久化用户偏好、习惯和个人信息，使 Agent 能够：
- 跨会话记住用户偏好和个人信息
- 从历史交互中学习改进
- 为长期运行的任务维护上下文
- 基于历史数据构建个性化体验

所有方法异步返回 `Mono`，支持非阻塞集成。

### 3.1 record(List\<Msg\>)

`LongTermMemory.java:87` — 将消息记录到长期记忆。框架级调用（`STATIC_CONTROL`/`BOTH` 模式下，Agent 每次回复后自动调用）。自动过滤 null 消息，空列表不报错。

### 3.2 retrieve(Msg)

`LongTermMemory.java:106` — 根据输入消息检索相关记忆。返回的文本通常注入到系统提示中提供上下文。框架级调用（`STATIC_CONTROL`/`BOTH` 模式下，每次推理前自动调用）。

---

## 4. 三种集成模式

```java
// LongTermMemoryMode.java:52
public enum LongTermMemoryMode {
    AGENT_CONTROL,    // :57  Agent 通过工具主动控制
    STATIC_CONTROL,   // :62  框架自动管理
    BOTH              // :67  两者结合（推荐）
}
```

| 模式 | 记忆录制 | 记忆检索 | 工具注册 | 适用场景 |
|------|----------|----------|----------|----------|
| `AGENT_CONTROL` | Agent 决定何时记录 | Agent 决定何时检索 | 是 | 高级 Agent，自主判断信息重要性 |
| `STATIC_CONTROL` | 每次 PostCall 自动记录 | 每次 PreCall 自动检索 | 否 | 简单 Agent，全面自动记忆 |
| `BOTH` | 自动 + Agent 主动 | 自动 + Agent 主动 | 是 | **推荐默认**，兼顾全面性和灵活性 |

---

## 5. 与 Session 的关系

记忆系统与 Session 的关系体现在两个层面：

### 5.1 短期记忆持久化

`InMemoryMemory` 实现 `StateModule`，通过 `Session` 保存/加载消息列表：

```java
// 保存时
agent.saveTo(session, sessionKey);  // 调用 InMemoryMemory.saveTo()

// 加载时
agent.loadFrom(session, sessionKey);  // 调用 InMemoryMemory.loadFrom()
```

### 5.2 长期记忆与 Session

长期记忆后端（如 Mem0）独立于 Session 管理。`StaticLongTermMemoryHook` 在 PostCall 时异步记录，不依赖 Session 生命周期。

---

## 6. LongTermMemoryTools

```java
// LongTermMemoryTools.java:65
public class LongTermMemoryTools {
    private final LongTermMemory memory;  // :67

    @Tool(name = "record_to_memory")           // :101
    public Mono<String> recordToMemory(         // :106
        String thinking, List<String> content);

    @Tool(name = "retrieve_from_memory")        // :179
    public Mono<String> retrieveFromMemory(     // :183
        List<String> keywords);
}
```

工具适配器，将 `LongTermMemory` 的 `record()`/`retrieve()` 适配为 Agent 可调用的 `@Tool` 方法。在 `AGENT_CONTROL`/`BOTH` 模式下由框架自动注册。

- `recordToMemory`: Agent 主动记录重要信息（用户偏好、个人数据等）
- `retrieveFromMemory`: Agent 主动检索相关记忆，结果用 `<long_term_memory>` 标签包裹

### 6.1 wrap 格式

```java
// LongTermMemoryTools.java:85
public static String wrap(String text) {
    return "Below is content retrieved from the long-term memory...\n"
         + "<long_term_memory>\n" + text + "\n</long_term_memory>";
}
```

---

## 7. StaticLongTermMemoryHook

```java
// StaticLongTermMemoryHook.java:75
public class StaticLongTermMemoryHook implements Hook {
    private final LongTermMemory longTermMemory;  // :85
    private final Memory memory;                   // :86
    private final boolean asyncRecord;             // :87
}
```

实现 `STATIC_CONTROL`/`BOTH` 模式的自动记忆管理。

### 7.1 工作流程

1. **PreCallEvent** (`StaticLongTermMemoryHook.java:151`): 从输入消息中提取最后一条用户消息作为查询，调用 `retrieve()` 检索相关记忆，将结果作为 USER 消息追加到输入列表
2. **PostCallEvent** (`StaticLongTermMemoryHook.java:218`): 将 Agent Memory 中所有消息调用 `record()` 记录到长期记忆

### 7.2 异步录制

`asyncRecord=true` 时（构造函数 `StaticLongTermMemoryHook.java:108`），录制操作在专用调度器上异步执行（fire-and-forget），不阻塞 Agent 响应。调度器配置为最多 1 个工作线程、3 个排队任务，饱和时丢弃新任务并记录日志。

### 7.3 优先级

`priority()` 返回 50（`StaticLongTermMemoryHook.java:138`），确保在 Hook 链中较早执行。

---

## 8. 使用示例

```java
// 创建长期记忆实例
LongTermMemory ltm = Mem0LongTermMemory.builder()
    .agentName("助手")
    .userName("user_123")
    .apiBaseUrl("http://localhost:8000")
    .build();

// 方式一：BOTH 模式（推荐）
ReActAgent agent = ReActAgent.builder()
    .name("助手")
    .model(model)
    .longTermMemory(ltm)
    .longTermMemoryMode(LongTermMemoryMode.BOTH)
    .build();

// 方式二：仅 Agent 控制
ReActAgent agent = ReActAgent.builder()
    .name("助手")
    .model(model)
    .longTermMemory(ltm)
    .longTermMemoryMode(LongTermMemoryMode.AGENT_CONTROL)
    .build();
```
