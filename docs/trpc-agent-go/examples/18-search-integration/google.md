# Google Search 集成 - 为 Agent 接入实时网页搜索

## 概述

Google Search 示例演示了如何使用 tRPC-Agent-Go 的 `tool/google/search` 工具为 Agent 提供实时网页搜索能力。与 DuckDuckGo 的百科查询不同，Google Search 通过 Custom Search JSON API 提供实时网页内容、新闻资讯和最新信息，适用于需要获取时效性数据的场景。

## 核心概念

### ToolSet 与 Tool 的区别

Google Search 使用 `ToolSet`（工具集）而非单个 `Tool`，通过 `llmagent.WithToolSets` 注册。ToolSet 可包含多个关联工具，并支持统一的生命周期管理和配置。

### 外部 API 集成模式

Google Search 需要外部 API Key 和搜索引擎 ID，示例通过环境变量注入配置，体现了框架对外部服务集成的标准模式：

```go
apiKey := os.Getenv("GOOGLE_API_KEY")
searchEngineID := os.Getenv("GOOGLE_SEARCH_ENGINE_ID")
```

## 代码解析

### 搜索工具创建

通过选项模式配置搜索参数：

```go
searchTool, err := googlesearch.NewToolSet(context.Background(),
    googlesearch.WithAPIKey(apiKey),
    googlesearch.WithEngineID(searchEngineID),
    googlesearch.WithSize(5),         // 每次返回 5 条结果
    googlesearch.WithLanguage("en"),  // 搜索语言
)
```

`WithSize` 控制返回结果数量，`WithLanguage` 设置搜索语言偏好，可根据业务需求调整。

### Agent 指令优化

指令强调了信息来源引用，这是搜索类 Agent 的最佳实践：

```go
llmagent.WithInstruction(
    "Use the Google Search tool to find real-time information. " +
    "Always cite your sources when using search results.",
),
```

### 流式事件处理

事件处理逻辑与 DuckDuckGo 示例一致，体现了框架工具系统的统一抽象——无论底层搜索引擎如何，上层处理代码完全相同。区别仅在于工具名称和搜索结果的内容格式。

## 运行方式

**环境准备**：

```bash
export OPENAI_API_KEY="your-api-key"
export GOOGLE_API_KEY="your-google-api-key"
export GOOGLE_SEARCH_ENGINE_ID="your-search-engine-id"
```

Google API Key 需在 Google Cloud Console 创建，搜索引擎 ID 需在 Programmable Search Engine 配置。

**运行命令**：

```bash
cd examples/google
go run ./search/ --model deepseek-v4-flash
```

**交互示例**：

```
👤 You: What's the latest news about artificial intelligence?
🔍 Google Search initiated:
   • google_search
🔄 Searching Google...
✅ Search results: [实时搜索结果]
🤖 Assistant: Based on recent search results, here are the latest AI developments...
```

## 总结

Google Search 示例展示了框架对外部搜索 API 的标准集成模式。与 DuckDuckGo 的零配置相比，Google Search 需要额外的 API 配置，但提供了实时性和结果质量的优势。两者的 Agent 端代码结构完全一致，可根据场景灵活选择。建议在开发阶段使用免费的 DuckDuckGo，生产环境使用 Google Search。
