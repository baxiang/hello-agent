# Channel 与并发原语 — Eino 流式处理的核心引擎

## 1. Channel 基础

Go 的 channel 是一等公民类型的并发原语，用于在 goroutine 之间安全传递数据。理解 channel 是阅读 Eino 流式处理代码的前提。

### 无缓冲 channel

```go
ch := make(chan int)  // 无缓冲：发送和接收必须同时就绪
go func() { ch <- 42 }()  // 发送方阻塞，直到有人接收
val := <-ch              // 接收方阻塞，直到有人发送
```

无缓冲 channel 的发送和接收是**同步的**——发送方必须等到接收方就绪才能完成发送，反之亦然。这保证了数据的即时传递，但也容易导致死锁。

### 有缓冲 channel

```go
ch := make(chan int, 3)  // 缓冲区大小为 3
ch <- 1   // 不阻塞（缓冲区未满）
ch <- 2   // 不阻塞
ch <- 3   // 不阻塞
// ch <- 4 // 会阻塞，缓冲区已满
val := <-ch  // 取出 1，缓冲区现在有 2 个元素
```

有缓冲 channel 在缓冲区未满时发送不阻塞，缓冲区非空时接收不阻塞。这使得生产者和消费者可以以不同速率工作，提供了一定的解耦能力。

### 关闭 channel

```go
close(ch)        // 关闭 channel，通知接收方不再有新数据
val, ok := <-ch  // ok == false 表示 channel 已关闭且缓冲区为空
```

关闭一个已关闭的 channel 会 panic。向已关闭的 channel 发送也会 panic。只有发送方应该关闭 channel。

## 2. Eino stream[T] 底层实现

Eino 的流式处理建立在 channel 之上。`schema/stream.go:375-394` 定义了核心的 `stream` 结构体：

```go
// schema/stream.go:375-394
type stream[T any] struct {
    items chan streamItem[T]  // 带 buffer 的数据通道
    closed chan struct{}      // 关闭信号通道（接收方主动取消）
    automaticClose bool      // 是否启用 GC 自动关闭
    closedFlag     *uint32   // 原子标志，配合 automaticClose 使用
}

type streamItem[T any] struct {
    chunk T     // 数据
    err   error // 错误
}
```

这里用到了**两个 channel**，各有分工：

- `items`：带缓冲的数据通道，承载实际的流数据。缓冲大小由调用方指定
- `closed`：无缓冲的信号通道，接收方通过关闭它来通知发送方"我不再读了"

`newStream` 工厂函数（`schema/stream.go:389-394`）：

```go
// schema/stream.go:389-394
func newStream[T any](cap int) *stream[T] {
    return &stream[T]{
        items:  make(chan streamItem[T], cap),  // 有缓冲 channel
        closed: make(chan struct{}),             // 信号 channel
    }
}
```

## 3. Pipe 创建读写对

`schema/stream.go:99-102` 的 `Pipe` 函数创建一对关联的 StreamWriter 和 StreamReader：

```go
// schema/stream.go:99-102
func Pipe[T any](cap int) (*StreamReader[T], *StreamWriter[T]) {
    stm := newStream[T](cap)
    return stm.asReader(), &StreamWriter[T]{stm: stm}
}
```

这类似于标准库的 `io.Pipe()`，但有关键区别：

| 特性 | io.Pipe | schema.Pipe |
|------|---------|-------------|
| 数据类型 | byte | 泛型 T |
| 缓冲 | 无缓冲 | 可配置缓冲 |
| 取消机制 | 无 | `closed` channel |
| 错误传递 | 通过 Write 返回 | 通过 streamItem.err 传递 |

使用示例（`schema/stream.go:79-98`）：

```go
sr, sw := schema.Pipe[string](3)  // 缓冲区大小为 3
go func() {       // 发送方 goroutine
    defer sw.Close()
    for i := 0; i < 10; i++ {
        sw.Send(i, nil)
    }
}()

defer sr.Close()  // 接收方必须关闭
for {
    chunk, err := sr.Recv()
    if errors.Is(err, io.EOF) {
        break
    }
    if err != nil {
        panic(err)
    }
    fmt.Println(chunk)
}
```

## 4. Send/Recv 实现

### 4.1 Send — 带取消检测的发送

`schema/stream.go:410-426` 实现了发送逻辑：

```go
// schema/stream.go:410-426
func (s *stream[T]) send(chunk T, err error) (closed bool) {
    // 第一步：检查接收方是否已关闭
    select {
    case <-s.closed:
        return true   // 接收方已取消，不再发送
    default:
    }

    item := streamItem[T]{chunk, err}

    // 第二步：尝试发送，同时监听关闭信号
    select {
    case <-s.closed:
        return true              // 发送前被取消
    case s.items <- item:
        return false             // 发送成功
    }
}
```

关键设计：**两次 select 检查 `closed` channel**。第一次是快速路径——如果接收方已经关闭，不需要尝试发送。第二次是在等待缓冲区空间时，同时监听关闭信号，避免在缓冲区满时死锁。

### 4.2 Recv — 从 channel 读取

`schema/stream.go:400-408` 实现了接收逻辑：

```go
// schema/stream.go:400-408
func (s *stream[T]) recv() (chunk T, err error) {
    item, ok := <-s.items

    if !ok {
        item.err = io.EOF  // channel 已关闭，返回 EOF
    }

    return item.chunk, item.err
}
```

接收方从 `items` channel 读取数据。当发送方调用 `closeSend()`（`schema/stream.go:428-430`）关闭 `items` channel 后，`ok` 变为 `false`，返回 `io.EOF`。

### 4.3 closeRecv — 接收方主动取消

`schema/stream.go:432-441` 展示了两种关闭模式：

```go
// schema/stream.go:432-441
func (s *stream[T]) closeRecv() {
    if s.automaticClose {
        // 原子操作：确保只关闭一次（GC 可能触发多次）
        if atomic.CompareAndSwapUint32(s.closedFlag, 0, 1) {
            close(s.closed)
        }
        return
    }

    close(s.closed)  // 普通模式：直接关闭
}
```

`automaticClose` 模式使用 `sync/atomic` 的 CAS 操作保证 `closed` channel 只被关闭一次。这配合 `runtime.SetFinalizer` 使用——当 StreamReader 被 GC 回收时自动关闭流，避免 goroutine 泄漏。

## 5. MergeStreamReaders 多路合并

`schema/stream.go:912-960` 实现了将多个流合并为一个流的核心逻辑：

```go
// schema/stream.go:912-960
func MergeStreamReaders[T any](srs []*StreamReader[T]) *StreamReader[T] {
    if len(srs) < 1 {
        return nil
    }
    if len(srs) < 2 {
        return srs[0]
    }

    var arr []T
    var ss []*stream[T]

    for _, sr := range srs {
        switch sr.typ {
        case readerTypeStream:
            ss = append(ss, sr.st)              // 直接复用底层 stream
        case readerTypeArray:
            arr = append(arr, sr.ar.arr[sr.ar.index:]...)
        case readerTypeMultiStream:
            ss = append(ss, sr.msr.nonClosedStreams()...)  // 展开已有的多路流
        case readerTypeWithConvert:
            ss = append(ss, sr.srw.toStream())  // 转换流需要先转为 stream
        case readerTypeChild:
            ss = append(ss, sr.csr.toStream())  // 子流也需要转换
        }
    }

    // 全部是数组的情况
    if len(ss) == 0 {
        return &StreamReader[T]{
            typ: readerTypeArray,
            ar: &arrayReader[T]{arr: arr, index: 0},
        }
    }

    // 混合了数组和流的情况
    if len(arr) != 0 {
        s := arrToStream(arr)  // 数组转为流
        ss = append(ss, s)
    }

    return &StreamReader[T]{
        typ: readerTypeMultiStream,
        msr: newMultiStreamReader(ss),  // 创建多路读取器
    }
}
```

关键点：`MergeStreamReaders` 不是简单地把所有子流塞进一个 channel，而是**类型感知**的——根据每个 StreamReader 的实际类型采取不同的合并策略，尽可能避免不必要的 goroutine 开销。

### 5.1 newMultiStreamReader — 动态 vs 静态 select

`schema/stream.go:514-536` 创建多路读取器：

```go
// schema/stream.go:514-536
func newMultiStreamReader[T any](sts []*stream[T]) *multiStreamReader[T] {
    var itemsCases []reflect.SelectCase
    if len(sts) > maxSelectNum {   // maxSelectNum == 5
        // 动态 select：超过 5 路时使用 reflect.Select
        itemsCases = make([]reflect.SelectCase, len(sts))
        for i, st := range sts {
            itemsCases[i] = reflect.SelectCase{
                Dir:  reflect.SelectRecv,
                Chan: reflect.ValueOf(st.items),
            }
        }
    }

    nonClosed := make([]int, len(sts))
    for i := range sts {
        nonClosed[i] = i
    }

    return &multiStreamReader[T]{
        sts:        sts,
        itemsCases: itemsCases,
        nonClosed:  nonClosed,
    }
}
```

### 5.2 receiveN — 静态 select 的代码生成

`schema/select.go:21-73` 展示了一个巧妙的技巧——用切片索引选择预编译的 select 函数：

```go
// schema/select.go:19
const maxSelectNum = 5

func receiveN[T any](chosenList []int, ss []*stream[T]) (int, *streamItem[T], bool) {
    return []func(chosenList []int, ss []*stream[T]) (int, *streamItem[T], bool){
        nil,  // 0 路
        func(...) { return chosenList[0], &(<-ss[chosenList[0]].items), true },  // 1 路
        func(...) {  // 2 路
            select {
            case item, ok := <-ss[chosenList[0]].items: ...
            case item, ok := <-ss[chosenList[1]].items: ...
            }
        },
        // 3 路、4 路、5 路同理
    }[len(chosenList)](chosenList, ss)
}
```

Go 的 `select` 语句要求 case 数量在编译期确定。Eino 通过**预编译 1~5 路的 select 函数**，在运行时根据未关闭流的数量动态选择。当流数量超过 5 时，降级为 `reflect.Select`。

### 5.3 recv — 多路读取的核心循环

`schema/stream.go:538-574`：

```go
// schema/stream.go:538-574
func (msr *multiStreamReader[T]) recv() (T, error) {
    for len(msr.nonClosed) > 0 {
        var chosen int
        var ok bool
        if len(msr.nonClosed) > maxSelectNum {
            // 动态 select
            var recv reflect.Value
            chosen, recv, ok = reflect.Select(msr.itemsCases)
            if ok {
                item := recv.Interface().(streamItem[T])
                return item.chunk, item.err
            }
            msr.itemsCases[chosen].Chan = reflect.Value{}  // 标记为已关闭
        } else {
            // 静态 select
            var item *streamItem[T]
            chosen, item, ok = receiveN(msr.nonClosed, msr.sts)
            if ok {
                return item.chunk, item.err
            }
        }

        // 从 nonClosed 中移除已关闭的流
        for i := range msr.nonClosed {
            if msr.nonClosed[i] == chosen {
                msr.nonClosed = append(msr.nonClosed[:i], msr.nonClosed[i+1:]...)
                break
            }
        }
        // 如果有命名源，返回 SourceEOF
        if len(msr.sourceReaderNames) > 0 {
            var t T
            return t, &SourceEOF{msr.sourceReaderNames[chosen]}
        }
    }

    var t T
    return t, io.EOF  // 所有流都已关闭
}
```

这个函数的核心是一个 for 循环，不断从未关闭的流中 select 数据。当某个流关闭时（`ok == false`），将其从 `nonClosed` 列表中移除。所有流关闭后返回 `io.EOF`。

## 6. Copy 扇出机制

`schema/stream.go:261-275` 的 `Copy` 方法将一个流扇出为 N 个独立的消费者：

```go
// schema/stream.go:261-275
func (sr *StreamReader[T]) Copy(n int) []*StreamReader[T] {
    if n < 2 {
        return []*StreamReader[T]{sr}  // 只需 1 份，直接返回
    }

    if sr.typ == readerTypeArray {
        // 数组类型：直接复制索引即可
        ret := make([]*StreamReader[T], n)
        for i, ar := range sr.ar.copy(n) {
            ret[i] = &StreamReader[T]{typ: readerTypeArray, ar: ar}
        }
        return ret
    }

    return copyStreamReaders[T](sr, n)  // 通用流：使用惰性求值
}
```

### 6.1 copyStreamReaders — 惰性求值的链表

`schema/stream.go:792-821` 实现了一个精巧的惰性求值机制：

```go
// schema/stream.go:784-788
type cpStreamElement[T any] struct {
    once sync.Once            // 保证只读取一次
    next *cpStreamElement[T]  // 链表下一个节点
    item streamItem[T]        // 缓存的数据
}

// schema/stream.go:792-821
func copyStreamReaders[T any](sr *StreamReader[T], n int) []*StreamReader[T] {
    cpsr := &parentStreamReader[T]{
        sr:            sr,
        subStreamList: make([]*cpStreamElement[T], n),  // 每个子流的当前读取位置
        closedNum:     0,
    }

    // 所有子流初始指向同一个空元素（类似尾节点）
    elem := &cpStreamElement[T]{}
    for i := range cpsr.subStreamList {
        cpsr.subStreamList[i] = elem
    }

    ret := make([]*StreamReader[T], n)
    for i := range ret {
        ret[i] = &StreamReader[T]{
            csr: &childStreamReader[T]{
                parent: cpsr,
                index:  i,
            },
            typ: readerTypeChild,
        }
    }

    return ret
}
```

这形成了一个**隐式链表**：所有子流初始指向同一个空 `cpStreamElement`。当某个子流第一次读取时，通过 `sync.Once` 触发真正的 `Recv`，并将结果缓存到元素中，同时创建下一个空元素。后续子流读取同一个位置时直接获取缓存，无需再次调用 `Recv`。

### 6.2 peek — sync.Once 保证的安全读取

`schema/stream.go:837-866` 是核心的 peek 操作：

```go
// schema/stream.go:837-866
func (p *parentStreamReader[T]) peek(idx int) (t T, err error) {
    elem := p.subStreamList[idx]
    if elem == nil {
        return t, ErrRecvAfterClosed  // 子流已关闭
    }

    // sync.Once：只有第一个到达的子流会执行 Recv
    elem.once.Do(func() {
        t, err = p.sr.Recv()                   // 从原始流读取
        elem.item = streamItem[T]{chunk: t, err: err}  // 缓存结果
        if err != io.EOF {
            elem.next = &cpStreamElement[T]{}   // 创建下一个节点
            p.subStreamList[idx] = elem.next    // 移动指针
        }
    })

    // 所有子流都能读取已缓存的数据
    t = elem.item.chunk
    err = elem.item.err
    if err != io.EOF {
        p.subStreamList[idx] = elem.next  // 移动到下一个节点
    }

    return t, err
}
```

`sync.Once` 保证了：即使多个子流并发读取同一个位置，`p.sr.Recv()` 也只会被调用一次。这实现了**惰性求值 + 缓存共享**的扇出模式，无需预先读取全部数据。

### 6.3 close — 引用计数式关闭

`schema/stream.go:868-881`：

```go
// schema/stream.go:868-881
func (p *parentStreamReader[T]) close(idx int) {
    if p.subStreamList[idx] == nil {
        return  // 避免重复关闭
    }

    p.subStreamList[idx] = nil  // 标记为已关闭

    curClosedNum := atomic.AddUint32(&p.closedNum, 1)  // 原子递增关闭计数

    allClosed := int(curClosedNum) == len(p.subStreamList)
    if allClosed {
        p.sr.Close()  // 所有子流都关闭后，才关闭原始流
    }
}
```

只有当所有子流都关闭后，才会关闭原始 StreamReader。这避免了某个子流提前关闭导致其他子流无法读取的问题。

## 7. 并发安全

### 7.1 sync.Mutex 在 State 中的使用

`compose/state.go:175-196` 展示了 Mutex 在图状态管理中的应用：

```go
// compose/state.go:175-196
func getState[S any](ctx context.Context) (S, *sync.Mutex, error) {
    state := ctx.Value(stateKey{})
    // ...
    interState := state.(*internalState)

    for interState != nil {
        if cState, ok := interState.state.(S); ok {
            return cState, &interState.mu, nil  // 返回状态和对应的锁
        }
        interState = interState.parent
    }
    // ...
}
```

`ProcessState`（`compose/state.go:165-173`）封装了加锁/解锁逻辑：

```go
// compose/state.go:165-173
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

每个图状态层有独立的 `sync.Mutex`，内层状态不会阻塞外层状态的访问。嵌套图中，内层状态遮蔽外层同类型状态，类似词法作用域。

### 7.2 sync/atomic 在 closedFlag 中的使用

`schema/stream.go:433-441` 中 `atomic.CompareAndSwapUint32` 保证关闭操作只执行一次：

```go
if atomic.CompareAndSwapUint32(s.closedFlag, 0, 1) {
    close(s.closed)  // 只有线程安全地"赢得"CAS 的 goroutine 才会执行
}
```

`parentStreamReader.close`（`schema/stream.go:875`）中 `atomic.AddUint32` 实现原子递增关闭计数。

### 7.3 sync.Once 在 Copy 中的使用

`cpStreamElement.once`（`schema/stream.go:785`）保证 `p.sr.Recv()` 只被调用一次，即使多个子流并发读取。这是 Copy 扇出机制的基石。

## 8. goroutine 在 Eino 中的应用

### 8.1 toStream — goroutine 转换流

`schema/stream.go:747-778` 展示了将任意 Reader 转为 `*stream[T]` 的通用模式：

```go
// schema/stream.go:747-778
func toStream[T any, Reader reader[T]](r Reader) *stream[T] {
    ret := newStream[T](5)  // 缓冲区大小为 5

    go func() {
        defer func() {
            panicErr := recover()
            if panicErr != nil {
                e := safe.NewPanicErr(panicErr, debug.Stack())
                var chunk T
                _ = ret.send(chunk, e)  // 将 panic 转为错误发送
            }
            ret.closeSend()  // 无论如何都关闭发送端
            r.close()        // 关闭原始 Reader
        }()

        for {
            out, err := r.recv()
            if err == io.EOF {
                break
            }

            closed := ret.send(out, err)
            if closed {
                break  // 接收方已关闭
            }
        }
    }()

    return ret
}
```

三个关键设计点：

1. **defer + recover**：捕获 goroutine 中的 panic，转为错误发送给接收方，避免整个程序崩溃
2. **defer closeSend**：确保 goroutine 退出时总是关闭发送端
3. **closed 检测**：如果接收方已关闭（`send` 返回 `true`），及时退出避免 goroutine 泄漏

这个模式在 Eino 中被广泛使用——`streamReaderWithConvert.toStream()`、`childStreamReader.toStream()`、`multiStreamReader.toStream()` 都通过它转换。

### 8.2 parallelRunToolCall — 并行工具调用

`compose/tool_node.go:985-1017` 展示了 goroutine 在工具并行调用中的应用：

```go
// compose/tool_node.go:985-1017
func parallelRunToolCall(ctx context.Context,
    run func(ctx2 context.Context, callTask *toolCallTask, opts ...tool.Option),
    tasks []toolCallTask, opts ...tool.Option) {

    if len(tasks) == 1 {
        run(ctx, &tasks[0], opts...)  // 单任务无需启动 goroutine
        return
    }

    var wg sync.WaitGroup
    for i := 1; i < len(tasks); i++ {
        if tasks[i].executed { continue }
        wg.Add(1)
        go func(ctx_ context.Context, t *toolCallTask, opts ...tool.Option) {
            defer wg.Done()
            defer func() {
                panicErr := recover()
                if panicErr != nil {
                    t.err = safe.NewPanicErr(panicErr, debug.Stack())
                }
            }()
            run(ctx_, t, opts...)
        }(ctx, &tasks[i], opts...)
    }

    if !tasks[0].executed {
        run(ctx, &tasks[0], opts...)  // 第一个任务在当前 goroutine 执行
    }

    wg.Wait()
}
```

注意第一个任务在当前 goroutine 执行（减少 goroutine 创建开销），其余任务并发执行，最后 `wg.Wait()` 等待所有任务完成。

## 9. select 多路复用

### 9.1 动态 select — reflect.Select

当流的数量超过 `maxSelectNum`（5）时，Eino 使用 `reflect.Select`（`schema/stream.go:516-524`）：

```go
// schema/stream.go:516-524
if len(sts) > maxSelectNum {
    itemsCases = make([]reflect.SelectCase, len(sts))
    for i, st := range sts {
        itemsCases[i] = reflect.SelectCase{
            Dir:  reflect.SelectRecv,
            Chan: reflect.ValueOf(st.items),
        }
    }
}
```

`reflect.Select` 的性能比原生 `select` 差，但支持任意数量的 case。Eino 的策略是：**5 路以下用预编译的静态 select，5 路以上降级为 reflect**。

### 9.2 静态 select — receiveN 函数

`schema/select.go:21-73` 预编译了 1~5 路的 select 函数。以 3 路为例：

```go
func(chosenList []int, ss []*stream[T]) (int, *streamItem[T], bool) {
    select {
    case item, ok := <-ss[chosenList[0]].items:
        return chosenList[0], &item, ok
    case item, ok := <-ss[chosenList[1]].items:
        return chosenList[1], &item, ok
    case item, ok := <-ss[chosenList[2]].items:
        return chosenList[2], &item, ok
    }
}
```

通过 `chosenList` 间接索引，使得同一个函数可以处理不同的流组合——关闭某些流后，只需从 `chosenList` 中移除对应索引即可。

## 10. 常见陷阱

### 10.1 goroutine 泄漏 — 未 Close StreamReader

```go
// 危险：如果中途退出循环但不 Close，toStream 中的 goroutine 会永远阻塞
sr, sw := schema.Pipe[string](1)
go func() {
    defer sw.Close()
    for i := 0; i < 1000000; i++ {
        sw.Send(str, nil)  // 缓冲区满后阻塞
    }
}()

chunk, _ := sr.Recv()  // 只读了一个
// 忘记 sr.Close() —— 发送方 goroutine 永远阻塞！
```

Eino 的解决方案是 `SetAutomaticClose()`（`schema/stream.go:279-309`），利用 `runtime.SetFinalizer` 在 StreamReader 被 GC 回收时自动关闭。但这只是安全网，**正确做法是始终 `defer sr.Close()`**。

### 10.2 Deadlock — 缓冲满且无人读取

```go
sr, sw := schema.Pipe[int](0)  // 无缓冲
sw.Send(1, nil)  // 永远阻塞，没有接收方
```

即使使用有缓冲 channel，如果生产速度远超消费速度，缓冲区满后发送方也会阻塞。Eino 的 `toStream` 使用缓冲区大小 5，提供了一定的缓冲能力，但在持续高速生产时仍需注意。

### 10.3 闭包中的循环变量

`parallelRunToolCall` 中（`compose/tool_node.go:1000-1009`）通过参数传递捕获变量：

```go
go func(ctx_ context.Context, t *toolCallTask, opts ...tool.Option) {
    // ctx_, t, opts 都是函数参数，每次调用都有独立副本
    run(ctx_, t, opts...)
}(ctx, &tasks[i], opts...)  // 通过参数传递，而非闭包捕获
```

如果直接在闭包中使用 `tasks[i]`，在 Go 1.21 及更早版本中，`i` 可能会被后续循环覆盖。

## 11. 练习

1. **基础**：实现一个带超时的 StreamReader 读取函数——如果 `Recv` 在指定时间内没有返回数据，返回超时错误：

```go
func RecvWithTimeout[T any](sr *StreamReader[T], timeout time.Duration) (T, error) {
    // 提示：使用 select + time.After
}
```

2. **进阶**：参考 `copyStreamReaders` 的惰性求值模式，实现一个 "Replay" StreamReader——第一个消费者读取完后，第二个消费者可以从头开始重放，无需重新执行上游操作。

3. **挑战**：分析 `MergeStreamReaders` 在 100 路合并时的性能瓶颈，设计一个分层的合并策略（二叉树式合并），使得每层不超过 5 路，从而始终使用静态 select。
