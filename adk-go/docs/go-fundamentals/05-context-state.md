# Context 与 State — ADK-Go 的会话状态管理

## 1. context.Context 基础

Go 的 `context.Context` 是传递截止时间、取消信号和请求级值的标准机制。在 adk-go 中，context.Context 被大量使用，但**并非直接传递业务状态**——框架在 context 之上构建了专门的上下文层。

context.Context 的三个核心能力：

```go
type Context interface {
    Deadline() (deadline time.Time, ok bool)  // 截止时间
    Done() <-chan struct{}                     // 取消信号
    Err() error                                // 取消原因
    Value(key any) any                         // 请求级值
}
```

adk-go 主要利用 `Value` 能力在 context 中存储内部对象（如 PluginManager、RunConfig），而业务状态则由专门的 `session.State` 管理。

## 2. adk-go 中的 Context 使用

### 2.1 InvocationContext — 通过 context 传播的调用上下文

`agent.InvocationContext`（agent/context.go:60-103）是 adk-go 最核心的上下文接口。它**嵌入了 context.Context**，同时携带了 agent 运行所需的全部信息：

```go
type InvocationContext interface {
    context.Context  // 嵌入标准 context

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

内部实现（internal/context/invocation_context.go:52-56）将 context.Context 作为嵌入字段：

```go
type InvocationContext struct {
    context.Context      // 嵌入标准 context
    params InvocationContextParams
}
```

这意味着 InvocationContext **既是** context.Context，又提供了 agent 专属方法。任何接受 `context.Context` 的标准 Go 函数都能接受 InvocationContext。

### 2.2 InvocationContext 的创建

在 Runner.Run() 中（runner/runner.go:198-205），通过 `icontext.NewInvocationContext` 创建 InvocationContext，将各种依赖注入：

```go
ctx := icontext.NewInvocationContext(ctx, icontext.InvocationContextParams{
    Artifacts:   artifacts,
    Memory:      memoryImpl,
    Session:     storedSession,
    Agent:       agentToRun,
    UserContent: msg,
    RunConfig:   &cfg,
})
```

创建前，Runner 先通过 `context.WithValue` 注入内部对象（runner/runner.go:172-176）：

```go
ctx = parentmap.ToContext(ctx, r.parents)        // 注入 agent 父子关系
ctx = runconfig.ToContext(ctx, &runconfig.RunConfig{  // 注入运行配置
    StreamingMode: runconfig.StreamingMode(cfg.StreamingMode),
})
ctx = plugininternal.ToContext(ctx, r.pluginManager)  // 注入插件管理器
```

这些注入的值随后通过 `ctx.Value()` 在内部包中提取使用（如 agent/agent.go:507-513）：

```go
func pluginManagerFromContext(ctx context.Context) pluginManager {
    a := ctx.Value(plugincontext.PluginManagerCtxKey)
    m, ok := a.(pluginManager)
    if !ok {
        return nil
    }
    return m
}
```

### 2.3 Callback 上下文传播

当回调函数被调用时，框架提供 `CallbackContext`（agent/context.go:122-128），这是一个受限制的上下文：

```go
type CallbackContext interface {
    ReadonlyContext       // 只读上下文（包含 ReadonlyState）
    Artifacts() Artifacts
    State() session.State  // 可写状态
}
```

CallbackContext 的 State 实现很有意思。在 internal/context/callback_context.go:103-125，它采用**双层写入**策略：

```go
type callbackContextState struct {
    ctx *callbackContext
}

func (c *callbackContextState) Get(key string) (any, error) {
    // 先查 StateDelta（本次回调的修改）
    if c.ctx.eventActions != nil && c.ctx.eventActions.StateDelta != nil {
        if val, ok := c.ctx.eventActions.StateDelta[key]; ok {
            return val, nil
        }
    }
    // 再查 Session State（持久化状态）
    return c.ctx.invocationCtx.Session().State().Get(key)
}

func (c *callbackContextState) Set(key string, val any) error {
    // 同时写入 StateDelta 和 Session State
    if c.ctx.eventActions != nil && c.ctx.eventActions.StateDelta != nil {
        c.ctx.eventActions.StateDelta[key] = val  // 记录增量
    }
    return c.ctx.invocationCtx.Session().State().Set(key, val)  // 持久化
}
```

这种设计确保回调中的状态修改既立即生效，又被记录在 Event 的 StateDelta 中，方便后续审计和持久化。

### 2.4 Plugin 上下文传播

Plugin 系统通过 `PluginManager` 在 context 中传播（runner/runner.go:176）：

```go
ctx = plugininternal.ToContext(ctx, r.pluginManager)
```

PluginManager 的各个回调方法都接受 `agent.InvocationContext`（plugin/plugin.go:161-167）：

```go
type OnUserMessageCallback func(agent.InvocationContext, *genai.Content) (*genai.Content, error)
type BeforeRunCallback func(agent.InvocationContext) (*genai.Content, error)
type AfterRunCallback func(agent.InvocationContext)
type OnEventCallback func(agent.InvocationContext, *session.Event) (*session.Event, error)
```

Plugin 可以通过 InvocationContext 访问 Session、State 等一切运行时信息。

## 3. session.State：map[string]any 的键值存储

`session.State`（session/session.go:51-62）是一个简单的键值存储接口：

```go
type State interface {
    Get(string) (any, error)          // 获取值，键不存在返回 ErrStateKeyNotExist
    Set(string, any) error            // 设置值
    All() iter.Seq2[string, any]      // 遍历所有键值对
}
```

内部实现（session/inmemory.go:388-426）使用 `map[string]any`，通过读写锁保证线程安全：

```go
type state struct {
    mu    *sync.RWMutex
    state map[string]any
}

func (s *state) Get(key string) (any, error) {
    s.mu.RLock()
    defer s.mu.RUnlock()
    val, ok := s.state[key]
    if !ok {
        return nil, ErrStateKeyNotExist
    }
    return val, nil
}

func (s *state) Set(key string, value any) error {
    s.mu.Lock()
    defer s.mu.Unlock()
    s.state[key] = value
    return nil
}
```

### 3.1 作用域前缀：app: / user: / temp:

adk-go 通过键前缀实现三级作用域（session/session.go:162-176）：

```go
const (
    KeyPrefixApp  string = "app:"   // 应用级：所有用户、所有会话共享
    KeyPrefixTemp string = "temp:"  // 临时级：仅当前 invocation 有效，结束后丢弃
    KeyPrefixUser string = "user:"  // 用户级：同一用户所有会话共享
)
```

**没有前缀的键属于会话级**，仅在当前会话内有效。

在 `internal/sessionutils/utils.go:31-54`，`ExtractStateDeltas` 函数根据前缀将状态变更分发到不同存储层：

```go
func ExtractStateDeltas(delta map[string]any) (
    appStateDelta, userStateDelta, sessionStateDelta map[string]any,
) {
    for key, value := range delta {
        if cleanKey, found := strings.CutPrefix(key, appPrefix); found {
            appStateDelta[cleanKey] = value
        } else if cleanKey, found := strings.CutPrefix(key, userPrefix); found {
            userStateDelta[cleanKey] = value
        } else if !strings.HasPrefix(key, tempPrefix) {
            sessionStateDelta[key] = value
        }
    }
    return
}
```

InMemoryService 的 `AppendEvent`（session/inmemory.go:247-252）在追加事件时调用此函数：

```go
if len(event.Actions.StateDelta) > 0 {
    appDelta, userDelta, sessionDelta := sessionutils.ExtractStateDeltas(event.Actions.StateDelta)
    s.updateAppState(appDelta, curSession.AppName())
    s.updateUserState(userDelta, curSession.AppName(), curSession.UserID())
    maps.Copy(stored_session.state, sessionDelta)
}
```

## 4. ReadonlyState vs State：读写分离

adk-go 将状态接口分为只读和读写两个层次：

**ReadonlyState**（session/session.go:67-74）：
```go
type ReadonlyState interface {
    Get(string) (any, error)
    All() iter.Seq2[string, any]
}
```

**State**（session/session.go:51-62）：
```go
type State interface {
    Get(string) (any, error)
    Set(string, any) error
    All() iter.Seq2[string, any]
}
```

`ReadonlyState` 没有 `Set` 方法。这种分离体现在上下文层次中：

- **ReadonlyContext** 只能访问 `ReadonlyState()`（agent/context.go:113）
- **CallbackContext** 可以访问 `State()`（agent/context.go:127）

这确保了在只读上下文（如 InstructionProvider）中无法修改状态，强制了最小权限原则。

## 5. StateDelta：Event 中的状态变更增量

`EventActions.StateDelta`（session/session.go:143-145）记录了与某个 Event 关联的状态变更：

```go
type EventActions struct {
    StateDelta    map[string]any     // 状态增量
    ArtifactDelta map[string]int64   // Artifact 版本增量
    // ...
}
```

StateDelta 的工作机制：

1. **写入时**：CallbackContext 的 State.Set() 同时写入 StateDelta 和 Session State
2. **持久化时**：SessionService.AppendEvent() 根据 StateDelta 更新各层状态
3. **临时键清理**：AppendEvent 调用 `trimTempDeltaState`（session/inmemory.go:429-446）移除 `temp:` 前缀的键

```go
func trimTempDeltaState(event *Event) *Event {
    filteredStateDelta := make(map[string]any)
    for key, value := range event.Actions.StateDelta {
        if !strings.HasPrefix(key, KeyPrefixTemp) {
            filteredStateDelta[key] = value
        }
    }
    event.Actions.StateDelta = filteredStateDelta
    return event
}
```

临时状态在 invocation 结束后被丢弃，不会持久化到 Session 事件历史中。

## 6. Plugin 如何修改 State

Plugin 通过 `OnEventCallback` 修改状态。回调签名（plugin/plugin.go:167）：

```go
type OnEventCallback func(agent.InvocationContext, *session.Event) (*session.Event, error)
```

Plugin 可以返回一个修改过的 Event，其中的 `Actions.StateDelta` 会被 SessionService 处理。但更常见的模式是通过 `CallbackContext`：

1. Plugin 配置中注册 `AfterToolCallback`
2. 回调接收 `tool.Context`（内部可访问 `CallbackContext`）
3. 通过 `CallbackContext.State().Set()` 修改状态
4. 修改被记录到 Event 的 StateDelta

## 7. 常见陷阱

### 7.1 State 键冲突

由于 State 是一个扁平的 `map[string]any`，不同 agent 或工具可能使用相同的键名，导致意外覆盖。**最佳实践**：使用有命名空间的键，如 `weather_agent:last_city`，而非笼统的 `last_city`。

### 7.2 未使用前缀导致跨会话泄漏

如果你希望状态仅在当前会话有效，**不要**使用 `app:` 或 `user:` 前缀。不带前缀的键默认就是会话级的。反之，如果你确实需要跨会话共享状态，必须显式使用前缀：

```go
// 会话级状态（默认）
state.Set("current_task", "分析数据")

// 用户级状态（跨会话）
state.Set("user:preference", "中文")

// 应用级状态（跨用户、跨会话）
state.Set("app:version", "2.0")

// 临时状态（仅本次 invocation）
state.Set("temp:intermediate_result", partialResult)
```

### 7.3 InvocationContext.WithContext 的临时性

agent/context.go:100-102 的注释明确指出：

```go
// WithContext returns a new instance of the context with overridden embedded context.
// NOTE: This is a temporary solution and will be removed later.
WithContext(ctx context.Context) InvocationContext
```

这个方法用于替换嵌入的 context.Context（比如添加 OpenTelemetry span），但它返回的是浅拷贝，修改新实例的 params 字段不会影响原始实例。

### 7.4 State.Get 返回 error 而非零值

与普通 map 的 `v, ok := m[key]` 模式不同，`State.Get()` 在键不存在时返回 `ErrStateKeyNotExist` 错误。这是为了与 Session 接口的错误语义保持一致，但也意味着每次 Get 都必须检查 error：

```go
// 错误：忽略 error
val := state.Get("key")  // val 类型是 any，不是你期望的值！

// 正确：处理 error
val, err := state.Get("key")
if err != nil {
    if errors.Is(err, session.ErrStateKeyNotExist) {
        // 键不存在，使用默认值
    }
    return err
}
```

### 7.5 All() 返回的是快照

`state.All()`（session/inmemory.go:405-418）在获取迭代器时会先克隆一次状态，然后释放读锁。这意味着迭代过程中看到的是快照，不会反映并发修改：

```go
func (s *state) All() iter.Seq2[string, any] {
    s.mu.RLock()
    stateCopy := maps.Clone(s.state)
    s.mu.RUnlock()
    return func(yield func(key string, val any) bool) {
        for k, v := range stateCopy {
            if !yield(k, v) {
                return
            }
        }
    }
}
```
