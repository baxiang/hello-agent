# OpenAI API 协议总览

## 什么是 OpenAI Chat Completions API

它不是某个框架的 SDK，而是一个 **HTTP REST API 协议**——定义了客户端和 LLM 之间的标准通信格式：

```
POST https://api.openai.com/v1/chat/completions
Authorization: Bearer sk-xxx
Content-Type: application/json

{
  "model": "gpt-4o",
  "messages": [
    {"role": "system", "content": "You are a helpful assistant."},
    {"role": "user", "content": "What is the weather?"}
  ],
  "temperature": 0.7,
  "stream": false
}
```

返回：

```json
{
  "id": "chatcmpl-xxx",
  "object": "chat.completion",
  "created": 1718236800,
  "model": "gpt-4o-2024-05-13",
  "choices": [{
    "index": 0,
    "message": {
      "role": "assistant",
      "content": "I don't have real-time weather data..."
    },
    "finish_reason": "stop"
  }],
  "usage": {
    "prompt_tokens": 25,
    "completion_tokens": 12,
    "total_tokens": 37
  }
}
```

## 为什么它成了行业标准

1. **OpenAI 定义了格式**：`message` 数组（system/user/assistant 三角色）、`choices` 结构、`finish_reason` 枚举——几乎所有后来者都兼容这个格式。

2. **v1/chat/completions 成为事实标准端点**：DeepSeek、Groq、Together、Anthropic（Messages API）、Ollama 本地模型——它们的 API 格式都与 OpenAI 兼容或高度相似。

3. **Function Calling 定义了工具调用协议**：`tools` 声明 + `tool_calls` 响应 + `tool` role 消息回合——这套机制被 MCP 的底层工具交互广泛借鉴。

4. **SSE 流式协议统一了实时输出**：`data: {json}\n\n` 的 SSE 格式成为流式 LLM 输出的通用协议。

## 与上层框架的关系

```
┌──────────────────────────────────────┐
│  应用代码                            │
├──────────────────────────────────────┤
│  OpenAI Agents SDK  │  ADK  │ LangChain │  ← 框架层（封装、编排）
├──────────────────────────────────────┤
│  model.LLM 接口  │  ChatModel  │  Agents SDK Model │ ← 模型抽象层
├──────────────────────────────────────┤
│  POST v1/chat/completions  ← 协议层 ← 本系列重点  │
├──────────────────────────────────────┤
│  HTTPS / SSE / JSON                  │  ← 传输层
└──────────────────────────────────────┘
```

框架的作用是在协议层之上提供 Agent 编排、工具管理、会话持久化等高级能力。但无论框架怎么封装，最终发出的 HTTP 请求格式是相同的。

## 协议的核心概念

### 1. Messages 数组

对话的唯一数据结构——有序的消息列表：

| Role | 含义 | 示例 |
|------|------|------|
| `system` | 系统指令（第一条） | "You are a helpful assistant." |
| `user` | 用户消息 | "What is the weather?" |
| `assistant` | 模型回复 | "The weather is sunny." |
| `tool` | 工具执行结果 | `{"tool_call_id": "...", "content": "25°C"}` |

API **无状态**：每次请求必须发送完整的 messages 数组。状态管理（会话历史）是上层框架的职责。

### 2. Choices 与 Finish Reason

```json
"choices": [{
  "index": 0,
  "message": {"role": "assistant", "content": "..."},
  "finish_reason": "stop"
}]
```

| finish_reason | 含义 |
|---------------|------|
| `stop` | 正常结束 |
| `length` | 达到 max_tokens 限制 |
| `tool_calls` | 模型要调用工具 |
| `content_filter` | 被内容过滤器拦截 |
| `function_call` | 旧版函数调用（已弃用）|

### 3. Usage

```json
"usage": {
  "prompt_tokens": 150,      // 输入 token 数
  "completion_tokens": 80,   // 输出 token 数
  "total_tokens": 230        // 总计
}
```

### 4. Stream vs Non-Stream

- **Non-stream**（`stream: false`）：一次 HTTP 请求 → 一次完整 JSON 响应
- **Stream**（`stream: true`）：一次 HTTP 请求 → SSE 流，逐 token 推送

## 兼容 OpenAI API 的提供商

几乎所有主流 LLM 提供商都兼容 OpenAI API 格式：

| 提供商 | 端点 |
|--------|------|
| OpenAI | `https://api.openai.com/v1/chat/completions` |
| DeepSeek | `https://api.deepseek.com/v1/chat/completions` |
| Groq | `https://api.groq.com/openai/v1/chat/completions` |
| Together | `https://api.together.xyz/v1/chat/completions` |
| Ollama（本地） | `http://localhost:11434/v1/chat/completions` |
| Anthropic（Messages API） | `https://api.anthropic.com/v1/messages`（格式相似） |

这意味着你写的底层 HTTP 调用逻辑可以**零修改**切换模型提供商——只需换 URL 和 API Key。

## 在 ADK-Go 中的对应关系

ADK-Go 的 `model.LLM` 接口就是为了对接这个协议层：

```go
type LLM interface {
    Name() string
    GenerateContent(ctx context.Context, req *LLMRequest, stream bool) iter.Seq2[*LLMResponse, error]
}
```

`LLMRequest` 和 `LLMResponse` 就是 OpenAI API 请求/响应的 Go 表示。自定义模型实现（如 DeepSeek）的本质就是：把 `LLMRequest` 转换成对 `v1/chat/completions` 的 HTTP POST，再把 HTTP 响应解析回 `LLMResponse`。
