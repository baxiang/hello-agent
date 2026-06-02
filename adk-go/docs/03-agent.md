# Agent 模型详解

Agent 是 ADK-Go 框架的核心抽象。所有智能体——无论是基于 LLM 的对话型 Agent、编排型 Workflow Agent，还是远程 A2A Agent——都实现统一的 `Agent` 接口，并通过 `SubAgents` 构成树形结构，实现任务委托与转移。

## 1. Agent 接口

`Agent` 接口定义于 `source/agent/agent.go:43-52`，是所有 Agent 的基础契约：

```go
type Agent interface {
    Name() string
    Description() string
    Run(InvocationContext) iter.Seq2[*session.Event, error]
    SubAgents() []Agent
    FindAgent(name string) Agent
    FindSubAgent(name string) Agent
    internal() *agent
}
```

各方法职责：

- **`Name()`**：返回 Agent 的唯一标识名。在 Agent 树中必须唯一，且不能为 `"user"`（保留给用户输入）。
- **`Description()`**：描述 Agent 的能力。LLM 在多 Agent 场景下根据此描述决定是否将控制权委托给该 Agent，建议使用简洁的单行描述。
- **`Run()`**：Agent 的核心执行方法，接收 `InvocationContext`，返回 `iter.Seq2[*session.Event, error]`。采用 Go 1.23+ 的迭代器模式（range over function），使得调用方可以惰性地逐事件消费，而不必等待全部结果生成完毕。这是 ADK-Go 流式处理的基础——Runner 遍历此迭代器，每产出一个事件即可立即转发或持久化。
- **`SubAgents()`**：返回子 Agent 列表，构成树形结构。
- **`FindAgent(name)`**：在以当前 Agent 为根的子树中递归查找指定名称的 Agent。
- **`FindSubAgent(name)`**：仅在直接子 Agent 中递归查找。
- **`internal()`**：内部方法，用于暴露底层 `*agent` 结构体，供框架内部访问回调等字段。用户不应直接使用。

### 迭代器模式的设计哲学

`Run()` 返回 `iter.Seq2` 而非 `(chan, error)` 或 `[]Event`，有以下优势：

1. **惰性求值**：事件按需生成，无需预分配内存。
2. **背压支持**：消费者通过 `yield` 返回值控制是否继续迭代，实现自然的中断机制。
3. **资源安全**：迭代器函数退出即释放资源，无需额外的 goroutine 管理或 channel 清理。

## 2. 自定义 Agent

使用 `agent.New(agent.Config{...})` 创建自定义 Agent：

```go
myAgent, err := agent.New(agent.Config{
    Name:        "greeter",
    Description: "向用户打招呼的 Agent",
    SubAgents:   []agent.Agent{subAgent1, subAgent2},
    BeforeAgentCallbacks: []agent.BeforeAgentCallback{myBeforeCallback},
    Run: func(ctx agent.InvocationContext) iter.Seq2[*session.Event, error] {
        return func(yield func(*session.Event, error) bool) {
            event := session.NewEvent(ctx.InvocationID())
            event.LLMResponse = model.LLMResponse{
                Content: genai.NewContentFromText("你好！", "model"),
            }
            yield(event, nil)
        }
    },
    AfterAgentCallbacks: []agent.AfterAgentCallback{myAfterCallback},
})
```

### 实战示例：QAFlowAgent — 智能问答路由

以下是一个完整的自定义 Agent 示例，展示分类→路由→处理的典型模式：

```go
type QAFlowAgent struct {
    classifier   agent.Agent  // 分类器：判断问题类型
    techAgent    agent.Agent  // 技术问题处理
    generalAgent agent.Agent  // 通用问题处理
}

func (q *QAFlowAgent) Run(ctx agent.InvocationContext) iter.Seq2[*session.Event, error] {
    return func(yield func(*session.Event, error) bool) {
        // 第一步：运行分类器
        for event, err := range q.classifier.Run(ctx) {
            if err != nil { yield(nil, err); return }
            if !yield(event, nil) { return }
        }

        // 第二步：根据分类结果选择子 Agent
        category, _ := ctx.Session().State().Get("question_category")
        var handler agent.Agent
        if category == "technical" {
            handler = q.techAgent
        } else {
            handler = q.generalAgent
        }

        // 第三步：运行选中的子 Agent
        for event, err := range handler.Run(ctx) {
            if err != nil { yield(nil, err); return }
            if !yield(event, nil) { return }
        }
    }
}

func NewQAFlowAgent(classifier, tech, general agent.Agent) (agent.Agent, error) {
    qa := &QAFlowAgent{
        classifier:   classifier,
        techAgent:    tech,
        generalAgent: general,
    }
    return agent.New(agent.Config{
        Name:        "qa_flow_agent",
        Description: "智能问答路由：先分类再分发",
        SubAgents:   []agent.Agent{classifier, tech, general},
        Run:         qa.Run,
    })
}
```

### Config 字段详解

| 字段 | 类型 | 说明 |
|------|------|------|
| `Name` | `string` | 非空且在树中唯一的名称 |
| `Description` | `string` | Agent 能力描述 |
| `SubAgents` | `[]Agent` | 子 Agent 列表，ADK 自动设置父子关系 |
| `BeforeAgentCallbacks` | `[]BeforeAgentCallback` | Agent 执行前回调链 |
| `Run` | `func(InvocationContext) iter.Seq2[*session.Event, error]` | 定义 Agent 行为的核心函数 |
| `AfterAgentCallbacks` | `[]AfterAgentCallback` | Agent 执行后回调链 |

### Callback 机制

**BeforeAgentCallback**：在 `Run()` 之前按顺序执行。若任一回调返回非 nil 的 `*genai.Content` 或 `error`，则跳过后续回调及 `Run()`，直接用回调结果生成事件。此机制可用于：

- 输入校验与拦截
- 缓存命中时跳过实际执行
- 条件性重定向

**AfterAgentCallback**：在 `Run()` 完成后执行（若 `EndInvocation()` 已调用或 BeforeCallback 拦截了执行，则跳过）。可用于：

- 日志记录与指标采集
- 输出后处理
- 状态清理

回调中的 `CallbackContext` 同时提供只读状态（`ReadonlyState()`）和可写状态（`State()`），写入操作通过 `StateDelta` 批量提交。

## 3. LLMAgent

LLMAgent 是 ADK-Go 最核心的 Agent 实现，基于大语言模型驱动，通过 Instruction 指导行为，支持工具调用、Agent 转移等高级能力。

### 创建 LLMAgent

```go
agent, err := llmagent.New(llmagent.Config{
    Name:        "assistant",
    Description: "通用助手",
    Model:       deepseekModel,
    Instruction: "你是一个有帮助的助手，请用中文回答问题。",
    Tools:       []tool.Tool{searchTool, calcTool},
})
```

### Config 完整字段解析

#### 基础字段

| 字段 | 说明 |
|------|------|
| `Name` | Agent 唯一名称，不可为 `"user"` |
| `Description` | 能力描述，供 LLM 决定是否委托 |
| `SubAgents` | 子 Agent 列表 |

#### 模型与指令

| 字段 | 说明 |
|------|------|
| `Model` | 实现了 `model.LLM` 接口的模型实例 |
| `Instruction` | 指令字符串，支持模板语法（见下文） |
| `InstructionProvider` | 动态指令生成函数，若设置则覆盖 `Instruction`。不会自动替换 `{}` 占位符，需手动调用 `instructionutil.InjectSessionState` |
| `GlobalInstruction` | 全局指令，仅根 Agent 的设置生效，适用于为所有 Agent 统一注入身份或人格 |
| `GlobalInstructionProvider` | 动态全局指令，若设置则覆盖 `GlobalInstruction` |
| `GenerateContentConfig` | LLM 生成配置（温度、安全设置等），工具需通过 `Tools` 字段配置 |

#### 指令模板语法

Instruction 字符串支持运行时变量替换：

- **`{key_name}`**：从 Session State 中替换，`key_name` 需匹配 `^[a-zA-Z_][a-zA-Z0-9_]*$`，否则视为字面量
- **`{artifact.key_name}`**：插入名为 `key_name` 的 Artifact 的文本内容
- **`{var?}`**：可选变量，不存在时不报错（省略 `?` 则报错）

```go
Instruction: "用户名是 {user_name}，请根据 {artifact.report_data} 回答。可选上下文：{context?}"
```

#### 回调链

| 字段 | 说明 |
|------|------|
| `BeforeModelCallbacks` | LLM 调用前执行，返回非 nil 响应可跳过实际模型调用（可用于缓存、日志、请求修改） |
| `AfterModelCallbacks` | LLM 调用后执行，返回非 nil 响应可替换模型原始响应（可用于后处理、指标采集） |
| `OnModelErrorCallbacks` | 模型错误时执行，返回非 nil 响应可替换错误结果（可用于重试、降级） |
| `BeforeToolCallbacks` | 工具执行前执行，返回非 nil 结果可跳过工具调用；修改 `args` 后返回 `(nil, nil)` 可继续执行 |
| `AfterToolCallbacks` | 工具执行后执行，返回非 nil 结果可替换工具返回值 |
| `OnToolErrorCallbacks` | 工具错误时执行，可替换错误结果 |
| `BeforeAgentCallbacks` | Agent 执行前回调（继承自基础 Agent） |
| `AfterAgentCallbacks` | Agent 执行后回调（继承自基础 Agent） |

**回调系统实战示例**：

```go
agent, _ := llmagent.New(llmagent.Config{
    Name:  "monitored_agent",
    Model: model,
    Tools: []tool.Tool{myTool},
    // 日志记录：每次 LLM 调用前记录请求
    BeforeModelCallbacks: []llmagent.BeforeModelCallback{
        func(ctx agent.CallbackContext, req *model.LLMRequest) (*model.LLMResponse, error) {
            log.Printf("LLM 调用: 用户=%s, 消息数=%d", ctx.UserID(), len(req.Contents))
            return nil, nil  // 返回 nil 表示不干预，继续执行
        },
    },
    // 安全检查：工具调用前验证参数
    BeforeToolCallbacks: []llmagent.BeforeToolCallback{
        func(ctx tool.Context, t tool.Tool, args map[string]any) (map[string]any, error) {
            log.Printf("工具调用: %s, 参数: %v", t.Name(), args)
            return nil, nil  // 返回 nil 表示不修改，继续执行
        },
    },
})
```

> **回调的返回值**：返回 `nil` 表示"不干预，继续执行"。返回修改后的对象可以改变请求/响应。返回 error 可以中断执行。

#### 工具与输出

| 字段 | 说明 |
|------|------|
| `Tools` | Agent 可用的工具列表 |
| `Toolsets` | 工具集，LLMAgent 从中提取工具传递给 LLM |
| `OutputKey` | 将 Agent 文本输出自动保存到 Session State 的指定键 |
| `OutputSchema` | 输出 JSON Schema。设置后 Agent 只能回复，不能使用工具、RAG 或 Agent 转移 |
| `InputSchema` | 当 Agent 作为工具被调用时的输入 Schema |

#### 转移控制

| 字段 | 说明 |
|------|------|
| `DisallowTransferToParent` | 禁止 LLM 向父 Agent 转移 |
| `DisallowTransferToPeers` | 禁止 LLM 向同级 Agent 转移 |

#### 内容控制

| 字段 | 说明 |
|------|------|
| `IncludeContents` | 控制是否包含对话历史：`IncludeContentsDefault`（默认，包含历史）或 `IncludeContentsNone`（仅当前轮次） |

### OutputKey 详解

`OutputKey` 是一个强大的特性：当 LLMAgent 的 `OutputKey` 非空时，Agent 的非部分（non-partial）文本输出会自动写入 `event.Actions.StateDelta[OutputKey]`，从而持久化到 Session State。典型用途：

- 提取 Agent 回复供后续工具或回调使用
- 多 Agent 间通过 State 协调

### Live 模式

LLMAgent 通过 `RunLive()` 支持双向流式通信，返回 `(LiveSession, iter.Seq2[*session.Event, error], error)` 三元组。`LiveSession` 接口提供 `Send(LiveRequest)` 和 `Close()` 方法，允许在 Agent 运行期间持续发送消息（文本、音频、函数响应等），适用于实时对话场景。

### 结构化输出（OutputSchema）

设置 `OutputSchema` 后，Agent **只能返回结构化 JSON 数据，不能调用工具或转移控制权**。适合需要确定性输出的场景：

```go
outputSchema := &genai.Schema{
    Type:        genai.TypeObject,
    Description: "城市天气信息",
    Properties: map[string]*genai.Schema{
        "city":    {Type: genai.TypeString, Description: "城市名"},
        "weather": {Type: genai.TypeString, Description: "天气描述"},
        "temp":    {Type: genai.TypeNumber, Description: "温度（摄氏度）"},
    },
}

agent, _ := llmagent.New(llmagent.Config{
    Name:         "weather_agent",
    Model:        model,
    OutputSchema: outputSchema,
    OutputKey:    "weather_result",  // 结果自动写入 session state
})
```

### 动态指令（InstructionProvider）

`InstructionProvider` 可根据运行时上下文动态生成指令：

```go
agent, _ := llmagent.New(llmagent.Config{
    Name:  "contextual_agent",
    Model: model,
    InstructionProvider: func(ctx agent.ReadonlyContext) (string, error) {
        userTier := ctx.ReadonlyState().Get("user_tier")
        if userTier == "premium" {
            return "你是高级助手，提供详细专业的回答。", nil
        }
        return "你是基础助手，提供简洁易懂的回答。", nil
    },
})
```

### 无状态 Agent（IncludeContentsNone）

```go
statelessAgent, _ := llmagent.New(llmagent.Config{
    Name:            "stateless_agent",
    Model:           model,
    IncludeContents: llmagent.IncludeContentsNone,
})
```

### 状态 Key 前缀约定

通过 `ctx.Session().State()` 读写状态时，ADK 使用 key 前缀区分作用域：

| 前缀 | 作用域 | 持久化 | 示例 |
|------|--------|--------|------|
| （无前缀） | 当前会话 | ✅ | `"question_category"` |
| `app:` | 应用级别（跨用户） | ✅ | `"app:global_config"` |
| `user:` | 用户级别（跨会话） | ✅ | `"user:preferences"` |
| `temp:` | 临时 | ❌ | `"temp:scratch_data"` |

## 4. Workflow Agents

Workflow Agent 用于编排多个子 Agent 的执行流程，本身不直接处理 LLM 调用，而是协调子 Agent 的执行顺序与方式。

### SequentialAgent

定义于 `source/agent/workflowagents/sequentialagent/agent.go`，按顺序依次执行子 Agent：

```go
seqAgent, err := sequentialagent.New(sequentialagent.Config{
    AgentConfig: agent.Config{
        Name:        "pipeline",
        Description: "顺序处理流水线",
        SubAgents:   []agent.Agent{step1, step2, step3},
    },
})
```

特性：
- 子 Agent 按列表顺序逐一执行，前一个完成后才开始下一个
- 支持 Live 模式：`RunLive()` 为每个子 Agent 创建独立的 LiveSession，并通过 `sequentialLiveSession` 管理活跃会话的切换
- 自动注入 `task_completed` 工具到子 LLMAgent 中，使其能主动发出完成信号，便于流程推进

### ParallelAgent

定义于 `source/agent/workflowagents/parallelagent/agent.go`，并行执行所有子 Agent：

```go
parAgent, err := parallelagent.New(parallelagent.Config{
    AgentConfig: agent.Config{
        Name:        "parallel_processor",
        Description: "并行处理器",
        SubAgents:   []agent.Agent{worker1, worker2},
    },
})
```

特性：
- 使用 `errgroup` + `channel` 协调并发执行
- 每个子 Agent 拥有独立的 Branch（格式：`{parent_branch}.{parent_name}.{sub_name}`），确保对话历史隔离
- 事件通过 `resultsChan` 收集，支持 ack 机制保证事件按序持久化
- 任一子 Agent 出错，errgroup 传播错误

### LoopAgent

定义于 `source/agent/workflowagents/loopagent/agent.go`，循环执行子 Agent：

```go
loopAgent, err := loopagent.New(loopagent.Config{
    AgentConfig: agent.Config{
        Name:        "refiner",
        Description: "迭代优化器",
        SubAgents:   []agent.Agent{generator, reviewer},
    },
    MaxIterations: 5,
})
```

特性：
- 在每次循环中按顺序执行所有子 Agent
- `MaxIterations` 为 0 时无限循环，直到子 Agent 触发 Escalate 退出
- 任何子 Agent 产出的事件 `Actions.Escalate == true` 时，立即退出循环
- 适用于迭代优化、反复修订等场景

## 5. Remote Agent (A2A)

通过 Agent-to-Agent (A2A) 协议连接远程 Agent，定义于 `source/agent/remoteagent/a2a_agent.go`：

```go
remoteAgent, err := remoteagent.NewA2A(remoteagent.A2AConfig{
    Name:            "remote_expert",
    Description:     "远程专家 Agent",
    AgentCardSource: "https://remote-host/.well-known/agent.json",
})
```

### A2AConfig 详解

| 字段 | 说明 |
|------|------|
| `Name` | 远程 Agent 的本地名称 |
| `Description` | 能力描述 |
| `AgentCard` | 直接提供 A2A Agent Card |
| `AgentCardSource` | Agent Card 的 URL 或本地文件路径，首次调用时解析 |
| `CardResolveOptions` | Agent Card 解析配置 |
| `BeforeRequestCallbacks` | 发送请求前的回调，可拦截/修改请求或返回缓存结果 |
| `AfterRequestCallbacks` | 收到响应后的回调，可修改或替换事件 |
| `Converter` | 自定义 A2A 事件到 `session.Event` 的转换逻辑 |
| `A2APartConverter` | 自定义 A2A Part 到 GenAI Part 的转换 |
| `GenAIPartConverter` | 自定义 GenAI Part 到 A2A Part 的转换 |
| `ClientFactory` | A2A 客户端工厂配置 |
| `MessageSendConfig` | 每次调用的消息发送配置 |
| `RemoteTaskCleanupCallback` | 运行中断时远程任务的清理回调 |

ADK 同时提供 v1（已废弃）和 v2 两个版本。v1 内部会桥接到 v2 实现，通过 `a2av0` 兼容层进行协议转换。

## 6. Agent 树与转移

Agent 通过 `SubAgents` 构成树形结构。LLMAgent 可通过内置的 `transfer_to_agent` 工具在树中转移控制权：

- **向子 Agent 转移**：LLM 调用 `transfer_to_agent(agent_name="child_name")`
- **向父 Agent 转移**：默认允许，设置 `DisallowTransferToParent: true` 可禁止
- **向同级 Agent 转移**：默认允许，设置 `DisallowTransferToPeers: true` 可禁止

Runner 通过 `parentmap.Map` 维护完整的父子关系，在 `findAgentToRun` 中利用此映射判断跨树转移是否可行。转移时，`isTransferableAcrossAgentTree` 会沿父链逐层检查 `DisallowTransferToParent` 设置。

## 7. InvocationContext

定义于 `source/agent/context.go:60-103`，是 Agent 调用的核心上下文，贯穿整个执行生命周期。

### 核心字段

| 字段 | 说明 |
|------|------|
| `Agent()` | 当前执行的 Agent |
| `Session()` | 当前会话，提供状态读写与事件历史 |
| `Artifacts()` | Artifact 存取接口 |
| `Memory()` | 跨会话记忆检索 |
| `UserContent()` | 触发本次调用的用户消息 |
| `RunConfig()` | 运行时配置 |
| `Branch()` | 分支标识，用于隔离并行 Agent 的对话历史 |
| `InvocationID()` | 调用唯一标识 |

### 终止控制

- **`EndInvocation()`**：标记终止，阻止后续的 Agent 调用和回调执行
- **`Ended()`**：查询是否已终止

### 上下文层级

ADK 定义了三层上下文接口：

1. **`InvocationContext`**：完整上下文，包含所有可写操作和终止控制
2. **`ReadonlyContext`**：只读上下文，提供 `UserContent()`、`ReadonlyState()`、`AgentName()` 等，用于 `InstructionProvider`
3. **`CallbackContext`**：回调上下文，继承 `ReadonlyContext`，额外提供可写 `State()` 和 `Artifacts()` 访问

`CallbackContext` 中的 `State()` 写入操作通过 `StateDelta` 暂存，在回调完成后批量提交到 Session，确保状态一致性。读取时优先查找 `StateDelta`，其次查找 Session State。

### Invocation 与 Agent Call 和 Step 的关系

```
┌─────────────────────── invocation ──────────────────────────┐
┌──────────── llm_agent_call_1 ────────────┐ ┌─ agent_call_2 ─┐
┌──── step_1 ────────┐ ┌───── step_2 ──────┐
[call_llm] [call_tool] [call_llm] [transfer]
```

- **Invocation**：从用户消息到最终响应，由 `Runner.Run()` 处理
- **Agent Call**：由 `Agent.Run()` 处理，直到 Run 结束
- **Step**：一次 LLM 调用 + 可选的工具调用，是 LLMAgent 内部的最小执行单元
