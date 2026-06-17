# Prompt 管理示例 - 动态指令加载与上下文注入

## 概述

本示例包含两个子示例，展示了 tRPC-Agent-Go 框架中 Prompt 管理的两种核心模式：**从外部服务（Langfuse）动态加载 Prompt** 和 **通过 LateContextMessages 注入每次运行的临时上下文**。这两种模式分别解决了 Prompt 版本管理和运行时规则注入的实际需求。

## 核心概念

### Langfuse Prompt Source

`prompt.Source` 是框架定义的 Prompt 来源接口，`promptlangfuse` 包提供了与 Langfuse 平台集成的实现。通过 `FetchPrompt()` 获取远程模板，再通过 `text.Render()` 填充变量，最后调用 `agent.SetInstruction()` 动态更新 Agent 指令。关键特性包括：

- **模板变量渲染**：支持 `{{criticlevel}}`、`{{movie}}` 等变量占位符
- **本地缓存**：通过 `WithCacheTTL` 控制缓存过期时间，减少网络调用
- **版本与标签**：支持按 `label`（如 production）筛选特定版本的 Prompt

### LateContextMessages

`agent.WithLateContextMessages()` 是一个 `RunOption`，允许在每次 `runner.Run()` 调用时注入临时上下文消息。这些消息会被插入到最新用户消息之前，但**不会持久化到会话历史中**。适用于：

- 注入当前请求相关的规则约束
- 传递仅本次运行需要的文件路径、目标上下文等信息
- 实现 "rules" 模式：根据不同条件动态选择不同的行为规则

## 代码解析

### Langfuse Prompt 子示例

**1. 创建 Langfuse Prompt Source**

```go
client := promptlangfuse.NewClient(cfg)
c.source = client.TextPromptSourceWithOptions(
    c.promptName,
    []promptlangfuse.FetchOption{promptlangfuse.WithLabel(c.promptLabel)},
    promptlangfuse.WithCacheTTL(c.cacheTTL),
)
```

基于 Langfuse 配置创建 Prompt 客户端，指定 Prompt 名称、标签和缓存 TTL。

**2. 获取并渲染模板**

```go
text, err := c.source.FetchPrompt(ctx)
rendered, err := text.Render(prompt.RenderEnv{
    Vars: prompt.Vars{"criticlevel": c.criticLevel, "movie": movie},
})
```

从 Langfuse 拉取模板文本，将 `{{criticlevel}}` 和 `{{movie}}` 替换为实际值。

**3. 动态更新 Agent 指令**

```go
c.agent.SetInstruction(rendered)
```

在每次运行前调用 `SetInstruction` 动态更新系统指令，无需重建 Agent。

### LateContextMessages 子示例

**1. 构造临时规则消息**

```go
ruleMsgRun1 := model.NewUserMessage(fmt.Sprintf(
    "Rules for target %q (run=1):\n%s", target, selectedRules,
))
```

根据目标文件类型（`.go`、`.md` 等）选择对应的规则文本，封装为用户消息。

**2. 通过 WithLateContextMessages 注入**

```go
r.Run(ctx, userID, sessionID, msg,
    agent.WithMessages(seedHistory),
    agent.WithLateContextMessages([]model.Message{ruleMsgRun1}),
)
```

`WithLateContextMessages` 将规则消息插入到用户消息之前。第二轮对话中，第一轮的 late context 不会出现在历史中，验证了非持久化特性。

**3. BeforeModel 回调观察请求**

```go
modelCallbacks.RegisterBeforeModel(func(ctx context.Context, args *model.BeforeModelArgs) (*model.BeforeModelResult, error) {
    printRequest(label, args.Request)
    return nil, nil
})
```

通过 `model.Callbacks` 的 `BeforeModel` 钩子打印最终的 `request.Messages`，直观展示 late context 的注入位置。

## 运行方式

**环境准备（Langfuse 子示例）：**

```bash
export LANGFUSE_PUBLIC_KEY="your-public-key"
export LANGFUSE_SECRET_KEY="your-secret-key"
export LANGFUSE_BASE_URL="https://cloud.langfuse.com"
export OPENAI_API_KEY="your-api-key"
```

**运行命令：**

```bash
# Langfuse Prompt 示例
cd examples/prompt/langfuse
go run . -movie "Inception" -critic-level expert

# LateContextMessages 示例（debug 模式，无需 API Key）
cd examples/prompt/late_context_messages
go run .

# LateContextMessages 示例（OpenAI 模式）
go run . -mode openai -model gpt-4o-mini
```

**预期输出（LateContextMessages debug 模式）：**

```
Turn 1: WithLateContextMessages(...) (run=1)
=== turn1 (late context run=1) ===
00 system    System: You are a helpful assistant.
01 system    Follow the user request and be concise.
02 user      history: hello
03 assistant history: hi
04 user      Rules for target "main.go" (run=1)...
05 user      Summarize the change in one sentence.
🤖 Assistant: OK

Turn 2: WithLateContextMessages(...) again (run=2)
=== turn2 (late context run=2) ===
...
04 user      Rules for target "main.go" (run=2)...  ← run=1 已消失
05 user      Now answer again, same question.
🤖 Assistant: OK
```

## 总结

本示例展示了 Prompt 管理的两种关键模式：Langfuse 集成实现了 **Prompt 的版本化管理和动态加载**，适合需要 A/B 测试或运维人员独立管理 Prompt 的场景；`WithLateContextMessages` 实现了 **每次运行的临时上下文注入**，适合需要根据请求条件动态调整行为的场景。两者可以组合使用，构建灵活的 Prompt 管理体系。可继续学习 **placeholder** 示例了解基于会话状态的变量替换机制。
