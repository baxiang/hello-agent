# Model 示例 - 模型调用与高级管理策略

## 概述

本示例集合演示 tRPC-Agent-Go 中模型层的完整能力，从基础的流式/非流式调用，到重试、模型切换、故障转移、对冲请求、批量处理等生产级策略。主目录的 `main.go` 展示基本用法，子目录分别对应不同的高级场景。

## 核心概念

### Model 接口

`model.Model` 是框架的模型抽象接口，核心方法 `GenerateContent(ctx, request)` 返回 `<-chan *model.Response` 事件通道，统一处理流式与非流式响应。`openai.New(modelName)` 创建兼容 OpenAI API 的实现。

### GenerationConfig 生成配置

控制模型推理行为的参数结构体：
- `Temperature`：控制输出随机性（0.0 确定性 → 1.2 高创造性）
- `MaxTokens`：限制最大生成 Token 数
- `TopP`：核采样参数
- `Stream`：是否启用流式响应

### 高级模型策略

| 子目录 | 功能 | 核心 API |
|--------|------|----------|
| `retry/` | SDK 级别重试 | `openaiopt.WithMaxRetries()` |
| `switch/` | 运行时模型切换 | `agent.SetModelByName()` / `agent.WithModelName()` |
| `selector/` | 按 LLM 调用阶段选模型 | `agent.WithModelName()` in RunOptions |
| `failover/` | 主备模型故障转移 | 首个非错误 chunk 前自动切换 |
| `hedge/` | 对冲请求 | 延迟触发备选模型并行竞速 |
| `batch/` | 批量 API 调用 | `llm.CreateBatch()` / `llm.ListBatches()` |
| `promptmap/` | 按模型映射 Prompt | `WithModelInstructions()` |

## 代码解析

**1. 基础模型调用（main.go）**

```go
llm := openai.New("gpt-4o-mini")

request := &model.Request{
    Messages: []model.Message{
        model.NewSystemMessage("You are a helpful assistant."),
        model.NewUserMessage("Tell me a short joke."),
    },
    GenerationConfig: model.GenerationConfig{
        Temperature: &temperature,
        MaxTokens:   &maxTokens,
        Stream:      false,
    },
}

responseChan, _ := llm.GenerateContent(ctx, request)
```

SDK 自动读取 `OPENAI_API_KEY` 和 `OPENAI_BASE_URL` 环境变量，无需手动配置客户端。

**2. 模型切换（switch/main.go）**

```go
// 方式一：Agent 级永久切换
agent.SetModelByName("deepseek-v4-pro")

// 方式二：单次请求临时切换
runOpts := []agent.RunOption{agent.WithModelName("deepseek-v4-flash")}
runner.Run(ctx, userID, sessionID, msg, runOpts...)
```

`SetModelByName` 永久改变后续所有请求的模型；`WithModelName` 仅影响当次请求，之后自动恢复默认模型。

**3. 重试配置（retry/main.go）**

```go
llm := openai.New(modelName,
    openai.WithOpenAIOptions(
        openaiopt.WithMaxRetries(3),
        openaiopt.WithRequestTimeout(30 * time.Second),
    ),
)
```

通过 OpenAI SDK 原生选项配置重试策略，自动处理速率限制和瞬时故障。

**4. 按模型映射 Prompt（promptmap/main.go）**

```go
llmagent.WithModelInstructions(map[string]string{
    "gpt-4o-mini": "Start every answer with \"MODEL_A:\".",
    "gpt-4o":      "Start every answer with \"MODEL_B:\".",
})
```

不同模型使用不同的 System Prompt，适用于需要针对模型特性定制指令的场景。

## 运行方式

```bash
export OPENAI_API_KEY="your-key"
export OPENAI_BASE_URL="https://api.openai.com/v1"

# 基础示例
cd examples/model && go run main.go -model gpt-4o-mini

# 重试示例
cd examples/model/retry && go run main.go -retries 3 -timeout 30s

# 模型切换
cd examples/model/switch && go run main.go -model deepseek-v4-flash

# 故障转移
cd examples/model/failover && go run . -primary-model gpt-4o-mini -backup-model deepseek-v4-flash

# 批量处理
cd examples/model/batch && go run . -action create -requests "user: Hello ||| user: World"
```

## 总结

Model 示例集合覆盖了从开发到生产的完整模型管理需求。基础的流式/非流式调用适合快速原型开发；重试和故障转移确保了服务可用性；模型切换和 Selector 支持了 A/B 测试和分阶段模型选择；批量 API 和 Prompt 映射则满足了规模化和精细化运营的需求。这些策略可与 Provider 示例结合，实现跨提供商的统一模型管理。
