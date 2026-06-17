# Todo工具 - Agent自主规划和追踪多步骤任务

## 概述

`todo` 示例演示了内置的 `todo_write` 工具，它让 Agent 能够自主创建任务清单、逐步执行并更新状态。当用户提出多步骤任务时，Agent 会先规划清单，然后逐项完成，这种模式在复杂任务执行中提供了清晰的进度可见性。

## 核心概念

**Todo 工具** 是框架内置的状态管理工具，数据存储在 Session State 中。核心概念：

- `todo.Item` - 清单项，包含 `Content`（内容）和 `Status`（状态：pending/in_progress/completed）
- `todo.Output` - 工具输出，包含 `Todos`（新清单）和 `OldTodos`（变更前清单）
- `todo.GetTodos(session, branch)` - 从 Session 读取当前清单
- `todo.DefaultToolPrompt` - 预置的指令模板，指导模型正确使用 todo 工具

可选配置：
- `WithClearOnAllDone(false)` - 全部完成后是否清除清单（默认清除）
- `WithNudgeHook` - 自定义提醒钩子，在特定条件下向模型发送额外指令

## 代码解析

**创建 Todo 工具并配置提醒钩子：**

```go
todoTool := todo.New(
    todo.WithClearOnAllDone(false),
    todo.WithNudgeHook(func(_ context.Context, _, newList []todo.Item) string {
        if len(newList) < 3 {
            return ""
        }
        allDone := true
        for _, it := range newList {
            if it.Status != todo.StatusCompleted {
                allDone = false
                break
            }
        }
        if !allDone {
            return ""
        }
        return "Reminder: all tasks are completed. " +
            "Before finishing, briefly summarise the outcome."
    }),
)
```

**Agent 指令中包含 Todo 使用说明：**

```go
instruction := "You are a careful assistant. When a user asks you to do " +
    "anything with more than 2 steps, call the todo_write tool to plan " +
    "first, then work the items one by one.\n\n" +
    todo.DefaultToolPrompt
```

**两种消费模式：**
1. **流内结构化** - 从工具结果事件中直接解码 `todo.Output`，适合实时前端展示
2. **端到端规范化** - 调用 `todo.GetTodos(session, branch)` 获取最终状态，适合 REST API

## 运行方式

```bash
cd examples

export OPENAI_API_KEY="your-key"

go run ./todo -model=deepseek-chat

# 带初始消息自动启动
go run ./todo -seed="帮我写一篇博客：包括选题、大纲、正文和检查"
```

交互时 `/list` 可随时查看当前清单状态。尝试提出多步骤任务，如"帮我准备一个技术分享：确定主题、准备大纲、写幻灯片要点"。

预期输出会显示 Agent 先创建清单，然后逐项将状态从 `pending` → `in_progress` → `completed` 更新。

## 总结

Todo 工具为 Agent 提供了结构化的任务管理能力，使复杂任务的执行过程对用户透明可控。NudgeHook 机制允许在不修改工具核心的前提下注入业务策略。此工具与 `react` 规划器的区别在于：ReAct 是推理级别的规划，Todo 是任务级别的跟踪管理，两者可以结合使用。
