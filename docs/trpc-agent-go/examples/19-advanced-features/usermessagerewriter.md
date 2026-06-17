# 用户消息重写 - 在持久化前改写用户输入

## 概述

`usermessagerewriter` 示例演示了如何在 Runner 将用户消息持久化到 Session 之前对其进行重写。这使得应用可以透明地对用户输入进行标准化、扩展或转换，而模型看到的是重写后的消息。

## 核心概念

**用户消息重写器**（UserMessageRewriter）是 Runner 提供的一个钩子，通过 `agent.WithUserMessageRewriter` 在运行时注入。重写器接收原始用户消息，返回一组新的消息：

- 可以是一条改写后的消息（1:1 替换）
- 也可以是多条消息（1:N 扩展），例如添加上下文指令后再附加原始问题

重写发生在消息持久化 **之前**，因此 Session 中存储的是重写后的版本。

## 代码解析

**重写器实现（rewriter.go）：**

```go
func (c *rewriterChat) rewriteMessages(userInput string) []model.Message {
    lowerInput := strings.ToLower(userInput)
    if strings.HasPrefix(lowerInput, "rewrite") {
        content := strings.TrimSpace(userInput[len("rewrite"):])
        return []model.Message{
            model.NewUserMessage("Please rewrite the following request into one concise sentence: " + content),
        }
    }
    if strings.HasPrefix(lowerInput, "expand") {
        content := strings.TrimSpace(userInput[len("expand"):])
        return []model.Message{
            model.NewUserMessage("Reference context: Treat the following request as urgent."),
            model.NewUserMessage(content),
        }
    }
    return []model.Message{model.NewUserMessage(userInput)}
}
```

**在 Runner 运行时注入重写器：**

```go
eventChan, err := c.runner.Run(
    ctx, c.userID, c.sessionID, message,
    agent.WithUserMessageRewriter(c.rewriteUserMessage),
)
```

示例提供了两种重写模式：
- `rewrite <内容>` - 将内容改写为简洁的支持风格句子
- `expand <内容>` - 扩展为两条消息：上下文指令 + 原始内容

通过 `/dump` 命令可以查看 Session 中持久化的实际消息，验证重写效果。

## 运行方式

```bash
cd examples

export OPENAI_API_KEY="your-key"

go run ./usermessagerewriter -model=deepseek-v4-flash
```

交互示例：
- 直接输入 "hello" → 不重写
- 输入 "rewrite 我的订单到不了怎么办" → 改写为简洁工单
- 输入 "expand 订单延迟了" → 扩展为紧急处理请求
- 输入 `/dump` → 查看 Session 中的实际消息记录

## 总结

用户消息重写是实现输入标准化、上下文注入和请求预处理的强大机制。适用于客服系统中的工单格式化、多语言翻译预处理、敏感信息脱敏等场景。由于重写发生在持久化前，整个对话历史保持一致性。此功能与 `plugin` 示例中的 `BeforeModel` 拦截互补——重写器改变消息内容，插件则可以控制模型调用行为。
