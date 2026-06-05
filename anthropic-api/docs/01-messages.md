# Messages API 格式

## 1. 完整请求结构

```json
{
  "model": "claude-sonnet-4-20250514",
  "max_tokens": 1000,
  "system": "You are a helpful assistant.",
  "messages": [
    {"role": "user", "content": "Hello"}
  ],
  "temperature": 0.7,
  "top_p": 1.0,
  "top_k": 0,
  "stop_sequences": ["\n\nHuman:", "\n\nAssistant:"],
  "stream": false,
  "metadata": {"user_id": "user-123"},
  "tools": [],
  "tool_choice": null,
  "thinking": null
}
```

## 2. Messages 数组

```json
{
  "messages": [
    {
      "role": "user",
      "content": [
        {"type": "text", "text": "What is the capital of France?"}
      ]
    },
    {
      "role": "assistant",
      "content": [
        {"type": "text", "text": "The capital of France is Paris."}
      ]
    },
    {
      "role": "user",
      "content": [
        {"type": "text", "text": "What about Germany?"}
      ]
    }
  ]
}
```

**关键规则**：
- `content` 始终是数组（没有纯 string 简写）
- 对话必须 user 和 assistant 交替
- 不能有两条连续的 user 消息或两条连续的 assistant 消息

### Content 字符串简写

```json
// ✅ 简写（API 会自动包装为 content block）
{"role": "user", "content": "Hello"}

// ✅ 完整 block 格式
{"role": "user", "content": [{"type": "text", "text": "Hello"}]}
```

API 接受 `content` 为字符串的简写形式，内部自动转为 `[{"type": "text", "text": "..."}]`。

## 3. System Prompt 高级用法

### Prompt Caching

```json
{
  "system": [
    {
      "type": "text",
      "text": "You are a helpful assistant with knowledge about...",
      "cache_control": {"type": "ephemeral"}
    }
  ]
}
```

标记 `cache_control` 的 system prompt 块会被缓存，后续请求减少 `input_tokens` 计费。

### 多块 System Prompt

```json
{
  "system": [
    {"type": "text", "text": "Base instructions...", "cache_control": {"type": "ephemeral"}},
    {"type": "text", "text": "Dynamic context: user is premium customer"}
  ]
}
```

前一块缓存，后一块动态变化——兼顾成本和灵活性。

## 4. 完整响应格式

```json
{
  "id": "msg_01XxXxXxXxXx",
  "type": "message",
  "role": "assistant",
  "model": "claude-sonnet-4-20250514",
  "content": [
    {
      "type": "text",
      "text": "The capital of Germany is Berlin."
    }
  ],
  "stop_reason": "end_turn",
  "stop_sequence": null,
  "usage": {
    "input_tokens": 25,
    "output_tokens": 10,
    "cache_creation_input_tokens": 0,
    "cache_read_input_tokens": 0
  }
}
```

### 响应字段详解

| 字段 | 说明 |
|------|------|
| `id` | 消息唯一标识（`msg_` 前缀） |
| `type` | 恒为 `"message"` |
| `role` | 恒为 `"assistant"` |
| `model` | 实际处理的模型 ID |
| `content` | Content Block 数组 |
| `stop_reason` | 停止原因 |
| `stop_sequence` | 触发的 stop_sequence（如有） |
| `usage` | Token 用量 |

### Content Block 中的内容

```json
{
  "content": [
    {"type": "text", "text": "Here is the result:"},
    {
      "type": "tool_use",
      "id": "toolu_01Xxx",
      "name": "get_weather",
      "input": {"city": "Berlin"}
    }
  ]
}
```

一次响应可以包含多个类型混合的 content block。

### Usage 详情

```json
"usage": {
  "input_tokens": 150,
  "output_tokens": 80,
  "cache_creation_input_tokens": 0,
  "cache_read_input_tokens": 100
}
```

| 字段 | 说明 |
|------|------|
| `input_tokens` | 输入 token 数 |
| `output_tokens` | 输出 token 数 |
| `cache_creation_input_tokens` | 新创建的缓存 token |
| `cache_read_input_tokens` | 命中缓存的 token（计费折扣） |

### 计费（2026 参考价）

| 模型 | 输入 $/MTok | 输出 $/MTok | 缓存写入 $/MTok | 缓存读取 $/MTok |
|------|------------|------------|----------------|----------------|
| Claude Opus 4 | $15.00 | $75.00 | $18.75 | $1.50 |
| Claude Sonnet 4 | $3.00 | $15.00 | $3.75 | $0.30 |
| Claude 3.5 Haiku | $0.80 | $4.00 | $1.00 | $0.08 |

缓存读取比正常输入便宜 10 倍——设计好 `cache_control` 是关键优化点。

## 5. stop_reason 详解

| 值 | 含义 | 后续动作 |
|----|------|----------|
| `end_turn` | 正常完成对话 | 结束 |
| `max_tokens` | 达到 max_tokens 限制 | 可继续（传入 continuation） |
| `stop_sequence` | 遇到停止序列 | 检查 stop_sequence 字段 |
| `tool_use` | Claude 需要调用工具 | 执行工具，将 tool_result 发回 |

## 6. max_tokens 续写

当 `stop_reason: "max_tokens"` 时，可以续写：

```json
// 第一次请求
{
  "messages": [
    {"role": "user", "content": "Write a very long essay about AI"}
  ]
}
// → stop_reason: "max_tokens"

// 续写请求：把 assistant 回复放回 messages，继续
{
  "messages": [
    {"role": "user", "content": "Write a very long essay about AI"},
    {"role": "assistant", "content": "Artificial Intelligence is a field..."},  // 第一次的回复
    {"role": "user", "content": "Continue"}  // 空消息触发续写...实际上 Anthropic 建议直接追加
  ]
}
```

实际上 Anthropic 推荐的方式是：在上一次请求的 messages 基础上追加 assistant 消息，然后继续。模型会接着生成。

## 7. 错误响应

```json
{
  "type": "error",
  "error": {
    "type": "invalid_request_error",
    "message": "max_tokens: field required"
  }
}
```

错误类型：
- `invalid_request_error` — 请求格式错误（如缺 max_tokens）
- `authentication_error` — x-api-key 无效
- `permission_error` — 无权限访问模型
- `rate_limit_error` — 速率限制（含 Retry-After 头）
- `api_error` — 服务器内部错误（500）
- `overloaded_error` — 服务过载（529）

## 8. cURL 示例

```bash
curl https://api.anthropic.com/v1/messages \
  -H "x-api-key: $ANTHROPIC_API_KEY" \
  -H "anthropic-version: 2023-06-01" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "claude-sonnet-4-20250514",
    "max_tokens": 1000,
    "system": "You are a helpful assistant.",
    "messages": [
      {"role": "user", "content": "Hello, Claude"}
    ]
  }'
```
