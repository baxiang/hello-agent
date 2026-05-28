# 接口与组合 — ADK-Go Agent 体系的骨架

## 1. Agent 接口：七个方法定义一切

adk-go 的核心是 `Agent` 接口（`agent/agent.go:43-52`）：

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

这七个方法各司其职：

| 方法 | 职责 |
|------|------|
| `Name()` | Agent 唯一标识，在 Agent 树中不能重复 |
| `Description()` | 能力描述，LLM 用它决定是否委派任务给此 Agent |
| `Run()` | 核心执行逻辑，返回事件流迭代器 |
| `SubAgents()` | 返回子 Agent 列表，构成 Agent 树 |
| `FindAgent()` | 在整棵子树中按名称查找 Agent |
| `FindSubAgent()` | 在直接子 Agent 中查找 |
| `internal()` | 密封接口，防止包外实现 |

---

## 2. internal() 密封接口模式

`internal() *agent` 是 adk-go 的**密封接口**（Sealed Interface）模式。这个方法返回包内私有类型 `*agent`（`agent/agent.go:139`），包外代码无法构造 `*agent` 值，因此无法直接实现 `Agent` 接口。

### 为什么需要密封？

```go
// 包外代码无法做到这一点，因为 agent 是小写的
type myAgent struct{}

func (m *myAgent) internal() *agent {
    // 编译错误：无法引用 agent（小写）
    return nil
}
```

这意味着**所有 Agent 必须通过 adk-go 提供的构造函数创建**，如 `agent.New()`、`llmagent.New()`、`sequentialagent.New()` 等。这保证了：
1. 所有 Agent 都经过正确的初始化流程
2. 框架可以在创建时注入必要的内部状态（telemetry、callback 链等）
3. 未来版本可以安全修改内部实现，不破坏兼容性

### 构造函数的统一入口

`agent.New()` 是自定义 Agent 的构造器（`agent/agent.go:55`）：

```go
func New(cfg Config) (Agent, error) {
    subAgentSet := make(map[Agent]bool)
    for _, subAgent := range cfg.SubAgents {
        if _, ok := subAgentSet[subAgent]; ok {
            return nil, fmt.Errorf("subagent %q appears multiple times", subAgent.Name())
        }
        subAgentSet[subAgent] = true
    }
    return &agent{
        name:                 cfg.Name,
        description:          cfg.Description,
        subAgents:            cfg.SubAgents,
        beforeAgentCallbacks: cfg.BeforeAgentCallbacks,
        run:                  cfg.Run,
        afterAgentCallbacks:  cfg.AfterAgentCallbacks,
        State: agentinternal.State{
            AgentType: agentinternal.TypeCustomAgent,
        },
    }, nil
}
```

构造函数做了两件事：
1. **校验**：确保子 Agent 名称不重复
2. **包装**：创建 `*agent` 结构体，注入内部状态

---

## 3. Config 结构体替代直接实现接口

adk-go 没有让用户直接实现 `Agent` 接口，而是用 `Config` 结构体（`agent/agent.go:77-107`）+ 构造函数的方式：

```go
type Config struct {
    Name                 string
    Description          string
    SubAgents            []Agent
    BeforeAgentCallbacks []BeforeAgentCallback
    Run                  func(InvocationContext) iter.Seq2[*session.Event, error]
    AfterAgentCallbacks  []AfterAgentCallback
}
```

用户只需填写 `Config`，框架负责组装完整的 `Agent` 实现。这比直接实现接口有几个好处：
- **减少样板代码**：用户不需要实现 `FindAgent`、`FindSubAgent`、`internal()` 等方法
- **强制校验**：构造函数可以统一验证参数
- **默认行为**：框架可以为 `FindAgent` 等方法提供标准实现

### LlmAgent 的 Config

`llmagent.Config`（`agent/llmagent/llmagent.go:130-283`）包含更丰富的字段：

```go
type Config struct {
    Name        string
    Description string
    SubAgents   []agent.Agent

    Model                   model.LLM
    Instruction             string
    InstructionProvider     InstructionProvider
    GenerateContentConfig   *genai.GenerateContentConfig
    BeforeModelCallbacks    []BeforeModelCallback
    AfterModelCallbacks     []AfterModelCallback
    BeforeToolCallbacks     []BeforeToolCallback
    AfterToolCallbacks      []AfterToolCallback
    Tools                   []tool.Tool
    Toolsets                []tool.Toolset
    OutputKey               string
    OutputSchema            *genai.Schema
    DisallowTransferToParent bool
    DisallowTransferToPeers  bool
    IncludeContents          IncludeContents
    // ...更多字段
}
```

LlmAgent 内部调用 `agent.New()` 创建基础 Agent，再组合自己的 LLM 逻辑（`agent/llmagent/llmagent.go:96`）：

```go
baseAgent, err := agent.New(agent.Config{
    Name:                 cfg.Name,
    Description:          cfg.Description,
    SubAgents:            cfg.SubAgents,
    BeforeAgentCallbacks: cfg.BeforeAgentCallbacks,
    Run:                  a.run, // LLM 特有的 run 逻辑
    AfterAgentCallbacks:  cfg.AfterAgentCallbacks,
})
```

---

## 4. 接口组合：InvocationContext 的层次体系

adk-go 用接口嵌入构建了上下文层次（`agent/context.go:60-128`）：

```
context.Context（Go 标准库）
    └── InvocationContext（完整调用上下文）
            ├── Agent()        → Agent
            ├── Session()      → session.Session
            ├── Artifacts()    → Artifacts
            ├── Memory()       → Memory
            ├── EndInvocation()
            └── ...

context.Context（Go 标准库）
    └── ReadonlyContext（只读上下文）
            ├── UserContent()      → *genai.Content
            ├── InvocationID()     → string
            ├── AgentName()        → string
            ├── ReadonlyState()    → session.ReadonlyState
            ├── UserID()           → string
            └── ...

ReadonlyContext
    └── CallbackContext（回调上下文，可写状态）
            ├── Artifacts()  → Artifacts
            └── State()      → session.State
```

### InvocationContext

```go
type InvocationContext interface {
    context.Context  // 嵌入 Go 标准接口

    Agent() Agent
    Artifacts() Artifacts
    Memory() Memory
    Session() session.Session
    InvocationID() string
    Branch() string
    UserContent() *genai.Content
    RunConfig() *RunConfig
    EndInvocation()
    Ended() bool
    WithContext(ctx context.Context) InvocationContext
}
```

关键设计：**InvocationContext 嵌入了 `context.Context`**。这意味着 `InvocationContext` 本身就是 `context.Context`，可以直接传给任何接受 `context.Context` 的函数。这是 Go 中常见的接口组合模式——小接口嵌入大接口，获得方法的"并集"。

### ReadonlyContext 与 CallbackContext

```go
type ReadonlyContext interface {
    context.Context
    UserContent() *genai.Content
    InvocationID() string
    AgentName() string
    ReadonlyState() session.ReadonlyState
    UserID() string
    AppName() string
    SessionID() string
    Branch() string
}

type CallbackContext interface {
    ReadonlyContext  // 嵌入只读接口
    Artifacts() Artifacts
    State() session.State  // 可写状态
}
```

`CallbackContext` 嵌入了 `ReadonlyContext`，并增加了 `State()` 方法（可写）。这是**接口的渐进式授权**：回调函数拿到的是受限上下文，不能调用 `EndInvocation()` 等危险操作。

---

## 5. Type Embedding vs Interface Embedding

Go 中有两种"嵌入"：类型嵌入和接口嵌入。adk-go 两者都用。

### 接口嵌入

```go
type CallbackContext interface {
    ReadonlyContext  // 接口嵌入：继承所有方法签名
    Artifacts() Artifacts
    State() session.State
}
```

接口嵌入是**方法签名的继承**。`CallbackContext` 拥有 `ReadonlyContext` 的所有方法加上自己的两个方法。这是编译时的契约，不涉及具体实现。

### 类型嵌入

```go
type llmAgent struct {
    agent.Agent           // 类型嵌入：继承 Agent 接口的方法实现
    llminternal.State     // 类型嵌入：继承 State 的字段和方法
    agentState            // 类型别名嵌入
}
```

类型嵌入是**实现的继承**。`llmAgent` 嵌入了 `agent.Agent`（一个接口值），自动获得 `Name()`、`Description()`、`SubAgents()` 等方法的委托实现。同时 `llmAgent` 还可以**覆盖**特定方法，如 `FindAgent()`（`agent/llmagent/llmagent.go:477`）：

```go
func (a *llmAgent) FindAgent(name string) agent.Agent {
    if a.Name() == name {
        return a
    }
    return a.Agent.FindSubAgent(name) // 委托给嵌入的 Agent
}
```

### 两者的区别

| | 接口嵌入 | 类型嵌入 |
|---|---------|---------|
| 嵌入什么 | 方法签名 | 具体实现 |
| 何时生效 | 编译时 | 运行时 |
| 能否覆盖 | N/A（无实现） | 可以 |
| 多态 | 通过接口 | 通过嵌入值 |

---

## 6. Session → State → ReadonlyState 的接口层次

adk-go 在 session 包中也构建了清晰的接口层次（`session/session.go:32-74`）：

```go
type Session interface {
    ID() string
    AppName() string
    UserID() string
    State() State
    Events() Events
    LastUpdateTime() time.Time
}

type State interface {
    Get(string) (any, error)
    Set(string, any) error
    All() iter.Seq2[string, any]
}

type ReadonlyState interface {
    Get(string) (any, error)
    All() iter.Seq2[string, any]
}
```

`ReadonlyState` 是 `State` 的只读子集——只有 `Get` 和 `All`，没有 `Set`。在 `ReadonlyContext` 中暴露 `ReadonlyState`，在 `CallbackContext` 中暴露完整 `State`，确保最小权限原则。

### Events 接口

```go
type Events interface {
    All() iter.Seq[*Event]
    Len() int
    At(i int) *Event
}
```

`Events` 接口同时支持迭代器遍历（`All()`）和索引访问（`At(i)`），满足不同场景的需求。

---

## 7. Agent 体系中的接口层次

adk-go 的 Agent 类型形成如下层次：

```
Agent（接口）
├── *agent（基础实现，agent/agent.go:139）
├── *llmAgent（LLM Agent，agent/llmagent/llmagent.go:340）
│   └── 嵌入 agent.Agent + llminternal.State
├── *seqAgent（顺序 Agent，agent/workflowagents/sequentialagent/agent.go:35）
│   └── 嵌入 agent.Agent + agentinternal.State
├── ParallelAgent（并行 Agent，通过 agent.New() 创建）
└── LoopAgent（循环 Agent，通过 agent.New() 创建）
```

所有具体类型都通过 `agent.New()` 获得 `Agent` 接口实现，再通过类型嵌入和组合添加各自特有逻辑。`agentinternal.State` 存储了 Agent 类型和配置信息，用于运行时类型判断。

---

## 8. 常见陷阱

### 陷阱 1：nil 接口值 vs nil 具体类型

```go
var a agent.Agent  // nil 接口值
fmt.Println(a == nil) // true

var s *agent  // nil 具体类型指针
var a2 agent.Agent = s // 接口值不为 nil！
fmt.Println(a2 == nil) // false！
```

Go 接口值内部包含 (type, value) 对。只有两者都为 nil 时，接口才等于 nil。在 adk-go 中，如果函数返回 `Agent` 接口，内部返回了 nil 指针，调用方用 `== nil` 判断会出错。正确做法是显式返回 nil：

```go
func findAgent(name string) agent.Agent {
    // 错误：返回 nil *agent，不是 nil Agent
    // return result.(*agent)

    // 正确：如果结果为 nil，返回 nil 接口
    if result == nil {
        return nil
    }
    return result
}
```

### 陷阱 2：方法集与指针接收者

```go
type myAgent struct {
    agent.Agent // 嵌入接口值
}

// 指针接收者方法
func (a *myAgent) CustomMethod() string { ... }

var a agent.Agent = &myAgent{}  // OK
var a2 agent.Agent = myAgent{}  // 编译错误！CustomMethod 不在值类型的方法集中
```

当结构体有指针接收者方法时，只有指向该结构体的指针才实现接口。值类型不包含指针接收者的方法。在 adk-go 中，所有构造函数都返回指针（`*agent`、`*llmAgent`），避免此问题。

### 陷阱 3：接口嵌入不等于类型嵌入

```go
type CallbackContext interface {
    ReadonlyContext  // 这是接口嵌入，只继承方法签名
}
```

如果你以为嵌入 `ReadonlyContext` 就自动获得了实现，那是误解。接口嵌入只是声明"我拥有这些方法"，实现仍需自己提供。adk-go 中 `callbackContext`（`agent/agent.go:370`）通过类型嵌入 `invocationContext` 来复用实现：

```go
type callbackContext struct {
    context.Context           // 类型嵌入
    invocationContext InvocationContext // 类型嵌入
    actions           *session.EventActions
}
```

### 陷阱 4：类型断言与运行时检查

adk-go 中大量使用类型断言来检查 Agent 的具体类型：

```go
internalAgent, ok := baseAgent.(agentinternal.Agent)
if !ok {
    return nil, fmt.Errorf("internal error: failed to convert to internal agent")
}
```

如果 `Agent` 的底层实现不是 `agentinternal.Agent`，断言会失败。这依赖于所有 Agent 都通过 `agent.New()` 创建的约定。如果用户绕过构造函数直接实现 `Agent` 接口（虽然 `internal()` 使这几乎不可能），类型断言就会出问题。

---

## 9. 练习

1. **基础**：定义一个 `ReadonlyAgent` 接口，只包含 `Name()` 和 `Description()` 方法。让 `Agent` 嵌入它，添加 `Run()` 等方法。

2. **进阶**：阅读 `agent/agent.go:150-235` 中 `*agent` 的方法实现，解释 `FindAgent` 和 `FindSubAgent` 的递归查找逻辑。如果一个 Agent 树有三层，查找过程是怎样的？

3. **挑战**：参考 `CallbackContext` 的设计，为 adk-go 设计一个 `ToolContext` 接口层次，包含只读的 `ReadonlyToolContext` 和可写的 `ToolContext`，并说明哪些方法应该放在哪个层次。

4. **实战**：追踪 `Runner.Run()` 中 `InvocationContext` 的创建和传递路径（`runner/runner.go:198`），列出 `InvocationContext` 在整个调用链中经历了哪些类型转换和接口变化。
