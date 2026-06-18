# Context 生命周期与取消 — trpc-agent-go Runner 的生命线

> trpc-agent-go 的 Runner 用 `context.Context` 驱动整轮 run：ctx cancel 会停止模型/工具调用并关闭事件通道，`ManagedRunner.Cancel(requestID)` 能跨 goroutine 按 ID 取消，`WithDetachedCancel` 还能让 run 脱离父 ctx 独立存活——不懂 Context，就用不好取消、超时与多租户隔离。

## 核心概念

Go 标准库的 `context.Context` 是并发 goroutine 之间传递 **截止时间（deadline）**、**取消信号（cancel）** 和 **请求作用域值（value）** 的标准载体。它本身不可变，所有衍生操作都返回一个**新的子 ctx**，并构成一棵从 `context.Background()` 出发的树。

四种衍生方式：

| 函数 | 用途 | 触发取消的条件 |
|------|------|----------------|
| `context.WithCancel(parent)` | 手动取消 | 调用返回的 `cancel()` |
| `context.WithTimeout(parent, d)` | 相对超时 | 到达 `now + d` 或调用 `cancel()` |
| `context.WithDeadline(parent, t)` | 绝对截止 | 到达时刻 `t` 或调用 `cancel()` |
| `context.WithValue(parent, k, v)` | 携带请求作用域数据 | 不引入取消 |

**父子传播是 Context 最关键的语义**：取消 parent 会级联取消它派生出的所有 children。子 ctx 通过 `<-ctx.Done()` 这个 channel 接收信号，通过 `ctx.Err()` 判断原因——`context.Canceled` 表示被显式取消，`context.DeadlineExceeded` 表示超时。

下面是一个最小可运行示例，展示 goroutine 监听 `ctx.Done()`、main 主动取消的标准范式：

```go
package main

import (
	"context"
	"errors"
	"fmt"
	"time"
)

func worker(ctx context.Context) {
	ticker := time.NewTicker(100 * time.Millisecond)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done(): // 接收取消/超时信号
			if errors.Is(ctx.Err(), context.DeadlineExceeded) {
				fmt.Println("worker: 超时退出")
			} else {
				fmt.Println("worker: 被取消")
			}
			return
		case <-ticker.C:
			fmt.Println("worker: tick")
		}
	}
}

func main() {
	// WithCancel 派生子 ctx；cancel 必须被调用，否则资源泄漏。
	ctx, cancel := context.WithCancel(context.Background())
	go worker(ctx)

	time.Sleep(350 * time.Millisecond)
	cancel() // 取消会级联到 worker 持有的子 ctx

	time.Sleep(100 * time.Millisecond) // 等待 worker 打印退出日志
}
```

记住一条铁律：**凡是用 `WithCancel` / `WithTimeout` / `WithDeadline` 派生的 ctx，都必须调用对应的 `cancel()`**（通常 `defer cancel()` 兜底），否则会泄漏内部资源。

## 在 trpc-agent-go 里

`Runner.Run` 把 ctx 作为整轮 run 的控制入口（接口定义 `runner/runner.go:204-210`）：

```go
Run(ctx context.Context, userID, sessionID string,
    message model.Message, runOpts ...agent.RunOption,
) (<-chan *event.Event, error)
```

它返回一个**事件 channel**，agent 在内部 goroutine 里持续往里写事件，调用方对 `eventCh` 做 `for range` 消费。这决定了取消语义的关键点：**取消 ctx 让 agent goroutine 通过 `ctx.Done()` 感知并停止产出事件，然后关闭 channel；消费者必须把 channel 读到关闭为止**，否则写端会阻塞。

在 `runner/runner.go:1365-1366`，事件循环把 `ctx.Done()` 当作正常退出分支：

```go
select {
case agentEvent, ok := <-loop.agentEventCh:
    // ...
case <-ctx.Done():
    return
}
```

trpc-agent-go 提供 **三种取消模式**（详见 `trpc-agent-go/docs/mkdocs/zh/runner.md`）。

### 模式 1：直接 cancel 传入的 ctx（Ctrl+C / 超时）

最基础也最常见。把 `signal.NotifyContext` 或 `context.WithTimeout` 包出来的 ctx 传给 `Run`，取消它即停止本次 run。命令行程序里 Ctrl+C 通常这样桥接（`docs/mkdocs/zh/runner.md:1451-1467`）：

```go
ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt)
defer stop()

eventCh, err := r.Run(ctx, userID, sessionID, message)
if err != nil {
    return err
}
for range eventCh {
    // 一直读到通道关闭：要么 ctx 被取消，要么 run 正常结束。
}
```

注意 `examples/runner/main.go:83` 用的是 `context.Background()`——这意味着 quickstart 示例**没有取消能力**，只能等 run 自然结束。生产代码应当始终用可取消的 ctx。

### 模式 2：`ManagedRunner.Cancel(requestID)` 跨 goroutine 取消

服务端场景下，发起 run 的 goroutine 和想取消它的 goroutine 往往不是同一个。trpc-agent-go 的做法是：用 `agent.WithRequestID` 给 run 打标识，再把 runner 断言为 `ManagedRunner`（接口定义在 `runner/runner.go:218-234`），按 ID 取消（`docs/mkdocs/zh/runner.md:1517-1545`）：

```go
requestID := "req-123"

eventCh, err := r.Run(
	ctx, userID, sessionID, message,
	agent.WithRequestID(requestID),
)
if err != nil {
	return err
}

mr := r.(runner.ManagedRunner)
_ = mr.Cancel(requestID) // 任意 goroutine 都能调用

for range eventCh { // 仍然要 drain
}
```

`runner.Cancel` 内部（`runner/runner.go:949-956`）查找该 requestID 注册的 `context.CancelFunc` 并调用，找不到则返回 `false`。这正是 Go context 父子传播的服务端延伸：run 在注册时把 cancel 函数存进 `runHandle`（`runner/runner.go:1056-1060`），任意 goroutine 都能按 ID 触发它。

### 模式 3：`WithDetachedCancel(true)` — 脱离父 ctx

默认情况下父 ctx 取消会停止 run。但 HTTP handler 返回时 ctx 会被自动取消，如果你希望 run 在后台继续跑完（比如落库、异步总结），就开启 detached 模式：父 ctx 的 cancel **不影响** run，只有 `MaxRunDuration` 或显式 `Cancel(requestID)` 能停（`docs/mkdocs/zh/runner.md:567-590`）：

```go
eventChan, err := r.Run(
	ctx, userID, sessionID, message,
	agent.WithRequestID(requestID),
	agent.WithDetachedCancel(true),
	agent.WithMaxRunDuration(30*time.Second),
)
```

实现在 `runner/runner.go:1000-1030` 的 `newExecutionContext`：先 `CloneContext`，若 `ro.DetachedCancel` 为真则用 `context.WithoutCancel` 抹掉父级取消信号，再叠加超时或 `WithCancel`：

```go
execCtx := agent.CloneContext(ctx)
if ro.DetachedCancel {
	execCtx = context.WithoutCancel(execCtx)
}
if hasTimeout {
	return context.WithTimeout(execCtx, timeout)
}
return context.WithCancel(execCtx)
```

> 注意：detached 模式下唯一能停 run 的手段是 `MaxRunDuration` 超时或 `ManagedRunner.Cancel(requestID)`。如果两者都没配，run 会一直跑到自然结束——务必显式设上限。

## 常见陷阱

### ❌ 启动 goroutine 时不传 ctx

```go
// ❌ 子 goroutine 拿不到取消信号，ctx 取消后它仍在跑
go func() {
    for { doWork() } // 永远不会停
}()
```

```go
// ✅ 把 ctx 显式传给子 goroutine，让它监听 Done
go func(ctx context.Context) {
    for {
        select {
        case <-ctx.Done():
            return
        default:
            doWork()
        }
    }
}(ctx)
```

trpc-agent-go 内部所有长耗时组件（LLM 调用、工具执行、事件循环）都接收并检查 `ctx`——这是“协作式取消”的前提。

### ❌ `Runner.Run` 返回 eventChan 后只 break 不 drain

```go
// ❌ ctx 取消了就 break，但 agent goroutine 还在写 channel → 写端阻塞、goroutine 泄漏
for evt := range eventCh {
    if evt.IsFinalResponse() { break }
}
cancel()
```

```go
// ✅ 先取消，再把 channel 读到关闭为止；要尽早返回就用单独 goroutine drain
go func() { for range eventCh {} }() // drain
cancel()
return nil
```

`docs/mkdocs/zh/runner.md:1558-1563` 明确警告：**只 break 事件循环**是常见误区，run 可能还在后台继续并在写通道时阻塞。

### ❌ 忘记调用 `cancel()`

```go
// ❌ WithCancel/WithTimeout/WithDeadline 返回的 cancel 不调用，会泄漏内部资源
ctx, _ := context.WithTimeout(parent, 5*time.Second)
r.Run(ctx, ...)
```

```go
ctx, cancel := context.WithTimeout(parent, 5*time.Second)
defer cancel() // ✅ 永远 defer cancel()，即使函数提前返回或 ctx 提前到期
r.Run(ctx, ...)
```

go vet 会对此报警；这是 Go 并发里最经典的资源泄漏来源。

### ❌ 用 `ctx.Value` 当参数传递通道
```go
// ❌ 把业务参数塞进 ctx.Value，绕过函数签名 → 难以测试、难以追踪
ctx = context.WithValue(ctx, "userID", "u-123")
ctx = context.WithValue(ctx, "model", "deepseek-v4")
```

```go
// ✅ ctx.Value 只放请求作用域元数据（trace ID、认证身份）；业务参数走显式签名
r.Run(ctx, "u-123", sessionID, message, agent.WithModel("deepseek-v4"))
```

`context.WithValue` 的官方建议是仅用于跨 API 边界、不依赖具体类型的元数据——滥用它会摧毁类型安全与可读性。

## 小结

- `context.Context` 用 `Done()` 传取消、用 `Err()` 区分 `Canceled` / `DeadlineExceeded`，**取消父级会级联取消所有子级**——这是 trpc-agent-go 整轮 run 停止的底层机制。
- trpc-agent-go 的三种取消模式按场景选：CLI 用 `signal.NotifyContext`，服务端跨 goroutine 用 `ManagedRunner.Cancel(requestID)`，后台 run 用 `WithDetachedCancel(true)` + `WithMaxRunDuration`。
- 取消后**必须把 `Runner.Run` 返回的事件 channel 读到关闭**，否则 agent goroutine 写端阻塞、造成泄漏。
- `WithCancel` / `WithTimeout` / `WithDeadline` 派生的 ctx，**必须调用对应的 `cancel()`**，习惯用 `defer cancel()` 兜底。

### 延伸阅读

- [取消运行示例](../examples/00-runner-executor/cancelrun.md) — 按 Enter/Ctrl+C 安全取消并 drain 事件通道
- [ManagedRunner 示例](../examples/00-runner-executor/managedrunner.md) — requestID 取消、detached cancel、最长运行时长
- [Go 官方：context 包](https://pkg.go.dev/context)
- [并发模型与 Channel 事件流](./01-concurrency-channel)
