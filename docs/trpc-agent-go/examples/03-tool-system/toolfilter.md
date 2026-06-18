# 工具过滤 - 运行时动态控制可用工具

## 概述

`toolfilter` 示例演示了 `agent.WithToolFilter` API，展示如何在每次运行时动态过滤 Agent 可用的工具。这用于实现基于角色的权限控制、按需裁剪工具列表以优化 Token 消耗、或根据任务类型动态选择工具集。

## 核心概念

工具过滤是一个**每次运行（per-run）**的配置，通过 `agent.WithToolFilter(filter)` 传入 `runner.Run()`。过滤器是一个函数签名为 `func(ctx context.Context, tool Tool) bool` 的函数，返回 `true` 保留工具，`false` 移除工具。

框架工具（如 `transfer_to_agent`）永远不会被过滤，确保多 Agent 系统的基本功能不受影响。

## 代码解析

### 三种过滤方式

**方式一：排除过滤（黑名单）**

```go
filter := tool.NewExcludeToolNamesFilter("text_tool")
runner.Run(ctx, userID, sessionID, message,
    agent.WithToolFilter(filter),
)
```

**方式二：包含过滤（白名单）**

```go
filter := tool.NewIncludeToolNamesFilter("calculator", "time_tool")
runner.Run(ctx, userID, sessionID, message,
    agent.WithToolFilter(filter),
)
```

**方式三：自定义 per-Agent 过滤**

通过 `agent.InvocationFromContext(ctx)` 获取当前 Agent 名称，实现每个 Agent 使用不同工具集：

```go
filter := func(ctx context.Context, t tool.Tool) bool {
    inv, ok := agent.InvocationFromContext(ctx)
    if !ok || inv == nil {
        return true
    }
    agentName := inv.AgentName
    allowedTools := agentAllowedTools[agentName]
    return allowedTools[t.Declaration().Name]
}
```

### 配合 OpenAI 回调验证

示例通过 `openai.WithChatRequestCallback` 打印每次请求中实际发送给 LLM 的工具列表，便于验证过滤效果：

```go
openai.WithChatRequestCallback(func(ctx context.Context, req *openaigo.ChatCompletionNewParams) {
    toolNames := make([]string, 0, len(req.Tools))
    for _, t := range req.Tools {
        toolNames = append(toolNames, t.Function.Name)
    }
    fmt.Printf("Tools in request: %v\n", toolNames)
})
```

### 多 Agent 架构

示例构建了 Coordinator + 子 Agent 的多 Agent 架构，通过 `WithSubAgents` 注册：

```go
coordinatorAgent := llmagent.New("coordinator",
    llmagent.WithSubAgents([]agent.Agent{mathAgent, timeAgent}),
)
```

## 运行方式

```bash
cd examples/toolfilter
export OPENAI_API_KEY="your-key"

# 无过滤
go run .

# 排除 text_tool
go run . -filter=exclude-demo

# 仅保留 calculator 和 time_tool
go run . -filter=include-demo

# 按 Agent 分别过滤
go run . -filter=per-agent
```

## 总结

- 工具过滤在 `runner.Run()` 时设置，每次请求可以不同
- 三种常用模式：白名单、黑名单、自定义函数
- 过滤是 UX/成本优化手段，**不是安全机制**——工具内部仍需实现权限校验
- 减少工具描述可降低 Token 消耗，参见 [toolpolicy](./toolpolicy.md) 了解权限策略
