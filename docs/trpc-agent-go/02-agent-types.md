# Multi-Agent 编排 — 源码·实战·原理

Multi-Agent 是将复杂任务分解给多个 Agent 协作完成的核心能力。tRPC-Agent-Go 提供 ChainAgent、ParallelAgent、CycleAgent 三种编排模式，以及 AgentTool 委托机制。

## 1. ChainAgent — 顺序执行

### 1.1 概念

ChainAgent 将子 Agent 按顺序执行，前一个的输出作为后一个的输入，形成流水线。

```
用户输入 → [Agent A] → [Agent B] → [Agent C] → 最终输出
```

### 1.2 源码走读

```go
// agent/chainagent/chain_agent.go（简化）
type ChainAgent struct {
    name      string
    subAgents []agent.Agent
}

func (a *ChainAgent) Run(ctx context.Context, inv *agent.Invocation) (<-chan *event.Event, error) {
    ch := make(chan *event.Event, 256)
    go func() {
        defer close(ch)
        for i, sub := range a.subAgents {
            // 1. 创建子 Invocation
            subInv := inv.Clone(
                agent.WithInvocationAgent(sub),
                // 如果是第一个 Agent，使用原始 Message
                // 否则使用上一个 Agent 的 last_response 作为 Message
                agent.WithInvocationMessage(a.getMessage(inv, i)),
            )

            // 2. 执行子 Agent
            subCh, err := agent.RunWithPlugins(ctx, subInv, sub)
            if err != nil { /* 错误处理 */ }

            // 3. 转发子 Agent 的事件
            var lastResponse string
            for evt := range subCh {
                ch <- evt
                if evt.Response != nil && len(evt.Response.Choices) > 0 {
                    lastResponse = evt.Response.Choices[0].Message.Content
                }
            }

            // 4. 更新 Message 供下一个 Agent 使用
            if i < len(a.subAgents)-1 {
                inv.Message = model.NewUserMessage(lastResponse)
            }
        }
    }()
    return ch, nil
}
```

**关键实现细节**：
- `inv.Clone()` 创建子 Invocation，保留 Session/Memory 等上下文
- 通过 `WithInvocationMessage()` 传递前一 Agent 的输出作为输入
- 子 Agent 的事件（包括中间 tool call）全部透传——外部可以看到完整执行过程

### 1.3 使用示例

```go
analyzer := llmagent.New("analyzer",
    llmagent.WithModel(model),
    llmagent.WithInstruction("Analyze the input and list key points."),
)

writer := llmagent.New("writer",
    llmagent.WithModel(model),
    llmagent.WithInstruction("Write a summary based on the analysis."),
)

pipeline := chainagent.New("report-pipeline",
    chainagent.WithSubAgents([]agent.Agent{analyzer, writer}),
)

r := runner.NewRunner("app", pipeline)
events, _ := r.Run(ctx, "user-1", "session-1",
    model.NewUserMessage("Describe the current AI market trends."),
)
```

### 1.4 设计原理

ChainAgent 适用于**严格顺序依赖**的任务：步骤 B 完全依赖步骤 A 的输出。如果需要步骤间有反馈回路（步骤 C 发现问题需要回到步骤 A），应该使用 CycleAgent 或 GraphAgent。

---

## 2. ParallelAgent — 并发执行

### 2.1 概念

多个 Agent 并发处理同一输入，结果合并。

```
           ┌→ [Agent A] ─┐
用户输入 → ─┼→ [Agent B] ─┼→ 合并 → 最终输出
           └→ [Agent C] ─┘
```

### 2.2 源码走读

```go
// agent/parallelagent/parallel_agent.go（简化）
func (a *ParallelAgent) Run(ctx context.Context, inv *agent.Invocation) (<-chan *event.Event, error) {
    ch := make(chan *event.Event, 256)
    go func() {
        defer close(ch)

        var wg sync.WaitGroup
        results := make([]string, len(a.subAgents))
        var mu sync.Mutex

        for i, sub := range a.subAgents {
            wg.Add(1)
            go func(idx int, subAgent agent.Agent) {
                defer wg.Done()

                subInv := inv.Clone(
                    agent.WithInvocationAgent(subAgent),
                    agent.WithInvocationMessage(inv.Message),
                )

                subCh, err := agent.RunWithPlugins(ctx, subInv, subAgent)
                if err != nil { return }

                var lastContent string
                for evt := range subCh {
                    // 注意：并发转发事件时需带索引标识避免 UI 混乱
                    ch <- evt
                    if evt.Response != nil && len(evt.Response.Choices) > 0 {
                        lastContent = evt.Response.Choices[0].Message.Content
                    }
                }

                mu.Lock()
                results[idx] = lastContent
                mu.Unlock()
            }(i, sub)
        }

        wg.Wait()

        // 合并结果
        merged := strings.Join(results, "\n\n---\n\n")
        ch <- event.NewResponseEvent(inv.InvocationID, a.name,
            &model.Response{Done: true, Choices: []model.Choice{{
                Message: model.Message{Role: model.RoleAssistant, Content: merged},
            }}},
        )
    }()
    return ch, nil
}
```

**并发设计要点**：
- `sync.WaitGroup` 确保所有子 Agent 完成后才合并
- `sync.Mutex` 保护 results slice 的并发写入
- 每个子 Agent 使用独立的 `inv.Clone()` 确保上下文隔离

### 2.3 使用示例

```go
legalExpert := llmagent.New("legal",
    llmagent.WithModel(model),
    llmagent.WithInstruction("Analyze from a legal perspective."),
)
techExpert := llmagent.New("tech",
    llmagent.WithModel(model),
    llmagent.WithInstruction("Analyze from a technical perspective."),
)
bizExpert := llmagent.New("business",
    llmagent.WithModel(model),
    llmagent.WithInstruction("Analyze from a business perspective."),
)

parallel := parallelagent.New("multi-expert",
    parallelagent.WithSubAgents([]agent.Agent{legalExpert, techExpert, bizExpert}),
)
```

### 2.4 设计原理

适用于**无依赖的并行分析**场景：同一问题从不同角度分析，结果汇总。相比 ChainAgent：
- 总延迟 = max(各子 Agent 延迟)，而非 sum
- 结果需要人工或 LLM 二次合并
- 子 Agent 之间不能共享中间状态（如需共享，用 GraphAgent）

---

## 3. CycleAgent — 循环迭代

### 3.1 概念

循环执行子 Agent 直到终止条件满足。

```
            ┌─────────────┐
            ↓             │
用户输入 → [Planner] → [Executor] → 检查条件 → 通过 → 输出
            ↑                         │
            └───── 未通过 ←───────────┘
```

### 3.2 源码走读

```go
// agent/cycleagent/cycle_agent.go（简化）
type CycleAgent struct {
    name          string
    subAgents     []agent.Agent // [planner, executor]
    maxIterations int
    exitCondition func(ctx, inv) bool
}

func (a *CycleAgent) Run(ctx context.Context, inv *agent.Invocation) (<-chan *event.Event, error) {
    ch := make(chan *event.Event, 256)
    go func() {
        defer close(ch)
        for i := 0; i < a.maxIterations; i++ {
            for _, sub := range a.subAgents {
                subInv := inv.Clone(
                    agent.WithInvocationAgent(sub),
                )
                subCh, _ := agent.RunWithPlugins(ctx, subInv, sub)
                for evt := range subCh {
                    ch <- evt
                    // 更新 inv 的状态
                }
            }
            // 检查退出条件
            if a.exitCondition(ctx, inv) { break }
        }
    }()
    return ch, nil
}
```

### 3.3 使用示例

```go
planner := llmagent.New("planner",
    llmagent.WithModel(model),
    llmagent.WithInstruction("Plan the next step to solve the task."),
)
executor := llmagent.New("executor",
    llmagent.WithModel(model),
    llmagent.WithInstruction("Execute the planned step."),
)

cycler := cycleagent.New("problem-solver",
    cycleagent.WithSubAgents([]agent.Agent{planner, executor}),
    cycleagent.WithMaxIterations(5),
)
```

### 3.4 设计原理

CycleAgent 适用于**需要多轮迭代优化**的场景（代码调试、文本润色、搜索优化）。与 Ralph Loop 的区别：Ralph Loop 在 Runner 层实现循环（验证驱动），CycleAgent 在 Agent 层实现（LLM 驱动）。

---

## 4. AgentTool — 将 Agent 包装为工具

### 4.1 概念

AgentTool 让一个 Agent 可以被另一个 Agent 作为工具调用。这是构建多 Agent 协作系统最灵活的方式。

```
Coordinator (LLMAgent)
   │
   ├─ tool_call: weather_agent  ──→ WeatherAgent（查询天气）
   ├─ tool_call: math_agent     ──→ MathAgent（数学计算）
   └─ tool_call: db_agent       ──→ DBAgent（数据库查询）
```

### 4.2 源码走读

```go
// tool/agenttool/agent_tool.go（简化）
type AgentTool struct {
    agent           agent.Agent
    streamInner     bool
    historyScope    HistoryScope
    skipSummarization bool
}

func (t *AgentTool) Call(ctx context.Context, jsonArgs []byte) (any, error) {
    // 1. 解析参数
    var args map[string]any
    json.Unmarshal(jsonArgs, &args)
    message := args["request"].(string)

    // 2. 创建子 Invocation
    parentInv, _ := agent.InvocationFromContext(ctx)
    childInv := parentInv.Clone(
        agent.WithInvocationAgent(t.agent),
        agent.WithInvocationMessage(model.NewUserMessage(message)),
    )

    // 3. 执行子 Agent
    childCtx := agent.NewInvocationContext(ctx, childInv)
    eventCh, _ := agent.RunWithPlugins(childCtx, childInv, t.agent)

    // 4. 收集结果
    var finalContent string
    for evt := range eventCh {
        if evt.Response != nil && len(evt.Response.Choices) > 0 {
            finalContent = evt.Response.Choices[0].Message.Content
        }
    }
    return finalContent, nil
}
```

### 4.3 使用示例

```go
weatherAgent := llmagent.New("weather",
    llmagent.WithModel(model),
    llmagent.WithInstruction("You are a weather expert."),
    llmagent.WithTools([]tool.Tool{weatherAPITool}),
)

weatherTool := agenttool.New(weatherAgent,
    agenttool.WithStreamInner(true),         // 流式转发
    agenttool.WithSkipSummarization(true),   // 跳过子 Agent 摘要
    agenttool.WithHistoryScope(agenttool.HistoryScopeIsolated),
)

coordinator := llmagent.New("coordinator",
    llmagent.WithModel(model),
    llmagent.WithTools([]tool.Tool{weatherTool}),
    llmagent.WithSubAgents([]agent.Agent{weatherAgent}),
)
```

### 4.4 设计原理

AgentTool 的核心价值在于**黑盒复用**——Coordinator 不需要知道 WeatherAgent 内部用了什么工具、调了什么 API，只需要知道"这是一个能查天气的 Agent"。

与通过 SubAgents 直接委托的区别：
- **SubAgents 委托**：Coordinator 用 LLM 判断"我需要把控制权交给哪个 Agent"
- **AgentTool**：Coordinator 用 Function Calling 判断"我需要调用哪个工具"，工具恰好是一个 Agent

**HistoryScope 三种模式的选择**：

| 模式 | 子 Agent 看到的历史 | 适用场景 |
|------|-------------------|----------|
| `HistoryScopeFull` | 完整对话历史 | 子 Agent 需要理解上下文 |
| `HistoryScopeIsolated` | 仅当前 tool call message | 独立任务，避免上下文污染 |
| `HistoryScopeParentToolCall` | 父 Agent 的 tool call 上下文 | 需要知道"谁调用了我" |

---

## 5. 委托（Transfer）协议

### 5.1 概念

LLMAgent 支持通过 `SubAgents` 将控制权交给子 Agent：

```go
coordinator := llmagent.New("coordinator",
    llmagent.WithModel(model),
    llmagent.WithSubAgents([]agent.Agent{weatherAgent, mathAgent}),
    llmagent.WithDefaultTransferMessage("Handing off to the specialist"),
)
```

### 5.2 委托事件

当模型决定委托时，会发出 `agent.transfer` 事件：

```json
{
    "object": "agent.transfer",
    "response": {
        "choices": [{
            "message": {
                "content": "Handing off to the specialist",
                "role": "assistant"
            }
        }]
    }
}
```

UI 层可按 `object == "agent.transfer"` 过滤这些系统事件。

### 5.3 AwaitUserReply 路由

子 Agent 可以向用户提问，下次请求自动路由回该子 Agent：

```go
r := runner.NewRunner("app", coordinator,
    runner.WithAwaitUserReplyRouting(true),
)

// LLMAgent 内置方式
agent := llmagent.New("sub-agent",
    llmagent.WithAwaitUserReplyTool(true),
    // LLM 被告知：需要用户输入时调用 await_user_reply
)

// 自定义 Agent 方式
func (a *MyAgent) Run(ctx context.Context, inv *agent.Invocation) (...) {
    // ...
    agent.MarkAwaitingUserReply(inv) // 标记等待用户回复
    // ...
}
```

---

## 6. 编排模式对比

| 模式 | 适用场景 | 延迟特点 | 结果特点 |
|------|---------|---------|---------|
| **ChainAgent** | 严格顺序依赖的流水线 | 延迟累加 | 最终步骤的输出 |
| **ParallelAgent** | 无依赖的独立分析 | 取最大值 | 合并多个结果 |
| **CycleAgent** | 需要多轮迭代优化 | 不可控（需限制上限） | 最后迭代的输出 |
| **AgentTool** | 按需调用的专家 Agent | 单次调用延迟 | 单一 Agent 的完成输出 |
| **GraphAgent** | 复杂条件分支+循环 | 灵活可控 | 任意节点的输出 |
