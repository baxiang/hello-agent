# Output Schema 示例 - 使用原始 Schema 约束输出格式

## 概述

本示例演示如何通过 `WithOutputSchema` 使用手写的 `map[string]any` 格式定义 JSON Schema，约束 Agent 的输出格式。与 `structuredoutput` 示例通过 Go 结构体自动生成 Schema 不同，本示例展示了直接控制 Schema 定义的方式，适合需要精细控制字段约束（如枚举值、数值范围）的场景。

## 核心概念

### WithOutputSchema vs WithStructuredOutputJSON

两种结构化输出方式的对比：

| 特性 | WithStructuredOutputJSON | WithOutputSchema |
|------|--------------------------|------------------|
| Schema 来源 | Go 结构体自动生成 | 手写 `map[string]any` |
| 类型安全 | 编译时检查 + 自动反序列化 | 需手动解析 JSON |
| 字段约束 | 依赖 jsonschema tag | 完全自定义（enum、范围等） |
| 适用场景 | Schema 与代码强绑定 | Schema 动态定义或需精细控制 |

### 手写 Schema 的优势

手写 Schema 允许使用 JSON Schema 规范的全部特性：

- **枚举约束**：`"enum": []string{"sunny", "cloudy", "rainy"}` 限制字段取值范围
- **数组类型**：`"type": "array", "items": map[string]any{"type": "string"}` 定义列表字段
- **必选字段**：`"required": []string{"city", "temperature"}` 明确哪些字段不可缺省

## 代码解析

**1. 定义 Weather Schema**

```go
weatherSchema := map[string]any{
    "type": "object",
    "properties": map[string]any{
        "city": map[string]any{
            "type": "string", "description": "The city name",
        },
        "temperature": map[string]any{
            "type": "number", "description": "Temperature in Celsius",
        },
        "condition": map[string]any{
            "type": "string",
            "description": "Weather condition",
            "enum": []string{"sunny", "cloudy", "rainy", "snowy", "foggy", "windy"},
        },
        "recommendations": map[string]any{
            "type": "array",
            "description": "List of recommendations based on weather",
            "items": map[string]any{"type": "string"},
        },
    },
    "required": []string{"city", "temperature", "condition", "description"},
}
```

Schema 定义了天气信息的完整结构：城市、温度、天气状况（枚举约束）、湿度、风速、描述和建议列表。`required` 字段确保关键信息不会缺失。

**2. 创建带 OutputSchema 的 Agent**

```go
weatherAgent := llmagent.New(
    "weather-agent",
    llmagent.WithInstruction("You are a weather information specialist..."),
    llmagent.WithOutputSchema(weatherSchema),
)
```

`WithOutputSchema` 接受 `map[string]any` 类型的 Schema 定义，框架将其序列化后传递给模型 API 的 `response_format` 参数。

**3. 处理流式 JSON 输出**

```go
for event := range eventChan {
    if len(event.Response.Choices) > 0 {
        choice := event.Response.Choices[0]
        if choice.Delta.Content != "" {
            fmt.Print(choice.Delta.Content)
        }
    }
}
```

即使在流式模式下，模型的输出也会严格遵循 Schema 格式。流式输出的每个 chunk 是 JSON 文本的一部分，最终拼接后形成完整的合法 JSON。

## 运行方式

**环境准备：**

```bash
export OPENAI_API_KEY="your-api-key"
export OPENAI_BASE_URL="https://api.deepseek.com/v1"  # 可选
```

**运行命令：**

```bash
cd examples/outputschema
go run . -model deepseek-v4-flash
```

**预期输出：**

```
📋 Output Schema Demo
✅ Output Schema Agent ready!
📋 Schema: Structured weather data with validation

👤 You: What's the weather like in Beijing today?
🌤️  Weather Agent: {
  "city": "Beijing",
  "temperature": 28,
  "condition": "sunny",
  "humidity": 45,
  "wind_speed": 12,
  "description": "Clear skies with moderate temperatures...",
  "recommendations": [
    "Great day for outdoor activities",
    "Stay hydrated and use sunscreen"
  ]
}
```

## 总结

`WithOutputSchema` 提供了对输出 Schema 的完全控制能力，适合 Schema 需要动态构建或包含复杂约束（枚举、嵌套数组等）的场景。对于 Schema 与代码强绑定的场景，建议优先使用 **structuredoutput** 示例中的 `WithStructuredOutputJSON`，它提供编译时类型检查和自动反序列化。两种方式都通过模型 API 原生的 `response_format` 保证输出格式的可靠性。
