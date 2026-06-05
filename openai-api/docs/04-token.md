# Token 计算与计费

## 1. 什么是 Token

Token 是 LLM 处理文本的基本单位。不是字符，不是单词，而是**BPE（Byte Pair Encoding）子词单元**。

```
"Hello world" → ["Hello", " world"]
"ChatGPT is great" → ["Chat", "G", "PT", " is", " great"]
"你好世界" → 每个汉字约 1.5-3 个 token
```

粗略估算：
- 英文：1 token ≈ 0.75 个单词 ≈ 4 个字符
- 中文：1 token ≈ 0.5-0.7 个汉字

## 2. Context Window（上下文窗口）

模型能处理的最大总 token 数（输入 + 输出）：

| 模型 | Context Window |
|------|---------------|
| gpt-4o | 128,000 |
| gpt-4o-mini | 128,000 |
| gpt-4-turbo | 128,000 |
| o3-mini | 200,000 |
| gpt-3.5-turbo | 16,385 |
| DeepSeek-V3 | 128,000 |
| Claude 3.5 Sonnet | 200,000 |
| Gemini 2.5 Pro | 1,000,000+ |

超出 context window 时 API 返回错误：
```json
{
  "error": {
    "code": "context_length_exceeded",
    "message": "This model's maximum context length is 128000 tokens..."
  }
}
```

## 3. tiktoken：编程式 Token 计数

```python
import tiktoken

# 选择编码器
enc = tiktoken.encoding_for_model("gpt-4o")

# 计算 token 数
text = "Hello, how are you today?"
tokens = enc.encode(text)
print(f"Tokens: {len(tokens)}")  # 7
print(tokens)  # [9906, 11, 1268, 527, 498, 2377, 30]

# 解码
decoded = enc.decode(tokens)
print(decoded)  # "Hello, how are you today?"
```

### 消息级别的 Token 计数

```python
def count_message_tokens(messages: list[dict], model: str = "gpt-4o") -> int:
    """精确计算 messages 数组的 token 数"""
    enc = tiktoken.encoding_for_model(model)
    num_tokens = 0

    for message in messages:
        num_tokens += 4  # 每条消息的基础开销

        for key, value in message.items():
            num_tokens += len(enc.encode(str(value)))

            if key == "name":  # name 字段额外开销
                num_tokens += 1

    num_tokens += 2  # assistant 回复的 primer
    return num_tokens

# 示例
messages = [
    {"role": "system", "content": "You are helpful."},
    {"role": "user", "content": "What is AI?"},
]
print(count_message_tokens(messages, "gpt-4o"))  # ~25 tokens
```

## 4. Token 计费

API 按 token 数计费（2026年参考价）：

| 模型 | 输入 $/1M tokens | 输出 $/1M tokens |
|------|-----------------|------------------|
| gpt-4o | $2.50 | $10.00 |
| gpt-4o-mini | $0.15 | $0.60 |
| gpt-4.1 | $1.60 | $12.80 |
| gpt-4.1-mini | $0.27 | $1.07 |
| o3-mini | $1.10 | $4.40 |
| DeepSeek-V3 | ¥1 | ¥2 |

**输出 token 比输入 token 贵 3-8 倍**——这是优化成本的关键方向。

## 5. Token 优化策略

### 1. 裁剪历史

```python
def trim_history(messages: list, max_tokens: int) -> list:
    """保留最近的消息，确保不超 context window"""
    while count_message_tokens(messages) > max_tokens:
        # 保留 system message，删除最早的一对 user+assistant
        if messages[0]["role"] == "system":
            del messages[1:3]
        else:
            del messages[0:2]
    return messages
```

### 2. 摘要压缩

```python
def summarize_history(messages: list) -> str:
    """让 LLM 自己摘要历史，替代完整历史"""
    history_text = format_messages(messages[:-2])  # 排除最后一轮
    summary_prompt = f"Summarize this conversation in 100 words: {history_text}"
    summary = call_llm(summary_prompt)
    return summary  # 替换完整历史，大幅减少 token
```

### 3. Prompt 设计

```
❌ "请非常详细地解释什么是人工智能，包括其历史、发展、应用、未来趋势..."
   → 输入 ~50 tokens，输出 ~500 tokens

✅ "AI 是什么？一句话回答"
   → 输入 ~10 tokens，输出 ~20 tokens
```

### 4. 使用缓存

```python
# OpenAI prompt caching（自动）
# 相同的 prompt 前缀被缓存，减少计费

# 每次请求时保持 system message 相同
system_msg = {"role": "system", "content": "You are a helpful..."}
# API 自动检测并缓存重复前缀
```

### 5. 模型选择

```
简单分类/提取 → gpt-4o-mini（$0.15/$0.60）
复杂推理     → gpt-4o（$2.50/$10.00）
深度思考     → o3-mini（$1.10/$4.40）
```

## 6. Usage 中的 details

```json
"usage": {
  "prompt_tokens": 150,
  "completion_tokens": 80,
  "total_tokens": 230,
  "prompt_tokens_details": {
    "cached_tokens": 100,  // 被缓存命中的输入 token（不计费/折扣）
    "audio_tokens": 0
  },
  "completion_tokens_details": {
    "reasoning_tokens": 0,  // o 系列模型的推理 token
    "audio_tokens": 0,
    "accepted_prediction_tokens": 0,
    "rejected_prediction_tokens": 0
  }
}
```

## 7. 在 ADK-Go 中的对应

```go
// model/llm.go
type LLMResponse struct {
    UsageMetadata *genai.GenerateContentResponseUsageMetadata
    // UsageMetadata.PromptTokenCount
    // UsageMetadata.CandidatesTokenCount
    // UsageMetadata.TotalTokenCount
}

// ADK-Go 把 OpenAI Usage 转为 genai 的 UsageMetadata 格式
```

自定义模型实现时，从 OpenAI API 响应的 `usage` 字段提取这三个数值，填入 `LLMResponse.UsageMetadata`。

## 8. 常见问题

**Q：为什么同样的文本，不同库计算的 token 数不同？**

A：tiktoken 是 OpenAI 官方实现，最准确。其他库可能有微小差异。以 API 返回的 `usage` 为准。

**Q：function calling 中的 tool 结果计入 token 吗？**

A：计入 prompt_tokens。工具调用声明和结果都是 inputs 的一部分。

**Q：如何知道超了 context window？**

A：API 返回 400 错误，`error.code` = `"context_length_exceeded"`。
