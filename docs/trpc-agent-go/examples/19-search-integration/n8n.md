# n8n 集成 - 对接 n8n 工作流自动化平台

## 概述

n8n 示例演示了如何使用 tRPC-Agent-Go 的 `agent/n8n` 包将 n8n 工作流自动化平台接入 Agent 系统。通过 Webhook 触发 n8n 工作流并获取响应，支持非流式和流式两种模式。适用于需要将已有 n8n 自动化流程整合到 AI Agent 系统中的场景。

## 核心概念

### Webhook 驱动的 Agent

n8n Agent 通过 HTTP Webhook 与 n8n 实例通信。用户消息作为 POST 请求发送到 n8n 的 Webhook 节点，n8n 执行工作流后将结果返回。这种设计使 n8n 的全部节点能力（AI Agent、HTTP 请求、代码执行等）都可作为 Agent 的后端。

### 认证配置

支持多种认证方式，通过 `WithAuthType` 和 `WithAuthConfig` 配置：

```go
// Header 认证（Bearer Token）
n8n.WithAuthType(n8n.AuthHeader),
n8n.WithAuthConfig(&n8n.AuthConfig{
    HeaderName:  "Authorization",
    HeaderValue: "Bearer " + apiKey,
})

// Basic 认证
n8n.WithAuthType(n8n.AuthBasic),
n8n.WithAuthConfig(&n8n.AuthConfig{
    Username: "user",
    Password: "pass",
})
```

## 代码解析

### 基础对话（basic_chat）

非流式模式的最简配置：

```go
opts := []n8n.Option{
    n8n.WithWebhookURL(webhookURL),
    n8n.WithName("n8n-chat-assistant"),
    n8n.WithEnableStreaming(false),
}
n8nAgent, _ := n8n.New(opts...)
chatRunner := runner.NewRunner("n8n-chat-runner", n8nAgent,
    runner.WithSessionService(inmemory.NewSessionService()),
)
```

事件处理直接读取 `event.Response.Done` 为 `true` 时的完整响应内容。

### 流式对话（streaming_chat）

启用 SSE（Server-Sent Events）流式响应：

```go
streamingHandler := func(resp *model.Response) (string, error) {
    if len(resp.Choices) > 0 {
        content := resp.Choices[0].Delta.Content
        fmt.Print(content)
        return content, nil
    }
    return "", nil
}

n8n.WithEnableStreaming(true),
n8n.WithStreamingRespHandler(streamingHandler),
n8n.WithStreamingChannelBufSize(2048),
```

n8n 端需配置 Respond to Webhook 节点输出 SSE 格式：每个分块为 `data: {"output": "chunk text"}\n\n`，以 `data: [DONE]\n\n` 结束。

### 响应指标统计

流式示例计算了完整的响应性能指标：

```go
duration := time.Since(startTime)
totalChars := aggregatedContent.Len()
charsPerSec := float64(totalChars) / duration.Seconds()
```

同时验证了流式聚合内容与最终响应的一致性，便于排查数据丢失问题。

## 运行方式

**环境准备**：

1. 部署 n8n 实例（自托管或云版本）
2. 创建包含 Webhook 触发器的工作流
3. 设置环境变量：

```bash
export N8N_WEBHOOK_URL="https://your-n8n-instance.com/webhook/your-webhook-id"
export N8N_API_KEY="your-api-key"  # 可选
```

**运行命令**：

```bash
cd examples/n8n

# 基础对话
go run ./basic_chat/

# 流式对话
go run ./streaming_chat/
```

## 总结

n8n 示例展示了框架通过 Webhook 适配器集成外部工作流平台的能力。与 Dify 示例的设计思路一致：将外部平台封装为标准 Agent 接口，复用框架的 Runner 和 Session 基础设施。n8n 的优势在于其丰富的节点生态，可以快速组合各种自动化能力作为 Agent 的后端服务。
