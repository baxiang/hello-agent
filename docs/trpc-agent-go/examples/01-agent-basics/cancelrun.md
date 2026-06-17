# Cancel Run 示例 - 安全停止运行中的 Agent

## 概述

本示例回答了一个常见问题："Agent 正在运行，如何安全地停止它？"。在 tRPC-Agent-Go 中，正确的做法是取消传给 `Runner.Run` 的 `context.Context`，而不是简单地退出事件消费循环。示例演示了通过按 Enter 键或 Ctrl+C 两种方式安全取消运行。

## 核心概念

### Context 取消机制

Go 的 `context.Context` 是 Agent 运行的生命线。取消 context 会触发以下链路：

```
用户取消 → context.Cancel() → Agent goroutine 检测 ctx.Done() → 停止产生事件 → 关闭通道 → 消费者退出循环
```

**错误做法：** 只停止读取事件通道（`break` 退出 `for range`），Agent goroutine 可能继续运行并阻塞在通道写入上。

**正确做法：** 先取消 context，然后继续消费事件直到通道关闭。

### agent.CloneContext

自定义 Agent 在 `Run` 方法中应使用 `agent.CloneContext(ctx)` 创建运行上下文：

```go
runCtx := agent.CloneContext(ctx)
go func() {
    for {
        select {
        case <-runCtx.Done(): return  // 响应取消
        case <-ticker.C: // 继续工作
        }
    }
}()
```

这确保 Agent 正确响应 Runner 层面的取消信号。

### signal.NotifyContext

`signal.NotifyContext` 将操作系统信号（如 SIGINT/Ctrl+C）桥接到 context 取消：

```go
baseCtx, stop := signal.NotifyContext(context.Background(), os.Interrupt)
```

## 代码解析

**1. 构建取消链路**

```go
// 1. 操作系统信号 → context
baseCtx, stop := signal.NotifyContext(context.Background(), os.Interrupt)
defer stop()

// 2. 超时保护
ctx, cancel := context.WithTimeout(baseCtx, 15*time.Second)
defer cancel()

// 3. Enter 键 → 取消
go cancelOnEnter(cancel)
```

三层保护：Ctrl+C 信号取消、15 秒超时自动取消、Enter 键手动取消。

**2. 自定义 slowWriter Agent**

```go
type slowWriter struct {
    name  string
    delay time.Duration  // 每个 chunk 的间隔 (120ms)
}
```

`slowWriter` 是一个不调用 LLM 的自定义 Agent，每 120ms 发射一个文本 chunk，模拟长时间运行的流式输出。

**3. 安全的消费者模式**

```go
func printEvents(eventCh <-chan *event.Event) {
    for evt := range eventCh {     // 持续消费直到通道关闭
        // ... 打印内容
    }
}
```

关键：使用 `for range` 消费事件通道，它会在通道关闭后自动退出。不要提前 break。

**4. 输出退出原因**

```go
func printExitReason(ctx context.Context) {
    switch {
    case errors.Is(ctx.Err(), context.Canceled):
        fmt.Println("Run stopped: context canceled.")     // Enter 或 Ctrl+C
    case errors.Is(ctx.Err(), context.DeadlineExceeded):
        fmt.Println("Run stopped: timeout reached.")      // 超时
    default:
        fmt.Println("Run finished.")                       // 正常完成
    }
}
```

通过 `ctx.Err()` 区分三种退出场景。

## 运行方式

本示例不调用外部 LLM，无需 API Key：

```bash
cd examples/cancelrun
go run .
```

**预期输出：**

```
Cancel a Run demo
Press Enter to cancel.
Press Ctrl+C to cancel (SIGINT).

Streaming some text...
Press Enter (or Ctrl+C) to stop.

chunk 1
chunk 2
chunk 3
                    # 按下 Enter
Run stopped: context canceled.
```

## 总结

本示例是理解 tRPC-Agent-Go **取消机制** 的必读示例，核心要点：

- 通过取消 `context.Context` 停止 Agent，而非停止读取事件
- 使用 `signal.NotifyContext` 处理系统信号
- 取消后继续消费事件直到通道关闭
- 通过 `ctx.Err()` 判断退出原因

与 **managedrunner** 示例配合阅读：本示例侧重用户侧交互式取消，managedrunner 侧重服务端编程式控制。
