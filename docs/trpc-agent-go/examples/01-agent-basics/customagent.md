# Custom Agent 示例 - 手动实现 Agent 接口进行意图分支

## 概述

本示例演示如何直接实现 `agent.Agent` 接口来构建自定义 Agent，而无需依赖 Graph 或 Workflow 编排。示例通过 LLM 进行意图分类（闲聊 / 任务），然后根据分类结果走不同的处理分支。适合希望将 LLM 嵌入已有业务代码，同时保持完全控制权的场景。

## 核心概念

### agent.Agent 接口

tRPC-Agent-Go 的所有 Agent 都需实现 `agent.Agent` 接口，核心方法包括：

```go
type Agent interface {
    Info() Info                                                    // Agent 元信息
    Run(ctx context.Context, invocation *Invocation) (<-chan *event.Event, error) // 执行逻辑
    Tools() []tool.Tool                                            // 可用工具
    SubAgents() []Agent                                            // 子 Agent
    FindSubAgent(string) Agent                                     // 查找子 Agent
}
```

自定义 Agent 需要实现上述所有方法，其中 `Run` 是核心执行入口。

### Invocation 调用上下文

`agent.Invocation` 携带了本次调用的全部上下文，包括用户消息 (`Message`)、Agent 名称 (`AgentName`)、模型引用 (`Model`) 和调用 ID (`InvocationID`) 等。自定义 Agent 可在 `Run` 方法中对其补全。

### EmitEvent 事件发射

通过 `agent.EmitEvent(ctx, inv, out, event)` 向事件通道发射事件，这是自定义 Agent 与 Runner/消费者通信的标准方式。

## 代码解析

**1. 实现 Agent 接口**

`SimpleIntentAgent` 结构体持有名称、描述和模型引用，实现了 `agent.Agent` 的全部方法：

```go
type SimpleIntentAgent struct {
    name        string
    description string
    model       model.Model
}
```

**2. Run 方法：异步执行 + 意图分支**

```go
func (a *SimpleIntentAgent) Run(ctx context.Context, invocation *agent.Invocation) (<-chan *event.Event, error) {
    out := make(chan *event.Event, 64)
    go func() {
        defer close(out)
        intent := a.classifyIntent(ctx, invocation)  // 第一步：意图分类
        switch intent {
        case "chitchat":
            a.replyChitChat(ctx, invocation, out)     // 闲聊回复
        case "task":
            a.replyTaskPlan(ctx, invocation, out)     // 任务规划
        }
    }()
    return out, nil
}
```

关键设计：创建带缓冲的通道，启动 goroutine 异步执行，立即返回通道供消费者消费。

**3. 意图分类：直接调用模型**

```go
func (a *SimpleIntentAgent) classifyIntent(ctx context.Context, inv *agent.Invocation) string {
    sys := model.NewSystemMessage("You are an intent classifier. Output only 'chitchat' or 'task'.")
    req := &model.Request{
        Messages: []model.Message{sys, inv.Message},
        GenerationConfig: model.GenerationConfig{Stream: false},
    }
    rspCh, err := a.model.GenerateContent(ctx, req)
    // ... 累积响应并解析意图标签
}
```

直接使用 `model.Model.GenerateContent` 调用 LLM，绕过 Agent 框架。分类请求使用非流式模式，结果不暴露给用户。

**4. 分支响应：流式输出事件**

```go
func (a *SimpleIntentAgent) replyChitChat(ctx context.Context, inv *agent.Invocation, out chan<- *event.Event) {
    // ... 构造请求
    rspCh, _ := a.model.GenerateContent(ctx, req)
    for rsp := range rspCh {
        agent.EmitEvent(ctx, inv, out, event.NewResponseEvent(inv.InvocationID, a.name, rsp))
    }
}
```

每个 LLM 响应 chunk 都通过 `EmitEvent` 发射为事件，实现流式输出。

## 运行方式

```bash
cd examples/customagent
export OPENAI_API_KEY="your-api-key"
go run .                         # 默认模型
go run . -model gpt-4o-mini      # 指定模型
```

输入闲聊内容（如"你好"），Agent 会直接回复；输入任务类请求（如"帮我制定一个学习计划"），Agent 会输出步骤规划。

## 总结

本示例展示了自定义 Agent 的最小实现模式：**实现接口 → 分类意图 → 分支执行 → 流式输出**。核心收获：

- 理解 `agent.Agent` 接口的完整契约
- 掌握 `model.Model.GenerateContent` 直接调用模型的方式
- 学会通过 `agent.EmitEvent` 向消费者发射事件

当业务逻辑复杂度增长后，可以从本示例演进到 `ChainAgent`、`ParallelAgent` 或 `GraphAgent` 来实现更复杂的编排。
