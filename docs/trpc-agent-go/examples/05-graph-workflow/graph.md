# Graph 工作流 - 构建复杂 AI Agent 的有向图引擎

> **源码路径**：[`trpc-agent-go/examples/graph/`](../../../../trpc-agent-go/examples/graph)
> **子示例数**：50+ 个 · 本页为分类索引，按主题拆分为多篇独立详解

## 概述

tRPC-Agent-Go 的 `graph` 包提供了一个功能完备的**有向图执行引擎**，用于编排多步骤、多分支、可中断、可并发的 AI 工作流。`examples/graph/` 下有 50+ 个子示例，按主题可分为六大类——本页是**分类导航**，帮你快速找到对应模式的详解。

如果你是第一次接触 Graph，建议先从 [学习路径建议](#学习路径建议) 开始。

## 主题文章导航

本分类把 50+ 子示例按关注点拆成 6 篇主题文章，每篇聚焦一个维度：

| 主题文章 | 覆盖子示例（节选） | 一句话 |
|----------|--------------------|--------|
| [`graph-topology.md`](./graph-topology.md) ✅ | basic / diamond / parallel / multiends / fanout / join_edge / mapreduce | 基础拓扑与编排模式：线性、分支、汇聚、MapReduce |
| [`graph-execution.md`](./graph-execution.md) | dag_engine / execution_trace / concurrency_race / nodecache | 执行引擎（BSP vs DAG）、并发竞态、节点缓存、执行轨迹 |
| [`graph-interrupt.md`](./graph-interrupt.md) | interrupt / static_interrupt / nested_interrupt / external_interrupt / dag_interrupt / a2a_interrupt / checkpoint / time_travel_edit_state / retry / tool_call_retry | 中断恢复（HITL）、检查点、时间旅行、重试策略 |
| [`graph-subagent.md`](./graph-subagent.md) | subgraph / agentnode_llmagent_externaltool / isolated_subagent / subagent_runtime_state / a2a_agent / a2asubagent / agent_state_handoff | 子图嵌套、AgentNode、A2A 协议、子 Agent 运行时状态 |
| [`graph-streaming-io.md`](./graph-streaming-io.md) | stream_mode / streaming_node_consumer / io_conventions / io_conventions_tools / terminal_messages_only | 流式输出模式、IO 约定、流式消费者 |
| [`graph-advanced.md`](./graph-advanced.md) | visualization / per_node_callbacks / runner_plugin_node_callbacks / error_handling / react / multiturn / placeholder / invocation_placeholder / retrieval_placeholder / call_options_generation_config / externaltool / mcptool / oneshot_by_node / oneshot_by_node_preprocess / oneshotoverride / userinputonce / structure_export | 可视化、回调、错误处理、ReAct、多轮、各类 oneshot/placeholder 约定 |

> ✅ 表示已完成的篇章；其余为主题占位，由对应 Agent 产出后补全。

## 选型建议

### 按需求场景选拓扑

```
你要解决什么问题？
│
├── 单链流水线，偶尔按条件分流
│   └── basic（条件边 AddConditionalEdges）
│
├── 离散枚举决策（approve/reject 等）
│   └── multiends（Command.GoTo + WithEndsMap，编译期校验）
│
├── 固定多视角并行（摘要/增强/分类）
│   └── parallel（同一节点静态多边）
│
├── 任务数运行时才知道，需批量并发
│   └── fanout（节点返回 []*Command）
│
├── 需要严格"全部完成才下一步"的汇聚
│   ├── 简单场景 → join_edge（AddJoinEdge 声明式）
│   └── 复杂场景 → diamond / mapreduce（条件边 barrier）
│
├── 文档/数据分治问答
│   └── mapreduce（扇出 + barrier + LLM 归约）
│
├── 需要 Human-in-the-Loop 暂停等用户确认
│   └── interrupt 系列（见 graph-interrupt.md）
│
├── 需要子流程封装 / 多 Agent 协作
│   └── subgraph / agentnode / a2a（见 graph-subagent.md）
│
└── 关注吞吐，想按依赖就绪调度而非按层调度
    └── dag_engine（DAG 引擎，见 graph-execution.md）
```

### 按执行特性选引擎/模式

| 关注点 | 推荐 |
|--------|------|
| 吞吐 / 依赖驱动调度 | DAG 引擎（`graph-execution.md`） |
| 容错 / 断点续跑 | Checkpoint + resume（`graph-interrupt.md`） |
| 流式 UI 体验 | stream_mode / fake streaming（`graph-streaming-io.md`） |
| 调试 / 可观测 | per_node_callbacks / execution_trace / visualization（`graph-advanced.md`） |
| 嵌套复用 | subgraph / AgentNode（`graph-subagent.md`） |

## 核心概念

以下概念贯穿所有主题文章，统一在此说明。

### StateGraph 与 State

Graph 的核心是 `StateGraph`——一个**有状态的有向图**。每个节点接收 `graph.State`（本质 `map[string]any`），执行逻辑后返回一个**状态增量**。框架按 `StateSchema` 中字段的 `Reducer` 把增量合并进全局状态，保证并发分支能安全汇聚。

```go
schema := graph.NewStateSchema()
schema.AddField("counter", graph.StateField{
    Type:    reflect.TypeOf(0),
    Reducer: graph.DefaultReducer,           // 直接覆盖
    Default: func() any { return 0 },
})
schema.AddField("results", graph.StateField{
    Type:    reflect.TypeOf([]string{}),
    Reducer: graph.StringSliceReducer,       // 多分支结果自动 append
    Default: func() any { return []string{} },
})
sg := graph.NewStateGraph(schema)
```

- `graph.MessagesStateSchema()` 返回预置 schema，已含 `messages`/`user_input`/`last_response`/`node_responses` 等常用字段（LLM 场景推荐起步）。
- 内置 Reducer：`DefaultReducer`（覆盖）、`StringSliceReducer`（append）、`MessagesReducer`（消息合并，`MessagesStateSchema()` 默认携带）。
- 复杂合并逻辑可写自定义 reducer（见 `fanout/` 的 `intSumReducer`、`mapreduce/` 的 `appendMapSliceReducer`）。

### 节点类型（Node types）

| 类型 | 创建方式 | 说明 |
|------|----------|------|
| Function Node | `AddNode(name, func)` | 普通 Go 函数节点，最常用 |
| LLM Node | `AddLLMNode(name, model, prompt, tools)` | 大模型调用节点，自动管理消息上下文 |
| Tools Node | `AddToolsNode(name, tools)` | 执行 LLM 的 tool_calls |
| Subgraph Node | `AddSubgraphNode(name, opts...)` | 子图节点，委托给子 GraphAgent（见 [`graph-subagent.md`](./graph-subagent.md)） |

### 边与路由（Edge types）

| 原语 | 作用 |
|------|------|
| `SetEntryPoint("A")` / `SetFinishPoint("Z")` | 声明入口与终点 |
| `AddEdge("A", "B")` | 静态边；**同源多边 = 并行扇出** |
| `AddConditionalEdges("A", condFunc, map)` | 条件边：函数返回 key，查 map 得目标 |
| `AddToolsConditionalEdges("llm", "tools", "next")` | LLM 有 tool_calls 走 tools，否则走 next（构成 LLM↔tools 循环） |
| `AddJoinEdge([]string{"a","b"}, "join")` | 声明式 wait-all 汇聚 |
| `WithEndsMap(...)` + `Command.GoTo` | 节点级命名端点，符号化分支 |
| 节点返回 `[]*Command` | 动态扇出（类 LangGraph `Send`） |

特殊返回值：`*graph.Command{GoTo: "X"}` 显式跳转；条件函数返回 `graph.End` 表示"本轮不前进"（barrier 用法）。

### Reducer

Reducer 是**并发安全的合并函数**，决定多个分支对同一字段的更新如何叠加。没有 reducer，并行分支会互相覆盖；选对 reducer，`StringSliceReducer` 之类能自动把 N 路结果收集成数组。这是 `parallel`/`diamond`/`fanout`/`mapreduce` 都能正确汇聚的根本原因。

## 运行方式速查

大多数示例可直接 `go run .`（纯函数节点无需 API Key，适合先验证拓扑）：

```bash
# 无需 API Key 的拓扑/执行类示例
cd examples/graph/diamond      && go run .            # 菱形 + barrier
cd examples/graph/multiends    && go run .            # 命名端点
cd examples/graph/join_edge    && go run .            # wait-all 汇聚
cd examples/graph/dag_engine   && go run . -engine both

# 需要 API Key 的 LLM 类示例
export OPENAI_API_KEY="your-key"
cd examples/graph/basic        && go run main.go -model deepseek-v4-flash
cd examples/graph/parallel     && go run main.go
cd examples/graph/fanout       && go run main.go
cd examples/graph/mapreduce    && go run . -file ./sample.txt -top-k 4
```

通用环境变量：

| 变量 | 必需性 | 说明 |
|------|--------|------|
| `OPENAI_API_KEY` | LLM 节点必需 | 模型 API Key |
| `OPENAI_BASE_URL` | 可选 | 模型端点（默认 `https://api.openai.com/v1`） |

## 深度原理

> 本节源自原「核心组件」深度文（10-graph.md + 11-graph-advanced.md + 02-agent-types.md 的 GraphAgent 部分）。
> 保留接口源码签名、设计哲学与配置速查；具体的走读与示例分散在下方 6 篇主题文章中。

### StateGraph 核心架构

Graph 的核心模型：

```
Graph = Nodes + Edges + State

Node    : 处理步骤（LLM / Tool / Agent / Function）
Edge     : 数据流和控制流
State   : 贯穿全图的键值对容器（带 Reducer 保证并发安全）
```

`StateGraph` 是图的构建器，内部维护节点表、边表、条件边表、入口与终点：

```go
// graph/state_graph.go
type StateGraph struct {
    schema           *StateSchema
    nodes            map[string]*Node
    edges            map[string][]*Edge
    conditionalEdges map[string]*ConditionalEdge
    entryPoint       string
    finishPoints     map[string]bool
}

func NewStateGraph(schema *StateSchema) *StateGraph
```

`State` 本质是 `map[string]any`，其字段的类型、合并方式、默认值由 `StateSchema` 声明：

```go
// graph/state_schema.go
type StateField struct {
    Type    reflect.Type
    Reducer ReducerFunc
    Default DefaultFunc
}

type ReducerFunc func(existing, incoming any) any

func DefaultReducer(existing, incoming any) any   // 后写覆盖前写
func MessageReducer(existing, incoming any) any   // 消息 append 语义
```

使用模式：`StateGraph.Build()` → `Compile()` → `GraphAgent.New()` → `Runner.Run()`。

### 节点与边的设计

**节点类型**（四种原语，覆盖所有编排需求）：

| 类型 | 创建 API | 职责 |
|------|----------|------|
| Function Node | `AddNode(name, func)` | 普通 Go 函数节点，最常用，返回 State delta |
| LLM Node | `AddLLMNode(name, model, opts...)` | 大模型调用，自动管理消息上下文 |
| Tools Node | `AddToolsNode(name, tools)` | 执行 LLM 的 tool_calls |
| Subgraph Node | `AddSubgraphNode(name, opts...)` | 委托给子 GraphAgent（见 [`graph-subagent.md`](./graph-subagent.md)） |

**边与路由**（五套原语覆盖所有分支需求）：

| 原语 | 语义 |
|------|------|
| `AddEdge("A", "B")` | 静态边；同源多边 = 并行扇出 |
| `AddConditionalEdges("A", fn, map)` | 条件边：函数返回 key，查 map 得目标 |
| `AddToolsConditionalEdges("llm", "tools", "next")` | LLM 有 tool_calls 走 tools，否则走 next（构成 LLM↔tools 循环） |
| `AddMultiConditionalEdges("A", fn, map)` | 多条件扇出：函数返回 `[]string`，并行执行多个分支 |
| `AddJoinEdge([]string{"a","b"}, "join")` | 声明式 wait-all 汇聚 |

节点内部还可用 `*graph.Command{GoTo: "X"}` 做运行时显式跳转，或返回 `[]*Command` 做动态扇出；条件函数返回 `graph.End` 表示"本轮不前进"（barrier 用法）。

### GraphAgent 类型

GraphAgent 是 tRPC-Agent-Go 的 Agent 接口实现之一，与 ChainAgent / ParallelAgent / CycleAgent / AgentTool 并列，但定位完全不同：

| 模式 | 适用场景 | 延迟特点 | 结果特点 |
|------|---------|---------|---------|
| ChainAgent | 严格顺序依赖的流水线 | 延迟累加 | 最终步骤的输出 |
| ParallelAgent | 无依赖的独立分析 | 取最大值 | 合并多个结果 |
| CycleAgent | 多轮迭代优化 | 不可控（需限上限） | 最后迭代的输出 |
| AgentTool | 按需调用的专家 Agent | 单次调用延迟 | 单一 Agent 的完成输出 |
| **GraphAgent** | **复杂条件分支 + 循环** | **灵活可控** | **任意节点的输出** |

关键差异：

- Chain/Parallel/Cycle 是**固定拓扑**编排器，无法表达"LLM 输出决定下一步路径"。
- 子 Agent 之间**不能共享中间状态**（如需共享，必须用 GraphAgent）。
- 需要**步骤间反馈回路**（步骤 C 发现问题回到步骤 A）时，应使用 CycleAgent 或 GraphAgent。
- GraphAgent 是唯一同时支持**有状态分支汇聚 + HITL 中断 + Checkpoint**的编排模式。

### DAG 引擎与 BSP

Graph 编译后由 Executor 执行，提供两套引擎：

```
                  StateGraph (构建)
                       │
                       ▼ Compile()
                    Graph (编译后)
                       │
                       ▼ GraphAgent.New()
                  GraphAgent (Agent 接口)
                       │
                       ▼ Runner.Run()
                    Executor
                   ┌───┴───┐
                   │       │
               BSP 引擎  DAG 引擎
```

| 引擎 | 调度模型 | 适用场景 | 选择建议 |
|------|---------|---------|---------|
| **BSP**（默认） | 确定性超步（Superstep）：按"层"推进，同一超步内节点并行，跨超步等待全部完成 | 有分支汇聚、需确定性结果顺序 | 不确定就用 BSP（安全） |
| **DAG**（可选） | 急切执行：按依赖就绪调度，无 barrier 等待 | 纯流水线（无分支汇聚），延迟更低 | 确认无并行汇聚时用 DAG（性能） |

BSP 超步模型示意：

```
Superstep 1:  [nodeA] [nodeB]  (并行)
                │       │
Superstep 2:  [nodeC] [nodeD]  (并行，等待 A+B 完成)
                │       │
Superstep 3:  [nodeE]          (汇聚)
```

BSP 执行器核心结构：

```go
// graph/executor/bsp_executor.go
type BSPExecutor struct {
    plan        *ExecutionPlan
    maxSteps    int
    stepTimeout time.Duration
}
```

每个超步的执行流程：`GetNextNodes(state)` → 并行执行节点 → 通过 `schema.Reduce` 合并结果到共享 State → 发送 State 变更事件。

**为什么超步模型？**

- 并行分支节点的结果通过 Reducer 合并到共享 State，必须等待全部完成才能继续。
- 避免竞态条件：下游节点看到的是稳定的上游结果。
- 确定性：相同输入 → 相同执行顺序（超步间确定，超步内无顺序保证）。

### 中断与 Checkpoint 机制

**Checkpoint** 是 Graph 执行状态的快照，支撑时间旅行、中断恢复、调试回放。

```go
type Checkpoint struct {
    ID         string         // 检查点 ID
    ParentID   string         // 父检查点（构建 lineage）
    State      State          // 当前 State
    NextNodes  []string       // 下一步待执行节点
    Interrupts []Interrupt    // 当前中断列表
    Metadata   map[string]any // 附加信息
    CreatedAt  time.Time
}
```

`ParentID` 构建 lineage 链，支持从任意 checkpoint 恢复执行。

**存储后端**：

| 后端 | 创建方式 | 用途 |
|------|----------|------|
| InMemory | `inmemory.NewSaver()` | 开发 / 测试 |
| SQLite | `sqlite.NewSaver(path)` | 单机持久化 |
| Redis | `redis.NewSaver(addr)` | 分布式 |

通过 `graph.WithCheckpointSaver(saver)` 在 Compile 时注入。

**三种中断方式**：

| 方式 | 触发层 | 用途 |
|------|--------|------|
| 编程式中断（`graph.NewInterruptError(msg)`） | 节点内 | 业务逻辑判断需人工介入 |
| 静态中断点（`WithNodeInterruptBefore/After`） | 编译时 | 调试用，强制在节点前后暂停 |
| 外部中断（`ManagedRunner.Cancel(requestID)`） | Runner 层 | 运行时取消 |

**中断恢复流程**：

```
[执行到中断点]
  ↓
[保存 Checkpoint] → channel 发出 interrupt event → channel 关闭
  ↓（等待外部输入）
[下次 Run 时]
  ↓ agent.WithResume(true)
[从 Checkpoint 恢复 State]
  ↓
[从中断点继续执行]
```

**时间旅行**：`ListCheckpoints` → `GetState(checkpointID)` → `UpdateState(modifiedState)`（编辑后重新执行）。

**嵌套中断传播**：子 GraphAgent 中断时父 Graph 也中断——中断向上传播。父 Graph 保存的 Checkpoint 含子 Graph checkpoint 引用，恢复时子 Graph 先恢复，父 Graph 再继续。AgentNode 中子 LLMAgent 调用外部工具（pending）也会触发父 Graph 中断。

### 设计哲学

**1. 为什么用图工作流而非链式编排？**
链式编排（ChainAgent）缺少条件分支——无法表达"如果 LLM 说 APPROVED 走 A 路径，说 DENIED 走 B 路径"。图工作流带来：条件路由（LLM 输出决定路径）、并行分支（多路分析后汇聚）、循环（cycle edges 迭代改进）。

**2. State 的不可变性设计**
节点不直接修改全局 State，而是返回 delta，由 BSP 执行器按 Reducer 合并。这保证了：并发安全（多 goroutine 读同一个 State 不修改）、可追溯（每个超步的 State 都是确定性的）、可重放（Checkpoint 机制的基础）。

**3. Reducer 的必要性**
并发分支可能向同一个 State key 写入。Reducer 定义"如何合并"——消息用 append，计数器用 add，配置用 override。没有 Reducer 并行分支会互相覆盖；这是 `parallel`/`diamond`/`fanout`/`mapreduce` 都能正确汇聚的根本原因。

**4. 为什么需要两个引擎（BSP + DAG）？**
BSP（默认）= 确定性超步，适合有分支汇聚的场景；DAG（可选）= 急切执行，适合纯流水线，延迟更低。选择建议：不确定就用 BSP（安全），确认无并行汇聚时用 DAG（性能）。

**5. Command vs ConditionalEdge**
`ConditionalEdge`：路由逻辑在边定义中（编译时确定路由 map），可见可追溯，推荐。`Command`：路由逻辑在节点内部（运行时完全动态），更灵活但更难可视化。

**6. GraphAgent 的三个关键扩展点**
Checkpoint（状态持久化与恢复）、Retry（节点级容错）、EventEmitter（可观测的中间状态）。

### 配置速查

**Compile Options**（`StateGraph.Compile()`）：

| Option | 作用 |
|--------|------|
| `graph.WithCheckpointSaver(saver)` | 注入 Checkpoint 存储后端 |
| `graph.WithStreamMode(StreamModeValues / Updates / Debug)` | 控制 Event 中携带的信息量（见 [`graph-streaming-io.md`](./graph-streaming-io.md)） |

**LLM Node Options**（`AddLLMNode`）：

| Option | 作用 |
|--------|------|
| `graph.WithLLMNodeInstruction(s)` | 设定系统提示词 |
| `graph.WithLLMNodeTools(tools)` | 绑定工具集（配合 `AddToolsConditionalEdges`） |
| `graph.WithLLMNodeGenerationConfig(cfg)` | 生成参数（temperature / max_tokens 等） |

**Subgraph Node Options**（`AddSubgraphNode`）：

| Option | 作用 |
|--------|------|
| `graph.WithSubAgent(agent)` | 委托的目标子 GraphAgent |
| `graph.WithSubgraphInputFromLastResponse()` | 从 last_response 提取子图输入 |

**Node Options**（`AddNode`）：

| Option | 作用 |
|--------|------|
| `graph.WithNodeInterruptBefore(true)` | 节点执行前中断（调试用） |
| `graph.WithNodeInterruptAfter(true)` | 节点执行后中断（调试用） |
| `graph.WithNodeRetryPolicy(policy)` | 节点重试策略 |
| `graph.WithNodeCacheKey(fn)` | 节点结果缓存键（相同输入跳过执行） |

**RetryPolicy**（配合 `WithNodeRetryPolicy`）：

```go
type RetryPolicy struct {
    MaxAttempts     int
    InitialInterval time.Duration
    BackoffFactor   float64
    MaxInterval     time.Duration
    Jitter          bool
    RetryOn         func(ctx context.Context, info *RetryInfo) (bool, error)
}
```

**Command**（节点内动态路由）：

```go
type Command struct {
    Update graph.State    // 要合并的 State delta
    GoTo   string         // 目标节点 ID（单跳）
    GoTo   []string       // 扇出：并行执行多个节点
}
```

**EventEmitter**（节点内广播，通过 `graph.GetEventEmitter(state)` 获取）：

```go
type EventEmitter interface {
    Emit(evt *event.Event) error
    EmitCustom(eventType string, payload any) error
    EmitProgress(progress float64, message string) error
    EmitText(text string) error
    Context() context.Context
}
```

**Resume**（中断后恢复执行）：

| API | 作用 |
|-----|------|
| `agent.WithResume(true)` | `Runner.Run` 时启用 Resume 模式，从 Checkpoint 恢复 |

**Checkpoint 管理 API**：

| API | 作用 |
|-----|------|
| `g.ListCheckpoints(ctx, config)` | 列出历史 Checkpoint |
| `g.GetState(ctx, config, checkpointID)` | 获取指定 Checkpoint 的 State |
| `g.UpdateState(ctx, config, modifiedState, checkpointID?)` | 修改 State（编辑后继续） |

## 学习路径建议

按依赖关系分四步，每步看完再进入下一步：

1. **先打基础（拓扑）** → [`graph-topology.md`](./graph-topology.md)
   掌握 `StateGraph` + 节点 + 边 + Reducer 的组合，跑通 basic/diamond/parallel/multiends/fanout/join_edge/mapreduce。这是所有后续主题的前提。

2. **再懂执行（引擎）** → [`graph-execution.md`](./graph-execution.md)
   理解 BSP vs DAG 引擎差异、执行轨迹、节点缓存。搞清楚"为什么同一张图换引擎性能差很多"。

3. **按需深入三大专题**
   - 容错与人工介入 → [`graph-interrupt.md`](./graph-interrupt.md)（中断/检查点/时间旅行/重试）
   - 子流程与多 Agent → [`graph-subagent.md`](./graph-subagent.md)（subgraph/AgentNode/A2A）
   - 流式与 IO → [`graph-streaming-io.md`](./graph-streaming-io.md)（stream_mode/io 约定）

4. **最后看高级特性** → [`graph-advanced.md`](./graph-advanced.md)
   可视化、回调、错误处理、ReAct、多轮、各类 oneshot/placeholder 约定——生产化必备。

> **最小学习闭环**：`basic` → `diamond` → `join_edge` → `mapreduce`，约 1 小时即可掌握 80% 的常用拓扑。

## 总结

Graph 是 tRPC-Agent-Go 中**最强大的编排能力**，它把 AI Agent 从"单次 LLM 调用"提升到"多步骤、有状态、可中断、可并发"的工作流。核心设计理念：

1. **状态驱动**——StateSchema + Reducer 保证并发安全的状态合并
2. **灵活路由**——静态边、条件边、工具条件边、命名端点、动态 `[]*Command` 五套原语覆盖所有分支需求
3. **可中断/可恢复**——Checkpoint + Interrupt 支持 HITL 和容错
4. **可扩展引擎**——BSP 与 DAG 适配不同并发场景
5. **可组合**——Subgraph 和 AgentNode 支持层次化嵌套

从 [拓扑基础](./graph-topology.md) 开始，逐步掌握从简单流程到复杂分布式工作流的完整技能栈。
