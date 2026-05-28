# Context 传播机制 — Eino 状态与控制信号的生命线

## 1. Context 基础

Go 的 `context.Context` 是一个接口，提供四种核心能力：

```go
type Context interface {
    Deadline() (deadline time.Time, ok bool) // 返回超时截止时间
    Done() <-chan struct{}                   // 返回取消信号通道
    Err() error                              // 返回取消原因（Canceled 或 DeadlineExceeded）
    Value(key any) any                       // 返回携带的键值对
}
```

- **Done()**：当 context 被取消或超时，该 channel 会被关闭，所有监听它的 goroutine 都能收到信号。
- **Err()**：在 Done() 关闭后返回具体错误，`context.Canceled` 或 `context.DeadlineExceeded`。
- **Deadline()**：返回超时截止时间和是否设置了超时。
- **Value()**：沿 context 链向上查找指定 key 的值，用于请求级别的元数据传递。

这四种能力在 Eino 中各有重要用途：Value 携带状态与回调，Done/Err 控制流式处理的中断，Deadline 限制执行时间。

## 2. context.WithValue — 携带状态

`context.WithValue` 基于现有 context 创建一个携带新键值对的子 context，子 context 可以通过 `ctx.Value(key)` 查找值，查找方向是自底向上沿父链搜索。

### 2.1 State 传播

Eino 的 Graph 编排允许节点间共享状态，状态通过 `context.WithValue` 注入到 ctx 中，所有节点通过同一个 ctx 访问状态。

**定义 key 类型**（compose/state.go:32）：

```go
type stateKey struct{}
```

使用空结构体作为 key 类型，避免与其它包的 key 冲突（不同类型的零值不会相等）。

**状态的内部结构**（compose/state.go:34-38）：

```go
type internalState struct {
    state  any
    mu     sync.Mutex
    parent *internalState // 支持嵌套图的状态链
}
```

`internalState` 构成链表结构，`parent` 指向外层图的状态，支持嵌套图中内层访问外层状态。

**注入状态**：Graph 编译时通过 `WithGenLocalState` 指定状态生成函数，运行时框架调用 `context.WithValue(ctx, stateKey{}, &internalState{...})` 注入。

**获取状态**（compose/state.go:175-196）：

```go
func getState[S any](ctx context.Context) (S, *sync.Mutex, error) {
    state := ctx.Value(stateKey{}) // 从 ctx 中取出 internalState

    if state == nil {
        var s S
        return s, nil, fmt.Errorf("have not set state")
    }

    interState := state.(*internalState)

    for interState != nil {
        if cState, ok := interState.state.(S); ok { // 按类型匹配
            return cState, &interState.mu, nil       // 同时返回互斥锁
        }
        interState = interState.parent // 向父级查找
    }

    var s S
    return s, nil, fmt.Errorf("cannot find state with type: %v in states chain, "+
        "current state type: %v",
        generic.TypeOf[S](), reflect.TypeOf(state.(*internalState).state))
}
```

`getState` 的设计要点：
- **泛型匹配**：通过 `interState.state.(S)` 做类型断言，支持嵌套图中不同层级使用不同类型的状态。
- **返回互斥锁**：同时返回 `*sync.Mutex`，确保并发安全地读写状态。
- **向上查找**：沿 `parent` 链搜索，内层图的节点可以访问外层图的状态（词法作用域语义）。

**公开接口**（compose/state.go:165-173）：

```go
func ProcessState[S any](ctx context.Context, handler func(context.Context, S) error) error {
    s, pMu, err := getState[S](ctx)
    if err != nil {
        return fmt.Errorf("get state from context fail: %w", err)
    }
    pMu.Lock()
    defer pMu.Unlock()
    return handler(ctx, s)
}
```

`ProcessState` 是用户在自定义节点中访问状态的标准方式，自动加锁保护并发安全。

### 2.2 Callback 传播

Eino 的内部 callbacks 包通过 ctx 传递 Handler 链，实现横切关注点（日志、追踪等）的注入与传播。

**定义 ctx key**（internal/callbacks/manager.go:21-22）：

```go
type CtxManagerKey struct{}
type CtxRunInfoKey struct{}
```

**注入 Manager**（internal/callbacks/manager.go:47-49）：

```go
func ctxWithManager(ctx context.Context, manager *manager) context.Context {
    return context.WithValue(ctx, CtxManagerKey{}, manager)
}
```

**初始化回调**（internal/callbacks/inject.go:27-34）：

```go
func InitCallbacks(ctx context.Context, info *RunInfo, handlers ...Handler) context.Context {
    mgr, ok := newManager(info, handlers...)
    if ok {
        return ctxWithManager(ctx, mgr)
    }
    return ctxWithManager(ctx, nil)
}
```

回调管理器随 ctx 在节点间传播，每个节点执行时通过 `managerFromCtx(ctx)` 取出管理器，调用对应的生命周期钩子（OnStart、OnEnd、OnError 等）。

**回调触发**（internal/callbacks/inject.go:74-105）：`On` 函数从 ctx 中取出 manager，过滤匹配 timing 的 handler，依次执行。流式场景下还会使用 `StreamReader.Copy` 将流分发给多个 handler。

### 2.3 Session 传播

ADK 模块通过 ctx 管理 RunCtx，实现跨节点的会话数据共享。

**定义 key**（adk/runctx.go:372）：

```go
type runCtxKey struct{}
```

**存取 RunCtx**（adk/runctx.go:374-384）：

```go
func getRunCtx(ctx context.Context) *runContext {
    runCtx, ok := ctx.Value(runCtxKey{}).(*runContext)
    if !ok {
        return nil
    }
    return runCtx
}

func setRunCtx(ctx context.Context, runCtx *runContext) context.Context {
    return context.WithValue(ctx, runCtxKey{}, runCtx)
}
```

**初始化 RunCtx**（adk/runctx.go:386-400）：

```go
func initRunCtx(ctx context.Context, agentName string, input *AgentInput) (context.Context, *runContext) {
    runCtx := getRunCtx(ctx)
    if runCtx != nil {
        runCtx = runCtx.deepCopy() // 嵌套 agent 时深拷贝
    } else {
        runCtx = &runContext{Session: newRunSession()}
    }

    runCtx.RunPath = append(runCtx.RunPath, RunStep{agentName: agentName})
    if runCtx.isRoot() && input != nil {
        runCtx.RootInput = input
    }

    return setRunCtx(ctx, runCtx), runCtx
}
```

注意：嵌套 agent 调用时使用 `deepCopy`，避免子 agent 的修改影响父级 context。

### 2.4 ToolResultSender 传播

`flow/agent/react` 包通过 ctx 传递 tool 结果发送器，让工具中间件可以将结果转发给外部监听者。

**定义 key**（flow/agent/react/react.go:42）：

```go
type toolResultSenderCtxKey struct{}
```

**注入和提取**（flow/agent/react/react.go:44-54）：

```go
func setToolResultSendersToCtx(ctx context.Context, senders *toolResultSenders) context.Context {
    return context.WithValue(ctx, toolResultSenderCtxKey{}, senders)
}

func getToolResultSendersFromCtx(ctx context.Context) *toolResultSenders {
    v := ctx.Value(toolResultSenderCtxKey{})
    if v == nil {
        return nil
    }
    return v.(*toolResultSenders)
}
```

在工具中间件中使用（flow/agent/react/react.go:67-78）：

```go
func newToolResultCollectorMiddleware() compose.ToolMiddleware {
    return compose.ToolMiddleware{
        Invokable: func(next compose.InvokableToolEndpoint) compose.InvokableToolEndpoint {
            return func(ctx context.Context, input *compose.ToolInput) (*compose.ToolOutput, error) {
                senders := getToolResultSendersFromCtx(ctx)
                output, err := next(ctx, input)
                if err != nil {
                    return nil, err
                }
                if senders != nil && senders.sender != nil {
                    senders.sender(input.Name, input.CallID, output.Result)
                }
                return output, nil
            }
        },
    }
}
```

### 2.5 CancelContext 传播

ADK 的取消机制同样通过 ctx 传播 cancelContext。

**定义 key**（adk/cancel.go:283）：

```go
type cancelContextKey struct{}
```

**注入与提取**（adk/cancel.go:286-299）：

```go
func withCancelContext(ctx context.Context, cc *cancelContext) context.Context {
    if cc == nil {
        return ctx
    }
    return context.WithValue(ctx, cancelContextKey{}, cc)
}

func getCancelContext(ctx context.Context) *cancelContext {
    if v := ctx.Value(cancelContextKey{}); v != nil {
        return v.(*cancelContext)
    }
    return nil
}
```

## 3. context.WithCancel — 取消传播

`context.WithCancel` 创建一个可取消的子 context，调用 cancel 函数后，所有基于该 context 的子 context 都会收到取消信号。

### 3.1 ADK 的 cancelContext

ADK 实现了一套完整的取消状态机（adk/cancel.go:246-260）：

```go
const (
    stateRunning       int32 = 0 // 初始状态：agent 正在执行
    stateCancelling    int32 = 1 // 取消已请求，尚未处理
    stateDone          int32 = 2 // 执行正常结束
    stateCancelHandled int32 = 5 // 取消已处理，CancelError 已发送
)
```

状态转换规则：
- `stateRunning -> stateCancelling`：用户调用 AgentCancelFunc
- `stateRunning -> stateDone`：执行正常结束
- `stateCancelling -> stateCancelHandled`：中断被吸收为 CancelError
- `stateCancelling -> stateDone`：取消请求未及时处理，执行先结束

`cancelContext` 内部使用 channel 而非标准 `context.WithCancel`，因为它需要支持多种取消模式（立即取消、ChatModel 后取消、ToolCalls 后取消）和递归传播。

### 3.2 流式处理中的取消检测

在流式处理中，通过 select 监听取消信号实现提前退出（adk/cancel.go:909-931）：

```go
select {
case <-cc.immediateChan:
    var zero T
    writer.Send(zero, ErrStreamCanceled)
    return
case r, ok := <-ch:
    if !ok {
        return
    }
    if r.err != nil {
        if r.err == io.EOF {
            return
        }
        var zero T
        writer.Send(zero, r.err)
        return
    }
    if closed := writer.Send(r.data, nil); closed {
        return
    }
}
```

## 4. context.WithTimeout — 超时控制

`context.WithTimeout` 创建一个带超时的子 context，超时后 Done channel 自动关闭。

### 4.1 Runner 执行限时

Eino 的 Graph 编译选项 `WithMaxRunSteps` 限制最大执行步数（compose/error.go:27）：

```go
var ErrExceedMaxSteps = errors.New("exceeds max steps")
```

虽然步数限制不是直接用 `WithTimeout` 实现的，但用户可以为整个 Runner 调用设置超时：

```go
ctx, cancel := context.WithTimeout(ctx, 30*time.Second)
defer cancel()
result, err := runnable.Invoke(ctx, input)
```

### 4.2 ChatModel 调用超时

为模型调用设置超时，防止模型长时间无响应：

```go
modelCtx, cancel := context.WithTimeout(ctx, 60*time.Second)
defer cancel()
response, err := chatModel.Generate(modelCtx, messages)
```

## 5. Context 在 Graph 编排中的流转

### 5.1 编译后的 Runnable 如何传播 ctx

编译后的 Graph 变为 `composableRunnable`（compose/runnable.go:46-63），其核心执行函数签名：

```go
type invoke func(ctx context.Context, input any, opts ...any) (output any, err error)
type transform func(ctx context.Context, input streamReader, opts ...any) (output streamReader, err error)
```

每个节点的执行都接收 ctx 并向下传递。在 `runnablePacker` 中（compose/runnable.go:79-98），可以通过 `wrapRunnableCtx` 包装 ctx：

```go
func (rp *runnablePacker[I, O, TOption]) wrapRunnableCtx(
    ctxWrapper func(ctx context.Context, opts ...TOption) context.Context) {
    i := rp.i
    rp.i = func(ctx context.Context, input I, opts ...TOption) (output O, err error) {
        ctx = ctxWrapper(ctx, opts...)
        return i(ctx, input, opts...)
    }
}
```

### 5.2 Callback 注入如何通过 ctx 传递

当 `enableCallback = true` 时（compose/runnable.go:341-357），`newRunnablePacker` 会用 `invokeWithCallbacks` 等函数包装原始执行函数，这些包装函数从 ctx 中提取 callback manager，在执行前后触发钩子。

## 6. 最佳实践

### 6.1 不要在结构体中存储 ctx

```go
// 错误：ctx 存储在结构体中，生命周期不可控
type BadService struct {
    ctx context.Context
}

// 正确：ctx 作为方法参数传递
type GoodService struct{}
func (s *GoodService) DoSomething(ctx context.Context) error { return nil }
```

Eino 的所有 Runnable 接口都将 ctx 作为第一个参数。

### 6.2 ctx 作为第一个参数

Go 社区惯例：ctx 始终作为函数的第一个参数，类型为 `context.Context`。Eino 严格遵循（compose/runnable.go:32-37）：

```go
type Runnable[I, O any] interface {
    Invoke(ctx context.Context, input I, opts ...Option) (output O, err error)
    Stream(ctx context.Context, input I, opts ...Option) (output *schema.StreamReader[O], err error)
    Collect(ctx context.Context, input *schema.StreamReader[I], opts ...Option) (output O, err error)
    Transform(ctx context.Context, input *schema.StreamReader[I], opts ...Option) (output *schema.StreamReader[O], err error)
}
```

### 6.3 不要传 nil ctx

```go
// 错误：传 nil 会导致 ctx.Value() panic
result, err := runnable.Invoke(nil, input)

// 正确：使用 context.Background() 作为根 context
result, err := runnable.Invoke(context.Background(), input)
```

如果不确定是否有 ctx，使用 `context.TODO()` 标注待补充。

## 7. 常见陷阱

### 7.1 ctx.Value 的 key 冲突

不同包使用相同类型的 key 会产生冲突。Eino 的做法是使用**包级私有空结构体**：

```go
// compose/state.go:32
type stateKey struct{}

// internal/callbacks/manager.go:21
type CtxManagerKey struct{}

// adk/cancel.go:283
type cancelContextKey struct{}

// adk/runctx.go:372
type runCtxKey struct{}

// flow/agent/react/react.go:42
type toolResultSenderCtxKey struct{}
```

每个包使用不同的空结构体类型，因为不同类型的零值永远不相等，所以不会冲突。**切忌使用字符串作为 key**：

```go
// 危险：字符串 key 容易跨包冲突
ctx = context.WithValue(ctx, "state", myState)

// 安全：使用包级私有类型
type myKey struct{}
ctx = context.WithValue(ctx, myKey{}, myState)
```

### 7.2 修改 ctx 不影响父级

`context.WithValue` 返回的是**新的子 context**，原始 context 不受影响：

```go
parentCtx := context.Background()
childCtx := context.WithValue(parentCtx, stateKey{}, "hello")

// parentCtx.Value(stateKey{}) == nil  （父级不受影响）
// childCtx.Value(stateKey{}) == "hello"（子级可见）
```

在 Eino 中，这意味着每个节点对 ctx 的修改只在当前及下游节点可见，不会影响上游或同级节点。

### 7.3 忽略 ctx 的取消信号

在长时间操作中不检查 ctx.Done() 会导致无法取消：

```go
// 错误：忽略取消信号
func process(ctx context.Context) error {
    time.Sleep(10 * time.Second)
    return nil
}

// 正确：响应取消信号
func process(ctx context.Context) error {
    select {
    case <-ctx.Done():
        return ctx.Err()
    case <-time.After(10 * time.Second):
        return nil
    }
}
```

## 练习

1. 实现一个简单的 key-value 存储，使用 `context.WithValue` 传递，支持嵌套覆盖（子 context 的值覆盖父 context 同 key 的值）。

2. 参照 Eino 的 `stateKey{}` 模式，定义三个不同包的 context key，验证它们互不冲突。

3. 实现一个带超时的 HTTP 请求函数：使用 `context.WithTimeout` 设置 3 秒超时，超时后返回错误。

4. 编写一个模拟 Graph 执行流程：将 state 注入 ctx，在三个"节点"函数中通过 `ProcessState` 读写状态，验证状态在节点间正确传播。
