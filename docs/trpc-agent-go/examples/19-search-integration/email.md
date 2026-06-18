# Email 邮件发送 - 为 Agent 集成邮件发送能力

## 概述

Email 示例演示了如何使用 tRPC-Agent-Go 内置的 `tool/email` 工具集为 Agent 提供邮件发送能力。Agent 通过自然语言理解用户的发送需求，自动提取收件人、主题、正文等信息并调用邮件工具完成发送。适用于构建智能邮件助手、自动化通知系统等场景。

## 核心概念

### ToolSet 工具集

Email 使用 `tool.ToolSet` 接口，通过 `email.NewToolSet()` 创建。与单个 Tool 不同，ToolSet 可包含多个关联工具（如发送邮件、读取邮件等），通过 `llmagent.WithToolSets` 注册到 Agent。

### 交互式凭证获取

Agent 指令设计为主动向用户索取邮件账户凭证，而非从环境变量读取。这种设计展示了 Agent 如何通过对话收集必要信息：

```go
llmagent.WithInstruction(
    "Use the email tool to send emails. Ask user to provide account credentials. " +
    "If sending failed, error message contain web link, please tell the link to user",
),
```

## 代码解析

### 工具集创建与注册

```go
emailTool, err := email.NewToolSet()
if err != nil {
    return fmt.Errorf("create file tool set: %w", err)
}

llmAgent := llmagent.New(agentName,
    llmagent.WithToolSets([]tool.ToolSet{emailTool}),
)
```

`NewToolSet()` 无需参数，邮件服务器配置通过工具调用时的参数动态传入。

### 非流式响应处理

示例同时支持流式和非流式模式，通过 `streaming` 字段切换：

```go
var content string
if c.streaming {
    content = choice.Delta.Content    // 流式：增量内容
} else {
    content = choice.Message.Content  // 非流式：完整内容
}
```

### 事件处理流程

完整的工具调用可视化：

```go
// 检测邮件发送工具调用
if len(event.Response.Choices[0].Message.ToolCalls) > 0 {
    fmt.Printf("email initiated:\n")
    for _, toolCall := range event.Response.Choices[0].Message.ToolCalls {
        fmt.Printf("   • %s (ID: %s)\n", toolCall.Function.Name, toolCall.ID)
    }
}

// 显示发送结果
for _, choice := range event.Response.Choices {
    if choice.Message.Role == model.RoleTool {
        fmt.Printf("send email results: %s\n", choice.Message.Content)
    }
}
```

### 错误处理指导

Agent 指令包含错误处理策略——当发送失败且错误信息中包含 Web 链接时，将链接展示给用户。这在实际使用中很常见（如 Gmail 需要开启"应用专用密码"）。

## 运行方式

**环境准备**：

```bash
export OPENAI_API_KEY="your-api-key"
```

邮件发送所需的 SMTP 凭证通过对话交互提供，无需预设环境变量。

**运行命令**：

```bash
cd examples/email
go run main.go --model deepseek-v4-flash
```

**交互示例**：

```
👤 You: send an email to test@example.com user:myemail@gmail.com password:mypassword subject:Hello content:This is a test
🔍 email initiated:
   • send_email (ID: call_xxx)
🔄 send email...
✅ send email results: Email sent successfully
🤖 Assistant: The email has been sent successfully to test@example.com.
```

## 总结

Email 示例展示了框架内置工具集的使用方式，以及 Agent 通过对话式交互收集参数的设计模式。在生产环境中，建议将邮件凭证存储在安全的密钥管理服务中，而非通过对话传输。该示例与搜索工具示例（DuckDuckGo、Google）共同展示了框架丰富的内置工具生态。
