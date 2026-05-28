# Plan 系统

`io.agentscope.core.plan` 包提供结构化任务规划能力，让 Agent 通过工具函数创建、管理和追踪计划，并自动注入上下文提示引导执行。

---

## 1. PlanNotebook

```java
// PlanNotebook.java:104
public class PlanNotebook implements StateModule {
    private Plan currentPlan;                                    // :116
    private final PlanToHint planToHint;                         // :117
    private final PlanStorage storage;                           // :118
    private final Integer maxSubtasks;                           // :119
    private final boolean needUserConfirm;                       // :120
    private final Map<String, BiConsumer<PlanNotebook, Plan>> changeHooks;  // :121
}
```

### 1.1 核心特性

- **计划管理**: 创建、修订、完成含多个子任务的计划
- **自动提示注入**: 每次 Reasoning 前注入上下文提示（通过 Hook 机制）
- **状态追踪**: 跟踪子任务状态（todo/in_progress/done/abandoned）
- **历史计划**: 存储和恢复历史计划
- **变更 Hook**: 计划变更时触发回调

### 1.2 StateModule 实现

| 方法 | 位置 | 说明 |
|------|------|------|
| `saveTo(Session, SessionKey)` | PlanNotebook.java:158 | 保存当前计划状态（含 null） |
| `loadFrom(Session, SessionKey)` | PlanNotebook.java:170 | 加载计划状态，先清空再恢复 |

---

## 2. 10 个工具函数

### 2.1 create_plan

`PlanNotebook.java:268` — 创建新计划。

```java
@Tool(name = "create_plan")
public Mono<String> createPlan(
    String name,                // 计划名称，不超过10词
    String description,         // 包含约束、目标、成果
    String expectedOutcome,     // 具体、可衡量的预期成果
    List<Map<String, Object>> subtasks  // 子任务列表
);
```

如果已有当前计划，会被替换。子任务数量受 `maxSubtasks` 限制（`:309-315`）。

### 2.2 update_plan_info

`PlanNotebook.java:342` — 更新当前计划的名称、描述或预期成果。传 null 或空字符串保持不变。

### 2.3 revise_current_plan

`PlanNotebook.java:467` — 增删改子任务。

```java
@Tool(name = "revise_current_plan")
public Mono<String> reviseCurrentPlan(
    int subtaskIdx,             // 子任务索引（从0开始）
    String action,              // "add"/"revise"/"delete"
    Map<String, Object> subtaskMap  // 子任务数据（add/revise 时必需）
);
```

- **add**: 在指定索引处插入新子任务，索引范围 `[0, subtasks.size()]`（`:506-511`）
- **revise**: 替换指定索引的子任务
- **delete**: 删除指定索引的子任务
- 受 `maxSubtasks` 限制，添加前检查（`:515-522`）

### 2.4 update_subtask_state

`PlanNotebook.java:579` — 更新子任务状态。

```java
@Tool(name = "update_subtask_state")
public Mono<String> updateSubtaskState(int subtaskIdx, String stateStr);
```

状态值: `todo`/`in_progress`/`abandoned`。标记为 `done` 需使用 `finish_subtask`。

**状态转换规则**（`:620-645`）：
- 设为 `IN_PROGRESS` 时，所有前序子任务必须为 `DONE` 或 `ABANDONED`
- 设为 `IN_PROGRESS` 时，不能有其他子任务处于 `IN_PROGRESS`

### 2.5 finish_subtask

`PlanNotebook.java:662` — 标记子任务完成。

```java
@Tool(name = "finish_subtask")
public Mono<String> finishSubtask(int subtaskIdx, String outcome);
```

**关键行为**（`:716-733`）：
- 完成当前子任务后，**自动激活下一个子任务**（设为 `IN_PROGRESS`）
- 前序子任务必须已完成或放弃
- `outcome` 应为具体数据/结果，而非"我做了什么"

### 2.6 view_subtasks

`PlanNotebook.java:744` — 查看指定索引的子任务详情，输出 Markdown 格式。

### 2.7 get_subtask_count

`PlanNotebook.java:781` — 获取当前计划的子任务统计（总数/done/in_progress/todo/abandoned）。

### 2.8 finish_plan

`PlanNotebook.java:824` — 完成或放弃当前计划。

```java
@Tool(name = "finish_plan")
public Mono<String> finishPlan(String stateStr, String outcome);
```

- `stateStr`: `done` 或 `abandoned`
- 完成后计划存入 `PlanStorage`，`currentPlan` 置 null
- 触发 `changeHooks` 回调

### 2.9 view_historical_plans

`PlanNotebook.java:871` — 查看所有历史计划（名称、ID、创建时间、描述、状态）。

### 2.10 recover_historical_plan

`PlanNotebook.java:902` — 恢复历史计划。

- 如果当前有未完成计划，先将其标记为 `ABANDONED` 并存入历史
- 恢复指定 ID 的历史计划为当前计划

---

## 3. 子任务状态机

```
                    ┌─────────────────────┐
                    │                     │
                    ▼                     │
  TODO ──→ IN_PROGRESS ──→ DONE          │
    │           │                         │
    │           ▼                         │
    └───→ ABANDONED ◄────────────────────┘
```

**转换规则**:
- `TODO → IN_PROGRESS`: 前序子任务必须完成或放弃，且无其他 `IN_PROGRESS` 子任务
- `IN_PROGRESS → DONE`: 通过 `finish_subtask` 完成，自动激活下一个子任务
- 任意状态 → `ABANDONED`: 通过 `update_subtask_state` 放弃
- 不能直接设为 `DONE`（必须通过 `finish_subtask`）

---

## 4. 使用示例

### 4.1 基本用法

```java
// 使用默认配置
ReActAgent agent = ReActAgent.builder()
    .name("助手")
    .model(model)
    .enablePlan()          // 自动创建 PlanNotebook
    .build();

// 使用自定义配置
PlanNotebook planNotebook = PlanNotebook.builder()   // :142
    .planToHint(new DefaultPlanToHint())              // :191
    .storage(new InMemoryPlanStorage())                // :202
    .maxSubtasks(10)                                   // :213
    .needUserConfirm(true)                             // :229
    .keyPrefix("mainPlan")                             // :242
    .build();

ReActAgent agent = ReActAgent.builder()
    .name("助手")
    .model(model)
    .planNotebook(planNotebook)
    .build();
```

### 4.2 自动提示注入

`PlanNotebook.java:975` — `getCurrentHint()` 由内部 Hook 在每次 Reasoning 前自动调用，通过 `PlanToHint` 策略生成上下文提示。提示使用 `<system-hint>` 标签包裹，引导 Agent 按计划执行。

### 4.3 变更 Hook

```java
// PlanNotebook.java:1024
planNotebook.addChangeHook("ui", (notebook, plan) -> {
    // 计划变更时更新 UI
    updatePlanDisplay(plan);
});

// 移除
planNotebook.removeChangeHook("ui");  // :1033
```

### 4.4 Builder 配置项

| 配置 | 默认值 | 说明 |
|------|--------|------|
| `planToHint` | `DefaultPlanToHint` | 计划到提示的转换策略 |
| `storage` | `InMemoryPlanStorage` | 历史计划存储后端 |
| `maxSubtasks` | `null`（无限制） | 每个计划最大子任务数 |
| `needUserConfirm` | `true` | 是否在提示中要求用户确认 |
| `keyPrefix` | `"planNotebook"` | 存储键前缀（多实例共存时使用） |
