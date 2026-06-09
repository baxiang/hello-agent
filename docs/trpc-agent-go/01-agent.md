# Agent 系统 — 源码·实战·原理

Agent 是 tRPC-Agent-Go 的核心执行单元。本文从 LLMAgent 源码走读开始，深入执行循环、Invocation 上下文、回调机制，最后以自定义 Agent 实战收尾。

## 1. 概念概述

### 1.1 Agent 接口定义

```go
// agent/agent.go
type Agent interface {
    Run(ctx context.Context, invocation *Invocation) (<-chan *event.Event, error)
    Info() Info
    SubAgents() []Agent
    FindSubAgent(name string) Agent
}

type Info struct {
    Name        string
    Description string
}
```

**接口设计原则**：
- `Run` 返回 `<-chan *event.Event` 而非直接返回结果——适配流式生成、工具调用多次往返
- `SubAgents()` + `FindSubAgent()` 编织出 Agent 嵌套树，支持递归委托
- 接口极简，所有扩展通过 `Invocation.RunOptions` 和 callback 注入

### 1.2 Invocation 上下文

```go
// agent/invocation.go
type Invocation struct {
    Agent            Agent
    AgentName        string
    InvocationID     string         // UUID，每次 Run 唯一
    Branch           string         // 分支标识，用于消息过滤
    EndInvocation    bool           // 标记结束
    Session          *session.Session
    Model            model.Model
    Message          model.Message  // 当前轮用户消息
    RunOptions       RunOptions
    TransferInfo     *TransferInfo

    // 注入的服务
    MemoryService    memory.Service
    ArtifactService  artifact.Service

    // 结构化输出
    StructuredOutput     *model.StructuredOutput
    StructuredOutputType reflect.Type

    // 安全限制
    MaxLLMCalls       int
    MaxToolIterations int

    // 内部计数
    llmCallCount       int
    toolIterationCount int

    // 事件过滤
    eventFilterKey string
    parent         *Invocation // 父 Invocation（子 Agent 场景）

    // Invocation 级别的键值存储（线程安全）
    state   map[string]any
    stateMu sync.RWMutex
}
```

**设计要点**：
- `InvocationID` 是每个 Run 的唯一标识，贯穿所有 Event
- `parent` 指针构建调用树——UI 层可据此渲染嵌套 Agent
- `eventFilterKey` 是实现消息隔离的核心：通过前缀匹配决定哪些历史 Event 对当前 Agent 可见
- `state` 提供回调、中间件间的数据共享通道，惰性初始化+RWMutex 保护

### 1.3 Invocation State

```go
// 线程安全的键值存储
inv.SetState("key", value)
value, ok := inv.GetState("key")
inv.DeleteState("key")

// 从 Context 获取当前 Invocation
inv, ok := agent.InvocationFromContext(ctx)
```

**典型用法**：在 BeforeAgent 回调中设置业务参数，AfterTool 回调中读取处理结果。

---

## 2. 源码走读：LLMAgent 执行循环

### 2.1 LLMAgent 结构

```go
// agent/llmagent/llm_agent.go
type LLMAgent struct {
    name             string
    description      string
    instruction      string
    model            model.Model
    tools            []tool.Tool
    toolSets         []tool.ToolSet
    subAgents        []agent.Agent
    genConfig        model.GenerationConfig
    callbacks        *agent.Callbacks
    maxLLMCalls      int
    maxToolIterations int
    // ...更多配置
}
```

### 2.2 Run() 入口

```go
func (a *LLMAgent) Run(ctx context.Context, inv *agent.Invocation) (<-chan *event.Event, error) {
    // 1. 初始化内部 flow
    flow := a.createFlow(inv)

    // 2. 启动 goroutine 执行核心循环
    eventCh := make(chan *event.Event, 256) // 缓冲 channel，防止阻塞
    go func() {
        defer close(eventCh)
        flow.Execute(ctx, inv, eventCh)
    }()

    return eventCh, nil
}
```

**为什么用 goroutine + channel 而非直接返回结果？**
- LLM 流式响应需要逐 chunk 推送
- 工具调用需要多次 LLM 往返（think → tool call → tool result → think → ...）
- 256 缓冲 channel 在大部分场景下足够，高并发时 goroutine 不会因 channel 写入阻塞

### 2.3 核心执行循环

```go
// internal/flow/llmflow/llm_flow.go（简化版）
func (f *LLMFlow) Execute(ctx context.Context, inv *agent.Invocation, eventCh chan<- *event.Event) {
    for {
        // ═══ 前置处理 ═══
        // 1. 构建 messages（系统指令 + 历史消息 + 当前消息）
        messages := f.buildMessages(ctx, inv)

        // 2. 构建 request
        request := &model.Request{
            Messages:         messages,
            GenerationConfig: f.genConfig,
            Tools:            f.toolMap,
        }

        // ═══ 调用 LLM ═══
        responseCh, err := inv.Model.GenerateContent(ctx, request)
        if err != nil { /* 错误处理 */ }

        // ═══ 处理响应 ═══
        var finalResponse *model.Response
        for response := range responseCh {
            // 转发每个 chunk 到外部 event channel
            eventCh <- f.createEvent(inv, response)

            if response.Done {
                finalResponse = response
                break
            }
        }

        // ═══ 判断下一步 ═══
        choice := finalResponse.Choices[0]

        if choice.Message.Content != "" {
            // 文本回复 → 结束循环
            break
        }

        if choice.Message.ToolCalls != nil {
            // 工具调用 → 执行工具 → 继续循环
            toolResults := f.executeTools(ctx, inv, choice.Message.ToolCalls)
            f.appendToolResults(inv, toolResults)
            continue
        }

        if choice.Message.Refusal != "" {
            // 安全拒绝 → 结束循环
            break
        }
    }
}
```

**执行循环关键节点**：

1. **messages 构建**（最关键的性能和上下文步骤）
   - 从 Session Events 提取历史消息
   - 应用 TimelineFilter + BranchFilter 双重过滤
   - 插入 System Instruction（含 `{key}` 占位变量替换）
   - 注入 Memory 预加载内容
   - 注入 Knowledge 检索结果（如果启用）
   - 应用 Context Compaction（压缩旧消息）

2. **LLM 调用**
   - 通过 `Model` 接口抽象，不限具体实现
   - 支持 channel 流式（`GenerateContent`）和迭代器流式（`GenerateContentIter`）
   - BeforeModel / AfterModel 回调插入点

3. **响应分发**
   - `content ≠ null` → 文本，直接结束
   - `tool_calls ≠ null` → 提取 tool_call_id，执行工具，结果 append 到 messages，继续循环
   - `refusal ≠ null` → 安全拒绝，结束
   - `finish_reason = "length"` → Token 耗尽，可在下次 Run 中续写

4. **安全检查**
   - 每次 LLM 调用后 `llmCallCount++`，达到 `MaxLLMCalls` 返回 StopError
   - 每次工具迭代后 `toolIterationCount++`，达到 `MaxToolIterations` 发出 flow_error

### 2.4 消息构建（buildMessages 详解）

这是 LLMAgent 最复杂的处理步骤之一：

```
┌──────────────────────────────────────────────────┐
│              buildMessages 流程                    │
│                                                    │
│  1. 从 Session.Events 加载历史消息                  │
│     ├─ TimelineFilter 过滤（时间维）                │
│     └─ BranchFilter 过滤（分支维）                  │
│                                                    │
│  2. System Message 构建                            │
│     ├─ Instruction（含 {key} 占位变量替换）          │
│     ├─ SystemPrompt（额外的系统消息）                │
│     ├─ PostToolPrompt（工具调用后引导）              │
│     ├─ Memory 预加载内容                           │
│     └─ Session Summary（如果启用）                  │
│                                                    │
│  3. 历史 Messages + 当前 Invocation.Message         │
│                                                    │
│  4. Context Compaction（如果启用）                  │
│     ├─ Pass 1：旧工具结果 → 占位符                 │
│     └─ Pass 2：超大消息截断                        │
│                                                    │
│  5. Reasoning Content 处理                         │
│     └─ 根据 ReasoningContentMode 清除历史思考内容   │
│                                                    │
│  6. Token Tailoring（如果模型层启用）               │
│     └─ 超出上下文窗口时自动裁剪                    │
└──────────────────────────────────────────────────┘
```

### 2.5 消息过滤的数学规则

TimelineFilter + BranchFilter 是**交集**关系——只有同时满足两者的 Event 才会被包含。

```
条件 A（TimelineFilter）：
  - TimelineFilterAll: event 的时间戳 ∈ (-∞, now]
  - TimelineFilterCurrentRequest: event 的 requestID == 当前 requestID
  - TimelineFilterCurrentInvocation: event 的 invocationID == 当前 invocationID 或 祖先 invocationID

条件 B（BranchFilter）：
  - BranchFilterModeAll: 所有 event
  - BranchFilterModePrefix: event.FilterKey 是 inv.eventFilterKey 的前缀
  - BranchFilterModeExact: event.FilterKey == inv.eventFilterKey
  - BranchFilterModeSubtree: inv.eventFilterKey 是 event.FilterKey 的前缀

最终可见 = A ∩ B ∪ {invocation.Message（始终可见）}
```

---

## 3. 实战：自定义 Agent

### 3.1 实现 Agent 接口

```go
package main

import (
    "context"
    "fmt"

    "trpc.group/trpc-go/trpc-agent-go/agent"
    "trpc.group/trpc-go/trpc-agent-go/event"
    "trpc.group/trpc-go/trpc-agent-go/model"
    "trpc.group/trpc-go/trpc-agent-go/runner"
)

// GreetingAgent 是一个简单的问候 Agent
type GreetingAgent struct {
    name   string
    prompt string
}

func (a *GreetingAgent) Run(ctx context.Context, inv *agent.Invocation) (<-chan *event.Event, error) {
    ch := make(chan *event.Event, 1)
    go func() {
        defer close(ch)
        // 构建响应
        response := &model.Response{
            Done: true,
            Choices: []model.Choice{{
                Index: 0,
                Message: model.Message{
                    Role:    model.RoleAssistant,
                    Content: fmt.Sprintf("%s: Hello, %s!", a.prompt, inv.Message.Content),
                },
            }},
        }
        agent.EmitEvent(ctx, inv, ch, event.NewResponseEvent(inv.InvocationID, a.name, response))
    }()
    return ch, nil
}

func (a *GreetingAgent) Info() agent.Info {
    return agent.Info{Name: a.name, Description: "A simple greeting agent"}
}

func (a *GreetingAgent) SubAgents() []agent.Agent { return nil }
func (a *GreetingAgent) FindSubAgent(name string) agent.Agent { return nil }
```

### 3.2 使用自定义 Agent

```go
func main() {
    myAgent := &GreetingAgent{name: "greeter", prompt: "Welcome"}
    r := runner.NewRunner("greeting-app", myAgent)
    defer r.Close()

    ctx := context.Background()
    events, _ := r.Run(ctx, "user-1", "session-1",
        model.NewUserMessage("World"),
    )

    for event := range events {
        if event.Error != nil {
            fmt.Printf("Error: %s\n", event.Error.Message)
            continue
        }
        if len(event.Response.Choices) > 0 {
            fmt.Println(event.Response.Choices[0].Message.Content)
        }
        if event.IsRunnerCompletion() { break }
    }
    // Output: Welcome: Hello, World!
}
```

### 3.3 自定义 Agent 最佳实践

1. **使用 `agent.EmitEvent` 发射事件**：自动处理关闭 channel 语义，不会写入已关闭 channel
2. **在 goroutine 中执行**：Agent.Run 必须非阻塞返回，所以启动 goroutine
3. **检查 context.Done()**：支持取消和超时
4. **defer close(ch)**：确保调用方的事件循环能正常退出

```go
func (a *MyAgent) Run(ctx context.Context, inv *agent.Invocation) (<-chan *event.Event, error) {
    ch := make(chan *event.Event, 16)
    go func() {
        defer close(ch)
        for i := 0; i < 10; i++ {
            select {
            case <-ctx.Done():
                return // 支持取消
            default:
            }
            // 发送进度事件
            agent.EmitEvent(ctx, inv, ch, &event.Event{
                InvocationID: inv.InvocationID,
                Author:       a.name,
                Response:     &model.Response{Done: true, Choices: []model.Choice{{Message: model.Message{Content: fmt.Sprintf("step %d", i)}}}},
            })
        }
    }()
    return ch, nil
}
```

---

## 4. 设计原理

### 4.1 为什么 Agent 通过 channel 返回事件流？

| 方式 | 优点 | 缺点 |
|------|------|------|
| 直接返回 string | 简单 | 不支持流式、工具调用、多轮交互 |
| 回调函数 | 灵活 | 控制反转，调试困难 |
| **channel 事件流** | 流式+并发安全+可组合 | 调用方需要消费完 |

tRPC-Agent-Go 选择 channel 是因为：
1. **流式生成**：每个 chunk 是一个 event，UI 可实时渲染
2. **工具调用可见**：每步 tool call 和 tool result 都是独立 event
3. **并发安全**：多个 goroutine 可安全地向同一个 channel 发送（内置锁）
4. **可组合**：Runner 在 channel 之上附加 Session/Memory 逻辑，形成责任链

### 4.2 消息过滤的双维设计

为什么需要两个维度？

- **TimelineFilter**：解决"同一 session 内多轮对话的消息隔离"。例如 A/B 测试中用不同 agent 处理同一 session 不同轮次
- **BranchFilter**：解决"嵌套 Agent 调用树中的消息可见性"。子 Agent 不应看到兄弟分支的消息

两者组合覆盖了多 Agent 系统中消息隔离的全部场景。

### 4.3 安全限制的设计考量

`MaxLLMCalls` 和 `MaxToolIterations` 分开计数的原因：

- **MaxLLMCalls**：限制 API 调用成本——每次 LLM 调用都产生费用
- **MaxToolIterations**：限制工具调用循环——工具可能在本地执行，不产生 API 费用但可能耗时

分开计数让用户能分别控制"花费"和"时间"两个维度。

---

## 5. 配置速查

| 配置 | 说明 | 默认 |
|------|------|------|
| `WithModel(m)` | LLM 模型 | 必填 |
| `WithInstruction(i)` | 系统指令，支持 `{key}` 占位 | "" |
| `WithTools(ts)` | 工具列表 | nil |
| `WithToolSets(sets)` | 工具集（MCP 等） | nil |
| `WithSubAgents(a)` | 子 Agent 列表 | nil |
| `WithMaxLLMCalls(n)` | n≤0 不限制 | 0 |
| `WithMaxToolIterations(n)` | n≤0 不限制 | 0 |
| `WithGenerationConfig(c)` | Stream/Temperature/MaxTokens 等 | zero-value |
| `WithMessageTimelineFilterMode(m)` | 时间维过滤 | TimelineFilterAll |
| `WithMessageBranchFilterMode(m)` | 分支维过滤 | BranchFilterModePrefix |
| `WithReasoningContentMode(m)` | 思考内容处理 | DiscardPreviousTurns |
| `WithToolCallRetryPolicy(p)` | 工具重试策略 | nil（不重试） |
| `WithAddSessionSummary(b)` | 启用会话摘要 | false |
| `WithEnableContextCompaction(b)` | 上下文压缩 | false |
| `WithStructuredOutputJSON(v, strict, desc)` | JSON 结构化输出 | — |
| `WithCodeExecutor(e)` | 代码执行器（Skills） | nil |
| `WithAgentCallbacks(c)` | Agent 级别回调 | nil |
