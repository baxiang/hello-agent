# Graph Agent 图工作流详解

Graph Agent 提供类型安全的图工作流编排能力，功能等价于 Go 版 LangGraph。它将 AI 工作流建模为有向图，节点代表处理步骤，边代表数据流和控制流。

## 1. 核心概念

### 1.1 Graph

有向图是工作流的核心结构：

```go
import "trpc.group/trpc-go/trpc-agent-go/graph"

schema := graph.NewStateSchema()
sg := graph.NewStateGraph(schema)
```

虚拟节点 `Start` 和 `End` 无需显式创建，通过 `SetEntryPoint()` 和 `SetFinishPoint()` 自动连接。

### 1.2 Node

```go
type NodeFunc func(ctx context.Context, state graph.State) (any, error)
```

节点函数接收 State，返回 delta（合并入全局 State）或 nil。

### 1.3 State

```go
type State map[string]any
```

State 是贯穿整个工作流的键值对容器。通过 Schema + Reducer 保证并发安全。

### 1.4 State Schema

```go
schema := graph.NewStateSchema()
schema.AddField("counter", graph.StateField{
    Type:    reflect.TypeOf(0),
    Reducer: graph.DefaultReducer,     // 默认：后写覆盖前写
    Default: func() any { return 0 },
})

// 消息列表使用专用 Reducer
schema.AddField(graph.StateKeyMessages, graph.StateField{
    Type:    reflect.TypeOf([]model.Message{}),
    Reducer: graph.MessageReducer,     // append 语义
})
```

---

## 2. 使用模式

```
1. 创建 StateGraph → 2. 添加节点 → 3. 添加边 → 4. 编译为 Graph → 5. 包装为 GraphAgent → 6. 通过 Runner 执行
```

### 2.1 创建 GraphAgent

```go
import (
    "trpc.group/trpc-go/trpc-agent-go/graph"
    "trpc.group/trpc-go/trpc-agent-go/agent/graphagent"
)

// 1-4. 构建 Graph
sg := graph.NewStateGraph(schema)

sg.AddNode("prepare", prepareFunc)
sg.AddLLMNode("ask", modelInstance)
sg.AddToolsNode("tools", toolList)

sg.SetEntryPoint("prepare")
sg.AddEdge("prepare", "ask")
sg.AddToolsConditionalEdges("ask", "tools", "fallback")
sg.AddEdge("tools", "ask")
sg.SetFinishPoint("fallback")

compiled, _ := sg.Compile()

// 5. 包装为 GraphAgent
agent, _ := graphagent.New("workflow", compiled,
    graphagent.WithDescription("A workflow agent"),
    graphagent.WithInitialState(graph.State{"key": "value"}),
)

// 6. 通过 Runner 执行
r := runner.NewRunner("graph-app", agent)
events, _ := r.Run(ctx, "user-1", "session-1",
    model.NewUserMessage("What is 2+3?"),
)
```

---

## 3. 节点类型

### 3.1 Function Node

```go
func processNode(ctx context.Context, state graph.State) (any, error) {
    input, _ := state["user_input"].(string)
    result := process(input)
    return graph.State{
        "processed": result,
    }, nil
}

sg.AddNode("process", processNode)
```

### 3.2 LLM Node

```go
sg.AddLLMNode("ask", modelInstance,
    graph.WithLLMNodeInstruction("You are a helpful assistant."),
    graph.WithLLMNodeTools(tools),
    graph.WithLLMNodeGenerationConfig(model.GenerationConfig{
        Temperature: floatPtr(0.7),
    }),
    graph.WithLLMNodeModelCallbacks(callbacks),
)
```

LLM Node 自动处理：
- 从 `messages` state 读取对话历史
- 将响应 append 到 `messages`
- 设置 `last_response` 和 `node_responses`

### 3.3 Tools Node

```go
sg.AddToolsNode("tools", toolList,
    graph.WithToolCallRetryPolicy(policy),
)
```

自动从 `messages` 中提取最新的 `tool_calls`，执行工具后将结果 append 回 `messages`。

### 3.4 Agent Node

```go
sg.AddAgentNode("sub-task", graph.WithSubAgent(subAgent))
```

将子 Agent 嵌入到工作流中。子 Agent 执行完成后：
- 设置 `last_response`
- 设置 `node_responses[agent_node_id]`
- 清除 `user_input`

---

## 4. 路由机制

### 4.1 条件路由

```go
sg.AddConditionalEdges("router",
    func(ctx context.Context, s graph.State) (string, error) {
        intent, _ := s["intent"].(string)
        switch intent {
        case "weather": return "weatherRoute", nil
        case "math":    return "mathRoute", nil
        default:        return "fallback", nil
        }
    },
    map[string]string{
        "weatherRoute": "weatherNode",
        "mathRoute":    "mathNode",
        "fallback":     "fallbackNode",
    },
)
```

### 4.2 Multi-Conditional Fan-out

```go
sg.AddMultiConditionalEdges("router",
    func(ctx context.Context, s graph.State) ([]string, error) {
        return []string{"goA", "goB"}, nil
    },
    map[string]string{
        "goA": "nodeA",
        "goB": "nodeB",
    },
)
```

多个分支**并行**执行，完成后再汇聚到下游。

### 4.3 Named Ends（单节点多终点）

```go
sg.AddNamedEnds("classifier", map[string]string{
    "approved":  "approvalNode",
    "rejected":  "rejectNode",
    "escalated": "managerNode",
})
```

### 4.4 Command 模式

节点内通过返回 `*graph.Command` 实现动态路由和扇出：

```go
func dynamicRouter(ctx context.Context, s graph.State) (any, error) {
    return &graph.Command{
        Update: graph.State{"key": "value"},
        GoTo:   "nextNode",
    }, nil
}
```

---

## 5. 执行引擎

### 5.1 BSP 引擎（默认）

确定性超步模型：Plan → Execute → Update

- 所有并行节点在同一超步（superstep）内执行
- 下游节点等待所有上游完成后才开始

### 5.2 DAG 引擎（可选）

```go
g, _ := sg.Compile(
    graph.WithDAGExecutor(), // 急切调度，无全局超步屏障
)
```

适合纯流水线场景，无分支汇聚时延迟更低。

### 5.3 执行器高级配置

```go
g, _ := sg.Compile(
    graph.WithMaxSteps(100),                       // 最大步数
    graph.WithStepTimeout(60*time.Second),         // 步骤超时
    graph.WithCheckpointSaver(saver),              // 检查点存储
)
```

---

## 6. State 数据流

### 6.1 内置 State Key

| Key | 常量 | 说明 |
|-----|------|------|
| `user_input` | `StateKeyUserInput` | 一次性输入，消费后清除 |
| `one_shot_messages` | `StateKeyOneShotMessages` | 一轮消息覆盖 |
| `messages` | `StateKeyMessages` | 持久化消息历史 |
| `last_response` | `StateKeyLastResponse` | 最后文本响应 |
| `last_response_id` | `StateKeyLastResponseID` | 最后响应 ID |
| `node_responses` | `StateKeyNodeResponses` | 各节点输出映射 |
| `metadata` | `StateKeyMetadata` | 通用元数据 |

### 6.2 节点间数据传递

```go
// 上游节点
func step1(ctx context.Context, s graph.State) (any, error) {
    return graph.State{"parsed_time": result}, nil
}

// 下游节点
func step2(ctx context.Context, s graph.State) (any, error) {
    parsed, ok := s["parsed_time"].(string)
    // ...
}

// 读取上游文本输出
func step2(ctx context.Context, s graph.State) (any, error) {
    lastResp, _ := s[graph.StateKeyLastResponse].(string)
    // 或从 node_responses 读取特定节点
    nodeResp, _ := s[graph.StateKeyNodeResponses].(map[string]any)["step1"].(string)
}
```

### 6.3 One-Shot Messages

```go
// 为特定 LLM 节点准备一次性消息
func preprocess(ctx context.Context, s graph.State) (any, error) {
    return graph.State{
        graph.StateKeyOneShotMessagesByNode: map[string][]model.Message{
            "llm1": {model.NewSystemMessage("You are llm1.")},
            "llm2": {model.NewSystemMessage("You are llm2.")},
        },
    }, nil
}

// 或使用 helper
func preprocess(ctx context.Context, s graph.State) (any, error) {
    return graph.SetOneShotMessagesForNode("llm1", msgs), nil
}
```

---

## 7. Human-in-the-Loop

### 7.1 中断

```go
func approvalNode(ctx context.Context, s graph.State) (any, error) {
    // 中断执行，等待外部输入
    return nil, graph.NewInterruptError("Need human approval")
}
```

### 7.2 恢复执行

```go
// 中断时 graph 自动保存 checkpoint
// 恢复时通过 checkpoint 继续
events, _ := r.Run(ctx, userID, sessionID,
    model.Message{},
    agent.WithResume(true),
)
```

### 7.3 静态中断点（调试用）

```go
sg.AddNode("debug", debugFunc,
    graph.WithNodeInterruptBefore(true),  // 执行前中断
    graph.WithNodeInterruptAfter(true),   // 执行后中断
)
```

---

## 8. Checkpoint 与时间旅行

### 8.1 启用 Checkpoint

```go
import "trpc.group/trpc-go/trpc-agent-go/graph/checkpoint/sqlite"

saver, _ := sqlite.NewSaver("/path/to/checkpoints.db")

g, _ := sg.Compile(
    graph.WithCheckpointSaver(saver),
)
```

### 8.2 时间旅行

```go
// 查看历史状态
states, _ := g.GetStateHistory(ctx, config)

// 恢复到历史状态
g.UpdateState(ctx, config, targetState)
```

---

## 9. 可视化

```go
// 导出 DOT 格式
dot := g.ToDOT()
fmt.Println(dot)

// 或
import "os"
g.RenderDOT(os.Stdout)
```

---

## 10. 事件与监控

### 10.1 StreamMode

```go
g, _ := sg.Compile(
    graph.WithStreamMode(
        graph.StreamModeValues,    // State 变化
        graph.StreamModeUpdates,   // 节点更新
        graph.StreamModeDebug,     // 调试信息
    ),
)
```

### 10.2 Event Metadata

```go
for event := range events {
    // 模型执行元数据
    if b, ok := event.StateDelta[graph.MetadataKeyModel]; ok {
        var md graph.ModelExecutionMetadata
        json.Unmarshal(b, &md)
    }
    // 工具执行元数据
    if b, ok := event.StateDelta[graph.MetadataKeyTool]; ok {
        var md graph.ToolExecutionMetadata
        json.Unmarshal(b, &md)
    }
    // 节点执行元数据（含重试信息）
    if b, ok := event.StateDelta[graph.MetadataKeyNode]; ok {
        var md graph.NodeExecutionMetadata
        json.Unmarshal(b, &md)
        // md.Attempt, md.MaxAttempts, md.Retrying
    }
}
```

### 10.3 Node Event Emitter

节点内可主动发射自定义事件：

```go
func processNode(ctx context.Context, s graph.State) (any, error) {
    emitter := graph.GetEventEmitter(s)

    // 自定义事件
    emitter.EmitCustom("data.loaded", map[string]any{"records": 1000})

    // 进度事件
    emitter.EmitProgress(50.0, "Half done")

    // 流式文本
    emitter.EmitText("Processing complete.\n")

    return nil, nil
}
```

---

## 11. 节点重试

```go
sg.AddNode("unreliable",
    unreliableFunc,
    graph.WithNodeRetryPolicy(&graph.RetryPolicy{
        MaxAttempts:     3,
        InitialInterval: 200 * time.Millisecond,
        BackoffFactor:   2.0,
        MaxInterval:     10 * time.Second,
        Jitter:          true,
    }),
)
```

---

## 12. 消息可见性

Graph 中的 LLM Node 支持消息过滤：

```go
sg.AddLLMNode("ask", modelInstance,
    graph.WithLLMNodeMessageTimelineFilterMode(graph.TimelineFilterAll),
    graph.WithLLMNodeMessageBranchFilterMode(graph.BranchFilterModePrefix),
)
```

---

## 13. 与 Multi-Agent 集成

### 13.1 GraphAgent 作为 Agent

`GraphAgent` 实现了 `agent.Agent` 接口，可以作为子 Agent 嵌入到其他 Agent 中：

```go
coordinator := llmagent.New("coordinator",
    llmagent.WithSubAgents([]agent.Agent{graphAgent}),
)
```

### 13.2 Agent 嵌入 Graph

```go
sg.AddAgentNode("specialist",
    graph.WithSubAgent(specialistAgent),
    graph.WithSubgraphInputFromLastResponse(), // 将上游输出作为 Agent 输入
    graph.WithSubgraphIsolatedMessages(true),  // 隔离消息上下文
)
```

### 13.3 混合模式

```
Coordinator (LLMAgent)
  ├── SubAgent 1: GraphAgent (审批工作流)
  ├── SubAgent 2: ParallelAgent (并行分析)
  └── SubAgent 3: ChainAgent (顺序处理)
```
