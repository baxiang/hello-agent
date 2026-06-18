# 迭代器（range-over-func） — trpc-agent-go 的零成本流式抽象

> trpc-agent-go 在最底层的模型调用里用 `iter.Seq` 取代了部分 channel：`IterModel.GenerateContentIter` 返回一个 `Seq[*Response]`，调用方在**自己的 goroutine** 里 `for resp := range iter`，省掉了生产者 goroutine 和 channel 调度开销。不懂 Go 1.23+ 的 range-over-func，就读不懂框架为什么在流式场景下比「每个 Agent 一个 goroutine」更轻。

## 核心概念

Go 1.23 引入了 **range-over-func**：`for x := range f` 里的 `f` 可以是一个特定签名的函数，而不只是 slice/map/channel。这个函数叫做**迭代器函数**（iterator function）。

### 两种迭代器签名

```go
import "iter"

// 单值迭代器：每次 yield 一个 T
type Seq[T any] func(yield func(T) bool)

// 双值迭代器：每次 yield 一个 (K, V)
type Seq2[K, V any] func(yield func(K, V) bool)
```

关键点：

- **`yield` 是回调**：调用 `yield(v)` 把一个元素交给 `for` 循环。`for` 循环体本质上就是传给 `yield` 的函数。
- **`yield` 返回 `bool`**：返回 `false` 表示「消费者不想再要了」（`break` 了），迭代器函数应当立即停止 yield。
- **迭代器函数控制「何时生产」**：它按需一个一个 yield，天然惰性，不会一次性生成全部。

### 最小可运行示例

```go
package main

import "fmt"

// 一个迭代器函数：生成 n 个平方数
func squares(n int) func(yield func(int) bool) {
	return func(yield func(int) bool) {
		for i := 1; i <= n; i++ {
			if !yield(i * i) { // yield 返回 false → 调用方 break 了
				return
			}
		}
	}
}

func main() {
	// range-over-func：直接 range 一个函数
	for v := range squares(5) {
		fmt.Println(v) // 1 4 9 16 25
	}

	// 可以随时 break，迭代器会收到 yield=false 并停止
	for v := range squares(100) {
		if v > 10 {
			break // squares 在下一次 yield 时收到 false，立即 return
		}
		fmt.Println(v)
	}
}
```

### 迭代器 vs channel：什么时候用哪个

| 维度 | `iter.Seq`（迭代器） | `<-chan T`（channel） |
|------|---------------------|----------------------|
| **goroutine 开销** | 无，在调用方 goroutine 内运行 | 通常需要一个生产者 goroutine |
| **调度开销** | 函数调用级别，极低 | channel 收发涉及运行时调度 |
| **取消语义** | `yield` 返回 `false` 即停止 | `ctx.Done()` 或 close channel |
| **跨 goroutine** | 不能，单 goroutine 内 | 天然支持跨 goroutine |
| **典型场景** | 同步遍历、惰性序列、转换管道 | 异步流式、多生产者、跨 goroutine 通信 |

一句话：**不需要跨 goroutine 时，迭代器比 channel 更轻**。

## 在 trpc-agent-go 里

### 1. 框架自定义的 `Seq` 类型

trpc-agent-go 定义了自己的迭代器类型（与标准库 `iter.Seq` 同构），见 `model/model.go:60`：

```go
// Seq is a callback-based sequence that yields values.
type Seq[T any] func(yield func(T) bool)
```

### 2. `IterModel`：迭代器驱动的流式模型接口

框架提供了一个可选的 `Model` 扩展接口，用迭代器取代 channel 来流式产出响应，见 `model/model.go:63-70`：

```go
// IterModel is an optional extension of Model that streams responses in the caller goroutine.
// When implemented, flows may prefer this method to reduce goroutine and channel scheduling overhead.
type IterModel interface {
    Model
    GenerateContentIter(ctx context.Context, request *Request) (Seq[*Response], error)
}
```

注释说得很直白：**在调用方 goroutine 里流式产出，减少 goroutine 和 channel 调度开销**。这就是迭代器相比 channel 的核心价值——流式场景下省掉一个生产者 goroutine。

### 3. 真实实现：OpenAI provider

`model/openai/openai.go:515` 实现了 `GenerateContentIter`，返回一个迭代器函数，内部按需 yield 每个 chunk：

```go
func (m *Model) GenerateContentIter(
    ctx context.Context,
    request *model.Request,
) (model.Seq[*model.Response], error) {
    chatRequest, opts, err := m.prepareChatRequest(ctx, request)
    if err != nil {
        return nil, err
    }
    return func(yield func(*model.Response) bool) {
        // ... 初始化 telemetry、回调 ...
        emit := func(resp *model.Response) bool {
            if ctx.Err() != nil {
                return false // ctx 取消 → 停止 yield
            }
            return yield(resp) // 把 resp 交给 for 循环，返回是否继续
        }
        // ... 遍历底层流，逐个调用 emit/yield ...
    }, nil
}
```

调用方这样消费（概念示例）：

```go
seq, err := model.GenerateContentIter(ctx, req)
// ...
for resp := range seq { // range-over-func，在自己 goroutine 里
    handleChunk(resp)
}
```

整个过程**没有新建 goroutine**，比 `<-chan *Response` 省掉生产者 goroutine + channel 同步。

### 4. 其它迭代器用法

框架在多处用到迭代器抽象：

- **`model/hedge/hedge.go:158`、`model/failover/failover.go:95`**：对冲/故障转移模型用迭代器包装上游响应
- **`tool/openapi/operation.go:293`**：`methodOperations` 用 `iter.Seq2[string, *Operation]` 遍历 OpenAPI 的 path-item
- **`internal/flow/llmflow/llmflow.go:2146`**：LLM 执行流核心用迭代器串联多步响应

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

迭代器**不是并发安全的流**。它只是一个函数，谁 range 它、它就在谁的 goroutine 里跑。需要跨 goroutine 流式时，用 channel。

### ❌ 迭代器函数里 yield 之后还继续干重活

```go
// ❌ yield 返回 false（调用方 break 了）却不检查，继续做无用功
func badIter(yield func(int) bool) {
    for i := 0; i < 1000000; i++ {
        yield(i)           // 调用方早 break 了
        expensiveWork(i)   // 还在傻跑
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

### ❌ 忘记 `iter` 包的存在

```go
// ❌ 直接写 func(yield func(T) bool)，到处重复签名
```

```go
// ✅ 用标准库类型，统一可读
import "iter"
type mySeq iter.Seq[int]
```

trpc-agent-go 因为历史原因用自己定义的 `model.Seq[T]`（与 `iter.Seq` 同构），但你自己的代码里优先用标准库 `iter` 包。

### ❌ 误以为 range-over-func 在所有 Go 版本可用

range-over-func 是 **Go 1.23+** 引入的。trpc-agent-go 的 `go.mod` 声明 `go 1.21`，但实际使用了迭代器的代码路径只在 `go 1.23+` 构建时生效（通过 build tag 或仅在 1.23+ 编译）。如果你的项目还卡在 1.21/1.22，要么升级，要么这些迭代器 API 对你不可见——请用 channel 版本的接口（如 `Model.GenerateContent` 返回 `<-chan`）。

## 小结

- range-over-func 让函数可以直接被 `for range`，是 Go 1.23+ 的迭代器语法
- 迭代器 vs channel：**单 goroutine、不需要跨线程通信时，迭代器更轻**；跨 goroutine 流式仍用 channel
- trpc-agent-go 用 `model.Seq[T]` 定义迭代器类型，`IterModel.GenerateContentIter` 用迭代器在调用方 goroutine 里流式产出响应，省掉生产者 goroutine
- `yield` 返回 `false` 表示调用方 `break`，迭代器函数必须检查并立即停止
- 框架在 hedge/failover/openapi/llmflow 等多处复用迭代器抽象

**延伸阅读**：

- [Go 官方：range-over-func 提案](https://go.dev/blog/range-functions)
- [Go 官方：iter 包文档](https://pkg.go.dev/iter)
- [并发模型与 Channel 事件流](./01-concurrency-channel)（对比 channel 与迭代器的取舍）
- [流式响应、SSE 与事件](./09-streaming-sse)（框架如何在迭代器与 channel 之间转换）
