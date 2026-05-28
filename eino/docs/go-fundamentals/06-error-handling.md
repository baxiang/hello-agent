# 错误处理与哨兵错误 — Eino 流式处理的控制流

## 1. Go 错误处理哲学

Go 使用多返回值 + `error` 接口处理错误，没有异常机制：

```go
type error interface {
    Error() string
}
```

错误是值（value），可以比较、传递、包装。函数通过返回 error 表达失败，调用者通过 `if err != nil` 检查。这种显式错误处理在 Eino 的流式处理中尤为重要——流的每个 chunk 都可能携带错误，正确区分"正常结束"和"异常失败"是系统稳定性的基础。

## 2. 哨兵错误（Sentinel Errors）

哨兵错误是预定义的错误值，用于标识特定的错误条件。调用者通过 `errors.Is` 检测哨兵错误，触发对应的处理逻辑。Eino 大量使用哨兵错误来控制流式处理的流程。

### 2.1 io.EOF — 流正常结束

`io.EOF` 是 Go 标准库最经典的哨兵错误，表示"数据读完了"。Eino 的 StreamReader 在流结束时返回 `io.EOF`（schema/stream.go:400-408）：

```go
func (s *stream[T]) recv() (chunk T, err error) {
    item, ok := <-s.items

    if !ok {
        item.err = io.EOF // channel 关闭 = 流结束
    }

    return item.chunk, item.err
}
```

读取流的典型模式：

```go
defer sr.Close()
for {
    chunk, err := sr.Recv()
    if errors.Is(err, io.EOF) {
        break // 流正常结束
    }
    if err != nil {
        return err // 其他错误
    }
    process(chunk)
}
```

**关键区别**：`io.EOF` 不是"错误"，而是"结束信号"。Eino 中流结束 = `io.EOF`，调用者必须正确处理。

### 2.2 schema.ErrNoValue — 跳过元素

`ErrNoValue`（schema/stream.go:47）用于 `StreamReaderWithConvert` 中跳过不需要的元素：

```go
var ErrNoValue = errors.New("no value")
```

当 convert 函数返回 `ErrNoValue` 时，该元素被静默丢弃，不传递给调用者（schema/stream.go:699-736）：

```go
func (srw *streamReaderWithConvert[T]) recv() (T, error) {
    for {
        out, err := srw.sr.recvAny()

        if err != nil {
            // 处理流错误或 EOF...
        }

        t, err := srw.convert(out)
        if err == nil {
            return t, nil
        }

        if !errors.Is(err, ErrNoValue) { // 非 ErrNoValue 的错误向上传递
            return t, err
        }
        // ErrNoValue：静默跳过，继续读下一个元素
    }
}
```

典型用法——过滤空 chunk：

```go
outStream = schema.StreamReaderWithConvert(s,
    func(src string) (string, error) {
        if len(src) == 0 {
            return "", schema.ErrNoValue // 跳过空 chunk
        }
        return src, nil
    })
```

### 2.3 schema.ErrRecvAfterClosed — 流关闭后读取

`ErrRecvAfterClosed`（schema/stream.go:51）表示在流已经关闭后又尝试读取：

```go
var ErrRecvAfterClosed = errors.New("recv after stream closed")
```

这通常表示应用代码有 bug——StreamReader 应该只被读取一次，关闭后不应再读取。

### 2.4 adk.ErrExceedMaxIterations — 超出最大迭代

ReAct Agent 在 ChatModel 节点的 StatePreHandler 中检查剩余迭代次数（adk/react.go:33, 387-394）：

```go
var ErrExceedMaxIterations = errors.New("exceeds max iterations")

// 在 ChatModel 节点的 StatePreHandler 中
_ = g.AddChatModelNode(chatModel_, wrappedModel, compose.WithStatePreHandler(
    func(ctx context.Context, input []Message, st *State) ([]Message, error) {
        if st.getRemainingIterations() <= 0 {
            return nil, ErrExceedMaxIterations
        }
        st.decrementRemainingIterations()
        return input, nil
    }))
```

当 Agent 陷入无限循环（如工具反复调用），迭代计数器归零后触发此哨兵错误，防止资源耗尽。

### 2.5 compose.ErrChainCompiled — 编译后修改链

`ErrChainCompiled`（compose/chain.go:85）防止在 Chain 编译后修改其结构：

```go
var ErrChainCompiled = errors.New("chain has been compiled, cannot be modified")
```

在 `addNode` 中检查（compose/chain.go:565-568）：

```go
func (c *Chain[I, O]) addNode(node *graphNode, options *graphAddNodeOpts) {
    if c.gg.compiled {
        c.reportError(ErrChainCompiled)
        return
    }
    // ...
}
```

这遵循了"构建-编译-执行"的不可变模式：编译后的链不应被修改，确保执行的一致性。

### 2.6 compose.ErrExceedMaxSteps — 超出最大步数

Graph 执行时，步数超过限制触发此错误（compose/error.go:27）：

```go
var ErrExceedMaxSteps = errors.New("exceeds max steps")
```

与 `ErrExceedMaxIterations` 不同，`ErrExceedMaxSteps` 是 Graph 层级的全局步数限制，而前者是 ReAct Agent 的迭代计数。

## 3. 自定义错误类型

当哨兵错误无法携带足够信息时，Eino 使用自定义错误类型，包含额外的上下文数据。

### 3.1 schema.SourceEOF — 多源流中某个源结束

`SourceEOF`（schema/stream.go:56-74）表示多源合并流中某个特定源结束，携带源名称：

```go
type SourceEOF struct {
    sourceName string
}

func (e *SourceEOF) Error() string {
    return fmt.Sprintf("EOF from source stream: %s", e.sourceName)
}

func GetSourceName(err error) (string, bool) {
    var sErr *SourceEOF
    if errors.As(err, &sErr) {
        return sErr.sourceName, true
    }
    return "", false
}
```

在多 Agent 流中（schema/stream.go:566-569），当某个源流结束时返回 `SourceEOF`，让调用者知道是哪个 Agent 完成了：

```go
if len(msr.sourceReaderNames) > 0 {
    var t T
    return t, &SourceEOF{msr.sourceReaderNames[chosen]}
}
```

### 3.2 adk.CancelError — 取消错误

`CancelError`（adk/cancel.go:166-178）携带取消模式、是否超时升级、中断上下文等信息：

```go
type CancelError struct {
    Info *AgentCancelInfo

    InterruptContexts []*InterruptCtx

    interruptSignal *InterruptSignal // 未导出，仅 Runner 使用
}

func (e *CancelError) Error() string {
    return fmt.Sprintf("agent canceled: mode=%v, escalated=%v", e.Info.Mode, e.Info.Escalated)
}
```

通过 `errors.As` 提取（adk/runner.go:287-288）：

```go
var cancelErr *CancelError
if errors.As(event.Err, &cancelErr) {
    // 提取取消上下文，保存 checkpoint
}
```

### 3.3 compose.InterruptSignal — 中断信号

`InterruptSignal`（internal/core/interrupt.go:43-54）实现了 `error` 接口，同时携带中断的地址、状态和子信号：

```go
type InterruptSignal struct {
    ID string
    Address
    InterruptInfo
    InterruptState
    Subs []*InterruptSignal
}

func (is *InterruptSignal) Error() string {
    return fmt.Sprintf("interrupt signal: ID=%s, Addr=%s, Info=%s, State=%s, SubsLen=%d",
        is.ID, is.Address.String(), is.InterruptInfo.String(), is.InterruptState.String(), len(is.Subs))
}
```

中断信号既是 error（可以被 `errors.As` 提取），也是可序列化的数据结构（可以保存到 checkpoint 用于恢复）。

## 4. errors.Is vs ==

`errors.Is` 会解包错误链，而 `==` 只比较最外层。Eino 使用 `errors.Is` 而非 `==`，因为错误经常被 `fmt.Errorf("%w", err)` 包装。

### 4.1 io.EOF 检测

```go
// 标准用法：errors.Is 能处理包装后的错误
if errors.Is(err, io.EOF) {
    break
}
```

如果有人用 `fmt.Errorf("stream ended: %w", io.EOF)` 包装了 EOF，`err == io.EOF` 返回 false，但 `errors.Is(err, io.EOF)` 仍能正确匹配。

### 4.2 ErrNoValue 检测

在 `streamReaderWithConvert.recv` 中（schema/stream.go:732）：

```go
if !errors.Is(err, ErrNoValue) {
    return t, err
}
```

这里必须使用 `errors.Is` 而非 `==`，因为 convert 函数可能返回包装过的 ErrNoValue。

### 4.3 compose 中的 errors.Is

中断检测中使用 `errors.Is`（compose/interrupt.go:81, 247）：

```go
// 检测旧版中断错误
if errors.Is(err, deprecatedInterruptAndRerun) {
    return &wrappedInterruptAndRerun{
        ps:    newAddr,
        inner: err,
    }
}

// 检测中断重运行错误
if errors.Is(err, deprecatedInterruptAndRerun) {
    return nil, nil, true
}
```

## 5. errors.As — 类型提取

`errors.As` 从错误链中查找指定类型的错误，并提取到目标变量。Eino 大量使用此模式。

### 5.1 从事件错误中提取 CancelError

在 Runner 的事件处理循环中（adk/runner.go:287-288）：

```go
if event.Err != nil {
    var cancelErr *CancelError
    if errors.As(event.Err, &cancelErr) {
        // 提取取消错误，保存 checkpoint
        if cancelCtx != nil && cancelCtx.isRoot() && cancelCtx.shouldCancel() {
            cancelCtx.markCancelHandled()
        }
        if cancelErr.interruptSignal != nil && checkPointID != nil {
            cancelErr.InterruptContexts = core.ToInterruptContexts(
                cancelErr.interruptSignal, allowedAddressSegmentTypes)
            err := runnerSaveCheckPointImpl(...)
        }
        gen.Send(event)
        break
    }
}
```

### 5.2 从中断信号中提取 InterruptSignal

`InterruptSignal` 的检测贯穿整个中断系统（compose/interrupt.go:89, 217, 250）：

```go
ire := &core.InterruptSignal{}
if errors.As(err, &ire) {
    if ire.Address == nil {
        return &wrappedInterruptAndRerun{
            ps:    newAddr,
            inner: err,
        }
    }
    return ire
}
```

### 5.3 内部错误链解包

Graph 的错误包装使用 `internalError` 类型（compose/error.go:86-111）：

```go
type internalError struct {
    typ       internalErrorType
    nodePath  NodePath
    origError error
}

func (i *internalError) Error() string {
    // 格式：[NodeRunError] 原始错误信息 \n node path: [node1, node2]
}

func (i *internalError) Unwrap() error {
    return i.origError
}
```

`Unwrap()` 方法使 `errors.Is` 和 `errors.As` 能穿透 `internalError` 到达原始错误。例如：

```go
// 假设内部错误链：internalError{origError: ErrExceedMaxIterations}
errors.Is(err, ErrExceedMaxIterations) // true，能穿透包装
```

## 6. 流式错误处理

### 6.1 StreamReader 中 err 的传播方式

StreamReader 的错误通过 `streamItem` 传播（schema/stream.go:384-388）：

```go
type streamItem[T any] struct {
    chunk T
    err   error
}
```

每个 chunk 可以携带数据或错误。流的中间 chunk 可能携带非 EOF 错误（如网络中断），最后一个 chunk 的错误为 `io.EOF` 表示正常结束。

### 6.2 流内 panic 的 recover 机制

Eino 在流的 goroutine 中使用 recover 捕获 panic，转换为 error（schema/stream.go:750-762）：

```go
func toStream[T any, Reader reader[T]](r Reader) *stream[T] {
    ret := newStream[T](5)

    go func() {
        defer func() {
            panicErr := recover()
            if panicErr != nil {
                e := safe.NewPanicErr(panicErr, debug.Stack())
                var chunk T
                _ = ret.send(chunk, e) // panic 转为 error 发送
            }
            ret.closeSend()
            r.close()
        }()

        for {
            out, err := r.recv()
            if err == io.EOF {
                break
            }
            closed := ret.send(out, err)
            if closed {
                break
            }
        }
    }()

    return ret
}
```

`safe.NewPanicErr`（internal/safe/panic.go:35-39）将 panic 值和堆栈封装为 error：

```go
type panicErr struct {
    info  any
    stack []byte
}

func (p *panicErr) Error() string {
    return fmt.Sprintf("panic error: %v, \nstack: %s", p.info, string(p.stack))
}
```

Runner 中同样使用 recover（adk/runner.go:267-275）：

```go
defer func() {
    panicErr := recover()
    if panicErr != nil {
        e := safe.NewPanicErr(panicErr, debug.Stack())
        gen.Send(&TypedAgentEvent[M]{Err: e})
    }
    gen.Close()
}()
```

## 7. 错误包装 fmt.Errorf("%w", err)

`%w` 动词创建可解包的错误链，使 `errors.Is` 和 `errors.As` 能穿透包装层。

### 7.1 Checkpoint 保存失败时的错误包装

在 Runner 保存 checkpoint 时（adk/runner.go:296, 329）：

```go
err := runnerSaveCheckPointImpl(...)
if err != nil {
    gen.Send(&TypedAgentEvent[M]{Err: fmt.Errorf("failed to save checkpoint on cancel: %w", err)})
}
```

```go
err := runnerSaveCheckPointImpl(...)
if err != nil {
    gen.Send(&TypedAgentEvent[M]{Err: fmt.Errorf("failed to save checkpoint: %w", err)})
}
```

### 7.2 State 获取失败时的错误包装

在 `ProcessState` 中（compose/state.go:168）：

```go
return fmt.Errorf("get state from context fail: %w", err)
```

### 7.3 Graph 运行时的错误包装

`newStreamReadError` 和 `wrapGraphNodeError`（compose/error.go:50-77）：

```go
func newStreamReadError(err error) error {
    return fmt.Errorf("failed to read from stream. error: %w", err)
}

func wrapGraphNodeError(nodeKey string, err error) error {
    if ok := isInterruptError(err); ok {
        return err // 中断错误不包装，直接传递
    }
    var ie *internalError
    ok := errors.As(err, &ie)
    if !ok {
        return &internalError{
            typ:       internalErrorTypeNodeRun,
            nodePath:  NodePath{path: []string{nodeKey}},
            origError: err,
        }
    }
    ie.nodePath.path = append([]string{nodeKey}, ie.nodePath.path...)
    return ie
}
```

注意：**中断错误不包装**，直接传递。这是设计决策——中断错误需要被上层精确识别和处理，包装会干扰 `errors.Is/As` 的匹配。

## 8. 常见陷阱

### 8.1 在流式处理中吞掉错误

```go
// 错误：忽略流中的错误
for {
    chunk, _ := sr.Recv() // 忽略了 err！
    if chunk == nil {
        break
    }
    process(chunk)
}
```

流中的非 EOF 错误必须处理，否则会丢失关键错误信息（如网络中断、panic 恢复等）。

```go
// 正确：区分 EOF 和其他错误
for {
    chunk, err := sr.Recv()
    if errors.Is(err, io.EOF) {
        break
    }
    if err != nil {
        return fmt.Errorf("read stream failed: %w", err)
    }
    process(chunk)
}
```

### 8.2 未检查 Close 返回的 error

StreamReader 的 Close 没有返回 error，但 StreamWriter 和资源型组件的 Close 可能返回错误：

```go
// 错误：未检查 Close 错误
defer file.Close() // Close 可能失败，错误被忽略

// 正确：检查 Close 错误
defer func() {
    if cerr := file.Close(); cerr != nil {
        log.Printf("close failed: %v", cerr)
    }
}()
```

### 8.3 使用 == 比较哨兵错误

```go
// 错误：包装后的错误无法用 == 匹配
if err == io.EOF { // 如果 err 被 fmt.Errorf 包装过，这会失败
    break
}

// 正确：使用 errors.Is
if errors.Is(err, io.EOF) {
    break
}
```

### 8.4 用 fmt.Errorf 而非 %w 丢失错误链

```go
// 错误：使用 %v 丢失错误链
return fmt.Errorf("process failed: %v", err) // errors.Is 不再能匹配原始错误

// 正确：使用 %w 保留错误链
return fmt.Errorf("process failed: %w", err) // errors.Is 仍能匹配原始错误
```

## 练习

1. 实现一个模拟 `StreamReaderWithConvert` 的函数，使用 `ErrNoValue` 跳过偶数元素，验证只有奇数元素被传递。

2. 编写一个多源合并流，使用 `SourceEOF` 追踪每个源的完成顺序。

3. 实现一个带迭代次数限制的循环处理器，当超出限制时返回 `ErrExceedMaxIterations`。

4. 编写一个错误链解包器：给定一个多层 `fmt.Errorf("%w", ...)` 包装的错误，使用 `errors.Is` 和 `errors.As` 逐层提取原始错误和自定义错误类型。
