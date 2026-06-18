# ToolPipe - 类 Shell 管道过滤工具输出

## 概述

`toolpipe` 示例演示了 `toolpipe` 扩展，它为工具输出添加了类 Shell 的管道过滤能力。当工具返回大量数据时（如网页内容、搜索结果），模型可以使用 `grep`、`head`、`tail`、`jq` 等操作从输出中提取关键信息，避免大量无关内容污染上下文窗口。本文同时介绍交互式演示（interactive）和性能基准测试（benchmark）两个子示例。

## 核心概念

ToolPipe 作为 `llmagent.Extension` 扩展工作：
1. 为指定工具的输入 schema 注入一个 `result_filter` 参数
2. 模型调用工具时可以附带管道表达式，如 `grep -i keyword | head 10`
3. 框架在调用真实工具前剥离 `result_filter`，执行完毕后将过滤器应用于输出
4. 仅将过滤后的结果返回给模型

## 代码解析

### 创建 ToolPipe 扩展

```go
pipe := toolpipe.New(
    toolpipe.WithToolNames("duckduckgo_search", "web_fetch"),
    toolpipe.WithAllowedOps(
        toolpipe.OpGrep,
        toolpipe.OpHead,
        toolpipe.OpTail,
        toolpipe.OpJQ,
    ),
    toolpipe.WithMaxOutputBytes(32<<10),  // 32KB 最大过滤输出
)
```

- `WithToolNames`：指定哪些工具启用管道过滤
- `WithAllowedOps`：限制允许的管道操作
- `WithMaxOutputBytes`：限制过滤后的输出大小

### 注册到 Agent

通过 `llmagent.WithExtensions` 注册扩展：

```go
agent := llmagent.New("search-assistant",
    llmagent.WithTools([]tool.Tool{searchTool, fetchTool}),
    llmagent.WithExtensions(pipe),
)
```

### 模型使用示例

启用 ToolPipe 后，模型可以自然地写出管道表达式：

```json
{
  "query": "Go programming language",
  "result_filter": "grep -i concurrency | head 5"
}
```

框架会：
1. 用 `{"query": "Go programming language"}` 调用 `duckduckgo_search`
2. 对返回结果执行 `grep -i concurrency | head 5`
3. 将过滤后的内容返回给模型

### benchmark - A/B 性能对比

benchmark 子示例通过 OpenAI 回调收集 Token 消耗和上下文大小等指标：

```go
openai.WithChatRequestCallback(func(_ context.Context, req *oai.ChatCompletionNewParams) {
    raw, _ := json.Marshal(req.Messages)
    size := int64(len(raw))
    // 记录峰值上下文大小
})
```

它在同一任务上分别运行基线（不使用 ToolPipe）和 ToolPipe 两种模式，对比指标包括：
- Token 总消耗（输入 + 输出）
- 峰值上下文大小
- 模型调用轮数

典型的基准测试结果显示，在 JSON 提取场景下 Token 消耗可降低 88%，上下文峰值缩减 96%。

## 运行方式

```bash
cd examples/toolpipe

# 交互式演示
cd interactive
export OPENAI_API_KEY="your-key"
go run . -model="gpt-4o"

# A/B 基准测试
cd benchmark
go run . -model="gpt-5" -mode=both

# 单个场景测试
go run . -model="gpt-5" -mode=both -task=json-field-extract
```

## 总结

- ToolPipe 是一种上下文优化手段，通过减少无关工具输出来降低 Token 消耗
- 支持 `grep`、`head`、`tail`、`jq` 四种管道操作
- 以 `Extension` 方式集成，不修改原有工具代码
- 适合工具输出数据量大的场景（网页抓取、API 响应、日志搜索等）
- 不适合工具输出本身就很小或需要全量数据的场景
