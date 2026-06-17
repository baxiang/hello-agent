# 常用参数详解

> 到这里你已经能完成基本对话了。本节介绍 **9 个常用参数**，让你能**精确控制**模型怎么回答。
>
> 学完这节，入门部分就齐活了——你已具备独立用 OpenAI API 做大部分事情的能力。

## 参数都放在请求体的哪里

所有参数都在 `-d` 的 JSON body 里，和 `model`、`messages` **平级**。不写的参数就用默认值。

```json
{
  "model": "...",
  "messages": [...],
  "temperature": 0.7,
  "max_tokens": 500,
  "top_p": 1,
  "stop": ["\n"],
  "n": 1,
  "stream": false,
  "seed": 1234,
  "response_format": {"type": "text"},
  "presence_penalty": 0,
  "frequency_penalty": 0
}
```

下面分三类讲：**控制回答风格**（4 个）、**控制输出形态**（3 个）、**控制采样多样性**（2 个）。

---

## 一、控制回答风格

### temperature：随机性旋钮 ⭐ 最常用

把 temperature 想成一个**旋钮**：
- **0** = 最死板，每次给同样问题，回答几乎一模一样
- **2** = 最疯狂，胡言乱语、天马行空

范围 `0 ~ 2`，默认 `1`。

| 场景 | 建议 temperature | 为什么 |
|------|-----------------|--------|
| 代码生成、数学、事实问答 | `0` ~ `0.3` | 要准确、可复现 |
| 总结、翻译、日常对话 | `0.5` ~ `0.8` | 要自然但别乱跑 |
| 创意写作、头脑风暴 | `0.9` ~ `1.2` | 要新颖、发散 |

同一句话对比：

```bash
# 死板版：几乎每次都一样
curl https://api.openai.com/v1/chat/completions \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $OPENAI_API_KEY" \
  -d '{
    "model": "gpt-4o-mini",
    "messages": [{"role": "user", "content": "给咖啡店起个名字"}],
    "temperature": 0
  }'

# 创意版：每次不同、更发散
curl https://api.openai.com/v1/chat/completions \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $OPENAI_API_KEY" \
  -d '{
    "model": "gpt-4o-mini",
    "messages": [{"role": "user", "content": "给咖啡店起个名字"}],
    "temperature": 1.2
  }'
```

::: tip 可复现性
调试或写测试时，设 `temperature: 0` 能让结果基本稳定，方便对比。但注意 OpenAI 官方说这种复现只是「尽力而为」，偶尔仍会有微小差异。
:::

### max_tokens：输出上限

[上一节](./02-tokens.md#max-tokens-参数给输出上把锁) 已详细讲过。一句话回顾：

**只限制模型生成（completion）的 token 数，是上限不是目标。** 触发上限会截断，`finish_reason` 变成 `length`。

```bash
"max_tokens": 200
```

补充一个新名字：**推理模型（o1/o3/o4）必须用 `max_completion_tokens`**，不支持 `max_tokens`；且该预算**包含思考过程（reasoning tokens）**，可能可见输出比预期短。

### presence_penalty / frequency_penalty：反重复调节钮

temperature 控制整体随机性，这两个则是**针对「重复」的精调**。范围都是 `-2.0 ~ 2.0`，默认 `0`（= 不调节）。

| 参数 | 怎么算 | 正值的作用 |
|------|--------|-----------|
| `presence_penalty` | 看某个词**有没有出现过**（出现≥1 次就惩罚） | 鼓励**聊新话题**、引入新词 |
| `frequency_penalty` | 看某个词**出现了多少次**（出现越多惩罚越重） | 减少**逐字重复**同一句话 |

::: tip 一句话区分
- 文章一直在重复同一句话 → 调高 **frequency_penalty**
- 文章总围绕同一个主题打转、不肯展开 → 调高 **presence_penalty**
:::

```bash
curl https://api.openai.com/v1/chat/completions \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $OPENAI_API_KEY" \
  -d '{
    "model": "gpt-4o-mini",
    "messages": [{"role": "user", "content": "写一段 500 字的秋日散文"}],
    "frequency_penalty": 0.5,
    "presence_penalty": 0.3
  }'
```

负值则反向——鼓励重复（少用）。**默认 0 即可，出现重复时再小幅上调（0.3 ~ 1.0）**，别一上来就拉满。

---

## 二、控制输出形态

### stop：自定义停止符

模型默认会"说完为止"。但有时你想让它**遇到某个标记就停**——用 `stop`。

`stop` 是一个数组，模型生成时一旦遇到其中**任何一个**字符串，就立即停止（该字符串本身不会包含在输出里）。

```bash
curl https://api.openai.com/v1/chat/completions \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $OPENAI_API_KEY" \
  -d '{
    "model": "gpt-4o-mini",
    "messages": [{"role": "user", "content": "写三句话描述秋天，每句一行"}],
    "stop": ["\n\n"]
  }'
```

典型用途：
- 让模型只回答一部分（如只生成第一段，遇到空行就停）
- 结构化输出时分段（用分隔符作停止标记）

### response_format：让模型吐 JSON

默认模型返回纯文本。当你想让程序**直接解析结构化数据**，用 `response_format` 强制返回合法 JSON。

**JSON 模式**——保证输出是**合法 JSON**：

```bash
curl https://api.openai.com/v1/chat/completions \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $OPENAI_API_KEY" \
  -d '{
    "model": "gpt-4o-mini",
    "messages": [
      {"role": "system", "content": "你是信息提取器，用 JSON 返回，包含 name 和 age 字段"},
      {"role": "user", "content": "张三今年 25 岁"}
    ],
    "response_format": {"type": "json_object"}
  }'
```

返回内容类似 `{"name": "张三", "age": 25}`，可直接 `JSON.parse`。

::: warning 两个硬性约束
1. **必须**在 `messages` 里出现 "JSON" / "json" 这个词（system 或 user 都行），否则 API 直接报错。
2. JSON 模式只保证输出是**合法 JSON**，**不保证**字段结构符合你的预期。想要严格匹配某个 schema，用更强的 **Structured Outputs**：
   ```json
   "response_format": {"type": "json_schema", "json_schema": {...}}
   ```
   它会强制模型按你给的 schema 输出（进阶篇会展开）。
:::

### n：一次要几个回答

让模型对**同一个输入**生成 `n` 个不同回答（需配合 `temperature > 0` 才有意义）。返回的 `choices` 数组会有 `n` 个元素。

```bash
"n": 3
```

用途：一次拿多个候选，让你挑最好的那个。

::: warning 注意账单
`n: 3` 意味着模型生成 3 倍的输出 token，**费用也是 3 倍**。
:::

---

## 三、控制采样多样性

### top_p：另一种控制随机性

`top_p` 和 temperature 是**同一类**参数（都控制随机性），官方建议**二选一**，别同时调。

简单理解：`top_p: 0.1` 表示模型只从概率前 10% 的词里挑。值越小，越保守；越大，越发散。

```json
"top_p": 0.9
```

**多数情况下，调 temperature 就够了**，`top_p` 知道有这东西即可，初学可以不用。

### seed：尽力复现（已 Deprecated）

想让「同样的输入 + 同样的参数」返回尽量相同的结果，用 `seed` 指定一个整数种子。

```bash
curl https://api.openai.com/v1/chat/completions \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $OPENAI_API_KEY" \
  -d '{
    "model": "gpt-4o-mini",
    "messages": [{"role": "user", "content": "随机给我一个颜色"}],
    "temperature": 0.7,
    "seed": 42
  }'
```

::: warning 三个要点
1. **官方原文："Determinism is not guaranteed"（不保证确定性）**。OpenAI 只承诺「尽力而为」，偶尔仍会不同。
2. **该参数已被标记 Deprecated（弃用）**。新项目不要依赖它做关键逻辑。
3. 返回里的 **`system_fingerprint`** 字段是「后端配置指纹」，**不是**种子本身——它的作用是：当你发现相同 seed 结果变了，对比 `system_fingerprint` 是否变化，就能判断是不是后端升级导致的。
:::

调试或做 A/B 对比时可用 seed 减少随机干扰，但**不要**把复现依赖写成产品逻辑。

### stream：流式输出 ⭐ 高频

默认（`stream: false`）：模型把整段回答**全部生成完**，才一次性返回一个 JSON。长回答要干等十几秒。

设 `stream: true`：模型**边生成边推送**，像 ChatGPT 那样**逐字出现**——用户立刻看到第一个字，体验好得多。

```bash
curl https://api.openai.com/v1/chat/completions \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $OPENAI_API_KEY" \
  -d '{
    "model": "gpt-4o-mini",
    "messages": [{"role": "user", "content": "讲个长一点的笑话"}],
    "stream": true
  }'
```

返回不再是单个 JSON，而是一连串 **SSE（Server-Sent Events）** 数据行，每行是 `data: {json片段}\n\n`，每个片段里有 `delta` 字段携带**增量**内容（不是完整消息）：

```
data: {"choices":[{"delta":{"content":"为"}}]}

data: {"choices":[{"delta":{"content":"什"}}]}

data: {"choices":[{"delta":{"content":"么"}}]}

data: [DONE]
```

直到最后一行 `data: [DONE]` 表示结束。

::: tip 两种模式怎么选
- **短回答 / 后台批处理** → 用默认非流式，代码简单
- **面向用户的聊天 / 长回答** → 用 `stream: true`，首字延迟低、体验好
:::

流式的完整协议（chunk 结构、tool call 流式、错误处理）在**进阶篇 [流式协议 (SSE)](../03-streaming.md)** 深入展开。

---

## 一个综合示例

把上面参数组合起来（创意文案 + JSON 输出 + 控制重复）：

```bash
curl https://api.openai.com/v1/chat/completions \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $OPENAI_API_KEY" \
  -d '{
    "model": "gpt-4o-mini",
    "messages": [
      {"role": "system", "content": "你是创意文案，用 JSON 返回，字段为 names 数组"},
      {"role": "user", "content": "给咖啡店起 3 个名字"}
    ],
    "temperature": 0.9,
    "max_tokens": 200,
    "frequency_penalty": 0.4,
    "response_format": {"type": "json_object"}
  }'
```

## 参数速查表

| 参数 | 类型 | 默认 | 一句话作用 |
|------|------|------|-----------|
| `temperature` | 0~2 | 1 | 随机性旋钮（最常用） |
| `max_tokens` | int | 模型上限 | 输出 token 上限（推理模型改用 `max_completion_tokens`） |
| `top_p` | 0~1 | 1 | 另一种随机性控制，和 temperature 二选一 |
| `presence_penalty` | -2~2 | 0 | 鼓励聊新话题 |
| `frequency_penalty` | -2~2 | 0 | 减少逐字重复 |
| `stop` | 数组 | 无 | 遇到指定字符串就停 |
| `response_format` | object | text | 强制返回 JSON（json_object / json_schema） |
| `n` | int | 1 | 一次生成几个候选（费用×n） |
| `seed` | int | 随机 | 尽力复现（已 Deprecated） |
| `stream` | bool | false | 流式输出，逐 token 推送 |

## 动手实验

1. **temperature 对比**：同一个 prompt（如"写一句励志的话"），分别跑 `temperature: 0`、`0.7`、`1.5`，感受从死板到发散。
2. **反重复**：让模型"写一首 8 行诗"，先不设惩罚，再加 `frequency_penalty: 0.6` 对比重复感。
3. **JSON 输出**：用 `response_format: json_object` 让模型把"北京明天天气"提取成 `{"city":..., "weather":...}`，用 `jq` 或 Python 解析。
4. **流式体验**：把任意请求加 `"stream": true`，用 `curl --no-buffer` 亲眼看到字一个个冒出来。
5. **多候选**：设 `n: 3`、`temperature: 0.9`，一次拿 3 个咖啡店名候选。

## 入门篇完结

回顾这 4 节你学了什么：

| 节 | 技能 |
|----|------|
| [00 第一次调用](./00-first-call.md) | 会发请求、会读响应、会修常见错误 |
| [01 messages 数组](./01-messages-intro.md) | 会组织对话、会用 system 设人设、懂无状态 |
| [02 Token](./02-tokens.md) | 会看 usage、会算费用、会用 max_tokens 省钱 |
| [03 常用参数](./03-core-params.md) | 会用 9 个参数精确控制输出 |

你已经具备独立用 OpenAI API 做大部分事情的能力了。
