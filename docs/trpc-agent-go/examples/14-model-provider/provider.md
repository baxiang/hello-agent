# Provider 示例 - 多提供商统一接入与运行时切换

## 概述

本示例演示如何使用 `model/provider` 抽象层在运行时动态切换不同的模型提供商（OpenAI、Anthropic、Ollama、Hunyuan），同时复用相同的 Agent、工具和 Runner 逻辑。适用于需要支持多个 LLM 后端的企业级应用，解决了不同提供商 API 差异带来的集成成本问题。

## 核心概念

### Provider 抽象层

`provider.Model()` 是框架的提供商适配器，根据提供商名称和模型名称在运行时创建对应的模型实例：

```go
modelInstance, _ := provider.Model("openai", "gpt-4o-mini")
modelInstance, _ := provider.Model("anthropic", "claude-3-5-sonnet")
modelInstance, _ := provider.Model("ollama", "llama3")
modelInstance, _ := provider.Model("hunyuan", "hunyuan-pro")
```

所有提供商返回统一的 `model.Model` 接口，上层代码无需感知底层差异。

### Provider Options

通过 `provider.With*` 系列选项统一配置各提供商的参数：

- **WithAPIKey / WithBaseURL**：覆盖环境变量中的凭证配置
- **WithChannelBufferSize**：调整流式响应的通道缓冲大小
- **WithEnableTokenTailoring**：启用 Token 裁剪，自动截断超长输入
- **WithMaxInputTokens**：设置裁剪时的最大输入 Token 数
- **WithHunyuanOption**：传递混元特有的 SecretId/SecretKey

### Function Tool

示例使用 `function.NewFunctionTool()` 从普通 Go 函数自动生成工具定义，框架通过反射解析参数结构体的 JSON tag 和 `description` tag 自动生成工具的 JSON Schema。

## 代码解析

**1. 通过 Provider 创建模型**

```go
modelInstance, _ := provider.Model(
    "openai",
    "deepseek-v4-flash",
    provider.WithAPIKey(apiKey),
    provider.WithBaseURL(baseURL),
    provider.WithChannelBufferSize(512),
    provider.WithEnableTokenTailoring(true),
    provider.WithMaxInputTokens(64000),
)
```

`provider.Model()` 内部根据提供商名称路由到对应的实现（openai、anthropic、ollama、hunyuan），配置选项通过统一接口传入。

**2. 从 Go 函数创建工具**

```go
type calcArgs struct {
    Operation string  `json:"operation" description:"The operation to perform,enum=add,enum=subtract,enum=multiply,enum=divide,enum=power"`
    A         float64 `json:"a" description:"First number"`
    B         float64 `json:"b" description:"Second number"`
}

calculatorTool := function.NewFunctionTool(
    c.calculate,
    function.WithName("calculator"),
    function.WithDescription("Perform mathematical calculations"),
)
```

框架从 `calcArgs` 结构体自动生成 JSON Schema，`description` tag 中的 `enum=` 语法会被解析为枚举约束。

**3. 组装 Agent 并运行**

```go
llmAgent := llmagent.New("provider-agent",
    llmagent.WithModel(modelInstance),
    llmagent.WithTools([]tool.Tool{calculatorTool}),
    llmagent.WithGenerationConfig(genConfig),
)

c.runner = runner.NewRunner("provider-demo", llmAgent)
defer c.runner.Close()
```

Agent、Tool、Runner 的组装方式与使用 `openai.New()` 直接创建模型完全一致，Provider 层对上层透明。

## 运行方式

```bash
# OpenAI 兼容（如 DeepSeek）
export OPENAI_API_KEY="your-key"
cd examples/provider
go run main.go -provider openai -model deepseek-v4-flash

# Anthropic
export ANTHROPIC_AUTH_TOKEN="your-key"
go run main.go -provider anthropic -model claude-3-5-sonnet -stream=false

# Ollama 本地模型
go run main.go -provider ollama -model llama3

# 腾讯混元
go run main.go -provider hunyuan -model hunyuan-pro \
    -secret-id "your-id" -secret-key "your-key"
```

CLI flags 优先级高于环境变量。不同提供商需要设置对应的环境变量或通过 flags 传入凭证。

## 总结

Provider 示例展示了框架的多提供商统一抽象能力：一套 Agent + Tool + Runner 代码，通过命令行参数即可在 OpenAI、Anthropic、Ollama、Hunyuan 间无缝切换。与 Model 示例聚焦于单一提供商的高级策略（重试、故障转移等）不同，Provider 侧重于跨提供商的标准化接入。两者可以组合使用——例如在 Provider 层选择提供商，在 Model 层配置重试和故障转移策略。
