# Graph Agent（上）— 基础·源码·实战

Graph Agent 是 tRPC-Agent-Go 的图工作流引擎，通过有向图将 LLM 调用、工具执行、条件分支组合为确定性工作流。

## 1. 概念概述

### 1.1 核心模型

```
Graph = Nodes + Edges + State

Node    : 处理步骤（LLM / Tool / Agent / Function）
Edge     : 数据流和控制流
State   : 贯穿全图的键值对容器（带 Reducer 保证并发安全）
```

### 1.2 使用模式

```
StateGraph.Build() → Compile() → GraphAgent.New() → Runner.Run()
```

---

## 2. 源码走读：StateGraph 构建

### 2.1 StateGraph

```go
// graph/state_graph.go
type StateGraph struct {
    schema    *StateSchema
    nodes     map[string]*Node
    edges     map[string][]*Edge
    conditionalEdges map[string]*ConditionalEdge
    entryPoint string
    finishPoints map[string]bool
}

func NewStateGraph(schema *StateSchema) *StateGraph {
    return &StateGraph{
        schema:    schema,
        nodes:     make(map[string]*Node),
        edges:     make(map[string][]*Edge),
    }
}
```

### 2.2 添加节点

```go
// Function 节点
sg.AddNode("process", func(ctx context.Context, s State) (any, error) {
    // 返回 State delta（合并到全局 State）
    return State{"key": "value"}, nil
})

// LLM 节点
sg.AddLLMNode("ask", modelInstance,
    WithLLMNodeInstruction("You are helpful."),
    WithLLMNodeTools(tools),
    WithLLMNodeGenerationConfig(genConfig),
)

// Tools 节点
sg.AddToolsNode("tools", toolList)

// Agent 节点（子 Agent）
sg.AddAgentNode("specialist",
    WithSubAgent(specialistAgent),
    WithSubgraphInputFromLastResponse(),
)
```

### 2.3 添加边

```go
// 普通边（固定路由）
sg.AddEdge("process", "ask")

// 条件边（LLM 节点的 tool_calls → tools 节点，否则 → fallback）
sg.AddToolsConditionalEdges("ask", "tools", "fallback")

// 通用条件边
sg.AddConditionalEdges("router",
    func(ctx context.Context, s State) (string, error) {
        intent, _ := s["intent"].(string)
        switch intent {
        case "weather": return "weatherNode", nil
        case "math":    return "mathNode", nil
        default:        return "fallback", nil
        }
    },
    map[string]string{
        "weatherNode": "weather",
        "mathNode":    "math",
        "fallback":    "fallback",
    },
)

// 多条件扇出（并行执行多个分支）
sg.AddMultiConditionalEdges("router",
    func(ctx context.Context, s State) ([]string, error) {
        return []string{"goA", "goB"}, nil
    },
    map[string]string{"goA": "nodeA", "goB": "nodeB"},
)
```

### 2.4 Compile — 编译为可执行 Graph

```go
func (sg *StateGraph) Compile(opts ...CompileOption) (*Graph, error) {
    // 1. 验证图结构
    if err := sg.validate(); err != nil { return nil, err }

    // 2. 构建执行计划
    plan := sg.buildExecutionPlan()

    // 3. 返回可执行 Graph
    return &Graph{
        nodes:    sg.nodes,
        edges:    sg.edges,
        schema:   sg.schema,
        executor: executor.New(plan, opts...),
    }, nil
}
```

---

## 3. 源码走读：BSP 执行引擎

### 3.1 BSP 超步模型

```
Superstep 1:  [nodeA] [nodeB]  (并行)
                │       │
Superstep 2:  [nodeC] [nodeD]  (并行，等待 A+B 完成)
                │       │
Superstep 3:  [nodeE]          (汇聚)
```

```go
// graph/executor/bsp_executor.go（简化）
type BSPExecutor struct {
    plan        *ExecutionPlan
    maxSteps    int
    stepTimeout time.Duration
}

func (e *BSPExecutor) Execute(ctx context.Context, state State, ch chan<- *event.Event) (State, error) {
    for step := 0; step < e.maxSteps; step++ {
        // 获取本超步中需要执行的节点
        nodes := e.plan.GetNextNodes(state)

        if len(nodes) == 0 { break }

        // 并行执行
        var wg sync.WaitGroup
        results := make(map[string]any)
        var mu sync.Mutex

        for _, node := range nodes {
            wg.Add(1)
            go func(n *Node) {
                defer wg.Done()
                // 1. 从 State 中提取节点输入
                input := n.PrepareInput(state)

                // 2. 执行节点
                output, err := n.Execute(ctx, input)

                // 3. 合并结果到 State（通过 Reducer）
                mu.Lock()
                for k, v := range output.AsState() {
                    state = e.schema.Reduce(state, k, v)
                }
                mu.Unlock()
            }(node)
        }
        wg.Wait()

        // 发送 State 变更事件
        ch <- e.createStateEvent(state)
    }
    return state, nil
}
```

**为什么超步模型？**
- 并行分支节点的结果通过 Reducer 合并到共享 State，必须等待全部完成才能继续
- 避免竞态条件：下游节点看到的是稳定的上游结果
- 确定性：相同的输入 → 相同的执行顺序（在同一超步内无顺序保证，但超步之间是确定的）

### 3.2 Reducer 机制

```go
// graph/state_schema.go
type StateField struct {
    Type    reflect.Type
    Reducer ReducerFunc
    Default DefaultFunc
}

type ReducerFunc func(existing, incoming any) any

// 默认 Reducer：后写覆盖前写
func DefaultReducer(existing, incoming any) any {
    return incoming
}

// 消息 Reducer：append 语义
func MessageReducer(existing, incoming any) any {
    if existing == nil { return incoming }
    return append(existing.([]model.Message), incoming.([]model.Message)...)
}
```

**Reducer 的意义**：并发分支可能向同一个 State key 写入。Reducer 定义了"如何合并"——消息用 append，计数器用 add，配置用 override。

---

## 4. 实战：审批工作流

```go
// 场景：员工提交请假申请 → LLM 审批 → 通过/拒绝

func main() {
    schema := graph.MessagesStateSchema()
    sg := graph.NewStateGraph(schema)

    // 节点 1：处理申请
    sg.AddNode("preprocess", func(ctx context.Context, s graph.State) (any, error) {
        userMsg, _ := s[graph.StateKeyUserInput].(string)
        return graph.State{
            graph.StateKeyUserInput: fmt.Sprintf(
                "Review leave request: %s. Reply APPROVED or DENIED with reason.", userMsg),
        }, nil
    })

    // 节点 2：LLM 审批
    sg.AddLLMNode("review", model,
        graph.WithLLMNodeInstruction("You are an HR manager. Review leave requests."),
    )

    // 节点 3：记录通过
    sg.AddNode("approved", func(ctx context.Context, s graph.State) (any, error) {
        lastResp, _ := s[graph.StateKeyLastResponse].(string)
        // 更新 HR 系统
        return graph.State{"status": "approved", "result": lastResp}, nil
    })

    // 节点 4：记录拒绝
    sg.AddNode("denied", func(ctx context.Context, s graph.State) (any, error) {
        lastResp, _ := s[graph.StateKeyLastResponse].(string)
        return graph.State{"status": "denied", "result": lastResp}, nil
    })

    // 路由
    sg.SetEntryPoint("preprocess")
    sg.AddEdge("preprocess", "review")
    sg.AddConditionalEdges("review",
        func(ctx context.Context, s graph.State) (string, error) {
            last, _ := s[graph.StateKeyLastResponse].(string)
            if strings.Contains(strings.ToUpper(last), "APPROVED") {
                return "approved", nil
            }
            return "denied", nil
        },
        map[string]string{"approved": "approved", "denied": "denied"},
    )
    sg.SetFinishPoint("approved").SetFinishPoint("denied")

    // 运行
    g, _ := sg.Compile()
    graphAgent, _ := graphagent.New("leave-approval", g,
        graphagent.WithDescription("Leave request approval workflow"),
    )

    r := runner.NewRunner("hr-bot", graphAgent)
    events, _ := r.Run(ctx, "emp-1", "sess-1",
        model.NewUserMessage("I need 3 days off starting May 10th for family reasons."),
    )

    for evt := range events {
        handleEvent(evt)
        if evt.IsRunnerCompletion() { break }
    }
}
```

---

## 5. 设计原理

### 5.1 为什么图工作流优于链式编排？

链式编排（ChainAgent）的问题是**缺少条件分支**——无法表达"如果 LLM 说 APPROVED，走 A 路径；如果说 DENIED，走 B 路径"。

图工作流的优势：
- 条件路由：LLM 的输出决定下一步执行路径
- 并行分支：多路分析后汇聚
- 循环：Graph 支持 cycle edges → 迭代改进

### 5.2 State 的不可变性设计

节点不直接修改全局 State，而是返回 delta。BSP 执行器负责按 Reducer 合并。这保证了：
- 并发安全（多个 goroutine 读同一个 State，不修改）
- 可追溯（每个超步的 State 都是确定性的）
- 可重放（Checkpoint 机制的基础）

### 5.3 为什么有两个引擎（BSP + DAG）？

BSP（默认）：确定性超步 → 适合有分支汇聚的场景
DAG（可选）：急切执行 → 适合纯流水线（无分支汇聚），延迟更低

选择建议：不确定就用 BSP（安全），确认无并行汇聚时用 DAG（性能）。
