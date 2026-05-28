# ADK Prebuilt Agents

ADK 提供三种预构建 Agent，覆盖常见的多 Agent 编排模式。

## 1. Supervisor Agent（adk/prebuilt/supervisor/）

Supervisor Agent 采用中心化调度模式：一个"主管"Agent 负责将用户请求路由到合适的子 Agent。

> **注意**：源码中标注了 `NOT RECOMMENDED`。Supervisor 模式依赖 Agent Transfer（全上下文共享），效果未经验证。推荐使用 `ChatModelAgent + AgentTool` 或 `DeepAgent`。

### 1.1 配置（adk/prebuilt/supervisor/supervisor.go:45-51）

```go
// adk/prebuilt/supervisor/supervisor.go:45-51
type Config struct {
    // Supervisor 指定充当主管的 Agent，负责协调和管理子 Agent
    Supervisor adk.Agent

    // SubAgents 指定被主管 Agent 管理和调度的子 Agent 列表
    SubAgents []adk.Agent
}
```

### 1.2 构造函数（adk/prebuilt/supervisor/supervisor.go:101）

```go
func New(ctx context.Context, conf *Config) (adk.ResumableAgent, error)
```

返回 `adk.ResumableAgent`（支持中断恢复），而非 `adk.Agent`。

### 1.3 工作原理

1. 通过 `adk.SetSubAgents` 将子 Agent 注册到 Supervisor（Agent Transfer 模式）
2. Supervisor 根据用户意图选择 Transfer 到哪个子 Agent
3. 子 Agent 执行完毕后将控制权交回 Supervisor
4. Supervisor 决定是否继续调度或直接回复

内部实现使用 `supervisorContainer`（`supervisor.go:61-80`）包装整个结构，提供统一 tracing：OnStart/OnEnd 只在容器级别触发一次，callback context 传播到所有子 Agent。

### 1.4 使用示例

```go
supervisor, err := supervisor.New(ctx, &supervisor.Config{
    Supervisor: coordAgent,  // 预先创建的协调 Agent
    SubAgents:  []adk.Agent{researcher, writer, coder},
})
```

## 2. PlanExecute Agent（adk/prebuilt/planexecute/）

PlanExecute Agent 采用"先规划后执行"模式：先生成执行计划，再逐步执行计划中的步骤。

### 2.1 Plan 接口（adk/prebuilt/planexecute/plan_execute.go:45-55）

```go
// adk/prebuilt/planexecute/plan_execute.go:45-55
type Plan interface {
    // FirstStep 返回计划中的第一个步骤
    FirstStep() string

    // json.Marshaler 序列化为 JSON（用于提示词模板）
    json.Marshaler
    // json.Unmarshaler 从模型输出反序列化
    json.Unmarshaler
}
```

### 2.2 默认 Plan 实现（adk/prebuilt/planexecute/plan_execute.go:77-81）

```go
type defaultPlan struct {
    // Steps 有序的动作列表，每个步骤应清晰、可执行
    Steps []string `json:"steps"`
}
```

`FirstStep()` 返回 `Steps[0]`。

### 2.3 配置（adk/prebuilt/planexecute/plan_execute.go:838-854）

```go
type Config struct {
    Planner     adk.Agent  // 规划 Agent：生成执行计划
    Executor    adk.Agent  // 执行 Agent：执行单个步骤
    Replanner   adk.Agent  // 重规划 Agent：根据执行结果重新规划
    MaxIterations int      // 最大规划-执行循环次数
}
```

与 Supervisor 不同，PlanExecute 的三个角色（Planner/Executor/Replanner）都是独立的 Agent，需要用户分别创建和配置。

### 2.4 工作原理

1. **Plan 阶段**：Planner Agent 接收用户请求，生成步骤列表（Plan）
2. **Execute 阶段**：Executor Agent 逐步执行 Plan 中的步骤
3. **Replan 阶段**：Replanner Agent 根据执行结果判断是否需要重新规划
4. 循环直到 Plan 完成或达到 MaxIterations

PlanExecute 适合复杂的多步骤任务，如研究报告生成、多源数据聚合等。

### 2.5 使用示例

```go
agent, err := planexecute.New(ctx, &planexecute.Config{
    Planner:       plannerAgent,    // 规划 Agent
    Executor:      executorAgent,   // 执行 Agent
    Replanner:     replannerAgent,  // 重规划 Agent
    MaxIterations: 10,
})
```

## 3. DeepAgent（adk/prebuilt/deep/）

DeepAgent 是 ADK 中最强大的预构建 Agent，采用深度思考与迭代优化模式，适合需要深入分析和反复打磨的任务。

### 3.1 配置（adk/prebuilt/deep/deep.go:44-108）

```go
type TypedConfig[M MessageType] struct {
    Name        string
    Description string
    ChatModel   model.BaseModel[M]   // 底层大模型（注意：字段名为 ChatModel，非 Model）
    Instruction string
    ToolsConfig adk.ToolsConfig       // 工具配置（非 Tools 列表）
    MaxIteration int                  // 最大迭代次数（注意：MaxIteration，非 MaxIterations）

    // 可选字段
    SubAgents                       []TypedAgent[M]
    Backend                         filesystem.Backend
    Shell                           func(ctx context.Context, cmd string) (string, error)
    StreamingShell                  func(ctx context.Context, cmd string) (*schema.StreamReader[string], error)
    WithoutWriteTodos               bool
    WithoutGeneralSubAgent          bool
    TaskToolDescriptionGenerator    func(ctx context.Context) string
    Middlewares                     []AgentMiddleware
    Handlers                        []TypedChatModelAgentMiddleware[M]
    ModelRetryConfig                *TypedModelRetryConfig[M]
    ModelFailoverConfig             *ModelFailoverConfig[M]
    OutputKey                       string
}

type Config = TypedConfig[*schema.Message]
```

### 3.2 核心机制

DeepAgent 的独特之处在于 **Task Tool**（`adk/prebuilt/deep/task_tool.go`）：

- 内置 `typedTaskToolMiddleware`，为 Agent 添加一个 `task` 工具
- Agent 可以将大任务分解为多个子任务，逐个解决
- 每个子任务由 SubAgent 独立执行，结果汇总到主 Agent

此外还有 **AppendPromptTool**（`adk/prebuilt/deep/types.go:44-49`）：

- `typedAppendPromptTool` 允许 Agent 在执行过程中追加额外提示
- 支持 Agent 自主补充上下文或调整策略

### 3.3 提示词模板（adk/prebuilt/deep/prompt.go）

DeepAgent 使用专门的提示词模板：

- `taskPrompt`：引导 Agent 分解任务、创建子任务
- `systemPrompt`：系统级指令，定义 Agent 的行为规范

### 3.4 使用示例

```go
agent, err := deep.New(ctx, &deep.Config{
    Name:        "deep_agent",
    Instruction: "你是一个深度思考助手，擅长将复杂问题分解为可执行的子任务。",
    ChatModel:   chatModel,   // 注意：ChatModel 非 Model
    ToolsConfig: adk.ToolsConfig{
        Tools: []tool.BaseTool{searchTool, codeTool},
    },
    MaxIteration: 20,  // 注意：MaxIteration 非 MaxIterations
})
```

## 4. 三种预构建 Agent 对比

| 特性 | Supervisor | PlanExecute | DeepAgent |
|------|-----------|-------------|-----------|
| 编排方式 | 中心化路由（Agent Transfer） | 先规划后执行 | 深度迭代优化 |
| 子任务机制 | TransferToAgent | Plan 步骤 | Task Tool |
| Agent 配置 | Supervisor + SubAgents | Planner + Executor + Replanner | ChatModel + ToolsConfig |
| 支持恢复 | 是（ResumableAgent） | 否 | 是 |
| 适用场景 | 多专家协作 | 结构化多步骤 | 复杂分析与创作 |
| 模型要求 | 路由能力 | 规划能力 | 推理与分解能力 |
| 推荐程度 | 不推荐 | 推荐 | 强烈推荐 |

## 5. 选择建议

- **简单多 Agent 路由**：直接使用 `ChatModelAgent + AgentTool`，不需要 Supervisor
- **结构化任务**：使用 `PlanExecute`，步骤清晰可控
- **复杂开放式任务**：使用 `DeepAgent`，充分发挥模型推理能力
