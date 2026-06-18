# Graph 高级特性（MCP 工具、回调、可视化、Call Options）

> **源码路径**：[`trpc-agent-go/examples/graph/`](../../../../trpc-agent-go/examples/graph)
> **主题切片**：高级特性（6 例：mcptool、per_node_callbacks、runner_plugin_node_callbacks、structure_export、visualization、call_options_generation_config）
> **难度**：高级

## 概述

当 Graph 工作流从"能跑"走向"可观测、可复用、可治理"，你需要以下六类能力：

1. **MCP 工具接入**：把外部 MCP 服务器（STDIO/SSE/HTTP）的工具当成本地图工具来调用。
2. **节点级回调**：在节点前后插入监控、改写状态、处理错误，可全局也可按节点。
3. **Runner 插件注入回调**：用 Runner 的 `BeforeAgent` 钩子把 `NodeCallbacks` 注入 RuntimeState，实现跨图统一的横切关注点。
4. **结构导出**：用 `structure.Export` 把 GraphAgent 拍成静态快照（节点/边/可编辑面/循环与汇聚高亮）。
5. **可视化**：把图导出为 Graphviz DOT 或 PNG/SVG。
6. **Call Options**：在不重新编译图的前提下，对单次 run 覆盖 LLM 的采样参数（Temperature、MaxTokens）。

本篇覆盖：`mcptool`、`per_node_callbacks`、`runner_plugin_node_callbacks`、`structure_export`、`visualization`、`call_options_generation_config`。（`react/` 由其他文章处理，此处略过。）

## 核心概念

### MCP 工具集

```go
toolSet := mcp.NewMCPToolSet(
    mcp.ConnectionConfig{
        Transport: "stdio",                 // 或 "sse"、"streamable_http"
        Command:   "go",
        Args:      []string{"run", "./stdioserver/main.go"},
        Timeout:   10 * time.Second,
    },
    mcp.WithMCPOptions(tmcp.WithSimpleRetry(3)),
)
toolSet.Init(ctx)
tools := toolSet.Tools(ctx)   // []tool.Tool，可直接喂给 AddLLMNode / AddToolsNode
```

### NodeCallbacks 三件套

| 回调 | 时机 | 能力 |
|------|------|------|
| `BeforeNode` / `WithPreNodeCallback` | 节点执行前 | 可改 state、可返回自定义结果**跳过**节点执行、可返回 error 中止 |
| `AfterNode` / `WithPostNodeCallback` | 节点执行后 | 可改 result、可校验、可加元数据 |
| `OnNodeError` / `WithNodeErrorCallback` | 节点失败时 | 仅观察用，无法改变 error 或恢复执行 |

**执行顺序**：Global BeforeNode → Per-Node BeforeNode → 节点本体 → Per-Node AfterNode → Global AfterNode。

### structure.Snapshot

`structure.Export(ctx, agent)` 返回 `*Snapshot`，包含：`StructureID`（内容哈希）、`EntryNodeID`、`Nodes`、`Edges`、`Surfaces`（可编辑面：instruction/model/tool/skill/few-shot）。可用于版本比对、可视化、权限控制。

### Call Options 三种目标

```go
graph.WithCallOptions(
    graph.WithCallGenerationConfigPatch(patch),         // 全局 patch
    graph.DesignateNode(nodeID, patch...),              // 按 nodeID
    graph.DesignateNodeWithPath(graph.NodePath{a, b}, patch...),  // 按子图路径
)
```

---

## mcptool（Graph + MCP STDIO）

一句话：图里挂一个 LLM 节点 + 一个 Tools 节点，工具来自 STDIO MCP 服务器（`get_weather` 等），用 `AddToolsConditionalEdges` 形成 LLM↔Tools 循环。

源码：[`trpc-agent-go/examples/graph/mcptool/`](../../../../trpc-agent-go/examples/graph/mcptool)

```go
toolSet := mcp.NewMCPToolSet(mcp.ConnectionConfig{
    Transport: "stdio",
    Command:   "go", Args: []string{"run", "./stdioserver/main.go"},
    Timeout: 10 * time.Second,
}, mcp.WithMCPOptions(tmcp.WithSimpleRetry(3)))
toolSet.Init(ctx)
mcpTools := toolSet.Tools(ctx)
tools := make(map[string]tool.Tool, len(mcpTools))
for _, t := range mcpTools {
    tools[t.Declaration().Name] = t
}

stateGraph := graph.NewStateGraph(schema)
stateGraph.AddLLMNode("assistant", modelInstance, instruction, tools)
stateGraph.AddToolsNode("tools", tools)
stateGraph.AddNode("finish", func(ctx context.Context, state graph.State) (any, error) { return nil, nil })
stateGraph.AddToolsConditionalEdges("assistant", "tools", "finish")
stateGraph.AddEdge("tools", "assistant")  // 工具结果回流入 LLM
stateGraph.SetEntryPoint("assistant").SetFinishPoint("finish")
```

**事件分流**：循环里区分三类——`Choices[0].Message.ToolCalls`（LLM 决定调工具）、`choice.Message.Role == model.RoleTool`（工具响应回流）、`choice.Delta.Content`（流式文本）。需要 `defer toolSet.Close()` 和 `defer runner.Close()` 管理生命周期。`stdioserver/` 提供 `echo` / `add` / `get_weather` 三个示例工具。

```bash
export OPENAI_BASE_URL="https://api.deepseek.com/v1"
export OPENAI_API_KEY=sk-...
cd examples/graph/mcptool && go run . -model deepseek-v4-flash
# > Use get_weather to check the weather in Beijing
```

---

## per_node_callbacks（全局 + 按节点回调）

一句话：三步图（step1 → step2 → step3），演示全局回调 + 按节点的前置/后置/错误回调，包括"前置回调改写输入"、"后置回调给结果加时间戳"、"前置回调返回 State 直接跳过节点"、"错误回调兜底"四种模式。

源码：[`trpc-agent-go/examples/graph/per_node_callbacks/`](../../../../trpc-agent-go/examples/graph/per_node_callbacks)

```go
// 全局回调（图级）
globalCallbacks := graph.NewNodeCallbacks().
    RegisterBeforeNode(func(ctx context.Context, cbCtx *graph.NodeCallbackContext, state graph.State) (any, error) {
        fmt.Printf("🌍 [GLOBAL] Before node: %s (%s)\n", cbCtx.NodeID, cbCtx.NodeType)
        return nil, nil
    }).RegisterAfterNode(...).RegisterOnNodeError(...)

graph.NewStateGraph(schema).
    WithNodeCallbacks(globalCallbacks).
    AddNode("step1", w.processStep1,
        graph.WithName("Step 1 - Input Processing"),
        graph.WithPreNodeCallback(func(..., state graph.State) (any, error) {
            state["input"] = "Enhanced: " + inputStr   // 改写输入
            return nil, nil
        }),
        graph.WithPostNodeCallback(...),
    ).
    AddNode("step2", w.processStep2,
        graph.WithNodeErrorCallback(func(..., err error) {
            state["step2_result"] = "fallback_result_due_to_error"  // 仅观察，兜底不持久
        }),
    ).
    AddNode("step3", w.processStep3,
        graph.WithPreNodeCallback(func(..., state graph.State) (any, error) {
            if len(inputStr) > 50 {
                // 返回自定义 State → 跳过节点本体执行
                return graph.State{"final_result": "skipped_due_to_length"}, nil
            }
            return nil, nil
        }),
    )
```

> **回调上下文 `NodeCallbackContext`**：含 `NodeID` / `NodeType` / `StepNumber`，前置回调可记 `ExecutionStartTime`、后置回调算耗时。`NodeType` 取值 `graph.NodeTypeFunction` / `NodeTypeLLM` / `NodeTypeTool`，可据此过滤。

> **重要约束**：`OnNodeError` **不能恢复执行**，只用于日志/metrics。要恢复必须用 `Command` 或条件路由。该回调里对 state 的修改不会持久化。

```bash
cd examples/graph/per_node_callbacks
go run . -model deepseek-v4-flash             # 跑 4 个预设示例
go run . -model deepseek-v4-flash -interactive
```

---

## runner_plugin_node_callbacks（Runner 插件注入回调）

一句话：Graph 节点**不是** Runner 插件钩子点；想跨图统一注入回调，用 Runner 的 `BeforeAgent` 钩子把 `NodeCallbacks` 塞进 `RuntimeState[graph.StateKeyNodeCallbacks]`。

源码：[`trpc-agent-go/examples/graph/runner_plugin_node_callbacks/`](../../../../trpc-agent-go/examples/graph/runner_plugin_node_callbacks)

```go
type nodeCallbacksPlugin struct{ callbacks *graph.NodeCallbacks }

func (p *nodeCallbacksPlugin) Name() string { return pluginName }
func (p *nodeCallbacksPlugin) Register(reg *plugin.Registry) { reg.BeforeAgent(p.beforeAgent) }

func (p *nodeCallbacksPlugin) beforeAgent(ctx context.Context, args *agent.BeforeAgentArgs) (*agent.BeforeAgentResult, error) {
    inv := args.Invocation
    if inv.RunOptions.RuntimeState == nil {
        inv.RunOptions.RuntimeState = make(map[string]any)
    }
    if inv.RunOptions.RuntimeState[graph.StateKeyNodeCallbacks] == nil {
        inv.RunOptions.RuntimeState[graph.StateKeyNodeCallbacks] = p.callbacks
    }
    return nil, nil
}

r := runner.NewRunner(appName, ga, runner.WithPlugins(p))
```

> **何时用哪种**：如果你**控制图构造**，直接 `graph.NewStateGraph(schema).WithNodeCallbacks(cb)` 更简单；只有需要**runner 作用域的横切行为**（如统一日志/审计，无法改每个图的构造代码）才用注入方式。

> 该示例的事件流来自 `agent.WithStreamMode(agent.StreamModeTasks)`（节点生命周期事件），最终结果从 `runner.completion` 事件的 `StateDelta` 取 `last_response` 和 `upper_text`。

```bash
cd examples/graph/runner_plugin_node_callbacks && go run . -input "hello plugin hooks"
```

---

## structure_export（静态结构快照）

一句话：构造一个含 fan-out / fan-in / 条件边 / 循环 / join 的图，用 `structure.Export` 拍快照，自定义打印节点/边/可编辑面 + 推导出分支点、汇聚点、循环区域。

源码：[`trpc-agent-go/examples/graph/structure_export/`](../../../../trpc-agent-go/examples/graph/structure_export)（`main.go` + `agent.go` + `print.go`）

```go
ag, _ := buildAgent()
snapshot, err := structure.Export(ctx, ag)
printSnapshot(snapshot)
```

`agent.go` 构造的图结构（含 join + tools 循环 + 条件回环到 start）：

```go
sg.AddJoinEdge([]string{nodeBranchA, nodeBranchB}, nodeJoin)
sg.AddConditionalEdges(nodeJoin, func(...) (string, error) { return "finish", nil }, nil)
// join 节点用 WithEndsMap 声明可能的目标（finish→done, retry→start）
sg.AddNode(nodeJoin, ..., graph.WithEndsMap(map[string]string{"finish": nodeDone, "retry": nodeStart}))
```

`print.go` 关键推导：用 Tarjan 算法找强连通分量识别**循环区域**；按出度>1 找**分支点**；按入度>1（去掉 root）找**汇聚点**。

**输出含四部分**：Nodes（含类型 `function`/`llm`/`tool`/`agent`）、Edges、Surfaces（instruction/model/tool/skill/few-shot 的可编辑值）、Highlights。本例**不发起任何模型请求**，因此无需 API Key。

```bash
cd examples/graph && go run ./structure_export
```

---

## visualization（DOT / PNG 导出）

一句话：把 StateGraph 导出为 Graphviz DOT 文本，可选调用 `dot` 二进制渲染 PNG/SVG；区分静态边、条件边、声明式动态目标。

源码：[`trpc-agent-go/examples/graph/visualization/`](../../../../trpc-agent-go/examples/graph/visualization)

```go
g := sg.MustCompile()

// 写 DOT 文件
dotPath := fmt.Sprintf("visualization-%d.dot", time.Now().Unix())
os.WriteFile(dotPath, []byte(g.DOT(
    graph.WithRankDir(graph.RankDirLR),           // 从左到右布局
    graph.WithIncludeDestinations(true),          // 包含 WithDestinations 声明的动态目标
    graph.WithGraphLabel(graphTitle),
)), 0o644)

// 尝试渲染 PNG（需要 PATH 里有 graphviz 的 dot）
pngPath := strings.TrimSuffix(dotPath, ".dot") + ".png"
g.RenderImage(ctx, graph.ImageFormatPNG, pngPath,
    graph.WithRankDir(graph.RankDirLR),
    graph.WithIncludeDestinations(true),
    graph.WithGraphLabel(graphTitle),
)
```

**节点类型样式**：Function/LLM/Tool 节点用不同样式区分；条件边渲染为**虚线带 label**；`WithDestinations` 声明的动态目标渲染为**灰色点线**且**不影响运行时路由**（仅用于可视化和静态检查）。

> **注意**：示例里 `ask` 节点其实是个普通函数节点，但通过 `graph.WithNodeType(graph.NodeTypeLLM)` 把它的可视化样式声明为 LLM——只影响渲染，不影响执行。`Start`/`End` 虚拟节点可通过选项控制是否显示。

```bash
# macOS: brew install graphviz
cd examples/graph/visualization && go run .
# 产出 visualization-<ts>.dot 和 visualization-<ts>.png
```

---

## call_options_generation_config（单 run 覆盖采样参数）

一句话：图编译时用 `graph.WithGenerationConfig` 设默认参数；每次 run 时用 `graph.WithCallOptions` 在其上叠加全局/按节点/按子图路径的 patch，无需重建图。

源码：[`trpc-agent-go/examples/graph/call_options_generation_config/`](../../../../trpc-agent-go/examples/graph/call_options_generation_config)

```go
// 编译时设默认
sg.AddLLMNode(nodeParentLLM, m, "parent", nil,
    graph.WithGenerationConfig(model.GenerationConfig{
        Temperature: model.Float64Ptr(0.8),  // parentTempDefault
    }),
)

// 单次 run 覆盖
runOpt := graph.WithCallOptions(
    // 1) 全局：所有 LLM 节点 Temperature → 0.2
    graph.WithCallGenerationConfigPatch(model.GenerationConfigPatch{
        Temperature: model.Float64Ptr(0.2),
    }),
    // 2) 按 nodeID：parent_llm 的 MaxTokens → 111
    graph.DesignateNode(nodeParentLLM,
        graph.WithCallGenerationConfigPatch(model.GenerationConfigPatch{
            MaxTokens: model.IntPtr(111),
        }),
    ),
    // 3) 按子图路径：child_agent/llm 的 Temperature → 0.0
    graph.DesignateNodeWithPath(
        graph.NodePath{childAgentName, nodeChildLLM},
        graph.WithCallGenerationConfigPatch(model.GenerationConfigPatch{
            Temperature: model.Float64Ptr(0.0),
        }),
    ),
)
r.Run(ctx, uid, sid, msg, runOpt)
```

**叠加优先级**：编译时 config 是基底 → 全局 patch 覆盖 → 按 nodeID/路径的 patch 进一步覆盖。`DesignateNodeWithPath` 用 `graph.NodePath`（一段节点 ID 序列）精确指向**嵌套子图内**的节点。

> 示例用 stub `printModel` 打印收到的 `GenerationConfig`，所以**不需要真实 API Key**。典型用途：在线服务里按用户等级动态调温度/长度上限、A/B 测试不同采样参数、给"创意"路径和"事实"路径配不同 temperature。

```bash
cd examples/graph/call_options_generation_config && go run .
# 两次 run 对照：第一次打印编译默认值，第二次打印 patch 叠加后的值
```

---

## 选型对比

### 回调注入方式

| 方式 | API | 适用 |
|------|-----|------|
| 图级全局回调 | `graph.NewStateGraph(s).WithNodeCallbacks(cb)` | 单图统一行为 |
| 节点级回调 | `AddNode(..., graph.WithPreNodeCallback(...))` | 特定节点的定制 |
| Runner 插件注入 | `RuntimeState[StateKeyNodeCallbacks]` via `BeforeAgent` | 跨图横切、不能改图构造 |

### 结构/可视化

| 工具 | 产物 | 是否运行模型 | 用途 |
|------|------|--------------|------|
| `structure.Export` | `Snapshot`（节点/边/Surface/Highlight） | 否 | 版本比对、权限、UI |
| `g.DOT` | DOT 文本 | 否 | 文档、版本控制 |
| `g.RenderImage` | PNG/SVG | 否 | 演示、调试（需 graphviz） |

### Call Options 三种目标

| 模式 | API | 粒度 |
|------|-----|------|
| 全局 | `WithCallGenerationConfigPatch` | 当前图所有 LLM 节点 |
| 按 nodeID | `DesignateNode(id, ...)` | 同一图内指定节点 |
| 按子图路径 | `DesignateNodeWithPath(NodePath{...}, ...)` | 嵌套子图内的节点 |

## 关键要点

1. **MCP 工具接入零摩擦**：`mcp.NewMCPToolSet` 拿到的 `[]tool.Tool` 与本地 function tool 完全等价，可直接喂给 `AddLLMNode` / `AddToolsNode`，配合 `AddToolsConditionalEdges` 形成 Agent 循环。
2. **`OnNodeError` 是观察哨，不是恢复点**：要恢复执行得用 `Command` 或条件路由；错误回调里改 state 不会持久化。
3. **PreNode 回调可跳过节点**：返回非 nil 的 `graph.State` 会让框架用这份 state 作为节点输出，跳过节点本体——等价于条件短路。
4. **Graph 节点不是 Runner 插件钩子点**：要跨图统一拦截节点，用 `BeforeAgent` 把 `NodeCallbacks` 注入 `RuntimeState[StateKeyNodeCallbacks]`。
5. **`structure.Export` 不发起模型调用**：它只看图的静态拓扑，所以即便图里写了 `openai.New("gpt-4o-mini")` 也不需要 API Key。
6. **`WithDestinations` 只影响渲染**：它声明"可能跳到的目标"，运行时不生效，但能让 DOT/PNG 更完整地反映设计意图。
7. **Call Options 的 patch 是叠加而非替换**：以编译时 `WithGenerationConfig` 为基底，多层 patch 依次覆盖；`GenerationConfigPatch` 的字段都是指针，nil 字段表示"不改"。

## 总结

本篇覆盖了 Graph 走向生产级所需的六类高级能力：**MCP 外部工具接入**、**全局/节点/插件三层回调体系**、**结构快照与可视化**、**单次 run 的采样参数动态覆盖**。掌握这些之后，你可以把 Graph 当作一个可观测、可治理、能与外部工具生态无缝集成的运行时。

要继续深入 Graph 的其他维度，可参考同目录的兄弟主题文章：

- [`graph-topology.md`](./graph-topology.md)：基础结构、条件边、并行/菱形/Join、子图嵌套、MapReduce
- [`graph-execution.md`](./graph-execution.md)：BSP vs DAG 引擎、节点缓存、执行轨迹、并发竞态
- [`graph-interrupt.md`](./graph-interrupt.md)：HITL 中断恢复、Checkpoint、时间旅行、嵌套中断
- [`graph-subagent.md`](./graph-subagent.md)：SubgraphNode、AgentNode、A2A、状态交接
- [`graph-streaming-io.md`](./graph-streaming-io.md)：流式、OneShot、IO 约定与占位符（本系列的姊妹篇）
