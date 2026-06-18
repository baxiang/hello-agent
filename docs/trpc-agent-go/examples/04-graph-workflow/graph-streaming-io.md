# Graph 流式输出、单次执行与 IO 约定（OneShot / Placeholder）

> **源码路径**：[`trpc-agent-go/examples/graph/`](../../../../trpc-agent-go/examples/graph)
> **主题切片**：流式与单次执行（7 例）+ IO 约定与占位符（5 例）
> **难度**：进阶

## 概述

Graph 工作流除了"拓扑结构 + 路由"之外，还有三组同样重要的能力决定它能干什么活：

1. **流式（Streaming）**：事件过滤（StreamMode）、节点间流式管道（StreamOutput/StreamReader）、终止节点过滤（TerminalMessagesOnly）。
2. **单次执行（OneShot）**：在不污染会话历史的前提下，临时覆盖某一轮的模型输入——可整图覆盖、可按节点分发。
3. **IO 约定与占位符（I/O Conventions & Placeholders）**：节点如何读写 `graph.State` 的内置键（`last_response` / `node_responses` / `user_input` / `messages`），以及如何用 `{user:*}` / `{app:*}` / `{temp:*}` / `{invocation:*}` 占位符把动态值注入 LLM 指令。

本篇覆盖 12 个子示例：`stream_mode`、`streaming_node_consumer`、`oneshot_by_node`、`oneshot_by_node_preprocess`、`oneshotoverride`、`multiturn`、`terminal_messages_only`、`io_conventions`、`io_conventions_tools`、`invocation_placeholder`、`placeholder`、`retrieval_placeholder`。

## 核心概念

### StreamMode：单次运行的事件过滤开关

Runner 内部会产生很多事件（模型增量、节点生命周期、检查点、自定义事件等），`agent.WithStreamMode(...)` 决定**哪些事件被转发到你的 `eventCh`**。可叠加：

```go
r.Run(ctx, uid, sid, msg,
    agent.WithStreamMode(
        agent.StreamModeMessages,   // chat.completion.chunk / chat.completion
        agent.StreamModeCustom,     // graph.node.custom
    ),
)
```

Graph 支持的模式：`messages` / `updates` / `checkpoints` / `tasks` / `debug` / `custom`。无论选什么，Runner 始终发出最后的 `runner.completion` 事件。

### OneShot 的两把钥匙

| 状态键 | 用途 | 写入方式 |
|--------|------|----------|
| `graph.StateKeyOneShotMessages`（`one_shot_messages`） | 整图共享的一份一次性消息序列 | 节点返回 `graph.State{...}` 直接写 |
| `graph.StateKeyOneShotMessagesByNode`（`one_shot_messages_by_node`） | 按 nodeID 分桶，避免并行分支互相覆盖 | `graph.SetOneShotMessagesForNode(id, msgs)` 或 `graph.SetOneShotMessagesByNode(map)` |

**优先级**：OneShot > UserInput > 历史；执行后**自动清空**，不污染持久会话。

### 占位符四级作用域

| 写法 | 来源 | 生命周期 |
|------|------|----------|
| `{key}`、`{key?}` | 会话级（只读） | 跨多轮保留 |
| `{user:key}` | 用户级（可变） | 跨该用户所有会话 |
| `{app:key}` | 应用级（可变） | 全应用共享 |
| `{temp:key}` | `session.StateTempPrefix` | 仅当轮（不持久化） |
| `{invocation:key}` / `{invocation:key?}` | `invocation.SetState` | 仅本次 run |

`?` 后缀表示可选：键缺失时渲染为空串。LLM 节点执行前框架自动从 session state 展开占位符。

---

## stream_mode（StreamMode 事件过滤）

一句话：用 `agent.WithStreamMode(agent.StreamModeMessages)` 让 Runner 只转发模型消息事件，屏蔽 `graph.node.*` / `graph.checkpoint.*` 等噪音。

源码：[`trpc-agent-go/examples/graph/stream_mode/`](../../../../trpc-agent-go/examples/graph/stream_mode)

节点用 `graph.GetEventEmitter(state)` 手工 emit 两个 `chat.completion.chunk` 增量 + 一个 `chat.completion` 终止事件，main 循环按 `e.Object` 分发：

```go
eventCh, err := r.Run(ctx, userID, sessionID,
    model.NewUserMessage(userInputText),
    agent.WithStreamMode(agent.StreamModeMessages))
for e := range eventCh {
    switch e.Object {
    case model.ObjectTypeChatCompletionChunk:
        fmt.Print(e.Choices[0].Delta.Content)
    case model.ObjectTypeChatCompletion:
        fmt.Printf("\n(final) %s\n", e.Choices[0].Message.Content)
    }
}
```

运行（纯本地，无需 API Key）：

```bash
cd examples/graph/stream_mode && go run .
```

---

## streaming_node_consumer（节点间流式管道）

一句话：上游 LLM 节点边产出 token、下游消费者节点边读取，**无需等模型调用结束**。

源码：[`trpc-agent-go/examples/graph/streaming_node_consumer/`](../../../../trpc-agent-go/examples/graph/streaming_node_consumer)

关键技术：

```go
// 上游：声明流输出
sg.AddLLMNode(nodeLLM, llm, prompt, nil,
    graph.WithStreamOutput(streamNameLLM),  // "llm:deltas"
)

// 下游：用 bufio.Scanner 逐行消费
r, _ := graph.OpenStreamReader(ctx, streamNameLLM)
defer r.Close()
scanner := bufio.NewScanner(r)
for scanner.Scan() {
    _ = emitter.EmitText(line)  // 可在消费时实时派发 custom 事件
}
```

拓扑是 `setup` fan-out 到 `{llm, consume}`，再用 `AddJoinEdge` 汇聚到 `finish`。注意：**Stream 是临时管道**，不能用于 checkpoint 或持久化。需要 `-print-llm` 才会打印原始 LLM 增量。

```bash
export OPENAI_API_KEY=...
cd examples/graph/streaming_node_consumer
go run . -prompt "Write a 6-line welcome script for a podcast." -lines 6
```

---

## oneshot_by_node（并行分支的 OneShot 分发）

一句话：两条并行分支各自给不同的 LLM 节点准备 one-shot 输入，用 `SetOneShotMessagesForNode` 按 nodeID 分桶避免互相覆盖。

源码：[`trpc-agent-go/examples/graph/oneshot_by_node/`](../../../../trpc-agent-go/examples/graph/oneshot_by_node)

```go
// prep_a 节点为 llm1 准备
return graph.SetOneShotMessagesForNode(nodeLLM1, []model.Message{
    model.NewSystemMessage("You are llm1..."),
    model.NewUserMessage(*q1),
}), nil
```

> **解决的痛点**：`one_shot_messages` 是单 key，并行分支同时写会"最后写入获胜"；`one_shot_messages_by_node` 用 map 分桶，每个 LLM 节点只读自己那一份并清空自己。

图结构：`start → {prep_a→llm1, prep_b→llm2} → End`。运行后打印 `node_responses` 和剩余的 `one_shot_messages_by_node` 条目数（应为 0）。

```bash
cd examples/graph/oneshot_by_node && go run . -model deepseek-v4-flash
```

---

## oneshot_by_node_preprocess（单节点准备多节点 OneShot）

一句话：单个上游节点一次性为多个下游 LLM 节点写好 one-shot 输入，用 `graph.SetOneShotMessagesByNode` 一次性返回完整 map。

源码：[`trpc-agent-go/examples/graph/oneshot_by_node_preprocess/`](../../../../trpc-agent-go/examples/graph/oneshot_by_node_preprocess)

```go
func preprocess(ctx context.Context, state graph.State) (any, error) {
    byNode := map[string][]model.Message{
        nodeLLM1: {model.NewSystemMessage("You are llm1..."), model.NewUserMessage(*q1)},
        nodeLLM2: {model.NewSystemMessage("You are llm2..."), model.NewUserMessage(*q2)},
    }
    return graph.SetOneShotMessagesByNode(byNode), nil
}
```

> **解决的痛点**：在同一个节点里多次调 `SetOneShotMessagesForNode` 然后合并 `State`，因为 Go map 同 key 覆盖，早写的条目会丢失；`SetOneShotMessagesByNode` 一次返回完整 map，绕开这个陷阱。

示例自带一个 in-process `echoModel`，所以**不需要外部模型凭证**即可运行。

```bash
cd examples/graph/oneshot_by_node_preprocess && go run .
```

---

## oneshotoverride（单轮输入全量覆盖）

一句话：用 `graph.StateKeyOneShotMessages` 为某轮构造完整的 system+user 序列，完全接管模型输入，并在下一节点验证它已被自动清空。

源码：[`trpc-agent-go/examples/graph/oneshotoverride/`](../../../../trpc-agent-go/examples/graph/oneshotoverride)

```go
stateGraph.AddNode("set_oneshot", func(ctx context.Context, state graph.State) (any, error) {
    return graph.State{
        graph.StateKeyOneShotMessages: []model.Message{
            model.NewSystemMessage(sysText),
            model.NewUserMessage(userText),
        },
    }, nil
}).
AddLLMNode("ask", modelInstance, "Answer the user's question. Be concise.", map[string]tool.Tool{}).
AddNode("verify", verifyOneShotCleared)
```

关键特性：**优先级 OneShot > UserInput > History**；如果尾部消息是 user，会自动 `ReplaceLastUser` 到持久历史；执行成功后原子清空。`verify` 节点读取 `state[graph.StateKeyOneShotMessages]` 确认 `len==0`。

```bash
cd examples/graph/oneshotoverride
go run . -model deepseek-v4-flash -sys "You are a creative storyteller." \
    -input "Tell me a story about a robot learning to paint."
```

---

## multiturn（多轮对话 + 工具循环）

一句话：一个 `chat` LLM 节点 + 一个 `tools` 节点，用 `AddToolsConditionalEdges` 构成 Agent 循环；同一 sessionID 反复 `r.Run` 即可让历史跨轮持久化。

源码：[`trpc-agent-go/examples/graph/multiturn/`](../../../../trpc-agent-go/examples/graph/multiturn)

```go
sg := graph.NewStateGraph(schema).
    AddLLMNode("chat", llm, instruction, tools).
    AddToolsNode("tools", tools).
    AddNode("end", end).
    AddToolsConditionalEdges("chat", "tools", "end").  // 有 tool_calls 走 tools，否则走 end
    AddEdge("tools", "chat").                          // 工具结果回流给 LLM
    SetEntryPoint("chat").SetFinishPoint("end")
```

工具是一个 `calculator(a, b, op)` 函数工具，支持 `+ - * / ^`。会话历史由 `runner.WithSessionService(...)`（默认 in-memory）维护；**同一个进程内**多次调用 `r.Run` 共享 `sessionID` 即可保留上下文。要跨进程保留，需固定 `sessionID` 并换持久化后端。

```bash
cd examples/graph/multiturn && go run . -model deepseek-v4-flash
# You: what is (12.5+3)*2?
```

---

## terminal_messages_only（只看终止节点消息）

一句话：父子图结构里，用 `agent.WithGraphTerminalMessagesOnly(true)` 让上层只收到**终止子图**的消息事件，中间草稿节点的输出对调用方不可见——但内部状态流转不变。

源码：[`trpc-agent-go/examples/graph/terminal_messages_only/`](../../../../trpc-agent-go/examples/graph/terminal_messages_only)

```go
parentGraph, _ := graph.NewStateGraph(graph.MessagesStateSchema()).
    AddAgentNode(draftAgentName).
    AddAgentNode(finalAgentName, graph.WithSubgraphInputFromLastResponse()).
    AddEdge(draftAgentName, finalAgentName).
    SetEntryPoint(draftAgentName).SetFinishPoint(finalAgentName).Compile()

invocation := agent.NewInvocation(
    agent.WithInvocationMessage(model.NewUserMessage(userInputText)),
    agent.WithInvocationRunOptions(agent.NewRunOptions(
        agent.WithGraphTerminalMessagesOnly(terminalOnly),  // true / false 对照
    )),
)
```

默认模式会看到 `parent/draft chunk: ...` + `parent/final chunk: ...`；开启后只剩 `parent/final`。注意 `final` 子图仍然通过 `WithSubgraphInputFromLastResponse()` 拿到 `draft` 的输出——**只是事件层过滤，不影响内部执行**。若希望终止节点也透出 `Done=true` 的最终 assistant 消息事件，可叠加 `agent.WithGraphEmitFinalModelResponses(true)`。

```bash
cd examples/graph/terminal_messages_only && go run .   # 无需 API Key
```

---

## io_conventions（节点 I/O 约定）

一句话：演示 `parse_input → llm_summary → capture_llm → assistant（子 Agent）→ collect` 全链路里，函数节点 / LLM 节点 / Agent 节点如何通过内置状态键读写交接数据。

源码：[`trpc-agent-go/examples/graph/io_conventions/`](../../../../trpc-agent-go/examples/graph/io_conventions)

**LLM 节点的 I/O 约定**：

- 输入：`state["user_input"]`（一次性，消费后清空）、`state["one_shot_messages"]`（覆盖）、自定义键（如 `parsed_time`）
- 输出：追加 assistant 消息到 `state["messages"]`，写 `state["last_response"]`，写 `state["node_responses"][<llm_node_id>]`

**Agent 节点（子图）的 I/O 约定**：

- 通过 `inv.RunOptions.RuntimeState` 收到完整 graph state（可在 model/tool 回调里读取）
- 完成后写 `last_response` 和 `node_responses[<agent_node_id>]`

```go
// 函数节点写自定义键 + one_shot 系统消息
return graph.State{
    "parsed_time":                 pt,
    graph.StateKeyOneShotMessages: []model.Message{sys},
}, nil

// 子 Agent 通过 BeforeModel 回调读 RuntimeState
mcb.RegisterBeforeModel(func(ctx context.Context, args *model.BeforeModelArgs) (*model.BeforeModelResult, error) {
    inv, _ := agent.InvocationFromContext(ctx)
    if pt, _ := inv.RunOptions.RuntimeState["parsed_time"].(string); pt != "" {
        args.Request.Messages = append([]model.Message{model.NewSystemMessage("Use parsed_time=" + pt)}, args.Request.Messages...)
    }
    return nil, nil
})
```

```bash
go run ./examples/graph/io_conventions -api-key "$OPENAI_API_KEY" -model deepseek-v4-flash
# 试试：schedule a sync tomorrow at 10am
```

---

## io_conventions_tools（IO 约定 + Tools 节点）

一句话：在 `io_conventions` 基础上加 Tools 节点，演示 LLM 节点声明工具 → Tools 节点执行 → 下游节点解析最新 `role=tool` 消息 JSON 的完整路径。

源码：[`trpc-agent-go/examples/graph/io_conventions_tools/`](../../../../trpc-agent-go/examples/graph/io_conventions_tools)

```go
// LLM 节点带工具声明，可能 emit tool_calls
sg.AddLLMNode("llm_decider", mdl, instruction, tools)
// Tools 节点执行 tool_calls，把响应作为 role=tool 消息追加到 messages
sg.AddToolsNode("tools", tools)
// 条件路由：有 tool_calls 走 tools，否则走 assistant
sg.AddToolsConditionalEdges("llm_decider", "tools", "assistant")

// 下游 capture_tool 反向遍历 messages 找最新 role=tool 消息
for i := len(msgs) - 1; i >= 0; i-- {
    if msgs[i].Role == model.RoleTool {
        var out map[string]any
        json.Unmarshal([]byte(msgs[i].Content), &out)
        return graph.State{"meeting": out}, nil
    }
}
```

`schedule_meeting` 工具还能在执行时通过 `agent.InvocationFromContext(ctx)` 读 `RuntimeState["parsed_time"]` 兜底——演示**工具函数也能感知 graph 状态**。

```bash
go run ./examples/graph/io_conventions_tools -model deepseek-v4-flash
# 试试：schedule a meeting tomorrow at 10am titled sync with Alex
```

---

## invocation_placeholder（{invocation:*} 占位符）

一句话：用 `{invocation:request_id}` / `{invocation:case?}` 把**仅本次 run** 的元数据注入 LLM 指令；通过 BeforeAgent 回调 `inv.SetState` 设置，不写入 session。

源码：[`trpc-agent-go/examples/graph/invocation_placeholder/`](../../../../trpc-agent-go/examples/graph/invocation_placeholder)

```go
instruction := strings.Join([]string{
    "You are a helpful assistant.",
    "RequestID: {invocation:request_id}",   // 必填
    "Case: {invocation:case?}",             // 可选（缺失→空串）
    "Always start your reply with: RequestID=<id> Case=<case>",
}, "\n")
sg.AddLLMNode(nodeID, mdl, instruction, nil)

// BeforeAgent 回调里注入 invocation-scoped state
func (d *demo) beforeAgent(ctx context.Context, args *agent.BeforeAgentArgs) (*agent.BeforeAgentResult, error) {
    inv := args.Invocation
    inv.SetState(invKeyRequestID, inv.RunOptions.RequestID)
    if v := ctx.Value(ctxKeyCase{}); v != nil {
        inv.SetState(invKeyCase, v.(string))
    }
    return &agent.BeforeAgentResult{}, nil
}
```

> **对比 session 占位符**：`{key}` / `{user:*}` / `{app:*}` 会持久化；`{invocation:*}` 只活在当前 invocation，`/show-state` 看不到它。适合放 request_id、trace_id、A/B 实验桶等不该跨轮保留的元数据。

```bash
cd examples/graph/invocation_placeholder && go run . -model deepseek-v4-flash
# /case case-1
# > 帮我总结刚才的对话
```

---

## placeholder（{key}/{user:*}/{app:*} 占位符）

一句话：在单节点 LLM 图的指令里用会话级占位符注入研究主题、用户兴趣、应用 banner，并通过 `/set-user-topics`、`/set-app-banner` 实时修改。

源码：[`trpc-agent-go/examples/graph/placeholder/`](../../../../trpc-agent-go/examples/graph/placeholder)

```go
// 创建 session 时预填三类 state
d.sessionService.CreateSession(ctx, key, session.StateMap{
    "research_topics": []byte("artificial intelligence, machine learning..."),  // 只读
    "user:topics":     []byte("quantum computing, cryptography"),               // 用户级可变
    "app:banner":      []byte("Research Mode"),                                 // 应用级可变
})

// LLM 节点指令
sg.AddLLMNode("research-node", mdl,
    "Focus on read-only topics: {research_topics}. "+
        "Also consider user interests: {user:topics?}. "+
        "If an app banner is provided, show it briefly: {app:banner?}.", nil)
```

运行时修改：

```go
// 用户级
d.sessionService.UpdateUserState(ctx, userKey, session.StateMap{"topics": []byte(topics)})
// 应用级
d.sessionService.UpdateAppState(ctx, appName, session.StateMap{"banner": []byte(banner)})
```

> **注意**：in-memory 实现里 `temp:*` 和 `app:*` 被 `UpdateUserState` 拒绝，必须用对应作用域的 API。

```bash
cd examples/graph/placeholder && go run . -model deepseek-v4-flash
# /set-user-topics quantum computing, cryptography
# > What are the latest developments?
```

---

## retrieval_placeholder（{temp:*} + Retrieve→LLM RAG 模式）

一句话：检索节点把召回结果写入 `session.StateTempPrefix+"retrieved_context"`，LLM 节点的指令用 `{temp:retrieved_context}` 自动展开，实现无需改 `AddLLMNode` 的轻量 RAG。

源码：[`trpc-agent-go/examples/graph/retrieval_placeholder/`](../../../../trpc-agent-go/examples/graph/retrieval_placeholder)

```go
sg.AddNode("retrieve", func(ctx context.Context, st graph.State) (any, error) {
    input, _ := st[graph.StateKeyUserInput].(string)
    contextText := strings.Join(fakeRetrieve(input), "\n• ")
    // 从 state 取出 *session.Session，写 temp: 键
    if sessVal, ok := st[graph.StateKeySession]; ok {
        if sess, ok := sessVal.(*session.Session); ok {
            sess.SetState(session.StateTempPrefix+"retrieved_context", []byte(contextText))
            sess.SetState(session.StateTempPrefix+"user_input", []byte(input))
        }
    }
    return graph.State{}, nil  // 无需改 graph state
})

instruction := "Context:\n{temp:retrieved_context}\nQuestion: {temp:user_input}"
sg.AddLLMNode("answer", mdl, instruction, nil)
```

> **关键点**：`temp:*` 不会被持久化，适合"本轮 prompt 组装用的中间值"。GraphAgent 会把当前 `*session.Session` 注入 graph state（`graph.StateKeySession`），所以节点能直接拿到。并发分支同时写同一 temp 键时，应先 fan-in 到单节点再写。

```bash
cd examples/graph/retrieval_placeholder && go run . -model deepseek-v4-flash
# > What is the impact of quantum error correction?
```

---

## 选型对比

### 流式 / 单次执行

| 子示例 | 核心机制 | 典型场景 |
|--------|----------|----------|
| stream_mode | `WithStreamMode` 过滤事件 | 调试、降噪 |
| streaming_node_consumer | `WithStreamOutput` + `OpenStreamReader` | LLM → parser → TTS/UI 实时管线 |
| oneshot_by_node | `SetOneShotMessagesForNode` 并行分支 | 多分支各喂不同 prompt |
| oneshot_by_node_preprocess | `SetOneShotMessagesByNode` 单节点批写 | 上游预处理后扇出 |
| oneshotoverride | `StateKeyOneShotMessages` 整图覆盖 | 测试、动态 system prompt |
| multiturn | 同 sessionID 反复 `Run` + tools 循环 | 聊天式 Agent |
| terminal_messages_only | `WithGraphTerminalMessagesOnly` | 产品 UI 只露最终答案 |

### IO 与占位符

| 子示例 | 节点 I/O | 占位符作用域 |
|--------|----------|--------------|
| io_conventions | LLM/Agent 节点内置键 | — |
| io_conventions_tools | 增加 Tools 节点 + role=tool 解析 | — |
| placeholder | 函数节点写 session | `{key}` / `{user:*}` / `{app:*}`（持久） |
| retrieval_placeholder | Retrieve 节点写 temp | `{temp:*}`（每轮临时） |
| invocation_placeholder | BeforeAgent 写 invocation | `{invocation:*}`（每次 run） |

### OneShot 三种写法怎么选

| 场景 | 推荐 API |
|------|----------|
| 单 LLM 节点临时接管输入 | `graph.StateKeyOneShotMessages` |
| 并行分支各自准备（在分支节点内写） | `graph.SetOneShotMessagesForNode(id, msgs)` |
| 单上游节点一次为多个下游准备 | `graph.SetOneShotMessagesByNode(map)` |

## 关键要点

1. **StreamMode 是事件过滤，不是流式开关**：模型流式输出由模型自身决定，StreamMode 只决定 Runner 转发哪些事件到 `eventCh`。
2. **节点间流式 ≠ 状态**：`WithStreamOutput` 建的是临时管道，下游用完即弃；要持久化请写 `last_response` / `node_responses` 或自定义 state 键。
3. **OneShot 不会污染历史**：用完即清，且尾部 user 消息会智能 `ReplaceLastUser` 或追加到持久历史，避免重复。
4. **并行分支写同一 state 键会"最后写入获胜"**：涉及多分支时优先用 `*_by_node` 分桶写。
5. **占位符按生命周期选**：跨轮配置用 `{user:*}`/`{app:*}`；每轮 prompt 装配用 `{temp:*}`；request 元数据用 `{invocation:*}`。
6. **TerminalMessagesOnly 只过滤事件**：内部状态流转（如 `WithSubgraphInputFromLastResponse`）不变，所以中间节点仍然能影响最终结果。
7. **节点都能读 RuntimeState**：通过 `agent.InvocationFromContext(ctx)` 拿到 `inv.RunOptions.RuntimeState`，工具函数、model 回调都能感知 graph 状态。

## 总结

本篇覆盖了 Graph 工作流"拓扑之外"的三大支柱：**事件流的过滤与节点间管道**、**OneShot 输入的临时接管**、**节点 I/O 约定与四级占位符**。这些机制让 Graph 既能做实时管线（流式）、又能做精细的 prompt 控制（OneShot + 占位符），同时保持会话历史的干净。

要继续深入 Graph 的其他维度，可参考同目录的兄弟主题文章：

- [`graph-topology.md`](./graph-topology.md)：基础结构、条件边、并行/菱形/Join、子图嵌套、MapReduce
- [`graph-execution.md`](./graph-execution.md)：BSP vs DAG 引擎、节点缓存、执行轨迹、并发竞态
- [`graph-interrupt.md`](./graph-interrupt.md)：HITL 中断恢复、Checkpoint、时间旅行、嵌套中断
- [`graph-subagent.md`](./graph-subagent.md)：SubgraphNode、AgentNode、A2A、状态交接
- [`graph-advanced.md`](./graph-advanced.md)：MCP 工具、节点回调、Runner 插件、结构导出、可视化、Call Options（本系列的姊妹篇）
