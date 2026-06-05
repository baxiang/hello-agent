# Anthropic Messages API 总览

## 1. 端点与鉴权

```
POST https://api.anthropic.com/v1/messages
```

必需的 HTTP 头：

```http
x-api-key: sk-ant-api03-xxxxx
anthropic-version: 2023-06-01
Content-Type: application/json
```

### 版本控制

Anthropic 通过 `anthropic-version` 头控制 API 版本：

```
anthropic-version: 2023-06-01  # 稳定版
```

不使用 URL 版本号（不像 `/v1/` 或 `/v2/`），所有版本通过同一个端点 + 头切换。

## 2. 最小请求

```json
{
  "model": "claude-sonnet-4-20250514",
  "max_tokens": 1000,
  "messages": [
    {"role": "user", "content": "Hello, Claude"}
  ]
}
```

**注意**：`max_tokens` 是必填参数（OpenAI 可选，Anthropic 必填）。

## 3. System Prompt

Anthropic 的 system prompt **不在** messages 数组中，而是独立的顶层字段：

```json
{
  "model": "claude-sonnet-4-20250514",
  "max_tokens": 1000,
  "system": "You are a helpful assistant. Answer in Chinese.",
  "messages": [
    {"role": "user", "content": "什么是人工智能？"}
  ]
}
```

也可以是数组（多个 system prompt 块）：

```json
{
  "system": [
    {"type": "text", "text": "You are a helpful assistant."},
    {"type": "text", "text": "Always be polite.", "cache_control": {"type": "ephemeral"}}
  ]
}
```

### 对比 OpenAI

```
OpenAI:   messages[0] = {"role": "system", "content": "..."}
Anthropic: 顶层 "system" 字段
```

Anthropic 的设计更清晰——system prompt 是环境设定，不是对话内容。

## 4. Messages 格式

```json
{
  "messages": [
    {
      "role": "user",
      "content": [
        {"type": "text", "text": "Hello, Claude"}
      ]
    },
    {
      "role": "assistant",
      "content": [
        {"type": "text", "text": "Hello! How can I help you today?"}
      ]
    }
  ]
}
```

### 关键差异

| 特性 | OpenAI | Anthropic |
|------|--------|-----------|
| System prompt | `role: "system"` in messages | 顶层 `system` 字段 |
| 用户消息 | `role: "user"`, `content` 为 string 或 array | `role: "user"`, `content` 始终为 **block 数组** |
| 助手消息 | `role: "assistant"` | `role: "assistant"` |
| 工具结果 | `role: "tool"`, `tool_call_id` | `role: "user"`, content 含 `tool_result` block |
| content 类型 | string 或 `[{type, ...}]` | 总是 `[{type: "text", text: "..."}]` |

重要：Anthropic 的 `content` **总是数组**，即使只有一段文本。

## 5. 响应格式

```json
{
  "id": "msg_01Xxxx",
  "type": "message",
  "role": "assistant",
  "model": "claude-sonnet-4-20250514",
  "content": [
    {
      "type": "text",
      "text": "Hello! I'm Claude, an AI assistant created by Anthropic."
    }
  ],
  "stop_reason": "end_turn",
  "stop_sequence": null,
  "usage": {
    "input_tokens": 15,
    "output_tokens": 18
  }
}
```

### 对比 OpenAI

| 字段 | OpenAI | Anthropic |
|------|--------|-----------|
| ID | `id: "chatcmpl-xxx"` | `id: "msg_01Xxxx"` |
| 模型 | `model: "gpt-4o-2024-05-13"` | `model: "claude-sonnet-4-..."` |
| 文本 | `choices[0].message.content` (string) | `content[0].text` (从 block 数组提取) |
| 结束原因 | `finish_reason: "stop"` | `stop_reason: "end_turn"` |
| Token 用量 | `usage.prompt_tokens` | `usage.input_tokens` |

### stop_reason 取值

| 值 | 含义 |
|----|------|
| `end_turn` | 正常完成 |
| `max_tokens` | 达到 max_tokens 限制 |
| `stop_sequence` | 遇到 stop_sequence |
| `tool_use` | 需要调用工具 |

## 6. Content Blocks（内容块）

Anthropic 最核心的设计——所有内容都是类型化的 Block：

```json
{
  "content": [
    {"type": "text", "text": "Hello"},
    {"type": "image", "source": {"type": "base64", "media_type": "image/jpeg", "data": "..."}},
    {"type": "tool_use", "id": "toolu_xxx", "name": "get_weather", "input": {"city": "Tokyo"}},
    {"type": "thinking", "thinking": "Let me think about this...", "signature": "..."}
  ]
}
```

Block 类型：
- `text` — 纯文本
- `image` — 图片（base64）
- `tool_use` — 工具调用请求
- `tool_result` — 工具执行结果
- `thinking` — 扩展思考内容
- `redacted_thinking` — 被过滤的思考内容

## 7. 为什么 Anthropic 协议值得学

1. **Block 设计更面向 Agent**：tool_use/tool_result 是一等公民的 content block，不是嵌套在 message 里的 JSON。

2. **System prompt 分离**：system 不在对话历史中，Prompt Caching 更自然。

3. **Extended Thinking**：思考过程可见、可过滤、可签名验证——这是 OpenAI o 系列不具备的透明度。

4. **与 OpenAI 互补**：大多数框架需要同时支持两种协议。ADK-Go 的 `model.LLM` 接口就是为这种多协议抽象而设计的。

## 8. 可用模型

| 模型 | Context | 特点 |
|------|---------|------|
| claude-opus-4-20250514 | 200K | 最强推理 |
| claude-sonnet-4-20250514 | 200K | 速度与质量平衡 |
| claude-3.5-haiku | 200K | 最快最便宜 |
| claude-3.5-sonnet | 200K | 上一代理科强 |

## 9. 在 ADK-Go 中的对应

ADK-Go 的 `model.LLM` 接口同样可以对接 Anthropic：

```go
func (m *ClaudeModel) GenerateContent(
    ctx context.Context, req *model.LLMRequest, stream bool,
) iter.Seq2[*model.LLMResponse, error] {
    // 将 LLMRequest (OpenAI 格式) 转为 Anthropic Messages 格式
    anthropicReq := convertToAnthropic(req)
    // POST https://api.anthropic.com/v1/messages
    // 将 Anthropic 响应转回 LLMResponse
}
```

这个 `convertToAnthropic()` 函数需要处理：system prompt 提取、content 转 block 数组、tool 声明转 tool 定义等格式差异——正是本系列文档要讲的内容。
