# Structured Output 示例 - 基于 JSON Schema 的结构化输出

## 概述

本示例演示如何使用 `WithStructuredOutputJSON` 让 Agent 的输出严格遵循预定义的 Go 结构体格式。框架自动从结构体生成 JSON Schema 并传递给模型，确保返回结果可直接反序列化为类型安全的对象，适用于需要可靠数据解析的生产场景。

## 核心概念

### Structured Output

Structured Output（结构化输出）是指约束 LLM 的响应格式，使其严格按照指定的 JSON Schema 返回数据。与普通的 Prompt 约束不同，结构化输出由模型 API 原生支持，能保证：

- **格式一致性**：输出严格匹配 Schema 定义的字段和类型
- **类型安全**：可直接反序列化为 Go 结构体，无需手动解析
- **零幻觉字段**：模型不会添加 Schema 中未定义的字段

### WithStructuredOutputJSON

`llmagent.WithStructuredOutputJSON(sampleStruct, strict, description)` 接受三个参数：

- `sampleStruct`：Go 结构体实例（零值即可），框架自动生成 JSON Schema
- `strict`：是否启用严格模式，严格模式下模型必须精确匹配 Schema
- `description`：Schema 的文字描述，帮助模型理解输出格式

### 事件中的类型化输出

启用结构化输出后，事件流中的 `event.StructuredOutput` 字段会携带已反序列化的类型化对象，可直接进行类型断言使用。

## 代码解析

**1. 定义输出结构体**

```go
type placeRecommendation struct {
    Name       string  `json:"name"`
    Address    string  `json:"address"`
    City       string  `json:"city"`
    Category   string  `json:"category"`
    Rating     float64 `json:"rating"`
    PriceLevel string  `json:"price_level"`
    Notes      string  `json:"notes"`
}
```

标准 Go 结构体，通过 `json` tag 定义字段名。框架会根据字段类型和 tag 自动生成对应的 JSON Schema。

**2. 配置结构化输出**

```go
llmAgent := llmagent.New(
    agentName,
    llmagent.WithModel(modelInstance),
    llmagent.WithInstruction("When asked for a place, return exactly one recommendation."),
    llmagent.WithStructuredOutputJSON(new(placeRecommendation), true, "A single place recommendation."),
)
```

`new(placeRecommendation)` 提供零值结构体用于 Schema 推导，`true` 启用严格模式。

**3. 消费类型化输出**

```go
for ev := range evCh {
    if ev.StructuredOutput != nil {
        if pr, ok := ev.StructuredOutput.(*placeRecommendation); ok {
            b, _ := json.MarshalIndent(pr, "", "  ")
            fmt.Printf("✅ Typed structured output received:\n%s\n", string(b))
        }
    }
    // 同时可以读取原始流式内容
    if len(ev.Choices) > 0 {
        fmt.Print(ev.Choices[0].Delta.Content)
    }
}
```

`StructuredOutput` 字段在最终事件中包含已反序列化的对象。通过类型断言 `(*placeRecommendation)` 获取强类型数据。流式内容和类型化输出可以同时使用。

## 运行方式

**环境准备：**

```bash
export OPENAI_API_KEY="your-api-key"
export OPENAI_BASE_URL="https://api.deepseek.com/v1"  # 可选
```

**运行命令：**

```bash
cd examples/structuredoutput
go run .                          # 默认流式模式
go run . -streaming=false         # 非流式模式
go run . -model gpt-4o            # 指定模型
```

**预期输出：**

```
🚀 Structured Output (JSON Schema)
✅ Ready! Session: so-session-1234567890

👤 You: Recommend a coffee shop in Beijing
✅ Typed structured output received:
{
  "name": "Soloist Coffee Co.",
  "address": "Sanlitun SOHO, Chaoyang District",
  "city": "Beijing",
  "category": "coffee_shop",
  "rating": 4.5,
  "price_level": "moderate",
  "notes": "Known for specialty pour-over coffee..."
}
```

## 总结

结构化输出将 LLM 的自由文本响应转换为可编程的类型安全数据，是构建可靠 AI 应用的关键能力。框架通过 `WithStructuredOutputJSON` 实现了从 Go 结构体到 JSON Schema 的自动映射，大幅降低了集成成本。与 **outputschema** 示例相比，本示例使用 Go 结构体自动生成 Schema，而 `outputschema` 使用手写 `map[string]any` 定义 Schema，两者适用于不同场景。
