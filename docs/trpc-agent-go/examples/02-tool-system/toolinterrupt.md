# 工具中断 - 外部执行工具并回传结果

## 概述

`toolinterrupt` 示例演示了一种"中断-执行-恢复"的工具调用模式：Agent 仅代理工具调用（不自动执行），由外部调用者决定如何执行工具，然后将结果以 `role=tool` 消息的形式回传给 Agent 继续处理。这适用于 MCP 工具、外部服务调用或需要人工审批的场景。

## 核心概念

默认情况下，当 LLM 返回 `tool_calls` 时，框架会自动执行工具并将结果发回 LLM。本示例改变了这一流程：

1. Agent 声明外部工具（仅有声明，无执行逻辑）
2. LLM 发起工具调用后，框架不执行，直接将调用信息返回给调用者
3. 调用者在外部执行工具
4. 调用者通过 `model.NewToolMessage` 将结果回传
5. Agent 基于工具结果生成最终回答

协议顺序：`system → user → assistant(tool_calls) → tool(tool_result) → assistant(answer)`

## 代码解析

### 创建仅声明的外部工具

外部工具只需要 `Declaration()`，不需要实现 `Call` 接口：

```go
type declarationOnlyTool struct {
    declaration *tool.Declaration
}

func (t *declarationOnlyTool) Declaration() *tool.Declaration {
    return t.declaration
}

func newExternalSearchDeclaration() tool.Tool {
    return &declarationOnlyTool{
        declaration: &tool.Declaration{
            Name:        "external_search",
            Description: "Search an external system for information.",
            InputSchema: &tool.Schema{
                Type: "object",
                Properties: map[string]*tool.Schema{
                    "query": {Type: "string", Description: "Search query."},
                },
                Required: []string{"query"},
            },
        },
    }
}
```

### 通过 WithExternalTools 注册

外部工具通过 `agent.WithExternalTools` 在运行时注册：

```go
eventChan, err := d.runner.Run(
    ctx, userID, d.sessionID, message,
    agent.WithExternalTools(d.externalTools),
)
```

### 中断-执行-恢复循环

核心循环逻辑：收集工具调用 → 外部执行 → 回传结果 → 继续下一轮

```go
func (d *toolInterruptDemo) processTurn(ctx context.Context, userInput string) error {
    next := model.NewUserMessage(userInput)
    for i := 0; i < maxToolLoops; i++ {
        toolCalls, err := d.runOnce(ctx, next)
        if len(toolCalls) == 0 {
            return nil  // 无工具调用，Agent 已给出最终回答
        }
        // 外部执行工具并构造回传消息
        next, err = d.executeExternally(toolCalls[0])
    }
}
```

### 构造工具结果消息

使用 `model.NewToolMessage` 构造回传消息，必须包含原始的 `tool_call_id`：

```go
func (d *toolInterruptDemo) executeExternally(tc model.ToolCall) (model.Message, error) {
    resultJSON, _ := runExternalSearch(tc.Function.Arguments)
    return model.NewToolMessage(tc.ID, tc.Function.Name, resultJSON), nil
}
```

## 运行方式

```bash
cd examples/toolinterrupt
export OPENAI_API_KEY="your-key"
go run . -model deepseek-v4-flash
```

运行后输入任意问题，可以观察到：
1. 模型发起工具调用但不执行
2. 调用者在外部执行工具
3. 工具结果回传后模型生成最终回答

## 总结

- `agent.WithExternalTools` 注册仅有声明的外部工具，框架不会自动执行
- `model.NewToolMessage(callID, name, result)` 是回传工具结果的标准方式
- 此模式适用于：MCP 工具集成、外部服务调用、需要人工审批的工具调用
- 与人机协同模式（humaninloop）的区别在于：本示例侧重程序化的外部执行，而非人工交互
