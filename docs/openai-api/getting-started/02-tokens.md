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

能。用 `max_tokens` 参数，规定模型**最多生成多少 token**，超过就强制截断：

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

加了 `max_tokens: 50`，模型写到 50 token 就被打断。这时你会看到返回里的 `finish_reason` 从平时的 `stop`（正常说完）变成了 **`length`**（因达到上限被截断）。

::: tip finish_reason 速记
- `stop` = 正常说完
- `length` = 被 max_tokens 截断
- （还有别的值，进阶篇讲）
:::

## 动手实验

1. **中英对比**：发两段意思相同的话，一段纯英文（如 "I like cats"）、一段纯中文（如 "我喜欢猫"），对比返回的 `prompt_tokens` 差异。你会直观看到中文更贵。
2. **截断实验**：问一个长问题（如"详细介绍太阳系"），设 `max_tokens: 10`，看回答被生硬截断、`finish_reason` 变成 `length`。

## 下一节预告

你已经会调、会组织对话、会算账了。但模型每次回答都不一样——有时太死板（写代码总一个样）、有时太天马行空（胡编乱造）。怎么精确控制它？

下一节介绍 5 个最常用参数：[5 个最常用参数](./03-core-params.md)。

## 进阶篇会深入讲什么

本节只讲了 token 基础。进阶篇会展开：

- [参数全解](../06-parameters.md) —— `usage` 的子字段（`prompt_tokens_details`、`completion_tokens_details`）、`reasoning_tokens`（推理模型额外消耗的 token）、context window 详解
