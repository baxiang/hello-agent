# Managed Runner 示例 - 后台运行控制与分离式取消

## 概述

本示例演示如何使用 `ManagedRunner` 接口对运行中的 Agent 进行精细控制，包括分离式取消（Detached Cancel）、按 RequestID 手动取消、最大运行时长限制和运行状态轮询。适合需要在后台运行 Agent 并保持控制权的服务端场景。

## 核心概念

### ManagedRunner

`runner.ManagedRunner` 是 `runner.Runner` 的增强接口，提供运行管理能力：

- `Cancel(requestID)`: 按请求 ID 取消指定运行
- `RunStatus(requestID)`: 查询指定运行的状态（事件计数、最后事件时间等）

通过类型断言从普通 Runner 获取：

```go
managedRunner, ok := baseRunner.(runner.ManagedRunner)
```

### Detached Cancel（分离式取消）

默认情况下，父 `context.Context` 取消时，Agent 运行也会停止。启用 `agent.WithDetachedCancel(true)` 后：

- **父 context 取消** → Agent 运行 **不会** 停止
- **Deadline/超时** → Agent 运行 **仍会** 停止
- **手动 Cancel** → Agent 运行 **会** 停止

这对于 HTTP 请求处理特别有用：客户端断开连接不应中断 Agent 执行。

### MaxRunDuration（最大运行时长）

`agent.WithMaxRunDuration(duration)` 设置运行的最长时间。Runner 会取父 context deadline 和 MaxRunDuration 中较早的那个作为实际截止时间。

## 代码解析

本示例实现了一个 `tickerAgent`（不调用 LLM），每 200ms 发射一个 tick 事件，用于演示运行控制：

```go
func (a *tickerAgent) Run(ctx context.Context, invocation *agent.Invocation) (<-chan *event.Event, error) {
    out := make(chan *event.Event, eventChannelBufSize)
    runCtx := agent.CloneContext(ctx)
    go func(ctx context.Context) {
        defer close(out)
        ticker := time.NewTicker(a.tickInterval)
        for {
            select {
            case <-ctx.Done(): return
            case <-ticker.C:
                agent.EmitEvent(ctx, invocation, out, tickEvent(...))
            }
        }
    }(runCtx)
    return out, nil
}
```

**Demo 1: 分离式取消 + 最大运行时长**

```go
eventChan, _ := managedRunner.Run(parentCtx, userID, session, msg,
    agent.WithRequestID(requestID),
    agent.WithDetachedCancel(true),     // 父 ctx 取消不影响运行
    agent.WithMaxRunDuration(2*time.Second), // 最多运行 2 秒
)
```

父 context 在 500ms 后取消，但 Agent 继续运行直到 2 秒超时。

**Demo 2: 按 RequestID 手动取消**

```go
go func() {
    time.Sleep(1 * time.Second)
    managedRunner.Cancel(requestIDManualCancel)  // 1 秒后手动取消
}()
```

即使设置了 10 秒的 MaxRunDuration，也可以通过 `Cancel(requestID)` 提前终止。

**Demo 3: 父 deadline 与 MaxRunDuration 取较小值**

```go
parentCtx, _ := context.WithTimeout(context.Background(), 1200*time.Millisecond)
managedRunner.Run(parentCtx, ...,
    agent.WithMaxRunDuration(5*time.Second),  // 实际以 1.2 秒为准
)
```

**状态轮询：**

```go
status, ok := managedRunner.RunStatus(requestID)
fmt.Printf("events=%d last=%s\n", status.EventCount, status.LastEventAt)
```

## 运行方式

本示例不调用外部 LLM，无需 API Key：

```bash
cd examples/managedrunner
go run .
```

**预期输出：**

```
Demo 1: detached cancellation + max runtime
  parent cancel after: 500ms
  max run duration:    2s
  -> parent ctx cancelled        # 500ms: 父 ctx 取消，Agent 继续运行
[1.8s] ticker-agent: tick 9
[2s] runner completion           # 2s: MaxRunDuration 到期，Agent 停止

Demo 2: cancel a run by requestID
  -> managed cancel called       # 1s: 手动取消生效
```

## 总结

本示例展示了 tRPC-Agent-Go 的 **运行控制能力**：

- `WithDetachedCancel(true)` 使 Agent 不受父 context 取消影响
- `WithMaxRunDuration` 设置安全超时
- `ManagedRunner.Cancel(requestID)` 精确取消指定运行
- `ManagedRunner.RunStatus(requestID)` 实时查询运行状态

与 **cancelrun** 示例互补：cancelrun 展示用户侧取消（Enter/Ctrl+C），本示例展示服务端编程式控制。
