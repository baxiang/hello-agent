# Go 迭代器（iter.Seq2）— ADK-Go 事件流的核心协议

## 1. Go 1.23 迭代器：从通道到函数式迭代

Go 1.23 引入了标准库 `iter` 包，定义了两种迭代器类型：

```go
// 单值迭代器
type Seq[V any] func(yield func(V) bool)

// 键值对迭代器
type Seq2[K, V any] func(yield func(K, V) bool)
```

`iter.Seq2` 是 adk-go 事件流的核心抽象——所有 Agent 的 `Run()` 方法都通过它产出事件流。理解迭代器是理解 adk-go 运行机制的**第一道门槛**。

### 为什么不是 channel？

在 Go 1.23 之前，流式数据通常用 channel 传递：

```go
// 旧方式：channel 流式传输
func Run(ctx context.Context) <-chan *Event { ... }
```

channel 的问题：
- **消费方必须 goroutine**：生产者和消费者需要分别运行在不同 goroutine
- **缓冲区大小难以抉择**：0 则阻塞，大了浪费内存
- **错误传播笨拙**：需要额外的 error channel 或包装类型
- **无法被 for-range 直接驱动**：`for v := range ch` 无法同时拿到 error

`iter.Seq2` 的优势：
- **拉取式**：消费方决定何时取下一个值，无需 goroutine 协调
- **零缓冲**：不需要预分配内存
- **错误内嵌**：`iter.Seq2[*Event, error]` 天然携带错误信息
- **for-range 原生支持**：`for event, err := range agent.Run(ctx)`

---

## 2. yield 函数：迭代器的控制阀门

迭代器的核心是 `yield` 回调函数。它由**消费方**（for-range 循环）提供，**生产方**每次调用 `yield(k, v)` 产出一条数据。

### yield 的返回值

```go
yield func(K, V) bool
```

- **返回 `true`**：消费方继续迭代，生产方可以继续 yield 下一条
- **返回 `false`**：消费方已经 break 或不再需要数据，**生产方必须立即停止**

这是迭代器的"背压"机制。当 `yield(false)` 时，生产方**必须立刻 return**，否则会导致不可预期的行为。

### 最简迭代器

```go
func count(n int) iter.Seq2[int, error] {
    return func(yield func(int, error) bool) {
        for i := 0; i < n; i++ {
            if !yield(i, nil) {
                return // 消费方已停止，必须退出
            }
        }
    }
}

// 消费
for i, err := range count(5) {
    if err != nil {
        log.Fatal(err)
    }
    fmt.Println(i)
}
```

---

## 3. Agent.Run()：adk-go 的迭代器协议

adk-go 的 `Agent` 接口定义了核心方法签名（`agent/agent.go:46`）：

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

`Run` 返回 `iter.Seq2[*session.Event, error]`，意味着：
- 每次迭代产出一个 `*session.Event` 和一个 `error`
- `error != nil` 表示这一步出了问题，但迭代**不一定结束**（后续可能还有事件）
- `error == nil` 且 `event != nil` 是正常事件

这个设计允许 Agent 在出错后继续产出事件，而不是整个迭代直接终止。

---

## 4. 消费迭代器：for-range 遍历事件流

在 adk-go 中，消费 Agent 事件流的标准模式如下（见 `runner/runner.go:234`）：

```go
for event, err := range agentToRun.Run(ctx) {
    if err != nil {
        // 处理错误，但不一定 break
        if !yield(event, err) {
            return
        }
        continue
    }
    // 处理正常事件
    if !event.LLMResponse.Partial {
        // 非局部事件，提交到 session
        r.sessionService.AppendEvent(ctx, storedSession, event)
    }
    if !yield(event, nil) {
        return
    }
}
```

关键点：
1. **error 不终止迭代**：adk-go 的设计允许中间出错后继续
2. **Partial 事件不持久化**：流式中间结果直接透传，不写入 session
3. **yield 返回 false 时立即退出**：Runner 本身也在生产迭代器，必须尊重消费者的 break

---

## 5. 构造迭代器：返回 func(yield ...)

adk-go 中所有 Agent 的 `Run()` 方法都遵循同一模式：返回一个闭包函数。

### 自定义 Agent 的 Run

使用 `agent.New()` 创建自定义 Agent 时（`agent/agent.go:99`），`Config.Run` 字段的签名是：

```go
Run func(InvocationContext) iter.Seq2[*session.Event, error]
```

一个最简自定义 Agent：

```go
myAgent, err := agent.New(agent.Config{
    Name:        "greeter",
    Description: "向用户打招呼的代理",
    Run: func(ctx agent.InvocationContext) iter.Seq2[*session.Event, error] {
        return func(yield func(*session.Event, error) bool) {
            event := session.NewEvent(ctx.InvocationID())
            event.Author = ctx.Agent().Name()
            event.LLMResponse = model.LLMResponse{
                Content: &genai.Content{
                    Role: genai.RoleModel,
                    Parts: []*genai.Part{{Text: "你好，世界！"}},
                },
            }
            yield(event, nil)
        }
    },
})
```

### LlmAgent 的 Run 实现

`LlmAgent` 的 `run` 方法（`agent/llmagent/llmagent.go:361`）展示了更复杂的模式：

```go
func (a *llmAgent) run(ctx agent.InvocationContext) iter.Seq2[*session.Event, error] {
    // 准备上下文和流程对象
    f := &llminternal.Flow{...}

    return func(yield func(*session.Event, error) bool) {
        // 消费内部 Flow 的迭代器，转发给外部
        for ev, err := range f.Run(ctx) {
            a.maybeSaveOutputToState(ev)
            if !yield(ev, err) {
                return
            }
        }
    }
}
```

这是经典的**迭代器链**模式：外层迭代器消费内层迭代器，添加自己的逻辑（如 `maybeSaveOutputToState`），再 yield 给更外层。

---

## 6. adk-go 源码中的迭代器实例

### SequentialAgent：顺序串联迭代器

`agent/workflowagents/sequentialagent/agent.go:79`：

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

顺序 Agent 将子 Agent 的事件流**串联**：第一个子 Agent 迭代完毕后，再开始第二个。

### ParallelAgent：并行合并迭代器

`agent/workflowagents/parallelagent/agent.go:67`：

```go
func run(ctx agent.InvocationContext) iter.Seq2[*session.Event, error] {
    // 启动 errgroup 并行运行子 Agent
    errGroup, errGroupCtx := errgroup.WithContext(ctx)
    resultsChan := make(chan result)

    for _, sa := range ctx.Agent().SubAgents() {
        errGroup.Go(func() error {
            return runSubAgent(subCtx, subAgent, resultsChan, doneChan)
        })
    }

    // 收集 goroutine 结果，转为迭代器
    return func(yield func(*session.Event, error) bool) {
        for res := range resultsChan {
            shouldContinue := yield(res.event, res.err)
            if res.ackChan != nil {
                close(res.ackChan) // 通知子 Agent 可以继续
            }
            if !shouldContinue {
                break
            }
        }
    }
}
```

并行 Agent 用 channel 桥接 goroutine 和迭代器，通过 `ackChan` 实现背压控制。

### LoopAgent：循环迭代器

`agent/workflowagents/loopagent/agent.go:75`：

```go
func (a *loopAgent) Run(ctx agent.InvocationContext) iter.Seq2[*session.Event, error] {
    count := a.maxIterations
    return func(yield func(*session.Event, error) bool) {
        for {
            shouldExit := false
            for _, subAgent := range ctx.Agent().SubAgents() {
                for event, err := range subAgent.Run(ctx) {
                    if !yield(event, err) {
                        return
                    }
                    if event != nil && event.Actions.Escalate {
                        shouldExit = true
                    }
                }
            }
            if count > 0 {
                count--
                if count == 0 {
                    return
                }
            }
            if shouldExit {
                return
            }
        }
    }
}
```

循环 Agent 在迭代器内部使用 `for {}` 无限循环，通过 `Escalate` 动作或 `MaxIterations` 计数器控制退出。

---

## 7. 与 Channel / StreamReader 的对比

| 特性 | iter.Seq2 | Channel |
|------|-----------|---------|
| 拉取/推送 | 拉取式 | 推送式 |
| 并发要求 | 同步即可 | 需要 goroutine |
| 背压机制 | yield(false) | 缓冲区满阻塞 |
| 错误传播 | 内嵌在 Seq2 中 | 额外 channel 或包装 |
| for-range | 原生支持 | 支持（单值） |
| 资源释放 | 函数返回即释放 | 需显式 close |
| 组合性 | 闭包嵌套，自然链式 | 需要多个 goroutine |

adk-go 选择 `iter.Seq2` 的核心理由：Agent 事件流本质上是**请求-响应**模型，用户发消息，Agent 产出一系列事件，消费方控制节奏。拉取模型天然匹配这种语义。

---

## 8. 常见陷阱

### 陷阱 1：忘记检查 error

```go
// 错误：忽略了 error
for event := range agent.Run(ctx) {
    process(event) // event 可能为 nil！
}

// 正确：必须同时检查 error
for event, err := range agent.Run(ctx) {
    if err != nil {
        handleErr(err)
        continue // 或 break
    }
    process(event)
}
```

在 adk-go 中，`error != nil` 时 `event` 可能为 nil，反之 `event != nil` 时 `error` 通常为 nil。

### 陷阱 2：yield 后继续修改数据

```go
// 危险：yield 后修改了 event
return func(yield func(*session.Event, error) bool) {
    event := &session.Event{...}
    yield(event, nil)
    event.Author = "modified" // 消费方可能还在使用这个 event！
}
```

`yield` 传递的是指针，消费方在 yield 返回后仍持有引用。修改已 yield 的数据会导致数据竞争。正确做法是 yield 前确保数据完整，yield 后不再修改。

### 陷阱 3：忘记 yield(false) 时退出

```go
// 错误：yield 返回 false 后继续循环
return func(yield func(*session.Event, error) bool) {
    for i := 0; i < 100; i++ {
        yield(makeEvent(i), nil) // 没有检查返回值！
    }
}

// 正确：检查 yield 返回值
return func(yield func(*session.Event, error) bool) bool) {
    for i := 0; i < 100; i++ {
        if !yield(makeEvent(i), nil) {
            return
        }
    }
}
```

不检查 yield 返回值会导致消费者 break 后生产者仍在空转，浪费计算资源。

### 陷阱 4：在迭代器中启动 goroutine 但未同步

ParallelAgent 的实现展示了正确的模式：用 channel + ackChan 实现同步。如果直接在迭代器闭包中启动 goroutine 并 yield，必须确保 goroutine 的产出与 yield 调用正确同步，否则会出现数据竞争。

---

## 9. 练习

1. **基础**：编写一个 `iter.Seq2[string, error]` 迭代器，依次产出 "hello"、"world"，然后模拟一个错误。

2. **进阶**：实现一个 `filterAgent` 包装器，接收一个 `Agent`，在其事件流中过滤掉所有 `Partial` 为 true 的事件。

3. **挑战**：参考 ParallelAgent 的实现，编写一个 `raceAgent`，并行运行两个子 Agent，只产出**第一个完成**的子 Agent 的事件流，并正确取消另一个。

4. **实战**：阅读 `runner/runner.go:131` 的 `Runner.Run()` 方法，画出从用户消息到最终事件的完整迭代器链路图，标注每一层 yield 的来源和去向。
