# 响应格式

## 1. 完整响应结构

```json
{
  "id": "chatcmpl-9XxXxXxXxXx",
  "object": "chat.completion",
  "created": 1718236800,
  "model": "gpt-4o-2024-05-13",
  "service_tier": "default",
  "system_fingerprint": "fp_abc123def456",
  "choices": [],
  "usage": {}
}
```

### 顶层字段

| 字段 | 类型 | 说明 |
|------|------|------|
| `id` | string | 请求唯一 ID（`chatcmpl-` 前缀） |
| `object` | string | 恒为 `"chat.completion"`（流式为 `"chat.completion.chunk"`） |
| `created` | int | Unix 时间戳（秒） |
| `model` | string | 实际处理请求的模型版本 |
| `service_tier` | string/null | `"default"` / `"flex"` / `"auto"` / `null`（仅非流式） |
| `system_fingerprint` | string | 后端配置指纹——变化时说明模型后端有更新 |
| `choices` | array | 返回结果列表 |
| `usage` | object | Token 用量 |

## 2. Choices 数组

```json
{
  "choices": [{
    "index": 0,
    "message": {
      "role": "assistant",
      "content": "The answer is Paris.",
      "refusal": null,
      "tool_calls": null,
      "function_call": null
    },
    "logprobs": null,
    "finish_reason": "stop"
  }]
}
```

### choice.message 字段

| 字段 | 类型 | 说明 |
|------|------|------|
| `role` | string | 恒为 `"assistant"` |
| `content` | string/null | 文本内容。有 `tool_calls` 或 `refusal` 时为 `null` |
| `refusal` | string/null | 安全拒绝说明。非 `null` 时 `content` 必为 `null` |
| `tool_calls` | array/null | 工具调用列表。非 `null` 时 `content` 常为 `null` |
| `function_call` | object/null | 旧版函数调用（已弃用，用 `tool_calls` 替代） |

### content vs refusal vs tool_calls

三者互斥，共三种输出模式：

```
content 非 null  →  正常文本回复
refusal 非 null  →  安全策略拒绝
tool_calls 非 null →  请求工具调用
```

**注意**：少数情况下 model 可能同时输出简短的 `content` + `tool_calls`（告诉用户"我正在查..."）。

### logprobs（启用时）

```json
"logprobs": {
  "content": [
    {
      "token": "The",
      "logprob": -0.15,
      "bytes": [84, 104, 101],
      "top_logprobs": [
        {"token": "The", "logprob": -0.15, "bytes": [84, 104, 101]},
        {"token": "A", "logprob": -2.3, "bytes": [65]},
        {"token": "It", "logprob": -4.1, "bytes": [73, 116]}
      ]
    }
  ],
  "refusal": null
}
```

`logprobs.refusal` 仅在模型输出 `refusal` 时填充——列出模型"考虑过的拒绝 token"的概率。

## 3. Finish Reason

| 值 | 含义 | choices[n].message 状态 |
|----|------|------------------------|
| `stop` | 正常完成或有 stop 词 | `content` 非 null |
| `length` | 达到 `max_tokens` / `max_completion_tokens` | `content` 非 null（截断） |
| `tool_calls` | 请求工具调用 | `tool_calls` 非 null |
| `content_filter` | 被安全过滤器拦截 | `content` 可能为空，`refusal` 可能非 null |
| `function_call` | 旧版函数调用（已弃用）| `function_call` 非 null |

达到 `length` 时可续写——在下次请求中不改变 messages，增加 `max_tokens` 继续。模型接着上次截断处继续生成。

## 4. Usage

```json
"usage": {
  "prompt_tokens": 150,
  "completion_tokens": 80,
  "total_tokens": 230,
  "prompt_tokens_details": {
    "cached_tokens": 100,
    "audio_tokens": 0
  },
  "completion_tokens_details": {
    "reasoning_tokens": 0,
    "audio_tokens": 0,
    "accepted_prediction_tokens": 0,
    "rejected_prediction_tokens": 0
  }
}
```

### 基础字段

| 字段 | 说明 |
|------|------|
| `prompt_tokens` | 输入 token 数（messages + tools 声明） |
| `completion_tokens` | 输出 token 数（含 reasoning_tokens） |
| `total_tokens` | prompt + completion |

### prompt_tokens_details

| 字段 | 说明 |
|------|------|
| `cached_tokens` | 命中缓存的 token 数（50% 折扣） |
| `audio_tokens` | 音频输入的 token 数（仅 audio 模型） |

### completion_tokens_details

| 字段 | 说明 |
|------|------|
| `reasoning_tokens` | o 系列模型的推理 chain-of-thought token |
| `audio_tokens` | 音频输出的 token 数 |
| `accepted_prediction_tokens` | 被模型接受的预测 token（prediction 参数启用时） |
| `rejected_prediction_tokens` | 被模型拒绝的预测 token（prediction 参数启用时） |

## 5. Refusal 处理

```python
choice = response["choices"][0]

if choice["message"]["refusal"]:
    # 模型拒绝了请求
    reason = choice["message"]["refusal"]
    print(f"Request refused: {reason}")
    # 通常不应重试——安全策略拒绝

elif choice["finish_reason"] == "content_filter":
    # 被内容过滤器拦截
    print("Response filtered by safety system")
    # 修改 prompt 后重试

elif choice["message"]["content"] is not None:
    # 正常文本回复
    text = choice["message"]["content"]
```

**关键规则**：永远先检查 `refusal`，再检查 `content`。两者互斥但 `refusal` 优先。

## 6. Service Tier

```json
{
  "service_tier": "default"
}
```

| 值 | 说明 |
|----|------|
| `auto` | 自动选择 |
| `default` | 标准服务层 |
| `flex` | 低成本层（响应可能更慢，配额不同） |
| `null` | 模型或请求不支持分层 |

设置方式：请求中添加 `"service_tier": "flex"`。

## 7. 速率限制响应头

```http
x-ratelimit-limit-requests: 10000
x-ratelimit-remaining-requests: 9998
x-ratelimit-reset-requests: 8.64s

x-ratelimit-limit-tokens: 20000000
x-ratelimit-remaining-tokens: 19998750
x-ratelimit-reset-tokens: 14ms
```

| 头 | 说明 |
|----|------|
| `x-ratelimit-limit-requests` | RPM 上限 |
| `x-ratelimit-remaining-requests` | 剩余请求数 |
| `x-ratelimit-reset-requests` | RPM 重置倒计时 |
| `x-ratelimit-limit-tokens` | TPM 上限 |
| `x-ratelimit-remaining-tokens` | 剩余 token 数 |
| `x-ratelimit-reset-tokens` | TPM 重置倒计时 |

### 429 错误处理

```python
import time

if response.status_code == 429:
    reset_seconds = float(response.headers.get("x-ratelimit-reset-requests", "1").rstrip("s"))
    time.sleep(reset_seconds + 1)  # 等到限制重置+1秒
    retry()
```

## 8. HTTP 状态码

| 状态码 | 含义 | 处理 |
|--------|------|------|
| 200 | 成功 | 正常处理 |
| 400 | 请求格式错误 | 检查 JSON 格式、model 名称、参数值 |
| 401 | 鉴权失败 | 检查 API Key 或 Azure token |
| 403 | 权限不足 | 检查组织/项目权限、模型访问权 |
| 429 | 速率限制 | 指数退避重试（带 jitter） |
| 500 | 服务器错误 | 指数退避重试（最多 3 次） |
| 503 | 服务过载 | 等待后重试 |

### 错误响应格式

```json
{
  "error": {
    "message": "Incorrect API key provided: sk-xxx. You can find your API key at ...",
    "type": "invalid_request_error",
    "param": null,
    "code": "invalid_api_key"
  }
}
```

常见 `error.code`：

| code | 说明 |
|------|------|
| `invalid_api_key` | API Key 无效 |
| `context_length_exceeded` | 超出 context window |
| `rate_limit_exceeded` | 速率限制 |
| `insufficient_quota` | 配额不足 |
| `invalid_request_error` | 请求参数错误 |
| `server_error` | 服务器内部错误 |
| `model_not_found` | 模型名称错误 |
| `tokens_exceeded` | prompt token 超过模型最大 context |
