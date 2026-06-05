# Function Calling 机制

Function Calling 让 LLM 输出结构化的函数调用请求——客户端执行后发回结果。这不是服务端执行，而是**结构化的回合协议**。

## 1. 协议流程

```
轮次 1: user msg → POST /v1/chat/completions（含 tools 声明）
         ↓
轮次 1 响应: assistant msg, finish_reason="tool_calls", 含 tool_calls 数组
         ↓
客户端执行工具
         ↓
轮次 2: 追加 tool role msg → POST /v1/chat/completions
         ↓
轮次 2 响应: assistant msg, finish_reason="stop", 自然语言回复
```

每次工具调用需要额外一次 HTTP 往返。框架负责管理这些往返循环。

## 2. Tools 声明

```json
{
  "tools": [
    {
      "type": "function",
      "function": {
        "name": "get_weather",
        "description": "Get current weather for a location",
        "strict": true,
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
          "required": ["city"],
          "additionalProperties": false
        }
      }
    }
  ]
}
```

### Function 定义字段

| 字段 | 必填 | 说明 |
|------|------|------|
| `name` | ✅ | 函数名（字母+数字+下划线+连字符，最大 64 字符） |
| `description` | 推荐 | 工具描述——LLM 据此决定是否调用 |
| `strict` | ❌ | `true` 时强制参数符合 JSON Schema 且禁止 additionalProperties |
| `parameters` | ❌ | JSON Schema 对象。无参数函数可省略 |

### description 最佳实践

```
✅ "Get the current weather for a city. Returns temperature, humidity, and conditions."
❌ "Get weather"
✅ "Search the user database by name. Returns id, email, and role. Do not guess names."
❌ "Search users"
```

## 3. tool_choice 控制

| 值 | 含义 | 使用场景 |
|----|------|----------|
| `"auto"` | 默认，模型决定 | 通用 |
| `"none"` | 禁止调用任何工具 | 纯对话 |
| `"required"` | 必须调用至少一个工具 | 强制工具交互 |
| `{"type":"function","function":{"name":"x"}}` | 强制调用指定工具 | 精确控制 |

```json
// 强制使用 get_weather
{"tool_choice": {"type": "function", "function": {"name": "get_weather"}}}

// 允许模型选择但禁止某些工具——不在 tools 数组里声明即可
```

## 4. parallel_tool_calls

```json
{
  "parallel_tool_calls": false
}
```

设为 `false` 禁止模型并行调用多个工具——每次只调用一个。**默认 `true`**。

适用场景：
- 工具之间有依赖关系
- 需要确定性顺序
- Token 预算紧张（并行调用生成更多 token）

## 5. 模型返回 tool_calls

```json
{
  "choices": [{
    "message": {
      "role": "assistant",
      "content": null,
      "tool_calls": [
        {
          "id": "call_abc123def456",
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

### tool_call 字段

| 字段 | 说明 |
|------|------|
| `id` | 全球唯一标识（`call_` 前缀，28 字符） |
| `type` | 恒为 `"function"` |
| `function.name` | 要调用的函数名 |
| `function.arguments` | **JSON 字符串**（不是对象！需手动 `JSON.parse()`） |

### content 状态

- `content: null` — 只有工具调用，无文本
- `content: "Let me check..."` — 可能包含过渡文本（告知用户正在工作）

始终检查 `tool_calls` 是否存在——不依赖 `content` 是否为 null。

## 6. 发回工具结果

```json
{
  "messages": [
    {"role": "user", "content": "What is the weather?"},
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
      "content": "{\"temperature\":22,\"condition\":\"sunny\",\"humidity\":45}"
    }
  ]
}
```

### tool role 消息

| 字段 | 必填 | 说明 |
|------|------|------|
| `role` | ✅ | 必须 `"tool"` |
| `tool_call_id` | ✅ | 对应 target tool_call 的 `id` |
| `content` | ✅ | 字符串（建议 JSON 便于模型解析） |

### 内容长度

工具结果计入 `prompt_tokens`。过长结果会消耗大量 token 甚至超出 context window。

```python
MAX_RESULT_CHARS = 5000

def truncate(result: str) -> str:
    if len(result) > MAX_RESULT_CHARS:
        return result[:MAX_RESULT_CHARS] + "\n...(truncated)"
    return result
```

## 7. 并行 Tool Call 处理

```json
// 一次返回两个 tool call
{
  "tool_calls": [
    {"id": "call_1", "function": {"name": "get_weather", "arguments": "{\"city\":\"Tokyo\"}"}},
    {"id": "call_2", "function": {"name": "get_time", "arguments": "{\"timezone\":\"Asia/Tokyo\"}"}}
  ]
}
```

**规则**：所有结果在**一个请求**中发回——不能分批发：

```json
{
  "messages": [
    ...,
    {"role": "assistant", "content": null, "tool_calls": [call_1, call_2]},
    {"role": "tool", "tool_call_id": "call_1", "content": "22°C"},
    {"role": "tool", "tool_call_id": "call_2", "content": "14:30"}
  ]
}
```

## 8. Strict 模式（strict: true）

```json
{
  "function": {
    "name": "get_weather",
    "strict": true,
    "parameters": {
      "type": "object",
      "properties": {"city": {"type": "string"}},
      "required": ["city"],
      "additionalProperties": false
    }
  }
}
```

### strict 模式约束

**强制要求**：
- `additionalProperties: false`（必须是 `false`，不能是 `true` 或未设置）
- 所有 `properties` 字段的 `required` 必须完整列出
- 所有字段必须在 `required` 中

**不支持**：
- `anyOf` / `oneOf` / `allOf`
- 嵌套深层的 schema
- 递归 schema
- `additionalProperties: true`
- 可选字段

### strict vs non-strict

```
strict=true:  模型保证输出符合 schema。适合生产环境。但 schema 受限。
strict=false: 模型尽力但不保证。适合快速原型或复杂 schema。
```

## 9. 从零实现 Function Calling 循环

```python
import json

def function_calling_loop(
    messages: list,
    tools: list,
    model: str = "gpt-4o",
    max_turns: int = 10,
) -> str:
    """完整 function calling 循环，不依赖任何框架"""

    for turn in range(max_turns):
        response = call_api(
            model=model,
            messages=messages,
            tools=tools,
            tool_choice="auto",
        )
        choice = response["choices"][0]

        # 正常完成
        if choice["finish_reason"] == "stop":
            return choice["message"].get("content", "")

        # 工具调用
        if choice["finish_reason"] == "tool_calls":
            msg = choice["message"]

            # 追加 assistant 消息（含 tool_calls）
            messages.append({
                "role": "assistant",
                "content": msg.get("content"),
                "tool_calls": msg["tool_calls"],
            })

            # 执行工具并追加结果
            for tc in msg["tool_calls"]:
                func_name = tc["function"]["name"]
                args = json.loads(tc["function"]["arguments"])
                result = execute_tool(func_name, args)

                messages.append({
                    "role": "tool",
                    "tool_call_id": tc["id"],
                    "content": json.dumps(result, ensure_ascii=False),
                })

            continue  # 继续循环

        # 安全拒绝
        if choice["finish_reason"] == "content_filter":
            return None

        # 长度截断
        if choice["finish_reason"] == "length":
            return choice["message"].get("content", "")

    raise Exception(f"Exceeded max turns ({max_turns})")
```

## 10. 常见问题

**Q：content 为 null 但有 tool_calls 怎么处理？**

A：这是最常见的模式——模型认为只需要调用工具。追加 `{"role": "assistant", "content": null, "tool_calls": [...]}` 到 messages，然后执行工具。

**Q：工具调用失败如何通知模型？**

A：将错误信息写入 `tool` role 的 `content` 字段——不要用 HTTP 错误码。模型看到错误字符串会尝试修正参数或换工具。

**Q：多个 tool call 之间有依赖怎么办？**

A：设置 `parallel_tool_calls: false` 强制顺序调用。或者在一个函数内部处理依赖关系。

**Q：description 有多重要？**

A：**极其重要**。`description` 是 LLM 决定是否调用工具的唯一信息源。不好的 description = 工具从不被调用或参数传错。
