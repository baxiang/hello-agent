# Messages 消息系统

> **进阶篇第二节。** [入门篇 01](./getting-started/01-messages-intro.md) 你学过三种基本角色（system/user/assistant）和「把历史塞回去」。本节把 messages 数组讲透：**全部五种角色**、content 的多模态格式、消息顺序的硬规则、assistant 的特殊字段（refusal/tool_calls/audio）、prompt caching。
>
> **本节你将学到**：写出合法且健壮的 messages 数组——这是所有 Agent 框架拼装请求的核心环节。
>
> **一句话比喻**：messages 像一份**剧本**，每个角色按固定顺序登场、各司其职；顺序错了戏就演不下去。

Messages 是 Chat Completions API 的唯一数据结构——有序的消息列表，承载全部对话上下文。

::: tip 先记住一个心智模型
把 messages 数组想成**一摞有序的卡片**，每张卡片写明「谁说的（role）+ 说了什么（content）」。OpenAI 服务器每次只看这一摞卡片，看完就忘——所以每次请求都要把完整对话历史重新发一遍（[入门篇](./getting-started/01-messages-intro.md) 讲过的「无状态」）。
:::

## 1. 五种 Role

::: tip 五角色一图记
按「谁说了算」分两层：
- **指令层**（定调）：`developer`（新）/ `system`（旧）—— 开发者给模型的人设
- **对话层**（内容）：`user`（用户）/ `assistant`（模型）/ `tool`（工具结果）
:::

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

## 动手实验

1. **触发顺序错误**：构造一个 `[user, user]` 连续两条 user 的请求，看 API 返回什么错误信息（通常是 400 + `unreadable messages`）。
2. **体验 prompt caching**：连续发两个请求，第二个共享第一个的 system prompt + 前几条消息，对比返回的 `usage.prompt_tokens_details.cached_tokens`——第二次会大于 0。
3. **refusal 观察**：发一个明确违反安全策略的问题（如"怎么黑入别人的账号"），看返回的 `assistant.refusal` 字段和 `content: null`。
4. **多模态 content**：发一个 `content` 为数组（text + image_url）的请求，亲眼看模型同时处理文字和图片。
5. **历史裁剪**：写个脚本累计 20 轮对话后用 [Token 篇](./getting-started/02-tokens.md) 的 tiktoken 估算，超出阈值就删早期消息，保持循环不爆。

## 本节速查 / 接下来

**5 个要点**：五种 role（developer/system/user/assistant/tool）、顺序规则（user 起头、assistant 与 tool 交替、不能连续）、content 可字符串也可数组（多模态）、assistant 三特殊字段（refusal/tool_calls/audio）、prompt caching 自动命中省 50%。

接下来：

- [响应格式](./02-response.md) —— messages 发出去，模型返回什么
- [Function Calling 机制](./04-function-calling.md) —— assistant 的 tool_calls 字段深入
- [多模态](./05-multimodal.md) —— image_url / input_audio / file 的完整玩法
