# Graph 工作流 - 构建复杂 AI Agent 的有向图引擎

## 概述

tRPC-Agent-Go 的 `graph` 包提供了一个功能完备的有向图执行引擎，用于编排多步骤、多分支的 AI 工作流。本目录包含 50+ 个子示例，覆盖了从基础线性流程到高级中断恢复、DAG 并行执行、MapReduce 分治、子图嵌套等核心模式。本文将系统性地介绍这些模式，帮助开发者根据实际场景选择合适的图编排策略。

## 核心概念

### StateGraph 与 State

Graph 的核心是 `StateGraph`——一个有状态的有向图。每个节点接收 `graph.State`（本质是 `map[string]any`），执行逻辑后返回状态更新。框架通过 `StateSchema` 定义字段类型和合并策略（Reducer），保证并发场景下状态的一致性。

```go
schema := graph.NewStateSchema()
schema.AddField("counter", graph.StateField{
    Type:    reflect.TypeOf(0),
    Reducer: graph.DefaultReducer,
    Default: func() any { return 0 },
})
```

### 节点类型

| 类型 | 创建方式 | 说明 |
|------|----------|------|
| Function Node | `AddNode(name, func)` | 普通 Go 函数节点 |
| LLM Node | `AddLLMNode(name, model, prompt, tools)` | 大模型调用节点，自动管理消息上下文 |
| Tools Node | `AddToolsNode(name, tools)` | 工具执行节点，处理 LLM 的 tool_calls |
| Subgraph Node | `AddSubgraphNode(name, opts...)` | 子图节点，委托给子 GraphAgent 执行 |

### 边与路由

- **静态边**：`AddEdge("A", "B")` 固定流转
- **条件边**：`AddConditionalEdges("A", condFunc, map)` 根据状态动态选择下游
- **工具条件边**：`AddToolsConditionalEdges("llm", "tools", "next")` LLM 有 tool_calls 时走 tools 节点，否则走 next

## 模式解析

### 1. 基础工作流（basic）

`basic/` 示例构建了一个文档处理流水线：预处理 → LLM 分析复杂度 → 条件路由 → 摘要/增强 → 格式化输出。

```go
stateGraph.
    AddNode("preprocess", w.preprocessDocument).
    AddLLMNode("analyze", modelInstance, systemPrompt, tools).
    AddToolsNode("tools", tools).
    AddNode("route_complexity", w.routeComplexity).
    AddLLMNode("summarize", modelInstance, summarizePrompt, nil).
    AddLLMNode("enhance", modelInstance, enhancePrompt, nil).
    AddNode("format_output", w.formatOutput).
    SetEntryPoint("preprocess").
    SetFinishPoint("format_output")

stateGraph.AddConditionalEdges("route_complexity", w.complexityCondition, map[string]string{
    "simple":   "enhance",
    "moderate": "enhance",
    "complex":  "summarize",
})
```

关键特性：
- **LLM + Tools 循环**：`AddToolsConditionalEdges` 实现 LLM 自主决定是否调用工具
- **条件路由**：根据文档复杂度动态选择处理分支
- **节点回调**：`WithNodeCallbacks` 注册 BeforeNode/AfterNode/OnError 回调，用于性能监控和错误追踪

### 2. 中断与恢复（interrupt）

`interrupt/` 示例展示了 Human-in-the-Loop（HITL）模式：工作流在特定节点暂停，等待用户输入后恢复执行。

```go
// 在节点内发起中断
resumeValue, err := graph.Interrupt(ctx, state, nodeRequestApproval, interruptPayload)

// 恢复执行时传入用户决策
cmd := &graph.Command{
    ResumeMap: map[string]any{taskID: "yes"},
}
```

中断机制依赖 Checkpoint 系统，支持多种存储后端：
- `checkpointinmemory.NewSaver()` — 内存存储
- `checkpointsqlite.NewSaver(db)` — SQLite 持久化
- `checkpointredis.NewSaver(...)` — Redis 分布式存储

示例支持多个中断点串联（first approval → second approval），每次恢复只需提供当前中断点的用户输入。

### 3. Checkpoint 管理（checkpoint）

`checkpoint/` 示例聚焦于检查点的全生命周期管理：

- **保存与恢复**：工作流执行过程自动保存检查点，可从任意检查点恢复执行
- **分支（Fork）**：`executor.Fork(ctx, config)` 从已有检查点创建分支，探索不同执行路径
- **历史查看**：`manager.ListCheckpoints` 和 `GetCheckpointTree` 展示完整的执行历史和分支树
- **时间旅行**：回退到历史检查点重新执行（参见 `time_travel_edit_state/`）

### 4. DAG 引擎（dag_engine）

`dag_engine/` 对比了两种执行引擎：

```go
// BSP（Bulk Synchronous Parallel）：按层级同步执行
exec, _ := graph.NewExecutor(g, graph.WithExecutionEngine(graph.ExecutionEngineBSP))

// DAG：真正的依赖驱动调度，节点就绪即执行
exec, _ := graph.NewExecutor(g, graph.WithExecutionEngine(graph.ExecutionEngineDAG))
```

示例构建了 split → {slow_a(800ms), fast_b(200ms), mid_c(400ms)}，fast_b → fast_b_next(120ms) 的拓扑。DAG 引擎下 fast_b_next 在 fast_b 完成后立即执行，无需等待 slow_a 完成。BSP 模式下则需等待同层全部完成。

### 5. MapReduce（mapreduce）

`mapreduce/` 实现了文档问答的分治流程：

```
load_and_chunk → retrieve(Top-K) → create_map_tasks → [map_summarize × K] → collect_partial → prepare_reduce → reduce_join → finish
```

核心技术点：
- **Fan-out**：`nodeCreateMapTasks` 返回 `[]*graph.Command`，每个 Command 指定不同的 `GoTo` 目标和独立的状态更新，实现并行任务分发
- **Barrier**：`collect_partial` 后的条件边检查 `partial_summaries` 数量是否达到 `selected_count`，实现同步栅栏
- **自定义 Reducer**：`appendMapSliceReducer` 处理 `[]map[string]any` 类型的状态合并

### 6. 子图嵌套（subgraph）

`subgraph/` 展示了父子图的组合模式：

```go
// 子图：LLM + Tools 的标准 Agent 循环
childGA, _ := graphagent.New("assistant", childGraph)

// 父图：parse_input → assistant(subgraph) → collect
sg.AddSubgraphNode("assistant",
    graph.WithSubgraphInputMapper(inputMapper),
    graph.WithSubgraphOutputMapper(outputMapper),
    graph.WithSubgraphIsolatedMessages(true),
    graph.WithSubgraphEventScope("assistant"),
)

// 注册子 Agent
parentGA, _ := graphagent.New("parent", parentGraph,
    graphagent.WithSubAgents([]agent.Agent{childGA}),
)
```

子图支持：
- **输入映射**：从父状态中选择性提取字段传入子图
- **输出映射**：将子图结果映射回父状态
- **消息隔离**：子图不继承父图的会话历史
- **事件作用域**：子图事件带前缀，便于 UI 层区分来源

### 7. 可视化（visualization）

`visualization/` 将 StateGraph 导出为 Graphviz DOT 格式或 PNG 图片：

```go
dotContent := g.DOT(
    graph.WithRankDir(graph.RankDirLR),
    graph.WithGraphLabel("Visualization Demo"),
)
g.RenderImage(ctx, graph.ImageFormatPNG, "output.png", ...)
```

支持节点类型（Function/LLM/Tool）的差异化样式和虚线标注的动态目标节点。

### 8. 其他重要示例

| 示例目录 | 核心功能 |
|----------|----------|
| `parallel/` | 并行节点执行 |
| `fanout/` | 扇出分发 |
| `diamond/` | 菱形依赖汇聚 |
| `error_handling/` | 节点错误处理与恢复 |
| `retry/` | 节点级重试策略 |
| `stream_mode/` | 流式输出模式 |
| `react/` | ReAct 推理-行动循环 |
| `multiturn/` | 多轮对话状态管理 |
| `nested_interrupt/` | 子图内部中断传播到父图 |
| `a2a_agent/` | A2A（Agent-to-Agent）协议集成 |
| `nodecache/` | 节点结果缓存 |
| `execution_trace/` | 执行轨迹追踪 |
| `per_node_callbacks/` | 节点级回调注册 |
| `concurrency_race/` | 并发竞态场景演示 |

## 运行方式

大多数示例可直接运行（纯函数节点不需要 API Key）：

```bash
# DAG 引擎对比（无需 API Key）
cd examples/graph/dag_engine
go run main.go -engine both

# 检查点管理（无需 API Key）
cd examples/graph/checkpoint
go run main.go -storage memory

# 文档处理工作流（需要 API Key）
export OPENAI_API_KEY="your-key"
cd examples/graph/basic
go run main.go -model deepseek-v4-flash

# MapReduce 文档问答（需要 API Key）
cd examples/graph/mapreduce
go run main.go -file ./sample.txt
```

## 总结

Graph 包是 tRPC-Agent-Go 框架中最强大的编排能力，它将 AI Agent 的行为从"单次 LLM 调用"提升到"多步骤有状态工作流"。核心设计理念包括：

1. **状态驱动**：StateSchema + Reducer 保证并发安全的状态管理
2. **灵活路由**：静态边、条件边、工具条件边满足不同分支需求
3. **可中断/可恢复**：Checkpoint + Interrupt 机制支持 HITL 和容错恢复
4. **可扩展引擎**：BSP 与 DAG 两种执行引擎适配不同并发需求
5. **可组合**：Subgraph 和 AgentNode 支持层次化的工作流嵌套

建议学习路径：basic → checkpoint → interrupt → dag_engine → mapreduce → subgraph，逐步掌握从简单流程到复杂分布式工作流的完整技能栈。
