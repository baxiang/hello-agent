# 迭代器（range-over-func） — trpc-agent-go 的零成本流式抽象

> trpc-agent-go 在最底层的模型调用里用 `iter.Seq` 取代了部分 channel：`IterModel.GenerateContentIter` 返回一个 `Seq[*Response]`，调用方在**自己的 goroutine** 里 `for resp := range iter`，省掉了生产者 goroutine 和 channel 调度开销。不懂 Go 1.23+ 的 range-over-func，就读不懂框架为什么在流式场景下比「每个 Agent 一个 goroutine」更轻，也写不出 hedge/failover 这类组合模型。

## 核心概念

### 1. 前置：为什么迭代器离不开闭包

Go 的迭代器本质上是一个**接收 `yield` 回调的函数**，而它产出的迭代器函数往往是个**闭包**——捕获了外部变量。如果你对闭包不熟，先看这个最小例子：

```go
func makeAdder(base int) func(int) int {
    return func(x int) int {
        // 这个匿名函数「捕获」了外层的 base 变量
        return x + base
    }
}

add10 := makeAdder(10)
fmt.Println(add10(5))  // 15 —— base=10 被闭包记住
```

迭代器函数同理：它「捕获」了要遍历的数据（slice、channel、计算逻辑），然后通过 `yield` 一个一个吐出来。**闭包是迭代器的载体**。

### 2. 两种迭代器签名

Go 1.23 的 `iter` 包定义了两种迭代器类型：

```go
import "iter"

// 单值迭代器：每次 yield 一个 T（类似 for v := range slice）
type Seq[T any] func(yield func(T) bool)

// 双值迭代器：每次 yield 一个 (K, V)（类似 for k, v := range map）
type Seq2[K, V any] func(yield func(K, V) bool)
```

三个关键点：

- **`yield` 是回调**：调用 `yield(v)` 把一个元素交给 `for` 循环。`for` 循环体本质上就是被编译器包装后传给 `yield` 的函数。
- **`yield` 返回 `bool`**：返回 `false` 表示「消费者不想再要了」（比如 `break` 了），迭代器函数应当立即停止 yield。
- **迭代器函数控制「何时生产」**：它按需一个一个 yield，天然惰性——消费者不取，就不生产下一个。

### 3. 从零构建第一个迭代器

不要一上来就背签名，先理解「迭代器函数就是一个普通的闭包」。我们从最熟悉的 slice 遍历一步步演化：

```go
// 第一步：普通 for 遍历
for i := 1; i <= 5; i++ {
    fmt.Println(i * i) // 1 4 9 16 25
}

// 第二步：把遍历逻辑装进函数，但不知道怎么「把值交出去」
// —— 这就是迭代器要解决的问题

// 第三步：用 yield 回调「交出值」
func squares(n int) func(yield func(int) bool) {
    return func(yield func(int) bool) {
        for i := 1; i <= n; i++ {
            if !yield(i * i) { // 把平方数交给调用方
                return // yield 返回 false → 调用方 break 了，立即停止
            }
        }
    }
}

// 第四步：Go 1.23+ 的 range-over-func，直接 range 一个函数
for v := range squares(5) {
    fmt.Println(v) // 1 4 9 16 25
}
```

理解要点：

- `squares(5)` **返回一个函数**，这个函数签名是 `func(yield func(int) bool)`
- `for v := range squares(5)` 等价于：调用 `squares(5)` 拿到那个函数，然后「带着一个 yield 回调」去执行它
- `yield(i*i)` 被调用时，`i*i` 就赋给了循环变量 `v`，循环体执行
- 循环体执行完后，`yield` 返回 `true`（继续）或 `false`（break 了）

### 4. 提前终止与资源清理

迭代器的 `yield` 返回 `false` 时，迭代器函数应当立即 return。这一点在**带资源清理**的场景特别重要：

```go
// 一个读文件的迭代器：必须保证文件被关闭
func lines(path string) func(yield func(string) bool) {
    return func(yield func(string) bool) {
        f, err := os.Open(path)
        if err != nil {
            return
        }
        defer f.Close() // 无论正常结束还是 break，都会关闭
        sc := bufio.NewScanner(f)
        for sc.Scan() {
            if !yield(sc.Text()) {
                return // 调用方 break → 立即返回 → defer 关闭文件
            }
        }
    }
}

// 调用方提前 break，文件仍会被正确关闭
for line := range lines("/etc/hosts") {
    if strings.Contains(line, "localhost") {
        break // yield 收到 false → 迭代器 return → defer f.Close()
    }
}
```

这个「调用方 break → 迭代器收到 yield=false → 立即清理」的链路，是迭代器相比手写 goroutine+channel 的一个重要优势：**清理路径是隐式确定的**，不依赖调用方记得发取消信号。

### 5. 迭代器组合：管道模式

迭代器函数可以像 Unix 管道一样组合——一个迭代器的输出喂给下一个。这是 trpc-agent-go 多个 model 装饰器（hedge、failover）的核心技巧。

```go
// map：把 Seq[T] 转成 Seq[U]
func mapIter[T, U any](src iter.Seq[T], fn func(T) U) iter.Seq[U] {
    return func(yield func(U) bool) {
        for v := range src {
            if !yield(fn(v)) {
                return
            }
        }
    }
}

// filter：只保留满足条件的元素
func filterIter[T any](src iter.Seq[T], ok func(T) bool) iter.Seq[T] {
    return func(yield func(T) bool) {
        for v := range src {
            if ok(v) {
                if !yield(v) {
                    return
                }
            }
        }
    }
}

// 组合：取 1-10，过滤偶数，每个乘以 10
src := func(yield func(int) bool) {
    for i := 1; i <= 10; i++ {
        if !yield(i) { return }
    }
}
even := filterIter(src, func(i int) bool { return i%2 == 0 })
scaled := mapIter(even, func(i int) int { return i * 10 })

for v := range scaled {
    fmt.Println(v) // 20 40 60 80 100
}
```

注意组合的**惰性**：`scaled` 不会先把全部算出来，而是每次 `yield` 时沿着 `mapIter → filterIter → src` 反向拉一个值。trpc-agent-go 的模型装饰器链正是这么干的。

### 6. 迭代器 vs channel：什么时候用哪个

| 维度 | `iter.Seq`（迭代器） | `<-chan T`（channel） |
|------|---------------------|----------------------|
| **goroutine 开销** | 无，在调用方 goroutine 内运行 | 通常需要一个生产者 goroutine |
| **调度开销** | 函数调用级别，极低 | channel 收发涉及运行时调度 |
| **取消语义** | `yield` 返回 `false` 即停止 | `ctx.Done()` 或 close channel |
| **跨 goroutine** | 不能，单 goroutine 内 | 天然支持跨 goroutine |
| **多生产者** | 不直接支持 | 多个 goroutine 往同一 channel 发 |
| **典型场景** | 同步遍历、惰性序列、装饰器管道 | 异步流式、多生产者、跨 goroutine 通信 |

一句话：**不需要跨 goroutine 时，迭代器比 channel 更轻**。trpc-agent-go 的策略是：底层模型调用用迭代器（同步、单 goroutine、可组合），上层 Agent 间通信用 channel（异步、跨 goroutine）。

## 在 trpc-agent-go 里

### 1. 框架自定义的 `Seq` 类型

trpc-agent-go 定义了自己的迭代器类型（与标准库 `iter.Seq` 同构），见 `model/model.go:60`：

```go
// Seq is a callback-based sequence that yields values.
type Seq[T any] func(yield func(T) bool)
```

为什么自定义而不用 `iter.Seq`？因为框架要兼容 Go 1.21+，而 `iter` 包是 1.23 才进标准库的。这个自定义类型让框架在低版本 Go 也能编译（只是 range-over-func 语法在 1.23 前不可用）。

### 2. `IterModel`：迭代器驱动的流式模型接口

框架提供了一个可选的 `Model` 扩展接口，用迭代器取代 channel 来流式产出响应，见 `model/model.go:63-70`：

```go
// IterModel is an optional extension of Model that streams responses in the caller goroutine.
// When implemented, flows may prefer this method to reduce goroutine and channel scheduling overhead.
// Implementations should yield *Response values, including API-level and stream-level errors encoded in Response.Error.
// The returned error is reserved for failures that prevent creating the iterator.
type IterModel interface {
    Model
    GenerateContentIter(ctx context.Context, request *Request) (Seq[*Response], error)
}
```

注释说得很直白：**在调用方 goroutine 里流式产出，减少 goroutine 和 channel 调度开销**。错误也编码进 `Response.Error` 一起 yield，返回的 error 只表示「连迭代器都建不起来」的致命错误。

### 3. 真实实现：OpenAI provider

`model/openai/openai.go:515` 实现了 `GenerateContentIter`，返回一个闭包，内部按需 yield 每个 chunk：

```go
func (m *Model) GenerateContentIter(
    ctx context.Context,
    request *model.Request,
) (model.Seq[*model.Response], error) {
    chatRequest, opts, err := m.prepareChatRequest(ctx, request)
    if err != nil {
        return nil, err // 建迭代器就失败 → 返回 error
    }
    return func(yield func(*model.Response) bool) {
        reporter := modeltelemetry.StartChat(ctx, m, request, m.chatTelemetry)
        defer reporter.End() // yield 链路结束（含 break）→ 自动收尾
        // ...
        emit := func(resp *model.Response) bool {
            if ctx.Err() != nil {
                return false // ctx 取消 → 停止 yield
            }
            reporter.TrackResponse(resp)
            return yield(resp) // 把 resp 交给 for 循环，返回是否继续
        }
        // ... 遍历底层 HTTP 流，逐 chunk 调用 emit ...
    }, nil
}
```

注意几个细节：

- `defer reporter.End()` 保证了无论调用方 break 还是正常结束，telemetry 都会收尾——这正是前面讲的「迭代器隐式清理」优势
- `emit` 闭包同时检查 `ctx.Err()` 和 `yield` 返回值，把「ctx 取消」和「调用方 break」统一成「停止 yield」
- 整个流式消费**没有新建 goroutine**，比 `<-chan *Response` 省掉生产者 goroutine + channel 同步

调用方这样消费：

```go
seq, err := model.GenerateContentIter(ctx, req)
if err != nil { /* 致命错误 */ }
for resp := range seq { // range-over-func，在自己 goroutine 里
    if resp.Error != nil { /* 流内错误，继续或 break */ }
    handleChunk(resp)
}
```

### 4. 装饰器组合：hedge / failover

trpc-agent-go 的对冲模型（hedge）、故障转移模型（failover）就是用迭代器组合实现的——它们**包装**上游模型的迭代器，在外层迭代器里决定「yield 哪个上游的结果」。

`model/failover/failover.go:95` 的故障转移模型：

```go
func (m *failoverModel) GenerateContentIter(
    ctx context.Context,
    request *model.Request,
) (model.Seq[*model.Response], error) {
    // ... 准备首个候选 ...
    return func(yield func(*model.Response) bool) {
        m.runAttempts(ctx, request, initialAttempt, yield)
    }, nil
}
```

`runAttempts` 内部会依次尝试候选模型，每个候选返回一个 `model.Seq[*Response]`（注意是 `Seq` 不是 channel），失败就切下一个，成功就把那个迭代器的 yield 透传给外层 `yield`。这本质上是「**迭代器套迭代器**」——外层迭代器决定用哪个内层迭代器，内层迭代器负责真正的流式产出。

`model/hedge/hedge.go:158` 的对冲模型同理：

```go
return func(yield func(*model.Response) bool) {
    m.runHedge(ctx, request, yield)
}, nil
```

`runHedge` 会并行启动多个上游请求（goroutine），但**收敛到一个 yield**——把最快返回有效结果的那个流的 chunk 透传出去。这是「跨 goroutine 收集 + 单 goroutine yield」的混合模式。

### 5. LLM 执行流里的迭代器串联

`internal/flow/llmflow/llmflow.go:2146` 是 LLMAgent 执行的核心，它把「before 回调 → 模型调用 → after 回调」串成一个迭代器管道：

```go
ctx, customResp, err := f.runBeforeModelCallbacks(ctx, invocation, llmRequest)
if err != nil {
    return ctx, nil, err
}
if customResp != nil {
    // before 回调短路返回了响应 → 用一个单元素迭代器包装
    return ctx, func(yield func(*model.Response) bool) {
        yield(customResp)
    }, nil
}
// 正常路径：拿到模型的 Seq，可能再套一层 after 回调的转换
seq, err := f.generateContentSeq(ctx, invocation, llmRequest, callModel)
if err != nil {
    return ctx, nil, err
}
return ctx, seq, nil
```

注意 `if customResp != nil` 分支：before 回调想短路时，框架用一个「只 yield 一次」的迭代器把那个响应包成流式接口——**对外接口统一是 `Seq[*Response]`**，调用方不需要区分「真流式」和「假流式」。

### 6. Graph 里的迭代器

`graph/state_graph.go:1915` 也用迭代器包装单条响应，让图节点的输出和流式输出共用同一接口：

```go
func singleResponseStream(response *model.Response) modelResponseStream {
    return modelResponseStream{
        Seq: func(yield func(*model.Response) bool) {
            yield(response) // 只 yield 一次的单元素迭代器
        },
    }
}
```

这是「单元素迭代器」的最简形态——一个不想流式但被迫塞进流式接口的响应，就用这种「yield 一次就 return」的迭代器冒充。

## 常见陷阱

### ❌ 把迭代器当 channel 用，期待它跨 goroutine

```go
seq, _ := model.GenerateContentIter(ctx, req)
go func() {
    for resp := range seq { // ❌ 迭代器函数会在「这个」goroutine 里执行
        handle(resp)
    }
}()
// 主 goroutine 无法安全地「同时」消费同一个 seq
```

迭代器**不是并发安全的流**。它只是一个函数，谁 range 它、它就在谁的 goroutine 里跑。需要跨 goroutine 流式时，用 channel（trpc-agent-go 的 Agent.Run 返回 `<-chan *event.Event` 就是这个原因）。

### ❌ 迭代器函数里 yield 之后还继续干重活

```go
// ❌ yield 返回 false（调用方 break 了）却不检查，继续做无用功
func badIter(yield func(int) bool) {
    for i := 0; i < 1000000; i++ {
        yield(i)         // 调用方早 break 了
        expensiveWork(i) // 还在傻跑
    }
}
```

```go
// ✅ 检查 yield 返回值，false 就立即停止
func goodIter(yield func(int) bool) {
    for i := 0; i < 1000000; i++ {
        if !yield(i) {
            return // 调用方不想要了，立刻退出
        }
    }
}
```

这也是 `openai.go` 的 `emit` 闭包里 `return yield(resp)` 的原因——透传调用方的「继续/停止」信号。

### ❌ 在迭代器函数里启动 goroutine 却不等待它结束

```go
// ❌ 启动了 goroutine，迭代器 return 后 goroutine 还在跑，可能访问已释放资源
func badStream(yield func(*Resp) bool) {
    ch := make(chan *Resp)
    go produce(ch) // 这个 goroutine 在迭代器 return 后继续跑
    for r := range ch {
        if !yield(r) { return }
    }
}
```

```go
// ✅ 要么不用 goroutine（迭代器本来就是单 goroutine 的），要么确保 goroutine 在迭代器 return 前退出
func goodStream(yield func(*Resp) bool) {
    ch := make(chan *Resp)
    ctx, cancel := context.WithCancel(context.Background())
    defer cancel() // 迭代器 return → cancel → 生产 goroutine 收到信号退出
    go produce(ctx, ch)
    for {
        select {
        case <-ctx.Done():
            return
        case r, ok := <-ch:
            if !ok { return }
            if !yield(r) { return }
        }
    }
}
```

如果你发现自己在迭代器里写 goroutine + channel，**先停下来问自己**：是不是该直接用 channel 接口（`<-chan *Response`）而不是迭代器？trpc-agent-go 的 hedge 模型是少数合理这样做的场景，因为它要并行打多个请求再收敛。

### ❌ 误以为 range-over-func 在所有 Go 版本可用

range-over-func 是 **Go 1.23+** 引入的。trpc-agent-go 的 `go.mod` 声明 `go 1.21`，所以：

- **`model.Seq[T]` 类型本身**在 1.21 就能用（它只是个函数类型）
- **`for resp := range seq`**（range-over-func 语法）需要 1.23+

如果你的项目还卡在 1.21/1.22，要么升级到 1.23+，要么这些迭代器 API 对你不可见——请用 channel 版本的接口（如 `Model.GenerateContent` 返回 `<-chan`）。框架通过 build tag 在低版本降级到 channel 实现。

### ❌ 混淆「yield 单元素」和「返回 slice」

```go
// ❌ 把所有结果先收集成 slice 再返回——丢掉了惰性
func collectAll(src model.Seq[*Response]) []*Response {
    var all []*Response
    all = append(all, ...) // 必须先全部跑完
    return all
}
```

```go
// ✅ 用 range 透传，保持惰性
func passThrough(src model.Seq[*Response]) model.Seq[*Response] {
    return func(yield func(*Response) bool) {
        for r := range src {
            if !yield(r) { return }
        }
    }
}
```

迭代器的核心价值是**惰性**——消费者取一个才生产一个。如果你发现自己在迭代器里 `append` 收集全部，多半是用错了工具，应该直接用 slice。

## 小结

- range-over-func 让函数可以直接被 `for range`，是 Go 1.23+ 的迭代器语法
- 迭代器函数是个**闭包**，捕获要遍历的数据，通过 `yield` 回调把元素一个一个交给 `for` 循环
- `yield` 返回 `false` 表示调用方 `break`，迭代器必须立即 return 并清理资源（defer 会触发）
- 迭代器可以像管道一样组合（map/filter/包装），trpc-agent-go 的 hedge/failover 装饰器正是这么实现的
- 迭代器 vs channel：**单 goroutine、不需要跨线程通信时，迭代器更轻**；跨 goroutine 流式仍用 channel
- trpc-agent-go 用 `model.Seq[T]` 定义迭代器类型，`IterModel.GenerateContentIter` 用迭代器在调用方 goroutine 里流式产出响应，省掉生产者 goroutine
- 框架在 openai/hedge/failover/llmflow/graph 等多处复用迭代器抽象，统一了「真流式」和「单元素冒充流式」的接口

**延伸阅读**：

- [Go 官方：range-over-func 提案](https://go.dev/blog/range-functions)
- [Go 官方：iter 包文档](https://pkg.go.dev/iter)
- [并发模型与 Channel 事件流](./01-concurrency-channel)（对比 channel 与迭代器的取舍）
- [流式响应、SSE 与事件](./09-streaming-sse)（框架如何在迭代器与 channel 之间转换）
- [模型与提供商](../examples/13-model-provider/model.md)（hedge/failover 装饰器实战）
