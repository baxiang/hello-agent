# ArXiv Search 示例 - 集成学术论文搜索的交互式 Agent

## 概述

本示例演示如何将 arXiv 学术论文搜索能力集成到 AI Agent 中，构建一个支持流式响应的交互式学术助手。用户可以通过自然语言检索 arXiv 上近 240 万篇 STEM 领域的学术论文，支持关键词搜索、作者查找、分类浏览和论文 ID 精确查询。

## 核心概念

### ArXiv ToolSet

`arxivsearch.NewToolSet()` 创建 arXiv 搜索工具集，封装了 arXiv API 的调用逻辑。工具输入支持以下参数：

- `query`：搜索关键词（标题、摘要、全文）
- `id_list`：精确查询 arXiv ID（如 "2401.12345"）
- `max_results`：最大返回数量
- `sort_by`：排序方式（relevance / submittedDate）
- `read_arxiv_papers`：是否提取 PDF 全文内容

### ToolSet 与 Tool 的区别

`ToolSet` 是一组相关工具的集合，通过 `llmagent.WithToolSets()` 注册。与单个 `Tool` 不同，`ToolSet` 可以包含多个功能点，Agent 根据用户意图自动选择合适的工具调用。

### 流式事件处理

Agent 执行过程中通过事件通道返回中间状态：工具调用事件（`ToolCalls`）、工具响应事件（`Role == "tool"`）和流式文本增量（`Delta.Content`），实现了搜索过程的实时可视化。

## 代码解析

**1. 创建搜索工具并注册到 Agent**

```go
searchTool, _ := arxivsearch.NewToolSet()

llmAgent := llmagent.New(
    "arxiv-assistant",
    llmagent.WithModel(openai.New(modelName)),
    llmagent.WithInstruction("Use the ArXiv tool to find scholarly articles..."),
    llmagent.WithGenerationConfig(genConfig),
    llmagent.WithToolSets([]tool.ToolSet{searchTool}),
)
```

通过 `WithToolSets` 将搜索工具集注册到 Agent，`WithInstruction` 引导 Agent 在合适时机调用工具。

**2. 流式事件处理**

```go
for event := range eventChan {
    if len(event.Response.Choices[0].Message.ToolCalls) > 0 {
        // 显示工具调用信息
    }
    if choice.Message.Role == model.RoleTool {
        // 显示搜索结果
    }
    if choice.Delta.Content != "" {
        // 输出流式文本
    }
    if event.IsFinalResponse() {
        break
    }
}
```

事件循环区分三种事件类型：工具调用触发（展示搜索参数）、工具结果返回（展示搜索结果）和 LLM 流式生成（逐字输出回答）。

## 运行方式

```bash
export OPENAI_API_KEY="your-key"
export OPENAI_BASE_URL="https://api.openai.com/v1"

cd examples/arxivsearch
go run main.go -model deepseek-v4-flash
```

启动后进入交互模式，可尝试以下查询：
- "Search for machine learning papers from 2024"
- "Find papers by author Yann LeCun"
- "Search for arXiv ID 2401.12345"

## 总结

ArXiv Search 示例展示了 tRPC-Agent-Go 的 ToolSet 集成模式，将外部 API 封装为 Agent 可调用的工具。与 Knowledge 示例不同，本示例面向实时的外部数据检索而非私有知识库，两者可以互补使用。流式事件处理模式同样适用于 wiki、DuckDuckGo 等其他搜索工具的集成场景。
