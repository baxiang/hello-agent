# Dify 集成 - 对接 Dify 工作流与对话流

## 概述

Dify 示例演示了如何使用 tRPC-Agent-Go 的 `agent/dify` 包与 Dify 平台的工作流（Workflow）和对话流（Chatflow）进行集成。示例包含三个子场景：基础对话（basic_chat）、流式对话（streaming_chat）和高级用法（advanced_usage），覆盖了从简单接入到自定义转换器的完整使用路径。

## 核心概念

### Dify Agent 适配器

`agent/dify` 包将 Dify 平台封装为 tRPC-Agent-Go 的标准 Agent 接口，使其可以无缝接入框架的 Runner、Session 等基础设施。Dify Agent 不使用本地 LLM，而是将请求转发给 Dify 平台处理。

### 自定义客户端工厂

通过 `WithGetDifyClientFunc` 可为每次调用动态创建 Dify 客户端，支持多租户、动态密钥等场景：

```go
dify.WithGetDifyClientFunc(func(invocation *agent.Invocation) (*difySDK.Client, error) {
    apiSecret := getUserAPISecret(invocation.Session.UserID)
    return difySDK.NewClientWithConfig(&difySDK.ClientConfig{
        Host:             difyBaseURL,
        DefaultAPISecret: apiSecret,
        Timeout:          30 * time.Second,
    }), nil
})
```

## 代码解析

### 基础对话（basic_chat）

最简配置，非流式模式：

```go
difyAgent, _ := dify.New(
    dify.WithBaseUrl(difyBaseURL),
    dify.WithName("dify-chat-assistant"),
    dify.WithEnableStreaming(false),
    dify.WithGetDifyClientFunc(...),
)
chatRunner := runner.NewRunner("dify-chat-runner", difyAgent,
    runner.WithSessionService(inmemory.NewSessionService()),
)
```

通过标准的 `runner.Run` 调用和事件通道消费响应。

### 流式对话（streaming_chat）

启用流式模式并注册自定义流式处理器：

```go
streamingHandler := func(resp *model.Response) (string, error) {
    if len(resp.Choices) > 0 {
        content := resp.Choices[0].Delta.Content
        fmt.Print(content) // 实时输出
        return content, nil
    }
    return "", nil
}

dify.WithEnableStreaming(true),
dify.WithStreamingRespHandler(streamingHandler),
dify.WithStreamingChannelBufSize(2048),
```

示例还计算了响应指标（耗时、分块数、字符速率），便于性能监控。

### 高级用法（advanced_usage）

实现自定义事件转换器和请求转换器：

```go
type CustomEventConverter struct{}
func (c *CustomEventConverter) ConvertToEvent(
    resp *difySDK.ChatMessageResponse, agentName string, invocation *agent.Invocation,
) *event.Event {
    content := fmt.Sprintf("[Dify:%s] %s", resp.ConversationID, resp.Answer)
    // 自定义事件构造逻辑
}
```

通过 `WithTransferStateKey` 将运行时状态自动传递到 Dify 的 inputs 参数：

```go
dify.WithTransferStateKey("user_language", "response_tone", "expertise_level"),
```

结合 `agent.WithRuntimeState` 实现基于用户偏好的动态响应。

## 运行方式

**环境准备**：

```bash
export DIFY_BASE_URL="https://api.dify.ai/v1"
export DIFY_API_SECRET="your-dify-api-secret"
```

**运行命令**：

```bash
# 基础对话
cd examples/dify && go run ./basic_chat/

# 流式对话
cd examples/dify && go run ./streaming_chat/

# 高级用法
cd examples/dify && go run ./advanced_usage/
```

## 总结

Dify 示例展示了框架将外部 AI 平台封装为标准 Agent 的能力。通过自定义转换器可实现响应格式定制、元数据注入和状态传递等高级功能。该模式同样适用于 n8n 等其他外部平台的集成，两者共享相似的适配器设计思路。
