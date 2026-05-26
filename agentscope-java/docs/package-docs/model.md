# io.agentscope.core.model — 模型包文档

## 核心接口

`Model` — 单一方法：
```java
Flux<ChatResponse> stream(List<Msg> messages, List<ToolSchema> tools, GenerateOptions options)
```

## 实现

| 类 | 描述 |
|---|---|
| `DashScopeChatModel` | 阿里云通义千问模型 |
| `OpenAIChatModel` | OpenAI GPT 模型（及兼容 API） |
| `GeminiChatModel` | Google Gemini |
| `AnthropicChatModel` | Anthropic Claude |
| `OllamaChatModel` | 本地 Ollama 模型 |

## 生成选项

`GenerateOptions` 控制每个请求的参数：
temperature、topP、maxTokens、frequencyPenalty、presencePenalty、thinkingBudget、toolChoice、executionConfig（超时/重试）、以及额外的 HTTP 头/Body 参数。

## Formatter 架构

每个模型实现使用 `Formatter` 将 AgentScope 内部 `Msg` 格式转换为提供商 API 格式：
- **OpenAI formatter** — 标准 OpenAI Chat Completions API 格式
- **Gemini formatter** — Google 的 content/role 格式

Formatter 处理消息转换、工具 Schema 生成和响应解析。

## ExecutionConfig

`ExecutionConfig` 控制超时和重试行为：超时时长、最大尝试次数、退避策略和错误过滤。

在三个层级配置（优先级从高到低）：**每请求 > Agent 级 > Toolkit 级**。

## 相关文档

- [核心包](../core.md)
- [工具包](tool.md)
