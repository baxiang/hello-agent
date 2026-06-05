# 参数调优

OpenAI Chat Completions API 提供多个参数控制输出质量和行为。理解每个参数是写出高质量 Agent 的关键。

## 1. 参数速查表

| 参数 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `temperature` | float | 1.0 | 随机性控制（0-2） |
| `top_p` | float | 1.0 | 核采样阈值（0-1） |
| `max_tokens` | int | inf | 最大输出 token 数 |
| `n` | int | 1 | 生成几个备选回复 |
| `stop` | str/array | null | 停止词 |
| `seed` | int | null | 确定性采样种子 |
| `presence_penalty` | float | 0 | 话题重复惩罚（-2.0 到 2.0） |
| `frequency_penalty` | float | 0 | 词频重复惩罚（-2.0 到 2.0） |
| `logprobs` | bool | false | 是否返回对数概率 |
| `top_logprobs` | int | null | 返回 top-N 最可能 token |
| `logit_bias` | map | null | 对特定 token 施加偏好 |
| `user` | string | null | 终端用户标识 |

## 2. Temperature：控制随机性

```
temperature = 0 → 完全确定性，每次相同输入得到相同输出
temperature = 1 → 默认平衡
temperature = 2 → 极随机，输出不可预测
```

### 场景推荐

```
0.0 - 0.2:  数学计算、代码生成、结构化提取、JSON 输出
0.3 - 0.7:  日常对话、客服、翻译（推荐范围）
0.8 - 1.0:  创意写作、脑洞、头脑风暴
1.0+:       诗歌、随机生成（不推荐用于生产）
```

### temperature vs top_p

通常**只调一个**：

```python
# 方式一：只用 temperature
{"temperature": 0.7}

# 方式二：只用 top_p
{"top_p": 0.9}

# ❌ 不要同时调整两个（效果不可预测）
{"temperature": 0.7, "top_p": 0.9}
```

## 3. max_tokens：限制输出长度

```json
{
  "max_tokens": 100   // 最多输出 100 个 token
}
```

- 不设 `max_tokens` 时，模型输出到自然停止或 context window 用完
- 到达 `max_tokens` 时 `finish_reason = "length"`
- 实际 token 消耗 = `prompt_tokens + max_tokens`，必须在 context window 内

### 合理设置

```
短问答、分类:   50-200
日常对话:       500-1000
长文生成:       2000-4000
代码生成:       1000-3000
```

## 4. stop：自定义停止词

```json
{
  "stop": ["User:", "\n\n\n"]
}
```

模型遇到 stop 词中的任何一个时停止输出。停止词不包含在输出中。

### 实用场景

```json
// 限制只输出一个句子
{"stop": ["."]}

// 格式化对话，不让模型模拟用户发言
{"stop": ["\nUser:", "\nHuman:"]}

// 只输出 JSON（防止 json 后有废话）
{"stop": ["\n```"]}
```

## 5. seed：确定性输出

```json
{
  "seed": 42,
  "temperature": 0  // seed + temperature=0 = 完全可复现
}
```

设置 seed + temperature=0 后，相同输入始终得到相同输出。`system_fingerprint` 相同时才保证完全一致。

## 6. Presence & Frequency Penalty

```
presence_penalty > 0:  鼓励模型谈论新话题（-2.0 到 2.0）
frequency_penalty > 0: 抑制重复使用相同词汇（-2.0 到 2.0）
```

```json
{
  "presence_penalty": 0.6,   // 鼓励多样化话题
  "frequency_penalty": 0.3   // 减少词汇重复
}
```

应用场景：
- `presence_penalty=0.6` + `frequency_penalty=0.3`：创意写作
- 不需要：代码生成、翻译、事实问答（会导致信息丢失）

## 7. logprobs：输出概率分析

```json
{
  "logprobs": true,
  "top_logprobs": 3
}
```

返回每个输出 token 的 log 概率：

```json
{
  "choices": [{
    "logprobs": {
      "content": [
        {
          "token": "The",
          "logprob": -0.1,
          "bytes": [84, 104, 101],
          "top_logprobs": [
            {"token": "The", "logprob": -0.1},
            {"token": "A", "logprob": -2.5},
            {"token": "It", "logprob": -4.0}
          ]
        },
        ...
      ]
    }
  }]
}
```

用途：
- **置信度评估**：logprob 接近 0 = 模型很确定，远离 0 = 不确定（可能幻觉）
- **分类决策**：比较不同选项的 logprob
- **幻觉检测**：答案中 logprob 极低的 token 可能是幻觉

```python
def avg_logprob(response) -> float:
    """计算回复的平均置信度"""
    logprobs = response["choices"][0]["logprobs"]["content"]
    return sum(t["logprob"] for t in logprobs) / len(logprobs)

# 使用阈值判断
if avg_logprob(response) < -3:
    print("低置信度，可能幻觉")
```

## 8. logit_bias：精细控制

```json
{
  "logit_bias": {
    "1234": -100,   // 完全禁止 token ID 1234
    "5678": 10      // 偏好 token ID 5678
  }
}
```

通过 token ID 控制——需要先用 tiktoken 查出目标 token 的 ID：

```python
enc = tiktoken.encoding_for_model("gpt-4o")
word_id = enc.encode("python")[0]  # 获取 "python" 的 token ID

# 禁止模型输出 "python"
response = call_api(
    model="gpt-4o",
    messages=[...],
    logit_bias={word_id: -100},
)
```

## 9. n：多条备选回复

```json
{
  "n": 3
}
```

一次请求返回 3 条独立生成的回复（`choices` 数组有 3 个元素）。每条按各自 token 计费。

不推荐用于 chat 场景（对话历史分支问题），适合：
- A/B 测试不同 temperature 下的回复
- 生成多个备选让用户挑选
- 批量评估

## 10. response_format：结构化输出

```json
{
  "response_format": {
    "type": "json_object"
  }
}
```

或 JSON Schema 模式：

```json
{
  "response_format": {
    "type": "json_schema",
    "json_schema": {
      "name": "weather_report",
      "schema": {
        "type": "object",
        "properties": {
          "city": {"type": "string"},
          "temperature": {"type": "number"},
          "condition": {"type": "string"}
        },
        "required": ["city", "temperature", "condition"],
        "additionalProperties": false
      },
      "strict": true
    }
  }
}
```

`strict: true` 保证输出严格符合 schema，但限制较多（不支持 optional 字段、nested anyOf 等）。

## 11. 参数组合最佳实践

```
场景                       temperature   top_p   max_tokens   seed
────────────────────────────────────────────────────────────────
代码生成（确定性）           0            1       3000         42
日常聊天                   0.7          1       1000         无
创意写作                   0.9          1       2000         无
结构化提取                 0            1       500          42
多轮对话 Agent             0.7          1       2000         无
翻译                       0.3          1       2000         无
数学推理                   0            1       -            42
JSON 输出                  0            1       1000         42
```
