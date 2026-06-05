# 内容块 (Content Blocks)

Content Block 是 Anthropic API 最独特的设计——所有内容都是类型化的块。这是理解 Anthropic 协议的核心。

## 1. Block 类型一览

| 类型 | 方向 | 说明 |
|------|------|------|
| `text` | 输入/输出 | 纯文本 |
| `image` | 输入 | 图片（base64） |
| `tool_use` | 输出 | Claude 请求调用工具 |
| `tool_result` | 输入 | 工具执行结果 |
| `thinking` | 输出 | 扩展思考过程 |
| `redacted_thinking` | 输出 | 被过滤的思考内容 |

## 2. text Block

```json
// 输入
{"type": "text", "text": "Hello, Claude"}

// 输出
{"type": "text", "text": "Hello! How can I help you?"}
```

### cache_control

```json
{
  "type": "text",
  "text": "Long reference document here...",
  "cache_control": {"type": "ephemeral"}
}
```

标记后，该 text block 被缓存。后续请求中相同的 block 以折扣价计费。

## 3. image Block

```json
{
  "type": "image",
  "source": {
    "type": "base64",
    "media_type": "image/jpeg",
    "data": "/9j/4AAQSkZJRg..."   // Base64 编码
  }
}
```

### 支持的格式

| 格式 | media_type |
|------|-----------|
| JPEG | `image/jpeg` |
| PNG | `image/png` |
| GIF | `image/gif` |
| WebP | `image/webp` |

最大 5MB/image，推荐 1568px 以内。

### 多图

```json
{
  "role": "user",
  "content": [
    {"type": "text", "text": "Compare these two images:"},
    {"type": "image", "source": {"type": "base64", "media_type": "image/jpeg", "data": "..."}},
    {"type": "image", "source": {"type": "base64", "media_type": "image/png", "data": "..."}}
  ]
}
```

## 4. tool_use Block（输出）

```json
{
  "type": "tool_use",
  "id": "toolu_01XxXxXxXx",
  "name": "get_weather",
  "input": {"city": "Berlin", "unit": "celsius"}
}
```

- `id` — 全球唯一标识（`toolu_` 前缀），用于 `tool_result` 配对
- `name` — 工具名称，对应 tools 定义中的 name
- `input` — 已解析的 JSON 对象（不是 JSON 字符串）

## 5. tool_result Block（输入）

```json
{
  "type": "tool_result",
  "tool_use_id": "toolu_01XxXxXxXx",
  "content": "Sunny, 22°C",
  "is_error": false
}
```

### content 的多种格式

```json
// 1. 纯文本
{"content": "Sunny, 22°C"}

// 2. Block 数组（可包含多段内容）
{"content": [
  {"type": "text", "text": "Temperature: 22°C"},
  {"type": "text", "text": "Humidity: 60%"}
]}

// 3. 图片（工具返回图片）
{"content": [
  {"type": "image", "source": {"type": "base64", "media_type": "image/png", "data": "..."}}
]}
```

### is_error

```json
{"is_error": true}  // 告诉 Claude 工具执行失败
// Claude 可能重试、使用其他工具或告知用户
```

## 6. thinking Block（输出）

```json
{
  "type": "thinking",
  "thinking": "The user asked about the weather in Berlin. I should look up current data rather than guessing. I'll use the get_weather tool with city='Berlin'.",
  "signature": "EqcBC0JFOiCicjEwLj..."
}
```

- `thinking` — 思考文本（可见的过程）
- `signature` — 加密签名，验证思考内容未被篡改

### redacted_thinking

```json
{
  "type": "redacted_thinking",
  "data": "..."
}
```

当思考涉及安全敏感内容时，被替换为此 block。

## 7. 混合 Block 响应

Claude 可以在一次响应中返回多个类型的 block：

```json
{
  "content": [
    {"type": "text", "text": "Let me think about this..."},
    {
      "type": "thinking",
      "thinking": "I need to check two data sources.",
      "signature": "..."
    },
    {"type": "tool_use", "id": "toolu_01", "name": "get_weather", "input": {"city": "Berlin"}},
    {"type": "tool_use", "id": "toolu_02", "name": "get_time", "input": {"timezone": "Europe/Berlin"}}
  ],
  "stop_reason": "tool_use"
}
```

### Block 顺序规则

- `thinking` block 总是在 `text` 和 `tool_use` 之前（如果有）
- `redacted_thinking` 替代被过滤的 `thinking`
- `tool_use` 之间可以穿插 `text` block

## 8. 从响应中提取文本

```python
def extract_text(response: dict) -> str:
    """从 Anthropic 响应中提取所有文本"""
    texts = []
    for block in response.get("content", []):
        if block["type"] == "text":
            texts.append(block["text"])
        elif block["type"] == "thinking":
            # 思考内容可选暴露给用户
            texts.append(f"[Thinking: {block['thinking'][:100]}...]")
    return "\n".join(texts)
```

## 9. Block 索引

Content Block 使用 0-based 的 `index` 来标识每个 block 在 content 数组中的位置。这在流式处理和条件判断中很重要：

```python
# 判断类型
if block["type"] == "text":
    handle_text(block)
elif block["type"] == "tool_use":
    execute_tool(block["name"], block["input"])
elif block["type"] == "thinking":
    log_thinking(block["thinking"])
```

## 10. vs OpenAI Content 格式

| 维度 | OpenAI | Anthropic |
|------|--------|-----------|
| 文本 | `content: "string"` 或 `[{type: "text", text: "..."}]` | 总是 `[{type: "text", text: "..."}]` |
| 图片 | `type: "image_url"` + URL | `type: "image"` + base64 |
| 工具请求 | 独立 `tool_calls` 字段 | `type: "tool_use"` block（与 text 并列） |
| 工具结果 | `role: "tool"` 独立 message | `type: "tool_result"` block（在 user message 中） |
| 思考 | 无（o 系列不暴露过程） | `type: "thinking"` block（可见+可验证） |

Anthropic 的 Block 模型更统一：不管内容类型是什么，都在同一个 `content` 数组中按顺序排列。OpenAI 把工具调用单独放在 `tool_calls` 字段，与 `content` 分离。
