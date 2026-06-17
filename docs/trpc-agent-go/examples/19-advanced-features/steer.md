# 运行中消息注入 - 在Agent执行期间动态插入用户消息

## 概述

在 Agent 执行长时间工具调用期间，用户可能需要追加新的指令来调整输出方向。`steer` 示例演示了如何通过 `runner.EnqueueUserMessage` 在单次 `Run` 执行过程中安全地注入额外用户消息，使 Agent 在下一次模型调用时能看到并响应新需求。

## 核心概念

**用户消息转向**（Steering）是 Runner 提供的一种运行中通信机制。通过 `runner.EnqueueUserMessage(r, requestID, message)` 可以将消息排入指定 `requestID` 的执行队列。当前工具执行完成后，Agent 会在构建下一次模型请求时将排队的用户消息一并纳入上下文。

关键点：
- 消息注入是 **异步** 的，不会中断当前工具执行
- 注入需要匹配正确的 `requestID`
- Agent 在工具结果返回后、下一次模型调用前处理排队消息
- 适用于工具调用耗时较长的场景

## 代码解析

示例的核心逻辑分为两部分：

**启动 Run 并异步注入消息：**

```go
go d.enqueueSteer(ctx, r, requestID)

eventChan, err := r.Run(
    ctx, userID, sessionID,
    model.NewUserMessage(d.question),
    agent.WithRequestID(requestID),
)
```

**定时注入逻辑：**

```go
func (d *steerDemo) enqueueSteer(ctx context.Context, r runner.Runner, requestID string) {
    select {
    case <-ctx.Done():
        return
    case <-time.After(d.steerAfter):
    }
    err := runner.EnqueueUserMessage(r, requestID, model.NewUserMessage(d.steerText))
    // ...
}
```

工具 `load_launch_brief` 故意设置了 2 秒延迟，而消息注入在 1 秒后触发。这样当工具返回结果时，额外的用户消息已在队列中等待。模型在最终回复时会将工具结果和新用户要求一并考虑。

## 运行方式

```bash
cd examples

export OPENAI_API_KEY="your-key"

go run ./steer -model=gpt-4.1-mini

# 自定义延迟和消息
go run ./steer \
  -model=gpt-4.1-mini \
  -tool-delay=3s \
  -steer-after=1s \
  -steer="请用中文改写并加入更多细节"
```

预期输出会显示工具调用过程和排队消息的注入时机，最终 Assistant 的回复应同时反映工具结果和注入的额外要求。

## 总结

消息转向是构建交互式 Agent 应用的重要能力，允许用户在 Agent 工作过程中实时调整方向。这种模式特别适合长时间运行的任务、需要人工介入的审批流程等场景。与 `react` 示例中的规划能力结合使用，可以实现更灵活的人机协作工作流。
