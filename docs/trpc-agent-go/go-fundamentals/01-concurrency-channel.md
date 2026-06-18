# Go 并发与 Channel — trpc-agent-go 的通信基石

> trpc-agent-go 把 `<-chan *event.Event` 作为 `Agent.Run` 的标准返回类型，不懂 channel 的发送/接收/关闭语义，就读不懂框架里任何一个示例，更写不出能正确 drain 事件的业务代码。

## 核心概念

Go 的并发模型由两个原语构成：**goroutine**（轻量级线程，`go f()` 即可启动）和 **channel**（goroutine 之间传递数据的类型安全管道）。trpc-agent-go 几乎所有跨 goroutine 的数据流都走 channel，必须吃透下面五点：

1. **无缓冲 channel**：`make(chan T)` — 发送和接收同步配对，发送方阻塞直到有接收方。
2. **带缓冲 channel**：`make(chan T, n)` — 缓冲区满之前发送不阻塞，适合做有界队列。
3. **`close(ch)`**：关闭 channel，关闭后所有接收方都能继续读到零值，且 `for range` 会在读完后正常退出。**只有发送方应该 close**。
4. **`for v := range ch`**：持续接收直到 channel 被 close 并排空，这是消费 channel 的惯用姿势。
5. **`select` + `ctx.Done()`**：在多个 channel 间多路复用，配合 `context.Context` 实现超时/取消，避免 goroutine 泄漏。

下面是一段**纯 Go**的生产者/消费者示例（不涉及 trpc-agent-go），展示生产 → 消费 → 优雅关闭的完整闭环：

```go
package main

import (
	"context"
	"fmt"
	"time"
)

// producer 向 ch 发送 n 条消息，发送完毕后 close(ch)。
// close 由发送方调用，这是 Go 的硬性约定。
func producer(ctx context.Context, ch chan<- string, n int) {
	defer close(ch) // (1) 确保 consumer 的 for-range 能正常退出
	for i := 0; i < n; i++ {
		select {
		case <-ctx.Done(): // (2) 被取消时提前结束，不阻塞发送
			return
		case ch <- fmt.Sprintf("msg-%d", i):
		}
	}
}

// consumer 用 for-range 持续 drain ch，直到 producer close 它。
func consumer(ctx context.Context, ch <-chan string, done chan<- struct{}) {
	defer close(done)
	for msg := range ch { // (3) ch 被 close 且排空后循环自动结束
		select {
		case <-ctx.Done():
			return
		default:
		}
		fmt.Println("got:", msg)
		time.Sleep(50 * time.Millisecond) // 模拟处理耗时
	}
}

func main() {
	ctx, cancel := context.WithTimeout(context.Background(), time.Second)
	defer cancel()

	ch := make(chan string, 4) // (4) 带缓冲：producer 不会被慢 consumer 完全卡住
	done := make(chan struct{})

	go producer(ctx, ch, 10)
	go consumer(ctx, ch, done)

	<-done // (5) 等待 consumer 完全 drain 后再退出 main
	fmt.Println("all done")
}
```

逐行解读：**(1)** `defer close(ch)` 是关键——consumer 的 `for range` 依赖 channel 关闭信号，不 close 就会永远阻塞在接收上，goroutine 泄漏；**(2)** `select` 让 producer 能响应 `ctx.Done()`，避免向已无人接收的 channel 发送造成死锁；**(3)** `for v := range ch` 是消费端最简洁的写法，等价于 `for { v, ok := <-ch; if !ok { break } }`；**(4)** 缓冲大小 4 吸收 producer 与 consumer 的速度差；**(5)** `done` channel 是经典的「通知主 goroutine 完成」模式，保证 main 不会在 consumer 还没排空时就退出。trpc-agent-go 内部 `Agent.Run` 的实现就遵循完全一致的模式——goroutine 内 close event channel，外部用 `for range` drain。

## 在 trpc-agent-go 里

### Agent 接口签名

`Agent.Run` 在 `agent/agent.go:62-67` 直接把 channel 作为返回值：

```go
// agent/agent.go:62
type Agent interface {
	// Run executes the provided invocation within the given context and returns
	// a channel of events that represent the progress and results of the execution.
	Run(ctx context.Context, invocation *Invocation) (
		<-chan *event.Event, error,
	)
	// ...
}
```

注意返回类型是**只读 channel** `<-chan *event.Event`——调用方只能接收，不能 close、不能发送，这从类型层面把「生产/关闭由 Agent 负责」的约定固化下来。Agent 实现内部会启动 goroutine 跑业务逻辑、把每个 Event 发到 channel，业务结束后 `close` 这个 channel。

### Event 结构

channel 里流转的就是 `*event.Event`，定义在 `event/event.go:96-130`：

```go
// event/event.go:96
type Event struct {
	*model.Response              // 嵌入 LLM 响应：Choices、Error、Usage 等
	RequestID           string   // 请求 ID
	InvocationID        string   // 调用链 ID
	ParentInvocationID  string   // 父调用 ID（多 agent 调用链）
	ParentMetadata      *ParentInvocationMetadata
	Author              string   // 事件作者（user / agent name）
	ID                  string   // 事件唯一 ID
	Timestamp           time.Time
	Branch              string   // 多 agent 执行链路
	Tag                 string
	RequiresCompletion  bool
	LongRunningToolIDs  []string
	// ...
}
```

每条 Event 要么承载模型的流式片段、工具调用、工具响应，要么是错误事件（`evt.Error != nil`）。channel 关闭意味着本轮 Run 全部事件已经发完。

### Runner 的消费模式

`Runner.Run` 是 `Agent.Run` 的封装，签名略不同但同样返回只读 channel。`examples/runner/main.go:163-192` 给出了官方推荐的消费姿势：

```go
// examples/runner/main.go:166
eventChan, err := c.runner.Run(ctx, c.userID, c.sessionID, message, agent.WithRequestID(requestID))
if err != nil {
    return fmt.Errorf("failed to run agent: %w", err)
}
return c.processResponse(eventChan)
```

```go
// examples/runner/main.go:173
func (c *multiTurnChat) processResponse(eventChan <-chan *event.Event) error {
	fmt.Print("🤖 Assistant: ")
	for evt := range eventChan {            // ← 用 for-range drain channel
		if err := c.handleEvent(evt, ...); err != nil {
			return err
		}
		if evt.IsFinalResponse() {          // ← 命中最终响应可提前 break
			fmt.Printf("\n")
			break
		}
	}
	return nil
}
```

注意两点：第一，`for evt := range eventChan` 是 drain channel 的标准姿势，channel 被 Runner 内部 close 后循环自然退出；第二，`evt.IsFinalResponse()` 命中时调用方主动 `break`——这里**没有** goroutine 泄漏，因为 Runner 在后台检测到消费者退出（channel 无人接收）后，会通过 `ctx` 取消或检测发送失败来 close channel。这种「生产者在 goroutine 里 close、消费者用 for-range drain」正是本文核心概念那段代码的实际应用。

## 常见陷阱

### 陷阱 1：消费者 break 后忘记 channel 未排空 → goroutine 泄漏

❌ 在 `for evt := range eventChan` 里 `break` 出循环，但底层 Agent 还在向 channel 发送——如果 Agent 实现没监听 `ctx.Done()`，发送方会**永久阻塞**在 `ch <- evt`，goroutine 泄漏。

✅ 修复：`break` 之前调用 `cancel()` 取消 context，或确保 Agent 实现一定在 `select` 里处理 `ctx.Done()`。trpc-agent-go 的官方 Agent 实现都遵循此约定，但你**自定义 Agent 时必须照做**。

```go
// ❌ 错误：消费者跑路，生产者卡死
for evt := range eventChan {
    if someCondition { break } // producer 仍阻塞在 ch <- evt
}

// ✅ 正确：取消 ctx 让 producer 走 ctx.Done() 分支
ctx, cancel := context.WithCancel(parentCtx)
defer cancel()
for evt := range eventChan {
    if someCondition { cancel(); break }
}
```

### 陷阱 2：向已 close 的 channel 发送 → panic

❌ 消费方误以为「我读完了所以可以 close」，反过来 close 一个还在被生产者写入的 channel，下一行 `ch <- evt` 直接 `panic: send on closed channel`。

✅ 修复：**永远只有发送方 close channel**。`Agent.Run` 返回 `<-chan` 已经在类型层面禁止了消费方 close——自定义逻辑里也保持这个约定。

### 陷阱 3：把无缓冲 channel 当队列用 → 死锁

❌ `ch := make(chan int)` 然后 `ch <- 1; ch <- 2` 在同一 goroutine 里执行：第一条发送就因没有接收方而永久阻塞，goroutine 自己死锁。

✅ 修复：需要「先攒再消费」就用缓冲 channel `make(chan int, capacity)`，且 capacity 覆盖最大积压；或者把发送放到独立 goroutine。

```go
// ❌ 死锁
ch := make(chan int)
ch <- 1 // 当前 goroutine 自己卡死

// ✅ 带缓冲
ch := make(chan int, 2)
ch <- 1
ch <- 2 // OK，缓冲未满
```

### 陷阱 4：`for range` 后忘记 nil 检查就访问 Event 字段

❌ channel 里某些 Event 在错误场景下 `evt.Response` 为 nil，直接 `evt.Response.Choices[0]` 会 panic。

✅ 修复：先判 `evt.Error`，再判 `evt.Response != nil`。`examples/runner/main.go:200` 和 `:219` 都遵循「先 Error、后 Response、最后 Choices」的防御顺序。

```go
// ❌ panic：错误事件 Response 为 nil
for evt := range eventChan {
    fmt.Println(evt.Response.Choices[0].Message.Content)
}

// ✅ 正确：分层 nil 检查
for evt := range eventChan {
    if evt.Error != nil {
        return evt.Error
    }
    if evt.Response == nil || len(evt.Response.Choices) == 0 {
        continue
    }
    fmt.Println(evt.Response.Choices[0].Message.Content)
}
```

## 小结

- trpc-agent-go 用 `<-chan *event.Event` 把 Agent 的一次执行建模成「事件流」，类型本身强制了「只读、由生产方关闭」的约定。
- 消费姿势固定为 `for evt := range eventChan`，channel 被 Agent 内部 `close` 后循环自动退出，这是 drain channel 的 Go 惯用法。
- 自定义 Agent 时务必在发送 goroutine 里 `defer close(ch)`，并用 `select` + `ctx.Done()` 响应取消，否则消费者提前退出会导致 goroutine 泄漏。
- 处理 Event 必须做分层 nil 检查（Error → Response → Choices），channel 里允许出现错误事件和空响应。

**延伸阅读：**

- [trpc-agent-go Runner 执行器](../00-runner-executor/)
- [Go 官方：Go Concurrency Patterns](https://go.dev/blog/pipelines)
- [Context 生命周期与取消](./04-context-lifecycle)
