# 参数全解

> **进阶篇压轴。** [入门篇 03](./getting-started/03-core-params.md) 你学了 9 个常用参数。本节把 Chat Completions API 的 **全部 25+ 参数**逐一列清——作为**查阅手册**用，不用一次读完。
>
> **本节你将学到**：必填参数、Token 控制、采样控制、推理控制、输出格式、流式选项、服务分级、缓存与元数据、安全筛选。最后一张场景速查表。
>
> **怎么用这节**：收藏，写代码时按需查。每个参数都标了类型、默认值、适用场景。

OpenAI Chat Completions API 的完整参数清单——25+ 参数逐一详解。

::: tip 参数全景图
所有参数分 7 组：**必填**（model/messages）→ **Token 控制**（max_tokens 等）→ **采样**（temperature/top_p/penalty）→ **推理**（reasoning_effort）→ **输出**（response_format/n/modalities）→ **流式**（stream/stream_options）→ **运营**（service_tier/store/user）。前面入门篇覆盖了前 3 组常用的，这里补全后 4 组和细节。
:::

## 1. 必填参数

| 参数 | 类型 | 说明 |
|------|------|------|
| `model` | string | 模型 ID：`gpt-4o`、`gpt-4o-mini`、`o3-mini`、`o4-mini` 等 |
| `messages` | array | 对话消息数组（见 01-messages） |

## 2. Token 控制

### max_tokens（已弃用，用 max_completion_tokens）

```json
{"max_tokens": 1000}
```

限制输出 token 数（含 reasoning_tokens）。`gpt-4o` 等非推理模型仍可使用，但 o 系列推荐用 `max_completion_tokens`。

### max_completion_tokens（推荐）

```json
{"max_completion_tokens": 1000}
```

仅限制**输出** token 数（含 reasoning_tokens + audio_tokens），不影响输入。

### 选择哪个？

```
非推理模型: 可用 max_tokens（语义清晰）
推理模型:   必须用 max_completion_tokens
两者同设:   max_completion_tokens 优先生效
```

### 合理值

```
分类/提取:     100-500
短问答:        200-1000
日常对话:      1000-4000
长文生成:      4000-16000
代码生成:      2000-8000
推理模型:      5000-25000（reasoning 消耗大量 token）
```

## 3. 随机性控制

### temperature

```json
{"temperature": 0.7}
```

| 值 | 效果 | 场景 |
|----|------|------|
| 0 | 几乎确定性（但不保证） | 代码、提取、分类 |
| 0.1-0.3 | 低随机性 | 翻译、事实问答 |
| 0.5-0.7 | 平衡 | 日常对话、客服 |
| 0.8-1.0 | 高创造性 | 写作、脑洞 |
| 1.0-2.0 | 极随机 | 不建议生产使用 |

**范围**：0-2。默认值 1。

### top_p（Nucleus Sampling）

```json
{"top_p": 0.9}
```

只从累积概率达 90% 的 token 中采样。范围 0-1，默认 1。

**规则**：`temperature` 和 `top_p` 只调一个（不要同时修改）。

### 选择建议

```
只用 temperature  →  通用推荐
只用 top_p        →  需要精细概率控制时
两个都不设       →  使用模型默认行为
```

## 4. 输出格式控制

### response_format

```json
// JSON 对象模式
{"response_format": {"type": "json_object"}}

// JSON Schema 模式（推荐）
{"response_format": {
  "type": "json_schema",
  "json_schema": {
    "name": "weather_report",
    "strict": true,
    "schema": {
      "type": "object",
      "properties": {
        "city": {"type": "string"},
        "temperature": {"type": "number"},
        "condition": {"type": "string", "enum": ["sunny", "cloudy", "rainy"]}
      },
      "required": ["city", "temperature", "condition"],
      "additionalProperties": false
    }
  }
}}
```

**注意**：`json_object` 模式需要 prompt 中明确提到 "JSON"——否则模型可能输出文本而非 JSON。`json_schema` 模式无此限制。

### strict 模式的约束

`"strict": true` 保证输出严格符合 JSON Schema，但限制多：

**支持**：
- 基本类型（string, number, integer, boolean, null, object, array）
- `enum`、`const`、`required`
- 嵌套 object（最多 5 层）
- `$ref` 和 `$defs`

**不支持**：
- `additionalProperties: true`
- `oneOf`、`anyOf`、`allOf`、`not`
- `minLength`、`maxLength`（string）
- `pattern`（regex）
- `format`
- 递归引用

## 5. 停止控制

### stop

```json
{"stop": ["\nUser:", "\n\n\n", "END"]}
```

遇到任一序列时停止。停止序列不包含在输出中。最多 4 个序列。

### 实用场景

```json
// 防止模型模拟用户发言
{"stop": ["\nUser:", "\nHuman:", "\nCustomer:"]}

// 限制输出长度（精确控制）
{"stop": ["."]}  // 只输出一句

// JSON 防后缀
{"stop": ["\n```"]}
```

## 6. 惩罚参数

### frequency_penalty

```json
{"frequency_penalty": 0.5}
```

抑制重复已使用的 token。正值减少逐字重复。范围 -2.0 到 2.0。

### presence_penalty

```json
{"presence_penalty": 0.6}
```

鼓励讨论新话题。正值减少话题重复。范围 -2.0 到 2.0。

### 组合建议

```
创意写作:   frequency_penalty=0.3, presence_penalty=0.6
代码/翻译:  不设置（会导致信息丢失）
事实问答:   不设置
日常对话:   不设置，或仅 frequency_penalty=0.1
```

## 7. 确定性控制

### seed

```json
{"seed": 42}
```

相同 seed + 相同参数 → 相同输出（需 `system_fingerprint` 不变）。

**限制**：仅在 `temperature` 相同时确定性生效。`system_fingerprint` 变化时结果可能不同。

## 8. Token 级别控制

### logit_bias

```json
{"logit_bias": {"1234": -100, "5678": 10}}
```

对特定 token ID 施加偏好。范围 -100 到 100。

```python
import tiktoken
enc = tiktoken.encoding_for_model("gpt-4o")
ban_id = enc.encode("harmful_word")[0]

response = call_api(
    logit_bias={ban_id: -100},  # 完全禁止
)
```

### logprobs

```json
{"logprobs": true, "top_logprobs": 3}
```

返回每个输出 token 的对数概率和 top-N 候选。

### 应用

```python
# 幻觉检测
logprobs = response["choices"][0]["logprobs"]["content"]
avg_logprob = sum(t["logprob"] for t in logprobs) / len(logprobs)

if avg_logprob < -3.0:
    print("⚠️ Low confidence — possible hallucination")

# 分类：比较两个选项的 logprob
option_a_logprob = response["choices"][0]["logprobs"]["content"][0]["top_logprobs"][0]["logprob"]
option_b_logprob = response["choices"][0]["logprobs"]["content"][0]["top_logprobs"][1]["logprob"]
confidence = option_a_logprob - option_b_logprob  # 越大越确定
```

## 9. 并发与数量

### n

```json
{"n": 3}
```

生成 n 个独立回复（choices 数组有 n 个元素）。每条单独计费。

不推荐用于 chat 场景——对话历史分支问题。适合创意生成、A/B 对比。

### parallel_tool_calls

```json
{"parallel_tool_calls": false}
```

禁止模型在一次回复中请求多个工具调用。

## 10. 推理模型专用参数

### reasoning_effort（o 系列模型）

```json
{"reasoning_effort": "medium"}
```

| 值 | 说明 |
|----|------|
| `low` | 快速推理（token 少，适合简单问题） |
| `medium` | 平衡（默认） |
| `high` | 深度推理（token 多，适合复杂问题） |

仅 `o1`、`o3-mini`、`o4-mini` 支持。GPT-4o 忽略此参数。

### max_completion_tokens 对推理模型的影响

推理模型的 `reasoning_tokens` 计入 `max_completion_tokens`：

```
max_completion_tokens = 5000
  ├── reasoning_tokens: 3000（链式推理）
  └── 留给可见输出的: 2000
```

如果 `max_completion_tokens` 太小，模型可能没有足够 token 完成推理。

### 推理内容可见性

```python
# o 系列模型 reasoning 默认不可见
# 需设置 stream=true 在流式中通过 delta.reasoning_content 获取
```

## 11. Prediction（预测输出）

```json
{
  "prediction": {
    "type": "content",
    "content": "{\"city\":\"Tokyo\",\"temperature\":22}"
  }
}
```

提供预期输出作为 hint 加速生成。仅 `gpt-4o` 和 `gpt-4o-mini` 支持。

被接受的预测 → `accepted_prediction_tokens` 不计费
被拒绝的预测 → `rejected_prediction_tokens` 正常计费

适用场景：编辑已有文本、代码补全、结构化输出——输出大部分已知时显著降低成本。

## 12. Service Tier

```json
{"service_tier": "flex"}
```

| 值 | 延迟 | 成本 | 适用 |
|----|------|------|------|
| `auto` | 自动 | 自动 | 默认 |
| `default` | 标准 | 标准 | 生产 |
| `flex` | 可能更高 | 更低 | 批处理、非延迟敏感 |

`flex` 层成本降低约 50%，但响应可能更慢、并发配额不同。

## 13. 存储与元数据

### store

```json
{"store": true}
```

是否将此次对话存储在 OpenAI 服务器。存储后可通过 Dashboard 查看。**默认 `false`**。

### metadata

```json
{"metadata": {"user_id": "u-123", "session_id": "s-456", "feature": "chat"}}
```

最多 16 个键值对，用于追踪和过滤。key 最大 64 字符，value 最大 512 字符。

### user

```json
{"user": "user-abc123"}
```

终端用户标识——帮助 OpenAI 监控滥用。不计入推理。

## 14. Audio 参数（仅 gpt-4o-audio-preview）

```json
{
  "modalities": ["text", "audio"],
  "audio": {
    "voice": "alloy",
    "format": "wav"
  }
}
```

| 参数 | 值 | 说明 |
|------|----|------|
| `modalities` | `["text"]` / `["text","audio"]` | 输出格式 |
| `audio.voice` | `alloy`/`echo`/`fable`/`onyx`/`nova`/`shimmer` | 音色 |
| `audio.format` | `wav`/`mp3`/`flac`/`opus`/`pcm16` | 音频格式 |

## 15. 完整参数示例

```json
{
  "model": "gpt-4o",
  "messages": [
    {"role": "developer", "content": "You are a helpful assistant."},
    {"role": "user", "content": "Write a haiku about AI"}
  ],
  "temperature": 0.8,
  "max_completion_tokens": 200,
  "top_p": 1.0,
  "frequency_penalty": 0.2,
  "presence_penalty": 0.3,
  "seed": 42,
  "stop": ["\n\n\n"],
  "n": 1,
  "stream": true,
  "stream_options": {"include_usage": true},
  "logprobs": true,
  "top_logprobs": 3,
  "parallel_tool_calls": true,
  "service_tier": "default",
  "store": false,
  "metadata": {"app": "my-agent", "version": "1.0"},
  "user": "end-user-123"
}
```

## 16. 参数组合速查

```
场景                temp   top_p  max_tokens  seed  freq_pen  pres_pen  reasoning
─────────────────────────────────────────────────────────────────────────────────
代码生成             0       —     3000        42    0         0         关闭
结构化提取           0       —     500         42    0         0         关闭
日常对话             0.7     —     2000        —     0         0         关闭
创意写作             0.9     —     2000        —     0.3       0.6       关闭
翻译                0.3     —     2000        —     0         0         关闭
简单推理(o3-mini)     —      —     10000       —     —         —         low
复杂推理(o3-mini)     —      —     20000       —     —         —         high
JSON Schema 输出     0       —     1000        42    0         0         关闭
多轮 Agent 对话      0.7     —     2000        —     0         0         关闭
批处理(低成本)       0.3     —     1000        —     0         0         — (service_tier:flex)
```

## 动手实验

1. **场景对照**：拿上面速查表里的 3 个场景（代码生成 / 创意写作 / JSON 输出），用对应的参数组合各发一次请求，对比返回风格。
2. **service_tier**：发两个请求分别带 `"service_tier": "flex"` 和 `"default"`（需账户支持 flex），看延迟和价格的差异。
3. **reasoning_effort**：用 `o3-mini` 分别设 `low` / `high`，看回答质量、耗时、`usage.completion_tokens_details.reasoning_tokens` 的差异。
4. **参数互斥**：同时设 `temperature: 0.7` 和 `top_p: 0.5`，看 API 是否警告（官方建议二选一，但不报错）。
5. **logprobs 玩概率**：设 `logprobs: true` + `top_logprobs: 3`，发"天空是___"，看模型在每个位置的 top 3 候选词及概率。

## 入门 → 进阶 完整闭环

恭喜——到这里你已经过完了 OpenAI API 协议的全部核心内容。回顾整条学习路径：

| 阶段 | 内容 |
|------|------|
| [入门 00](./getting-started/00-first-call.md) | 第一次调用、读响应 |
| [入门 01](./getting-started/01-messages-intro.md) | messages 三角色 |
| [入门 02](./getting-started/02-tokens.md) | token、max_tokens、context window |
| [入门 03](./getting-started/03-core-params.md) | 9 个常用参数 |
| [协议总览](./00-overview.md) | 协议地图、行业标准 |
| [Messages](./01-messages.md) | 五角色全解 |
| [响应格式](./02-response.md) | 响应全字段 |
| [流式 SSE](./03-streaming.md) | delta 拼接 |
| [Function Calling](./04-function-calling.md) | 工具调用、Agent 循环 |
| [多模态](./05-multimodal.md) | 图片/音频/文件 |
| [参数全解](./06-parameters.md)（本节）| 25+ 参数手册 |

接下来推荐：

- [工程实践 · DeepSeek](./07-deepseek.md) 起 —— 换国产模型省钱
- 各 Agent 框架文档（ADK-Go / LangChain / OpenAI Agents SDK）—— 把协议层知识用来理解框架内部
- [MCP 协议](../mcp/) —— Function Calling 之上的工具调用标准
