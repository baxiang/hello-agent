# 迭代器（range-over-func） — trpc-agent-go 的零成本流式抽象

> 如果你写过 `for v := range []int{1,2,3}`，就能学会迭代器。本文从最熟悉的 for 循环出发，用 8 个可运行代码示例，一步步带你演化到 trpc-agent-go 在底层用 `iter.Seq` 流式产出 LLM 响应的原理。看懂这篇，你就明白框架为什么能用更少的 goroutine 处理流式输出。

## 核心概念

### 起点：你已经会「迭代」了

如果你写过这两种遍历，你已经在用「迭代」：

```go
package main

import "fmt"

func main() {
    // 写法 A：经典三段式 for
    nums := []int{10, 20, 30}
    for i := 0; i < len(nums); i++ {
        fmt.Println(nums[i])
    }

    // 写法 B：range 一个 slice
    for _, v := range nums {
        fmt.Println(v)
    }
}
```

输出：
```
10
20
30
10
20
30
```

这两种写法都在「迭代」——一个一个地取出元素。**迭代器就是把这种「一个一个取」的能力，封装成一个可以传来传去的函数**。

### 痛点 1：想把遍历装进函数，怎么办？

假设你要写一个「生成 N 个平方数」的功能。最直觉的写法是返回一个 slice：

```go
package main

import "fmt"

// 生成 1 到 n 的平方数，装进 slice 返回
func squaresSlice(n int) []int {
    result := make([]int, 0, n)
    for i := 1; i <= n; i++ {
        result = append(result, i*i)
    }
    return result
}

func main() {
    for _, v := range squaresSlice(5) {
        fmt.Println(v)
    }
}
```

输出：
```
1
4
9
16
25
```

**问题来了**：如果 `n` 是 100 万呢？你得先把 100 万个数全算出来、装进 slice、占满内存，然后才开始打印第一个。

**想要的能力**：能不能「算一个、打印一个」，不要一次性全算出来？这就是迭代器要解决的——**惰性求值**（lazy evaluation）。

### 演化 1：用回调函数「交出」每个值

在没有迭代器语法之前，Go 程序员用「回调函数」模拟惰性：

```go
package main

import "fmt"

// squaresCallback 不返回 slice，而是「每算出一个就调用一次 yield」
// yield 参数传回调函数，由调用方决定怎么处理
func squaresCallback(n int, yield func(int) bool) {
    for i := 1; i <= n; i++ {
        if !yield(i * i) { // 把平方数「交出」给调用方
            return // yield 返回 false → 调用方说「不要了」，立即停止
        }
    }
}

func main() {
    // 调用方传入一个回调函数，定义「拿到值后干什么」
    squaresCallback(5, func(v int) bool {
        fmt.Println(v)
        return true // true = 继续给我下一个
    })

    fmt.Println("---")

    // 也可以提前停止：只要回调返回 false
    squaresCallback(100, func(v int) bool {
        if v > 30 {
            return false // 不要了！
        }
        fmt.Println(v)
        return true
    })
}
```

输出：
```
1
4
9
16
25
---
1
4
9
16
25
```

**这就是迭代器的核心思想**！`yield(v)` 把值交给调用方，`yield` 返回 `false` 表示「我不要了，停止」。

但写起来有点啰嗦：每次都要传一个 `func(v int) bool { ... }`。而且没法用 `for v := range ...` 这种优雅语法。

### 演化 2：Go 1.23 的 iter.Seq 类型

Go 1.23 把上面的模式标准化了。标准库 `iter` 包定义了两个类型：

```go
package iter

// Seq：单值迭代器（像 range slice）
type Seq[T any] func(yield func(T) bool)

// Seq2：双值迭代器（像 range map，有 key 和 value）
type Seq2[K, V any] func(yield func(K, V) bool)
```

**关键理解**：`Seq[T]` 不是一个普通函数，它是一个**函数类型**。任何「接收 `yield func(T) bool` 参数」的函数，都自动是 `Seq[T]`。

把上面的 `squaresCallback` 改造成 `iter.Seq` 风格：

```go
package main

import "fmt"

// squares 返回一个「迭代器函数」
// 注意：返回值是一个函数，不是 slice
func squares(n int) func(yield func(int) bool) {
    return func(yield func(int) bool) {
        for i := 1; i <= n; i++ {
            if !yield(i * i) {
                return
            }
        }
    }
}

func main() {
    // 拿到迭代器函数
    iter := squares(5)

    // 手动调用它，传入「怎么处理每个值」
    iter(func(v int) bool {
        fmt.Println(v)
        return true
    })
}
```

输出：
```
1
4
9
16
25
```

看起来跟演化 1 差不多？是的——**只是把回调拆成了两步**：先 `squares(n)` 返回迭代器函数，再调用它传 yield。好处是迭代器可以「存起来、传来传去、组合」。

### 演化 3：range-over-func 语法糖（Go 1.23+）

Go 1.23 给了终极语法糖：可以直接 `for v := range 迭代器函数`！

```go
package main

import "fmt"

func squares(n int) func(yield func(int) bool) {
    return func(yield func(int) bool) {
        for i := 1; i <= n; i++ {
            if !yield(i * i) {
                return
            }
        }
    }
}

func main() {
    // ✨ Go 1.23+ 魔法：直接 range 一个函数！
    for v := range squares(5) {
        fmt.Println(v)
    }

    fmt.Println("---")

    // break 也能用：迭代器会收到 yield=false 并停止
    for v := range squares(100) {
        if v > 20 {
            break
        }
        fmt.Println(v)
    }
}
```

输出：
```
1
4
9
16
25
---
1
4
9
16
```

**这就是 range-over-func**。`for v := range f` 里的 `f` 现在可以是：
- slice / map / channel（旧功能）
- **迭代器函数**（新功能，签名是 `func(yield func(T) bool)`）

底层编译器会自动帮你把循环体包装成 `yield` 回调传给 `f`。

### 进阶 1：提前退出与资源清理

迭代器的一个杀手锏：**调用方 break 时，迭代器函数的 defer 会自动执行**。这点比 channel 安全得多。

看一个读文件的例子：

```go
package main

import (
    "bufio"
    "fmt"
    "os"
    "strings"
)

// lines 返回一个读文件每一行的迭代器
func lines(path string) func(yield func(string) bool) {
    return func(yield func(string) bool) {
        f, err := os.Open(path)
        if err != nil {
            return
        }
        defer f.Close() // ⭐ 无论怎么退出，文件都会关闭

        sc := bufio.NewScanner(f)
        for sc.Scan() {
            if !yield(sc.Text()) {
                return // 调用方 break → return → defer f.Close() 触发
            }
        }
    }
}

func main() {
    // 假设有个测试文件
    content := "line1\nline2\nline3\nSTOP\nline5\nline6"
    os.WriteFile("/tmp/test.txt", []byte(content), 0644)

    // 找到 STOP 就停
    for line := range lines("/tmp/test.txt") {
        fmt.Println("读到:", line)
        if strings.TrimSpace(line) == "STOP" {
            break // 文件仍然会被正确关闭！
        }
    }
    fmt.Println("结束，文件已关闭")
}
```

输出：
```
读到: line1
读到: line2
读到: line3
读到: STOP
结束，文件已关闭
```

**对比 channel 方案**：如果用 channel，调用方 break 后生产者 goroutine 还在往已关闭的 channel 发数据会 panic；不 drain 干净会 goroutine 泄漏。迭代器没这个问题——**单 goroutine，defer 一定执行**。

### 进阶 2：组合成管道

迭代器函数可以像 Unix 管道一样串起来：`map` 转换、`filter` 过滤。

```go
package main

import "fmt"

// 生成 1 到 n 的整数
func counter(n int) func(yield func(int) bool) {
    return func(yield func(int) bool) {
        for i := 1; i <= n; i++ {
            if !yield(i) {
                return
            }
        }
    }
}

// filter：只保留满足条件的元素
func filter(src func(yield func(int) bool), ok func(int) bool) func(yield func(int) bool) {
    return func(yield func(int) bool) {
        for v := range src { // 消费上游迭代器
            if ok(v) {
                if !yield(v) {
                    return
                }
            }
        }
    }
}

// map：转换每个元素
func mapIter(src func(yield func(int) bool), fn func(int) int) func(yield func(int) bool) {
    return func(yield func(int) bool) {
        for v := range src {
            if !yield(fn(v)) {
                return
            }
        }
    }
}

func main() {
    // 管道：1-10 → 只留偶数 → 每个乘 10
    src := counter(10)
    evens := filter(src, func(i int) bool { return i%2 == 0 })
    scaled := mapIter(evens, func(i int) int { return i * 10 })

    for v := range scaled {
        fmt.Println(v) // 20 40 60 80 100
    }
}
```

输出：
```
20
40
60
80
100
```

**关键点**：`scaled` 不会先把 1-10 全过滤完再乘 10。它是**惰性**的——`for v := range scaled` 每取一个值，就沿着 `mapIter → filter → counter` 反向拉一个。这正是 trpc-agent-go 模型装饰器的工作方式。

### 对比：迭代器 vs channel，什么时候用哪个

| 场景 | 用迭代器 | 用 channel |
|------|---------|-----------|
| 遍历已知数据（文件行、slice） | ✅ | ❌ 杀鸡用牛刀 |
| 同步转换/过滤数据流 | ✅ | ❌ |
| 单个 goroutine 内消费 | ✅ | ❌ |
| 跨 goroutine 异步通信 | ❌ | ✅ |
| 多个生产者往同一流塞数据 | ❌ | ✅ |
| 调用方可能提前 break | ✅（defer 自动清理）| ⚠️（要小心 drain）|

**一句话**：同一个 goroutine 里干活，迭代器更轻；要跨 goroutine，channel 更合适。

## 在 trpc-agent-go 里

现在你已经理解迭代器了。来看 trpc-agent-go 怎么用它。

### 1. 框架自定义的 `Seq` 类型

trpc-agent-go 定义了自己的迭代器类型（和标准库 `iter.Seq` 一模一样），见 `model/model.go:60`：

```go
// Seq is a callback-based sequence that yields values.
type Seq[T any] func(yield func(T) bool)
```

**为什么不用标准库 `iter.Seq`？** 因为框架要兼容 Go 1.21，而 `iter` 包是 1.23 才有的。这个自定义类型让框架在低版本也能编译。

### 2. `IterModel`：用迭代器流式产出 LLM 响应

框架提供了一个**可选**的模型接口，用迭代器取代 channel 来流式返回响应。见 `model/model.go:63`：

```go
// IterModel 在调用方的 goroutine 里流式产出响应，
// 减少 goroutine 和 channel 的调度开销。
type IterModel interface {
    Model
    GenerateContentIter(ctx context.Context, request *Request) (Seq[*Response], error)
}
```

**这段注释是理解框架的关键**：传统的 `GenerateContent` 返回 `<-chan *Response`，需要一个生产者 goroutine 往 channel 里塞。而 `GenerateContentIter` 返回 `Seq[*Response]`（迭代器），调用方在自己的 goroutine 里 `for resp := range seq` 就能消费——**没有额外的 goroutine**。

### 3. 真实实现：OpenAI provider（简化版）

`model/openai/openai.go:515` 实现了 `GenerateContentIter`。下面是简化后的核心逻辑：

```go
// 简化版：展示迭代器如何流式产出
func (m *Model) GenerateContentIter(
    ctx context.Context,
    request *model.Request,
) (model.Seq[*model.Response], error) {
    chatRequest, err := m.prepareChatRequest(ctx, request)
    if err != nil {
        return nil, err // 建迭代器就失败 → 返回 error
    }
    // 返回一个迭代器函数（闭包，捕获了 chatRequest）
    return func(yield func(*model.Response) bool) {
        // ... 打开 HTTP 流、初始化 telemetry ...

        // emit 是内部辅助：把一个 chunk yield 出去
        emit := func(resp *model.Response) bool {
            if ctx.Err() != nil {
                return false // ctx 取消 → 停止
            }
            return yield(resp) // 交给 for 循环，返回是否继续
        }

        // 遍历 HTTP 响应流的每个 chunk
        for chunk := range httpClient.Stream(chatRequest) {
            resp := parseChunk(chunk)
            if !emit(resp) {
                return // 调用方 break 或 ctx 取消 → 停止
            }
        }
    }, nil
}
```

调用方这样用（伪代码）：

```go
seq, err := openaiModel.GenerateContentIter(ctx, req)
if err != nil {
    // 致命错误，连迭代器都建不起来
}

// 在「自己的」goroutine 里消费，没有新建 goroutine
for resp := range seq {
    fmt.Print(resp.Choices[0].Delta.Content) // 逐 token 打印
}
// 循环结束 = 流结束（或 break）
```

### 4. 装饰器：hedge / failover（进阶，可跳过）

trpc-agent-go 的对冲模型（hedge）、故障转移模型（failover）用迭代器**包装**上游模型，实现组合。这是「迭代器套迭代器」的模式。

`model/failover/failover.go:95` 简化逻辑：

```go
func (m *failoverModel) GenerateContentIter(...) (model.Seq[*Response], error) {
    return func(yield func(*model.Response) bool) {
        for _, candidate := range m.models {
            seq, err := candidate.GenerateContentIter(ctx, req)
            if err != nil {
                continue // 这个候选连不上，试下一个
            }
            // 把这个候选的迭代器透传给外层 yield
            ok := true
            for resp := range seq {
                if !yield(resp) {
                    return // 调用方 break
                }
                if resp.Error != nil {
                    ok = false
                    break // 这个候选出错了，换下一个
                }
            }
            if ok {
                return // 成功完成，不再试下一个
            }
        }
    }, nil
}
```

**关键理解**：外层迭代器（failover 的）决定「用哪个内层迭代器」，内层迭代器（单个模型的）负责真正流式产出。这就是「迭代器组合」的威力——接口统一是 `Seq[*Response]`，但内部可以层层包装。

### 5. 其它用到迭代器的地方

框架在多处复用迭代器抽象：

- **`model/hedge/hedge.go:158`**：对冲模型，并行打多个请求，取最快返回的
- **`tool/openapi/operation.go:293`**：遍历 OpenAPI 的 path-item（`iter.Seq2[string, *Operation]`）
- **`internal/flow/llmflow/llmflow.go:2146`**：LLM 执行流，串联 before 回调 → 模型 → after 回调
- **`graph/state_graph.go:1915`**：图节点输出，用单元素迭代器让非流式响应冒充流式

## 常见陷阱

### ❌ 把迭代器当 channel 用，期待跨 goroutine

```go
seq, _ := model.GenerateContentIter(ctx, req)
go func() {
    for resp := range seq { // ❌ 迭代器函数会在「这个」goroutine 里执行
        handle(resp)
    }
}()
// 主 goroutine 和子 goroutine 不能同时消费同一个 seq
```

迭代器**不是并发安全的流**。它只是一个函数，谁 range 它、它就在谁的 goroutine 里跑。需要跨 goroutine 时用 channel（`Agent.Run` 返回 `<-chan *event.Event` 就是这个原因）。

### ❌ yield 返回 false 后还继续干重活

```go
// ❌ 不检查返回值，调用方 break 了还在傻跑
func badIter(yield func(int) bool) {
    for i := 0; i < 1000000; i++ {
        yield(i)         // 调用方早 break 了
        expensiveWork(i) // 还在做无用功
    }
}
```

```go
// ✅ 检查返回值，false 就立刻停
func goodIter(yield func(int) bool) {
    for i := 0; i < 1000000; i++ {
        if !yield(i) {
            return
        }
    }
}
```

这也是 `openai.go` 里 `emit` 闭包写成 `return yield(resp)` 的原因。

### ❌ 在迭代器里启动 goroutine 却不管理它

```go
// ❌ 迭代器 return 了，goroutine 还在跑，可能访问已释放的资源
func badStream(yield func(*Resp) bool) {
    go produceInBg(...) // 这个 goroutine 在迭代器 return 后继续跑
    for r := range ch {
        if !yield(r) { return }
    }
}
```

```go
// ✅ 要么不用 goroutine，要么确保它随迭代器退出而退出
func goodStream(yield func(*Resp) bool) {
    ctx, cancel := context.WithCancel(context.Background())
    defer cancel() // 迭代器 return → cancel → goroutine 收到信号退出
    go produce(ctx, ch)
    for r := range ch {
        if !yield(r) { return }
    }
}
```

如果你发现自己在迭代器里写 goroutine + channel，**先停下来问**：是不是直接用 channel 接口更合适？

### ❌ 误以为 range-over-func 在所有 Go 版本可用

range-over-func 是 **Go 1.23+** 的特性。

- **`model.Seq[T]` 类型本身**在 Go 1.21 就能用（它只是个普通函数类型）
- **`for resp := range seq`**（range-over-func 语法）需要 **Go 1.23+**

如果你的项目还在 Go 1.21/1.22，用 channel 版本的接口（`Model.GenerateContent` 返回 `<-chan`）即可。

### ❌ 把迭代器当成「收集所有结果」的工具

```go
// ❌ 丢掉了惰性，相当于退化成 slice
func collectAll(src model.Seq[*Response]) []*Response {
    var all []*Response
    for r := range src {
        all = append(all, r) // 先全部跑完
    }
    return all
}
```

迭代器的核心价值是**惰性**——取一个算一个。如果你要全部结果，直接让函数返回 slice 更清晰。

## 小结

- 迭代器 = 把「一个一个取元素」的能力封装成函数，可以传来传去、可以组合
- Go 1.23 的 range-over-func 让你能直接 `for v := range 迭代器函数`
- `yield(v)` 把值交给调用方，返回 `false` 表示调用方 break 了，迭代器要立即停止
- 调用方 break 时，迭代器函数的 `defer` 会自动执行——资源清理比 channel 安全
- 迭代器可以像管道组合（map/filter），trpc-agent-go 的 hedge/failover 正是这么做的
- **迭代器 vs channel**：同一 goroutine 用迭代器更轻；跨 goroutine 用 channel
- trpc-agent-go 用 `model.Seq[T]` 类型，`IterModel.GenerateContentIter` 在调用方 goroutine 里流式产出，省掉生产者 goroutine

**延伸阅读**：

- [Go 官方：range-over-func 提案](https://go.dev/blog/range-functions)
- [Go 官方：iter 包文档](https://pkg.go.dev/iter)
- [并发模型与 Channel 事件流](./01-concurrency-channel)（对比 channel 与迭代器的取舍）
- [流式响应、SSE 与事件](./09-streaming-sse)（框架如何在迭代器与 channel 之间转换）
- [模型与提供商](../examples/13-model-provider/model.md)（hedge/failover 装饰器实战）
