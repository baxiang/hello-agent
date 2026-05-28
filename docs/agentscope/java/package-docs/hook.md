# Hook 事件体系详解

`io.agentscope.core.hook` 包提供了 Agent 执行全生命周期的事件拦截机制。所有 Agent 执行事件通过统一的 `onEvent` 方法投递，利用 Java sealed class 实现类型安全的模式匹配。

---

## 1. Hook 接口

```java
// Hook.java:117
public interface Hook {
    <T extends HookEvent> Mono<T> onEvent(T event);  // :147
    default List<Object> tools() { ... }               // :163
    default int priority() { return 100; }             // :183
}
```

### 1.1 核心方法

- **`onEvent(HookEvent)`** (`Hook.java:147`): 统一事件处理入口，返回 `Mono<T>` 支持异步链式操作。利用 Java 17+ switch 模式匹配分发到具体事件类型
- **`tools()`** (`Hook.java:163`): Hook 可附带注册工具，在 `ReActAgent.Builder.build()` 时自动注册到 agent-local Toolkit 副本。返回 `AgentTool` 实例或含 `@Tool` 方法的对象
- **`priority()`** (`Hook.java:183`): 优先级数值越小越先执行，默认 100。同优先级按注册顺序执行

### 1.2 优先级约定

| 范围 | 用途 | 示例 |
|------|------|------|
| 0-50 | 系统关键 Hook | `GracefulShutdownHook`(0), `PendingToolRecoveryHook`(10) |
| 51-100 | 高优先级 Hook | `StaticLongTermMemoryHook`(50), `GenericRAGHook`(50) |
| 101-500 | 业务逻辑 Hook | 自定义验证、注入 |
| 501-1000 | 低优先级 Hook | 日志、指标采集 |

### 1.3 RuntimeContextAware

```java
// RuntimeContextAware.java:30
@FunctionalInterface
public interface RuntimeContextAware {
    void setRuntimeContext(RuntimeContext context);  // :38
}
```

Hook 可选实现此接口，在 `ReActAgent.call(msgs, ctx)` 执行期间，框架自动注入当前 `RuntimeContext`，调用结束后清除。同一 `RuntimeContext` 实例在 Hook/Tool 之间可变共享，用于跨组件协调。

---

## 2. HookEventType 枚举

```java
// HookEventType.java:27
public enum HookEventType {
    PRE_CALL,          // :29  Agent 开始处理前
    POST_CALL,         // :32  Agent 处理完成后
    PRE_REASONING,     // :35  LLM 推理前
    POST_REASONING,    // :38  LLM 推理完成后
    REASONING_CHUNK,   // :41  LLM 推理流式输出中
    PRE_ACTING,        // :44  工具执行前
    POST_ACTING,       // :47  工具执行完成后
    ACTING_CHUNK,      // :50  工具执行流式输出中
    PRE_SUMMARY,       // :53  摘要生成前（达到最大迭代次数时）
    POST_SUMMARY,      // :56  摘要生成完成后
    SUMMARY_CHUNK,     // :59  摘要流式输出中
    ERROR              // :62  执行出错时
}
```

11 种事件类型覆盖 Agent 执行的每个阶段，按执行时序排列：

```
PRE_CALL → [PRE_REASONING → REASONING_CHUNK* → POST_REASONING
            → PRE_ACTING → ACTING_CHUNK* → POST_ACTING]*  ← ReAct 循环
           → PRE_SUMMARY → SUMMARY_CHUNK* → POST_SUMMARY  ← 可选
           → POST_CALL
           → ERROR (任何阶段都可能触发)
```

---

## 3. HookEvent 继承体系

```java
// HookEvent.java:74
public abstract sealed class HookEvent
    permits PreCallEvent, PostCallEvent, ReasoningEvent, ActingEvent, SummaryEvent, ErrorEvent {
    // 公共字段
    private final HookEventType type;       // :77
    private final Agent agent;               // :78
    private final long timestamp;            // :79
    private Msg systemMsg;                   // :86
}
```

### 3.1 体系结构

```
HookEvent (sealed, HookEvent.java:74)
├── PreCallEvent (HookEventType.java:44)
├── PostCallEvent (:42)
├── ReasoningEvent (sealed, ReasoningEvent.java:42)
│   ├── PreReasoningEvent (PreReasoningEvent.java:47)
│   ├── PostReasoningEvent (PostReasoningEvent.java:51)
│   └── ReasoningChunkEvent (ReasoningChunkEvent.java:60)
├── ActingEvent (sealed, ActingEvent.java:42)
│   ├── PreActingEvent (PreActingEvent.java:47)
│   ├── PostActingEvent (PostActingEvent.java:50)
│   └── ActingChunkEvent (ActingChunkEvent.java:49)
├── SummaryEvent (sealed, SummaryEvent.java:43)
│   ├── PreSummaryEvent (PreSummaryEvent.java:49)
│   ├── PostSummaryEvent (PostSummaryEvent.java:47)
│   └── SummaryChunkEvent (SummaryChunkEvent.java:60)
└── ErrorEvent (ErrorEvent.java:41)
```

### 3.2 公共 API

| 方法 | 位置 | 说明 |
|------|------|------|
| `getType()` | HookEvent.java:106 | 事件类型 |
| `getAgent()` | HookEvent.java:115 | Agent 实例 |
| `getTimestamp()` | HookEvent.java:124 | 时间戳(ms) |
| `getMemory()` | HookEvent.java:133 | 便捷访问 Agent 记忆（ReActAgent 时有效） |
| `getSystemMessage()` | HookEvent.java:150 | 获取统一系统消息 |
| `setSystemMessage(Msg)` | HookEvent.java:162 | 替换整个系统消息 |
| `appendSystemContent(String)` | HookEvent.java:174 | 追加文本到系统消息 |
| `appendSystemContent(ContentBlock)` | HookEvent.java:187 | 追加内容块到系统消息 |

### 3.3 System Message 生命周期

`HookEvent.java:43-66` 定义了系统消息的完整生命周期：

1. **初始化**: `call()` 开始时，从 `sysPrompt` 生成系统消息，在 `PreCallEvent` Hook 执行前注入
2. **冻结基线**: `PreCallEvent` Hook 执行完毕后，系统消息被**冻结**为整个 call 的基线
3. **每轮注入**: 每次 `PreReasoningEvent`/`PreSummaryEvent` 前，冻结基线被**重新注入**到事件中——Hook 始终从干净的基线开始
4. **最终合并**: `model.stream(...)` 调用前，事件的系统消息被前置到 `inputMessages` 的第一位

关键设计：每轮 `PreReasoningEvent` 从冻结基线的**新副本**开始，因此 Hook 可安全使用 `appendSystemContent()`，内容不会跨迭代累积。**禁止**在 `inputMessages` 中直接注入 `SYSTEM` 角色消息，否则运行时抛出 `IllegalStateException`。

---

## 4. Pre/Post Reasoning 事件

### 4.1 PreReasoningEvent

```java
// PreReasoningEvent.java:47
public final class PreReasoningEvent extends ReasoningEvent {
    private List<Msg> inputMessages;                       // :49
    private GenerateOptions overriddenGenerateOptions;     // :50
}
```

**可修改**。通过 `setInputMessages()` (`PreReasoningEvent.java:87`) 修改发送给 LLM 的消息列表，通过 `setGenerateOptions()` (`PreReasoningEvent.java:113`) 覆盖推理参数。

典型场景：
- 注入提示词或上下文
- 过滤/修改已有消息
- 动态设置 `tool_choice` 实现结构化输出
- 调整 temperature/maxTokens

### 4.2 PostReasoningEvent

```java
// PostReasoningEvent.java:51
public final class PostReasoningEvent extends ReasoningEvent {
    private Msg reasoningMessage;              // :53
    private boolean stopRequested = false;     // :54
    private List<Msg> gotoReasoningMsgs = null; // :55
}
```

**可修改**。除修改推理结果外，还提供三种控制流操作：

- **`stopAgent()`** (`PostReasoningEvent.java:99`): 请求中断，Agent 返回包含 `ToolUseBlock` 的消息而非执行工具。用于 Human-in-the-loop 场景，用户审核后可调用 `agent.call()` 恢复
- **`gotoReasoning()`** (`PostReasoningEvent.java:121`): 无附加消息直接回到推理阶段（仅当无待处理 ToolUse 时有效）
- **`gotoReasoning(Msg)` / `gotoReasoning(List<Msg>)`** (`PostReasoningEvent.java:134,150`): 附加消息后回到推理。如果有待处理 ToolUse，必须提供匹配的 ToolResult（由 `ToolValidator.validateToolResultMatch` 校验）

---

## 5. Pre/Post Acting 事件

### 5.1 PreActingEvent

```java
// PreActingEvent.java:47
public final class PreActingEvent extends ActingEvent {
    public void setToolUse(ToolUseBlock toolUse);  // :67
}
```

**可修改**。每次工具调用触发一次（推理结果含多个 ToolUse 时触发多次）。可修改工具参数、注入认证信息、实现逐工具授权检查。

### 5.2 PostActingEvent

```java
// PostActingEvent.java:50
public final class PostActingEvent extends ActingEvent {
    private ToolResultBlock toolResult;     // :52
    private Msg toolResultMsg;              // :53
    private boolean stopRequested = false;  // :54
}
```

**可修改**。可后处理工具结果（`setToolResult()` :84）、修改结果消息（`setToolResultMsg()` :125）、请求中断（`stopAgent()` :98）用于 HITL 场景。

---

## 6. Streaming Chunk 事件

### 6.1 ReasoningChunkEvent

```java
// ReasoningChunkEvent.java:60
public final class ReasoningChunkEvent extends ReasoningEvent {
    private final Msg incrementalChunk;  // :62  仅本 chunk 新增内容
    private final Msg accumulated;       // :63  截至目前的完整累积消息
}
```

**只读**。提供两种显示模式：
- `getIncrementalChunk()` (`ReasoningChunkEvent.java:94`): 增量模式，仅打印新内容
- `getAccumulated()` (`ReasoningChunkEvent.java:103`): 累积模式，替换整个显示区域

### 6.2 ActingChunkEvent

```java
// ActingChunkEvent.java:49
public final class ActingChunkEvent extends ActingEvent {
    private final ToolResultBlock chunk;  // :51
}
```

**只读**。由工具通过 `ToolEmitter` 发出的流式分块，**不发送给 LLM**，仅用于前端展示工具执行进度。

### 6.3 SummaryChunkEvent

```java
// SummaryChunkEvent.java:60
public final class SummaryChunkEvent extends SummaryEvent {
    private final Msg incrementalChunk;  // :62
    private final Msg accumulated;       // :63
}
```

**只读**。结构与 `ReasoningChunkEvent` 相同，用于摘要生成阶段的流式输出。

---

## 7. Call 生命周期事件

### 7.1 PreCallEvent

```java
// PreCallEvent.java:44
public final class PreCallEvent extends HookEvent {
    private List<Msg> inputMessages;  // :46
}
```

**可修改**。Agent 开始处理前触发，可修改输入消息。常用于：日志记录、资源初始化、指标采集、输入过滤。

### 7.2 PostCallEvent

```java
// PostCallEvent.java:42
public final class PostCallEvent extends HookEvent {
    private Msg finalMessage;  // :44
}
```

**可修改**。Agent 处理完成后触发，可后处理最终响应。常用于：输出格式化、元数据添加、内容过滤、响应日志。

---

## 8. Summary 事件

当 ReActAgent 达到最大迭代次数时，触发摘要生成流程：

- **PreSummaryEvent** (`PreSummaryEvent.java:49`): **可修改**。含 `inputMessages`、`maxIterations`、`currentIteration`，支持 `setGenerateOptions()` 覆盖摘要生成参数
- **PostSummaryEvent** (`PostSummaryEvent.java:47`): **可修改**。可修改摘要消息，支持 `stopAgent()`
- **SummaryChunkEvent** (`SummaryChunkEvent.java:60`): **只读**。流式摘要输出

---

## 9. ErrorEvent

```java
// ErrorEvent.java:41
public final class ErrorEvent extends HookEvent {
    private final Throwable error;  // :43
}
```

**只读**。任何阶段出错时触发，通过 `getError()` (`ErrorEvent.java:62`) 获取异常。用于：错误日志、告警通知、指标采集。

---

## 10. Hook 注册与执行

Hook 通过 `ReActAgent.Builder.hook()` 注册，在 `build()` 时按 priority 排序。执行顺序：

```java
// 注册示例
ReActAgent agent = ReActAgent.builder()
    .name("Assistant")
    .model(model)
    .hook(new GracefulShutdownHook(manager))   // priority=0
    .hook(new PendingToolRecoveryHook())        // priority=10
    .hook(new StaticLongTermMemoryHook(ltm, memory))  // priority=50
    .hook(myCustomHook)                         // priority=100 (default)
    .build();
```

---

## 11. 内置 Hook

### 11.1 PendingToolRecoveryHook

`PendingToolRecoveryHook.java:58` — 自动恢复孤儿待处理工具调用。

- **优先级**: 10（高优先级，确保在其他 Hook 之前运行）
- **触发时机**: `PreCallEvent`
- **行为**: 检测 Memory 中无对应 ToolResult 的 ToolUseBlock，自动生成错误 ToolResult 填充
- **跳过条件**: 用户输入已包含 ToolResult，或输入为空（恢复模式）
- **配置**: `ReActAgent.Builder.enablePendingToolRecovery(boolean)` 可禁用

### 11.2 TTSHook

`TTSHook.java:74` — 实时语音合成，实现"边生成边播报"。

**两种模式**:
- **实时模式** (`realtimeMode=true`, 默认): 每个 `ReasoningChunkEvent` 触发 TTS
- **批处理模式** (`realtimeMode=false`): 等待 `PostReasoningEvent` 后整体合成

**三种输出方式**:
1. 本地播放 (`AudioPlayer`): CLI/桌面应用
2. 回调 (`audioCallback`): 服务端 SSE/WebSocket
3. 响应式流 (`getAudioStream()`, `TTSHook.java:115`): 外部订阅

```java
// TTSHook.java:334-456
TTSHook hook = TTSHook.builder()
    .ttsModel(ttsModel)           // 必需
    .audioPlayer(player)           // 可选，默认自动创建
    .realtimeMode(true)            // 默认 true
    .audioCallback(audio -> sseEmitter.send(audio))  // 可选
    .build();
```

---

## 12. 自定义 Hook 示例

### 12.1 日志 Hook

```java
Hook loggingHook = new Hook() {
    @Override
    public <T extends HookEvent> Mono<T> onEvent(T event) {
        return switch (event) {
            case PreReasoningEvent e -> {
                log.info("推理开始, model={}", e.getModelName());
                yield Mono.just(e);
            }
            case ReasoningChunkEvent e -> {
                System.out.print(e.getIncrementalChunk().getTextContent());
                yield Mono.just(e);
            }
            default -> Mono.just(event);
        };
    }
};
```

### 12.2 提示注入 Hook

```java
Hook hintInjector = new Hook() {
    @Override
    public <T extends HookEvent> Mono<T> onEvent(T event) {
        return switch (event) {
            case PreReasoningEvent e -> {
                // 使用 appendSystemContent 安全追加（不会跨迭代累积）
                e.appendSystemContent("请逐步思考");
                yield Mono.just(e);
            }
            case PreActingEvent e -> {
                // 修改工具参数，注入认证信息
                ToolUseBlock original = e.getToolUse();
                // ... 修改参数
                e.setToolUse(modified);
                yield Mono.just(e);
            }
            default -> Mono.just(event);
        };
    }
};
```

### 12.3 Human-in-the-loop Hook

```java
Hook hitlHook = new Hook() {
    @Override
    public <T extends HookEvent> Mono<T> onEvent(T event) {
        if (event instanceof PostReasoningEvent e) {
            // 检测敏感工具调用，请求人工审核
            if (containsSensitiveToolCall(e.getReasoningMessage())) {
                e.stopAgent();  // 返回待审核的 ToolUse
            }
        }
        return Mono.just(event);
    }
};

// 审核后恢复执行
Msg result = agent.call().block();       // 审核中
Msg resumed = agent.call(toolResultMsg).block();  // 提交审核结果后恢复
```
