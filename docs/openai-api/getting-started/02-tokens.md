# Token：大模型的「计费单位」

> 调用几次 API 后，你会关心两件事：**花了多少钱**、**为什么这么慢**。
>
> 答案都藏在一个词里：**token**。

## Token 不是字，也不是单词

你可能以为「1000 个字 = 1000 个计费单位」。错。

大模型并不按"字"或"单词"看文本，而是先把文本切成一个个**碎片**，每个碎片就是一个 token。这种切分不严格对应汉字或英文单词。

常见规律：

| 文本 | 大约 token 数 |
|------|--------------|
| `Hello` | 1 |
| `Hello world` | 2 |
| `你好` | 2（一个汉字约 1-2 token） |
| `"Hello," she said.` | 6（含标点、空格） |
| 一行代码 `let x = 1 + 2;` | 约 8 |

注意几个反直觉的点：
- **标点和空格也算 token**
- **汉字往往比英文字母贵**——同样的意思，用中文表达可能比英文花更多 token
- **代码**有很多符号，token 占用也不小

## 为什么这么切

不必深究切分算法（那是 BPE、SentencePiece 之类的技术）。你只要记住一句话：

> **模型内部就是这么"看"文字的。输入和输出都按 token 计费。**

你可以用 OpenAI 的在线工具 `https://platform.openai.com/tokenizer` 直观看一段文本被切成多少 token。

## usage 字段：看这次调用花了多少

回顾第一次调用返回里的这段：

```json
"usage": {
  "prompt_tokens": 25,
  "completion_tokens": 12,
  "total_tokens": 37
}
```

| 字段 | 含义 |
|------|------|
| `prompt_tokens` | **你发出去的** token 数（含全部 `messages`：system + 所有 user/assistant 历史） |
| `completion_tokens` | **模型生成的** token 数（回答的那段） |
| `total_tokens` | 两者之和 = **本次调用的计费依据** |

::: warning 重点
`prompt_tokens` 包含你塞回去的**全部对话历史**。这就是上一节说的"对话越长越贵"的原因——历史每多一轮，`prompt_tokens` 就涨一截。
:::

## Token 影响三件事

### 1. 费用

OpenAI 的价格表是「**每 100 万 token 多少美元**」，而且输入和输出分开计价。

以 `gpt-4o-mini` 为例（**价格以官网为准**，这里仅举例）：

| | 价格（约） |
|---|---|
| 输入 prompt_tokens | $0.15 / 1M token |
| 输出 completion_tokens | $0.60 / 1M token |

注意 **输出比输入贵 4 倍**——所以让模型"少废话"能显著省钱。

算笔账：一次调用 `prompt_tokens=1000`、`completion_tokens=500`，费用 ≈
`(1000/1M × $0.15) + (500/1M × $0.60)` ≈ $0.00045。单次很便宜，但量大就累积。

### 2. 速度

模型是**逐 token 往外吐**的。`completion_tokens` 越多，生成时间越长。这就是为什么长回答要等更久——也引出了"流式输出"的需求（进阶篇会讲）。

### 3. 上限（context window）

每个模型有**上下文窗口**大小限制，比如 128000 token（即 128k）。你的 `prompt_tokens` + `completion_tokens` **总和不能超过这个数**。

多轮对话越聊越长，`messages` 越塞越多，最终会撞上限——这时要么删旧消息、要么换更大窗口的模型。

## max_tokens 参数：给输出上把锁

既然输出越多越贵越慢，能不能限制模型别写太长？

能。用 `max_tokens` 参数，给**模型的回答**设一个上限。

### 先搞懂三个关键点

很多人对 `max_tokens` 有误解。先把最关键的三个点讲清楚：

**① 它管的是「输出」，不管「输入」。**

`max_tokens` **只限制模型生成（completion）** 的 token 数。你发出去的 `messages`（prompt）完全不受影响——prompt 该多少 token 还是多少 token，照常计费。它给的是「模型**最多能回答多少**」的配额。

**② 它是「上限（天花板）」，不是「目标」。**

这是最容易搞错的地方。设 `max_tokens: 1000` **不代表**模型会硬凑 1000 token 才停。它只是说「最多生成 1000，不能更多」。

- 如果模型在第 80 token 自然就回答完了 → 80 停止，**不会**强行写满 1000
- 如果模型本来想写 2000 token → 写到 1000 被强制截断

所以它是个**天花板**（ceiling），不是目标值（target）。

**③ 不设也能跑——大多数情况不用管。**

不传 `max_tokens`，模型会按自己的节奏答完为止（正常 `finish_reason=stop`）。只有在你想**控制成本 / 限速 / 防止超长输出**时才需要显式设置。

### 上限被触发时会怎样

设了上限，模型若没自然说完就被截断，返回里的 `finish_reason` 会从 `stop` 变成 `length`：

```bash
curl https://api.openai.com/v1/chat/completions \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $OPENAI_API_KEY" \
  -d '{
    "model": "gpt-4o-mini",
    "messages": [{"role": "user", "content": "详细介绍一下太阳系"}],
    "max_tokens": 50
  }'
```

`max_tokens: 50` 很小，模型刚开了个头就被打断，`finish_reason` 变成 `length`，回答也明显被生硬切断（句子没说完）。

::: tip finish_reason 速记
- `stop` = 模型自然说完
- `length` = 撞到 max_tokens 上限，被截断
- （还有 `content_filter`、`tool_calls` 等，进阶篇讲）
:::

### 这个值能设多大？

有两个现实约束（**不是**你能随便填的）：

1. **模型自身的「最大输出」上限**：每个模型有个出厂最大输出值，比如 `gpt-4o` 是 16,384 token（具体以官网模型页为准）。你设的 `max_tokens` 不能超过这个。
2. **要给输入留位置**：一次调用 = 输入 token + 输出 token，它们的**总和**要装得进模型的「上下文窗口」（context window，如 128,000）。也就是说，输入 `messages` 越长，留给输出的空间就越小，`max_tokens` 能设的上限也就越低。设得超过剩余空间，请求会直接报错。

实际建议：**留够就行，别拉满**。常见做法是按用途设个合理值（如摘要 200、短答 500、长文 2000），既防超长爆账单，又不至于把模型答案截断。

### 注意：推理模型要换成 `max_completion_tokens`

如果你用 **o 系列**推理模型（`o1` / `o3` / `o4-mini` 等），`max_tokens` **不支持**，必须用新名字 **`max_completion_tokens`**。

`gpt-4o` / `gpt-4o-mini` / `gpt-3.5-turbo` 等非推理模型：`max_tokens` 仍可用（OpenAI 标记为 deprecated，推荐逐步改用 `max_completion_tokens`，两个名字目前都接受）。

```bash
# 推理模型（o1 / o3 / o4）必须用新参数名
"max_completion_tokens": 1000

# 非推理模型（gpt-4o 等）两个名字都行
"max_tokens": 1000
```

::: warning 推理模型特别注意
对推理模型，`max_completion_tokens` 的预算**包含「思考过程」的 token**（reasoning tokens，模型内部推理、不显示给你看的部分），而**不只是**最终可见的回答。

也就是说，模型可能「想」了很久（消耗大量 reasoning token），导致真正输出给你的可见文字比预期少得多。给推理模型设这个值时，要留得更宽松。
:::

## 动手实验

1. **中英对比**：发两段意思相同的话，一段纯英文（如 "I like cats"）、一段纯中文（如 "我喜欢猫"），对比返回的 `prompt_tokens` 差异。你会直观看到中文更贵。
2. **截断实验**：问一个长问题（如"详细介绍太阳系"），设 `max_tokens: 10`，看回答被生硬截断、`finish_reason` 变成 `length`。

