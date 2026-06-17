# Code Context Engine 示例 - 代码检索 MCP 服务 + Agent 对照

> **源码路径**：[`trpc-agent-go/examples/knowledge/features/code_context_engine/`](../../../../trpc-agent-go/examples/knowledge/features/code_context_engine)
> **示例类型**：MCP 服务化 + 对比评测 · **难度**：高级

## 概述

`features/code_context_engine/` 由两个组件构成：

1. **`mcp/server.go`**：把框架内置的 `code_search` 工具通过 MCP 协议暴露成 HTTP 服务，供任何 MCP 客户端（Augment、Cursor、另一个 trpc-agent-go Agent）消费。
2. **`comparison/`**：在同一个仓库问题上对比"本地 Agent + 自建 MCP"和"Augment Agent + Augment MCP"两种方案，把答案和工具调用 trace 写成 Markdown 报告。

这是 Knowledge 系列里**唯一**把检索能力"服务化对外暴露"的示例，与 [`graphrag`](./knowledge-features-graphrag.md)（对内增强）形成对照。

## 核心概念

### MCP 服务化：把 code_search 暴露给外部

```go
searchTool := knowledgetool.NewCodeSearchTool(kb,
    knowledgetool.WithCodeSearchMaxResults(maxResults),
)
callable := searchTool.(agenttool.CallableTool)
decl := searchTool.Declaration()

server := mcp.NewServer("trpc-agent-code-search-mcp", "0.1.0",
    mcp.WithServerPath("/mcp"),
    mcp.WithCustomServer(httpServer),
)
mcpTool := newCodeSearchMCPTool(decl)
handler := newCodeSearchHandler(callable)
server.RegisterTool(mcpTool, handler)
```

任何 MCP 客户端连上 `http://localhost:3001/mcp` 即可调用 `code_search`，背后是 trpc-agent-go 的 AST + 向量检索管线。

### 对比评测：本地 vs Augment

`comparison/main.go` 把同一个问题分别喂给两个 Agent：

| Agent | 工具来源 | 工具实现 |
|-------|---------|---------|
| **Local** | 自建 MCP（`http://localhost:3001/mcp`） | trpc-agent-go AST + 向量 |
| **Augment** | Augment 云端 MCP（`https://api.augmentcode.com/mcp`） | Augment Context Engine |

两者都通过 MCP ToolSet 接入，对 Agent 完全透明。

## 代码解析

### MCP Server（`mcp/server.go`）

#### 知识库构造

```go
repoSource := repo.New(
    repo.WithRepository(repo.Repository{
        URL:         repoURL,         // https://github.com/trpc-group/trpc-agent-go
        Branch:      repoBranch,
        RepoName:    repoName,
        Description: "tRPC agent framework for Go (this repository).",
        RepoURL:     repoURL,
    }),
    repo.WithFileExtensions([]string{".go", ".md"}),
    repo.WithSkipSuffixes([]string{".pb.go", ".pb.grpc.go", ".trpc.go", "_mock.go", "_test.go"}),
)

kb := knowledge.New(
    knowledge.WithVectorStore(vs),
    knowledge.WithEmbedder(emb),
    knowledge.WithSources([]source.Source{repoSource}),
)
```

注意 `WithSkipSuffixes` 跳过生成代码和测试——避免把 `.pb.go` 等噪声入库。

#### 加载控制 flag

```go
flagSkipLoad    = flag.Bool("skip-load", false, "Skip repository ingestion and reuse the existing vector-store data as-is")
flagTruncateOld = flag.Bool("truncate-old", false, "Recreate the vector store before ingestion...")
flagStoreType   = flag.String("store", ..., "Vector store type ...")
```

| flag | 作用 |
|------|------|
| `-skip-load` | 复用已有向量数据，跳过加载（启动快） |
| `-truncate-old` | 重建向量库（清空旧数据） + 强制重新加载 |
| `-store` | 后端类型（默认 inmemory） |

`-truncate-old` 优先级高于 `-skip-load`，同时为 true 时强制重新加载。

#### MCP 工具 schema

`codeSearchInputSchema()` 用 OpenAPI 3 Schema 精确描述 `code_search` 的输入：

```go
&openapi3.Schema{
    Type: &openapi3.Types{openapi3.TypeObject},
    Properties: openapi3.Schemas{
        "query":  schemaRef(stringSchema(codeSearchQueryDescription)),
        "filter": schemaRef(codeSearchFilterConditionSchema(filterSchemaDepth)),
    },
}
```

`filter` 是嵌套结构（支持 `and`/`or` 逻辑操作符 + `eq/ne/gt/lt/in/like` 比较操作符），schema 递归定义到 `filterSchemaDepth=2` 层。

#### Handler 桥接

```go
func newCodeSearchHandler(callable agenttool.CallableTool) func(...) {
    return func(ctx context.Context, req *mcp.CallToolRequest) (*mcp.CallToolResult, error) {
        args := req.Params.Arguments
        jsonArgs, _ := json.Marshal(args)
        result, err := callable.Call(ctx, jsonArgs)   // 转发给底层 CallableTool
        text, _ := renderToolResult(result)
        return mcp.NewTextResult(text), nil
    }
}
```

MCP 请求和底层工具调用之间只做 JSON 编解码，行为与本地直接调 `code_search` 完全一致。

### Comparison Runner（`comparison/`）

#### 三种运行模式

```go
runMode = flag.String("mode", runModeBoth, "Which agent(s) to run: local | augment | both")
```

- `local`：只跑本地 Agent
- `augment`：只跑 Augment Agent（需 `AUGMENT_CONTEXT_ENGINE_API_KEY`）
- `both`（默认）：两者都跑，输出对比

#### 本地 Agent 接 MCP

```go
toolSet := mcp.NewMCPToolSet(
    mcp.ConnectionConfig{
        Transport: "streamable_http",
        ServerURL: cfg.MCPServerURL,        // http://localhost:3001/mcp
        Timeout:   30 * time.Second,
    },
    mcp.WithName("local-code-search-mcp"),
    mcp.WithToolFilterFunc(tool.NewIncludeToolNamesFilter(cfg.MCPToolName)),  // 只要 code_search
)
toolSet.Init(ctx)

ag := llmagent.New("local-code-search-agent",
    llmagent.WithModel(newAgentModel(cfg.ModelName)),
    llmagent.WithInstruction(localCodeSearchAgentInstruction),
    llmagent.WithToolSets([]tool.ToolSet{toolSet}),   // 通过 MCP 远程调用
)
```

本地 Agent 不直接持有 Knowledge Base，而是**通过 MCP 远程调用** code_search——验证 MCP 服务化的端到端可用性。

#### Augment Agent 接 Augment MCP

```go
headers := map[string]string{}
if key := util.GetEnvOrDefault("AUGMENT_CONTEXT_ENGINE_API_KEY", ""); key != "" {
    if !strings.HasPrefix(strings.ToLower(key), "bearer ") {
        key = "Bearer " + key
    }
    headers["Authorization"] = key
}

toolSet := mcp.NewMCPToolSet(
    mcp.ConnectionConfig{
        Transport: "streamable_http",
        ServerURL: augmentServerURL,        // https://api.augmentcode.com/mcp
        Headers:   headers,
    },
    mcp.WithName("augment-context-engine"),
    mcp.WithToolFilterFunc(tool.NewIncludeToolNamesFilter(augmentToolName)),  // augment_code_search
)
```

两个 Agent 接线结构完全一致，只是 URL / Tool 名 / 鉴权不同——这就是 MCP 抽象的价值。

#### 报告生成

每个 case 输出一份 Markdown 报告到 `output/code_context_engine/{case_name}.md`，包含：

- Prompt 原文
- 每个 Agent 的 final answer
- 每次工具调用的 name + arguments
- 每次工具响应的 content

便于人工对照两种方案的质量差异。

## 运行方式

### Step 1：启动 MCP Server

```bash
cd examples/knowledge/features/code_context_engine/mcp
export OPENAI_API_KEY="sk-xxxx"
export EMBEDDING_MODEL_NAME="text-embedding-3-small"

# 首次：加载仓库
go run . -store inmemory

# 复用已有数据
go run . -store pgvector -skip-load
```

启动后监听 `http://127.0.0.1:3001/mcp`。

### Step 2：运行 Comparison

```bash
cd examples/knowledge/features/code_context_engine/comparison
export MODEL_NAME="gpt-5.4"

# 两者都跑（需 AUGMENT_CONTEXT_ENGINE_API_KEY）
go run .

# 只跑本地 Agent
go run . -mode local

# 自定义本地 MCP URL
go run . -local-mcp-url http://localhost:3001/mcp -local-mcp-tool code_search
```

### 环境变量

| 变量 | 用途 |
|------|------|
| `OPENAI_API_KEY` | MCP server 加载仓库时 embedding |
| `EMBEDDING_MODEL_NAME` | MCP server embedding 模型（默认 `text-embedding-3-small`） |
| `VECTOR_STORE_TYPE` | MCP server 后端（默认 inmemory） |
| `MODEL_NAME` | comparison Agent 模型（默认 `gpt-5.4`） |
| `AUGMENT_CONTEXT_ENGINE_API_KEY` | Augment 鉴权（跑 augment 模式时必需） |

### 命令行参数（MCP Server）

| 参数 | 说明 | 默认值 |
|------|------|--------|
| `-addr` | 监听地址 | `127.0.0.1:3001` |
| `-path` | MCP 路径 | `/mcp` |
| `-skip-load` | 跳过加载 | `false` |
| `-truncate-old` | 重建向量库 | `false` |
| `-store` | 后端 | `inmemory` |

### 命令行参数（Comparison）

| 参数 | 说明 | 默认值 |
|------|------|--------|
| `-mode` | `local` / `augment` / `both` | `both` |
| `-output-dir` | 报告目录 | `output/code_context_engine` |
| `-local-mcp-url` | 本地 MCP URL | `http://localhost:3001/mcp` |
| `-local-mcp-tool` | 本地工具名 | `code_search` |

### 预期输出（Comparison）

```
Code Context Engine Agent Comparison
====================================
Repository URL: https://github.com/trpc-group/trpc-agent-go
Agent Model: gpt-5.4
Local MCP URL: http://localhost:3001/mcp
Run Mode: both

Step 2: Per-question agent comparison
----------------------------------------

CASE :: multi_agent_session_isolation
Description: Ask how sub-agents share or isolate session state...
Prompt: In trpc-agent-go's multi-agent system...

[Local agent + code_search]
  tool_calls: 4 | tool_results: 4
  final_answer: Sub-agents in trpc-agent-go isolate session state via...
  first_tool: code_search

[Augment agent + MCP]
  tool_calls: 3 | tool_results: 3
  final_answer: ...
  first_tool: augment_code_search

Report written: output/code_context_engine/multi_agent_session_isolation.md
```

## 适用场景与对比

**用 code_context_engine 当：**
- 想把自建代码检索暴露给 Cursor / Augment / 其它 MCP 客户端
- 评测自建检索 vs Augment Context Engine 的质量差异
- 验证 MCP ToolSet 抽象的端到端可用性

**对比 [`graphrag`](./knowledge-features-graphrag.md)：**

| 维度 | graphrag | code_context_engine |
|------|----------|---------------------|
| 定位 | 对内增强（图遍历） | 对外服务（MCP 暴露） |
| 工具 | code_graph_* (3个) | code_search (1个) |
| 存储 | AGE + pgvector | 单一向量库 |
| 客户端 | 本地 Agent | 任何 MCP 客户端 |
| 适合 | 调用链分析 | 跨 Agent 复用检索能力 |

两者可叠加：graphrag 对内做深度图遍历，code_context_engine 把基础 code_search 服务化给外部。

## 关键要点

1. **MCP 是对外协议**：把 trpc-agent-go 检索能力暴露成标准 MCP 服务。
2. **CallableTool 桥接**：MCP handler 只做 JSON 编解码，行为与本地调用一致。
3. **ToolSet 远程接入**：Agent 通过 `mcp.NewMCPToolSet` 远程消费 MCP 工具，对 Agent 透明。
4. **对比评测**：同一问题跑两种方案，输出 Markdown 报告便于人工对照。
5. **schema 递归**：filter schema 递归到 2 层，支持嵌套 and/or。

## 总结

code_context_engine 是"服务化"维度的 Knowledge 示例——把 code_search 通过 MCP 协议变成可被任何客户端消费的 HTTP 服务。它演示了 trpc-agent-go 既能消费 MCP（Agent 端），也能提供 MCP（Server 端）。配合 [`graphrag`](./knowledge-features-graphrag.md) 的图遍历，可构建"内部深度检索 + 外部标准接口"的完整代码 RAG 体系。
