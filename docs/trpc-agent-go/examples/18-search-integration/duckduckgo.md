# DuckDuckGo 搜索集成 - 为 Agent 接入百科知识查询

## 概述

DuckDuckGo 示例演示了如何使用 tRPC-Agent-Go 内置的 `tool/duckduckgo` 工具为 Agent 提供百科类信息查询能力。DuckDuckGo Instant Answer API 适合查询实体信息（人物、公司、地点）、定义、数学计算和历史事实等静态知识，但不支持实时数据（如天气、新闻、股价）。

## 核心概念

### 内置搜索工具

框架将常用的搜索引擎封装为即用工具，通过 `duckduckgo.NewTool()` 一行代码即可创建。工具自动处理 API 调用、结果解析和格式化，开发者只需将其注册到 Agent 即可。

### 工具注册模式

通过 `llmagent.WithTools` 将工具注册到 Agent：

```go
searchTool := duckduckgo.NewTool()
llmAgent := llmagent.New(agentName,
    llmagent.WithTools([]tool.Tool{searchTool}),
)
```

Agent 会根据用户提问自动决定是否调用搜索工具。

## 代码解析

### Agent 配置

Agent 指令明确了工具的使用范围，引导模型正确使用搜索能力：

```go
llmagent.WithInstruction(
    "Use the DuckDuckGo search tool for factual, encyclopedic information " +
    "such as entity details, definitions, mathematical calculations, and " +
    "historical facts. Do NOT use it for real-time data.",
),
```

### 流式响应处理

示例实现了完整的流式事件处理链，区分三类事件：

1. **工具调用事件**：检测 `ToolCalls` 字段，显示搜索请求信息
2. **工具响应事件**：检测 `RoleTool` 角色，显示搜索结果
3. **文本生成事件**：通过 `Delta.Content` 逐字输出 Agent 回复

```go
if len(event.Response.Choices[0].Message.ToolCalls) > 0 {
    fmt.Printf("DuckDuckGo search initiated:\n")
}
if choice.Message.Role == model.RoleTool {
    fmt.Printf("Search results: %s\n", choice.Message.Content)
}
if choice.Delta.Content != "" {
    fmt.Print(choice.Delta.Content)
}
```

### Runner 生命周期

示例使用 `defer c.runner.Close()` 确保 Runner 资源的正确释放，这是 v0.5.0 之后的推荐实践。

## 运行方式

**环境准备**：

```bash
export OPENAI_API_KEY="your-api-key"
```

DuckDuckGo Instant Answer API 无需额外 API Key。

**运行命令**：

```bash
go run ./examples/duckduckgo/ --model deepseek-v4-flash
```

**交互示例**：

```
👤 You: Search for information about Steve Jobs
🔍 DuckDuckGo search initiated:
   • duckduckgo_search
🔄 Searching the web...
✅ Search results: Steve Jobs was an American entrepreneur...
🤖 Assistant: Steve Jobs (1955-2011) was the co-founder of Apple Inc...
```

## 总结

DuckDuckGo 示例展示了框架工具集成的最简模式——一行创建、一行注册即可为 Agent 赋予搜索能力。对于需要实时搜索的场景，建议使用 `google/search` 示例中的 Google Search API。两者的工具注册和事件处理模式完全一致，可无缝切换。
