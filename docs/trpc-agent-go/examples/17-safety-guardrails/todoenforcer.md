# TodoEnforcer - 强制 Agent 完成所有待办任务

## 概述

TodoEnforcer 示例演示了 tRPC-Agent-Go 框架的任务完成强制执行扩展。该扩展解决了 LLM Agent 在多步骤任务中"偷懒"的问题——模型可能在待办事项未全部完成时就生成最终回复。TodoEnforcer 通过拦截模型的提前结束行为，强制其继续处理未完成的任务项，确保任务链的完整执行。

## 核心概念

### Extension 扩展机制

与插件（Plugin）不同，扩展（Extension）通过 `llmagent.WithExtensions` 直接注入到 Agent 内部，可以深度干预模型的生成循环。TodoEnforcer 实现了 `AfterModel` 钩子，在每次模型输出后检查待办列表状态。

### Todo 工具与状态管理

框架内置了 `tool/todo` 工具，Agent 可通过 `todo_write` 创建和更新待办列表。待办项有三种状态：`pending`（待处理）、`in_progress`（处理中）、`completed`（已完成）。列表状态持久化在 Session State 中。

### 强制执行逻辑

当模型试图在存在未完成待办项时结束回复，TodoEnforcer 会：
1. 阻止最终响应的发出（BLOCKED）
2. 注入提示消息引导模型继续工作
3. 超过重试次数后降级放行（EXHAUSTED）
4. 模型可通过 `todo_declare_blocker` 声明阻塞原因后正常结束

## 代码解析

### 基线对比设计

示例通过 `--enforce` 参数支持对比运行，清晰展示扩展的效果差异：

```go
if c.enforce {
    enforcer := todoenforcer.New(
        todoenforcer.WithMaxRetries(c.maxRetries),
        todoenforcer.WithOnEnforce(c.observeEnforce),
    )
    agentOpts = append(agentOpts, llmagent.WithExtensions(enforcer))
} else {
    agentOpts = append(agentOpts, llmagent.WithTools([]tool.Tool{todo.New()}))
}
```

基线模式下，Agent 仅有 `todo_write` 工具但无强制执行，模型可自由结束。

### 强制执行回调

通过 `WithOnEnforce` 注册观察回调，实时展示拦截过程：

```go
func (c *chat) observeEnforce(evt todoenforcer.EnforceEvent) {
    switch evt.Reason {
    case todoenforcer.ReasonBlocked:
        // 拦截：模型试图结束但仍有未完成项
    case todoenforcer.ReasonExhausted:
        // 重试耗尽：降级放行
    case todoenforcer.ReasonBlockerDeclared:
        // 模型声明了阻塞原因，允许结束
    }
}
```

### Session 状态预填充

示例支持 `--prefill-todos` 模式，通过手动构造历史事件模拟"中途恢复"场景：

```go
items := []todo.Item{
    {Content: "Inspect the Kubernetes pod logs", Status: todo.StatusInProgress},
    {Content: "Identify the root cause", Status: todo.StatusPending},
}
```

预填充同时写入 Session State（供 enforcer 读取）和事件日志（供模型上下文可见），确保演示语义的一致性。

### Agent 指令设计

指令明确要求模型使用 todo_write 工具规划任务：

```go
instruction := "When a user asks you to do anything with more than 2 steps, " +
    "call todo_write to plan first, then work the items one by one. " +
    "Do not produce a final answer while items remain open.\n\n" +
    todo.DefaultToolPrompt
```

## 运行方式

**环境准备**：

```bash
export OPENAI_API_KEY="your-api-key"
```

**运行命令**：

```bash
# 基线模式（无强制执行）
go run ./examples/todoenforcer --enforce=false \
  --seed "Plan and execute a 4-step deployment: write config, run tests, deploy to staging, verify with smoke test."

# 强制执行模式
go run ./examples/todoenforcer --enforce=true \
  --seed "Plan and execute a 4-step deployment: write config, run tests, deploy to staging, verify with smoke test."
```

**预期输出差异**：基线模式下模型可能在部署到 staging 后直接给出总结；强制模式下会看到 `[enforce] BLOCKED` 日志，模型被迫继续处理剩余步骤。

## 总结

TodoEnforcer 通过 Extension 机制实现了对 Agent 行为的强约束，解决了 LLM 在复杂任务中"提前收工"的可靠性问题。其核心价值在于将"任务必须完成"从软性提示词约束升级为硬性运行时强制。该示例与 `guardrail` 示例形成互补：guardrail 约束"不该做的事"，todoenforcer 确保"该做的事做完"。
