# Token裁剪 - 智能管理输入Token以适配模型上下文窗口

## 概述

不同模型有不同的上下文窗口限制。`tailor` 示例演示了 Token 裁剪（Token Tailoring）功能，当输入消息总量超过模型的最大输入 Token 限制时，自动按策略裁剪历史消息，确保请求始终在模型的处理范围内。

## 核心概念

Token 裁剪是 **模型层** 的功能，在请求发送前自动生效。核心组件包括：

- **Token Counter**：计算消息的 Token 数量，支持 `simple`（按字符估算）和 `tiktoken`（精确计算）两种实现
- **裁剪策略**（TailoringStrategy）：
  - `MiddleOutStrategy` - 保留首尾消息，移除中间部分（默认）
  - `HeadOutStrategy` - 保留尾部消息，移除头部
  - `TailOutStrategy` - 保留头部消息，移除尾部

配置通过 `provider.Model` 统一入口实现，支持 OpenAI、Anthropic、Ollama 三种提供商。

## 代码解析

**构建模型和裁剪配置：**

```go
func buildModel(providerName, modelName string) (model.Model, error) {
    counter := buildCounter(strings.ToLower(*flagCounter), modelName)
    strategy := buildStrategy(counter, strings.ToLower(*flagStrategy))

    var opts []provider.Option
    opts = append(opts, provider.WithEnableTokenTailoring(*flagEnableTokenTailoring))
    if *flagMaxInputTokens > 0 {
        opts = append(opts, provider.WithMaxInputTokens(*flagMaxInputTokens))
    }
    opts = append(opts, provider.WithTokenCounter(counter))
    opts = append(opts, provider.WithTailoringStrategy(strategy))
    return provider.Model(providerName, modelName, opts...)
}
```

示例通过各提供商的 `ChatRequestCallback` 展示裁剪前后的统计信息，包括裁剪后的消息数量、Token 总数，以及 head+tail 消息预览。

**`/bulk N` 命令** 可快速添加大量合成消息来触发裁剪，直观观察不同策略的效果。

## 运行方式

```bash
cd examples/tailor

# OpenAI 提供商
go run . -provider=openai -model=deepseek-v4-flash -max-input-tokens=500

# Anthropic 提供商
go run . -provider=anthropic -model=claude-3-5-sonnet

# 使用 tiktoken 精确计算
go run . -counter=tiktoken -strategy=middle

# 使用 head 裁剪策略
go run . -strategy=head -max-input-tokens=300
```

启动后使用 `/bulk 50` 添加50条消息，然后发送普通消息触发裁剪。

## 总结

Token 裁剪保证了无论对话多长，请求都不会超出模型限制。三种策略适用于不同场景：`middle` 保留完整的上下文开端和最新对话；`head` 适合只关注最新上下文的场景；`tail` 适合需要保留初始指令的场景。此功能与 `summary` 的会话总结和 `context_compaction` 的工具结果压缩共同构成完整的上下文管理体系。
