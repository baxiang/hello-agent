# 协议总览

## 什么是 OpenAI Chat Completions API

它是 OpenAI 定义的 HTTP REST API 协议——客户端和 LLM 之间通信的**底层标准**。

```
POST https://api.openai.com/v1/chat/completions
Authorization: Bearer sk-xxx
Content-Type: application/json

{
  "model": "gpt-4o",
  "messages": [
    {"role": "developer", "content": "You are a helpful assistant."},
    {"role": "user", "content": "What is the weather?"}
  ]
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
    "message": {"role": "assistant", "content": "I don't have weather data..."},
    "finish_reason": "stop"
  }],
  "usage": {
    "prompt_tokens": 25, "completion_tokens": 12, "total_tokens": 37,
    "prompt_tokens_details": {"cached_tokens": 0},
    "completion_tokens_details": {"reasoning_tokens": 0}
  },
  "service_tier": "default",
  "system_fingerprint": "fp_abc123"
}
```

## 协议生命周期

```
1. 客户端发起 HTTP POST → 2. API 验证鉴权+参数 → 3. 推理生成 → 4. 返回 JSON（或 SSE 流）
                                                    ↓（如果是 stream=true）
                                               逐 token 推送 SSE chunk
```

一次完整调用包含：
- **鉴权**：`Authorization: Bearer {key}` 或 `api-key` 头
- **请求体**：`model` + `messages` + 可选参数
- **响应**：JSON 对象（非流式）或 SSE 流（流式）
- **速率限制**：响应头 `x-ratelimit-limit-*` `/ `x-ratelimit-remaining-*` `/ `x-ratelimit-reset-*`

## 为什么它成了行业标准

1. **OpenAI 定义了格式**：`messages` 数组（system/developer/user/assistant/tool 五角色）、`choices` 结构、`finish_reason` 枚举——几乎所有后来者兼容此格式。

2. **`v1/chat/completions` 成为事实标准端点**：DeepSeek、Groq、Together、Ollama、vLLM 本地部署——端点路径和格式都与 OpenAI 兼容。

3. **Function Calling 定义了工具调用协议**：`tools` 声明 + `tool_calls` 响应 + `tool` role 消息回合——这套机制被 MCP 的底层交互广泛借鉴。

4. **SSE 流式协议统一了实时输出**：`data: {json}\n\n` 的 SSE 格式成为流式 LLM 输出的通用协议。

5. **o 系列推理模型扩展了协议**：`reasoning_effort`、`reasoning_content`、`reasoning_tokens`——定义了"模型思考"的标准化表示。

## 与上层框架的关系

```
┌──────────────────────────────────────────────┐
│  应用代码                                    │
├──────────────────────────────────────────────┤
│  OpenAI Agents SDK  │  ADK  │ LangChain       │  ← 框架层
│  Agent.run()        │ Runner │ ChatModel       │
├──────────────────────────────────────────────┤
│  model.LLM 接口  │  ChatModel  │  Agent Model  │  ← 模型抽象层
├──────────────────────────────────────────────┤
│  POST v1/chat/completions  ← 协议层 ← 本系列  │
│  messages / tools / stream / reasoning / ...  │
├──────────────────────────────────────────────┤
│  HTTPS / SSE / JSON                          │  ← 传输层
└──────────────────────────────────────────────┘
```

无论框架如何封装，最终发出的 HTTP 请求格式是相同的。理解协议层意味着你可以：
- 不依赖任何 SDK 直接调用任何兼容 API
- 理解框架在"做什么"而不只是"怎么用"
- 在框架不支持的场景下直接操作协议层
- 调试模型行为时直接检查 HTTP 请求/响应

## 协议的核心概念

### Messages：对话数据结构

有序的消息列表，五种 Role：

| Role | 位置 | 含义 |
|------|------|------|
| `developer` | 可选第一条 | 开发者级指令（优先级最高，替代 system） |
| `system` | 可选第一条 | 系统指令（旧版，推荐用 developer 替代） |
| `user` | 对话中 | 用户消息或工具执行结果 |
| `assistant` | 对话中 | 模型回复（含 tool_calls） |
| `tool` | 紧接 assistant tool_calls | 工具执行结果 |

API **无状态**：每次请求必须发送完整 messages 数组。会话管理是上层框架的职责。

### Choices 与 Finish Reason

```json
"choices": [{
  "index": 0,
  "message": {"role": "assistant", "content": "..."},
  "finish_reason": "stop"
}]
```

| finish_reason | 含义 | 后续 |
|---------------|------|------|
| `stop` | 正常完成 | 结束 |
| `length` | 达到 max_tokens | 可续写 |
| `tool_calls` | 请求工具调用 | 执行工具后发回 |
| `content_filter` | 安全拦截 | 修改输入重试 |
| `function_call` | 旧版调用（已弃用）| — |

### 流式 vs 非流式

- **Non-stream**（`stream: false` 或默认）：HTTP 请求 → JSON 响应
- **Stream**（`stream: true`）：HTTP 请求 → SSE 流 `data: {json}\n\n`

### 速率限制

响应头中包含限制信息：

```http
x-ratelimit-limit-requests: 10000
x-ratelimit-remaining-requests: 9999
x-ratelimit-reset-requests: 8.64s
x-ratelimit-limit-tokens: 200000
x-ratelimit-remaining-tokens: 199950
x-ratelimit-reset-tokens: 4ms
```

两种维度的并发限制：RPM（每分钟请求数）和 TPM（每分钟 token 数）。

### 兼容提供商

几乎所有主流提供商兼容此协议：

| 提供商 | 端点 |
|--------|------|
| OpenAI | `https://api.openai.com/v1/chat/completions` |
| Azure OpenAI | `https://{name}.openai.azure.com/openai/deployments/{deploy}/chat/completions?api-version=...` |
| DeepSeek | `https://api.deepseek.com/v1/chat/completions` |
| Groq | `https://api.groq.com/openai/v1/chat/completions` |
| Together | `https://api.together.xyz/v1/chat/completions` |
| Ollama (本地) | `http://localhost:11434/v1/chat/completions` |
| vLLM (本地) | `http://localhost:8000/v1/chat/completions` |

**注意**：虽格式兼容，但参数支持度不同（如 Ollama 不支持 `logprobs`、`reasoning_effort`）。

## 在 ADK-Go 中的对应关系

```go
type LLM interface {
    Name() string
    GenerateContent(ctx context.Context, req *LLMRequest, stream bool) iter.Seq2[*LLMResponse, error]
}
```

自定义模型实现就是将 `LLMRequest` → HTTP POST → `LLMResponse` 的转换逻辑。本系列文档就是教会你这一层转换需要知道的一切。
