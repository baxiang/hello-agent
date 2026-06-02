# Go 迭代器（iter.Seq2）— 从零掌握 ADK-Go 的核心协议

> 学习路线：闭包基础 → 迭代器构造 → 消费与控制 → 组合与嵌套 → ADK 源码实战 → 常见陷阱

## 1. 前置：理解闭包

写迭代器本质上是在写一个**返回闭包的函数**。如果对闭包不熟，后面全是天书。先花 3 分钟搞懂。

### 1.1 什么是闭包

闭包 = 函数 + 它引用的外部变量。函数"捕获"了创建时所在作用域的变量，即使外部函数已经返回，这些变量依然存活。

```go
func counter(start int) func() int {
    // start 被捕获进闭包
    return func() int {
        start++  // 每次调用修改的是同一个 start
        return start
    }
}

c := counter(10)
fmt.Println(c()) // 11
fmt.Println(c()) // 12
fmt.Println(c()) // 13
```

三次调用操作的是**同一个** `start` 变量，这就是闭包的核心——函数绑定了变量，变量不随外部函数返回而销毁。

### 1.2 闭包在迭代器中的角色

看看迭代器的类型定义：

```go
type Seq2[K, V any] func(yield func(K, V) bool)
```

展开理解：`Seq2[int, error]` 就是一个函数类型，它接收一个 `yield` 回调，本身没有返回值。迭代器**本身就是**一个闭包：

```
构造迭代器：return func(yield func(K, V) bool) { ... }
              ↑                                    ↑
              闭包函数                             闭包体通过 yield 产出数据
```

这个闭包捕获了构造时的参数（比如要迭代的数据），被调用时通过 `yield` 把数据推给消费方。

---

## 2. 从零构建第一个迭代器

不急着看 ADK 源码。先写一个最简单的迭代器，理解"谁调用了谁"。

### 2.1 最简迭代器：产出 3 条消息

```go
func threeMessages() iter.Seq2[string, error] {
    return func(yield func(string, error) bool) {
        yield("hello", nil)   // 产出第 1 条
        yield("world", nil)   // 产出第 2 条
        yield("done",  nil)   // 产出第 3 条
    }
}

// 使用
for msg, err := range threeMessages() {
    fmt.Println(msg)
}
// 输出:
// hello
// world
// done
```

### 2.2 逐行追溯：到底谁调谁？

这是初学者最大的困惑。`for msg, err := range threeMessages()` 一行代码背后发生了什么：

```
步骤 1：threeMessages() 调用
  → 返回一个闭包 func(yield func(string,error) bool) { ... }
  → 此时闭包体内的代码一行都还没执行！

步骤 2：for-range 启动迭代
  → Go 编译器自动生成一个 yield 函数：
      func(msg string, err error) bool {
          // 执行循环体
          fmt.Println(msg)
          return true  // 表示"继续迭代"
      }
  → 把这个 yield 函数作为参数传给闭包

步骤 3：闭包开始执行
  → yield("hello", nil) 被调用
      → 控制权交给 for-range 的循环体
      → fmt.Println("hello") 执行
      → 循环体返回 true（继续）
      → 控制权回到闭包，继续往下走

步骤 4：yield("world", nil) → 同上

步骤 5：yield("done", nil) → 同上

步骤 6：闭包函数执行完毕，for-range 自动退出
```

**核心理解**：`for-range` 和闭包是**交替执行**的——闭包通过 `yield` 交出控制权，循环体处理完再还回来。就像乒乓球，你来我往。

### 2.3 写成循环形式

上面的迭代器手动写了 3 次 yield，实际场景是循环：

```go
func messagesFromSlice(msgs []string) iter.Seq2[string, error] {
    return func(yield func(string, error) bool) {
        for _, msg := range msgs {
            if !yield(msg, nil) {
                return  // 消费方喊停，立即退出
            }
        }
    }
}

// 使用
msgs := []string{"hello", "world", "done"}
for msg, err := range messagesFromSlice(msgs) {
    fmt.Println(msg)
}
```

执行追踪（假设 msgs = ["hello", "world", "done"]）：

```
messagesFromSlice(msgs) 返回闭包（msgs 被捕获）
for-range 创建 yield 函数，调用闭包
  → 循环 i=0: yield("hello", nil) → 循环体打印 → 返回 true
  → 循环 i=1: yield("world", nil) → 循环体打印 → 返回 true
  → 循环 i=2: yield("done",  nil) → 循环体打印 → 返回 true
  → 循环结束，函数返回
for-range 检测到迭代结束，退出
```

---

## 3. 控制流：yield 返回值与提前终止

### 3.1 yield 返回值的含义

```go
if !yield(msg, nil) {   // ← 检查返回值
    return              // ← false 表示消费方喊停
}
```

`yield` 返回 `bool`，由消费方（for-range 循环体）决定：
- `true`：继续，生产方接着产出下一条
- `false`：停止！消费方 break 或 return 了，生产方必须立刻退出

### 3.2 消费方提前退出

```go
func numbers() iter.Seq2[int, error] {
    return func(yield func(int, error) bool) {
        for i := 0; i < 10; i++ {
            fmt.Printf("生产: %d\n", i)
            if !yield(i, nil) {
                fmt.Println("消费方喊停，退出")
                return
            }
        }
    }
}

for n, err := range numbers() {
    fmt.Printf("消费: %d\n", n)
    if n >= 2 {
        break  // 只消费 3 个
    }
}

// 输出:
// 生产: 0
// 消费: 0
// 生产: 1
// 消费: 1
// 生产: 2
// 消费: 2
// 生产: 3       ← 注意：生产方多产了一个！
// 消费方喊停，退出

// 核心观察：第 3 次 yield(2, nil) 时 cycle 体处理完才 break，
// 但生产方不知道，继续循环到了 i=3，调 yield(3, nil) 拿到 false 才停。
// 这是正常的——生产方总是"多走一步"才发现消费者已经停了。
```

> **重点**：这个例子暴露了 yield 的"滞后性"——消费方在第 n 次迭代 break，生产方必须等到**下一次** yield 才能收到 false。这正是迭代器需要检查 `yield` 返回值的原因。

### 3.3 不检查返回值的后果

```go
// 危险写法：忽略 yield 返回值
func danger() iter.Seq2[int, error] {
    return func(yield func(int, error) bool) {
        for i := 0; i < 1000000; i++ {
            yield(i, nil)  // 没检查返回值
        }
        // 即使消费方 break 了，这里仍然死循环到底
    }
}

for n, _ := range danger() {
    if n > 5 {
        break  // break 无效！生产方根本没看返回值
    }
}
// 后果：程序卡死，100万次循环全跑完。
```

---

## 4. 迭代器组合——ADK 的精髓

理解"迭代器包迭代器"是掌握 ADK-Go 的关键。ADK 中每个 Agent 的 `Run()` 都返回迭代器，Workflow Agent 的工作就是消费子 Agent 的迭代器、加上自己的逻辑、再产生一个新的迭代器。

### 4.1 模式一：转发（Pass-through）

最基础的组合：消费一个迭代器，原样转发出去。

```go
// 把内部迭代器的所有事件原样转发
func passthrough[T any](inner iter.Seq2[T, error]) iter.Seq2[T, error] {
    return func(yield func(T, error) bool) {
        for val, err := range inner {
            // for-range 循环体 = 转发逻辑
            if !yield(val, err) {
                return  // 外部消费方喊停
            }
        }
    }
}
```

数据流：

```
外部消费方 → for val, err := range passthroughResult
                         ↓
              passthrough 的 for-range 消费 inner
                         ↓
              inner 每次 yield → passthrough 收到 → yield 给外部
```

这是 ADK 中最常见的模式——Runner 消费 Agent.Run() 的输出，LlmAgent 消费内部 Flow 的输出，每个层级都是 "消费 → 加工 → yield"。

### 4.2 模式二：过滤（Filter）

在转发过程中过滤掉不需要的数据：

```go
// 过滤掉所有错误为 nil 但 value 为空字符串的事件
func filterEmpty(inner iter.Seq2[string, error]) iter.Seq2[string, error] {
    return func(yield func(string, error) bool) {
        for val, err := range inner {
            if err != nil {
                if !yield("", err) { return }  // 错误必须传递
                continue
            }
            if val == "" {
                continue  // 跳过空字符串，不 yield 给外部
            }
            if !yield(val, nil) {
                return
            }
        }
    }
}
```

这对应 ADK 中 Runner 过滤 Partial 事件、忽略空内容的模式。

### 4.3 模式三：串联（Chaining）—— SequentialAgent 内核

将多个迭代器串联成一个，A 跑完跑 B，B 跑完跑 C：

```go
func chain[T any](iters ...iter.Seq2[T, error]) iter.Seq2[T, error] {
    return func(yield func(T, error) bool) {
        for _, it := range iters {
            for val, err := range it {
                if !yield(val, err) {
                    return
                }
            }
        }
    }
}

// 使用
a := simpleIter("A")
b := simpleIter("B")
c := simpleIter("C")

for val, err := range chain(a, b, c) {
    fmt.Println(val)
    if val == "A2" {
        break  // 提前退出，B 和 C 都不会执行
    }
}
```

追踪 3 个迭代器的串联执行：

```
chain 返回闭包
for-range 调用闭包
  → 外层循环 iter[0] = a
     → 内层 for val, err := range a
        → a 的闭包执行: yield("A0") → 打印 "A0" → continue
        → a 的闭包执行: yield("A1") → 打印 "A1" → continue
        → a 的闭包执行: yield("A2") → 打印 "A2" → break!
        → yield 返回 false → return (退出 chain)
  → B 和 C 完全没有被消费
```

**这就是 SequentialAgent 的核心**：只是多了一层 "消费子Agent迭代器 → 转发" 的包装。

### 4.4 模式四：循环（Loop）

在迭代器内部用循环控制重复执行：

```go
func retry(inner iter.Seq2[string, error], maxRetries int) iter.Seq2[string, error] {
    return func(yield func(string, error) bool) {
        for attempt := 0; attempt < maxRetries; attempt++ {
            for val, err := range inner {
                if err != nil {
                    if !yield(val, err) { return }
                    break  // 有错误就重试
                }
                if !yield(val, nil) { return }
            }
            // 如果 inner 全部成功执行完毕，退出重试
            return
        }
    }
}
```

追踪（模拟 inner 第一次失败，第二次成功）：

```
attempt=0:
  消费 inner → yield(err, someErr)
  break（重新开始）
attempt=1:
  消费 inner → yield("success", nil) → yield("done", nil)
  inner 全部消费完毕
  return（退出 retry）
```

**这就是 LoopAgent 的核心**。

---

## 5. 简化版 ADK 迭代器：手写一套 Agent 系统

用上面学到的模式，手写一个迷你版 Agent 框架：

```go
// --- 类型定义 ---
type Event struct{ Text string }

type Agent struct {
    Name string
    Run  func() iter.Seq2[*Event, error]
    Subs []*Agent
}

// --- 构造器 ---

// 简单 Agent：产出 3 条事件
func newSimpleAgent(name string) *Agent {
    return &Agent{
        Name: name,
        Run: func() iter.Seq2[*Event, error] {
            return func(yield func(*Event, error) bool) {
                for i := 0; i < 3; i++ {
                    ev := &Event{Text: fmt.Sprintf("[%s] message %d", name, i)}
                    fmt.Printf("  生产: %s\n", ev.Text)
                    if !yield(ev, nil) {
                        return
                    }
                }
            }
        },
    }
}

// SequentialAgent：串联子 Agent 的事件流
func newSeqAgent(name string, subs ...*Agent) *Agent {
    return &Agent{
        Name: name,
        Subs: subs,
        Run: func() iter.Seq2[*Event, error] {
            return func(yield func(*Event, error) bool) {
                fmt.Printf("--- [%s] 开始 ---\n", name)
                for _, sub := range subs {
                    for ev, err := range sub.Run() {
                        if !yield(ev, err) {
                            return
                        }
                    }
                }
                fmt.Printf("--- [%s] 完成 ---\n", name)
            }
        },
    }
}

// --- 运行 ---
func main() {
    a := newSimpleAgent("A")
    b := newSimpleAgent("B")
    c := newSimpleAgent("C")
    pipeline := newSeqAgent("pipeline", a, b, c)

    fmt.Println("开始消费事件流:")
    for ev, err := range pipeline.Run() {
        if err != nil {
            fmt.Printf("错误: %v\n", err)
            continue
        }
        fmt.Printf("消费: %s\n", ev.Text)
    }
}
```

运行结果：

```
开始消费事件流:
--- [pipeline] 开始 ---
  生产: [A] message 0
消费: [A] message 0
  生产: [A] message 1
消费: [A] message 1
  生产: [A] message 2
消费: [A] message 2
  生产: [B] message 0
消费: [B] message 0
  生产: [B] message 1
消费: [B] message 1
  生产: [B] message 2
消费: [B] message 2
  生产: [C] message 0
消费: [C] message 0
  生产: [C] message 1
消费: [C] message 1
  生产: [C] message 2
消费: [C] message 2
--- [pipeline] 完成 ---
```

**每一行 "生产: ..." 和 "消费: ..." 之间的交替，就是 yield 在起作用。**

---

## 6. ADK 源码中的迭代器实战

ADK 源码比上面的示例多了三层复杂性：
1. 迭代器之间传递 `InvocationContext`（上下文）
2. 事件结构体远比 `Event{Text}` 复杂
3. 并行执行引入了 goroutine + channel

但**模式完全一样**。下面逐一拆解。

### 6.1 SequentialAgent：串联子Agent迭代器

源码路径：`agent/workflowagents/sequentialagent/agent.go`

```go
func (a *sequentialAgent) Run(ctx agent.InvocationContext) iter.Seq2[*session.Event, error] {
    return func(yield func(*session.Event, error) bool) {
        for _, subAgent := range ctx.Agent().SubAgents() {
            for event, err := range subAgent.Run(ctx) {
                if !yield(event, err) {
                    return
                }
            }
        }
    }
}
```

这就是我们上面写的 `chain` 模式，一模一样。3 个子 Agent（A→B→C），外层 for 遍历子 Agent 列表，内层 for-range 消费每个子 Agent 的迭代器，yield 转发给 Runner。

### 6.2 LlmAgent：中间加工

源码路径：`agent/llmagent/llmagent.go`

```go
func (a *llmAgent) run(ctx agent.InvocationContext) iter.Seq2[*session.Event, error] {
    f := &llminternal.Flow{...}  // 准备内部执行流

    return func(yield func(*session.Event, error) bool) {
        for ev, err := range f.Run(ctx) {      // 消费内部 Flow
            a.maybeSaveOutputToState(ev)       // 加工：自动存 OutputKey
            if !yield(ev, err) {               // 转发给 Runner
                return
            }
        }
    }
}
```

模式是 "消费内层迭代器 → 加工事件 → 转发给外层"，就是上面 passthrough 模式加了一个 `maybeSaveOutputToState` 的加工步骤。

### 6.3 ParallelAgent：goroutine + channel 桥接

源码路径：`agent/workflowagents/parallelagent/agent.go`

并行执行不能简单的 for-range 嵌套，因为 goroutine 之间的数据传递需要通过 channel：

```go
func run(ctx agent.InvocationContext) iter.Seq2[*session.Event, error] {
    // 第一步：启动 goroutine 并行运行子 Agent
    errGroup, _ := errgroup.WithContext(ctx)
    resultsChan := make(chan result, 8)

    for _, sa := range ctx.Agent().SubAgents() {
        errGroup.Go(func() error {
            // 每个 goroutine 独立消费子 Agent 的迭代器
            for ev, err := range sa.Run(subCtx) {
                resultsChan <- result{event: ev, err: err}  // 发送到 channel
            }
            return nil
        })
    }

    // 第二步：从 channel 收集结果，转为迭代器
    return func(yield func(*session.Event, error) bool) {
        for res := range resultsChan {
            if !yield(res.event, res.err) {
                break  // 消费方退出，停止收集
            }
        }
    }
}
```

执行追踪（3 个子 Agent A、B、C 并行运行）：

```
时间线（并行，交错发生）：

goroutine A: yield("A0") → channel ← "A0"
goroutine B: yield("B0") → channel ← "B0"
goroutine C: yield("C0") → channel ← "C0"

主 goroutine（迭代器）:
  ← channel 收到 "A0" → yield("A0", nil)
  ← channel 收到 "B0" → yield("B0", nil)
  ← channel 收到 "C0" → yield("C0", nil)
  ← channel 收到 "A1" → yield("A1", nil)
  ... 顺序不确定，取决于哪个 goroutine 先完成
```

**关键点**：channel 是 goroutine 和迭代器之间的桥梁。goroutine 负责"生产"、往 channel 里放，迭代器负责"消费"、从 channel 里拿、yield 给外层。

### 6.4 LoopAgent：迭代器内循环

```go
func (a *loopAgent) Run(ctx agent.InvocationContext) iter.Seq2[*session.Event, error] {
    count := a.maxIterations
    return func(yield func(*session.Event, error) bool) {
        for {  // 无限循环，由内部条件控制退出
            shouldExit := false
            for _, subAgent := range ctx.Agent().SubAgents() {
                for event, err := range subAgent.Run(ctx) {
                    if !yield(event, err) {
                        return
                    }
                    if event.Actions.Escalate {
                        shouldExit = true  // 子 Agent 触发退出
                    }
                }
            }
            count--
            if count == 0 { return }     // 达到最大迭代次数
            if shouldExit { return }      // Escalate 触发退出
        }
    }
}
```

追踪（critic + reviser 两个子 Agent，MaxIterations=3）：

```
迭代 1:
  消费 critic.Run() → "需要改进" → yield 给外部
  消费 reviser.Run() → "修改后的文本" → yield 给外部
  count=2, 无 Escalate，继续

迭代 2:
  消费 critic.Run() → "仍需改进" → yield 给外部
  消费 reviser.Run() → "再次修改" → yield 给外部
  count=1, 无 Escalate，继续

迭代 3:
  消费 critic.Run() → "APPROVED" → yield 给外部
  消费 reviser.Run()
    → event.Actions.Escalate = true → shouldExit = true
    → yield("最终版本") → yield 给外部
  count=0 → return（达到最大迭代）
```

---

## 7. 完整调用链：从用户输入到最终响应

把 ADK 所有层级的迭代器串起来，一条用户消息的完整路径：

```
用户发送 "写一个 HTTP 服务器"
    ↓
Runner.Run()
  → 创建 InvocationContext
  → return func(yield ...) {    ← Runner 自己的迭代器
        ↓
        for event, err := range agent.Run(ctx) {   ← 消费 Agent 的迭代器
              ↓
              SequentialAgent.Run(ctx)
                → return func(yield ...) {
                      for _, sub := range subs {
                          for ev, err := range sub.Run(ctx) {
                                ↓
                                CodeWriter.Run(ctx)    ← LlmAgent
                                  → return func(yield ...) {
                                        for ev, err := range flow.Run(ctx) {
                                              ↓
                                              Flow 调用 Gemini API
                                              → yield(Event{Content:"func main()..."})
                                              ↑
                                        }
                                        // 加工：maybeSaveOutputToState
                                        // state["generated_code"] = "func main()..."
                                        yield(ev, nil)  → 转发给 SequentialAgent
                                    }
                                ↑
                                SequentialAgent 收到 → yield 给 Runner
                          }
                      }
                  }
              ↑
              Runner 收到 → 持久化到 Session → yield 给外部
        }
    }
外部（CLI/Web）：fmt.Println(event.Content)
```

**每一层的关系都一样**：消费内层迭代器 → 加工 → yield 给外层。理解了这个链条，ADK 的运行机制就全通了。

---

## 8. 常见陷阱

### 陷阱 1：在 yield 之后修改已发送的数据

```go
// 危险：yield 传递指针，外部可能还在用
return func(yield func(*session.Event, error) bool) {
    event := &session.Event{Author: "alice"}
    yield(event, nil)
    event.Author = "bob"  // 外部可能已经读了 Author="alice"，现在被改成了 "bob"
}
```

yield 的是指针，消费方拿到的是同一个对象的引用。yield 返回后不要再改。

### 陷阱 2：yield 返回 false 后继续执行

```go
// 错误：没检查返回值，白费 CPU
for i := 0; i < 100000; i++ {
    yield(makeEvent(i), nil)  // 消费者可能早就 break 了
}
```

每次 yield 必须检查返回值。

### 陷阱 3：error 和 value 同时为 nil

```go
yield(nil, nil)  // 消费方收到 (nil, nil)，不知如何处理
```

在 ADK 中，要么 value != nil（正常事件），要么 error != nil（错误），不能两者都 nil。

### 陷阱 4：迭代器和 goroutine 之间的同步

ParallelAgent 展示了正确做法——用 channel + ackChan 同步。在迭代器闭包中启动 goroutine 直接调用 yield 会导致数据竞争，因为 yield 必须只在消费方的 goroutine 中被调用。

---

## 9. 练习

### 基础

用 `iter.Seq2[string, error]` 写一个迭代器，从字符串切片中依次产出每个单词，遇到空字符串时产出错误但不中断。

```go
// 骨架
func wordsFromSlice(words []string) iter.Seq2[string, error] {
    // TODO
}
```

### 进阶

实现一个包装函数，接收一个 `iter.Seq2[string, error]`，返回一个新迭代器：将所有产出转为大写，过滤掉长度 < 3 的单词，错误原样传递。

```go
func transformFilter(inner iter.Seq2[string, error]) iter.Seq2[string, error] {
    // TODO
}
```

### 挑战

实现一个 `timeoutIter`，包装一个迭代器，如果单次 `yield` 调用超过指定时间仍没有返回，就产出超时错误并终止。

```go
func withTimeout[T any](inner iter.Seq2[T, error], timeout time.Duration) iter.Seq2[T, error] {
    // TODO: 提示，需要 goroutine + select
}
```

### 实战

阅读 `runner/runner.go` 的 `Run()` 方法（约第 131 行），画出从用户消息到最终事件的完整迭代器层级图，标注每一层 yield 的来源和去向。
