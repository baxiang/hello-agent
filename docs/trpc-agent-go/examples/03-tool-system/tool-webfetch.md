# WebFetch 网页抓取工具 - HTTP 直抓与 Gemini 服务端抓取的两种实现

> **源码路径**：[`trpc-agent-go/examples/tool/webfetch/`](../../../../trpc-agent-go/examples/tool/webfetch)
> **示例类型**：Tool 模式 · **难度**：入门

## 概述

`webfetch/` 是 Tool 工具系统里唯一**一个子目录包含两套实现**的示例：`httpfetch/` 用纯 HTTP 直接抓取并把 HTML 转 Markdown，`geminifetch/` 借助 Gemini 的 URL Context 能力在**服务端**完成抓取与分析。两者 API 几乎对称，但定位完全不同，可以按需替换。

本示例解决的是"让 Agent 读开放网页"的问题——和 [`openviking`](./tool-openviking.md) 的"读私有知识库"形成互补。

## 核心概念

### 两种实现对比

| 维度 | `httpfetch` | `geminifetch` |
|------|-------------|---------------|
| 工具名 | `web_fetch` | `gemini_web_fetch` |
| 抓取主体 | 本地进程发 HTTP | Gemini 服务端 |
| 返回内容 | HTML→Markdown 全文 | Gemini 分析后的内容 |
| 单次 URL 上限 | 最多 20 个 | 最多 20 个 |
| 鉴权 | 仅 `OPENAI_API_KEY` | 额外需要 `GEMINI_API_KEY` |
| 内容限额 | `MaxContentLength` / `MaxTotalContentLength` | 由 Gemini 端控制 |
| 适合场景 | 原文留痕、自定义解析 | 让 Gemini 直接做总结/对比 |

### Tool 注册（两者一致）

两种工具都返回 `tool.Tool`，都用 `WithTools` 注册：

```go
llmAgent := llmagent.New(
    agentName,
    llmagent.WithModel(modelInstance),
    llmagent.WithTools([]tool.Tool{fetchTool}),
)
```

## 代码解析

### 实现 A：`httpfetch/`

`httpfetch` 的特点是**内容长度可控**，提供两个限额 Option：

```go
fetchTool := httpfetch.NewTool(
    httpfetch.WithMaxContentLength(50000),       // 单 URL 50KB
    httpfetch.WithMaxTotalContentLength(150000), // 总计 150KB
)
```

`MaxContentLength` 防止某个巨型页面吃光预算；`MaxTotalContentLength` 防止模型一次性请求 20 个 URL 后总文本爆掉。Instruction 也明确告诉模型这个能力：

```go
llmagent.WithInstruction("Use the web_fetch tool to retrieve and extract content from web pages. "+
    "You can fetch multiple URLs at once (up to 20). "+
    "The tool converts HTML to markdown for better readability and supports various text formats including JSON, XML, plain text, etc. "+
    "When analyzing web content, provide clear summaries and extract key information relevant to the user's question."),
```

参数解析只有一个 `-model`：

```go
modelName := flag.String("model", "deepseek-v4-flash", "Name of the model to use")
```

事件分发同样采用三段式：检测 `web_fetch` 工具调用 → 打印抓取结果 → 流式输出文本。

### 实现 B：`geminifetch/`

`geminifetch` 不在本地抓取，而是把 URL 和问题一起交给 Gemini，由 Gemini 的 URL Context 在**云端**完成抓取和内容分析：

```go
geminiModel := flag.String("gemini-model", "gemini-2.5-flash", "Gemini model for web fetching")

fetchTool, err := geminifetch.NewTool(c.geminiModel)
if err != nil {
    return fmt.Errorf("failed to create gemini fetch tool: %w", err)
}
```

注意两个细节：
1. `geminifetch.NewTool` 返回 `(tool.Tool, error)`——需要错误处理；而 `httpfetch.NewTool` 直接返回 `tool.Tool`
2. 抓取用的 Gemini 模型与对话模型**分离**——`-model` 是对话模型，`-gemini-model` 是抓取模型

Instruction 也相应不同，强调"URL 自然嵌入 prompt 即可"：

```go
llmagent.WithInstruction("Use the gemini_web_fetch tool to retrieve and analyze web content. "+
    "Simply include URLs naturally in your prompt and Gemini will automatically fetch and analyze them on the server side. "+
    "You can include up to 20 URLs in a single request. "+
    "The tool leverages Gemini's URL Context feature for intelligent content extraction and analysis. "+
    "When analyzing web content, provide clear summaries and extract key information relevant to the user's question."),
```

### 共同的输出风格

两个实现的 `processStreamingResponse` 结构基本一致，只在打印文案上有差异：

| 事件 | `httpfetch` 文案 | `geminifetch` 文案 |
|------|------------------|--------------------|
| 发起调用 | `🌐 Web fetch initiated:` | `🌐 Gemini web fetch initiated:` |
| 执行中 | `🔄 Fetching web content...` | `🔄 Gemini fetching and analyzing content...` |
| 拿到结果 | `✅ Fetch result (ID: %s): %s` | 同上 |

两者都把 tool response 截断到 200 字符以内显示，避免终端被淹没。

## 运行方式

### 环境变量

| 变量 | httpfetch | geminifetch | 说明 |
|------|-----------|-------------|------|
| `OPENAI_API_KEY` | 是 | 是 | 对话模型 API Key |
| `OPENAI_BASE_URL` | 否 | 否 | 对话模型端点 |
| `GEMINI_API_KEY` | 否 | **是** | Gemini 抓取模型 API Key |

### 命令行参数

| 参数 | 子示例 | 说明 | 默认值 |
|------|--------|------|--------|
| `-model` | 两者 | 对话模型名 | `deepseek-v4-flash` |
| `-gemini-model` | 仅 geminifetch | 抓取用的 Gemini 模型 | `gemini-2.5-flash` |

### 运行命令

```bash
# httpfetch（HTTP 直抓）
cd examples/tool/webfetch/httpfetch
export OPENAI_API_KEY="your-key"
go run .
go run . -model gpt-4o-mini

# geminifetch（Gemini 服务端抓取）
cd examples/tool/webfetch/geminifetch
export OPENAI_API_KEY="your-key"
export GEMINI_API_KEY="your-gemini-key"
go run .
go run . -gemini-model gemini-2.5-pro
```

### 预期输出（httpfetch）

```
🚀 HTTP Web Fetch Chat Demo
Model: deepseek-v4-flash
Type 'exit' to end the conversation
Available tools: web_fetch
==================================================
✅ Web fetch chat ready! Session: web-fetch-session-1703123456

👤 You: Summarize https://example.com
🤖 Assistant: 🌐 Web fetch initiated:
   • web_fetch (ID: chatcmpl-tool-xxx)
     Args: {"urls":["https://example.com"]}

🔄 Fetching web content...
✅ Fetch result (ID: chatcmpl-tool-xxx): {"results":[{"retrieved_url":"https://example.com","status_code":200,...}]}

🤖 Assistant: Here's a summary of the page ...
```

### 预期输出（geminifetch）

```
🚀 Gemini Web Fetch Chat Demo
Model: deepseek-v4-flash
Gemini Fetch Model: gemini-2.5-flash
Available tools: gemini_web_fetch
==================================================
✅ Gemini web fetch chat ready! Session: gemini-web-fetch-session-1703123456

👤 You: Compare https://site1.com and https://site2.com
🤖 Assistant: 🌐 Gemini web fetch initiated:
   • gemini_web_fetch (ID: chatcmpl-tool-xxx)
     Prompt: {"prompt": "Compare ..."}

🔄 Gemini fetching and analyzing content...
✅ Fetch result (ID: chatcmpl-tool-xxx): {"content":"Both sites ..."}
```

## 适用场景与对比

**选 httpfetch 当：**
- 需要**原始内容**（Markdown 正文）留痕或二次处理
- 不想引入 Gemini 依赖
- 需要精确的内容长度限额
- 网页是 JSON/XML/纯文本等结构化格式

**选 geminifetch 当：**
- 主要需求是**总结/对比/分析**，不需要原文
- 想用 Gemini 的智能抽取能力（自动忽略无关内容）
- 网页含动态渲染（Gemini 端处理能力更强）

**选 [`openviking`](./tool-openviking.md) 当：**
- 要查的是**私有知识库**而不是开放网页

| 维度 | httpfetch | geminifetch | openviking |
|------|-----------|-------------|-----------|
| 数据源 | 开放网页 | 开放网页 | OpenViking 私库 |
| 返回 | 原文 Markdown | Gemini 分析后内容 | 摘要 + 按需全文 |
| 鉴权 | OpenAI | OpenAI + Gemini | OpenAI + OpenViking |
| Token 控制 | 本地限额 | Gemini 端 | search-then-read |
| 工具类型 | `tool.Tool` | `tool.Tool` | `tool.ToolSet` |

## 关键要点

1. **同一子目录两套实现**：`webfetch/` 把同一问题的两种解法（本地 HTTP / 服务端 Gemini）放在一起，是少见的"对照示例"
2. **API 对称但返回值不同**：`httpfetch.NewTool` 直接返回 tool；`geminifetch.NewTool` 返回 `(tool, error)`，注意错误处理
3. **双模型分离**：geminifetch 把"对话模型"和"抓取模型"分开（`-model` vs `-gemini-model`），可独立优化
4. **内容限额只在 httpfetch**：`WithMaxContentLength` / `WithMaxTotalContentLength` 是本地 HTTP 抓取独有的防爆手段
5. **Tool 注册方式相同**：两者都用 `WithTools`，可直接互换而无需改动 Agent 其它配置

## 总结

`webfetch` 是 Tool 系统里"读开放网页"的标配方案，两套实现给出了"自己抓"和"交给 Gemini 抓"的完整对照。把它和 [`codeexec`](./tool-codeexec.md)（计算）、[`hostexec`](./tool-hostexec.md)（本机作业）、[`openviking`](./tool-openviking.md)（私有知识库）组合起来，Agent 就能覆盖绝大多数"算、执行、查私库、查公网"的真实需求——这也是 [Tool 工具系统索引](./tool.md)想表达的全景。
