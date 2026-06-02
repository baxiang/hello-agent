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

`RunLive()` 是 ADK-Go 最复杂的机制，专为语音对话、实时翻译等双向流式场景设计。

#### 接口与调用

```go
// RunLive 返回三元组
liveSession, eventIter, err := runner.RunLive(ctx, userID, sessionID, agent.LiveRunConfig{
    ResponseModalities:       []genai.Modality{genai.ModalityAudio},
    InputAudioTranscription:  &genai.AudioTranscriptionConfig{},
    OutputAudioTranscription: &genai.AudioTranscriptionConfig{},
    MaxLLMCalls:              100,
})
```

- `liveSession` → 用于**发送**客户端消息到 Agent
- `eventIter` → 用于**接收** Agent 产出的流式事件
- `LiveRunConfig` → 音频、转录、重连等配置

#### 传输层：WebSocket（非 gRPC）

整个 `RunLive` 的传输链路分两层：

```
客户端（浏览器/App）
    │  WebSocket ws://.../run_live?appName=X&userId=Y&sessionId=Z
    ▼
┌─────────────────────────────────────────┐
│ adkrest REST API（WebSocket Handler）     │  ← 第一层：面向客户端的传输
│   - HTTP Upgrade 到 WebSocket            │
│   - 读取 goroutine: ws.ReadMessage()     │
│     → liveSession.Send(LiveRequest)      │
│   - 主 goroutine: eventIter              │
│     → ws.WriteJSON(event)                │
└──────────────┬──────────────────────────┘
               │ channel
               ▼
┌─────────────────────────────────────────┐
│ liveSessionImpl（Channel 双向管道）       │  ← 第二层：ADK 内部中转
│   inputCh  ← LiveRequest（来自客户端）     │
│   outputCh → eventOrError（来自模型）      │
│   done     → 关闭信号                     │
└──────────────┬──────────────────────────┘
               │ genai.Client.Live.Connect()
               ▼
┌─────────────────────────────────────────┐
│ Gemini Live API（底层 gRPC 双向流）       │  ← 第三层：模型连接
│   这是 google.golang.org/genai 库内部实现  │
│   ADK-Go 不暴露 gRPC 服务端，只消费客户端  │
└─────────────────────────────────────────┘
```

**三层总结**：

| 层 | 协议 | 角色 | 实现位置 |
|----|------|------|----------|
| 客户端 ↔ ADK | **WebSocket** | ADK 作为服务端 | `server/adkrest/controllers/runtime.go:247` |
| ADK 内部 | **Go Channel** | `liveSessionImpl` 管道 | `internal/llminternal/base_flow.go:134` |
| ADK ↔ Gemini | **gRPC**（genai 库内部） | ADK 作为客户端 | `google.golang.org/genai` |

**没有原生 gRPC 服务端实现**。`agentengine` 包只支持 SSE 单向流式（`Runner.Run()`），不支持 `RunLive`。双向流式只能通过 WebSocket。

#### 核心实现：liveSessionImpl

```go
type liveSessionImpl struct {
    inputCh  chan agent.LiveRequest    // 客户端 → 模型
    outputCh chan eventOrError         // 模型 → 客户端
    done     chan struct{}             // 关闭信号
    closeOnce sync.Once
}

// Send 由客户端 goroutine 调用，写入消息
func (s *liveSessionImpl) Send(req agent.LiveRequest) error {
    select {
    case s.inputCh <- req:   // 非阻塞地发送给模型写 goroutine
        return nil
    case <-s.done:
        return io.EOF
    }
}

// recvIter 将 outputCh 包装为 iter.Seq2 迭代器
func (s *liveSessionImpl) recvIter() iter.Seq2[*session.Event, error] {
    return func(yield func(*session.Event, error) bool) {
        for {
            select {
            case res := <-s.outputCh:
                if !yield(res.event, res.err) { return }
            case <-s.done:
                return
            }
        }
    }
}
```

**为什么用 Channel 而非直接迭代器？**
- `Send()` 是**写操作**，从客户端 goroutine 调用
- 模型连接运行在**独立 goroutine** 中，持续读取和写入
- Channel 是 goroutine 之间最自然的通信方式，天然支持并发安全
- 迭代器负责将 channel 输出转为 `for-range` 可消费的形式

#### Goroutine 协作模型

`Flow.RunLive()` 内部的 goroutine 架构：

```
主 goroutine（Flow.RunLive 内部）
  ├── 读 goroutine:   liveConn.Recv() → eventsChan → outputCh → 客户端
  ├── 写 goroutine:   inputCh → liveConn.SendContent()/SendRealtime() → Gemini
  └── 主循环: 处理事件、工具调用、缓存刷新、重连逻辑
```

**关键特性**：
- **自动重连**：检测 EOF/broken pipe/connection reset 等断连错误后自动重建连接，支持 `SessionResumptionHandle` 恢复会话状态
- **时间戳排序**：音频转录与工具调用按时间顺序排列——转录中的工具调用先缓存，转录完成后再释放，保证对话时序
- **内联工具调用**：Live 模式中的函数调用在主循环中直接执行，响应通过同一连接发回 Gemini

#### RunLive 接口不在公开 Agent 接口中

`RunLive` 通过运行时的类型断言检查，而非编译时的接口约束：

```go
// runner/runner.go:363
lAgent, ok := agentToRun.(liveAgent)
if !ok {
    return nil, nil, fmt.Errorf("agent %s does not support Live Run", agentToRun.Name())
}
```

目前只有 `llmAgent` 和 `sequentialAgent` 实现了 `liveAgent`。

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

Workflow Agent 是**不使用 LLM 做决策的编排器**——执行逻辑是确定性的。三种类型可以自由组合。

### 多 Agent 状态传递机制

Workflow Agent 中子 Agent 之间通过 `OutputKey` + 模板变量 `{key}` 传递数据：

```
Agent A（OutputKey: "code"）→ session.state["code"] = "func main() {...}"
                                    ↓
Agent B（Instruction: "审查这段代码：{code}"）→ 读取 session.state["code"]
```

工作原理：
1. Agent A 设置 `OutputKey: "code"`，执行完成后自动把 LLM 的最终回复存入 `session.state["code"]`
2. Agent B 的 `Instruction` 中使用 `{code}` 模板变量，运行时自动替换

> SequentialAgent 和 LoopAgent 的子 Agent 共享同一个 InvocationContext，状态传递非常自然。ParallelAgent 的每个子 Agent 有独立的 branch，但共享 `session.state`。

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

#### 实战：代码开发流水线

**场景**：写代码 → 审查代码 → 重构代码，三步自动化流水线。

```go
// 第一步：代码生成 Agent
writer, _ := llmagent.New(llmagent.Config{
    Name:        "CodeWriter",
    Model:       model,
    Instruction: `你是一个 Go 代码生成器。根据用户需求编写 Go 代码。
只输出完整的 Go 代码块，用 ` + "```go" + ` ... ` + "```" + ` 包裹。不要添加其他文字。`,
    OutputKey:   "generated_code",  // 输出存入 state["generated_code"]
})

// 第二步：代码审查 Agent（读取上一步的输出）
reviewer, _ := llmagent.New(llmagent.Config{
    Name:  "CodeReviewer",
    Model: model,
    Instruction: `你是一个资深 Go 代码审查专家。审查以下代码，指出问题和改进建议。

代码：
` + "```go" + `
{generated_code}
` + "```" + `

请列出具体的问题和修改建议。`,
    OutputKey: "review_comments",
})

// 第三步：代码重构 Agent（读取前两步的输出）
refactorer, _ := llmagent.New(llmagent.Config{
    Name:  "CodeRefactorer",
    Model: model,
    Instruction: `你是一个代码重构专家。根据审查意见重构代码。

原始代码：
` + "```go" + `
{generated_code}
` + "```" + `

审查意见：
{review_comments}

请输出重构后的完整代码。`,
    OutputKey: "refactored_code",
})

// 组装流水线：写 → 审 → 改
pipeline, _ := sequentialagent.New(sequentialagent.Config{
    AgentConfig: agent.Config{
        Name:        "code_pipeline",
        Description: "代码开发流水线：生成 → 审查 → 重构",
        SubAgents:   []agent.Agent{writer, reviewer, refactorer},
    },
})
```

**数据流**：

```
用户："写一个 HTTP 服务器"
    ↓
CodeWriter → state["generated_code"] = "func main() { http.ListenAndServe(...) }"
    ↓
CodeReviewer 读取 {generated_code} → state["review_comments"] = "1. 缺少错误处理 2. ..."
    ↓
CodeRefactorer 读取 {generated_code} + {review_comments} → state["refactored_code"] = "..."
```

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

> ⚠️ **重要**：并行子 Agent 必须使用**不同的 OutputKey**，否则会竞态写入同一个 state key。

#### 实战：并行调研 + 汇总

**场景**：三个研究员同时调研不同主题，最后由合成 Agent 汇总。

```go
// 并行调研（每个 Agent 用不同的 OutputKey）
energyResearcher, _ := llmagent.New(llmagent.Config{
    Name:        "RenewableEnergyResearcher",
    Model:       model,
    Instruction: "你是一个能源领域研究员。调研可再生能源最新进展。",
    OutputKey:   "energy_result",  // 注意不同的 key
})

evResearcher, _ := llmagent.New(llmagent.Config{
    Name:        "EVResearcher",
    Model:       model,
    Instruction: "你是电动汽车领域研究员。调研 EV 技术最新趋势。",
    OutputKey:   "ev_result",  // 不同的 key
})

carbonResearcher, _ := llmagent.New(llmagent.Config{
    Name:        "CarbonCaptureResearcher",
    Model:       model,
    Instruction: "你是碳捕获领域研究员。调研碳捕获技术最新进展。",
    OutputKey:   "carbon_result",  // 不同的 key
})

// 并行执行
parallelResearch, _ := parallelagent.New(parallelagent.Config{
    AgentConfig: agent.Config{
        Name:      "ParallelResearch",
        SubAgents: []agent.Agent{energyResearcher, evResearcher, carbonResearcher},
    },
})

// 合成 Agent（读取所有并行结果）
synthesis, _ := llmagent.New(llmagent.Config{
    Name:  "SynthesisAgent",
    Model: model,
    Instruction: `你是一个研究分析师。根据以下三份报告，撰写一份综合分析。

可再生能源报告：
{energy_result}

电动汽车报告：
{ev_result}

碳捕获报告：
{carbon_result}

请找出三个领域的交叉点，提出综合建议。`,
})

// 整体流水线 = 并行调研 + 串行汇总
pipeline, _ := sequentialagent.New(sequentialagent.Config{
    AgentConfig: agent.Config{
        Name:      "ResearchPipeline",
        SubAgents: []agent.Agent{parallelResearch, synthesis},
    },
})
```

**执行流程**：

```
          ┌→ 能源研究员 → state["energy_result"]
并行执行 →├→ 电动车研究员 → state["ev_result"]
          └→ 碳捕获研究员 → state["carbon_result"]
              ↓（全部完成后）
        合成 Agent 读取三个 state → 最终报告
```

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

#### 终止机制：ExitLoop 工具

```go
type exitLoopArgs struct{}
type exitLoopResult struct{}

func exitLoop(ctx tool.Context, args exitLoopArgs) (exitLoopResult, error) {
    ctx.Actions().Escalate = true  // 设置 Escalate 信号 → 终止循环
    return exitLoopResult{}, nil
}

exitTool, _ := functiontool.New(functiontool.Config{
    Name:        "exit_loop",
    Description: "当质量已达标，不需要继续修改时调用此工具退出循环。",
}, exitLoop)
```

#### 实战：迭代式文档改进

**场景**：写初稿 → 循环（批评 → 修改/退出），直到文档质量达标。

```go
const docKey = "current_document"

// 第一步：初始写作 Agent
writer, _ := llmagent.New(llmagent.Config{
    Name:        "InitialWriter",
    Model:       model,
    Instruction: "你是一个创意写作助手。根据用户主题写一个短故事（2-4句话）。",
    OutputKey:   docKey,
})

// 循环内 Step A：批评 Agent
critic, _ := llmagent.New(llmagent.Config{
    Name:  "Critic",
    Model: model,
    Instruction: `你是一个文学批评家。评价以下故事的质量。

故事：
{` + docKey + `}

如果故事已经很好（有趣、连贯、有创意），回复"APPROVED"。
否则列出具体改进建议。`,
    OutputKey: "critique",
})

// 循环内 Step B：修改 Agent（含退出工具）
reviser, _ := llmagent.New(llmagent.Config{
    Name:  "Reviser",
    Model: model,
    Instruction: `你根据批评意见修改故事。如果批评说"APPROVED"，调用 exit_loop 工具退出。
否则修改故事并输出新版本。

批评意见：{critique}
当前故事：{` + docKey + `}`,
    Tools:     []tool.Tool{exitTool},
    OutputKey: docKey,  // 覆盖之前的文档
})

// 循环：批评 → 修改（最多 5 轮）
refinementLoop, _ := loopagent.New(loopagent.Config{
    AgentConfig: agent.Config{
        Name:      "RefinementLoop",
        SubAgents: []agent.Agent{critic, reviser},
    },
    MaxIterations: 5,
})

// 整体流水线 = 初始写作 + 循环改进
pipeline, _ := sequentialagent.New(sequentialagent.Config{
    AgentConfig: agent.Config{
        Name:      "IterativeWriter",
        SubAgents: []agent.Agent{writer, refinementLoop},
    },
})
```

**执行流程**：

```
初始写作 → state["current_document"] = "从前有座山..."
    ↓
循环第1轮：
  批评 → "故事太平淡，加入冲突"
  修改 → state["current_document"] = "从前有座山，山下住着一条龙..."
    ↓
循环第2轮：
  批评 → "APPROVED"
  修改 → 调用 exit_loop → Escalate=true → 循环终止
    ↓
输出最终故事
```

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

### Agent 转移实战

```go
refundAgent, _ := llmagent.New(llmagent.Config{
    Name:        "refund_agent",
    Model:       model,
    Instruction: "你是退款处理专家。帮助用户处理退款请求。",
})

complaintAgent, _ := llmagent.New(llmagent.Config{
    Name:        "complaint_agent",
    Model:       model,
    Instruction: "你是投诉处理专家。帮助用户处理投诉。",
})

coordinator, _ := llmagent.New(llmagent.Config{
    Name:        "coordinator",
    Model:       model,
    Instruction: "你是客服总机。根据用户问题，将用户转交给合适的专业 Agent。不要尝试自己解决专业问题。",
    SubAgents:   []agent.Agent{refundAgent, complaintAgent},
})
```

当用户说"我要退款"时，`coordinator` 会自动生成 `transfer_to_agent("refund_agent")` 调用，ADK 框架自动处理转移。

### 多 Agent 交互三大机制

| 机制 | 触发方式 | 适用场景 |
|------|----------|----------|
| **Shared State** | 自动（OutputKey → 模板变量） | 流水线数据传递 |
| **Agent Transfer** | LLM 自主决策 | 智能路由、意图分发 |
| **Agent-as-a-Tool** | LLM 像调用工具一样调用 | 按需调用另一个 Agent |

### 常见编排模式

**模式一：Coordinator/Dispatcher（总机分发）**

```
Coordinator（LLM Agent）
  ├── refund_agent
  ├── complaint_agent
  └── general_agent
```

用 Agent Transfer 实现（见上方实战示例）。

**模式二：Fan-Out/Gather（并行收集）**

```
SequentialAgent
  ├── ParallelAgent（并行获取）
  │     ├── researcher_1
  │     ├── researcher_2
  │     └── researcher_3
  └── synthesis_agent（汇总）
```

见并行调研实战示例。

**模式三：Iterative Refinement（迭代改进）**

```
SequentialAgent
  ├── initial_writer
  └── LoopAgent
        ├── critic
        └── reviser（含 exit_loop 工具）
```

见迭代文档改进实战示例。

**模式四：条件分支（Custom Agent）**

```go
conditionalRouter, _ := agent.New(agent.Config{
    Name:      "conditional_router",
    SubAgents: []agent.Agent{techAgent, generalAgent},
    Run: func(ctx agent.InvocationContext) iter.Seq2[*session.Event, error] {
        return func(yield func(*session.Event, error) bool) {
            category, _ := ctx.Session().State().Get("category")
            var target agent.Agent
            if category == "technical" {
                target = ctx.Agent().FindSubAgent("tech_agent")
            } else {
                target = ctx.Agent().FindSubAgent("general_agent")
            }
            for event, err := range target.Run(ctx) {
                if err != nil { yield(nil, err); return }
                if !yield(event, nil) { return }
            }
        }
    },
})
```

### 踩坑指南

**⚠️ Agent 单亲规则**：一个 Agent 实例只能作为一个父 Agent 的子 Agent。需要多处使用必须创建多个实例。

```go
// ❌ 错误：同一个 agent 不能被两个父 Agent 引用
shared := llmagent.New(...)
parent1 := sequentialagent.New(...{SubAgents: []agent.Agent{shared}})
parent2 := sequentialagent.New(...{SubAgents: []agent.Agent{shared}})  // 报错！

// ✅ 正确：创建两个独立的实例
agent1 := llmagent.New(...)
agent2 := llmagent.New(...)
```

**⚠️ ParallelAgent 竞态**：并行子 Agent 的 OutputKey 必须不同。

```go
// ❌ 错误：竞态！
agent1 := llmagent.New(...{OutputKey: "result"})
agent2 := llmagent.New(...{OutputKey: "result"})

// ✅ 正确
agent1 := llmagent.New(...{OutputKey: "result_a"})
agent2 := llmagent.New(...{OutputKey: "result_b"})
```

**⚠️ LoopAgent 必须有终止条件**：`MaxIterations: 0` 意味着无限循环，必须配合 exit_loop 工具使用。

**⚠️ Agent Routing 不支持 Go**：官方的 `RoutedAgent` 仅支持 TypeScript。Go 版本用 Custom Agent 实现（见模式四）。

### Workflow Agent 速查

| 类型 | 执行方式 | 终止条件 | 典型场景 |
|------|----------|----------|----------|
| SequentialAgent | 顺序执行 | 最后一个子 Agent 完成 | 流水线、多步处理 |
| ParallelAgent | 并行执行 | 所有子 Agent 完成 | 并行调研、多源获取 |
| LoopAgent | 循环执行 | MaxIterations 或 Escalate | 迭代改进、重试 |

```go
// SequentialAgent
seq, _ := sequentialagent.New(sequentialagent.Config{
    AgentConfig: agent.Config{Name: "pipeline", SubAgents: []agent.Agent{a1, a2, a3}},
})

// ParallelAgent
par, _ := parallelagent.New(parallelagent.Config{
    AgentConfig: agent.Config{Name: "parallel", SubAgents: []agent.Agent{a1, a2, a3}},
})

// LoopAgent
loop, _ := loopagent.New(loopagent.Config{
    AgentConfig: agent.Config{Name: "loop", SubAgents: []agent.Agent{a1, a2}},
    MaxIterations: 5,
})

// Agent Transfer（LLM 自主路由）
coordinator, _ := llmagent.New(llmagent.Config{
    Name: "coordinator", Model: model, SubAgents: []agent.Agent{agent1, agent2},
})

// Agent-as-a-Tool
tool := agenttool.New(someAgent, &agenttool.Config{SkipSummarization: true})
```

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
