# Graph 中断与恢复 - 人机协作的多种暂停机制

> **源码路径**：[`trpc-agent-go/examples/graph/`](../../../../trpc-agent-go/examples/graph)（本篇覆盖 `interrupt`/`static_interrupt`/`external_interrupt`/`dag_interrupt`/`nested_interrupt`/`a2a_interrupt`/`agentnode_llmagent_externaltool`/`externaltool`/`userinputonce`）
> **主题**：中断与恢复 · **难度**：高级

## 概述

真实的 AI 工作流几乎不可能"一键跑完"：风控要人工复核、文档抽取要先取回外部内容、敏感操作要走多级审批、长任务要在昂贵步骤前停下来确认。tRPC-Agent-Go 的 `graph` 包提供了完整的 **中断与恢复（Interrupt & Resume）** 机制，让图执行可以在任意节点暂停、把状态落盘成检查点（Checkpoint）、等外部输入回来后再从检查点续跑——也就是常说的 **Human-in-the-Loop（HITL）**。

`graph/` 目录下有 9 个围绕这一主题的示例，看起来都在"暂停 + 恢复"，但暂停的**来源**和**触发方式**不同。看懂这两条轴就能选对机制：

- **轴 A：暂停从哪里发起？** 图节点自身调用 `graph.Interrupt`；AgentNode 的子 Agent（子图）内部中断、父图捕获传播；或框架/外部代码触发（节点内无中断代码）。
- **轴 B：用什么机制触发？** 动态 `graph.Interrupt(...)`（节点逻辑里写死）；静态声明 `graph.WithInterruptBefore()`/`WithInterruptAfter()`（调试断点）；外部请求 `graph.WithGraphInterrupt(ctx)`（图外"暂停按钮"）。

本篇会先把这三类机制讲透，再逐一拆解 9 个示例的触发细节，最后给出选型建议。

## 核心概念

### 1. `graph.Interrupt` —— 动态中断的唯一入口

```go
// resume.go
func Interrupt(ctx context.Context, state State, key string, prompt any) (any, error)
```

这是 HITL 中断的核心，行为分两种：

- **首次执行**：返回 `(nil, *InterruptError)`。executor 捕获这个 error，写一份 `Source="interrupt"` 的检查点，停止本轮执行。
- **恢复执行**（带 `ResumeMap` 续跑）：返回 `(resumeValue, nil)`，节点继续往下走。

`Interrupt` 内部查询顺序（见 `resume.go:18`）：`StateKeyUsedInterrupts` 缓存 → `ResumeChannel` → `StateKeyResumeMap[key]`。这意味着**同一个中断点即使节点被重跑也只拿一次用户输入**——这是写 HITL 节点时最让人安心的一点。注意 `InterruptError.SkipRerun` 默认 `false`，恢复时会**重新执行**被中断的节点（才能拿到 resume 值产出状态），所以节点函数应幂等或依赖上述缓存。

### 2. 基于 Checkpoint 的恢复

中断必然依赖 **CheckpointSaver**。没有 saver，`Interrupt` 只是抛错，状态无从保存。恢复的本质是：带上 `lineage_id` + `checkpoint_id` + `ResumeMap` 再发起一次执行，executor 从检查点装载状态、把 resume 值喂给对应中断点。

```go
// 恢复时构造 RuntimeState（三要素）
runtimeState := graph.State{
    graph.CfgKeyLineageID:    lineageID,      // 哪条执行线
    graph.CfgKeyCheckpointID: checkpointID,   // 从哪个检查点续跑
    graph.StateKeyCommand: &graph.Command{    // 喂给中断点的用户输入
        ResumeMap: map[string]any{taskID: userInput},
    },
}
```

`ResumeMap` 的 key 必须命中中断点的 **TaskID**——对 `graph.Interrupt` 来说 TaskID 就是你传入的 `key` 参数（通常用节点 ID，便于定位）。检查点的 `InterruptState.TaskID` 字段会存下来，恢复时据此路由。

三种官方 saver：

| Saver | 适用场景 | 示例 |
|-------|---------|------|
| `checkpointinmemory.NewSaver()` | 单进程、演示、测试 | static_interrupt / externaltool |
| `checkpointsqlite.NewSaver(db)` | 跨进程恢复、本地持久化 | interrupt / nested_interrupt |
| `checkpointredis.NewSaver(...)` | 分布式、多实例共享 | interrupt |

### 3. 静态 vs 动态 vs 外部中断

| 维度 | 动态 `graph.Interrupt` | 静态声明 | 外部请求 |
|------|----------------------|---------|---------|
| 代码位置 | 节点函数体内 | 节点声明时的 Option | 图外任意 goroutine |
| 触发时机 | 运行到该行 | 节点执行前 / 后 | 当前 step 结束 / 超时强制 |
| API | `graph.Interrupt(...)` | `WithInterruptBefore()` / `WithInterruptAfter()` | `graph.WithGraphInterrupt(ctx)` |
| 产物 | `Source=interrupt` 检查点 | 同上 | 同上（含 `ExternalInterruptPayload`） |
| 适用示例 | interrupt / dag_interrupt / externaltool / ... | static_interrupt | external_interrupt |

### 4. 父子中断传播

当 AgentNode 里的子 GraphAgent 调用了 `graph.Interrupt`，父图不会"卡死"——它会捕获子图中断事件，在**父图**写一份带 `StateKeySubgraphInterrupt` 元数据的检查点。这份元数据记录了 `child_agent_name`、`child_checkpoint_id`、`child_checkpoint_ns`、`child_task_id` 等（见 `graph/keys.go:46`）。恢复父图时，框架据这些字段自动定位并续跑子图。`nested_interrupt`（本地嵌套）和 `a2a_interrupt`（跨网络）演示的就是这条传播链。

## 中断来源分类

按"谁触发了暂停"给 9 个示例归类，这是本篇最重要的导航：

| 分类 | 触发机制 | 示例 | 暂停发生在 |
|------|---------|------|-----------|
| **图节点中断** | 节点内 `graph.Interrupt` | `interrupt/` | 普通函数节点（多级审批） |
| | | `dag_interrupt/` | 同上，但跑在 DAG 引擎 |
| | | `externaltool/` | 工具节点的 `BeforeTool` 回调里 |
| | 后继节点替子 Agent 中断 | `agentnode_llmagent_externaltool/` | 跟在 AgentNode 后的普通节点 |
| **AgentNode 子 Agent 中断** | 子 GraphAgent 内 `graph.Interrupt` | `nested_interrupt/` | 本地多层嵌套子图 |
| | | `a2a_interrupt/` | 跨 A2A 网络的远程子图 |
| **静态 / 外部中断** | 声明式 Option | `static_interrupt/` | 节点前/后断点 |
| | 外部 `interrupt()` 函数 | `external_interrupt/` | 图外代码请求暂停 |
| **单次输入（非中断）** | 无中断 | `userinputonce/` | 不暂停，仅一次性消费输入 |

> 最易混淆的一对：`agentnode_llmagent_externaltool` 是**后继图节点**暂停（子 LLMAgent 只负责发外部工具调用），而 `nested_interrupt` 是**子 GraphAgent 自己**暂停。这是 `graph/README.md` 反复强调的区分点。

---

## interrupt（多级审批的动态中断）

一句话：最完整的 HITL 范本——`Runner` + `GraphAgent` + `Checkpoint`，5 个节点串联两个 `graph.Interrupt` 中断点，配交互式 CLI 和三种存储后端。源码：[`trpc-agent-go/examples/graph/interrupt/`](../../../../trpc-agent-go/examples/graph/interrupt)。

**触发机制**：在 `request_approval` 和 `second_approval` 两个普通函数节点内分别调用 `graph.Interrupt`，用节点 ID 作为 interrupt key（这样 TaskID 与 NodeID 一致，便于定位）：

```go
// interrupt/main.go:337 —— 首个中断点
interruptValue := map[string]any{
    "message":    "Please approve the current state (yes/no):",
    "counter":    getInt(s, stateKeyCounter),
    "step_count": stepCount,
    "node_id":    nodeRequestApproval,
}
// key 用节点 ID，恢复时 ResumeMap[nodeID] = "yes"
resumeValue, err := graph.Interrupt(ctx, s, nodeRequestApproval, interruptValue)
// resumeValue == nil + err == *InterruptError  → 暂停
// resumeValue == "yes" + err == nil            → 用户批准，继续
```

**恢复的关键技巧**：示例没有硬编码 interrupt key，而是从检查点读 `InterruptState.TaskID` 动态填 `ResumeMap`。这样无论当前停在哪一级审批，一条 `resume <lineage> yes` 命令都能正确路由（`interrupt/main.go:826`）：

```go
latest, _ := w.manager.Latest(ctx, lineageID, w.currentNamespace)
taskID := latest.Checkpoint.InterruptState.TaskID
cmd.ResumeMap[taskID] = userInput   // 自动命中当前活跃的中断点
```

**运行**：

```bash
cd examples/graph/interrupt
go run . -storage memory          # 默认交互模式
go run . -storage sqlite -db cp.db

# 交互命令
interrupt my-flow                 # 跑到第一个中断点
resume my-flow yes                # 恢复，会再次中断在 second_approval
resume my-flow yes                # 第二次恢复，跑完 finalize
tree my-flow                      # 看检查点树（中断点标记为 🔴）
demo                              # 自动跑完整演示
```

**预期输出（节选）**：

```
🔐 interrupt> interrupt yy
🔄 Running workflow until interrupt (lineage: yy)...
⚡ Executing: increment
⚡ Executing: request_approval
⚠️  Interrupt detected
💾 Execution interrupted, checkpoint saved
   Use 'resume yy <yes/no>' to continue
```

---

## dag_interrupt（DAG 引擎上的动态中断）

一句话：证明 `graph.Interrupt` 在 **DAG（eager）引擎**上与 BSP 引擎行为一致——同样的 `Interrupt` 调用、同样的检查点恢复。源码：[`trpc-agent-go/examples/graph/dag_interrupt/`](../../../../trpc-agent-go/examples/graph/dag_interrupt)。

**触发机制**：图结构 `entry → ask → after`，`ask` 节点内调用 `graph.Interrupt`。与 `interrupt/` 的区别在于 executor 用 DAG 引擎，并直接用 `graph.Executor`（不走 Runner/GraphAgent 包装），更贴近底层 API：

```go
// dag_interrupt/main.go:77 —— 用 DAG 引擎 + 检查点
exec, err := graph.NewExecutor(
    g,
    graph.WithExecutionEngine(selectedEngine),   // -engine dag（默认）
    graph.WithCheckpointSaver(saver),
    graph.WithMaxConcurrency(2),
)

// ask 节点内
v, err := graph.Interrupt(ctx, state, "approval", "please approve: ok?")
return graph.State{stateKeyAnswer: v}, nil
```

**恢复**：直接用 `ResumeCommand` 构造（与 `Command` 等价的另一种写法），带上 `lineage_id` + `checkpoint_id`：

```go
// dag_interrupt/main.go:123
resumeCmd := (&graph.ResumeCommand{}).WithResumeMap(map[string]any{
    "approval": *resumeValue,
})
resumeState := graph.State{
    graph.CfgKeyLineageID:    meta.LineageID,
    graph.CfgKeyCheckpointID: meta.CheckpointID,
    graph.StateKeyCommand:    resumeCmd,
}
```

**运行 + 预期输出**：

```bash
cd examples/graph/dag_interrupt
go run .                          # 默认 -engine dag -resume ok

# 输出
# Run #1: expect interrupt
# Interrupted: node=ask key=approval checkpoint=<id>
# Run #2: resume and expect completion
# Completed: answer=ok
```

> 看点：中断事件元数据藏在 `event.StateDelta[graph.MetadataKeyPregel]`（`_pregel_metadata`）里，示例通过解析它拿到 `NodeID`/`InterruptKey`/`CheckpointID`。这套解析逻辑在后面多个示例里反复出现。

---

## static_interrupt（声明式静态断点）

一句话：节点函数里**完全不写中断代码**，只在声明节点时挂 `graph.WithInterruptBefore()` / `WithInterruptAfter()`，像调试断点一样在节点前后暂停。源码：[`trpc-agent-go/examples/graph/static_interrupt/`](../../../../trpc-agent-go/examples/graph/static_interrupt)。

**触发机制**：`middle` 节点同时挂了 before + after 两个选项，于是程序要跑三遍才结束——先停在 `middle` 之前，再停在 `middle` 之后，最后到 `end`：

```go
// static_interrupt/main.go:126
sg.AddNode(
    nodeMiddle,
    func(ctx context.Context, state graph.State) (any, error) {
        return graph.State{stateKeyOrder: []string{nodeMiddle}}, nil  // 纯业务，无 Interrupt 调用
    },
    graph.WithInterruptBefore(),   // 进入 middle 前暂停
    graph.WithInterruptAfter(),    // 离开 middle 后再暂停
)
```

**与动态中断的本质区别**：静态中断不需要 `ResumeMap` 喂数据（节点逻辑根本不消费用户输入），恢复时只需带上 `checkpoint_id` 续跑即可。它适合"在此处停下看一眼状态"的调试 / 审计场景。

**运行**：示例直接用 `graph.Executor` + inmemory saver，单进程内连续 `runOnce` 三次模拟"暂停-恢复"：

```bash
cd examples/graph/static_interrupt
go run .

# 输出
# Interrupt #1: node=middle key=middle(before) checkpoint=<id1>
# Interrupt #2: node=middle key=middle(after)  checkpoint=<id2>
# Final order: [start middle end]
```

> 注意：静态中断的 `interruptKey` 形如 `middle(before)` / `middle(after)`，由框架自动生成，调用方无需关心。

---

## external_interrupt（外部暂停按钮）

一句话：图外代码通过 `graph.WithGraphInterrupt(ctx)` 拿到一个 `interrupt()` 函数，随时可以"按暂停"；支持安全边界（等当前 step 结束）和强制（超时取消在途任务）两种模式。源码：[`trpc-agent-go/examples/graph/external_interrupt/`](../../../../trpc-agent-go/examples/graph/external_interrupt)。

**触发机制**：这是唯一由**图外代码**触发的中断。`WithGraphInterrupt` 把一个中断状态塞进 context，executor 在每个 step 边界检查它：

```go
// external_interrupt/main.go:153 —— 创建可中断的 context
ctx, interrupt := graph.WithGraphInterrupt(context.Background())

// 启动执行（异步 drain 事件）
ch, _ := exec.Execute(ctx, st, inv1)

// 等 prepare 节点真的开始
<-started

// 从图外按暂停！
interrupt()   // 默认：等当前 step 干完，在下一个 step 前停

// 强制模式：50ms 后强制取消在途任务
interrupt(graph.WithGraphInterruptTimeout(50*time.Millisecond))
```

**两种演示**：

| 模式 | 行为 | Forced 字段 |
|------|------|------------|
| `planned`（计划暂停） | 在 `prepare`→`call_model` 之间安全停下，不打断已开始的任务 | `false` |
| `forced`（超时强停） | `slow` 节点跑到一半被取消，executor 写可恢复检查点 | `true` |

中断 payload 类型固定为 `graph.ExternalInterruptPayload{Key: "external_interrupt", Forced: bool}`（`executor_external_interrupt.go:170`），可据此区分外部中断与节点中断。

**运行**：

```bash
cd examples/graph/external_interrupt
go run .                              # 默认 -demo both -engine bsp
go run . -demo forced                 # 只看超时强停
go run . -engine dag                  # DAG 引擎同样支持
```

**预期输出**：

```
============================================================
Planned external interrupt demo
Paused: key=external_interrupt forced=false checkpoint=<id>
Completed: <模型回答>

Forced external interrupt demo (timeout)
Paused: key=external_interrupt forced=true checkpoint=<id>
Completed after resume
```

> 不设 `OPENAI_API_KEY` 时，planned demo 自动降级为 stub 节点，照样能看暂停/恢复行为——这是个很贴心的无依赖演示。

---

## externaltool（工具回调里的动态中断）

一句话：模型编排的"外部工具"——LLM 决定调用 `external_fetch`，但这个工具由**调用方在图进程外**执行；通过 `ToolCallbacks.BeforeTool` 拦截该工具调用并 `graph.Interrupt`，等客户端 `/resume` 喂回结果后，内部工具（summarize/format）继续跑。源码：[`trpc-agent-go/examples/graph/externaltool/`](../../../../trpc-agent-go/examples/graph/externaltool)。

**触发机制**：中断发生在**工具节点的 BeforeTool 回调**里，而非普通函数节点。这是它与 `interrupt/` 的关键差异——暂停点绑在某个具体工具调用上：

```go
// externaltool/main.go:629 —— BeforeTool 回调拦截 external_fetch
func (c *externalCoordinator) before(ctx context.Context, args *tool.BeforeToolArgs) (*tool.BeforeToolResult, error) {
    if args.ToolName != toolNameFetch {   // 只拦截外部工具，内部工具正常执行
        return nil, nil
    }
    state := c.getState()
    prompt := map[string]any{"message": "Run extract externally and return content.", "tool": args.ToolName}
    resume, err := graph.Interrupt(ctx, state, interruptKeyTool, prompt)  // 暂停！
    if err != nil {
        return nil, err
    }
    // resume 值（客户端 /resume 提交的字符串）转成工具结果
    return &tool.BeforeToolResult{CustomResult: parseExternalResult(resume)}, nil
}
```

工具节点本身用 `graph.WithToolCallbacks(w.coordinator.callbacks())` 挂上回调，并包一层 wrapper 把当前 state 注入 coordinator。其余工具（`summarize_text` / `format_bullets`）是真正的 `tool.Tool` 实现，正常在进程内跑。

**图结构**：

```
prepare_input → assistant_plan(LLM) ⇄ external_tools(暂停点) → finalize
                     └───────────────────────────────────────┘
                 （AddToolsConditionalEdges：有 tool_calls 走 tools，否则走 finalize）
```

**运行 + 预期输出**：

```bash
cd examples/graph/externaltool
export OPENAI_API_KEY=...
go run .

# 交互
You> fetch and summarize content from www.qq.com
🔧 Tool call requested: external_fetch (ID: call_0) args: {"source":"www.qq.com"}
🛑 External tool requested: Run external_fetch and return the content.
   Reply: /resume <content>
You> /resume qq.com is a website that provides rich content
🧰 Tool result: {"content":"qq.com is a website that provides rich content"}
🤖 Assistant: 🔧 Tool call requested: summarize_text ...   # 内部工具继续，不再暂停
```

---

## agentnode_llmagent_externaltool（后继节点替子 Agent 中断）

一句话：AgentNode 里的子 `LLMAgent` 发出外部工具调用，但**子 Agent 自己不暂停**——而是由紧跟在 AgentNode 后面的普通图节点 `external_tool_gate` 读取工具调用、调用 `graph.Interrupt`、再在恢复时把结果以 tool message 喂回子 Agent。源码：[`trpc-agent-go/examples/graph/agentnode_llmagent_externaltool/`](../../../../trpc-agent-go/examples/graph/agentnode_llmagent_externaltool)。

**触发机制**：这是与 `nested_interrupt` 最容易混淆的一个。区别在于**中断点在父图节点上**，不在子 Agent 内部：

```go
// agent.go:68 —— 图结构
sg.AddAgentNode(researchAgentName,
    graph.WithAgentNodeRunOptions(agent.WithExternalTools([]tool.Tool{externalSearchTool()})),
    graph.WithAgentNodeInputMapper(mapExternalToolMessage),       // 恢复时把 tool message 投影进子 Agent
    graph.WithSubgraphOutputMapper(storeResearchToolCall),        // 子 Agent 输出 → 提取 tool call
)
sg.AddNode(nodeGate, interruptForExternalTool)                   // 后继节点负责中断
sg.AddEdge(researchAgentName, nodeGate)
sg.AddConditionalEdges(nodeGate, routeAfterGate, ...)            // 有 tool message → 重跑 AgentNode；否则 → End
```

`storeResearchToolCall` 把子 Agent 产出的 `external_search` 工具调用存进状态 `keyToolRequest`；`interruptForExternalTool` 读到它就用 `toolCallID` 当 key 发起 `graph.Interrupt`：

```go
// agent.go:99
func interruptForExternalTool(ctx context.Context, state graph.State) (any, error) {
    request, ok, _ := toolRequestFromState(state)
    if !ok { return nil, nil }                       // 没有外部工具调用，直接放行
    resumeValue, err := graph.Interrupt(ctx, state, request.ToolCallID, request)  // key=toolCallID
    // ...恢复时把 resumeValue 包装成 tool message 存回 keyToolMessage
}
```

恢复时用 `graph.NewResumeCommand().WithResumeMap({toolCallID: result})`，`mapExternalToolMessage` 把 tool message 投到 `StateKeyAgentInputMessage`，条件边据此让 `research_agent` 再跑一遍产出最终答案。

**运行**：

```bash
cd examples/graph
export OPENAI_BASE_URL=... OPENAI_API_KEY=...
go run ./agentnode_llmagent_externaltool -model deepseek-v4-flash

# 交互
user> Use external search to get user input and say hello+tool result
Turn #1: waiting for external_search interrupt.
toolCallId: call_xxx   toolArgs: {"query":"user input"}   checkpointId: <id>
external_search result> 1234
Turn #1: resuming graph.
Final answer: Hello 1234
```

> 记住这条对照：**子 Agent 发工具调用 → 父图节点暂停** = 本示例；**子 GraphAgent 自己调 Interrupt → 父图捕获子图中断** = 下一个 `nested_interrupt`。

---

## nested_interrupt（本地多层嵌套子图中断）

一句话：父 GraphAgent 通过 AgentNode 调用子 GraphAgent，最深层的叶子图调 `graph.Interrupt`，**每一层父图都会捕获并写带子图元数据的检查点**；恢复父图时框架自动一层层续跑到叶子。源码：[`trpc-agent-go/examples/graph/nested_interrupt/`](../../../../trpc-agent-go/examples/graph/nested_interrupt)。

**触发机制**：中断点在**叶子子图**内部，父图节点本身不调用 `Interrupt`。嵌套深度可配（`-depth 2` 到任意层）：

```go
// nested_interrupt/main.go:231 —— 叶子图的 ask 节点
func askNode() graph.NodeFunc {
    return func(ctx context.Context, state graph.State) (any, error) {
        v, err := graph.Interrupt(ctx, state, "approval", "Please type an approval string.")
        // ...
        return graph.State{stateKeyAnswer: s}, nil
    }
}
```

每层父图就是 `graph.NewStateGraph(schema).AddAgentNode(childName, ...).Compile()`，靠 `graphagent.WithSubAgents` 串成链。当叶子中断时，框架把 `StateKeySubgraphInterrupt`（含 `child_checkpoint_id`/`child_task_id`/`child_checkpoint_ns` 等）逐层写进父检查点。

**恢复**：从**最外层父检查点**恢复，`ResumeMap` 的 key 用中断点的 TaskID（即叶子图的 interrupt key）。示例用 SQLite，所以 `run` 和 `resume` 可以是两条独立命令、跨进程：

```bash
cd examples/graph/nested_interrupt
# 1) 启动（会中断）
go run . -mode run -depth 3 -lineage-id demo
# Interrupted with prompt: Please type an approval string.
# Interrupt state: node="ask" task="approval"

# 2) 恢复（用上一步打印的 checkpoint ID）
go run . -mode resume -depth 3 -lineage-id demo \
  -checkpoint-id <id> -resume-value approved
# Completed. answer="approved"
```

> Node ID vs Task ID 是本示例的教学重点：Node ID 是"当前图里停在了哪个节点"（这里是 `ask`），Task ID 是 `ResumeMap` 要用的 key（这里是 interrupt key `approval`）。`nested_interrupt/README.md` 特意点出了这对概念。

---

## a2a_interrupt（跨 A2A 边界的中断传播）

一句话：把 `nested_interrupt` 的本地调用换成 **A2A（Agent-to-Agent）网络调用**——父图通过 `A2AAgent` 调远程 GraphAgent，远程图在中断点暂停，中断元数据**穿透 A2A 协议边界**传回父图，父图检查点记录子图信息，恢复时再穿透回去续跑远程图。源码：[`trpc-agent-go/examples/graph/a2a_interrupt/`](../../../../trpc-agent-go/examples/graph/a2a_interrupt)。

**触发机制**：远程图的 `remote_ask_approval` 节点调 `graph.Interrupt`（与本地版完全一样的 API）；难点全在**中断元数据如何跨进程传输**。答案是：复用现有 `state_delta` 信封里的 `_pregel_metadata`（`graph.MetadataKeyPregel`），不需要单独的控制通道：

```
下行（中断, Server→Client）:
  Graph Engine → event.StateDelta[_pregel_metadata]
    → A2A Server 编码进 message metadata["state_delta"]
    → A2A Agent 解码回 event.StateDelta[_pregel_metadata]
    → 父图提取 lineage/checkpoint/namespace → 写父检查点（带 StateKeySubgraphInterrupt）

上行（恢复, Client→Server）:
  父图 RuntimeState[lineage_id, checkpoint_id, ResumeMap]
    → A2A message.Metadata（扁平化键）
    → Server 还原成 graph.ResumeCommand → 远程图从检查点续跑
```

**关键配置**：A2A server **必须**把中断相关图事件加入白名单，否则中断事件被过滤掉、客户端永远检测不到暂停：

```go
// a2a_interrupt/main.go:107
server, _ := a2aserver.New(
    a2aserver.WithAgent(remoteAgent, *streaming),
    a2aserver.WithHost(resolvedHost),
    a2aserver.WithGraphEventObjectAllowlist(
        graph.ObjectTypeGraphExecution,
        graph.ObjectTypeGraphNodeCustom,
        graph.ObjectTypeGraphPregelStep,            // 中断元数据走这里
        graph.ObjectTypeGraphCheckpointInterrupt,
    ),
    a2aserver.WithStreamingEventType(a2aserver.StreamingEventTypeMessage),
)
```

**两阶段流程**（支付风控场景）：Phase 1 父图 `parent_intake` → 调远程图 → 远程跑完风险信号/判定后在 `remote_ask_approval` 中断 → 父图检查点记录；Phase 2 用 `ResumeMap{remote_ask_approval: true}` 恢复父图 → 穿透到远程续跑 → 远程 `finalize` → 映射回父图 → `parent_decision_draft` / `parent_finalize`。

```bash
cd examples/graph
export OPENAI_API_KEY=... OPENAI_BASE_URL=...
go run ./a2a_interrupt -streaming=true

# Phase 1 Result
#   Status            : Parent graph stopped because remote graph raised an interrupt
#   Parent checkpoint : <id>
#   Remote checkpoint : <id>
#   Interrupt key     : remote_ask_approval
#   Resume payload    : ResumeMap{remote_ask_approval: true}
# Phase 2 Result
# Final decision ... Action: Decision draft: Manual approval granted ...
```

> 这是 9 个示例里最重的一个（单文件 ~950 行）。风险评定被硬编码成 `HIGH` 以保证输出确定性，让注意力集中在中断传播机制上。

---

## userinputonce（单次输入消费 - 非中断基线）

一句话：本主题里**唯一不使用中断**的示例——用户输入一次，LLM 节点消费后自动从状态中清除，图一口气跑完。它代表"单轮人机交互"的最简形态，与上面 8 个"暂停-恢复"示例形成对照。源码：[`trpc-agent-go/examples/graph/userinputonce/`](../../../../trpc-agent-go/examples/graph/userinputonce)。

**机制**：没有任何 `graph.Interrupt` / CheckpointSaver。靠的是 LLM 节点对 `StateKeyUserInput` 的"一次性消费"语义——执行后 `user_input` 被清空，靠后继 `verifyCleared` 节点验证：

```go
// userinputonce/main.go:90 —— 图只有两个节点，无中断
stateGraph.AddLLMNode("ask", modelInstance,
    "You are a helpful assistant. Answer concisely.", map[string]tool.Tool{}).
    AddNode("verify", verifyCleared).
    SetEntryPoint("ask").SetFinishPoint("verify")

// verify 节点确认 user_input 已被清空
func verifyCleared(ctx context.Context, state graph.State) (any, error) {
    if v, _ := state[graph.StateKeyUserInput].(string); v == "" {
        fmt.Println("🔍 Verification: user_input is cleared (LLM consumed it once).")
    }
    return nil, nil
}
```

**为什么归在这一主题**：它是 HITL 的"退化/无暂停"基线——用户输入只进来一次、不需要恢复。理解了它，才能看清"中断"真正解决的是什么：**当输入需要在执行中途某处介入、而不是开跑前一次性给足**时，才需要前 8 个示例的暂停-恢复机制。

**运行**：

```bash
cd examples/graph/userinputonce
export OPENAI_API_KEY=...
go run . -input "Hello, world!"
# 🤖: <回答>
# 🔍 Verification: user_input is cleared (LLM consumed it once).
```

---

## 选型对比

| 你的需求 | 选哪个 | 触发机制 / 暂停来源 |
|---------|--------|------------------|
| 审批/确认等明确业务暂停点 | `interrupt` | 动态 / 图节点 |
| 同上，但跑在并行 DAG 引擎 | `dag_interrupt` | 动态 / 图节点 |
| 调试/审计，想在节点前后看状态 | `static_interrupt` | 静态声明（不改节点代码） |
| 从图外（监控、按钮）发起暂停 | `external_interrupt` | 外部 `WithGraphInterrupt` |
| 工具由调用方在进程外执行 | `externaltool` | 动态 / `BeforeTool` 回调 |
| 子 Agent 调外部工具，但保持子 Agent 纯粹 | `agentnode_llmagent_externaltool` | 动态 / 父图后继节点 |
| 本地多层子图，最深一层要人工介入 | `nested_interrupt` | 动态 / 子 GraphAgent（父图捕获） |
| 远程 Agent（跨网络）要人工介入 | `a2a_interrupt` | 动态 / 远程子图（穿透 A2A） |
| 单轮对话，不需要中途暂停 | `userinputonce` | 无中断（基线） |

### 关键 API 速查

| 机制 | 核心 API |
|------|---------|
| 动态中断 | `graph.Interrupt(ctx, state, key, prompt)` |
| 静态断点 | `graph.WithInterruptBefore()` / `graph.WithInterruptAfter()`（节点 Option） |
| 外部暂停 | `graph.WithGraphInterrupt(ctx)` → `(ctx, interrupt)`；`graph.WithGraphInterruptTimeout(d)` |
| 恢复 | `graph.StateKeyCommand` + `ResumeMap{taskID: value}`；或 `graph.NewResumeCommand().WithResumeMap(...)` |
| 恢复定位 | `graph.CfgKeyLineageID` + `graph.CfgKeyCheckpointID`（+ `CfgKeyCheckpointNS`） |
| 中断元数据事件 | `event.Object == graph.ObjectTypeGraphPregelStep` → `StateDelta[graph.MetadataKeyPregel]` |

## 关键要点

1. **区分"父图节点中断"与"子 Agent 中断"**。前者（`agentnode_llmagent_externaltool`）子 Agent 对中断无感知；后者（`nested_interrupt` / `a2a_interrupt`）父图通过 `StateKeySubgraphInterrupt` 捕获子图中断、恢复时自动续跑子图。
2. **外部中断看 `ExternalInterruptPayload.Forced`**。`false` = 安全边界（等当前 step 结束），`true` = 超时强停（取消在途任务）。两者都产出可恢复检查点。
3. **A2A 场景务必配 `WithGraphEventObjectAllowlist`**。漏掉 `ObjectTypeGraphPregelStep` 会导致中断事件被过滤、父图永远收不到暂停信号。
4. **静态断点不需要 `ResumeMap`**。它不消费用户输入，恢复时只带 `checkpoint_id` 即可，适合纯调试/审计。

> 动态中断的三态返回、CheckpointSaver 必要性、`ResumeMap` 命中 TaskID 等基础机制见前文「核心概念」。

## 总结

中断与恢复是把"一次性跑完的图"变成"可暂停、可介入、可续跑的长流程"的关键能力。本篇 9 个示例覆盖了三条主线：**节点内动态中断**（`interrupt`/`dag_interrupt`/`externaltool`）、**子 Agent 中断传播**（`nested_interrupt`/`a2a_interrupt`/`agentnode_llmagent_externaltool`）、**声明式与外部中断**（`static_interrupt`/`external_interrupt`），外加一个单轮基线（`userinputonce`）。

掌握本主题后，建议结合同目录其它专题深入：检查点的全生命周期管理见 graph-checkpoint，DAG 引擎的并发调度细节见 graph-dag，子图/AgentNode 嵌套与状态映射见 graph-subgraph，A2A 协议本身见 graph-a2a。中断机制正是这些能力交汇之处——它同时依赖 Checkpoint 落盘、事件元数据传播、父子图状态隔离，是 graph 包里综合性最强的一块。
