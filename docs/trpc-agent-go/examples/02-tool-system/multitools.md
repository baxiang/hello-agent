# 多工具集成 - 在单个 Agent 中注册多种自定义工具

## 概述

本示例演示如何在一个 LLM Agent 中集成多种自定义工具，包括计算器、时间查询、文本处理、文件操作以及 DuckDuckGo 搜索。这是构建功能丰富的 AI 助手的典型模式。

## 核心概念

tRPC-Agent-Go 的工具系统基于 `function.NewFunctionTool` 构建自定义工具。每个工具由三部分组成：

1. **请求结构体**：定义工具的输入参数，通过 `jsonschema` 标签描述参数语义
2. **响应结构体**：定义工具的返回数据
3. **处理函数**：实现工具的实际逻辑

多个工具通过 `llmagent.WithTools([]tool.Tool{...})` 统一注册到 Agent。

## 代码解析

### 定义工具的请求/响应结构体

以计算器工具为例，通过 `jsonschema` 标签让 LLM 理解参数含义和约束：

```go
type calculatorRequest struct {
    Expression string `json:"expression" jsonschema:"description=Mathematical expression to calculate,required"`
}

type calculatorResponse struct {
    Expression string  `json:"expression"`
    Result     float64 `json:"result"`
    Message    string  `json:"message"`
}
```

### 创建工具实例

使用 `function.NewFunctionTool` 将处理函数包装为工具：

```go
func createCalculatorTool() tool.CallableTool {
    return function.NewFunctionTool(
        calculateExpression,
        function.WithName("calculator"),
        function.WithDescription("Perform mathematical calculations..."),
    )
}
```

### 流式工具（StreamableTool）

时间工具展示了 `StreamableTool` 的用法，支持流式返回结果：

```go
func createTimeTool() tool.StreamableTool {
    return function.NewStreamableFunctionTool[timeRequest, timeResponse](
        getTimeInfo,
        function.WithName("time_tool"),
        function.WithDescription("Get time and date information"),
    )
}
```

流式工具通过 `tool.NewStream` 创建流，在 goroutine 中逐块发送数据：

```go
stream := tool.NewStream(10)
go func() {
    for i := 0; i < len(result); i++ {
        stream.Writer.Send(output, nil)
    }
    stream.Writer.Close()
}()
return stream.Reader, nil
```

### 注册多个工具

将所有工具放入切片，统一注册：

```go
tools := []tool.Tool{
    createCalculatorTool(),
    createTimeTool(),
    createTextTool(),
    createFileTool(),
    duckduckgo.NewTool(),  // 内置的 DuckDuckGo 搜索工具
}

llmAgent := llmagent.New("multi-tool-assistant",
    llmagent.WithTools(tools),
    // ...
)
```

### 事件流处理

Agent 返回的事件流中，工具调用和结果通过不同的事件类型区分：

- `ToolCalls` 非空：表示 LLM 发起了工具调用
- `Role == model.RoleTool`：表示工具执行完毕返回结果
- `Delta.Content` 非空：表示 LLM 的流式文本输出

## 运行方式

```bash
cd examples/multitools
export OPENAI_API_KEY="your-key"
go run . -model deepseek-v4-flash
```

启动后输入问题，观察 Agent 如何自动选择合适的工具完成任务。

## 总结

- `CallableTool` 适用于同步返回结果的工具，`StreamableTool` 适用于需要流式输出的场景
- `jsonschema` 标签是工具与 LLM 交互的桥梁，描述越精确，LLM 调用越准确
- 框架内置工具（如 `duckduckgo.NewTool()`）和自定义工具可以自由混合使用
- 进阶用法可参考 [agenttool](./agenttool.md)（将 Agent 作为工具）和 [toolfilter](./toolfilter.md)（运行时过滤工具）
