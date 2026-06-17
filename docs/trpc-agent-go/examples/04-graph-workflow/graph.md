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
