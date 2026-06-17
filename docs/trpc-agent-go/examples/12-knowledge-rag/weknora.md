# WeKnora 示例 - 集成 WeKnora 知识 Agent 的流式对话

## 概述

本示例演示如何将 WeKnora Agent 集成到 tRPC-Agent-Go 框架中，实现支持流式响应的知识问答对话。WeKnora 是一个外部知识代理服务，本示例展示了框架对第三方 Agent 服务的统一适配能力——通过实现 `agent.Agent` 接口，任何外部 Agent 都可以无缝接入 Runner 执行管线。

## 核心概念

### WeKnora Agent

`weknora.New()` 创建一个 WeKnora Agent 实例，它实现了框架的 `agent.Agent` 接口，将 WeKnora 的远程 API 调用封装为框架标准的事件流。核心配置项：

- **WithBaseUrl / WithToken**：WeKnora 服务的连接凭证
- **WithAgentID**：指定使用的 WeKnora Agent
- **WithWebSearchEnabled**：启用 Web 搜索增强
- **WithTimeout**：设置请求超时时间

### 统一的 Runner 执行模型

无论底层是 LLMAgent、WeKnora 还是其他自定义 Agent，`runner.NewRunner()` 提供一致的执行接口。这意味着可以在不改变上层逻辑的情况下替换底层 Agent 实现。

### 流式响应统计

示例展示了如何在流式场景下统计响应指标（总耗时、分块数、字符数、吞吐速率），这在评估不同 Agent 后端性能时非常实用。

## 代码解析

**1. 创建 WeKnora Agent**

```go
weknoraAgent, _ := weknora.New(
    weknora.WithBaseUrl(os.Getenv("WEKNORA_BASE_URL")),
    weknora.WithToken(os.Getenv("WEKNORA_TOKEN")),
    weknora.WithName("weknora-streaming-assistant"),
    weknora.WithAgentID(os.Getenv("WEKNORA_AGENT_ID")),
    weknora.WithWebSearchEnabled(true),
    weknora.WithTimeout(5 * time.Minute),
)
```

通过环境变量配置连接参数，`WithWebSearchEnabled(true)` 启用 Web 搜索以扩展知识覆盖范围。

**2. 接入 Runner 并处理流式事件**

```go
chatRunner := runner.NewRunner("weknora-streaming-runner", weknoraAgent,
    runner.WithSessionService(inmemory.NewSessionService()),
)

events, _ := chatRunner.Run(ctx, userID, sessionID, model.NewUserMessage(userMessage))
for event := range events {
    if event.Response.IsPartial {
        fmt.Print(choice.Delta.Content)
    }
}
```

WeKnora Agent 和 LLMAgent 使用完全相同的 `runner.Run()` 调用方式和事件处理模式，体现了框架的统一抽象。

**3. 流式性能统计**

```go
duration := time.Since(startTime)
charsPerSec := float64(totalChars) / duration.Seconds()
fmt.Printf("Speed: %.1f chars/sec", charsPerSec)
```

记录分块数量和总字符数，计算每秒字符吞吐率，可用于对比不同 Agent 后端的响应性能。

## 运行方式

```bash
export WEKNORA_BASE_URL="your-weknora-base-url"
export WEKNORA_TOKEN="your-weknora-token"
export WEKNORA_AGENT_ID="your-weknora-agent-id"

cd examples/weknora/streaming_chat
go run main.go
```

需要事先在 WeKnora 平台创建 Agent 并获取对应的 Token 和 Agent ID。如果不设置 `WEKNORA_SESSION_ID`，系统会自动创建新会话。

## 总结

WeKnora 示例展示了 tRPC-Agent-Go 的开放集成能力：通过统一的 `agent.Agent` 接口，外部知识服务可以像内置 LLMAgent 一样无缝工作。与 Knowledge 示例（本地 RAG）相比，WeKnora 代表了一种托管式知识 Agent 的集成模式，适用于已有知识平台需要对接到 Agent 框架的企业场景。流式统计功能也为 Agent 后端的性能基准测试提供了参考。
