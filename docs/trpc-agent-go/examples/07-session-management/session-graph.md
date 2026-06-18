# Session Graph Agent 集成 - 图编排与状态持久化

> **源码路径**：[`trpc-agent-go/examples/session/graph/`](../../../../trpc-agent-go/examples/session/graph)
> **示例类型**：交互式 Chat · **难度**：进阶

## 概述

`graph/` 把 Session 系统接入 **Graph Agent**（`graphagent.GraphAgent`）——用 `graph.StateGraph` 编排多步处理流水线（普通节点 + Agent 节点），并验证一个关键设计：图执行的完整快照（messages、node_responses 等）**不会**污染 `session.State`，只有精简的业务字段和响应身份标识会被持久化。

与 [`simple`](./session-simple.md) 的对比：simple 用单一 `llmagent`（一问一答）；graph 用 `graphagent`（多节点流水线 + 子 Agent）。两者共享同一套 `Runner + SessionService` 基础设施，但 graph 展示了"复杂编排如何与会话协作"。

## 核心概念

### Graph Agent：把流水线包成一个 Agent

`graphagent.New(name, compiledGraph, ...)` 把一张编译后的 `StateGraph` 包装成一个 `agent.Agent`，因此可以直接喂给 `runner.NewRunner`，享受 Session 持久化、事件流、请求追踪等所有 Runner 能力。

```go
c.runner = runner.NewRunner(
    appName,
    graphAgent,                          // Graph Agent 当作普通 Agent 用
    runner.WithSessionService(c.sessionService),
)
```

### 四节点流水线

本示例的图是一条线性流水线：

```
normalize → answer → assistant(AgentNode) → collect
```

| 节点 | 类型 | 职责 |
|------|------|------|
| `normalize` | 普通节点 | 小写化 + 压缩空白，写入 `normalized_input` |
| `answer` | 普通节点 | 基于规范化输入生成草稿，写入 `draft_answer` |
| `assistant` | **Agent 节点** | 调 LLM 子 Agent 把草稿改写成最终回复 |
| `collect` | 普通节点 | 收集业务结果 + 设置 `last_response` / `last_response_id` |

### 关键设计：快照不进 State

图执行过程中会产生大量中间状态（消息列表、节点响应、completion 元数据等）。本示例特意打印这些 key 在 `session.State` 里的存在性，验证它们**都是 false**：

```go
func graphSnapshotKeys() []string {
    return []string{
        graph.StateKeyMessages,           // false
        graph.StateKeyUserInput,          // false
        graph.StateKeyLastResponse,       // false
        graph.StateKeyLastToolResponse,   // false
        graph.StateKeyNodeResponses,      // false
        graph.MetadataKeyCompletion,      // false
    }
}
```

只有业务字段（`normalized_input`、`draft_answer`、`agent_reply`、`business_result`）和 `last_response_id`（用于 runner resume 与去重）会被持久化——这避免了巨型消息列表撑爆会话存储。

## 代码解析

### State Schema 扩展（`main.go`）

以 `graph.MessagesStateSchema()` 为基础，追加 5 个业务字段：

```go
schema := graph.MessagesStateSchema()
schema.AddField(keyNormalized, graph.StateField{Type: reflect.TypeOf(""), Reducer: graph.DefaultReducer})
schema.AddField(keyDraft,      graph.StateField{Type: reflect.TypeOf(""), Reducer: graph.DefaultReducer})
schema.AddField(keyAgentReply, graph.StateField{Type: reflect.TypeOf(""), Reducer: graph.DefaultReducer})
schema.AddField(keyAgentReplyID, graph.StateField{Type: reflect.TypeOf(""), Reducer: graph.DefaultReducer})
schema.AddField(keyBusiness,   graph.StateField{Type: reflect.TypeOf(""), Reducer: graph.DefaultReducer})
```

每个字段都配 `DefaultReducer`（后值覆盖前值），适合"每轮重写"语义。

### AgentNode 的输入输出映射

`assistant` 是一个 Agent 节点，需要把父图状态映射成子 Agent 输入，再把子 Agent 结果映射回父图：

```go
sg.AddAgentNode(
    "assistant",
    graph.WithSubgraphInputMapper(func(parent graph.State) graph.State {
        return graph.State{graph.StateKeyUserInput: parent[keyDraft]}  // 用草稿当输入
    }),
    graph.WithSubgraphOutputMapper(func(parent graph.State, result graph.SubgraphResult) graph.State {
        finalState := result.EffectiveState()
        responseID, _ := finalState[graph.StateKeyLastResponseID].(string)
        return graph.State{
            keyAgentReply:   result.LastResponse,    // 最终回复文本
            keyAgentReplyID: responseID,             // 响应 ID
        }
    }),
)
```

### 编译与边

```go
sg.AddEdge("normalize", "answer")
sg.AddEdge("answer", "assistant")
sg.AddEdge("assistant", "collect")
compiled := sg.SetEntryPoint("normalize").SetFinishPoint("collect").MustCompile()
```

### 运行时的两个关键 option

```go
events, err := c.runner.Run(
    ctx, userID, c.sessionID,
    model.NewUserMessage(userInput),
    agent.WithGraphEmitFinalModelResponses(true),    // 让最终模型响应流入事件流
    agent.WithDisableGraphCompletionEvent(true),     // 不发图完成事件
)
```

随后从事件流里挑出**runner 完成事件**取最终文本：

```go
completion := lastRunnerCompletion(events)
fmt.Printf("Assistant: %s\n", completionText(completion))
```

### 业务节点示例（`collectAnswer`）

`collect` 节点同时写业务字段和框架约定的响应键：

```go
func collectAnswer(ctx context.Context, state graph.State) (any, error) {
    agentReply, _   := state[keyAgentReply].(string)
    agentReplyID, _ := state[keyAgentReplyID].(string)
    return graph.State{
        keyBusiness:                  fmt.Sprintf("last turn at %s", time.Now().Format(time.RFC3339)),
        graph.StateKeyLastResponse:   agentReply,    // 框架据此识别最终响应
        graph.StateKeyLastResponseID: agentReplyID,  // 框架据此 resume/去重
    }, nil
}
```

### Debug 视图

`-debug`（默认开）在每轮后打印三块内容：当前事件列表、持久化的 `session.State`、6 个图快照 key 的存在性（应全为 false）。这是观察"哪些字段真正落盘了"的关键工具。

## 运行方式

### 环境变量

| 变量 | 必需 | 说明 | 默认值 |
|------|------|------|--------|
| `OPENAI_API_KEY` | 是 | 模型 API Key | — |
| `OPENAI_BASE_URL` | 是 | 模型端点 | `https://api.openai.com/v1` |
| `MODEL_NAME` | 否 | 模型名（被 `-model` 默认引用） | — |

> 本示例**硬编码使用 inmemory 后端**（`sessioninmemory.NewSessionService()`），不支持 `-session` 切换。

### 命令行参数

| 参数 | 说明 | 默认值 |
|------|------|--------|
| `-model` | 模型名 | `MODEL_NAME` 环境变量或 `deepseek-chat` |
| `-streaming` | LLM 子 Agent 是否流式 | `true` |
| `-debug` | 每轮后打印事件、State、快照 key 存在性 | `true` |

### 运行命令

```bash
cd examples/session/graph
export OPENAI_API_KEY="your-api-key"
export OPENAI_BASE_URL="https://api.openai.com/v1"

go run .                       # 默认 deepseek-chat + 流式 + debug
go run . -model gpt-4o
go run . -debug=false          # 关闭 debug 噪音
```

### 交互命令

| 命令 | 作用 |
|------|------|
| `/help` | 显示命令 |
| `/debug` | 切换 debug 开关 |
| `/state` | 打印持久化的 `session.State` |
| `/new [id]` | 新建会话 |
| `/sessions` | 列出会话 |
| `/exit` / `/quit` | 退出 |

### 预期输出

```
Graph session demo ready. Session: graph-session-1718600000

You: 1
Assistant: I understand you've entered "1" but I need more context...
│
│  [DEBUG] Session Events: 2
│    1. user     : 1
│    2. assistant: I understand you've entered "1" but I need more context...
│
│  [DEBUG] Persisted session.State:
│    - agent_reply = I understand you've entered "1" but I need more context...
│    - business_result = last turn at 2026-04-27T11:21:28+08:00
│    - checkpoint_ns = session-graph-agent
│    - draft_answer = I routed your message through a graph with an agent node. Normalized input: "1".
│    - last_response_id =
│    - normalized_input = 1
│
│  [DEBUG] Graph snapshot keys in session.State:
│    - messages             false
│    - user_input           false
│    - last_response        false
│    - last_tool_response   false
│    - node_responses       false
│    - _completion_metadata false
```

注意 `messages` / `user_input` / `node_responses` 等大体积快照 key 全为 false——它们只活在图运行期的内存里，不会污染会话存储。

## 适用场景与对比

**选 graph 当：**
- 一轮对话需要多步处理（规范化 → 检索 → 起草 → 润色 → 汇总）
- 需要"普通函数节点 + LLM 子 Agent"混合编排
- 想验证自定义图状态如何与 Session 协作
- 关注响应 ID 的 resume / 去重语义

**对比其它会话用法：**

| 维度 | graph | [`simple`](./session-simple.md) | [`persona`](./session-persona.md) |
|------|-------|----------------------------------|------------------------------------|
| Agent 类型 | `graphagent`（图） | `llmagent`（单轮） | `llmagent`（单轮） |
| 每轮处理 | 多节点流水线 | 一问一答 | 一问一答 + 人格注入 |
| 后端 | 仅 inmemory | 9 种 | 6 种 |
| State 用途 | 业务字段 + 响应 ID | 不用 | 存 persona |
| 复杂度 | 高 | 低 | 中 |

## 关键要点

1. **Graph Agent 即 Agent**：`graphagent.New` 产出的实例可像 `llmagent` 一样喂给 Runner，享受全部会话能力。
2. **快照不落盘**：`messages` / `node_responses` 等大体积中间态不写入 `session.State`，避免存储膨胀。
3. **业务字段自定义**：通过 `schema.AddField` 声明要持久化的业务 key，配 `DefaultReducer` 控制 update 语义。
4. **响应 ID 保留**：`last_response_id` 故意持久化，用于 runner resume 与完成事件去重。
5. **AgentNode 双映射**：`WithSubgraphInputMapper` / `WithSubgraphOutputMapper` 是父子图状态换算的契约。

## 总结

graph 是 Session 系列里最复杂的一例，它回答了一个关键工程问题：**复杂图编排的中间状态该如何与会话存储协作？** 答案是"只持久化精简业务字段 + 响应身份标识，丢弃庞大快照"。理解了这一点，再去看 [`simple`](./session-simple.md) 的单 Agent 接线、[`persona`](./session-persona.md) 的 State 用法，就能在"单 Agent、多 Agent、图 Agent"三种形态间自如选择，并把它们都纳入统一的会话治理体系（配合 [`eventlimit`](./session-eventlimit.md) / [`ttl`](./session-ttl.md) / [`hook`](./session-hook.md)）。
