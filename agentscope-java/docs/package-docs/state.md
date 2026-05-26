# io.agentscope.core.state — 状态包文档

## 核心接口

| 接口 | 说明 |
|---|---|
| `StateModule` | 由可通过 `Session` 保存/加载状态的组件实现。关键契约：<br>`void saveTo(Session, SessionKey)` / `void loadFrom(Session, SessionKey)`<br>实现者：`Memory`、`PlanNotebook`、`ReActAgent` |
| `State` | 可序列化状态对象的标记接口（如 `AgentMetaState`、`PlanNotebookState`、`ToolkitState`） |
| `SessionKey` | 不透明的会话标识符 |

## StatePersistence 配置

`StatePersistence` 控制在 `saveTo/loadFrom` 期间管理哪些组件：

```java
ReActAgent agent = ReActAgent.builder()
    .statePersistence(StatePersistence.builder()
        .memoryManaged(true)
        .toolkitManaged(true)
        .planNotebookManaged(false) // 让用户单独管理
        .build())
    .build();
```

## 状态对象

| 状态 | 内容 |
|---|---|
| `AgentMetaState` | Agent ID、名称、描述、系统提示 |
| `ToolkitState` | 活跃的工具组名称 |
| `PlanNotebookState` | 当前计划和子任务状态 |

## 相关文档

- [核心包](../core.md)
- [会话包](session.md)
- [计划包](plan.md)
