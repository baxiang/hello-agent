# io.agentscope.core.plan — 计划包文档

## PlanNotebook

提供结构化任务分解，向 Agent 暴露 10 个工具函数：

| 工具 | 说明 |
|---|---|
| `createPlan` | 创建带子任务的新计划 |
| `updatePlanInfo` | 更新计划元数据 |
| `reviseCurrentPlan` | 添加/修订/删除子任务 |
| `updateSubtaskState` | 更改子任务状态 |
| `finishSubtask` | 标记子任务完成 |
| `viewSubtasks` | 查看子任务详情 |
| `getSubtaskCount` | 获取子任务数量 |
| `finishPlan` | 完成或放弃计划 |
| `viewHistoricalPlans` | 查看历史计划 |
| `recoverHistoricalPlan` | 恢复历史计划 |

## 与 ReActAgent 集成

通过 `ReActAgent.builder().planNotebook()` 提供 `PlanNotebook` 时：
1. 计划工具自动注册到 Toolkit
2. Hook 在每次推理步骤前注入计划提示
3. 计划状态通过 `StateModule` 集成持久化

## 子任务状态机

```
TODO → IN_PROGRESS → DONE
                ↘ ABANDONED
```

## 快速启用

```java
ReActAgent agent = ReActAgent.builder()
    .enablePlan() // planNotebook(PlanNotebook.builder().build()) 的简写
    .build();
```

## 相关文档

- [核心包](../core.md)
- [状态包](state.md)
