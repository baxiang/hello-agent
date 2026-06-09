# 响应格式

Chat Completions API 的响应承载了模型生成的全部内容——从文本到工具调用、从 token 用量到完成原因。理解每个字段的含义、出现条件及字段间的互斥关系，是正确解析响应、处理异常和优化成本的前提。

> 本文基于 OpenAI API 最新规范，对每个字段做逐层拆解。

---

## 1. 顶层结构

一次完整的非流式请求返回如下 JSON：

```json
{
  "id": "chatcmpl-Bx7OJ3qHvTWZPmNfRpKj7LM8asQ2y",
  "object": "chat.completion",
  "created": 1746000000,
  "model": "gpt-4o-2024-08-06",
  "service_tier": null,
  "system_fingerprint": "fp_d3204613b2",
  "choices": [
    {
      "index": 0,
      "message": {
        "role": "assistant",
        "content": "巴黎是法国的首都，位于塞纳河畔...",
        "refusal": null,
        "annotations": [],
        "tool_calls": null,
        "function_call": null
      },
      "logprobs": null,
      "finish_reason": "stop"
    }
  ],
  "usage": {
    "prompt_tokens": 42,
    "completion_tokens": 128,
    "total_tokens": 170,
    "prompt_tokens_details": { "cached_tokens": 0, "audio_tokens": 0 },
    "completion_tokens_details": {
      "reasoning_tokens": 0,
      "audio_tokens": 0,
      "accepted_prediction_tokens": 0,
      "rejected_prediction_tokens": 0
    }
  }
}
```

### 1.1 `id` — 请求唯一标识

| 属性 | 说明 |
|------|------|
| 类型 | `string` |
| 格式 | `chatcmpl-` 前缀 + 29 位随机字符 |
| 何时出现 | 始终存在 |

每条请求都会生成唯一的 `id`，用于日志关联、审计追踪和问题排查。流式响应的每个 chunk 共享同一个 `id`。

```
非流式 → 单个 id
流式   → 全量 chunk 共享同一个 id
```

**实际应用**：将 `id` 与用户请求绑定写入日志，当用户反馈"回答有问题"时可以精确定位到那次生成。

### 1.2 `object` — 响应类型标识

| 属性 | 说明 |
|------|------|
| 类型 | `string` |
| 非流式 | `"chat.completion"` |
| 流式 | `"chat.completion.chunk"` |

用于前端/中间件判断当前数据包的类型，从而决定解析路径。

### 1.3 `created` — 生成时间戳

| 属性 | 说明 |
|------|------|
| 类型 | `integer` |
| 单位 | Unix 秒级时间戳 |
| 示例 | `1746000000` → `2025-04-30T12:00:00Z` |

标记模型开始生成响应的时刻（非请求到达时间）。可用于：
- 计算端到端延迟：`response.created - request.timestamp`
- 按时间排序历史对话

### 1.4 `model` — 实际使用的模型版本

| 属性 | 说明 |
|------|------|
| 类型 | `string` |
| 示例 | `"gpt-4o-2024-08-06"` |

这里返回的是**实际处理请求的模型快照版本**，而非你在请求中指定的模型名。例如请求 `gpt-4o`，响应可能是 `gpt-4o-2024-08-06`。

> **重要**：`model` 字段影响 `system_fingerprint` 的变化语义。同一模型名对应多个快照版本，每个版本的配置可能不同。

### 1.5 `service_tier` — 服务层级

| 值 | 说明 |
|----|------|
| `"default"` | 标准层（默认） |
| `"flex"` | 低成本层，延迟可能更高、配额限制不同 |
| `"auto"` | 由系统自动选择 |
| `null` | 模型/请求不支持分层 |

**仅在非流式响应中出现**。请求时通过 `"service_tier": "flex"` 指定。对于流式请求，`usage` 对象中的延迟统计可以间接反映服务层级。

### 1.6 `system_fingerprint` — 后端配置指纹

| 属性 | 说明 |
|------|------|
| 类型 | `string` / `null` |
| 格式 | `fp_` + 10 位 hex |
| 何时变化 | 模型后端配置发生实质性更新时 |

**核心用途**：确定性问题的根因分析。

```
场景 1：同一个 prompt 昨天和今天输出差异很大
  → 对比两次响应的 system_fingerprint
  → 相同 → 模型行为变化（temperature/seed 等原因）
  → 不同 → 后端配置变更（OpenAI 更新了模型版本）

场景 2：用 seed 参数追求可复现输出
  → system_fingerprint 变化 → seed 的确定性被打破
```

> **最佳实践**：在日志中记录 `system_fingerprint`。当输出质量出现波动时，这是排查的第一步。

### 1.7 `choices` — 生成结果列表

`choices` 是一个数组，长度由请求参数 `n` 决定（默认 `1`）。每个 choice 是模型的一次独立生成结果。

- `n=1` → 1 个 choice
- `n=3` → 3 个 choice，每个 `index` 分别为 0、1、2

多个 choice 之间**完全独立**——模型不会"看到"其他 choice 的内容。这在需要多个候选答案供用户选择或后续评分的场景下很有用。

### 1.8 `usage` — Token 用量统计

仅在非流式响应中出现（或在流式的最后一个 chunk 中，如果设置了 `stream_options: {"include_usage": true}`）。详见第 4 节。

---

## 2. Choice 对象

每个 choice 是模型生成的一个完整候选输出：

```json
{
  "index": 0,
  "message": {
    "role": "assistant",
    "content": "巴黎（Paris）是法国的首都和最大城市...",
    "refusal": null,
    "annotations": [],
    "tool_calls": null,
    "function_call": null
  },
  "logprobs": null,
  "finish_reason": "stop"
}
```

### 2.1 `index` — 候选编号

| 属性 | 说明 |
|------|------|
| 类型 | `integer` |
| 取值范围 | `0` ~ `n-1` |

在 `n > 1` 时区分不同候选。`n=1` 时恒为 `0`。

### 2.2 `message` — 助理消息体

`message` 是响应的核心载体。它是一个 `role: "assistant"` 的完整消息对象，包含以下互斥或互补的字段。

#### 2.2.1 `role`

恒为 `"assistant"`。所有响应中此字段不变，可用于消息类型的快速判断。

#### 2.2.2 `content`

| 属性 | 说明 |
|------|------|
| 类型 | `string` / `null` |
| 含义 | 模型生成的文本回复 |

**何时为 `null`**：

| 场景 | content | 说明 |
|------|---------|------|
| 工具调用 | `null` | 模型决定调用工具，不产生文本 |
| 安全拒绝 | `null` | `refusal` 字段有值 |
| 正常文本 | 非 `null` | 标准回复 |

> **例外**：少数模型（尤其是带 reasoning 的模型）在工具调用时可能**同时**输出简短的 `content`（如"我来帮你查一下..."），紧接着发出 `tool_calls`。解析时需要同时处理两者。

#### 2.2.3 `refusal`

| 属性 | 说明 |
|------|------|
| 类型 | `string` / `null` |
| 含义 | 安全系统拒绝生成时的说明文本 |

**触发条件**：用户的 prompt 触发了 OpenAI 的安全策略（如要求生成暴力内容、越狱尝试等）。

```
用户："教我如何制作..."（危险内容）
响应 refusal："抱歉，我无法提供制作危险物品的指导..."
响应 content：null
```

> **处理优先级**：先检查 `refusal`，再检查 `content`。两者互斥 —— `refusal` 非 null 时 `content` 必为 null，反之亦然。

#### 2.2.4 `annotations`

| 属性 | 说明 |
|------|------|
| 类型 | `array` / `null` |
| 含义 | 标注信息（当前仅用于 Web Search 工具） |

```json
"annotations": [
  {
    "type": "url_citation",
    "url_citation": {
      "start_index": 42,
      "end_index": 68,
      "url": "https://example.com/article",
      "title": "Understanding AI"
    }
  }
]
```

`start_index` 和 `end_index` 指示 `content` 中哪些字符来源于该引用 URL。前端可利用此信息渲染带来源链接的文本。

#### 2.2.5 `tool_calls` — 工具调用

| 属性 | 说明 |
|------|------|
| 类型 | `array` / `null` |
| 非 null 含义 | 模型要求客户端执行指定函数 |

```json
"tool_calls": [
  {
    "id": "call_abc123def456",
    "type": "function",
    "function": {
      "name": "get_weather",
      "arguments": "{\"location\":\"Paris\",\"unit\":\"celsius\"}"
    }
  }
]
```

每个 tool_call 包含：

| 字段 | 类型 | 说明 |
|------|------|------|
| `id` | string | 工具调用的唯一 ID，需在 tool 响应中原样带回 |
| `type` | string | 恒为 `"function"` |
| `function.name` | string | 函数名 |
| `function.arguments` | string | **JSON 字符串**，需要 `JSON.parse()` 后使用 |

> **关键细节**：`function.arguments` 是 JSON 编码的**字符串**，不是直接的 JSON 对象。即使模型输出合法 JSON，顶层字段的类型仍是 `string`。在静态语言中需要二次反序列化。

#### 2.2.6 `function_call` — 旧版函数调用（已弃用）

| 属性 | 说明 |
|------|------|
| 类型 | `object` / `null` |
| 状态 | 已弃用，用 `tool_calls` 替代 |

结构和 `tool_calls[0]` 类似，但没有 `id` 字段。仅在旧的 `functions` 参数模式下返回。新应用不应依赖此字段。

### 2.3 三种输出模式

`message` 的三个主要字段 `content`、`refusal`、`tool_calls` 构成了互斥的输出模式：

```
                    ┌─────────────┐
                    │  响应到达    │
                    └──────┬──────┘
                           │
                    ┌──────▼──────┐
                    │ refusal?    │
                    │ ≠ null      │
                    └──────┬──────┘
                     Yes   │   No
              ┌────────────┴────────────┐
              ▼                         ▼
    ┌──────────────────┐      ┌──────────────────┐
    │  安全拒绝         │      │  tool_calls?     │
    │  content = null  │      │  ≠ null          │
    └──────────────────┘      └────────┬─────────┘
                               Yes     │     No
                          ┌────────────┴────────────┐
                          ▼                         ▼
                ┌──────────────────┐      ┌──────────────────┐
                │  工具调用         │      │  正常文本         │
                │  content 可能 null│      │  content ≠ null  │
                └──────────────────┘      └──────────────────┘
```

### 2.4 `logprobs` — Token 级概率

仅在请求参数 `logprobs: true` 时返回，启用后对每个生成 token 返回其对数概率及候选 token 的概率分布。

```json
"logprobs": {
  "content": [
    {
      "token": "Paris",
      "logprob": -0.025,
      "bytes": [80, 97, 114, 105, 115],
      "top_logprobs": [
        { "token": "Paris", "logprob": -0.025, "bytes": [80, 97, 114, 105, 115] },
        { "token": "paris", "logprob": -3.14,  "bytes": [112, 97, 114, 105, 115] },
        { "token": "France", "logprob": -4.52, "bytes": [70, 114, 97, 110, 99, 101] }
      ]
    },
    {
      "token": " is",
      "logprob": -0.001,
      "bytes": [32, 105, 115],
      "top_logprobs": [
        { "token": " is", "logprob": -0.001, "bytes": [32, 105, 115] },
        { "token": ",", "logprob": -6.21, "bytes": [44] }
      ]
    }
  ],
  "refusal": null
}
```

#### 字段说明

| 字段 | 类型 | 说明 |
|------|------|------|
| `content` | array / null | 文本内容中每个 token 的概率信息 |
| `refusal` | array / null | 当模型 `refusal` 时，拒绝 token 的概率信息 |
| `token` | string | token 的文本表示 |
| `logprob` | float | token 的自然对数概率，越接近 0 概率越高 |
| `bytes` | array | token 对应的 UTF-8 字节数组 |
| `top_logprobs` | array | 该位置最可能的替代 token（数量由 `top_logprobs` 参数控制） |

#### 实际用途

- **输出置信度评估**：`logprob` 越接近 0，模型对该 token 越确定
- **幻觉检测**：一连串低概率 token 可能表示模型在"编造"
- **结构化解码**：在可控生成（guided generation）中用于选择最优路径
- **调试 prompt**：观察哪个 token 处概率急剧下降来定位 prompt 问题

### 2.5 `finish_reason` — 完成原因

`finish_reason` 说明生成为何结束。这是判断下一步处理逻辑的核心依据。

| 值 | 含义 | choice.message 状态 | 后续处理 |
|----|------|---------------------|----------|
| `stop` | 正常完成或命中自定义 stop 词 | `content` 非 null | 正常展示 |
| `length` | 达到 `max_tokens` 限制 | `content` 非 null（截断） | 续写或提示截断 |
| `tool_calls` | 模型请求执行工具 | `tool_calls` 非 null | 执行工具并回传结果 |
| `content_filter` | 被安全过滤器拦截 | `content` 可能为空 | 修改 prompt 重试 |
| `function_call` | 旧版函数调用（已弃用） | `function_call` 非 null | 同 tool_calls 处理 |

#### stop — 正常结束

模型自然完成回复，或生成的文本命中了 `stop` 参数指定的终止词。

#### length — Token 耗尽

模型的输出被 `max_tokens` / `max_completion_tokens` 截断。有以下处理策略：

```
方案 A：续写
  在下一次请求中保持 messages 不变，增大 max_tokens，模型从截断处继续生成
  注意：续写可能改变原意——模型没有"记忆"自己之前写了什么

方案 B：要求总结
  发送 "你的回复被截断了，请用更简洁的方式重新回答"

方案 C：调整设计
  对于长文本生成（长文、代码文件），增大 max_tokens
```

#### tool_calls — 工具调用请求

这是 Agent 循环的核心信号。处理流程：

```
1. 提取 tool_calls[n].function.name 和 arguments
2. 执行对应函数
3. 将结果作为 role: "tool" 消息追加到 messages
4. 再次调用 API，模型基于 tool 结果给出最终回复
```

#### content_filter — 内容过滤

OpenAI 的安全系统拦截了生成内容。`finish_reason` 为 `content_filter` 时：
- `content` 通常被设为空字符串或 null
- 此时 `refusal` 可能也有值（取决于触发层级）
- 不建议直接重试相同 prompt——应先审查并修改敏感内容

---

## 3. 流式响应（Streaming）的差异

当请求中 `stream: true` 时，响应由一系列 SSE（Server-Sent Events）组成，每个事件包含一个增量的 `chat.completion.chunk` 对象。

### 3.1 Chunk 结构

```json
{
  "id": "chatcmpl-xxx",
  "object": "chat.completion.chunk",
  "created": 1746000000,
  "model": "gpt-4o-2024-08-06",
  "system_fingerprint": "fp_d3204613b2",
  "choices": [
    {
      "index": 0,
      "delta": {
        "role": "assistant",
        "content": "巴"
      },
      "logprobs": null,
      "finish_reason": null
    }
  ],
  "usage": null
}
```

### 3.2 `delta` 与 `message` 的区别

| | 非流式 `message` | 流式 `delta` |
|----|----|----|
| 数据性质 | 完整消息 | 增量片段 |
| 首次出现 | `role` + 全部内容 | `role` 在首个 chunk，`content` 逐 chunk 累加 |
| tool_calls | 完整数组 | 逐字段增量：id → function.name → function.arguments |
| 最终组装 | 直接可用 | 需要客户端累加拼接 |

### 3.3 流式工具调用的增量传递

工具调用在流式模式下以**字段级增量**的方式传递，而非一次性给出完整对象：

```
chunk 1: delta.tool_calls[0].index = 0
chunk 2: delta.tool_calls[0].id = "call_abc"
chunk 3: delta.tool_calls[0].function.name = "get_weather"
chunk 4: delta.tool_calls[0].function.arguments = "{\"loc"
chunk 5: delta.tool_calls[0].function.arguments = "ation\":"
chunk 6: delta.tool_calls[0].function.arguments = "\"Paris\"}"
```

客户端需要：
1. 按 `index` 分组
2. 将同名 chunk 的字段**累加**而非覆盖
3. `finish_reason` 出现时才表示该 choice 的流结束

### 3.4 `usage` 在流式中的返回

默认流式响应不含 `usage`。要获取统计，需在请求中设置：

```json
"stream_options": {
  "include_usage": true
}
```

此时在流结束前的最后一个 chunk 中，`usage` 字段会填充完整的 token 统计，该 chunk 的 `choices` 数组为空（`[]`），`usage` 对象的结构与非流式一致。

### 3.5 流式 cancel 与 truncation

如果客户端在流中间断开连接：
- 已经流出的 token 仍然计费
- `finish_reason` 不会正常返回
- 中断的流不能被恢复——需要新请求重新开始

---

## 4. Usage — Token 用量

### 4.1 基础字段

| 字段 | 说明 | 计费依据 |
|------|------|----------|
| `prompt_tokens` | 输入 token 数 | 输入定价 |
| `completion_tokens` | 输出 token 数（含 `reasoning_tokens`） | 输出定价 |
| `total_tokens` | `prompt + completion` | — |

对于 o 系列和带 reasoning 的模型，`completion_tokens` 包含推理 token。计费时推理 token 可能按不同价格计算。

### 4.2 prompt_tokens_details — 输入细节

| 字段 | 类型 | 说明 |
|------|------|------|
| `cached_tokens` | int | 命中 prompt cache 的 token 数，享受 50% 折扣 |
| `audio_tokens` | int | 仅 audio 模型，音频输入 token 数 |

#### Prompt Caching 工作原理

OpenAI 自动缓存超过 1024 token 且位于前缀位置的 prompt 内容。命中缓存时：

- 对应的 `prompt_tokens` 中，`cached_tokens` 部分按 50% 折扣计费
- 不需要显式启用——只要 prompt 前缀与之前的请求匹配即可
- 典型场景：长 system prompt + 多轮对话中的历史消息

```
优化策略：
1. 将 system prompt 放在 messages 数组最前面
2. 将不变的内容（如角色设定、长期记忆）放在可变的用户消息前面
3. 使用相同的 prompt 前缀结构以提高缓存命中率
```

### 4.3 completion_tokens_details — 输出细节

| 字段 | 类型 | 说明 |
|------|------|------|
| `reasoning_tokens` | int | o 系列模型的内部推理 token（chain-of-thought） |
| `audio_tokens` | int | 音频输出 token 数 |
| `accepted_prediction_tokens` | int | 启用预测（prediction）参数时被采纳的 token |
| `rejected_prediction_tokens` | int | 启用预测（prediction）参数时被拒绝的 token |

#### reasoning_tokens 计费模式

对于 `o1`、`o3`、`o4-mini` 等推理模型：

```
completion_tokens = reasoning_tokens + 可见输出 token

计费方式：
  reasoning_tokens → 按推理 token 价格（通常比输出 token 高）
  可见输出 token    → 按输出 token 价格（标准定价）
```

可以通过 `reasoning_effort` 参数（`"low"` / `"medium"` / `"high"` / `"max"`）控制模型花在推理上的 token 量。

---

## 5. 错误响应

当 API 调用失败时（HTTP 4xx/5xx），响应体不是 `chat.completion` 结构，而是错误对象：

```json
{
  "error": {
    "message": "Incorrect API key provided: sk-xxx...",
    "type": "invalid_request_error",
    "param": null,
    "code": "invalid_api_key"
  }
}
```

### 5.1 错误对象字段

| 字段 | 类型 | 说明 |
|------|------|------|
| `message` | string | 人类可读的错误描述 |
| `type` | string | 错误分类 |
| `param` | string / null | 导致错误的参数名（如有） |
| `code` | string / null | 机器可读的错误码 |

### 5.2 HTTP 状态码与处理策略

| 状态码 | 含义 | 是否重试 | 处理 |
|--------|------|----------|------|
| 200 | 成功 | — | 正常解析 |
| 400 | 请求格式错误 | 否 | 检查 JSON 结构、model 名称、参数合法性 |
| 401 | 鉴权失败 | 否 | 检查 API Key / Token 是否有效 |
| 403 | 权限不足 | 否 | 检查组织/项目/模型访问权限 |
| 404 | 资源不存在 | 否 | 检查 endpoint 路径 |
| 429 | 速率限制 | 是 | 等待后指数退避重试 |
| 500 | 服务器内部错误 | 是 | 指数退避重试（最多 3 次） |
| 503 | 服务临时不可用 | 是 | 等待后重试 |

### 5.3 常见 error.code

| code | 含义 | 解决方案 |
|------|------|----------|
| `invalid_api_key` | API Key 非法 | 检查 Key 格式和有效期 |
| `context_length_exceeded` | 超出模型上下文窗口 | 缩短 messages 或使用更大 context 的模型 |
| `rate_limit_exceeded` | 触发速率限制 | 实现退避重试或升级套餐 |
| `insufficient_quota` | 账户配额不足 | 充值或等待下个计费周期 |
| `invalid_request_error` | 请求参数错误 | 检查 `param` 字段定位具体问题 |
| `server_error` | 服务端内部异常 | 指数退避重试 |
| `model_not_found` | 模型名错误或无权访问 | 确认模型名称拼写和权限 |
| `tokens_exceeded` | 单次请求超过模型的最大 context | 减少 prompt 或选择更大模型 |

### 5.4 429 退避策略

```python
import time
import random

def handle_rate_limit(response, attempt, max_retries=5):
    if attempt >= max_retries:
        raise Exception("Max retries exceeded")

    reset_header = response.headers.get("x-ratelimit-reset-requests", "1")
    wait = float(reset_header.rstrip("s")) + random.uniform(0, 1)

    # 指数退避：取 reset 时间和指数增长中的较小值
    wait = min(wait, 2 ** attempt)

    time.sleep(wait)
    return attempt + 1
```

### 5.5 错误响应与正常响应的区分

客户端在处理 HTTP 响应时必须先判断状态码：

```
if status == 200:
    body = response.json()
    if "error" in body:
        # API 层面错误（罕见，通常伴随非 200 状态码）
        handle_error(body["error"])
    else:
        # 正常 chat.completion 响应
        handle_completion(body["choices"])
else:
    body = response.json()
    handle_error(body["error"])
```

---

## 6. HTTP 响应头

除 JSON body 外，响应的 HTTP Headers 携带关键元信息。以下是重要的响应头：

### 6.1 速率限制头

```
x-ratelimit-limit-requests: 10000
x-ratelimit-remaining-requests: 9998
x-ratelimit-reset-requests: 8.64s

x-ratelimit-limit-tokens: 20000000
x-ratelimit-remaining-tokens: 19998750
x-ratelimit-reset-tokens: 14ms

x-ratelimit-limit-requested-tokens: 1500
x-ratelimit-remaining-requested-tokens: 1498
x-ratelimit-reset-requested-tokens: 12ms
```

| 头 | 说明 | 维度 |
|----|------|------|
| `x-ratelimit-limit-requests` | 请求次数上限 | RPM |
| `x-ratelimit-remaining-requests` | 剩余请求次数 | RPM |
| `x-ratelimit-reset-requests` | RPM 限制重置时间 | RPM |
| `x-ratelimit-limit-tokens` | Token 总量上限 | TPM |
| `x-ratelimit-remaining-tokens` | 剩余 Token 总量 | TPM |
| `x-ratelimit-reset-tokens` | TPM 限制重置时间 | TPM |
| `x-ratelimit-limit-requested-tokens` | 请求 Token 上限（completion_tokens * multiplier） | 单次请求 |
| `x-ratelimit-remaining-requested-tokens` | 剩余请求 Token 配额 | 单次请求 |

### 6.2 其他重要头

```
openai-organization: org-xxx
openai-processing-ms: 2341
openai-version: 2024-08-06
x-request-id: req_abc123
```

| 头 | 说明 |
|----|------|
| `openai-organization` | 处理请求的组织 ID |
| `openai-processing-ms` | 服务器端处理耗时（毫秒） |
| `openai-version` | API 版本 |
| `x-request-id` | OpenAI 内部的请求追踪 ID |

---

## 7. 完整解析流程

将上述内容整合为生产级的响应解析流程：

```python
def parse_chat_completion(response):
    """
    完整解析 Chat Completions API 响应。
    返回 (status, result)。
      status: "success" | "refused" | "tool_call" | "truncated" | "filtered"
    """

    # 1. 记录元信息
    request_id = response.get("id")
    model_version = response.get("model")
    fingerprint = response.get("system_fingerprint")
    tier = response.get("service_tier")

    # 2. 记录 usage
    usage = response.get("usage", {})

    # 3. 处理 choices
    results = []
    for choice in response.get("choices", []):
        index = choice["index"]
        message = choice["message"]
        finish = choice.get("finish_reason")

        # 4. 优先级：refusal > tool_calls > content
        if message.get("refusal"):
            results.append({
                "index": index,
                "status": "refused",
                "reason": message["refusal"],
            })

        elif message.get("tool_calls"):
            tools = []
            for tc in message["tool_calls"]:
                tools.append({
                    "id": tc["id"],
                    "name": tc["function"]["name"],
                    "arguments": json.loads(tc["function"]["arguments"]),
                })
            results.append({
                "index": index,
                "status": "tool_call",
                "tool_calls": tools,
            })

        elif finish == "content_filter":
            results.append({
                "index": index,
                "status": "filtered",
            })

        elif finish == "length":
            results.append({
                "index": index,
                "status": "truncated",
                "content": message.get("content", ""),
            })

        else:
            results.append({
                "index": index,
                "status": "success",
                "content": message.get("content", ""),
            })

    return {
        "request_id": request_id,
        "model": model_version,
        "fingerprint": fingerprint,
        "usage": usage,
        "results": results,
    }
```

---

## 8. 设计模式与最佳实践

### 8.1 字段间的约束关系

```
┌────────────────────────────────────────────────────┐
│                                                    │
│  refusal ≠ null  ←──→  content = null              │
│                             ↕（通常）              │
│  tool_calls ≠ null ←──→  content = null（多数情况） │
│                                                    │
│  finish_reason = "stop"         → content 可用      │
│  finish_reason = "tool_calls"   → tool_calls 可用  │
│  finish_reason = "length"       → content 被截断    │
│  finish_reason = "content_filter" → 内容不应展示    │
│                                                    │
└────────────────────────────────────────────────────┘
```

### 8.2 多模态响应的识别

当请求中包含图片等非文本内容时，响应格式不变——仍然返回 `content` 字符串。模型将图片分析结果编码为自然语言文本。多模态体现在输入侧（`content` 可以是 `ContentPart` 数组），而非输出侧改写 `message.content` 的结构。

### 8.3 响应大小与延迟考量

| 因子 | 影响 | 优化 |
|------|------|------|
| `max_tokens` 过大 | 响应大、延迟高 | 按需设置，通常 2048 以内足够 |
| `n > 1` | 响应体倍增 | 仅在确实需要多候选时使用 |
| `logprobs` 开启 | 响应体 ×3~10 | 生产环境默认关闭 |
| `stream: true` | 首 token 延迟低，总耗时相同 | 交互式场景建议开启 |

---

## 9. 小结

| 关注点 | 关键结论 |
|--------|----------|
| 顶层结构 | `id` + `object` + `model` + `choices[]` + `usage`，非流式完整 |
| 三种输出模式 | `content` > `refusal` > `tool_calls` 互斥，按此优先级处理 |
| `finish_reason` | 决定后续处理逻辑，`stop`/`tool_calls`/`length`/`content_filter` |
| 流式差异 | `delta` 增量传递，需客户端拼接；`usage` 需显式请求 `stream_options.include_usage` |
| Token 用量 | `cached_tokens` 享受 50% 折扣，`reasoning_tokens` 另计 |
| 错误处理 | 优先区分 HTTP 状态码，再按 `error.code` 分类重试策略 |
| `system_fingerprint` | 输出不一致时的根因分析利器，建议日志记录 |
