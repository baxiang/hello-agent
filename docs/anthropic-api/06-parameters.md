# 参数调优

Anthropic Messages API 的参数比 OpenAI 更精简——可控的少，但每个都很关键。

## 1. 参数速查表

| 参数 | 类型 | 必填 | 默认值 | 说明 |
|------|------|------|--------|------|
| `model` | string | ✅ | — | 模型 ID |
| `max_tokens` | int | ✅ | — | **最大输出 token 数（必填！）** |
| `messages` | array | ✅ | — | 对话消息数组 |
| `system` | string/array | ❌ | — | System prompt |
| `temperature` | float | ❌ | 1.0 | 随机性控制（0-1） |
| `top_p` | float | ❌ | — | 核采样 |
| `top_k` | int | ❌ | — | Top-K 采样 |
| `stop_sequences` | array | ❌ | — | 停止序列 |
| `stream` | bool | ❌ | false | 流式模式 |
| `tools` | array | ❌ | — | 工具定义 |
| `tool_choice` | object | ❌ | `{"type": "auto"}` | 工具选择策略 |
| `thinking` | object | ❌ | — | Extended Thinking 配置 |
| `metadata` | object | ❌ | — | 自定义元数据 |

## 2. max_tokens：必填参数

```json
{
  "max_tokens": 1000  // 必须设置，无默认值
}
```

这是 Anthropic API 与 OpenAI 最大的使用差异——`max_tokens` 是必填的。

### 合理设置

```
短问答、分类:    200-500
日常对话:        500-2000
长文生成:        2000-8000
代码生成:        2000-4000
思考推理:        max_tokens - thinking_budget ≥ 500
```

### 续写模式

当 `stop_reason: "max_tokens"` 时，可以续写：

```python
response = call_anthropic(messages, max_tokens=1000)
if response["stop_reason"] == "max_tokens":
    # 追加 assistant 回复，继续
    messages.append({"role": "assistant", "content": response["content"]})
    response2 = call_anthropic(messages, max_tokens=1000)
    # 合并两次回复
```

## 3. temperature

```
temperature = 0   → 几乎确定性的输出
temperature = 0.5 → 平衡
temperature = 1.0 → 最大随机性（默认）
```

**推荐值**：

```
分析、提取、分类:  0
日常对话:         0.3 - 0.7
创意写作:         0.7 - 1.0
```

与 OpenAI 的关键差异：Anthropic 的 `temperature` 范围是 `0-1`（OpenAI 是 `0-2`）。

## 4. top_p（Nucleus Sampling）

```json
{
  "temperature": 0.7,
  "top_p": 0.9
}
```

只从累积概率达到 90% 的 token 集合中采样。与 OpenAI 的 `top_p` 含义相同。

**建议**：通常不设 `top_p`，只调节 `temperature`。需要更精细控制时，用 `temperature=0.5` + `top_p=0.9`。

## 5. top_k

```json
{
  "top_k": 50  // 只从概率最高的 50 个 token 中采样
}
```

Anthropic 特有的参数。`top_k=0` 表示不限制（默认）。

与 top_p 的区别：
- `top_k=50`：固定 50 个候选
- `top_p=0.9`：候选数量动态变化（取决于概率分布）

很少需要同时设置。推荐只用 `temperature`。

## 6. stop_sequences

```json
{
  "stop_sequences": ["\n\nHuman:", "\n\nAssistant:", "END"]
}
```

遇到任一序列时停止输出。停止序列不包含在输出中。

### Claude 对话格式保护

```json
{
  "stop_sequences": ["\n\nHuman:", "\n\nAssistant:"]
}
```

防止 Claude 模拟用户发言——这是 Anthropic 的默认推荐。

### 结构化输出

```json
{
  "stop_sequences": ["```"],
  "messages": [{"role": "user", "content": "Output JSON: {...}\n"}]
}
```

防止 JSON 后有废话。

## 7. 参数组合最佳实践

```
场景                    temperature   max_tokens   thinking
──────────────────────────────────────────────────────────
事实问答                 0            500          关闭
代码生成                 0            2000         关闭
日常对话                 0.7          1000         关闭
创意写作                 0.9          2000         关闭
数据提取                 0            500          关闭
数学推理                 0            500          budget=800, max=1500
复杂分析                 0.3          1000         budget=1200, max=2500
多步推理 + 工具调用       0            500          budget=1000, max=2000
翻译                     0.3          2000         关闭
```

## 8. 与 OpenAI 参数的差异总结

| 参数 | Anthropic | OpenAI |
|------|-----------|--------|
| `max_tokens` | **必填** | 可选 |
| `temperature` | 0 - 1 | 0 - 2 |
| `top_p` | 0 - 1 | 0 - 1 |
| `top_k` | ✅ 有 | ❌ 无 |
| `stop` | `stop_sequences` (array) | `stop` (string/array) |
| `seed` | ❌ 无 | ✅ 有 |
| `presence_penalty` | ❌ 无 | ✅ 有 |
| `frequency_penalty` | ❌ 无 | ✅ 有 |
| `logprobs` | ❌ 无 | ✅ 有 |
| `logit_bias` | ❌ 无 | ✅ 有 |
| `n` | ❌ 无 | ✅ 有 |
| `response_format` | ❌ 无（用 stop_sequences 实现） | ✅ 有（json_object/json_schema） |
| `thinking` | ✅ Extended Thinking | ❌ 无（o 系列独立模型） |

Anthropic 的设计哲学是"少即是多"——给更少但更关键的参数，减少调参复杂度。

## 9. metadata

```json
{
  "metadata": {
    "user_id": "user-123",
    "session_id": "sess-456"
  }
}
```

不参与推理，仅用于追踪和计费。Anthropic 不会用 metadata 训练模型。

## 10. 模型选择

```json
// 标准模型
{"model": "claude-sonnet-4-20250514"}

// 最新快照（自动解析为最新版本）
{"model": "claude-sonnet-4"}

// 版本锁定
{"model": "claude-sonnet-4-20250514"}
```

推荐锁定到具体版本日期（如 `20250514`）保证生产一致性。
