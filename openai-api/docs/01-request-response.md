# 请求与响应格式

## 1. 端点与鉴权

```
POST https://api.openai.com/v1/chat/completions
```

必带头部：

```http
Authorization: Bearer {API_KEY}
Content-Type: application/json
```

可选头部：

```http
OpenAI-Organization: org-xxx          # 多组织账号
OpenAI-Project: proj_xxx              # 项目级 API Key
OpenAI-Beta: assistants=v2            # Beta 功能
```

## 2. 最小请求

```json
{
  "model": "gpt-4o",
  "messages": [
    {"role": "user", "content": "Hello"}
  ]
}
```

## 3. 完整请求结构

```json
{
  "model": "gpt-4o",
  "messages": [],
  "temperature": 0.7,
  "top_p": 1.0,
  "n": 1,
  "stream": false,
  "stop": null,
  "max_tokens": null,
  "presence_penalty": 0,
  "frequency_penalty": 0,
  "logit_bias": null,
  "user": null,
  "seed": null,
  "tools": [],
  "tool_choice": "auto",
  "response_format": null,
  "logprobs": false,
  "top_logprobs": null
}
```

## 4. Messages 详解

### 四种 Role

```json
{
  "messages": [
    {
      "role": "system",
      "content": "You are a helpful assistant. Answer in Chinese."
    },
    {
      "role": "user",
      "content": "What is the capital of France?"
    },
    {
      "role": "assistant",
      "content": "The capital of France is Paris."
    },
    {
      "role": "user",
      "content": "What about Germany?"
    }
  ]
}
```

### System Message 规则

- 通常放在 messages 数组的**第一个**
- 模型遵循程度：gpt-4o > gpt-3.5-turbo
- 可以不加 system message，直接用 user message 开始

### Content 的三种格式

```json
// 1. 纯文本
{"role": "user", "content": "Hello"}

// 2. 文本数组（多段内容）
{"role": "user", "content": [
  {"type": "text", "text": "What is in this image?"},
  {"type": "image_url", "image_url": {"url": "https://..."}}
]}

// 3. 工具结果
{"role": "tool", "tool_call_id": "call_xxx", "content": "25°C"}
```

### Name 字段（可选）

```json
{"role": "user", "content": "Hello", "name": "Alice"}
```

可用于区分多用户对话，模型能感知不同 name 对应不同说话者。

## 5. 完整响应结构

```json
{
  "id": "chatcmpl-9Xxxxx",
  "object": "chat.completion",
  "created": 1718236800,
  "model": "gpt-4o-2024-05-13",
  "system_fingerprint": "fp_xxx",
  "choices": [
    {
      "index": 0,
      "message": {
        "role": "assistant",
        "content": "The capital of Germany is Berlin.",
        "tool_calls": null,
        "refusal": null,
        "function_call": null
      },
      "logprobs": null,
      "finish_reason": "stop"
    }
  ],
  "usage": {
    "prompt_tokens": 42,
    "completion_tokens": 9,
    "total_tokens": 51
  }
}
```

### 响应字段详解

| 字段 | 说明 |
|------|------|
| `id` | 本次请求唯一标识 |
| `object` | 恒为 `"chat.completion"` |
| `created` | Unix 时间戳（秒） |
| `model` | 实际使用的模型版本 |
| `system_fingerprint` | 模型后端指纹（变更时说明模型有变化） |
| `choices` | 返回结果数组（n > 1 时有多个） |
| `usage` | Token 用量 |

### Choices 详解

| 字段 | 说明 |
|------|------|
| `index` | choice 序号（0-based） |
| `message.role` | 恒为 `"assistant"` |
| `message.content` | 文本回复（function_call 时为 null） |
| `message.tool_calls` | 工具调用列表（有工具调用时填充） |
| `message.refusal` | 安全拒绝说明（被拦截时填充） |
| `finish_reason` | 结束原因 |

### Finish Reason 全部取值

| 值 | 含义 | 后续动作 |
|----|------|----------|
| `stop` | 正常完成 | 结束 |
| `length` | 达到 max_tokens | 可请求继续（传入 previous response id） |
| `tool_calls` | 需要调用工具 | 执行工具，将结果以 tool role 发回 |
| `content_filter` | 被安全过滤器拦截 | 修改输入重试 |
| `function_call` | 旧版函数调用（已弃用）| 改用 tool_calls |

### Usage 详情

```json
"usage": {
  "prompt_tokens": 42,
  "completion_tokens": 9,
  "total_tokens": 51,
  "completion_tokens_details": {
    "reasoning_tokens": 0  // o 系列模型会有推理 token
  },
  "prompt_tokens_details": {
    "cached_tokens": 0     // prompt cache 命中 token
  }
}
```

## 6. n 参数：一次请求多个回复

```json
{
  "model": "gpt-4o",
  "messages": [{"role": "user", "content": "Give me a name"}],
  "n": 3
}
```

返回 3 个 choices，每个有不同的回复。不推荐用于 chat 场景（对话上下文取哪个？），适合创意生成。

## 7. cURL 示例

```bash
curl https://api.openai.com/v1/chat/completions \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $OPENAI_API_KEY" \
  -d '{
    "model": "gpt-4o",
    "messages": [{"role": "user", "content": "Hello"}],
    "temperature": 0.7
  }'
```

## 8. HTTP 状态码

| 状态码 | 含义 | 处理方式 |
|--------|------|----------|
| 200 | 成功 | 正常处理 |
| 400 | 请求格式错误 | 检查 JSON、model 名称 |
| 401 | API Key 无效 | 检查 Key |
| 429 | 速率限制 | 指数退避重试 |
| 500 | 服务器错误 | 指数退避重试 |
| 503 | 服务不可用 | 指数退避重试 |

## 9. 错误响应格式

```json
{
  "error": {
    "message": "Incorrect API key provided",
    "type": "invalid_request_error",
    "param": null,
    "code": "invalid_api_key"
  }
}
```

常见 error type：
- `invalid_request_error`：请求参数错误
- `authentication_error`：鉴权失败
- `rate_limit_error`：速率限制
- `server_error`：服务器内部错误
- `tokens_exceeded_error`：超出 context window
