# 时间感知 - 让Agent具备当前时间意识

## 概述

默认情况下，LLM 模型不知道当前的日期和时间。`timeaware` 示例演示了如何通过 `WithAddCurrentTime` 选项让 Agent 自动在系统提示中注入当前时间信息，使模型能够正确回答与时间相关的问题。

## 核心概念

**时间感知**（Time Awareness）是 LLMAgent 的一个内置功能，通过以下配置选项控制：

- `WithAddCurrentTime(true)` - 启用时间注入，将当前时间追加到系统提示中
- `WithTimezone("UTC")` - 设置时区，如 UTC、EST、PST 等
- `WithTimeFormat("2006-01-02 15:04:05 UTC")` - 自定义时间格式（Go time 格式）

启用后，每次模型调用前，框架会自动在系统消息中附加类似 `Current time: 2025-06-17 10:30:00 UTC` 的信息。

## 代码解析

核心配置非常简洁：

```go
llmAgent := llmagent.New(
    agentName,
    llmagent.WithModel(modelInstance),
    llmagent.WithInstruction("Be helpful and conversational. "+
        "You have access to current time information."),
    llmagent.WithGenerationConfig(genConfig),
    llmagent.WithAddCurrentTime(c.addTime),
    llmagent.WithTimezone(c.timezone),
    llmagent.WithTimeFormat(c.timeFormat),
)
```

示例实现了一个完整的多轮交互式聊天，支持流式和非流式两种模式。`extractContent` 方法根据 streaming 标志选择从 `Delta.Content` 或 `Message.Content` 获取内容。

## 运行方式

```bash
cd examples

export OPENAI_API_KEY="your-key"

# 默认 UTC 时区
go run ./timeaware -model=deepseek-v4-flash

# 指定时区和格式
go run ./timeaware -timezone=CST -time-format="2006年01月02日 15:04"

# 禁用时间注入对比效果
go run ./timeaware -add-time=false
```

启动后可以输入"今天星期几？"、"现在几点？"等问题验证效果。

## 总结

时间感知是一个简单但实用的特性，只需一行配置即可让 Agent 具备时间概念。对于日程安排、提醒、时效性查询等场景必不可少。此功能可与 `summary` 示例中的时间阈值触发总结机制配合使用。
