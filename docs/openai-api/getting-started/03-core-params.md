# 5 个最常用参数

> 到这里你已经能完成基本对话了。本节介绍 **5 个最常用参数**，让你能**精确控制**模型怎么回答。
>
> 学完这节，入门部分就齐活了——你已具备独立用 OpenAI API 做大部分事情的能力。

## 参数都放在请求体的哪里

所有参数都在 `-d` 的 JSON body 里，和 `model`、`messages` **平级**。骨架长这样：

```json
{
  "model": "...",
  "messages": [...],
  "temperature": 0.7,
  "max_tokens": 500,
  "top_p": 1,
  "stop": ["\n"],
  "n": 1
}
```

不写的参数就用默认值。下面逐个讲最重要的 5 个。

## temperature：随机性旋钮

这是**最常用、最有用**的参数。

把 temperature 想成一个**旋钮**：
- **0** = 最死板，每次给同样问题，回答几乎一模一样
- **2** = 最疯狂，胡言乱语、天马行空

范围 `0 ~ 2`，默认 `1`。

不同场景该调到几：

| 场景 | 建议 temperature | 为什么 |
|------|-----------------|--------|
| 代码生成、数学、事实问答 | `0` ~ `0.3` | 要准确、可复现 |
| 总结、翻译、日常对话 | `0.5` ~ `0.8` | 要自然但别乱跑 |
| 创意写作、头脑风暴 | `0.9` ~ `1.2` | 要新颖、发散 |

对比同一句话，看 temperature 的差别：

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
做调试或写测试时，把 `temperature: 0` 能让结果基本稳定，方便对比。
:::

## max_tokens：输出上限

上一节讲 token 时已接触过。它限制 `completion_tokens` 的最大值，防超长回答爆账单。

```json
"max_tokens": 200
```

注意：它限制的是 **token 数，不是字数**。设太小回答会被截断（`finish_reason` 变成 `length`）。

## top_p：另一种控制随机性

`top_p` 和 temperature 是**同一类**参数（都控制随机性），官方建议**二选一**，别同时调。

简单理解：`top_p: 0.1` 表示模型只从概率前 10% 的词里挑。值越小，越保守；越大，越发散。

```json
"top_p": 0.9
```

**多数情况下，调 temperature 就够了**，`top_p` 知道有这东西即可，初学可以不用。

## stop：自定义停止符

模型默认会"说完为止"。但有时你想让它**遇到某个标记就停**——用 `stop`。

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

`stop` 是一个数组，模型生成内容时一旦遇到其中任何一个字符串，就立即停止。

典型用途：
- 让模型只回答一部分（如只生成第一段）
- 结构化输出时分段（用分隔符作停止标记）

## n：一次要几个回答

让模型对**同一个输入**生成 `n` 个不同回答（需要配合 `temperature > 0` 才有意义）。

```json
"n": 3
```

用途：一次拿多个候选，让你挑最好的那个。

::: warning 注意账单
`n: 3` 意味着模型生成 3 倍的输出 token，**费用也是 3 倍**。
:::

## 一个综合示例

把 5 个参数全用上：

```bash
curl https://api.openai.com/v1/chat/completions \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $OPENAI_API_KEY" \
  -d '{
    "model": "gpt-4o-mini",
    "messages": [
      {"role": "system", "content": "你是创意文案"},
      {"role": "user", "content": "给咖啡店起 3 个名字"}
    ],
    "temperature": 0.9,
    "max_tokens": 200,
    "top_p": 1,
    "n": 1,
    "stop": ["\n\n"]
  }'
```

## 动手实验

1. **temperature 对比**：用同一个 prompt（如"写一句励志的话"），分别跑 `temperature: 0`、`0.7`、`1.5`，感受从死板到发散的变化。
2. **多候选**：设 `n: 3`、`temperature: 0.9`，一次拿 3 个咖啡店名候选，从 `choices[0]`、`choices[1]`、`choices[2]` 取出来对比。
3. **截断**：设 `max_tokens: 5`，看回答被截断、`finish_reason` 变 `length`。

## 入门篇完结

回顾这 4 节你学了什么：

| 节 | 技能 |
|----|------|
| [00 第一次调用](./00-first-call.md) | 会发请求、会读响应、会修常见错误 |
| [01 messages 数组](./01-messages-intro.md) | 会组织对话、会用 system 设人设、懂无状态 |
| [02 Token](./02-tokens.md) | 会看 usage、会算费用、会用 max_tokens 省钱 |
| [03 常用参数](./03-core-params.md) | 会用 temperature 控制随机性等 |

你已经具备独立用 OpenAI API 做大部分事情的能力了。

