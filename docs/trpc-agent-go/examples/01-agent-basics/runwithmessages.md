# RunWithMessages 示例 - 注入外部对话历史驱动 Agent

## 概述

本示例演示如何通过 `runner.RunWithMessages` 将调用方维护的对话历史注入 Agent，而非依赖服务端 Session 自动积累。适合构建中间件服务的场景——上游系统已经维护了对话上下文，Agent 只需根据完整历史生成回复。

## 核心概念

### RunWithMessages

`runner.RunWithMessages` 是 `Runner.Run` 的扩展版本，允许传入完整的 `[]model.Message` 对话历史：

```go
func RunWithMessages(ctx context.Context, r Runner, userID, sessionID string, messages []model.Message) (<-chan *event.Event, error)
```

当 Session 为空时，Runner 会将传入的消息历史转换为 Session 事件进行持久化（自动 seed）。后续轮次可以直接使用 `Runner.Run` 只传最新消息。

### Seed Once, Then Latest Only（首次播种，后续只传最新）

这是本示例的核心模式：

1. **第一轮**：调用 `RunWithMessages`，传入 `预设历史 + 最新用户输入`
2. **后续轮次**：调用 `Runner.Run`，只传最新用户消息
3. **重置**：调用 `/reset` 清空历史，重新走第一轮流程

```go
if !seeded {
    seedHistory := append(history, userMsg)
    ch, err = runner.RunWithMessages(ctx, r, userID, sessionID, seedHistory)
    seeded = true
} else {
    ch, err = r.Run(ctx, userID, sessionID, userMsg)
}
```

## 代码解析

**1. 构造预设对话历史**

```go
func defaultSeedHistory() []model.Message {
    return []model.Message{
        model.NewSystemMessage("You are a helpful math assistant."),
        model.NewUserMessage("Hi, can you help with calculations?"),
        model.NewAssistantMessage("Sure. I can add, subtract, multiply, divide..."),
    }
}
```

预设历史包含 System Prompt 和几轮示范对话，为 Agent 建立上下文和行为模式。

**2. 注册计算工具**

```go
tools = append(tools, function.NewFunctionTool(
    calcFn,
    function.WithName("calculate"),
    function.WithDescription("Perform basic arithmetic..."),
))
```

`calcFn` 是一个纯函数（非方法），签名为 `func(ctx, calcInput) (calcOutput, error)`，展示了 Function Tool 的另一种注册方式。

**3. 首轮注入 vs 后续追加**

首轮调用 `RunWithMessages` 传入完整历史，Runner 自动将其持久化到 Session。后续轮次 Runner 从 Session 读取完整上下文，调用方只需传最新消息。

**4. 本地维护历史副本**

```go
if strings.TrimSpace(full) != "" {
    history = append(history, model.NewAssistantMessage(full))
}
```

本地也维护一份历史副本，用于 `/reset` 时重新播种。

**5. 处理工具调用链**

```go
if len(e.Choices[0].Message.ToolCalls) > 0 {
    fmt.Printf("🔧 Tool call → %s args=%s", tc.Function.Name, tc.Function.Arguments)
}
if e.Choices[0].Message.ToolID != "" {
    fmt.Printf("📦 Tool result (%s): %s", e.Choices[0].Message.ToolID, content)
}
```

事件流中可能穿插工具调用和工具结果，需要分别展示。

## 运行方式

```bash
cd examples/runwithmessages
export OPENAI_API_KEY="your-api-key"

go run main.go -model deepseek-v4-flash -streaming=true
```

**示例交互：**

```
👤 You: Please add 12.5 and 3
🤖 Assistant:
🔧 Tool call → calculate args={"operation":"add","a":12.5,"b":3}
📦 Tool result (call_xxx): {"result":15.5}
The result of 12.5 + 3 = 15.5

👤 You: /reset
🆕 History cleared. New session: runwithmessages-1703123457
```

## 总结

本示例展示了 tRPC-Agent-Go 的 **外部消息注入** 模式，核心收获：

- `runner.RunWithMessages` 支持传入完整对话历史
- "Seed Once, Then Latest Only" 模式减少重复数据传输
- 适合上游已维护对话状态的中间件/API 服务场景

与 **runner** 示例对比：runner 依赖服务端 Session 自动积累上下文，本示例由调用方完全控制对话历史。两者可根据业务架构灵活选择。
