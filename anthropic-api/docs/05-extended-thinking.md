# 扩展思考 (Extended Thinking)

Extended Thinking 是 Claude 独有的能力——让模型在回答前进行显式的、可见的推理过程。与 OpenAI o 系列的"隐藏推理"不同，Claude 的思考过程可以查看和验证。

## 1. 启用 Extended Thinking

```json
{
  "model": "claude-sonnet-4-20250514",
  "max_tokens": 2000,
  "thinking": {
    "type": "enabled",
    "budget_tokens": 1600
  },
  "messages": [
    {"role": "user", "content": "Solve this complex math problem: ..."}
  ]
}
```

### thinking 参数

| 字段 | 说明 |
|------|------|
| `type` | `"enabled"` 或 `"disabled"`（默认） |
| `budget_tokens` | 思考的 token 预算（必须小于 max_tokens，最少 1024） |

关键规则：
- `budget_tokens` < `max_tokens`（要给回复留 token）
- 思考 token 也计入 `output_tokens` 计费
- 思考不会出现在 `messages` 中（每次请求独立，框架不保存思考历史）

## 2. 响应中的 thinking Block

```json
{
  "content": [
    {
      "type": "thinking",
      "thinking": "Let me break this problem down. First, I need to... The key insight here is that... This suggests the answer is 42.",
      "signature": "EqcBC0JFOiCicjEwLj..."
    },
    {
      "type": "text",
      "text": "The answer is 42. Here's the step-by-step solution..."
    }
  ],
  "stop_reason": "end_turn"
}
```

### Thinking Block 字段

| 字段 | 说明 |
|------|------|
| `type` | 恒为 `"thinking"` |
| `thinking` | 思考文本 |
| `signature` | 加密签名——验证思考内容来自 Claude 且未被篡改 |

## 3. 签名验证

`signature` 用于验证思考过程是否被客户端修改：

```python
def verify_thinking_signature(thinking_text: str, signature: str) -> bool:
    """验证思考内容的签名——防止展示给用户前被篡改"""
    # Anthropic 提供验证工具，或可第三方实现
    # 不通过验证时应隐藏 thinking 内容
    return true  # 伪代码
```

生产最佳实践：如果签名验证失败，不向用户展示 thinking 内容（安全性考虑）。

## 4. budget_tokens 规划

```
假设 max_tokens = 2000

简单问答:
  budget_tokens = 0（不需要思考）

推理问题:
  budget_tokens = 1200（思考占 60%）
  回复 token = 800（40%）

复杂分析:
  budget_tokens = 1600（思考占 80%）
  回复 token = 400（20%）
```

**规则**：`budget_tokens` + (预期回复 token 数) ≤ `max_tokens`。

Claude 不会恰好用完 `budget_tokens`——它会在思考充分后自然停止，剩余 token 用于回复。

## 5. Redacted Thinking

当思考内容涉及安全敏感信息时：

```json
{
  "type": "redacted_thinking",
  "data": "..."
}
```

这发生在 Claude 的思考中包含了可能不安全的内容（如漏洞利用细节、有害信息等）。SDK 通常不向用户展示这些内容。

## 6. 视觉思考

Extended Thinking 也支持图片理解：

```json
{
  "thinking": {"type": "enabled", "budget_tokens": 1000},
  "messages": [
    {
      "role": "user",
      "content": [
        {"type": "image", "source": {"type": "base64", "media_type": "image/png", "data": "..."}},
        {"type": "text", "text": "What is wrong with this circuit diagram?"}
      ]
    }
  ]
}
```

Claude 在思考中分析图片，然后给出回复。

## 7. 思考 + Tool Use

```json
{
  "thinking": {"type": "enabled", "budget_tokens": 1600},
  "tools": [
    {"name": "calculate", "input_schema": {...}},
    {"name": "search", "input_schema": {...}}
  ]
}
```

Claude 的思考过程会决定：是否调用工具？调用哪个工具？参数怎么填？

响应中可能的结构：

```
thinking block → "I should calculate the result using..."
tool_use block → calculate(expression="2+2")
thinking block → "The tool returned 4. Now I'll explain..."
text block → "The answer is 4."
```

思考 + Tool Use 让推理过程完全透明——你可以看到 Claude **为什么**决定调用某个工具。

## 8. 跨轮次思考

思考内容**不会自动保留**在 messages 中。需要将 thinking block 从响应中移除后再追加到对话历史：

```python
response = call_anthropic(messages, thinking_enabled=True)

# 提取纯对话部分（去掉 thinking blocks）
clean_response = {
    "role": "assistant",
    "content": [b for b in response["content"] if b["type"] != "thinking"]
}

messages.append(clean_response)
```

思考不是对话——它是 Claude 的"内心独白"，不应该混入多轮对话历史。

## 9. 成本考虑

思考 token 按 `output_tokens` 计费。以 Claude Sonnet 4 为例：

```python
# 一次思考 + 回复
input_tokens:   100   × $3.00/MTok  = $0.0003
thinking_tokens: 800  × $15.00/MTok = $0.012   # 思考比回复贵 5x
output_tokens:   200  × $15.00/MTok = $0.003
─────────────────────────────────────────────────
总计:                                  $0.0153
```

思考 800 tokens，但实际回复只有 200 tokens——这很常见。思考的详尽程度由 `budget_tokens` 控制，不是实际使用量。

## 10. 与 OpenAI o 系列的对比

| 维度 | Anthropic Extended Thinking | OpenAI o 系列 |
|------|---------------------------|---------------|
| 思考可见性 | ✅ 可见（thinking block） | ❌ 不可见（隐藏推理） |
| 思考计费 | 计入 output_tokens | 单独的 reasoning_tokens |
| 思考可验证 | ✅ 签名验证 | ❌ |
| 思考可控制 | budget_tokens 精确控制 | reasoning_effort（low/medium/high） |
| 缓存 | ❌ 不支持 | ❌ |
| Tool Use | ✅ 思考 + 工具混用 | 有限支持 |

最大的差异：Anthropic 的思考过程**可见、可验证**——你可以看到 Claude 的推理链。OpenAI 的推理过程隐藏在模型内部，你只能看到最终结果。
