# Eino 示例导读

Eino 源码中没有独立的 `examples/` 目录，但框架的**测试文件**和**预构建模块**本身就是最佳的学习范例。本文梳理了散布在源码中的关键示例，帮助开发者快速定位参考代码。

---

## 1. ChatModel 直接调用

### 1.1 基本调用与流式调用

模型接口 `BaseChatModel` 定义在 `components/model/interface.go:36`，提供 `Generate` 和 `Stream` 两个方法。测试文件 `adk/chatmodel_test.go` 展示了完整的调用模式：

```go
// adk/chatmodel_test.go:38-87
// 使用 mock 模型演示 Generate 调用
cm.EXPECT().Generate(gomock.Any(), gomock.Any(), gomock.Any()).
    Return(schema.AssistantMessage("Hello, I am an AI assistant.", nil), nil)

agent, _ := adk.NewChatModelAgent(ctx, &adk.ChatModelAgentConfig{
    Model:       cm,
    Instruction: "You are a helpful assistant.",
})
input := &AgentInput{
    Messages: []Message{schema.UserMessage("Hello, who are you?")},
}
iterator := agent.Run(ctx, input)
event, _ := iterator.Next()
fmt.Println(event.Output.MessageOutput.Message.Content)
```

### 1.2 ToolCallingChatModel

`ToolCallingChatModel` 接口（`components/model/interface.go:99`）的 `WithTools` 方法返回新实例，是并发安全的工具绑定方式。`adk/react_test.go` 中大量使用了此模式：

```go
// adk/react_test.go 中的典型用法
cm := mockModel.NewMockToolCallingChatModel(ctrl)
cm.EXPECT().WithTools(gomock.Any()).Return(cm, nil)
```

---

## 2. 工具定义与调用

### 2.1 InferTool 推断工具

`components/tool/utils/invokable_func.go:46` 提供了从 Go 结构体自动推断工具 schema 的能力，是最常用的工具创建方式：

```go
// 从结构体推断工具（components/tool/utils/invokable_func.go:46）
weatherTool, _ := utils.InferTool[WeatherInput, string](
    "get_weather", "获取天气",
    func(ctx context.Context, input *WeatherInput) (string, error) {
        return fmt.Sprintf("%s天气: 晴, 25°C", input.City), nil
    },
)
```

相关测试：`components/tool/utils/invokable_func_test.go`

### 2.2 EnhancedTool 多模态工具

`InferEnhancedTool`（`components/tool/utils/invokable_func.go:75`）返回 `*schema.ToolResult`，支持文本、图片、音频等多模态输出：

```go
enhancedTool, _ := utils.InferEnhancedTool[SearchInput](
    "search", "搜索并返回多模态结果",
    func(ctx context.Context, input *SearchInput) (*schema.ToolResult, error) {
        return &schema.ToolResult{...}, nil
    },
)
```

### 2.3 NewTool 显式定义工具

当无法从结构体推断 schema 时，使用 `NewTool`（`components/tool/utils/invokable_func.go:143`）手动提供 `*schema.ToolInfo`。

---

## 3. Chain 编排

### 3.1 基本链式编排

`compose/chain.go:37` 定义了 Chain 创建方法。测试文件 `compose/chain_test.go` 展示了各种编排模式：

```go
// 线性链
chain := compose.NewChain[map[string]any, *schema.Message]()
chain.AppendChatTemplate(template).AppendChatModel(model)
runnable, _ := chain.Compile(ctx)
result, _ := runnable.Invoke(ctx, input)
```

### 3.2 并行与分支

Chain 支持通过 `AppendParallel` 和 `AppendBranch` 构建复杂拓扑：

```go
chain.AppendParallel().
    AddBranch("branch_a", branchA).
    AddBranch("branch_b", branchB)
```

---

## 4. Graph 编排

### 4.1 React Agent 图

`flow/agent/react/react.go` 是最好的 Graph 编排示例，展示了如何用 `compose.Graph` 构建 ReAct 循环：

- `nodeKeyModel` 节点：调用 ChatModel（`react.go:127`）
- `nodeKeyTools` 节点：执行工具调用（`react.go:243`）
- 条件分支：判断模型输出是否包含 ToolCall（`react.go:369`）

### 4.2 自定义 Graph

`compose/graph_test.go` 包含大量 Graph 编排测试用例，涵盖：

- DAG 模式（无环有向图）
- Pregel 模式（支持环路的图计算）
- 条件分支
- 状态管理
- 检查点与恢复

---

## 5. ADK Agent 示例

### 5.1 ChatModelAgent 基础

`adk/chatmodel_test.go:38-87` 演示了最简单的无工具 Agent：

```go
agent, _ := adk.NewChatModelAgent(ctx, &adk.ChatModelAgentConfig{
    Name:        "TestAgent",
    Instruction: "You are a helpful assistant.",
    Model:       cm,
})
iterator := agent.Run(ctx, input)
```

### 5.2 AgentMiddleware

`adk/chatmodel_test.go:89-150` 展示了如何通过 `AgentMiddleware` 在模型调用前后注入逻辑：

```go
agent, _ := adk.NewChatModelAgent(ctx, &adk.ChatModelAgentConfig{
    Model: cm,
    Middlewares: []AgentMiddleware{
        {
            BeforeChatModel: func(ctx context.Context, state *ChatModelAgentState) error {
                state.Messages = append(state.Messages, schema.UserMessage("m"))
                return nil
            },
            AfterChatModel: func(ctx context.Context, state *ChatModelAgentState) error {
                // 模型调用后的处理
                return nil
            },
        },
    },
})
```

### 5.3 带工具的 ReAct 循环

`adk/react_test.go` 是 ReAct 循环的核心测试，展示了模型 → 工具 → 模型的完整循环：

```go
// 模型第一次返回：调用工具
cm.EXPECT().Generate(...).Return(
    schema.AssistantMessage("", &schema.ToolCall{
        ID:   "call_1",
        Type: "function",
        Function: schema.FunctionCall{
            Name:      "get_weather",
            Arguments: `{"city":"北京"}`,
        },
    }), nil)

// 模型第二次返回：最终回答
cm.EXPECT().Generate(...).Return(
    schema.AssistantMessage("北京今天天气晴朗，25度。", nil), nil)
```

### 5.4 Agentic 模型（AgenticMessage）

`adk/agentic_test.go` 展示了使用 `*schema.AgenticMessage` 的 Agent，适用于支持原生工具调用的模型（如 Claude、Gemini）：

```go
agent, _ := adk.NewTypedChatModelAgent[*schema.AgenticMessage](ctx, &adk.TypedChatModelAgentConfig[*schema.AgenticMessage]{
    Model: agenticModel,
    Instruction: "...",
})
```

### 5.5 AgentTool 多 Agent 协作

`adk/agent_tool.go:69` 展示了将 Agent 包装为工具的模式：

```go
agentTool, _ := adk.NewAgentTool(ctx, subAgent)
// 将 agentTool 作为工具添加到主 Agent 的 ToolsConfig 中
```

---

## 6. 预构建 Agent

### 6.1 DeepAgent

`adk/prebuilt/deep/deep.go` — 深度任务编排 Agent，内置子任务拆分和执行机制：

```go
deepAgent, _ := deep.New(ctx, &deep.Config{
    Name:        "deep_agent",
    ChatModel:   model,
    Instruction: "...",
    ToolsConfig: adk.ToolsConfig{Tools: []tool.BaseTool{searchTool}},
    MaxIteration: 20,
})
```

测试文件：`adk/prebuilt/deep/deep_test.go`

### 6.2 PlanExecute

`adk/prebuilt/planexecute/plan_execute.go` — 计划-执行-重规划 Agent：

```go
peAgent, _ := planexecute.New(ctx, &planexecute.Config{
    Planner:     plannerAgent,
    Executor:    executorAgent,
    Replanner:   replannerAgent,
    MaxIterations: 10,
})
```

测试文件：`adk/prebuilt/planexecute/plan_execute_test.go`

### 6.3 Supervisor

`adk/prebuilt/supervisor/supervisor.go` — 中央调度多 Agent 模式（不推荐，建议使用 AgentTool 替代）：

```go
supervisorAgent, _ := supervisor.New(ctx, &supervisor.Config{
    Supervisor: coordAgent,
    SubAgents:  []adk.Agent{agentA, agentB},
})
```

---

## 7. Flow 预构建流程

### 7.1 React Agent（flow 层）

`flow/agent/react/react.go` — 基于底层 `compose.Graph` 的 ReAct Agent，是 ADK ChatModelAgent 的底层实现：

```go
agent, _ := react.NewAgent(ctx, &react.AgentConfig{
    ToolCallingModel: model,
})
opts, _ := react.WithTools(ctx, tool1, tool2)
msg, _ := agent.Generate(ctx, messages, opts...)
```

### 7.2 MultiQuery 检索增强

`flow/retriever/multiquery/` — 生成多个查询变体以提高检索召回率。

### 7.3 Router 检索路由

`flow/retriever/router/` — 根据查询语义选择最合适的检索器。

### 7.4 ParentIndexer 父子文档

`flow/indexer/parent/` 和 `flow/retriever/parent/` — 父子文档索引与检索，实现细粒度检索 + 大上下文返回。

---

## 8. 中间件示例

`adk/middlewares/` 目录提供了多个开箱即用的中间件实现，也是学习编写自定义 Middleware 的参考：

| 中间件 | 位置 | 说明 |
|--------|------|------|
| `summarization` | `adk/middlewares/summarization/` | 长对话自动摘要 |
| `dynamictool` | `adk/middlewares/dynamictool/` | 动态工具注册/注销 |
| `skill` | `adk/middlewares/skill/` | 技能管理 |
| `plantask` | `adk/middlewares/plantask/` | 任务规划 |
| `reduction` | `adk/middlewares/reduction/` | 输出精简 |
| `agentsmd` | `adk/middlewares/agentsmd/` | Agent 语义中间件 |
| `filesystem` | `adk/middlewares/filesystem/` | 文件系统操作 |
| `patchtoolcalls` | `adk/middlewares/patchtoolcalls/` | 工具调用补丁 |

---

## 9. 学习建议

1. **入门**：从 `adk/chatmodel_test.go` 的 `BasicFunctionality` 用例开始
2. **进阶**：阅读 `flow/agent/react/react.go` 理解 ReAct 循环的 Graph 实现
3. **深入**：研究 `adk/react.go` 理解 ADK 如何在 Flow 之上封装 Handler/Middleware 体系
4. **实践**：参考 `adk/middlewares/` 下的中间件实现，编写自定义 Handler
