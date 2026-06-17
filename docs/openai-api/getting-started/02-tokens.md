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

多轮对话越聊越长，`messages` 越塞越多，最终会撞上限——这时要么删旧消息、要么换更大窗口的模型。（这一节的后面会专门讲 context window 的细节。）

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

## Context window：不是参数，是模型的「容量」

很多人会找 `max_context_window` 这个参数——**它不存在**。Context window（上下文窗口）是模型的**固有属性**，就像杯子的容量，出厂就定了，你在请求里改不了。

API 里所有「能控制 token 数」的参数，**只有 `max_tokens` / `max_completion_tokens` 这一个**（管输出上限）。输入侧、总量侧都没有对应的调节参数。

### 各模型的容量（以官网为准）

| 模型 | Context window | 最大输出 |
|------|---------------|---------|
| `gpt-4o` | 128,000 | 16,384 |
| `gpt-4o-mini` | 128,000 | 16,384 |
| `gpt-3.5-turbo` | 16,385 | 4,096 |
| `o1` | 200,000 | 100,000 |
| `o3` | 200,000 | 100,000 |

::: tip 两个不同的数字
注意上表有**两列**——「context window」是总容量（输入+输出共享），「最大输出」是单次回答能生成的上限。它们是**两个独立**的约束，别混了。
:::

### 硬性约束：输入 + 输出 ≤ context window

一次调用能塞进多少，遵循这个关系：

```
prompt_tokens + completion_tokens  ≤  context_window
                                       （模型固有属性）
```

也就是说：
- 输入 `messages` 越长，留给输出的空间越小
- 你设的 `max_tokens` 既不能超过「最大输出」，也不能超过「context_window − prompt_tokens」
- **塞不下会怎样**：请求会被 API 直接拒绝（报错），告诉你超过了最大上下文长度。注意这跟 `finish_reason: length`（被 max_tokens 截断）是**两回事**——一个是请求阶段就拒了，一个是生成阶段被截了。

### 多轮对话为什么会「撑爆」

因为 API 无状态（[上一节](./01-messages-intro.md) 讲过），每轮都要把**全部历史**发回去。对话越长，`prompt_tokens` 越大，迟早撞上 context window。应对办法：

1. **删旧消息**：只保留最近几轮，丢掉早期历史
2. **摘要压缩**：用模型把旧对话总结成一段，替代原始消息
3. **换大窗口模型**：如从 `gpt-4o`（128k）换到 `o1`（200k）

## 其他 token 相关参数

除了 `max_tokens`，还有几个参数和 token 有关。它们**不改变**生成结果，只是「观察」或「统计」token。

### stream_options：流式时拿 token 用量

还记得 `stream: true` 时，回答是一段段推送的吗？默认情况下，**流式响应不返回 `usage` 字段**——你不知道总共用了多少 token。

设 `stream_options: {"include_usage": true}`，API 会在 `data: [DONE]` **之前**额外推一个 chunk，里面带完整的 `usage`：

```bash
curl https://api.openai.com/v1/chat/completions \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $OPENAI_API_KEY" \
  -d '{
    "model": "gpt-4o-mini",
    "messages": [{"role": "user", "content": "讲个笑话"}],
    "stream": true,
    "stream_options": {"include_usage": true}
  }'
```

这是**流式模式下获取 token 用量的唯一方式**。注意这个最终 chunk 的 `choices` 是空数组，`usage` 才有值。

::: warning 小坑
如果流式中途被打断（网络断、超时），你可能收不到这个最终的 usage chunk。
:::

### logprobs / top_logprobs：看模型「差点选了什么」

这两个参数让你**偷看模型在每个位置的概率分布**——也就是除了最终选的词，它还考虑了哪些备选词、各自概率多少。

- `logprobs: true` —— 返回每个输出 token 的对数概率（log probability）
- `top_logprobs: 5` —— 额外返回每个位置概率最高的 5 个候选 token（范围 0~20，需配合 `logprobs: true`）

```bash
curl https://api.openai.com/v1/chat/completions \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $OPENAI_API_KEY" \
  -d '{
    "model": "gpt-4o-mini",
    "messages": [{"role": "user", "content": "天空是"}],
    "logprobs": true,
    "top_logprobs": 3
  }'
```

返回里每个 token 会带类似这样的信息：

```json
{
  "token": " 蓝",
  "logprob": -0.0158,
  "top_logprobs": [
    {"token": " 蓝",  "logprob": -0.0158},
    {"token": " 蓝",  "logprob": -3.12},
    {"token": " 紫",  "logprob": -4.56}
  ]
}
```

::: tip 什么时候用得上
这是**只读观察**工具，不改生成结果。用途：评估模型置信度、做 A/B 对比、调试模型「为什么这么说」。入门阶段用不到，知道有这东西即可。
:::

## 怎么提前算 token 数

有时你想**在发请求之前**就知道大概要用多少 token（估算成本、避免超长报错）。有两条路：

### 方法一：tiktoken（离线估算，只算文本）

OpenAI 官方的 Python 库 [`tiktoken`](https://github.com/openai/tiktoken)，本地算文本的 token 数，不耗 API 额度：

```bash
pip install tiktoken
```

```python
import tiktoken
enc = tiktoken.encoding_for_model("gpt-4o")
print(len(enc.encode("我喜欢猫")))   # 输出 token 数
```

::: warning 局限
tiktoken 只能算**纯文本**。图片、文件、工具声明（tools schema）、消息格式化（role 字段等）这些占的 token 它算不准。复杂场景得用下面的方法二。
:::

### 方法二：input_tokens 端点（精确，但要调 API）

OpenAI 提供了一个专门算 token 数的端点，接受和正式请求一样的输入，返回精确计数：

```bash
curl https://api.openai.com/v1/responses/input_tokens \
  -H "Authorization: Bearer $OPENAI_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "gpt-4o-mini",
    "input": [{"role": "user", "content": "我喜欢猫"}]
  }'
```

返回 `{"input_tokens": 6, "object": "response.input_tokens"}`。

::: tip 两个方法怎么选
- 只算文本、想离线快速估算 → **tiktoken**
- 有图片/文件/工具、要精确数 → **input_tokens 端点**（注意它属于 Responses API，不是 Chat Completions；Chat Completions 没有对应的计数端点）
:::

## 动手实验

1. **中英对比**：发两段意思相同的话，一段纯英文（如 "I like cats"）、一段纯中文（如 "我喜欢猫"），对比返回的 `prompt_tokens` 差异。你会直观看到中文更贵。
2. **截断实验**：问一个长问题（如"详细介绍太阳系"），设 `max_tokens: 10`，看回答被生硬截断、`finish_reason` 变成 `length`。
3. **流式拿用量**：加 `stream: true` 和 `stream_options: {"include_usage": true}`，用 `curl --no-buffer` 看 `data: [DONE]` 前那个带 `usage` 的 chunk。
4. **离线算 token**：用 tiktoken 算一段你准备发的 messages 文本，再实际发请求对比 `prompt_tokens`，感受 tiktoken 估算和实际的差距。

