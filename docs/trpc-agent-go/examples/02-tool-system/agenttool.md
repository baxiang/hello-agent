# Agent 工具 - 将 Agent 封装为可调用工具

## 概述

`agenttool` 示例演示如何使用 `agenttool.NewTool` 将一个专业化 Agent 封装为工具，供另一个 Agent 调用。这种模式实现了多 Agent 的层级委派：主 Agent 将特定领域的任务委派给专家 Agent，获取结果后再整合回复用户。

## 核心概念

**Agent Tool** 是一种特殊的工具类型，它将一个完整的 Agent（包含模型、指令、工具等）包装为一个可被其他 Agent 调用的工具。与普通函数工具不同，Agent Tool 内部会启动一个完整的 Agent 运行循环，包括多轮 LLM 调用和子工具调用。

关键配置项：
- **SkipSummarization**：跳过外层 Agent 的总结步骤，直接将子 Agent 结果返回
- **StreamInner**：是否将子 Agent 的内部事件流转发给调用者
- **InnerTextMode**：控制子 Agent 文本是否可见（include/exclude）
- **ResponseMode**：控制工具结果的生成方式（default 合并所有回复 / final-only 仅最后回复）

## 代码解析

### 创建专家 Agent

首先创建一个专门处理数学计算的子 Agent，它拥有自己的计算器工具：

```go
mathAgent := llmagent.New(
    "math-specialist",
    llmagent.WithModel(modelInstance),
    llmagent.WithInstruction("You are a math specialist..."),
    llmagent.WithTools([]tool.Tool{calculatorTool}),
    llmagent.WithInputSchema(map[string]any{
        "type": "object",
        "properties": map[string]any{
            "request": map[string]any{
                "type":        "string",
                "description": "The mathematical problem or question to solve",
            },
        },
        "required": []any{"request"},
    }),
)
```

`WithInputSchema` 定义了外部调用此 Agent 时需要传入的参数格式。

### 封装为工具

使用 `agenttool.NewTool` 将子 Agent 封装：

```go
agentTool := agenttool.NewTool(mathAgent,
    agenttool.WithSkipSummarization(true),
    agenttool.WithStreamInner(true),
    agenttool.WithInnerTextMode(agenttool.InnerTextModeInclude),
    agenttool.WithResponseMode(agenttool.ResponseModeDefault),
)
```

### 注册到主 Agent

将 Agent Tool 与普通工具一起注册到主 Agent：

```go
llmAgent := llmagent.New("chat-assistant",
    llmagent.WithTools([]tool.Tool{timeTool, agentTool}),
    llmagent.WithInstruction("For any math calculations, always use the math-specialist agent tool."),
)
```

### 层级结构

```
Chat Assistant (主 Agent)
├── Time Tool (函数工具)
└── Math Specialist Agent Tool (Agent 工具)
    └── Math Specialist Agent (子 Agent)
        └── Calculator Tool (函数工具)
```

### 持久化子 Agent 历史

通过 `WithPersistentHistory()` 可以让子 Agent 在多次调用之间保留对话历史：

```go
agenttool.WithPersistentHistory()
// 或自定义 key
agenttool.WithPersistentHistoryKey("agenttool:math-specialist:task-1")
```

## 运行方式

```bash
cd examples/agenttool
export OPENAI_API_KEY="your-key"

# 基本模式
go run .

# 显示子 Agent 进度但隐藏文本
go run . -show-inner=true -inner-text=exclude -show-tool=true

# 仅返回子 Agent 最终回答
go run . -response-mode=final-only -show-tool=true
```

## 总结

- Agent Tool 实现了"Agent 即工具"的设计哲学，支持多层级的 Agent 编排
- 通过 `InnerTextMode` 和 `ResponseMode` 精细控制子 Agent 输出的可见性
- 适用于需要将复杂任务分解为专业子任务的场景
- 更灵活的动态子 Agent 方案参见 [dynamicagenttool](./dynamicagenttool.md)
