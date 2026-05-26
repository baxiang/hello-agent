# io.agentscope.core.hook — Hook 包文档

## Hook 接口

```java
public interface Hook {
    <T extends HookEvent> Mono<T> onEvent(T event);
    default int priority() { return 100; } // 值越小优先级越高
    default List<Object> tools() { return Collections.emptyList(); }
}
```

## 事件生命周期

Agent 执行管道按以下顺序触发事件：

```
call()
  ├── PreCallEvent          [可修改] — Agent 启动前，可修改输入消息
  │
  │   reasoning(iter)
  │   ├── PreReasoningEvent [可修改] — LLM 推理前，可注入提示
  │   ├── ReasoningChunkEvent [只读] — 流式推理输出
  │   └── PostReasoningEvent [可修改] — LLM 响应后，可 stop/gotoReasoning
  │       │
  │       └── if not finished → acting(iter)
  │           ├── PreActingEvent   [可修改] — 工具执行前
  │           ├── ActingChunkEvent [只读] — 流式工具输出
  │           └── PostActingEvent  [可修改] — 工具结果后，可 stop
  │               └── reasoning(iter+1) ← 循环
  │
  └── PostCallEvent         [可修改] — 返回最终响应前

ErrorEvent [只读] — 执行期间任何异常时触发
```

## 优先级范围

| 范围 | 用途 |
|---|---|
| 0-50 | 关键系统 Hook（认证、安全） |
| 51-100 | 高优先级（验证、预处理） |
| 101-500 | 普通优先级（业务逻辑） |
| 501-1000 | 低优先级（日志、指标） |

## 可修改 vs 通知事件

**可修改事件**（有 setter 方法，变更影响后续执行）：
- `PreReasoningEvent.setInputMessages()` — 修改 LLM 输入
- `PostReasoningEvent.gotoReasoning()` — 强制另一次推理迭代
- `PreActingEvent.setToolUse()` — 修改工具参数
- `PostActingEvent.setToolResult()` — 修改工具结果
- `PostActingEvent.stopAgent()` — 请求人机协同停止
- `PostCallEvent.setFinalMessage()` — 修改最终响应

**通知事件**（只读，仅用于监控）：
- `ReasoningChunkEvent` — 获取 `getIncrementalChunk()` 用于流式展示
- `ActingChunkEvent` — 获取流式工具输出
- `ErrorEvent` — 获取异常详情

## 内置 Hook

| Hook | 说明 |
|---|---|
| `GracefulShutdownHook` | 系统 Hook，处理 JVM 关闭 |
| `PendingToolRecoveryHook` | 自动恢复孤儿待处理工具调用 |
| `StaticLongTermMemoryHook` | 自动长期记忆管理 |
| `GenericRAGHook` | 自动知识检索注入 |
| `SkillHook` | 技能管理和注入 |

## 系统消息 API

所有事件继承 `HookEvent.appendSystemContent()`，可安全注入系统指令，不污染内存中的消息列表。

## 相关文档

- [核心包](../core.md)
