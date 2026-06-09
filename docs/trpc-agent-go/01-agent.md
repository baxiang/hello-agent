# Agent 系统详解

Agent 是 tRPC-Agent-Go 框架的核心执行单元，负责处理用户输入并生成响应。每个 Agent 实现统一的 `agent.Agent` 接口，支持流式输出和回调机制。

## 1. Agent 接口

```go
type Agent interface {
    Run(ctx context.Context, invocation *Invocation) (<-chan *event.Event, error)
    Info() Info
    SubAgents() []Agent
    FindSubAgent(name string) Agent
}
```

- **Run**：核心执行方法，接收 Invocation 上下文，返回事件流 channel
- **Info**：返回 Agent 基本信息（名称、描述）
- **SubAgents**：可委托的子 Agent 列表
- **FindSubAgent**：按名称查找子 Agent

## 2. Agent 类型全景

| Agent 类型 | 包路径 | 用途 | 典型场景 |
|-----------|--------|------|----------|
| **LLMAgent** | `agent/llmagent` | 基于 LLM 的智能代理 | 对话、推理、工具调用 |
| **ChainAgent** | `agent/chainagent` | 顺序执行子 Agent | 流水线式多步任务 |
| **ParallelAgent** | `agent/parallelagent` | 并发执行子 Agent | 多路独立分析后汇总 |
| **CycleAgent** | `agent/cycleagent` | 循环迭代直到终止条件 | 自优化、多轮协商 |
| **GraphAgent** | `agent/graphagent` | 图工作流编排 | 复杂条件分支、HITL |
| **A2AAgent** | `agent/a2aagent` | 与远程 A2A Agent 通信 | 跨框架互操作 |
| **ClaudeCodeAgent** | `agent/claudecode` | 调用本地 Claude Code CLI | 代码编写、文件操作 |
| **CodexAgent** | `agent/codex` | 调用本地 Codex CLI | 代码编写与执行 |
| **DifyAgent** | `agent/dify` | Dify 平台集成 | 低代码 Agent 构建 |

## 3. LLMAgent 详解

LLMAgent 是最核心的 Agent 类型，封装了 LLM 推理、工具调用、消息过滤等完整能力。

### 3.1 创建 LLMAgent

```go
import "trpc.group/trpc-go/trpc-agent-go/agent/llmagent"

agent := llmagent.New("assistant",
    // 基础配置
    llmagent.WithModel(modelInstance),          // 模型实例
    llmagent.WithDescription("A helpful assistant"), // Agent 描述
    llmagent.WithInstruction("You are a helpful AI assistant."), // 系统指令

    // 工具配置
    llmagent.WithTools([]tool.Tool{calculatorTool, searchTool}),
    llmagent.WithToolSets([]tool.ToolSet{mcpToolSet}),

    // 生成配置
    llmagent.WithGenerationConfig(model.GenerationConfig{
        Stream:      true,
        Temperature: floatPtr(0.7),
        MaxTokens:   intPtr(2000),
    }),

    // 子 Agent（可被委托）
    llmagent.WithSubAgents([]agent.Agent{weatherAgent, mathAgent}),

    // 安全限制
    llmagent.WithMaxLLMCalls(10),
    llmagent.WithMaxToolIterations(5),

    // 会话摘要
    llmagent.WithAddSessionSummary(true),
)
```

### 3.2 完整配置选项

| 配置方法 | 类型 | 说明 |
|----------|------|------|
| `WithModel(m)` | Model | 设置 LLM 模型实例 |
| `WithDescription(d)` | string | Agent 功能描述 |
| `WithInstruction(i)` | string | 系统指令（支持 `{key}` 占位变量） |
| `WithTools(tools)` | []Tool | 工具列表 |
| `WithToolSets(sets)` | []ToolSet | 工具集列表 |
| `WithGenerationConfig(c)` | GenerationConfig | 生成参数 |
| `WithSubAgents(a)` | []Agent | 子 Agent 列表 |
| `WithMaxLLMCalls(n)` | int | 最大 LLM 调用次数 |
| `WithMaxToolIterations(n)` | int | 最大工具迭代次数 |
| `WithMessageTimelineFilterMode(m)` | int | 时间维消息过滤 |
| `WithMessageBranchFilterMode(m)` | int | 分支维消息过滤 |
| `WithReasoningContentMode(m)` | int | 推理内容处理模式 |
| `WithStructuredOutputJSON(v)` | any | 结构化 JSON 输出 |
| `WithStructuredOutputJSONSchema(s)` | map | 自定义 JSON Schema 输出 |
| `WithOutputSchema(s)` | map | 旧版输出 Schema |
| `WithOutputKey(k)` | string | 提取输出到 Session State |
| `WithAddSessionSummary(b)` | bool | 启用会话摘要 |
| `WithEnableContextCompaction(b)` | bool | 启用上下文压缩 |
| `WithCodeExecutor(e)` | CodeExecutor | 代码执行器（用于 Skills） |
| `WithEnableCodeExecutionResponseProcessor(b)` | bool | 是否自动执行代码块 |
| `WithToolCallRetryPolicy(p)` | RetryPolicy | 工具调用重试策略 |
| `WithAgentCallbacks(c)` | Callbacks | Agent 级回调 |
| `WithDefaultTransferMessage(m)` | string | 默认委托消息 |
| `WithEnablePostToolPrompt(b)` | bool | 工具调用后提示注入 |
| `WithPostToolPrompt(p)` | string | 自定义工具调用后提示 |
| `WithAwaitUserReplyTool(b)` | bool | 启用 await_user_reply 工具 |

### 3.3 消息可见性控制

LLMAgent 支持两种维度的消息过滤，决定哪些历史消息会被传入模型。

**时间维度 (TimelineFilterMode)**

| 模式 | 常量 | 说明 |
|------|------|------|
| 全部 | `TimelineFilterAll` | 历史消息 + 当前请求消息（默认） |
| 当前请求 | `TimelineFilterCurrentRequest` | 仅当前 `runner.Run` 的消息 |
| 当前调用 | `TimelineFilterCurrentInvocation` | 仅当前 Invocation 上下文 |

**分支维度 (BranchFilterMode)**

| 模式 | 常量 | 说明 |
|------|------|------|
| 全部 | `BranchFilterModeAll` | 所有 Agent 的消息 |
| 前缀匹配 | `BranchFilterModePrefix` | 祖先/自身/后代（默认） |
| 子树 | `BranchFilterModeSubtree` | 仅自身和后代 |
| 精确匹配 | `BranchFilterModeExact` | Event.FilterKey == Invocation.eventFilterKey |

**快捷模式**：`WithMessageFilterMode` 提供四种预组合模式：

| 模式 | 时间 | 分支 | 场景 |
|------|------|------|------|
| `FullContext` | All | Prefix | 完整上下文 |
| `RequestContext` | CurrentRequest | Prefix | 当前请求范围 |
| `IsolatedRequest` | CurrentRequest | Exact | 完全隔离当前请求 |
| `IsolatedInvocation` | CurrentInvocation | Exact | 完全隔离当前调用 |

### 3.4 结构化输出

| 方法 | 说明 | 推荐度 |
|------|------|--------|
| `WithStructuredOutputJSON(v, strict, desc)` | 从 Go 类型自动生成 Schema | 推荐 |
| `WithStructuredOutputJSONSchema(name, schema, strict, desc)` | 自定义 JSON Schema | 灵活 |
| `WithOutputSchema(schema)` | 旧版方式 | 不推荐 |
| `WithOutputKey(key)` | 提取特定字段到 Session State | 辅助 |

**示例**：

```go
type WeatherResult struct {
    City        string  `json:"city"`
    Temperature float64 `json:"temperature"`
    Condition   string  `json:"condition"`
}

agent := llmagent.New("weather-bot",
    llmagent.WithModel(modelInstance),
    llmagent.WithStructuredOutputJSON(
        new(WeatherResult),
        true,
        "Return weather information as JSON.",
    ),
)
```

### 3.5 Placeholder 变量注入

LLMAgent 支持在 `Instruction` 和 `SystemPrompt` 中使用占位变量，运行时自动替换为 Session State 中的值：

```
{key}              → 替换为 session state 中 key 的值
{key?}             → 可选；缺失时替换为空字符串
{user:subkey}      → 用户级别状态
{app:subkey}       → 应用级别状态
{temp:subkey}      → 临时状态
{invocation:subkey} → Invocation 级别的状态
```

```go
agent := llmagent.New("research-agent",
    llmagent.WithModel(modelInstance),
    llmagent.WithInstruction(
        "You are a research assistant. Focus: {research_topics}. " +
        "User interests: {user:topics?}. App banner: {app:banner?}.",
    ),
)
```

### 3.6 Reasoning Content Mode（DeepSeek 思考模式）

控制在多轮对话中如何处理 `reasoning_content`（思维链内容）：

| 模式 | 常量 | 行为 |
|------|------|------|
| 丢弃前轮 | `ReasoningContentModeDiscardPreviousTurns` | 仅当前请求保留，历史清除（推荐） |
| 保留全部 | `ReasoningContentModeKeepAll` | 全部保留（调试用） |
| 全部丢弃 | `ReasoningContentModeDiscardAll` | 节省带宽 |

### 3.7 回调系统

Agent 支持三个级别的回调：

```go
// Agent 级回调（创建时）
agent := llmagent.New("assistant",
    llmagent.WithAgentCallbacks(agent.NewCallbacks().
        RegisterBeforeAgent(func(ctx context.Context, args *agent.BeforeAgentArgs) (*agent.BeforeAgentResult, error) {
            // Agent 开始执行前
            return nil, nil
        }).
        RegisterAfterAgent(func(ctx context.Context, args *agent.AfterAgentArgs) (*agent.AfterAgentResult, error) {
            // Agent 执行完成后
            return nil, nil
        }),
    ),
)

// 请求级回调（通过 RunOptions）
events, _ := r.Run(ctx, userID, sessionID, msg,
    agent.WithAgentCallbacks(myCallbacks),
)
```

---

## 4. Multi-Agent 编排

### 4.1 ChainAgent — 顺序执行

```go
pipeline := chainagent.New("pipeline",
    chainagent.WithSubAgents([]agent.Agent{
        analyzer,
        processor,
        reporter,
    }),
)
```

每个子 Agent 的输出作为下一个的输入，适合"分析→处理→报告"类流水线任务。

### 4.2 ParallelAgent — 并发执行

```go
parallel := parallelagent.New("multi-expert",
    parallelagent.WithSubAgents([]agent.Agent{
        legalExpert,
        technicalExpert,
        businessExpert,
    }),
)
```

多个 Agent 并发处理同一输入，结果合并后返回。

### 4.3 CycleAgent — 循环迭代

```go
cycler := cycleagent.New("optimizer",
    cycleagent.WithSubAgents([]agent.Agent{planner, executor}),
    cycleagent.WithMaxIterations(5),
)
```

循环执行直到满足终止条件，适合需要多轮优化的场景。

### 4.4 AgentTool — 将 Agent 包装为工具

```go
agentTool := agenttool.New(weatherAgent,
    agenttool.WithSkipSummarization(true),
    agenttool.WithStreamInner(true),
)

coordinator := llmagent.New("coordinator",
    llmagent.WithModel(modelInstance),
    llmagent.WithTools([]tool.Tool{agentTool}),
)
```

支持流式转发和多种响应模式，详见 [Tool 系统文档](./04-tool)。

### 4.5 Runtime Instruction 覆盖

支持通过 `agent.WithInstruction(...)` 在 `Run()` 时动态覆盖 Agent 指令：

```go
events, _ := r.Run(ctx, userID, sessionID, msg,
    agent.WithInstruction("You are now a French translator."),
)
```

也支持 `WithModelName(name)` 动态切换模型。

---

## 5. Invocation 上下文

`Invocation` 是 Agent 执行的完整上下文对象，包含 Session、Message、RunOptions 等：

```go
type Invocation struct {
    Agent            Agent
    AgentName        string
    InvocationID     string
    Branch           string
    Session          *session.Session
    Model            model.Model
    Message          model.Message
    RunOptions       RunOptions
    TransferInfo     *TransferInfo
    MemoryService    memory.Service
    ArtifactService  artifact.Service
    StructuredOutput *model.StructuredOutput
    MaxLLMCalls      int
    MaxToolIterations int
    // ...
}
```

### Invocation State

`Invocation` 提供线程安全的键值存储，用于在回调、中间件间共享数据：

```go
inv.SetState("key", value)
value, ok := inv.GetState("key")
inv.DeleteState("key")
```

### 从 Context 获取 Invocation

```go
inv, ok := agent.InvocationFromContext(ctx)
```

---

## 6. 安全机制

### 调用次数限制

```go
agent := llmagent.New("safe-agent",
    llmagent.WithMaxLLMCalls(10),      // 达到上限返回 StopError
    llmagent.WithMaxToolIterations(5), // 达到上限发出 flow_error 事件
)
```

两个限制独立生效，每次 `runner.Run()` 重新计数。

### 委托可见性

```go
coordinator := llmagent.New("coordinator",
    llmagent.WithSubAgents([]agent.Agent{mathAgent, weatherAgent}),
    llmagent.WithDefaultTransferMessage("Handing off to the specialist"),
)
```

Transfer 事件始终带 `transfer` 标签发出，UI 可按需过滤。
