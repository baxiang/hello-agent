# Tool Use 机制

Anthropic 的 Tool Use 使用 content block 模型——`tool_use` 和 `tool_result` 是一等公民的 block 类型，而非嵌套在 message 中的 JSON。

## 1. 协议流程

```
请求 → Claude 返回 tool_use block（stop_reason: "tool_use"）
     → 客户端执行工具
     → 客户端发回 tool_result block（role: "user"）
     → Claude 返回 text block（stop_reason: "end_turn"）
```

与 OpenAI 的 function calling 流程类似，但工具结果以 `user` role 发回（不是专用的 `tool` role）。

## 2. Tools 声明

```json
{
  "model": "claude-sonnet-4-20250514",
  "max_tokens": 1000,
  "tools": [
    {
      "name": "get_weather",
      "description": "Get the current weather for a city",
      "input_schema": {
        "type": "object",
        "properties": {
          "city": {
            "type": "string",
            "description": "City name, e.g. Tokyo"
          },
          "unit": {
            "type": "string",
            "enum": ["celsius", "fahrenheit"],
            "description": "Temperature unit"
          }
        },
        "required": ["city"]
      }
    }
  ]
}
```

### tool_choice 选项

```json
// 自动决定
{"tool_choice": {"type": "auto"}}

// 允许使用任何工具
{"tool_choice": {"type": "any"}}

// 强制使用指定工具
{"tool_choice": {"type": "tool", "name": "get_weather"}}

// 禁止使用工具
// 不传 tools 数组即可（相当于 tool_choice: none）
```

与 OpenAI 对比：
- Anthropic 用 `tool_choice.type` 而非顶层字符串
- Anthropic 的 `any` 等同 OpenAI 的 `required`
- Anthropic 没有 `"none"`——不传 tools 就是不用

## 3. tool_use Block

Claude 返回的 tool_use 是一个 content block：

```json
{
  "id": "msg_01Axxx",
  "role": "assistant",
  "content": [
    {
      "type": "text",
      "text": "Let me check the weather for you."
    },
    {
      "type": "tool_use",
      "id": "toolu_01Xxx",
      "name": "get_weather",
      "input": {"city": "Tokyo", "unit": "celsius"}
    }
  ],
  "stop_reason": "tool_use"
}
```

关键点：
- `input` 是**已解析的 JSON 对象**（不是 JSON 字符串）
- 一个响应可以包含 text + tool_use 混合 blocks
- `stop_reason = "tool_use"`

## 4. tool_result Block

客户端执行工具后，结果以 `tool_result` block 发回：

```json
{
  "role": "user",
  "content": [
    {
      "type": "tool_result",
      "tool_use_id": "toolu_01Xxx",
      "content": "The weather in Tokyo is sunny with a temperature of 22°C.",
      "is_error": false
    }
  ]
}
```

### 完整对话序列

```json
{
  "messages": [
    {"role": "user", "content": "What is the weather in Tokyo?"},
    {
      "role": "assistant",
      "content": [
        {"type": "text", "text": "Let me check."},
        {"type": "tool_use", "id": "toolu_01", "name": "get_weather", "input": {"city": "Tokyo"}}
      ]
    },
    {
      "role": "user",
      "content": [
        {"type": "tool_result", "tool_use_id": "toolu_01", "content": "Sunny, 22°C"}
      ]
    }
  ]
}
```

### 对比 OpenAI

| 维度 | OpenAI | Anthropic |
|------|--------|-----------|
| 工具请求 | `choices[0].message.tool_calls` | `content[]` 中的 `tool_use` block |
| 参数格式 | JSON 字符串 | 已解析的 JSON 对象 |
| 工具结果 role | `role: "tool"` | `role: "user"` + `tool_result` block |
| 结果格式 | `content` (string) | `content` (string 或 block 数组) |
| 结果 ID | `tool_call_id` | `tool_use_id` |
| 错误标记 | 无专用字段 | `is_error: true` |

## 5. 并行 Tool Use

Claude 可以同时请求多个工具调用：

```json
{
  "content": [
    {
      "type": "tool_use",
      "id": "toolu_01",
      "name": "get_weather",
      "input": {"city": "Tokyo"}
    },
    {
      "type": "tool_use",
      "id": "toolu_02",
      "name": "get_time",
      "input": {"timezone": "Asia/Tokyo"}
    }
  ],
  "stop_reason": "tool_use"
}
```

客户端应**并发执行**，然后在一个请求中发回所有结果：

```json
{
  "role": "user",
  "content": [
    {"type": "tool_result", "tool_use_id": "toolu_01", "content": "Sunny, 22°C"},
    {"type": "tool_result", "tool_use_id": "toolu_02", "content": "14:30 JST"}
  ]
}
```

## 6. 工具错误处理

```json
{
  "type": "tool_result",
  "tool_use_id": "toolu_01",
  "content": "Error: API rate limit exceeded. Please retry in 30 seconds.",
  "is_error": true
}
```

`is_error: true` 告诉 Claude 工具执行失败。Claude 会尝试不同的参数或使用其他工具。

## 7. 工具调用 + 扩展思考

Tool use 可以和 Extended Thinking 一起使用：

```json
{
  "thinking": {"type": "enabled", "budget_tokens": 2000},
  "tools": [{"name": "get_weather", ...}]
}
```

Claude 在思考后再决定是否调用工具。思考内容可通过 `thinking` block 访问。

## 8. 从零实现 Tool Use 循环

```python
import json

def tool_use_loop(messages: list, tools: list, api_key: str):
    """不依赖任何 SDK 的 Tool Use 循环"""

    while True:
        response = call_anthropic_api(messages, tools, api_key)

        if response["stop_reason"] == "end_turn":
            return extract_text(response)

        if response["stop_reason"] == "tool_use":
            # 追加 assistant 消息（含 tool_use blocks）
            messages.append({
                "role": "assistant",
                "content": response["content"],
            })

            # 收集所有 tool_use blocks
            tool_results = []
            for block in response["content"]:
                if block["type"] == "tool_use":
                    result = execute_tool(block["name"], block["input"])
                    tool_results.append({
                        "type": "tool_result",
                        "tool_use_id": block["id"],
                        "content": str(result),
                    })

            # 发回所有结果
            messages.append({
                "role": "user",
                "content": tool_results,
            })
```

## 9. Server Tool Use（MCP 风格的客户端工具）

```json
{
  "tools": [
    {
      "name": "search_knowledge_base",
      "description": "Search internal knowledge base",
      "input_schema": {
        "type": "object",
        "properties": {
          "query": {"type": "string"}
        },
        "required": ["query"]
      }
    }
  ]
}
```

Anthropic 的 Tool Use 本身不区分"客户端工具"和"服务端工具"——都是 `tools` 数组中的定义。这与 OpenAI 的 function calling 相同。MCP 是在这之上的一层标准化协议。
