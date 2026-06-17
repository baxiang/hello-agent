# Graph 子图、子 Agent 与状态传递 - 组合、委托与 ReAct

> **源码路径**：[`trpc-agent-go/examples/graph/`](../../../../trpc-agent-go/examples/graph)（本篇覆盖 subgraph/isolated_subagent/a2asubagent/a2a_agent/subagent_runtime_state/agent_state_handoff/react）
> **主题**：组合与委托 · **难度**：进阶→高级

## 概述

当单个 Graph 不再够用，tRPC-Agent-Go 提供了一整套"图中有图、Agent 中有 Agent"的组合能力。本篇聚焦于 **7 个相互关联的示例**，沿着一条由近及远的能力轴线展开：

- **进程内组合**：`subgraph/` 把一个子 GraphAgent 嵌进父图的节点；`agent_state_handoff/` 用最小例子演示子 Agent 的状态如何回传给父图后续节点。
- **状态注入**：`subagent_runtime_state/` 展示父图的状态如何通过 `Invocation.RunOptions.RuntimeState` 流入子 Agent 的 model/tool 回调；`isolated_subagent/` 则反其道而行，让子 Agent 与父图会话历史**隔离**，同时保留自身当次调用内的工具链。
- **跨进程委托**：`a2asubagent/` 把一个 LLM Agent 通过 A2A 协议暴露为远端服务，再由父图通过 `a2aagent` 客户端节点调用；`a2a_agent/` 在此基础上把远端 GraphAgent 的完整 `state_delta` 跨网络回传到父图。
- **范式图**：`react/` 用一组 LLM/Tools 节点把经典的 Planner→Reasoning→Action→FinalAnswer→FormatOutput ReAct 循环拼成一张图，验证 `AddToolsConditionalEdges` 在多步推理中的作用。

理解了这条线，你就能在"单进程子图 → A2A 远端专家 → 跨图状态合并"之间自由切换。

## 核心概念

### 1. SubgraphNode 与 AgentNode 的关系

两者本质都是"图中的委托节点"，差别只在**被委托的对象类型**：

| 节点 API | 委托对象 | 注册方式 |
|----------|----------|----------|
| `AddSubgraphNode(name, opts...)` | 另一个 `*graphagent.GraphAgent`（子图） | 父 GraphAgent 通过 `WithSubAgents` 注册，节点名 == 子 Agent 名 |
| `AddAgentNode(name, opts...)` | 任意 `agent.Agent`（LLMAgent / A2A Agent / 子 GraphAgent） | 同上 |

`subgraph/main.go` 顶部注释说得很清楚：SubgraphNode 就是 AgentNode 之上的"糖衣"。两者共享同一套选项（`graph.WithSubgraphInputMapper`、`WithSubgraphOutputMapper`、`WithSubgraphIsolatedMessages`、`WithSubgraphEventScope`）。

### 2. 三条状态传递路径

子图/子 Agent 与父图之间共有三条独立的状态通道，理解它们的分工是本篇的关键：

```
┌─────────── 父 Graph ───────────┐
│                                 │
│   ① InputMapper  ──►  子 Agent  │   父 → 子：选择性传入字段
│                                 │
│   ② RuntimeState  ──►  回调 ctx │   父 → 子：通过 Invocation 透传
│                                 │
│   ③ OutputMapper ◄──  FinalState│   子 → 父：回收子图终态
│                                 │
└─────────────────────────────────┘
```

- **InputMapper**（`subgraph/`）：父图在调用子图前，按字段裁剪出一个新的 `graph.State` 传给子图，决定子图能"看到"哪些字段。
- **RuntimeState**（`subagent_runtime_state/`）：通过 `agent.WithRuntimeState(map[string]any{...})` 注入到本次 Run 的 `Invocation.RunOptions.RuntimeState`，子 Agent 的 model/tool 回调通过 `agent.InvocationFromContext(ctx)` 读取。**这是只读、运行时的横切参数，不会进入图状态。**
- **OutputMapper**（`agent_state_handoff/`、`a2a_agent/`）：子图执行完毕后，框架把 `graph.SubgraphResult{FinalState, RawStateDelta, LastResponse}` 交给 mapper，由它决定把哪些字段写回父图状态，供后续节点使用。

### 3. 消息隔离 vs 消息继承

默认情况下，子 Agent 会继承父图的会话历史（`include_contents=all`）。`WithSubgraphIsolatedMessages(true)` 把它切到 `none`：

- **继承**（默认）：适合多轮对话场景，子 Agent 能看到父图的上下文。
- **隔离**（`isolated_subagent/`）：适合"专家单问单答"场景，子 Agent 只看本次 user input，避免历史污染 ReAct 循环。

### 4. A2A 边界

A2A（Agent-to-Agent）协议把委托对象从"同进程的 Agent"扩展到"跨进程/跨机器的远端 Agent"。`a2aagent.New(...)` 包装出一个本地 stub，父图把它当普通 sub-agent 使用。关键问题在于 **`state_delta` 能否跨网络保留**——`a2a_agent/` 就是专门用来回归测试这条链路的。

### 5. ReAct 作为图

`react/` 不是用 `llmagent.WithPlanner(react.New())` 那种"封装好的 ReAct"，而是**把 Reason-Act 循环手动拆成图节点**：每个阶段一个 LLM 节点，循环靠 `AddToolsConditionalEdges` 在 reasoning ↔ tools 之间往返。这种方式把推理过程彻底可视化，每一步都能在事件流里观察到。

---

## subgraph（子图委托）

**一句话**：父图 `parse_input → assistant(subgraph) → collect`，子图是 `llm_decider ↔ tools` 的标准 Agent 循环，演示 InputMapper / OutputMapper / IsolatedMessages / EventScope 四件套。

源码：[`trpc-agent-go/examples/graph/subgraph/`](../../../../trpc-agent-go/examples/graph/subgraph)

### 关键代码

**1）子图：标准 LLM + Tools 循环**（`subgraph/main.go:241-253`）

```go
sg := graph.NewStateGraph(schema)
sg.AddLLMNode(
    nodeLLMDecide,
    mdl,
    "You are an assistant. If user asks to schedule a meeting, CALL the schedule_meeting tool...",
    tools,
)
sg.AddToolsNode(nodeTools, tools)
// LLM 决定是否调工具：有 tool_calls 去 tools，否则结束
sg.AddToolsConditionalEdges(nodeLLMDecide, nodeTools, graph.End)
// 工具执行后回到 LLM 总结
sg.AddEdge(nodeTools, nodeLLMDecide)
sg.SetEntryPoint(nodeLLMDecide).SetFinishPoint(nodeLLMDecide)
g, err := sg.Compile()

ga, err := graphagent.New(name, g,
    graphagent.WithDescription("Child subgraph: assistant with tools"))
```

**2）父图：四件套接线**（`subgraph/main.go:281-322`）

```go
var opts []graph.Option
// ① InputMapper：只把 parsed_time 传给子图
opts = append(opts, graph.WithSubgraphInputMapper(func(parent graph.State) graph.State {
    out := graph.State{}
    if v, ok := parent[keyParsedTime]; ok {
        out[keyParsedTime] = v
    }
    return out
}))
// ② IsolatedMessages：子图不继承父图会话历史
if cfg.SubIsolate {
    opts = append(opts, graph.WithSubgraphIsolatedMessages(true))
}
// ③ EventScope：子图事件加前缀，便于 UI 区分来源
if strings.TrimSpace(cfg.SubScope) != "" {
    opts = append(opts, graph.WithSubgraphEventScope(cfg.SubScope))
}
// ④ OutputMapper：把子图 LastResponse + FinalState 写回父状态
opts = append(opts, graph.WithSubgraphOutputMapper(func(parent graph.State, r graph.SubgraphResult) graph.State {
    return graph.State{
        keyChildLast:  r.LastResponse,
        keyChildFinal: r.FinalState,
    }
}))
sg.AddSubgraphNode(nodeSubgraph, opts...)
```

**3）子 Agent 注册**（`subgraph/main.go:135-141`）

```go
parentGA, err := graphagent.New(parentName, parentGraph,
    graphagent.WithDescription("Parent graph that delegates to child subgraph"),
    graphagent.WithInitialState(graph.State{}),
    graphagent.WithSubAgents([]agent.Agent{childGA}),  // 子图必须在此注册
)
```

> **易错点**：节点名 `nodeSubgraph = "assistant"` 必须与子 Agent 的名字 `childAgentName = "assistant"` 完全一致，框架据此把节点和已注册的子 Agent 关联起来。

**4）运行时切换 include_contents**（`subgraph/main.go:195-198`）

示例还演示了一个进阶用法——在 `r.Run(...)` 时通过 `agent.WithRuntimeState` 注入 `graph.CfgKeyIncludeContents`，运行时动态调整父→子的消息注入模式：

```go
runOpts := []agent.RunOption{}
if includeMode != "" {
    runOpts = append(runOpts,
        agent.WithRuntimeState(map[string]any{graph.CfgKeyIncludeContents: includeMode}))
}
evs, err := r.Run(ctx, user, session, model.NewUserMessage(msg), runOpts...)
```

### 运行

```bash
cd examples/graph/subgraph
export OPENAI_API_KEY=sk-...
export OPENAI_BASE_URL=https://api.deepseek.com   # 可选

go run .                                            # 默认参数
go run . -sub-isolate -sub-scope assistant -v      # 全开特性
```

交互命令：`include none|filtered|all`（运行时切换消息注入）、`samples`、`exit`。

### 预期输出（节选）

```
🧩 Subgraph Demo (Parent calls Child GraphAgent)
Model: deepseek-v4-flash
✅ Ready. Session: sess-...
> schedule a meeting tomorrow at 3pm titled team sync
...streaming assistant text…
---
[assistant] Scheduled meeting: ...
[final] {"last_response":"...","parsed_time":"2025-...","meeting":{...},
         "child_last":"...","child_final_keys":N}
```

---

## isolated_subagent（隔离子 Agent）

**一句话**：演示 `WithSubgraphIsolatedMessages(true)` 的正确语义——**屏蔽父图历史，但保留子 Agent 当次调用内的工具链**，让默认 builtin planner 的 ReAct 循环不会因为父图消息污染而反复调同一个工具。

源码：[`trpc-agent-go/examples/graph/isolated_subagent/`](../../../../trpc-agent-go/examples/graph/isolated_subagent)

### 关键代码

**1）子 Agent：带工具的 LLMAgent**（`isolated_subagent/main.go:157-191`）

```go
calculatorTool := function.NewFunctionTool(calculator,
    function.WithName("calculator"),
    function.WithDescription("Perform basic arithmetic operations. ..."))

return llmagent.New(childAgentName,
    llmagent.WithModel(mdl),
    llmagent.WithInstruction(instruction),
    llmagent.WithTools([]tool.Tool{calculatorTool}),
    llmagent.WithGenerationConfig(model.GenerationConfig{Stream: true}),
    llmagent.WithMaxToolIterations(*maxIter),  // 防死循环
)
```

instruction 明确要求"只调一次工具"，但若没有隔离，父图历史会混入子 Agent 上下文，模型可能误判而重复调用。隔离后才能稳定停在 1 次。

**2）父图：单选项启用隔离**（`isolated_subagent/main.go:200-217`）

```go
agentOpts := []graph.Option{}
if *isolate {
    agentOpts = append(agentOpts, graph.WithSubgraphIsolatedMessages(true))
}
sg.AddAgentNode(nodeAgent, agentOpts...)

sg.SetEntryPoint(nodePreprocess)
sg.AddEdge(nodePreprocess, nodeAgent)
sg.AddEdge(nodeAgent, nodeCollect)
sg.SetFinishPoint(nodeCollect)
```

### 运行

```bash
cd examples/graph/isolated_subagent
go run . -question "What is 12 + 7?"          # 一次性问
go run . -isolate=false -question "What is 12 + 7?"   # 对照组：不隔离
```

### 预期输出

```
Tool call #1: calculator({"operation":"add","a":12,"b":7})
Tool result: {"operation":"add","a":12,"b":7,"result":19}
12 + 7 = 19
----------------------------------------------------------------
Total tool calls: 1
Success! The agent correctly called the tool only once.
   WithSubgraphIsolatedMessages(true) properly isolates parent history
   while preserving the current invocation's tool call history.
```

对照组（`-isolate=false`）通常会出现 `Total tool calls > 1`，并打印告警 `Multiple tool calls detected`。

> **设计意图**：隔离针对的是 **session 历史的种子**，不是子 Agent 自己的当次消息流。这样 ReAct 的"看到上次 tool 结果→决定停止"逻辑仍然成立。

---

## a2asubagent（A2A 子 Agent 客户服工作流）

**一句话**：进程内启动一个 A2A server 暴露技术支持 LLM Agent，父图通过 `a2aagent.New(...)` 把它当 sub-agent 注册，按查询类型条件路由到本地 billing/general 节点或远端技术专家节点。

源码：[`trpc-agent-go/examples/graph/a2asubagent/`](../../../../trpc-agent-go/examples/graph/a2asubagent)

### 关键代码

**1）远端 LLM Agent + A2A server**（`a2asubagent/main.go:208-255`、`181-205`）

```go
// 远端：带 check_system_status / get_error_logs 工具的 LLM Agent
llmAgent := llmagent.New("technical-support-agent",
    llmagent.WithModel(modelInstance),
    llmagent.WithDescription(desc),
    llmagent.WithInstruction(desc),
    llmagent.WithGenerationConfig(genConfig),  // Stream: true，A2A 才能转发流
    llmagent.WithTools(tools),
)

server, err := a2a.New(
    a2a.WithHost(w.a2aHost),
    a2a.WithAgent(remoteAgent, true),   // 第二个参数 true = 启用 A2A 流式
    a2a.WithProcessMessageHook(...),    // 演示消息预处理钩子
)
go server.Start(w.a2aHost)
```

**2）父图侧：a2aagent 客户端 + GraphAgent 注册**（`a2asubagent/main.go:266-286`）

```go
a2aURL := fmt.Sprintf("http://%s", w.a2aHost)
a2aAgent, err := a2aagent.New(
    a2aagent.WithAgentCardURL(a2aURL),
    // 关键：名字必须与 AgentNode 节点 ID 一致，图才能解析到此 sub-agent
    a2aagent.WithName(nodeTechnicalSupport),
    a2aagent.WithTransferStateKey(a2aStateKeyMetadata),
)

graphAgent, err := graphagent.New("customer-support-coordinator", workflowGraph,
    graphagent.WithDescription("Customer support workflow with A2A technical support sub-agent"),
    graphagent.WithSubAgents([]agent.Agent{a2aAgent}),
    graphagent.WithInitialState(graph.State{}),
)
```

**3）图结构：条件路由**（`a2asubagent/main.go:333-371`）

```go
graph.NewStateGraph(schema).
    AddNode(nodeAnalyzeQuery, w.analyzeCustomerQuery, ...).
    AddAgentNode(nodeTechnicalSupport,
        graph.WithName(nodeTechnicalSupport),
        graph.WithDescription("Routes to A2A technical support agent..."),
    ).
    AddNode(nodeBillingSupport, w.handleBillingQuery, ...).
    AddNode(nodeGeneralSupport, w.handleGeneralQuery, ...).
    AddNode(nodeFormatResponse, w.formatFinalResponse, ...).
    // 关键技术/billing/general → 三个分支
    AddConditionalEdges(nodeAnalyzeQuery, w.routeByQueryType, map[string]string{
        queryTypeTechnical: nodeTechnicalSupport,
        queryTypeBilling:   nodeBillingSupport,
        queryTypeGeneral:   nodeGeneralSupport,
    }).
    SetEntryPoint(nodeAnalyzeQuery).
    AddEdge(nodeTechnicalSupport, nodeFormatResponse).
    AddEdge(nodeBillingSupport, nodeFormatResponse).
    AddEdge(nodeGeneralSupport, nodeFormatResponse).
    SetFinishPoint(nodeFormatResponse).
    Compile()
```

`routeByQueryType` 是个纯字符串路由器，根据 analyze 节点写入 `state[query_type]` 的值返回 `"technical"|"billing"|"general"`。

**4）携带元数据发往远端**（`a2asubagent/main.go:449`）

```go
events, err := w.runner.Run(ctx, w.userID, w.sessionID, userMessage,
    agent.WithRuntimeState(map[string]any{a2aStateKeyMetadata: "test"}),
)
```

`a2aagent.WithTransferStateKey("meta")` 表示把 RuntimeState 中 key 为 `meta` 的字段通过 A2A 协议传输给远端 Agent，远端 server 的 `ProcessMessageHook` 可在其 `message.Metadata` 里读到。

### 运行

```bash
cd examples/graph/a2asubagent
go run .                       # 跑 4 个内置示例
go run . -interactive          # 交互模式
go run . -a2a-host localhost:9999 -model gpt-4o
```

### 预期输出（节选）

```
🚀 Customer Support Workflow with A2A Sub-Agent Example
🔗 Starting A2A server on 0.0.0.0:8888...
A2A Server: received message:...
A2A Server: received state: map[meta:test]

--- Example 1 ---
Customer: My application is showing error 500, ...
🚀 Entering node: analyze_query (function)
🚀 Entering node: technical_support (agent)
   🤖 Executing A2A agent: technical_support
🤖 A2A Stream: ...remote agent streams diagnostics...
✅ A2A Completed
🤖 Final Response: 🎯 Customer Support Response
Query Type: technical
Priority: medium
...
```

---

## a2a_agent（跨图 A2A 状态回传）

**一句话**：父 GraphAgent 通过 A2A 调用远端 GraphAgent，**端到端验证远端图的 `state_delta` 能否跨网络保真回到父图**，并用 `WithSubgraphOutputMapper` 把远端字段映射为父图字段供后续节点使用。

源码：[`trpc-agent-go/examples/graph/a2a_agent/`](../../../../trpc-agent-go/examples/graph/a2a_agent)（含 `main.go` 与 `helpers.go`）

### 关键代码

**1）远端 GraphAgent：三节点写状态**（`a2a_agent/main.go:265-290`）

```go
compiled, err := graph.NewStateGraph(schema).
    AddNode(remoteNodeInput, stashRemoteInput).                          // 缓存原始 user_input
    AddLLMNode(remoteNodeModel, modelInstance,
        "You are the remote graph agent...Reply in exactly one concise English sentence that starts with 'Remote agent:'...",
        nil,
        graph.WithGenerationConfig(genConfig),
    ).
    AddNode(remoteNodeCapture, buildRemoteStateCaptureNode(modelName)).  // 把 LLM 回复 + payload 写入状态
    AddEdge(remoteNodeInput, remoteNodeModel).
    AddEdge(remoteNodeModel, remoteNodeCapture).
    SetEntryPoint(remoteNodeInput).
    SetFinishPoint(remoteNodeCapture).
    Compile()
```

`capture_remote_state` 节点同时写入三个 key（`a2a_agent/main.go:303-333`）：

```go
payload := map[string]any{
    "echo":              userInput,
    "model":             modelName,
    "source_agent":      remoteAgentName,
    "transport":         remoteTransportValue,
    "reply_chars":       len(reply),
    "transfer_verified": true,
}
return graph.State{
    remoteStateKeyValue:   reply,                 // 文本回复
    remoteStateKeyPayload: payload,               // 结构化元数据
    graph.StateKeyLastResponse: fmt.Sprintf("Remote graph completed with %d characters of reply.", len(reply)),
}, nil
```

**2）A2A sub-agent 与父图**（`a2a_agent/main.go:148-161`、`335-375`）

```go
a2aSubAgent, err := a2aagent.New(
    a2aagent.WithAgentCardURL(remoteURL),
    a2aagent.WithName(remoteAgentName),                   // 与 AddAgentNode 名字对齐
    a2aagent.WithEnableStreaming(*streaming),
)

compiled, err := graph.NewStateGraph(schema).
    AddAgentNode(remoteAgentName,
        graph.WithSubgraphOutputMapper(mapRemoteFinalState),  // 关键：状态回收
    ).
    AddNode(parentNodeFinalize, finalizeParentState).
    AddEdge(remoteAgentName, parentNodeFinalize).
    SetEntryPoint(remoteAgentName).
    SetFinishPoint(parentNodeFinalize).
    Compile()
```

**3）OutputMapper：双通道取值**（`a2a_agent/main.go:377-405`）

mapper 同时尝试两种数据源——子图最终状态 `result.FinalState` 和原始 `state_delta` 字节 `result.RawStateDelta`：

```go
func mapRemoteFinalState(_ graph.State, result graph.SubgraphResult) graph.State {
    value, _ := graph.GetStateValue[string](result.FinalState, remoteStateKeyValue)
    if value == "" {
        value = decodeRawString(result.RawStateDelta, remoteStateKeyValue)
    }
    payload := decodeStateMap(result.FinalState, remoteStateKeyPayload)
    if len(payload) == 0 {
        payload = decodeRawMap(result.RawStateDelta, remoteStateKeyPayload)
    }
    echoValue, _ := payload["echo"].(string)
    _, rawDeltaOK := result.RawStateDelta[remoteStateKeyValue]
    return graph.State{
        parentStateKeyValue:      value,
        parentStateKeyEcho:       echoValue,
        parentStateKeyPayload:    payload,
        parentStateKeyRawDeltaOK: rawDeltaOK,  // 用于断言 state_delta 真的到达父图
    }
}
```

**4）finalize 节点：消费映射后的值并断言**（`a2a_agent/main.go:407-441`）

```go
func finalizeParentState(_ context.Context, state graph.State) (any, error) {
    rawDeltaOK, ok := graph.GetStateValue[bool](state, parentStateKeyRawDeltaOK)
    if !ok || !rawDeltaOK {
        return nil, fmt.Errorf("remote state_delta was not available to the parent output mapper")
    }
    // ...
    return graph.State{
        graph.StateKeyLastResponse: fmt.Sprintf(
            "Parent graph confirmed remote state handoff from %s via %s. Echo=%q.",
            sourceAgent, strings.ToUpper(transport), echoValue,
        ),
    }, nil
}
```

只要任意一环失守（远端未发 graph.execution、A2A 丢了 state_delta、mapper 字段名写错），这个示例就会以非零码退出——它本身就是一条**端到端契约测试**。

### 运行

```bash
cd examples/graph/a2a_agent
go run ./a2a_agent                                   # 默认 A2A + 远端模型流
go run ./a2a_agent -streaming=false                  # 强制 unary
go run ./a2a_agent -streaming=true -model-streaming=false   # A2A 流式 + 模型非流式
go run ./a2a_agent -timeout=120s                     # 慢供应商增大超时
```

> `-host` 留空时会自动申请一个 `127.0.0.1:<随机端口>` 作为进程内 A2A server（`helpers.go:56-68`），并通过轮询 `/.well-known/agent.json` 等待 server 就绪，无需 `time.Sleep`。

### 预期输出（节选）

```
A2A host: 127.0.0.1:54321
A2A streaming: true
Remote model streaming: false
Input: Please explain why state handoff through the remote agent matters.

Remote graph event trace:
  PHASE  NODE                  TYPE
  ----   ----                  ----
  START  stash_remote_input    function
  START  remote_reply          llm
  END    remote_reply          llm
  START  capture_remote_state  function
  END    capture_remote_state  function

Remote agent reply:
Remote agent: State handoff matters because ...

Transferred remote state: OK
{
  "echo": "Please explain why state handoff through the remote agent matters.",
  "model": "deepseek-v4-flash",
  "source_agent": "remote_graph",
  "transport": "a2a",
  "reply_chars": 87,
  "transfer_verified": true
}

Raw state delta seen by parent mapper: true
Parent graph confirmation:
Parent graph confirmed remote state handoff from remote_graph via A2A. Echo="...".
```

---

## subagent_runtime_state（运行时状态注入子 Agent 回调）

**一句话**：pre 节点把 `scene_info` 和 `parsed_time` 写入图状态，子 Agent 通过 `agent.InvocationFromContext(ctx).RunOptions.RuntimeState` 在 model/tool 回调里读取这些字段——**让工具用图解析过的时间，而不是 LLM 瞎猜的时间**。

源码：[`trpc-agent-go/examples/graph/subagent_runtime_state/`](../../../../trpc-agent-go/examples/graph/subagent_runtime_state)

### 关键代码

**1）pre 节点：写状态**（`subagent_runtime_state/main.go:254-278`）

```go
func preNode(ctx context.Context, state graph.State) (any, error) {
    input, _ := state[graph.StateKeyUserInput].(string)
    sceneID, _ := state["scene_id"].(string)
    // ...
    sceneInfo := fmt.Sprintf("[Scene %s] You are helping with event-related tasks...", sceneID)
    parsed := parseTimeInText(input)  // 解析 "tomorrow at 3pm" 之类
    return graph.State{
        "scene_id":    sceneID,
        "scene_info":  sceneInfo,
        "parsed_time": parsed,
    }, nil
}
```

**2）子 Agent 工具：从 RuntimeState 取时间**（`subagent_runtime_state/main.go:156-171`）

```go
scheduleTool := function.NewFunctionTool(func(ctx context.Context, in scheduleArgs) (scheduleResult, error) {
    inv, _ := agent.InvocationFromContext(ctx)
    used := in.When
    if inv != nil && inv.RunOptions.RuntimeState != nil {
        if v, ok := inv.RunOptions.RuntimeState["parsed_time"].(string); ok && v != "" {
            used = v  // 用图解析的时间覆盖 LLM 给的时间
        }
    }
    if used == "" {
        used = time.Now().Format(time.RFC3339)
    }
    return scheduleResult{ScheduledAt: used, Title: in.Title, Source: "tool"}, nil
}, ...)
```

**3）model 回调：注入场景系统消息**（`subagent_runtime_state/main.go:174-187`）

```go
modelCbs := model.NewCallbacks().RegisterBeforeModel(func(ctx context.Context, args *model.BeforeModelArgs) (*model.BeforeModelResult, error) {
    inv, _ := agent.InvocationFromContext(ctx)
    if inv == nil || inv.RunOptions.RuntimeState == nil {
        return nil, nil
    }
    sceneInfo, _ := inv.RunOptions.RuntimeState["scene_info"].(string)
    if sceneInfo != "" {
        sys := sceneInfo + "\n\nGuidance:\n- Always respond in English.\n- If the user asks to schedule a meeting, CALL the schedule_meeting tool.\n- Use parsed_time from runtime state when present. ..."
        args.Request.Messages = append([]model.Message{model.NewSystemMessage(sys)}, args.Request.Messages...)
    }
    return nil, nil
})
```

**4）调用方注入初始 RuntimeState**（`subagent_runtime_state/main.go:118-129`）

```go
rt := map[string]any{"scene_id": *sceneID}
evts, err := r.Run(ctx, userID, sessionID, model.NewUserMessage(input),
    agent.WithRuntimeState(rt),
)
```

> **机制说明**：父图节点写入 `graph.State` 的字段会被框架合并进本次调用的 `Invocation.RunOptions.RuntimeState`，因此子 Agent 的回调能"穿越边界"读到。这是横切的运行时参数通道，不进入 StateSchema，也不参与 reducer 合并。

### 运行

```bash
cd examples/graph/subagent_runtime_state
go run . -api-key "$OPENAI_API_KEY" -base-url "$OPENAI_BASE_URL"
# 然后输入：
# > Schedule a sync with Alex tomorrow at 10am
# > Standup today at 3 pm
```

### 预期输出（节选）

```
🚀 Sub-Agent Runtime State (GraphAgent)
✅ Ready. Session: subagent-...
> Schedule a sync with Alex tomorrow at 10am
🟠 BeforeTool: using parsed_time from graph state = 2025-06-18T10:00:00+08:00
🟠 BeforeTool: scene_info available (62 chars)
🤖 [MODEL START] node=assistant model=deepseek-v4-flash
🔧 [TOOL START] schedule_meeting (id=...)
✅ [TOOL DONE] schedule_meeting -> {"scheduled_at":"2025-06-18T10:00:00+08:00",...}
💬 I've scheduled "Sync with Alex" for 2025-06-18 10:00.
```

---

## agent_state_handoff（最小状态回传示例）

**一句话**：最小化演示 OutputMapper——子 Agent 写 `child_value`，父图 mapper 把它拷成 `value_from_child`，下一个父图节点读出来用。整张图不调任何 LLM，纯函数节点，**无需 API Key 即可运行**。

源码：[`trpc-agent-go/examples/graph/agent_state_handoff/`](../../../../trpc-agent-go/examples/graph/agent_state_handoff)

### 关键代码

**1）子 Agent：单节点写状态**（`agent_state_handoff/main.go:108-147`）

```go
childGraph, err := graph.NewStateGraph(schema).
    AddNode(childNodeCompute, childComputeNode).
    SetEntryPoint(childNodeCompute).
    SetFinishPoint(childNodeCompute).
    Compile()

func childComputeNode(ctx context.Context, state graph.State) (any, error) {
    userInput, _ := graph.GetStateValue[string](state, graph.StateKeyUserInput)
    computed := childValuePrefix + userInput    // "computed: <input>"
    return graph.State{
        keyChildValue:              computed,   // 自定义 key
        graph.StateKeyLastResponse: computed,
    }, nil
}
```

**2）父图 + OutputMapper**（`agent_state_handoff/main.go:149-192`）

```go
parentGraph, err := graph.NewStateGraph(schema).
    AddAgentNode(childAgentName,
        graph.WithSubgraphOutputMapper(subgraphOutputMapper),
    ).
    AddNode(parentNodeUse, parentUseChildValueNode).
    AddEdge(childAgentName, parentNodeUse).
    SetEntryPoint(childAgentName).
    SetFinishPoint(parentNodeUse).
    Compile()

func subgraphOutputMapper(parent graph.State, result graph.SubgraphResult) graph.State {
    value, ok := graph.GetStateValue[string](result.FinalState, keyChildValue)
    if !ok {
        return nil
    }
    return graph.State{keyValueFromChild: value}   // 子 key → 父 key
}

func parentUseChildValueNode(ctx context.Context, state graph.State) (any, error) {
    value, ok := graph.GetStateValue[string](state, keyValueFromChild)
    if !ok {
        return nil, fmt.Errorf("missing state key: %s", keyValueFromChild)
    }
    final := parentValuePrefix + value            // "parent received: computed: <input>"
    return graph.State{graph.StateKeyLastResponse: final}, nil
}
```

**3）直接调用 Agent，不走 Runner**（`agent_state_handoff/main.go:206-234`）

```go
inv := agent.NewInvocation(
    agent.WithInvocationAgent(a),
    agent.WithInvocationMessage(model.NewUserMessage(userInput)),
)
eventChan, err := a.Run(ctx, inv)

for ev := range eventChan {
    if ev.Done && ev.Object == graph.ObjectTypeGraphExecution {
        completionEvent = ev   // 父图终态事件
    }
}
```

> 注意：父图和子图都会发 `graph.execution` 完成事件。本示例无歧义（只有一个子图节点），但 `a2a_agent/helpers.go:163-173` 的 `isParentGraphCompletion` 展示了更稳健的做法——靠父图特有的 state key 区分。

### 运行

```bash
cd examples/graph/agent_state_handoff
go run .                       # 默认 input=hello
go run . -input "hello graph"
```

### 预期输出

```
Input: hello
Value from child (via state): computed: hello
Final response: parent received: computed: hello
```

---

## react（ReAct 范式图）

**一句话**：把 ReAct 推理循环显式拼成 Planner → Reasoning ↔ Tools → FinalAnswer → FormatOutput 的图，用 `AddToolsConditionalEdges` 在 reasoning/tools 之间往返，最终把每阶段输出汇总成 JSON。

源码：[`trpc-agent-go/examples/graph/react/`](../../../../trpc-agent-go/examples/graph/react)

### 关键代码

**1）五节点图**（`react/main.go:117-146`）

```go
sg := graph.NewStateGraph(schema)
sg.
    AddLLMNode(nodePlanner, mdl, plannerInstruction, nil, streamOpt).
    AddLLMNode(nodeReasoning, mdl, reasoningInstruction, tools, streamOpt).
    AddToolsNode(nodeTool, tools).
    AddLLMNode(nodeFinalAnswer, mdl, finalInstruction, nil, streamOpt).
    AddNode(nodeFormatOutput, formatOutput)

sg.AddEdge(nodePlanner, nodeReasoning)
// 关键：reasoning 有 tool_calls → tools；否则 → finalanswer
sg.AddToolsConditionalEdges(nodeReasoning, nodeTool, nodeFinalAnswer)
sg.AddEdge(nodeTool, nodeReasoning)              // 工具执行后回到 reasoning
sg.AddEdge(nodeFinalAnswer, nodeFormatOutput)
sg.SetEntryPoint(nodePlanner)
sg.SetFinishPoint(nodeFormatOutput)
```

**2）formatOutput 汇总各节点响应**（`react/main.go:335-363`）

```go
func formatOutput(_ context.Context, state graph.State) (any, error) {
    finalText := readNodeResponse(state, nodeFinalAnswer)
    if finalText == "" {
        finalText = readNodeResponse(state, nodeReasoning)
    }
    payload := map[string]any{
        "final_answer":   strings.TrimSpace(finalText),
        "node_responses": state[graph.StateKeyNodeResponses],  // 框架自动收集的节点响应表
    }
    return graph.State{nodeFormatOutput: payload}, nil
}
```

`graph.StateKeyNodeResponses` 是框架维护的 `map[string]any`，每个节点的最终输出都会被自动归集到此字段，按节点 ID 索引——非常适合事后审计。

**3）阶段标签**（`react/main.go:365-378`）

`streamEvents` 用 `planner/react` 包提供的标签常量（`react.PlanningTag`、`react.ReasoningTag`、`react.ActionTag`、`react.FinalAnswerTag`）给每个节点打上对用户友好的阶段名：

```go
func nodeLabel(nodeID string) (string, bool) {
    switch nodeID {
    case nodePlanner:    return react.PlanningTag, true
    case nodeReasoning:  return react.ReasoningTag, true
    case nodeTool:       return react.ActionTag, true
    case nodeFinalAnswer:return react.FinalAnswerTag, true
    default:             return "", false
    }
}
```

> **与 `llmagent.WithPlanner(react.New())` 的区别**：本示例**没有用 react planner**，而是用图节点把 ReAct 显式拼出来。这样做的好处是每个阶段都是独立可观测、可中断、可替换的图节点（参见 `isolated_subagent/main.go:184-188` 的注释——那里反而把内置 react planner 的开关留作 TODO）。

### 运行

```bash
cd examples/graph/react
go run ./examples/graph/react -question "2*(4+3)"
# 或交互模式
go run ./examples/graph/react
```

### 预期输出（节选自 README）

```
---------- /*PLANNING*/ ----------
🤖 1. Identify the expression structure: ...
---------- /*REASONING*/ ----------
🤖 I need to calculate the expression 2*(4+3) by first evaluating the addition...
---------- /*ACTION*/ ----------
🔧 {"operation": "add", "a": 4, "b": 3}
✅ Tool result: {"operation":"add","a":4,"b":3,"result":7}
---------- /*REASONING*/ ----------
🤖 Now I need to multiply the result (7) by 2 to complete the calculation.
---------- /*ACTION*/ ----------
🔧 {"operation": "multiply", "a": 2, "b": 7}
✅ Tool result: {"operation":"multiply","a":2,"b":7,"result":14}
---------- /*FINAL_ANSWER*/ ----------
🤖 The result of 2*(4+3) is **14**.
[FormatOutput]
{
  "final_answer": "The result of 2*(4+3) is **14**.",
  "node_responses": { "finalanswer": "...", "planner": "...", "reasoning": "..." }
}
```

---

## 选型对比

### 进程内子图 vs A2A 远端

| 维度 | `subgraph` / `agent_state_handoff` | `a2asubagent` / `a2a_agent` |
|------|------------------------------------|------------------------------|
| 委托对象位置 | 同进程 | 跨进程/跨机器，经 A2A 协议 |
| 节点 API | `AddSubgraphNode` / `AddAgentNode` | `AddAgentNode`（sub-agent 是 `a2aagent`） |
| 注册方式 | `graphagent.WithSubAgents([]agent.Agent{...})` | 同上 |
| 状态传递 | 直接共享内存 `graph.State` | 经 A2A `state_delta` 序列化往返 |
| 主要风险 | 字段名错配、reducer 冲突 | 网络丢失 state_delta、远端 GraphAgent 没发 `graph.execution` |
| 适用场景 | 单体应用、需紧密耦合、追求低延迟 | 微服务化专家、跨语言/跨团队、独立扩缩容 |

### 状态隔离 vs 状态注入

| 模式 | 示例 | 目的 | 副作用 |
|------|------|------|--------|
| **IsolatedMessages** | `isolated_subagent` | 阻断父图 session 历史，避免污染子 Agent 的 ReAct 循环 | 子 Agent 看不到父图多轮上下文 |
| **RuntimeState 注入** | `subagent_runtime_state` | 把父图解析的结构化数据（时间、场景）透传到子 Agent 回调 | 只读、运行时，不入 StateSchema |
| **InputMapper** | `subgraph` | 选择性裁剪父状态字段送给子图 | 子图只看到白名单字段 |
| **OutputMapper** | `agent_state_handoff`、`a2a_agent` | 把子图终态字段映射回父图 | 字段重命名、断言 |

### 何时用 ReAct 图而非内置 planner

- **用 ReAct 图**（`react/`）：需要把每一步推理都暴露成可观测/可中断的节点、想替换某个阶段的 prompt、要在 `node_responses` 里留审计轨迹。
- **用 `llmagent.WithPlanner(react.New())`**：想要一个开箱即用、与 LLM 调用紧耦合的 ReAct 循环，无需自己接线。

---

## 关键要点

1. **节点名 == 子 Agent 名**：`AddSubgraphNode("assistant", ...)` 或 `AddAgentNode("assistant", ...)` 的节点名，必须与 `graphagent.WithSubAgents` 注册的某个子 Agent 的 `Name()` 完全一致，框架靠这个关联。`a2a_agent/main.go:271-272` 和 `a2asubagent/main.go:270-271` 都专门注释了这一点。

2. **OutputMapper 是子→父的唯一桥梁**：子图内部写的 `graph.State` 不会自动出现在父图，**必须**通过 `WithSubgraphOutputMapper` 把需要的字段显式映射回父图，后续父图节点才能读到（`agent_state_handoff/main.go:183-192`）。

3. **RuntimeState ≠ graph.State**：`agent.WithRuntimeState` 注入的是本次调用的横切参数（`Invocation.RunOptions.RuntimeState`），子 Agent 通过 `agent.InvocationFromContext(ctx)` 读取，**不会进 StateSchema、不参与 reducer 合并**。父图节点写 `graph.State` 的字段会被框架额外镜像到 RuntimeState，从而让子 Agent 回调也能读到（见 `subagent_runtime_state`）。

4. **A2A 链路的隐式契约**：远端 GraphAgent 必须发终止的 `graph.execution` 事件且携带 `state_delta`，A2A server 才能转发，父图 mapper 才能重建远端终态。`a2a_agent/` 把这条契约硬编码成了示例的断言——任何一环失守示例就 fail。

5. **IsolatedMessages 不隔离当次调用**：`WithSubgraphIsolatedMessages(true)` 只切断父图 **session 历史** 的种子注入；子 Agent 本次调用内自己产生的消息（含工具调用/响应）仍然按序保留，ReAct 循环因此能正常工作（`isolated_subagent/README.md:13-18`）。

6. **Runner 资源要 Close**：trpc-agent-go ≥ v0.5.0 起 `runner.Runner` 暴露了 `Close()`，所有交互式示例都用 `defer r.Close()` 释放后台 goroutine（如 `subgraph/main.go:151`、`isolated_subagent/main.go:139`）。

7. **多个 `graph.execution` 完成事件的歧义**：父图和每个子图都会发终止事件。简单场景（`agent_state_handoff`）取第一个即可；复杂场景（`a2a_agent`）应像 `helpers.go:163-173` 那样，靠父图特有的 state key 区分父子完成事件。

---

## 总结

本篇沿着"**进程内组合 → 状态注入/隔离 → 跨进程委托 → ReAct 范式**"四步，把 Graph 的组合与委托能力梳理了一遍。要点回放：

- **`subgraph`** 给出了 SubgraphNode 四件套（Input/Output Mapper + IsolatedMessages + EventScope）的完整接线；
- **`agent_state_handoff`** 用最薄的例子讲清了 OutputMapper 的"子 key → 父 key"映射；
- **`subagent_runtime_state`** 揭示了第三条状态通道——RuntimeState 横切注入，让工具和模型回调共享父图解析的上下文；
- **`isolated_subagent`** 反向操作，演示"隔离父图历史但保留当次工具链"的精准语义；
- **`a2asubagent`** 与 **`a2a_agent`** 把委托对象推到进程外，重点验证 A2A 协议下 `state_delta` 的端到端保真；
- **`react`** 展示了把推理范式本身拆成图节点的可行性，每个阶段都可独立观测和替换。

掌握了组合与委托后，可以继续阅读同系列的其他专题：

- **图拓扑与节点类型**：`graph-topology.md`（StateGraph 基础、节点类型、边/条件路由）
- **执行引擎与调度**：`graph-execution.md`（BSP vs DAG、parallel/fanout/diamond/join_edge）
- **中断与恢复**：`graph-interrupt.md`（HITL、Checkpoint、time_travel、nested_interrupt）
- **流式与 I/O 约定**：`graph-streaming-io.md`（stream_mode、streaming_node_consumer、io_conventions）
- **进阶模式**：`graph-advanced.md`（mapreduce、dag_engine、retry、error_handling、execution_trace、visualization 等其余示例）

它们与本篇共同构成了 Graph 工作流的完整知识图谱。
