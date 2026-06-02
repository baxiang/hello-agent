# 函数选项模式 — ADK-Go 配置的统一范式

## 1. 什么是 Functional Options 模式

Functional Options（函数选项）是 Go 中构造可配置对象的惯用模式。核心思想：

```go
type Option func(*Options)

func WithX(x int) Option {
    return func(o *Options) {
        o.x = x
    }
}

func New(opts ...Option) *Thing {
    o := &Options{x: defaultX}
    for _, opt := range opts {
        opt(o)
    }
    return &Thing{options: o}
}
```

调用方式：
```go
t := New(WithX(42), WithY("hello"))
```

相比构造函数参数或 Config 结构体，Option 的优势：
- **可扩展**：新增选项不影响已有调用方
- **自文档化**：`WithX(42)` 比 `New(42, "", 0, true)` 清晰
- **零值可用**：`New()` 即可使用默认值
- **条件组合**：可以在运行时动态选择选项

---

## 2. adk-go 中的三种配置风格

adk-go 并非纯粹使用 Option 模式，而是三种风格并存：

### 风格一：Config 结构体（主流）

`agent.Config`、`llmagent.Config`、`runner.Config` 都用结构体：

```go
// agent/agent.go:77
type Config struct {
    Name        string
    Description string
    SubAgents   []Agent
    Run         func(InvocationContext) iter.Seq2[*session.Event, error]
    BeforeAgentCallbacks []BeforeAgentCallback
    AfterAgentCallbacks  []AfterAgentCallback
}

// 使用
myAgent, _ := agent.New(agent.Config{
    Name:        "greeter",
    Description: "打招呼",
})
```

### 风格二：Option 函数（轻量配置）

`runner.RunOption`、`model/apigee.Option`、`retryandreflect.PluginOption` 用 Option：

```go
// runner/runner.go:65-76
type RunOption func(*runOptions)

type runOptions struct {
    stateDelta map[string]any
}

func WithStateDelta(delta map[string]any) RunOption {
    return func(o *runOptions) {
        o.stateDelta = delta
    }
}

// 使用
r.Run(ctx, userID, sessionID, msg, cfg, runner.WithStateDelta(delta))
```

### 风格三：Config + Option 混合

`model/apigee` 包同时使用 Config 和 Option（`model/apigee/apigee.go:50-90`）：

```go
type Config struct {
    ModelName     string
    ProxyURL      string
    CustomHeaders http.Header
    HTTPClient    *http.Client
}

type Option func(*Config)

func WithProxyURL(proxyURL string) Option {
    return func(c *Config) {
        c.ProxyURL = proxyURL
    }
}

func WithCustomHeaders(headers http.Header) Option {
    return func(c *Config) {
        c.CustomHeaders = headers
    }
}

func WithHTTPClient(client *http.Client) Option {
    return func(c *Config) {
        c.HTTPClient = client
    }
}

func NewModel(ctx context.Context, modelName string, opts ...Option) (*apigeeModel, error) {
    cfg := &Config{
        ModelName: modelName, // 必需参数放 Config
    }
    for _, opt := range opts {
        opt(cfg) // 可选参数用 Option 覆盖
    }
    // ...
}
```

---

## 3. 深入分析：Runner 的 RunOption

`Runner.Run()` 的签名（`runner/runner.go:131`）：

```go
func (r *Runner) Run(
    ctx context.Context,
    userID, sessionID string,
    msg *genai.Content,
    cfg agent.RunConfig,
    opts ...RunOption,
) iter.Seq2[*session.Event, error]
```

这里 `cfg` 是必需的运行时配置（streaming mode 等），`opts` 是可选的运行时参数。在方法内部（`runner/runner.go:136-138`）：

```go
options := runOptions{}
for _, opt := range opts {
    opt(&options)
}
```

`runOptions` 是包内私有类型，只有 `stateDelta` 一个字段。这种设计将"配置"和"选项"分离：
- **Config（RunConfig）**：每次调用必须提供，影响核心行为
- **Option（RunOption）**：可选，影响辅助行为

当前 `RunOption` 只有一个 `WithStateDelta`，但未来可以轻松扩展，比如：

```go
func WithTimeout(d time.Duration) RunOption {
    return func(o *runOptions) {
        o.timeout = d
    }
}
```

新增 Option 不需要修改 `Run()` 签名，也不影响已有调用方。

---

## 4. 深入分析：Telemetry 的接口式 Option

telemetry 包使用了更复杂的 Option 变体——**接口式 Option**（`telemetry/config.go:61-69`）：

```go
type Option interface {
    apply(*config) error
}

type optionFunc func(*config) error

func (fn optionFunc) apply(cfg *config) error {
    return fn(cfg)
}
```

与函数式 Option 的区别：`apply` 方法可以**返回 error**。这使得 Option 可以做校验：

```go
func WithGcpResourceProject(project string) Option {
    return optionFunc(func(cfg *config) error {
        if project == "" {
            return fmt.Errorf("project must not be empty")
        }
        cfg.gcpResourceProject = project
        return nil
    })
}
```

telemetry 的 `configure` 函数（`telemetry/setup_otel.go:34`）会收集所有 Option 的错误：

```go
func configure(ctx context.Context, opts ...Option) (*config, error) {
    cfg := &config{...}
    for _, opt := range opts {
        if err := opt.apply(cfg); err != nil {
            return nil, err
        }
    }
    // ...
}
```

这种模式比 `func(*config)` 更安全，因为 Option 可以拒绝非法输入，而不是默默地设置无效值。

### 三种 Option 签名对比

| 风格 | 签名 | 错误处理 | 适用场景 |
|------|------|---------|---------|
| 函数式 | `func(*Options)` | 无 | 简单配置，无需校验 |
| 接口式 | `interface { apply(*Options) error }` | 有 | 需要校验的配置 |
| 直接修改 | `*Config` 结构体字面量 | 构造函数校验 | 必需参数多时 |

---

## 5. 深入分析：RetryAndReflect Plugin 的 Option

`plugin/retryandreflect/plugin.go:68-116` 展示了 Option 的经典用法——带默认值：

```go
type PluginOption func(*retryAndReflect)

func WithMaxRetries(maxRetries int) PluginOption {
    return func(r *retryAndReflect) {
        r.maxRetries = maxRetries
    }
}

func WithErrorIfRetryExceeded(errorIfRetryExceeded bool) PluginOption {
    return func(r *retryAndReflect) {
        r.errorIfRetryExceeded = errorIfRetryExceeded
    }
}

func WithTrackingScope(scope TrackingScope) PluginOption {
    return func(r *retryAndReflect) {
        r.scope = scope
    }
}

func New(opts ...PluginOption) (*plugin.Plugin, error) {
    r := &retryAndReflect{
        maxRetries:            3,      // 默认值
        errorIfRetryExceeded:  false,  // 默认值
        scope:                 Invocation, // 默认值
        scopedFailureCounters: make(map[string]map[string]int),
    }

    for _, opt := range opts {
        opt(r) // Option 覆盖默认值
    }

    if r.maxRetries < 0 {
        return nil, fmt.Errorf("maxRetries must be a non-negative integer")
    }
    // ...
}
```

关键设计：
1. **零值可用**：`New()` 即可获得带默认值的 Plugin
2. **校验后置**：Option 先覆盖默认值，构造函数再统一校验
3. **Option 操作私有类型**：`PluginOption` 修改 `*retryAndReflect`（私有），返回公开的 `*plugin.Plugin`

这种"Option 修改内部状态，构造函数返回公开接口"的模式在 adk-go 中很常见。

---

## 6. Config 结构体 vs Option：adk-go 的选择逻辑

为什么 adk-go 有时用 Config，有时用 Option？

### 用 Config 的场景

1. **字段多且有依赖关系**：`llmagent.Config` 有 20+ 个字段，字段间有逻辑关系（如 `OutputSchema` 设置后不能用 tool）
2. **创建时一次性提供**：Agent 只创建一次，Config 在创建时填写
3. **需要文档化**：Config 结构体的字段注释就是文档

### 用 Option 的场景

1. **可选参数少**：`RunOption` 只有 `stateDelta`
2. **调用频繁**：`Runner.Run()` 可能被多次调用，每次参数不同
3. **向前兼容**：未来可能新增选项，Option 不破坏签名

### 混合使用的场景

`model/apigee.NewModel()` 的设计：
- `modelName` 是必需参数，直接作为函数参数
- `ProxyURL`、`CustomHeaders`、`HTTPClient` 是可选参数，用 Option

```go
m, err := apigee.NewModel(ctx, "my-model-name",
    apigee.WithProxyURL("http://proxy.example.com"),
    apigee.WithCustomHeaders(headers),
)
```

---

## 7. 零值可用：合理的默认值设计

adk-go 的 Option 和 Config 都遵循"零值可用"原则：

| 组件 | 默认值 | 来源 |
|------|--------|------|
| `RunOption` | 空 `runOptions{}` | runner/runner.go:67 |
| `retryAndReflect` | maxRetries=3, scope=Invocation | plugin/retryandreflect/plugin.go:96-101 |
| `apigee.Config` | 仅 ModelName 必填 | model/apigee/apigee.go:85-87 |
| `session.InMemoryService()` | 无需参数 | session/service.go:35 |

`session.InMemoryService()` 是零值可用的极致体现（`session/service.go:35-40`）：

```go
func InMemoryService() Service {
    return &inMemoryService{
        appState:  make(map[string]stateMap),
        userState: make(map[string]map[string]stateMap),
    }
}
```

不需要任何参数，直接返回可用的 Service 实例。生产环境可以替换为 `database.NewSessionService()` 或 `vertexai.NewSessionService()`。

---

## 8. 与其他框架的对比

### eino（字节跳动 Go AI 框架）

eino 采用纯 Option 模式，几乎所有组件都通过 `WithXxx()` 配置：

```go
// eino 风格
chatModel, _ := openai.NewChatModel(ctx, openai.WithModel("gpt-4"), openai.WithTemperature(0.7))
```

### adk-go 的混合风格

```go
// adk-go 风格：Config + Option
myAgent, _ := llmagent.New(llmagent.Config{
    Name:        "assistant",
    Model:       deepseekModel,
    Instruction: "你是一个助手",
})

runner, _ := runner.New(runner.Config{
    Agent:          myAgent,
    SessionService: session.InMemoryService(),
})

// 运行时用 Option
for event, err := range runner.Run(ctx, userID, sessionID, msg, agent.RunConfig{},
    runner.WithStateDelta(map[string]any{"key": "value"}),
) { ... }
```

adk-go 选择混合风格的原因：
1. **Agent 配置字段多**：20+ 字段用 Option 太冗长
2. **创建是一次性的**：Agent 只建一次，Config 更直观
3. **运行时参数少**：`Run()` 的可选参数少，Option 更灵活

---

## 9. 常见陷阱

### 陷阱 1：Option 修改了共享状态

```go
// 危险：Option 闭包捕获了外部变量
delta := map[string]any{"key": "value"}
opt := runner.WithStateDelta(delta)

delta["another"] = "modified" // 修改了 delta，Option 的行为也变了！
r.Run(ctx, uid, sid, msg, cfg, opt)
```

Option 闭包捕获的是引用，外部修改变量会影响 Option 行为。正确做法是在 Option 函数内部拷贝数据，或确保传入后不再修改。

### 陷阱 2：Option 顺序依赖

```go
// 危险：两个 Option 修改同一字段，后执行的覆盖先执行的
r := retryandreflect.New(
    retryandreflect.WithMaxRetries(5),
    retryandreflect.WithMaxRetries(3), // 覆盖了上面的 5
)
```

虽然这有时是故意的（后覆盖前），但如果不小心会导致难以调试的问题。

### 陷阱 3：Config 的零值陷阱

```go
// Config 的零值可能导致意外行为
cfg := llmagent.Config{
    Name: "agent",
    // Description 为空字符串，LLM 可能无法正确委派任务
    // Model 为 nil，运行时会 panic
}
```

Config 结构体的零值可能不合法。adk-go 的构造函数会校验关键字段（如 `agent.New` 校验 SubAgent 去重），但并非所有非法配置都能被捕获。建议使用时显式设置所有必要字段。

### 陷阱 4：混淆 Config 和 Option 的边界

```go
// 反模式：把本应是 Config 的字段放到了 Option
type BadOption func(*badOptions)

type badOptions struct {
    name string  // 应该是 Config！名字是必需的
    stateDelta map[string]any
}

func WithName(name string) BadOption {
    return func(o *badOptions) {
        o.name = name
    }
}
```

**规则**：必需参数放 Config/函数参数，可选参数放 Option。如果调用 `New()` 不传某个 Option 会导致功能不正常，那个参数就不应该用 Option。

---

## 10. 练习

1. **基础**：为 `runner.RunOption` 添加一个新的 `WithTimeout(d time.Duration)` 选项，使 Runner 在超时后停止迭代。

2. **进阶**：将 `agent.Config` 中的 `BeforeAgentCallbacks` 和 `AfterAgentCallbacks` 改为 Option 风格，设计 `WithBeforeAgentCallback(cb BeforeAgentCallback) AgentOption`，并保持向后兼容。

3. **挑战**：参考 telemetry 包的接口式 Option，为 `retryandreflect.PluginOption` 添加错误返回能力。要求：`WithMaxRetries(-1)` 应该在 `New()` 时返回错误，而不是静默设置负值。

4. **实战**：阅读 `model/apigee/apigee.go:84-90` 中 `NewModel` 的 Option 应用逻辑。如果同时传入 `WithProxyURL("A")` 和 `WithProxyURL("B")`，最终 ProxyURL 是什么？这种行为是否合理？如何改进？
