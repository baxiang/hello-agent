# Wikipedia Search 示例 - 多语言维基百科搜索 Agent

## 概述

本示例演示如何构建一个集成 Wikipedia 搜索能力的交互式 Agent，支持多语言维基百科搜索（中文、英文、日文等），Agent 能根据用户提问的语言自动选择对应的维基百科版本进行检索。适用于需要实时获取百科知识、事实核查和跨语言信息检索的场景。

## 核心概念

### Wikipedia ToolSet

`wikipedia.NewToolSet()` 创建维基百科搜索工具集，支持以下配置选项：

- **WithLanguage**：默认搜索语言（如 "en"、"zh"、"ja"）
- **WithMaxResults**：每次搜索的最大返回数量
- **WithUserAgent**：请求标识，符合维基百科 API 使用规范

搜索结果包含文章标题、URL、描述、页面 ID、字数统计、最后修改时间等丰富元数据。

### Agent 指令中的多语言引导

通过精心设计的 Instruction，引导 Agent 根据用户语言自动选择搜索语言：

```go
func (c *wikiChat) buildInstruction() string {
    return fmt.Sprintf(`You can specify the 'language' parameter...
- For "什么是人工智能？" use language='zh'
- For "What is AI?" use language='en'
- Default language if not specified: %s`, c.language)
}
```

这种模式展示了如何通过 Prompt Engineering 让 Agent 智能地使用工具参数。

### 交互命令系统

示例实现了 `/help`、`/info`、`/exit` 等内置命令，展示了如何在 Agent 对话循环中处理特殊指令与正常消息的分流。

## 代码解析

**1. 创建多语言搜索工具**

```go
wikiToolSet, _ := wikipedia.NewToolSet(
    wikipedia.WithLanguage("en"),
    wikipedia.WithMaxResults(3),
    wikipedia.WithUserAgent("trpc-agent-go-wiki-search"),
)
```

**2. 解析工具调用参数并展示搜索过程**

```go
if params := c.parseToolArguments(string(toolCall.Function.Arguments)); params != nil {
    if query, ok := params["query"].(string); ok {
        fmt.Printf("   Query: %s\n", query)
    }
    if langParam, ok := params["language"].(string); ok && langParam != "" {
        fmt.Printf("   Language: %s (AI selected)\n", langParam)
    }
}
```

通过解析 JSON 格式的工具参数，可以在 UI 层展示 Agent 的决策过程（选择了哪种语言、搜索了什么关键词）。

**3. 格式化展示搜索结果**

```go
func (c *wikiChat) displayToolResults(content string) {
    var result map[string]any
    json.Unmarshal([]byte(content), &result)
    // 展示 query、language、summary、文章列表等
}
```

将工具返回的 JSON 结构化数据解析为用户友好的格式输出。

## 运行方式

```bash
export OPENAI_API_KEY="your-key"
export OPENAI_BASE_URL="https://api.openai.com/v1"

cd examples/wiki
go run main.go -model deepseek-v4-flash -lang zh -maxresults 5
```

命令行参数：
- `-model`：使用的模型名称
- `-lang`：默认搜索语言
- `-maxresults`：最大搜索结果数

## 总结

Wikipedia Search 示例展示了 ToolSet 工具集成的另一种实践：通过 Instruction 引导 Agent 智能选择工具参数。与 ArXiv Search 面向学术论文不同，本示例面向通用百科知识检索，且支持多语言自动切换。两者的事件处理模式一致，可参考对比学习 ToolSet 的标准集成方式。
