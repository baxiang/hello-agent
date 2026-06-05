# Messages 消息系统

Messages 是 Chat Completions API 的唯一数据结构——有序的消息列表，承载全部对话上下文。

## 1. 五种 Role

### developer（推荐替代 system）

```json
{"role": "developer", "content": "You are a helpful assistant. Reply in Chinese."}
```

与 `system` 功能相同但优先级更高。`developer` 和 `system` 不可同时使用——API 会拒绝。

### system（旧版，仍广泛支持）

```json
{"role": "system", "content": "You are a helpful assistant."}
```

放在 messages[0]。第三方兼容 API（DeepSeek、Groq 等）可能只支持 `system` 不支持 `developer`。

### user

```json
// 纯文本
{"role": "user", "content": "What is AI?"}

// 多段内容（图片+文本）
{"role": "user", "content": [
  {"type": "text", "text": "Describe the image"},
  {"type": "image_url", "image_url": {"url": "https://..."}}
]}

// 文件输入
{"role": "user", "content": [
  {"type": "text", "text": "Summarize this file"},
  {"type": "file", "file": {"file_id": "file-xxx"}}
]}
```

### assistant

```json
// 纯文本
{"role": "assistant", "content": "AI is..."}

// 含工具调用
{"role": "assistant", "content": null, "tool_calls": [
  {"id": "call_xxx", "type": "function", "function": {"name": "get_weather", "arguments": "{...}"}}
]}

// 含 refusal
{"role": "assistant", "refusal": "I cannot help with that request.", "content": null}
```

关键约束：`content` 和 `refusal` 互斥——有 `refusal` 时 `content` 为 `null`，反之亦然。

### tool

```json
{"role": "tool", "tool_call_id": "call_xxx", "content": "{\"result\": \"ok\"}"}
```

`tool_call_id` 必须匹配之前 assistant 消息中的 `tool_calls[].id`。`content` 是字符串（建议 JSON 格式）。

## 2. Messages 数组规则

### 顺序规则

```
developer/system → 0 或 1 次（第一条）
user              → 必须开始对话
assistant + tool  → 交替出现
```

**合法序列**：

```
[developer, user, assistant, user, assistant, ...]
[system, user, assistant, tool, assistant, user, ...]
[user, assistant, user, assistant, ...]
```

**非法序列**：

```
❌ [user, user]              — 连续两条 user
❌ [assistant, assistant]    — 连续两条 assistant
❌ [developer, system, user]  — developer 和 system 不能同时出现
❌ [user, tool]              — tool 前必须有一条 assistant 含对应 tool_calls
```

### 最终消息必须是 user 或 tool

请求的最后一条消息 role 必须是 `user`、`tool` 或 `developer`（仅当 developer 是最后一条时）——不能以 `assistant` 结尾。

## 3. Content 格式详解

### 纯文本

```json
{"role": "user", "content": "Hello"}
```

简写：`content` 为字符串时，等价于 `[{"type": "text", "text": "Hello"}]`。

### 内容数组

```json
{
  "role": "user",
  "content": [
    {"type": "text", "text": "What's in this image?"},
    {"type": "image_url", "image_url": {"url": "https://example.com/photo.jpg", "detail": "auto"}},
    {"type": "text", "text": "Also describe the colors."}
  ]
}
```

数组中的元素按顺序处理，类型包括：

| type | 说明 |
|------|------|
| `text` | 纯文本 |
| `image_url` | 图片（URL 或 base64） |
| `input_audio` | 音频输入（gpt-4o-audio-preview） |
| `file` | 上传文件引用 |

### image_url 类型

```json
{
  "type": "image_url",
  "image_url": {
    "url": "https://example.com/photo.jpg",
    "detail": "auto"
  }
}
```

| 参数 | 说明 |
|------|------|
| `url` | 图片 URL 或 base64 data URL：`data:image/jpeg;base64,...` |
| `detail` | `auto`（默认）/ `low`（512x512，85 tokens）/ `high`（多 tile） |

### input_audio 类型

```json
{
  "type": "input_audio",
  "input_audio": {
    "data": "base64-encoded-audio...",
    "format": "wav"
  }
}
```

| 参数 | 说明 |
|------|------|
| `data` | Base64 编码音频 |
| `format` | `wav` 或 `mp3` |

### file 类型

```json
{
  "type": "file",
  "file": {
    "file_id": "file-abc123",
    "filename": "report.pdf"
  }
}
```

先通过 `POST v1/files` 上传获取 `file_id`。支持 PDF、DOCX、TXT 等。需要 `file_search` 工具。

## 4. Name 字段

```json
{"role": "user", "content": "Hello", "name": "Alice"}
{"role": "assistant", "content": "Hi Alice", "name": "Bot"}
```

- 区分多用户对话中的发言者
- `name` 可以出现在 `user` 和 `assistant` 消息中
- 模型能感知不同 name 对应不同的说话者
- **不可用于 system/developer** 消息

## 5. assistant 消息的特殊字段

### refusal

```json
{
  "role": "assistant",
  "content": null,
  "refusal": "I cannot help with requests involving illegal activities."
}
```

当模型因安全策略拒绝时，`refusal` 填充拒绝原因，`content` 为 `null`。

### tool_calls

```json
{
  "role": "assistant",
  "content": null,
  "tool_calls": [
    {
      "id": "call_abc123",
      "type": "function",
      "function": {
        "name": "get_weather",
        "arguments": "{\"city\":\"Tokyo\"}"
      }
    }
  ]
}
```

`tool_calls` 字段只在有工具调用时出现。当 `tool_calls` 非 null 时 `content` 通常为 `null`。

### audio（仅 gpt-4o-audio-preview）

```json
{
  "role": "assistant",
  "audio": {
    "id": "audio_abc123",
    "data": "base64-audio...",
    "expires_at": 1718323200,
    "transcript": "Today's weather is..."
  }
}
```

当请求 `modalities: ["text", "audio"]` 且 `audio.output` 参数启用时，响应中包含音频数据。

## 6. 多轮对话管理

```python
messages = [
    {"role": "developer", "content": "You are helpful. Reply in Chinese."},
]

def chat(user_input):
    messages.append({"role": "user", "content": user_input})
    response = call_api(messages)
    messages.append(response["choices"][0]["message"])
    return response["choices"][0]["message"]["content"]
```

每次调用后追加 assistant 响应到 messages，实现上下文保持。

### 历史裁剪

长对话需要裁剪历史避免超 context window：

```python
MAX_TOKENS = 100000  # 留 buffer
while estimate_tokens(messages) > MAX_TOKENS:
    # 保留第一条（developer/system），从第二条开始删除
    del messages[1]   # 删除最早的一条 user
    del messages[1]   # 删除对应的 assistant
```

## 7. Prompt Caching

自动缓存重复的消息前缀。无需客户端显式标记（与 Anthropic 不同）：

```
# 两次请求共享相同的 system prompt 前缀
# 第二次请求自动命中缓存——prompt_tokens_details.cached_tokens > 0
```

命中缓存的 token 按 50% 折扣计费。

### 缓存断点

以下情况会打断缓存：
- `image_url` 内容块
- `tool` role 消息
- 过长的消息前缀
- 不同的 `tool_choice` 参数

## 8. 在 ADK-Go 中的对应

```go
// LLMRequest.Contents 对应 messages 数组
type LLMRequest struct {
    Model    string
    Contents []*genai.Content  // 每个 Content 对应一条 message
    Config   *genai.GenerateContentConfig
    Tools    map[string]any
}

// 自定义模型实现时：
// genai.Content with Role="user"  → {"role": "user", "content": ...}
// genai.Content with Role="model" → {"role": "assistant", "content": ...}
// genai.Content with Parts containing FunctionResponse → {"role": "tool", ...}
```
