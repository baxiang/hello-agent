# Function Calling 机制

Function Calling 是 OpenAI API 最核心的扩展机制——让 LLM 能够"调用"你定义的函数。这不是真正的函数调用，而是一种**结构化的回合协议**。

## 1. 协议流程

```
轮次 1: 用户消息 → API（带 tools 声明）
         ↓
轮次 1 响应: assistant 消息，finish_reason="tool_calls"，包含 function name + arguments
         ↓
轮次 2: 客户端执行函数，结果以 tool role 发回 API
         ↓
轮次 2 响应: assistant 消息，finish_reason="stop"，包含自然语言回复
```

这不是一次 HTTP 请求完成的——它需要**多次 HTTP 往返**。框架（ADK、LangChain 等）负责管理这些往返。

## 2. Tools 声明

```json
{
  "model": "gpt-4o",
  "messages": [{"role": "user", "content": "What is the weather in Tokyo?"}],
  "tools": [
    {
      "type": "function",
      "function": {
        "name": "get_weather",
        "description": "Get the current weather for a city",
        "parameters": {
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
    }
  ],
  "tool_choice": "auto"
}
```

### tool_choice 选项

| 值 | 含义 |
|----|------|
| `"auto"` | 默认，模型决定是否调用工具 |
| `"none"` | 禁止调用工具 |
| `"required"` | 必须调用工具 |
| `{"type": "function", "function": {"name": "my_func"}}` | 强制调用指定工具 |

## 3. 模型返回 tool_calls

```json
{
  "choices": [{
    "index": 0,
    "message": {
      "role": "assistant",
      "content": null,
      "tool_calls": [
        {
          "id": "call_abc123",
          "type": "function",
          "function": {
            "name": "get_weather",
            "arguments": "{\"city\":\"Tokyo\",\"unit\":\"celsius\"}"
          }
        }
      ]
    },
    "finish_reason": "tool_calls"
  }]
}
```

关键点：
- `content` 为 `null`——模型只输出工具调用，不输出文本
- `arguments` 是一个 **JSON 字符串**（不是 JSON 对象），需手动 `JSON.parse()`
- `id` 是全球唯一的 call ID，后续结果必须带上

## 4. 发回工具结果

```json
{
  "model": "gpt-4o",
  "messages": [
    {"role": "user", "content": "What is the weather in Tokyo?"},
    {
      "role": "assistant",
      "content": null,
      "tool_calls": [{
        "id": "call_abc123",
        "type": "function",
        "function": {"name": "get_weather", "arguments": "{\"city\":\"Tokyo\"}"}
      }]
    },
    {
      "role": "tool",
      "tool_call_id": "call_abc123",
      "content": "{\"temperature\": 22, \"condition\": \"sunny\"}"
    }
  ]
}
```

`tool` role 消息的三个必填字段：
- `role`: 必须是 `"tool"`
- `tool_call_id`: 对应之前的 call id
- `content`: 函数执行结果（字符串）

## 5. 模型处理工具结果

```json
{
  "choices": [{
    "message": {
      "role": "assistant",
      "content": "The weather in Tokyo is sunny with a temperature of 22°C."
    },
    "finish_reason": "stop"
  }]
}
```

模型收到工具结果后，生成自然语言回复给用户。

## 6. 并行 Function Calling

一次请求中可以声明多个工具：

```json
{
  "tools": [
    {"type": "function", "function": {"name": "get_weather", ...}},
    {"type": "function", "function": {"name": "get_time", ...}},
    {"type": "function", "function": {"name": "search_web", ...}}
  ]
}
```

模型可能一次返回多个 tool_calls，需**全部执行完后**一起发回：

```json
{
  "choices": [{
    "message": {
      "tool_calls": [
        {"id": "call_1", "function": {"name": "get_weather", "arguments": "{\"city\":\"Tokyo\"}"}},
        {"id": "call_2", "function": {"name": "get_time", "arguments": "{\"timezone\":\"Asia/Tokyo\"}"}}
      ]
    },
    "finish_reason": "tool_calls"
  }]
}
```

客户端需并发执行这两个工具调用，然后**在一个请求中**将所有结果发回：

```json
{
  "messages": [
    ...,
    {"role": "assistant", "tool_calls": [...]},
    {"role": "tool", "tool_call_id": "call_1", "content": "{\"weather\":\"sunny\"}"},
    {"role": "tool", "tool_call_id": "call_2", "content": "{\"time\":\"14:30\"}"}
  ]
}
```

**关键规则**：所有 tool call 结果必须在同一个请求中发回，不能分批发。

## 7. 严格模式（Strict Function Calling）

```json
{
  "function": {
    "name": "get_weather",
    "strict": true,
    "parameters": { ... }
  }
}
```

`strict: true` 模式下：
- 模型保证输出的 arguments 符合 JSON Schema
- 所有字段必须完备（不能有可选字段未指定）
- 不支持 `additionalProperties: true`
- 部分复杂 schema 不支持

## 8. 从零实现 Function Calling 循环

```python
import json

def function_calling_loop(model: str, messages: list, tools: list, api_key: str):
    """不依赖任何框架，从零实现 function calling"""

    while True:
        response = call_api(model, messages, tools, api_key)
        choice = response["choices"][0]

        if choice["finish_reason"] == "stop":
            return choice["message"]["content"]

        if choice["finish_reason"] == "tool_calls":
            # 追加 assistant 消息
            messages.append(choice["message"])

            # 执行所有工具调用
            for tc in choice["message"]["tool_calls"]:
                func_name = tc["function"]["name"]
                args = json.loads(tc["function"]["arguments"])
                result = execute_function(func_name, args)

                # 追加 tool 结果消息
                messages.append({
                    "role": "tool",
                    "tool_call_id": tc["id"],
                    "content": json.dumps(result),
                })
            # 循环继续，带结果再次调用 API
```

这正是 ADK-Go `LLMAgent` 内部循环的精简版——每一次 `GenerateContent()` 调用后检查 `finish_reason`，如果是 `tool_calls` 则执行工具然后再次调用。

## 9. 常见问题

**Q：工具结果太长会怎样？**

A：工具结果计入 prompt_tokens。长结果可能超出 context window。模型可能提前 summary 工具结果而不是全文引用。

**Q：多个 tool call 的执行顺序重要吗？**

A：不重要。模型不能假设 A 在 B 之前执行。有依赖关系的工具应在一个函数内部完成。

**Q：tool_choice="required" 但没有工具怎么办？**

A：API 会返回错误。确保 tools 数组非空。
