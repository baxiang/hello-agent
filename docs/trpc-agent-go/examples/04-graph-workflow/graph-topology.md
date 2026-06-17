# Graph 基础拓扑与编排模式 - 线性/分支/汇聚/MapReduce

> **源码路径**：[`trpc-agent-go/examples/graph/`](../../../../trpc-agent-go/examples/graph)（本篇覆盖 basic/diamond/parallel/multiends/fanout/join_edge/mapreduce）
> **主题**：图拓扑 · **难度**：入门→进阶

## 概述

Graph 引擎的强大来自**拓扑形状**——节点之间的连边方式决定了数据如何流动、分支、并发与汇聚。本篇集中讲解 7 种最基础的拓扑与编排模式，它们是构建一切复杂工作流的"积木"：

| 模式 | 子示例 | 一句话 |
|------|--------|--------|
| 线性 + 条件路由 | `basic` | 单链流水线，按复杂度分流到不同 LLM 节点 |
| 菱形（fan-out + 汇聚栅栏） | `diamond` | 一分二再合一，靠条件边做 barrier |
| 静态并行分支 | `parallel` | 一个节点连出多条边，多分支并行后聚合 |
| 节点级命名端点 | `multiends` | `Command.GoTo` + `WithEndsMap` 符号化分支 |
| 动态扇出（`[]*Command`） | `fanout` | 运行时决定任务数，同一 worker 并发多份 |
| Join 边（wait-all 汇聚） | `join_edge` | `AddJoinEdge` 声明式 wait-all fan-in |
| MapReduce 分治 | `mapreduce` | 切片 → 检索 → 并行摘要 → 归约合成 |

掌握这 7 种形状后，再去看执行引擎、中断恢复、子图嵌套等高级主题就有了共同语言。本文只聚焦"图怎么连"，执行/中断/子图细节见姊妹篇 [`graph-execution.md`](./graph-execution.md) / [`graph-interrupt.md`](./graph-interrupt.md) / [`graph-subagent.md`](./graph-subagent.md)。

## 核心概念

所有拓扑都建立在同一套原语之上，先统一认识：

### StateGraph 与 StateSchema

`StateGraph` 是有状态的有向图。每个节点接收 `graph.State`（本质 `map[string]any`），执行后返回一个**状态增量**（也是 `graph.State`）。框架按 `StateSchema` 中每个字段的 `Reducer` 把增量合并进全局状态——这是并发分支能安全汇聚的关键。

```go
schema := graph.NewStateSchema().
    AddField("results", graph.StateField{
        Type:    reflect.TypeOf([]string{}),
        Reducer: graph.StringSliceReducer,   // 多分支结果自动 append
        Default: func() any { return []string{} },
    })
sg := graph.NewStateGraph(schema)
```

内置 Reducer：`DefaultReducer`（直接覆盖）、`StringSliceReducer`（字符串切片 append）、`MessagesReducer`（消息列表，`MessagesStateSchema()` 默认携带）。复杂场景可写自定义 reducer（见 `fanout/` 的 `intSumReducer`、`mapreduce/` 的 `appendMapSliceReducer`）。

### 节点类型

| 类型 | 创建方式 | 说明 |
|------|----------|------|
| Function Node | `AddNode(name, func)` | 普通 Go 函数节点 |
| LLM Node | `AddLLMNode(name, model, prompt, tools)` | 大模型调用节点，自动管理消息上下文 |
| Tools Node | `AddToolsNode(name, tools)` | 执行 LLM 的 tool_calls |
| Subgraph Node | `AddSubgraphNode(name, opts...)` | 子图节点（详见 [`graph-subagent.md`](./graph-subagent.md)） |

### 边与路由

| 原语 | 作用 |
|------|------|
| `SetEntryPoint("A")` / `SetFinishPoint("Z")` | 声明入口与唯一终点 |
| `AddEdge("A", "B")` | 静态边；同源多边 = 并行扇出 |
| `AddConditionalEdges("A", condFunc, map)` | 条件边：`condFunc` 返回 key，查 map 得目标 |
| `AddToolsConditionalEdges("llm", "tools", "next")` | LLM 有 tool_calls 走 `tools`，否则走 `next` |
| `AddJoinEdge([]string{"a","b"}, "join")` | 声明式 wait-all 汇聚 |
| `WithEndsMap(...)` + `Command.GoTo` | 节点级命名端点，符号化分支 |
| 返回 `[]*Command` | 动态扇出（类 LangGraph `Send`） |

节点返回的特殊值也影响路由：`*graph.Command{GoTo: "X"}` 显式跳转；`[]*graph.Command` 一次性派发多个并行任务；条件函数返回 `graph.End` 表示"暂时无处可去"（用作 barrier）。

---

## basic（线性文档处理流水线）

> 源码：[`trpc-agent-go/examples/graph/basic/`](../../../../trpc-agent-go/examples/graph/basic)

一句话：一条**带条件路由的线性流水线**——预处理 → LLM 分析复杂度（带工具循环）→ 按复杂度分流到 summarize/enhance → 格式化输出。是理解 LLM 节点 + 工具循环 + 条件边三者配合的最佳入门。

### 拓扑示意

```
              preprocess
                  ↓
        analyze (LLM) ⇄ tools     ← AddToolsConditionalEdges 循环
                  ↓
          route_complexity
            ↙ (cond) ↘
   simple/moderate    complex
        ↓               ↓
     enhance        summarize     ← 两条 LLM 分支
        ↘             ↙
          format_output            ← 唯一终点
```

### 关键代码

声明节点 + 入口/终点（`createDocumentProcessingGraph`）：

```go
schema := graph.MessagesStateSchema()
modelInstance := openai.New(*modelName)
stateGraph := graph.NewStateGraph(schema).WithNodeCallbacks(callbacks)
tools := map[string]tool.Tool{"analyze_complexity": complexityTool}

stateGraph.
    AddNode("preprocess", w.preprocessDocument).
    AddLLMNode("analyze", modelInstance, analyzePrompt, tools).
    AddToolsNode("tools", tools).
    AddNode("route_complexity", w.routeComplexity).
    AddLLMNode("summarize", modelInstance, summarizePrompt, map[string]tool.Tool{}).
    AddLLMNode("enhance", modelInstance, enhancePrompt, map[string]tool.Tool{}).
    AddNode("format_output", w.formatOutput).
    SetEntryPoint("preprocess").
    SetFinishPoint("format_output")
```

工具循环 + 条件分流（注意 `tools → analyze` 的回边构成了 LLM↔tools 的小循环）：

```go
stateGraph.AddEdge("preprocess", "analyze")
stateGraph.AddToolsConditionalEdges("analyze", "tools", "route_complexity")
stateGraph.AddEdge("tools", "analyze")              // 工具执行完回到 LLM

stateGraph.AddConditionalEdges("route_complexity", w.complexityCondition, map[string]string{
    "simple":   "enhance",
    "moderate": "enhance",   // moderate 也走 enhance
    "complex":  "summarize",
})
stateGraph.AddEdge("enhance", "format_output")
stateGraph.AddEdge("summarize", "format_output")

return stateGraph.Compile()
```

条件函数返回的是 map 的 key（`"simple"/"moderate"/"complex"`），由 `inferComplexityLevel` 综合"工具结果 / LLM 文本 / 词数启发式"三路得出。本例还演示了 `WithNodeCallbacks` 注册 `BeforeNode/AfterNode/OnNodeError`，把执行耗时和历史写进 state，供 `format_output` 打印性能摘要。

### 运行命令与预期输出

```bash
cd examples/graph/basic
export OPENAI_API_KEY="your-api-key"   # 模型相关，必需
go run main.go                          # 默认 deepseek-v4-flash
go run main.go -model gpt-4o -verbose   # 详细事件
```

交互式输入文档后输出（节选）：

```
📄 Document: <粘贴一段文本>
🔄 Stage 1 completed
🤖 LLM Streaming: moderate
🔄 Stage 2 completed
...
╔══════════════════════════════════════════════════════════════════╗
║                    DOCUMENT PROCESSING RESULTS                   ║
╚══════════════════════════════════════════════════════════════════╝
<enhance 或 summarize 的输出>

📊 Processing Statistics:
   • Complexity Level: moderate
   • Word Count: 87
   • Completed At: 2026-06-17 10:00:00
🚀 Execution Flow:
   1. ✅ preprocess (function) - 1.2ms
   2. ✅ analyze (llm) - 2.3s
   ...
```

---

## diamond（菱形 fan-out + 汇聚栅栏）

> 源码：[`trpc-agent-go/examples/graph/diamond/`](../../../../trpc-agent-go/examples/graph/diamond)

一句话：经典的**一分二、二合一**菱形拓扑。核心难点是汇聚节点 `aggregator` 必须等两个 analyzer 都完成才放行——这里用条件边返回 `graph.End` 充当 **barrier**，配合 Checkpoint 演示 resume 时的 `versions_seen` 去重。

### 拓扑示意

```
        splitter
        /      \
   analyzer1  analyzer2     ← 两个 analyzer 睡眠时长不同(100ms/150ms)
        \      /
       aggregator             ← barrier：results<2 时返回 End，不前进
           |
         final
```

### 关键代码

用 `StringSliceReducer` 让两个 analyzer 的结果自动 append 到同一字段：

```go
schema.AddField(stateKeyResults, graph.StateField{
    Type:    reflect.TypeOf([]string{}),
    Reducer: graph.StringSliceReducer,   // 两个分支结果自动合并
    Default: func() any { return []string{} },
})

sg.AddNode(nodeSplitter, w.splitterNode).
    AddNode(nodeAnalyzer1, w.analyzer1Node).
    AddNode(nodeAnalyzer2, w.analyzer2Node).
    AddNode(nodeAggregator, w.aggregatorNode).
    AddNode(nodeFinal, w.finalNode).
    SetEntryPoint(nodeSplitter).SetFinishPoint(nodeFinal)

sg.AddEdge(nodeSplitter, nodeAnalyzer1)
sg.AddEdge(nodeSplitter, nodeAnalyzer2)
sg.AddEdge(nodeAnalyzer1, nodeAggregator)
sg.AddEdge(nodeAnalyzer2, nodeAggregator)
```

barrier 的精髓：aggregator 每次被触发都检查结果数，凑齐 2 个才路由到 `final`，否则返回 `graph.End`（即"本步结束、不再前进"），等待第二个 analyzer 完成后被再次触发：

```go
condition := func(ctx context.Context, state graph.State) (string, error) {
    results, _ := state[stateKeyResults].([]string)
    if len(results) >= 2 {
        return nodeFinal, nil
    }
    return graph.End, nil   // 暂不前进，等另一个分支
}
sg.AddConditionalEdges(nodeAggregator, condition, map[string]string{
    nodeFinal:  nodeFinal,
    graph.End:  graph.End,
})
```

本例还接入了 `checkpointinmemory.NewSaver()` 并通过 `graph.CfgKeyLineageID` 支持 `run/resume/list` 命令，演示 resume 时 `versions_seen` 如何避免 aggregator 被重复执行。

### 运行命令与预期输出

```bash
cd examples/graph/diamond
go run .                  # 纯函数节点，无需 API Key
> run demo hello
```

```
🚀 Starting workflow with input: hello (lineage=demo)
🔄 [1] SPLITTER: Processing input: hello
🔬 [1] ANALYZER2: Processing: A2-hello
🔬 [1] ANALYZER1: Processing: A1-hello
⚠️  [1] AGGREGATOR: Processing 2 results
   - Result 1: Result1[A1-hello]
   - Result 2: Result2[A2-hello]

📊 [1] FINAL: Workflow Complete
🔍 Execution Analysis:
✅ splitter: 1 execution(s)
✅ analyzer1: 1 execution(s)
✅ analyzer2: 1 execution(s)
✅ aggregator: 1 execution(s)
✅ final: 1 execution(s)
⏱️  Execution time: ~150ms
```

> **注**：`diamond` 用条件边手写 barrier 是"原始"写法；trpc-agent-go 也提供了声明式的 `AddJoinEdge`（见下方 [`join_edge`](#join_edge等待-all-汇聚)）。

---

## parallel（静态多边并行分支）

> 源码：[`trpc-agent-go/examples/graph/parallel/`](../../../../trpc-agent-go/examples/graph/parallel)

一句话：演示**同一个节点连出多条 `AddEdge` = 并行扇出**。`route_to_parallel` 一次性连到 summarize/enhance/classify 三个 LLM 节点，三者并发执行后汇聚到 `aggregate`。

### 拓扑示意

```
preprocess → analyze(LLM) ⇄ tools → route_to_parallel
                                          ↓
                    ┌─────────────────────┼─────────────────────┐
                    ↓                     ↓                     ↓
                summarize             enhance              classify   ← 三路并行
                    ↓                     ↓                     ↓
                    └─────────────────────┼─────────────────────┘
                                          ↓
                                      aggregate → format_output
```

### 关键代码

并行来自"同一源、多条 `AddEdge`"这一最朴素的事实：

```go
// 同一个节点连出三条边 → 三路并行
stateGraph.AddEdge("route_to_parallel", "summarize")
stateGraph.AddEdge("route_to_parallel", "enhance")
stateGraph.AddEdge("route_to_parallel", "classify")

// 三路再各自连到 aggregate → 汇聚
stateGraph.AddEdge("summarize", "aggregate")
stateGraph.AddEdge("enhance",   "aggregate")
stateGraph.AddEdge("classify",  "aggregate")
stateGraph.AddEdge("aggregate", "format_output")
```

汇聚节点通过 `graph.StateKeyNodeResponses`（框架维护的"每个节点文本输出"map）取出三路结果：

```go
func (w *parallelWorkflow) aggregateResults(ctx context.Context, state graph.State) (any, error) {
    results, _ := state[graph.StateKeyNodeResponses].(map[string]any)
    count := 0
    for _, k := range []string{"summarize", "enhance", "classify"} {
        if _, ok := results[k]; ok { count++ }
    }
    return graph.State{
        graph.StateKeyLastResponse:   fmt.Sprintf("Parallel execution completed: %d results aggregated", count),
        graph.StateKeyNodeResponses:  results,
    }, nil
}
```

### 运行命令与预期输出

```bash
cd examples/graph/parallel
export OPENAI_API_KEY="your-api-key"
go run main.go                            # 默认开启 fake streaming
go run main.go -stream=false              # 关闭假流式
go run main.go -stream-chunk 12 -stream-delay 40ms   # 调整假流式手感
```

```
📄 Text: This is a sample text for parallel processing
🚀 summarize: Starting
🚀 enhance: Starting
🚀 classify: Starting          ← 三个并行节点同时启动
✅ summarize: Completed
✅ enhance: Completed
✅ classify: Completed
🔄 All parallel nodes completed
📋 Parallel Execution Results:
🔹 Summarize: ...
🔹 Enhance: ...
🔹 Classify: ...
```

---

## multiends（节点级命名端点）

> 源码：[`trpc-agent-go/examples/graph/multiends/`](../../../../trpc-agent-go/examples/graph/multiends)

一句话：用 `WithEndsMap` 给节点声明一组**符号化分支标签**，节点返回 `&graph.Command{GoTo: "approve"}` 即可路由——目标在编译期校验，比字符串拼条件边更安全、更可读。

### 拓扑示意

```
start → decide --approve(symbol)--> approved → final
              \
               --reject(symbol)--> rejected  → final

decide 节点声明 ends: {"approve": "approved", "reject": "rejected"}
返回 &Command{GoTo: "approve"} 或 "reject"，由 ends map 解析为真实目标
```

### 关键代码

注册节点时声明它的命名端点（注意 `decide` 没有任何 `AddEdge` 出边，路由完全靠 `Command.GoTo` + ends）：

```go
sg.AddNode(nodeStart, startNode)
sg.AddNode(nodeDecide, decideNode, graph.WithEndsMap(map[string]string{
    "approve": nodeApproved,
    "reject":  nodeRejected,
}))
sg.AddNode(nodeApproved, approvedNode)
sg.AddNode(nodeRejected, rejectedNode)
sg.AddNode(nodeFinal, finalNode)

sg.SetEntryPoint(nodeStart).SetFinishPoint(nodeFinal)
sg.AddEdge(nodeStart, nodeDecide)
sg.AddEdge(nodeApproved, nodeFinal)
sg.AddEdge(nodeRejected, nodeFinal)
```

节点返回符号化分支（无需知道真实目标节点 ID）：

```go
func decideNode(_ context.Context, state graph.State) (any, error) {
    v, _ := state[keyDecision].(string)
    switch v {
    case "approve":
        return &graph.Command{GoTo: "approve"}, nil
    case "reject":
        return &graph.Command{GoTo: "reject"}, nil
    default:
        return &graph.Command{GoTo: "reject"}, nil
    }
}
```

`Compile()` 会在编译期校验 ends map 的每个 value 都是已注册节点或 `graph.End`，拼错立即报错。

### 运行命令与预期输出

```bash
cd examples/graph/multiends
go run .                 # 纯函数节点，无需 API Key；默认 approve
go run . -choice=reject
```

```
🚀 Multi-Ends Branching Example
✅ Finished. path=approved, result=completed via approved
```

---

## fanout（`[]*Command` 动态扇出）

> 源码：[`trpc-agent-go/examples/graph/fanout/`](../../../../trpc-agent-go/examples/graph/fanout)

一句话：节点返回 `[]*graph.Command` 即可**在运行时动态派发 N 个并行任务**到同一个 worker 节点，每个任务带独立的 `Update` 状态快照——类似 LangGraph 的 `Send`。任务数由 LLM 规划节点决定。

### 拓扑示意

```
analyze_input → plan_tasks(LLM) ⇄ tools → create_fanout
                                                  │ 返回 []*Command (N 个)
                          ┌───────────────────────┼───────────────────────┐
                          ↓ (GoTo)                ↓ (GoTo)                ↓ (GoTo)
                      process_task            process_task            process_task   ← 同一 worker，N 份并发
                          └───────────────────────┼───────────────────────┘
                                                  ↓ (reducer 合并)
                                          aggregate_results
```

### 关键代码

扇出节点解析 LLM 输出中的整数（容错处理 `**2**` 这类格式），动态生成命令：

```go
func (w *fanoutWorkflow) createFanoutTasks(ctx context.Context, state graph.State) (any, error) {
    var numTasks int
    if lastResponse, ok := state[graph.StateKeyLastResponse].(string); ok {
        re := regexp.MustCompile(`\d+`)
        matches := re.FindAllString(lastResponse, -1)
        for i := len(matches) - 1; i >= 0; i-- {
            if n, _ := strconv.Atoi(matches[i]); n >= 1 && n <= 5 { numTasks = n; break }
        }
    }
    if numTasks == 0 { numTasks = 3 }

    cmds := make([]*graph.Command, numTasks)
    for i := 0; i < numTasks; i++ {
        taskID := fmt.Sprintf("task-%c", 'A'+i)
        priority := []string{"high", "medium", "low"}[i%3]
        cmds[i] = &graph.Command{
            Update: graph.State{
                "task_id":               taskID,
                "priority":              priority,
                graph.StateKeyUserInput: workerPrompt,   // 每个 worker 独立输入
            },
            GoTo: "process_task",                       // 全部指向同一 worker
        }
    }
    return cmds, nil   // 返回切片 = 动态扇出
}
```

schema 用**自定义 reducer** 让并行结果安全合并回全局状态：

```go
schema := graph.MessagesStateSchema().
    AddField("results", graph.StateField{
        Type: reflect.TypeOf([]string{}), Reducer: graph.StringSliceReducer,
        Default: func() any { return []string{} },
    }).
    AddField("node_execution_history", graph.StateField{
        Type: reflect.TypeOf([]map[string]any{}), Reducer: appendMapSliceReducer, // 自定义
        Default: func() any { return []map[string]any{} },
    }).
    AddField("error_count", graph.StateField{
        Type: reflect.TypeOf(0), Reducer: intSumReducer,   // 自定义：错误数累加
        Default: func() any { return 0 },
    })
```

### 运行命令与预期输出

```bash
cd examples/graph/fanout
export OPENAI_API_KEY="your-api-key"
go run main.go
```

```
📄 Content: <粘贴内容>
🤖 LLM Streaming: 2
🧭 Planner decided to run 2 tasks
📋 Creating 2 parallel tasks...
✅ task-A (priority: high) created
✅ task-B (priority: medium) created
🔄 Executing 2 parallel tasks...
🧵 Replaying results sequentially:
[1/2] task-A (priority: high)
... worker A 输出 ...
[2/2] task-B (priority: medium)
... worker B 输出 ...
```

---

## join_edge（wait-all 汇聚）

> 源码：[`trpc-agent-go/examples/graph/join_edge/`](../../../../trpc-agent-go/examples/graph/join_edge)

一句话：`AddJoinEdge([]string{"a","b"}, "join")` 是**声明式的 wait-all fan-in**——`join` 只在 a、b 都完成后执行一次。相比 `diamond` 手写条件边 barrier，这是框架内置的更简洁写法。本例也是 7 个示例中唯一**直接用 `graph.NewExecutor` + `exec.Execute`**（不经 GraphAgent/Runner）的最小写法。

### 拓扑示意

```
      start
      /   \
     a     b      ← 并行（a 默认睡 120ms，b 睡 40ms，完成顺序不定）
      \   /
       join       ← AddJoinEdge：等 a、b 全部完成才执行
```

### 关键代码

```go
schema := graph.NewStateSchema().AddField(stateKeyOrder, graph.StateField{
    Type: reflect.TypeOf([]string{}), Reducer: graph.StringSliceReducer,
    Default: func() any { return []string{} },
})

sg := graph.NewStateGraph(schema)
sg.AddNode(nodeStart, ...)
sg.AddNode(nodeA,     func(...) { time.Sleep(sleepA); return ... })
sg.AddNode(nodeB,     func(...) { time.Sleep(sleepB); return ... })
sg.AddNode(nodeJoin,  ...)

sg.SetEntryPoint(nodeStart)
sg.AddEdge(nodeStart, nodeA)
sg.AddEdge(nodeStart, nodeB)
sg.AddJoinEdge([]string{nodeA, nodeB}, nodeJoin)   // ← 声明式 wait-all
sg.SetFinishPoint(nodeJoin)
```

不经过 GraphAgent，直接用 Executor：

```go
g, _ := buildGraph(*sleepA, *sleepB)
exec, _ := graph.NewExecutor(g)
inv := &agent.Invocation{InvocationID: "join-edge-demo"}
ch, _ := exec.Execute(context.Background(), graph.State{}, inv)
order, _ := waitForFinalOrder(ch)   // 读 done 事件的 StateDelta
fmt.Printf("Final execution order: %v\n", order)
```

### 运行命令与预期输出

```bash
cd examples/graph/join_edge
go run .                              # 纯函数节点，无需 API Key
go run . -sleep-a 200ms -sleep-b 50ms # 调整两支工作量
```

`order` 字段（`StringSliceReducer` 累积）反映执行顺序，a/b 顺序可变，但 `join` 必在最后：

```
Final execution order: [start b a join]
```

---

## mapreduce（MapReduce 文档问答）

> 源码：[`trpc-agent-go/examples/graph/mapreduce/`](../../../../trpc-agent-go/examples/graph/mapreduce)

一句话：完整的 **chunk → retrieve → 并行 map 摘要 → reduce 合成** 分治流水线。综合运用了"自定义 reducer + `[]*Command` 扇出 + 条件边 barrier + LLM 归约"四项技术，是拓扑编排的集大成示例。

### 拓扑示意

```
load_and_chunk → retrieve(Top-K 词法打分)
                      ↓
               create_map_tasks   ── 返回 []*Command (K 个)
                      ↓ GoTo
              ┌───────────────────┐  并行
              ↓ ... (K 份)        ↓
          map_summarize(LLM) ×K      ← 每块独立摘要
              ↓                     ↓
          collect_partial            ← barrier：凑齐 K 个才放行
              ↓ (cond: len>=K)
          prepare_reduce             ← 拼装 reduce prompt
              ↓
          reduce_join(LLM)           ← LLM 合成最终答案
              ↓
            finish
```

### 关键代码

扇出（与 `fanout/` 同构，但目标是为每块拼一个带问题的 prompt）：

```go
func (d *mapReduceDemo) nodeCreateMapTasks(ctx context.Context, state graph.State) (any, error) {
    question, _ := state[graph.StateKeyUserInput].(string)
    sel, _ := state[keySelected].([]map[string]any)
    cmds := make([]*graph.Command, 0, len(sel))
    for i, s := range sel {
        idx, _  := s["index"].(int)
        text, _ := s["text"].(string)
        userInput := fmt.Sprintf("Question: %s\n\nChunk #%d:\n%s", question, idx, text)
        cmds = append(cmds, &graph.Command{
            Update: graph.State{graph.StateKeyUserInput: userInput},
            GoTo:   "map_summarize",
        })
    }
    return cmds, nil
}
```

barrier（与 `diamond/` 同构，但等待数来自检索阶段写入的 `selected_count`）：

```go
cond := func(ctx context.Context, state graph.State) (string, error) {
    want, _ := state[keySelectedCount].(int)
    got := 0
    if arr, ok := state[keyPartialSummaries].([]string); ok { got = len(arr) }
    if got >= want && want > 0 {
        return "prepare_reduce", nil
    }
    return graph.End, nil   // 未凑齐，暂不前进
}
sg.AddConditionalEdges("collect_partial", cond, map[string]string{
    "prepare_reduce": "prepare_reduce",
    graph.End:        graph.End,
})
sg.AddEdge("prepare_reduce", "reduce_join")
sg.AddEdge("reduce_join", "finish")
```

检索是纯词法打分（`scoreChunk` 按问题 token 与 chunk 的重合度排序），无需向量库；切分用 `chunkText` 按定长 + overlap。

### 运行命令与预期输出

```bash
cd examples/graph/mapreduce
export OPENAI_API_KEY="your-api-key"
go run . -file ./sample.txt -top-k 4 -chunk-size 800 -overlap 100
# 提示符下输入问题：
❓ Question: What are the main concurrency patterns and caveats in Go?
```

```
🧠 Final Answer:
------------------------------------------------------------
Go 的并发以 goroutine + channel 为核心：channel 支持有缓冲/无缓冲，
select 可同时等待多个 channel 操作（fan-in/fan-out/timeout）...
同时需注意数据竞争——用 sync.Mutex/RWMutex 保护共享状态、用 context
做取消与超时、避免 goroutine 泄漏 ...
------------------------------------------------------------
```

---

## 拓扑选型对比

| 模式 | 扇出方式 | 汇聚方式 | 任务数 | 典型场景 | 是否需 API Key |
|------|----------|----------|--------|----------|----------------|
| **basic** | 无（线性） | — | 固定 | 单链流水线 + 条件分流 | 是 |
| **diamond** | 静态多边（2） | 条件边 barrier（返回 `End`） | 固定 2 | 双路分析后合并 + checkpoint/resume | 否 |
| **parallel** | 静态多边（N） | 多边汇入同一节点 | 固定 N | 多视角并行处理（摘要/增强/分类） | 是 |
| **multiends** | `Command.GoTo` + ends | 静态边汇入终点 | 互斥 1 | 审批/拒签等离散决策 | 否 |
| **fanout** | `[]*Command` | reducer 自动合并 | **运行时动态** | 同质任务批量并发（N 份 worker） | 是 |
| **join_edge** | 静态多边 | `AddJoinEdge`（声明式） | 固定 | 需要严格 wait-all 的汇聚点 | 否 |
| **mapreduce** | `[]*Command` | 条件边 barrier + LLM 归约 | 运行时动态 | 文档/数据分治问答 | 是 |

**选型决策**：
- **线性 + 偶尔分流** → `basic` 的条件边最直观
- **决策是离散枚举（approve/reject）** → `multiends`，编译期校验更安全
- **固定多视角并行** → `parallel`（静态多边即可）
- **任务数运行时才知道** → `fanout`（`[]*Command`）
- **需要"全部完成才下一步"的严格汇聚** → 优先 `join_edge`（声明式），复杂场景才手写条件 barrier（`diamond`/`mapreduce`）
- **分治问答/批量处理** → `mapreduce`（扇出 + barrier + 归约的完整范式）

## 关键要点

1. **多边即并行**：一个节点连出多条 `AddEdge`，这些目标节点就会并发执行；这是 `parallel`/`diamond`/`join_edge` 的共同基础。
2. **汇聚有三种写法**：① 多边汇入同一节点（`parallel`，依赖 reducer）；② 条件边返回 `End` 做 barrier（`diamond`/`mapreduce`）；③ 声明式 `AddJoinEdge`（`join_edge`，最省心）。
3. **路由有三套原语**：① `AddConditionalEdges`（状态驱动，字符串映射）；② `Command.GoTo` + `WithEndsMap`（符号化、编译期校验）；③ `[]*Command`（动态扇出）。
4. **Reducer 决定汇聚语义**：`StringSliceReducer` 自动 append，自定义 reducer（`intSumReducer`/`appendMapSliceReducer`）实现求和/合并——并发分支能否正确合并全靠它。
5. **barrier 的本质**：条件函数返回 `graph.End` = "本轮不前进"，等其它分支就绪后被再次触发；写 barrier 时务必有一个"凑齐条件"（如 `len >= N`）。
6. **拓扑可以脱离模型先验证**：`diamond`/`multiends`/`join_edge` 全是纯函数节点，无需 API Key，适合先跑通形状再接 LLM。

## 总结

本篇把 7 种基础拓扑一次讲透：**线性 + 条件路由（basic）、菱形栅栏（diamond）、静态并行（parallel）、命名端点（multiends）、动态扇出（fanout）、声明式汇聚（join_edge）、分治归约（mapreduce）**。它们覆盖了"图怎么连"的全部基础形态，任意复杂工作流都是这些形状的组合。

接下来按需深入姊妹篇：
- **执行引擎与并发**（BSP vs DAG、执行轨迹、并发竞态）→ [`graph-execution.md`](./graph-execution.md)
- **中断恢复与检查点**（HITL、checkpoint、time-travel）→ [`graph-interrupt.md`](./graph-interrupt.md)
- **子图与多 Agent**（subgraph、agentnode、A2A）→ [`graph-subagent.md`](./graph-subagent.md)
- **流式与 IO 约定**（stream_mode、io_conventions）→ [`graph-streaming-io.md`](./graph-streaming-io.md)
- **高级特性**（可视化、回调、重试、错误处理、节点缓存）→ [`graph-advanced.md`](./graph-advanced.md)

回到分类索引：[`graph.md`](./graph.md)。
