# Agent 基础 - 从 LLMAgent 到自定义 Agent 的入门到原理

> **源码路径**：[`trpc-agent-go/examples/`](../../../../trpc-agent-go/examples)（本分类覆盖 llmagent/customagent/debugagent）
> **本页**：分类索引 + 深度原理（源自原 01-agent.md）
>
> Runner 相关内容已独立为 [`runner-executor`](../02-runner-executor/) 分类。

## 子示例导航

| 子示例 | 文章 | 难度 | 一句话说明 |
|--------|------|------|-----------|
| [`llmagent/`](./llmagent.md) | LLMAgent | 入门 | 用内置 `LLMAgent` 快速搭建流式多轮对话 |
| [`customagent/`](./customagent.md) | CustomAgent | 进阶 | 手动实现 Agent 接口做意图分支（闲聊/任务） |
| [`debugagent/`](./debugagent.md) | DebugAgent | 进阶 | 集成文件 ToolSet + CodeExecutor 的调试助手 |

## 选型建议

```
需要构建 Agent 应用？
├── 想最快上手、用内置实现              → llmagent（LLMAgent）
├── 要把 LLM 嵌入已有业务、保留控制权  → customagent（实现 Agent 接口）
└── Agent 需要操作文件、执行代码       → debugagent（ToolSet + CodeExecutor）
```

> 运行时基础设施（Runner/ManagedRunner/取消/历史注入/外循环）见 [`runner-executor`](../02-runner-executor/) 分类。

## 核心概念

- **Agent**：核心执行单元，实现 `Run/Info/SubAgents` 三件套。详见 [深度原理 › Agent 核心接口](#agent-核心接口)
- **Event**：Agent 通过 `<-chan *event.Event` 返回的流式事件，承载文本/工具调用/完成信号。详见 [深度原理 › 为什么 Agent 通过 channel 返回事件流](#为什么-agent-通过-channel-返回事件流)
- **Invocation**：每次 `Run` 的上下文，包含 Session、Model、Message、计数器、父子链。详见 [深度原理 › Invocation 上下文](#invocation-上下文)

## 深度原理

> 本节源自原「核心组件」深度文（01-agent.md + 03-runner.md），整合接口源码、设计哲学与配置速查。

### Agent 核心接口

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

### Invocation 上下文

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

**关键字段说明**：

| 字段 | 作用 |
|------|------|
| `InvocationID` | 每次 Run 的唯一标识，贯穿所有 Event |
| `parent` | 父 Invocation 指针，构建调用树——UI 层可据此渲染嵌套 Agent |
| `eventFilterKey` | 实现消息隔离的核心：通过前缀匹配决定哪些历史 Event 对当前 Agent 可见 |
| `state` + `stateMu` | 回调、中间件间的数据共享通道，惰性初始化 + RWMutex 保护 |
| `MaxLLMCalls` / `MaxToolIterations` | 两个独立安全阀，分别控成本和耗时 |
| `MemoryService` / `ArtifactService` | Runner 注入的基础设施服务 |

**State 读写 API**：

```go
inv.SetState("key", value)
value, ok := inv.GetState("key")
inv.DeleteState("key")

// 从 Context 取出当前 Invocation
inv, ok := agent.InvocationFromContext(ctx)
```

典型用法：在 `BeforeAgent` 回调中设置业务参数，`AfterTool` 回调中读取处理结果。

### LLMAgent 执行循环

`LLMAgent` 是 `Agent` 接口的标准实现。`Run()` 启动一个 goroutine，内部由 `LLMFlow` 驱动核心循环：

```go
func (a *LLMAgent) Run(ctx context.Context, inv *agent.Invocation) (<-chan *event.Event, error) {
    flow := a.createFlow(inv)
    eventCh := make(chan *event.Event, 256) // 缓冲 channel，防止阻塞
    go func() {
        defer close(eventCh)
        flow.Execute(ctx, inv, eventCh)
    }()
    return eventCh, nil
}
```

**循环的四阶段架构**（每一轮 LLM 往返都经历这四步）：

1. **messages 构建**（`buildMessages`）—— 最关键的性能与上下文步骤
   - 从 `Session.Events` 提取历史消息，应用 TimelineFilter + BranchFilter 双重过滤
   - 插入 System Instruction（含 `{key}` 占位变量替换）
   - 注入 Memory 预加载内容、Knowledge 检索结果（如果启用）
   - 应用 Context Compaction（压缩旧消息）、Token Tailoring（裁剪超窗）

2. **LLM 调用** —— 通过 `Model` 接口抽象，不限具体实现
   - 支持 channel 流式（`GenerateContent`）和迭代器流式（`GenerateContentIter`）
   - `BeforeModel` / `AfterModel` 回调插入点

3. **响应分发** —— 根据 Choice 内容分流
   - `content ≠ null` → 文本，结束循环
   - `tool_calls ≠ null` → 提取 `tool_call_id`，执行工具，结果 append 到 messages，继续循环
   - `refusal ≠ null` → 安全拒绝，结束
   - `finish_reason = "length"` → Token 耗尽，可在下次 Run 中续写

4. **安全检查** —— 每轮后递增计数器
   - `llmCallCount++` 达到 `MaxLLMCalls` → 返回 `StopError`
   - `toolIterationCount++` 达到 `MaxToolIterations` → 发出 `flow_error`

#### 消息过滤的双维规则

TimelineFilter + BranchFilter 是**交集**关系——只有同时满足两者的 Event 才会被包含：

```
条件 A（TimelineFilter，时间维）：
  - All               : event 时间戳 ∈ (-∞, now]
  - CurrentRequest    : event.requestID == 当前 requestID
  - CurrentInvocation : event.invocationID ∈ 当前及祖先

条件 B（BranchFilter，分支维）：
  - All               : 所有 event
  - Prefix            : event.FilterKey 是 inv.eventFilterKey 的前缀
  - Exact             : event.FilterKey == inv.eventFilterKey
  - Subtree           : inv.eventFilterKey 是 event.FilterKey 的前缀

最终可见 = A ∩ B ∪ {invocation.Message（始终可见）}
```

### 设计哲学

#### 为什么 Agent 通过 channel 返回事件流？

| 方式 | 优点 | 缺点 |
|------|------|------|
| 直接返回 string | 简单 | 不支持流式、工具调用、多轮交互 |
| 回调函数 | 灵活 | 控制反转，调试困难 |
| **channel 事件流** | 流式 + 并发安全 + 可组合 | 调用方需要消费完 |

tRPC-Agent-Go 选择 channel 是因为：

1. **流式生成**：每个 chunk 是一个 event，UI 可实时渲染
2. **工具调用可见**：每步 tool call 和 tool result 都是独立 event
3. **并发安全**：多个 goroutine 可安全地向同一个 channel 发送（内置锁）
4. **可组合**：Runner 在 channel 之上附加 Session/Memory 逻辑，形成责任链

#### 为什么消息过滤需要两个维度？

- **TimelineFilter**（时间维）：解决"同一 session 内多轮对话的消息隔离"。例如 A/B 测试中用不同 agent 处理同一 session 不同轮次
- **BranchFilter**（分支维）：解决"嵌套 Agent 调用树中的消息可见性"。子 Agent 不应看到兄弟分支的消息

两者组合覆盖了多 Agent 系统中消息隔离的全部场景。

#### 为什么 MaxLLMCalls 和 MaxToolIterations 分开计数？

- **MaxLLMCalls**：限制 **API 调用成本**——每次 LLM 调用都产生费用
- **MaxToolIterations**：限制 **工具调用循环**——工具可能在本地执行，不产生 API 费用但可能耗时

分开计数让用户能分别控制"花费"和"时间"两个维度。

#### 为什么 Invocation 用 parent 指针？

`parent *Invocation` 构建调用树而非复制整个上下文：

- 子 Agent 可以向上回溯找到根 Invocation 的状态
- UI 层可据此渲染嵌套 Agent 调用链
- 避免大对象复制带来的开销与一致性麻烦

> Runner 相关的设计哲学（为什么 Runner 不属于 Agent 接口、Completion 事件、Ralph Loop vs CycleAgent、取消与清理）见 [`runner-executor` 深度原理](../02-runner-executor/index.md#设计哲学)。

### 配置速查

#### Agent 配置（`NewLLMAgent` functional options）

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

> Runner 配置见 [`runner-executor` 配置速查](../02-runner-executor/index.md#配置速查)。

## 学习路径建议

1. **先读 [`llmagent`](./llmagent.md)**：用内置 `LLMAgent` 跑通第一个流式对话，理解 Agent 的最小接线
2. **按控制权需求分支**：
   - 想完全自定义 → [`customagent`](./customagent.md)
   - Agent 要操作文件/代码 → [`debugagent`](./debugagent.md)
3. **回到本页「深度原理」节**：在跑通示例后重读接口签名与设计哲学，理解"为什么这么设计"
4. **继续学习运行时基础设施**：→ [`runner-executor`](../02-runner-executor/) 分类（Runner/ManagedRunner/取消/外循环）

## 总结

Agent 基础分类的设计精髓在于**接口极简、扩展靠注入**：

- **Agent 接口**只有 4 个方法，所有扩展（工具、子 Agent、回调、安全限制）通过 `Invocation` 和 functional options 注入
- **channel 事件流**贯穿全栈：流式、并发安全、可组合，是 tRPC-Agent-Go 的核心抽象
- **Agent 与 Runner 解耦**：Agent 只管逻辑，运行时基础设施由 [`runner-executor`](../02-runner-executor/) 分类覆盖

进一步学习：

- 运行时基础设施：[`runner-executor`](../02-runner-executor/)
- 宏观架构与组件关系：[`18-architecture`](../../18-architecture.md) / [`19-diagrams`](../../19-diagrams.md)
- 工具系统：[`02-tool-system`](../03-tool-system/)
- 多 Agent 编排：[`05-multi-agent`](../06-multi-agent/)
- Session / Memory 深度：[`06-memory-system`](../07-memory-system/memory.md) / [`07-session-management`](../08-session-management/session.md)
