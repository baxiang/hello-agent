# GraphRAG 示例 - 代码仓库图检索（Apache AGE + pgvector）

> **源码路径**：[`trpc-agent-go/examples/knowledge/features/graphrag/`](../../../../trpc-agent-go/examples/knowledge/features/graphrag)
> **示例类型**：代码图 RAG · **难度**：高级

## 概述

`features/graphrag/` 是 Knowledge 系列最复杂的示例：把代码仓库解析成"节点 + 边"的图存进 Apache AGE（PostgreSQL 图扩展），同时把 AST chunk 存进 pgvector 做语义种子检索。Agent 配备 `code_graph_search` / `code_graph_traverse` / `code_graph_find_paths` 三个工具，能回答普通向量检索答不了的"调用链"、"实现关系"、"连接路径"类问题。配套 [`viewer`](./knowledge-features-graphrag-viewer.md) 提供可视化界面。

## 核心概念

### GraphRAG vs 普通 RAG

普通 RAG（如 [`basic`](./knowledge-basic.md) / [`ast`](./knowledge-sources-ast.md)）只做"语义相似 chunk 检索"，对以下问题无能为力：

- "X 函数调用了哪些函数？"（需要 CALLS 边遍历）
- "谁实现了这个接口？"（需要 IMPLEMENTS 边反向遍历）
- "A 和 B 是怎么连接的？"（需要路径查找）

GraphRAG 把代码的"调用 / 实现 / 包含 / 依赖"关系建模成图边，让 Agent 能沿着边遍历回答结构化问题。

### 双存储架构

```
                ┌─────────────────────────┐
   Repository → │  GraphKnowledge         │
                │  ├─ GraphStore (AGE)    │ ← 节点 + 边（Cypher 查询）
                │  └─ VectorStore (pgvec) │ ← AST chunk（语义种子检索）
                └────────────┬────────────┘
                             │
                  ┌──────────┴───────────┐
                  ▼                      ▼
          code_graph_search       code_graph_traverse
          (语义找种子节点)        (沿边遍历邻居)
                  │                      │
                  └──────────┬───────────┘
                             ▼
                  code_graph_find_paths
                  (找两点间路径)
```

### 三个工具的协同

| 工具 | 输入 | 输出 | 用途 |
|------|------|------|------|
| `code_graph_search` | query + filter | 文档列表（含 graph node id） | 语义找种子 |
| `code_graph_traverse` | start_ids + direction + edge_types | 节点 + 边 | 遍历邻居 |
| `code_graph_find_paths` | from_id + to_id | 路径（节点序列 + 边序列） | 两点连接 |

典型工作流：**search 找种子 → traverse 探邻居 → 必要时 find_paths**。

## 代码解析

### Knowledge Base 构造

```go
kb := knowledge.NewGraphKnowledge(
    knowledge.WithGraphStore(graphStore),       // Apache AGE
    knowledge.WithGraphVectorStore(vectorStore), // pgvector
    knowledge.WithGraphEmbedder(embedder),       // OpenAI
)
```

注意是 `NewGraphKnowledge`（不是普通 `New`），它返回 `*BuiltinGraphKnowledge`，额外支持图加载和图工具。

### 加载图源（仓库）

```go
repoSrc := repo.New(
    repo.WithRepository(repo.Repository{
        URL:         defaultRepoURL,         // https://github.com/trpc-group/trpc-agent-python
        RepoName:    defaultRepoName,
        Description: defaultRepoDesc,
    }),
    repo.WithName(defaultRepoName+" Repository"),
    repo.WithFileExtensions([]string{".go", ".py"}),
)

err := kb.LoadGraphSource(ctx, timedGraphSource{name: ..., src: repoSrc},
    knowledge.WithGraphLoadProgress(true),
    knowledge.WithGraphLoadProgressStepSize(*progressStep),
    knowledge.WithGraphLoadConcurrency(knowledge.GraphLoadConcurrency{
        AddNodeRoutines:   200,
        AddEdgeRoutines:   200,
        EmbeddingRoutines: 10,
    }),
)
```

加载是耗时操作（clone + AST 解析 + 节点入库 + 边入库 + embedding），所以用高并发（200+200+10 goroutine）。

### `-recreate` 控制重建

```go
recreate = flag.Bool("recreate", false,
    "Drop pgvector table and reload graph source; false reuses existing graph/vector data")
```

- `-recreate=true`：drop AGE graph + drop pgvector table，从零重建（首次运行或仓库大改时用）
- `-recreate=false`：复用已有数据，直接进入 chat（日常使用）

### 工具注册

```go
graphToolSet := knowledgetool.NewCodeGraphSearchTool(
    kb,
    knowledgetool.WithCodeSearchRepoInfos([]knowledgetool.CodeRepoInfo{{
        Name:        defaultRepoName,
        Description: defaultRepoDesc,
    }}),
    knowledgetool.WithCodeSearchMaxResults(3),
)

llmAgent := llmagent.New("graph-knowledge-assistant",
    llmagent.WithModel(openaimodel.New(*modelName)),
    llmagent.WithInstruction(graphAgentInstruction()),  // 关键：教 LLM 怎么用图工具
    llmagent.WithGenerationConfig(model.GenerationConfig{Stream: true}),
    llmagent.WithToolSets([]tool.ToolSet{graphToolSet}),  // ToolSet 一次注册多个相关工具
)
```

`NewCodeGraphSearchTool` 返回 **ToolSet**（不是单个 Tool），内含 search/traverse/find_paths 三个工具。`WithToolSets` 一次挂上全部。

### Agent 指令（教 LLM 用图）

`graphAgentInstruction()` 是一段精心设计的 prompt，告诉 LLM：

- 用 `code_graph_search` **只**找种子节点（拿到 graph node id）
- 找到种子后**必须**至少调一次 `code_graph_traverse`
- traverse 需要 `start_ids`（不是 query！）
- 不同问题用不同 edge_types：CALLS / IMPLEMENTS / METHOD / FIELD
- `code_graph_find_paths` 用于"两点如何连接"

这段指令是 GraphRAG 效果的关键——没有它 LLM 会反复 search 不去 traverse。

### 案例演示：超时传播链

README 给出完整案例。问"trpc-go 的超时传播链"，Agent 的执行序列：

```
1. code_graph_search "timeout propagation context deadline"
   → 拿到 server.WithTimeout / client.WithTimeout 等种子

2. code_graph_search "WithTimeout SetTimeout timeout handling"
   → 补充更多种子，过滤 type=Function/Method

3. code_graph_traverse direction=out edge_types=[CALLS] max_depth=2
   → 沿 CALLS 边展开，发现 client.client.Invoke 调用链

最终答案：
  client.client.Invoke
    → applies client timeout with context.WithTimeout
    → writes remaining deadline into msg.WithRequestTimeout
  codec.msg.WithRequestTimeout
    → stores timeout on the framework message
  server.service.handle
    → reads msg.RequestTimeout
    → compares upstream timeout with server Options.Timeout
```

这种"沿着调用链追"的答案，普通向量检索完全做不到。

## 运行方式

### 前置依赖

需要两个 PostgreSQL 服务（可同实例不同库）：

1. **Apache AGE**：PostgreSQL + age 扩展（存图）
2. **pgvector**：PostgreSQL + pgvector 扩展（存向量种子）

### 环境变量

| 变量 | 说明 | 默认值 |
|------|------|--------|
| `OPENAI_API_KEY` | LLM + embedding Key | — |
| `MODEL_NAME` | 对话模型 | `deepseek-chat` |
| `EMBEDDING_MODEL` | embedding 模型 | `server:277357` |
| `EMBEDDING_DIMENSION` | 维度（不设则探测） | `0`（探测） |
| `AGE_HOST` / `AGE_PORT` / `AGE_USER` / `AGE_PASSWORD` / `AGE_DATABASE` | AGE 连接 | `127.0.0.1:5432/root/123/contextengine` |
| `AGE_GRAPH_NAME` | 图名 | `knowledge_graph` |
| `AGE_DSN` | 整 DSN（最高优先级） | — |
| `PGVECTOR_HOST` / `...` / `PGVECTOR_TABLE` | pgvector 连接 | `127.0.0.1:5432/root/123/contextengine/trpc_agent_go_graph` |
| `PGVECTOR_DSN` | 整 DSN | — |

### 命令行参数

| 参数 | 说明 | 默认值 |
|------|------|--------|
| `-recreate` | 是否重建图和向量表 | `false` |
| `-model` | 对话模型 | `MODEL_NAME` 或 `deepseek-chat` |
| `-embedding-model` | embedding 模型 | `server:277357` |
| `-embedding-dimension` | 维度（≤0 探测） | `EMBEDDING_DIMENSION` |
| `-query` | 启动后先问一个问题 | 空 |
| `-progress-step` | 加载进度步长 | `1000` |
| `-debug-file` | 工具调用 JSONL trace | 空 |

### 运行命令

```bash
cd examples/knowledge/features/graphrag
export OPENAI_API_KEY="sk-xxxx"
export MODEL_NAME="claude-4-5-sonnet-20250929"
export EMBEDDING_MODEL="server:277357"
export EMBEDDING_DIMENSION=1024
# AGE + pgvector 环境变量...

# 首次：建图建表 + 加载仓库
go run . -recreate=true

# 日常：复用已有数据进入 chat
go run . -recreate=false

# 带初始问题
go run . -recreate=false -query="Help me check the timeout propagation chain in trpc-go."
```

### 交互命令

进入 chat 后：

- 直接输入问题（推荐中文或英文均可）
- `/exit` 或 `/quit` 退出

### 预期输出

```
GraphRAG Chat Demo
Model: claude-4-5-sonnet-20250929
==================================================
Embedding: server:277357 (1024 dimensions)
Skipped graph source loading; using existing AGE graph and pgvector data

Chat ready. Session: graph-demo-session-1777467345
Type '/exit' to end the conversation.
==================================================

You: Help me check the timeout propagation chain in trpc-go.
Tool calls (2):
  [1] code_graph_search id=call_1
      args: {"query":"timeout propagation context deadline","filter":{...}}
  [2] code_graph_search id=call_2
      args: {"query":"WithTimeout SetTimeout timeout handling","filter":{...}}
Tool result: code_graph_search ...
  documents: 3
  [1] server.WithTimeout score=0.521
      file: trpc-go server/options.go:226-231
Tool calls:
  code_graph_traverse direction=out edge_types=[CALLS] max_depth=2
Tool result: ...
  nodes: 21
  edges: 21
Assistant: client.client.Invoke -> applies client timeout -> ...
```

## 适用场景与对比

**选 GraphRAG 当：**
- 代码问答需要追调用链 / 实现关系 / 依赖路径
- 普通 [`ast`](./knowledge-sources-ast.md) 检索答不了"机制 / 流程 / 架构"类问题
- 团队有 AGE + pgvector 运维能力

**对比其它代码 RAG：**

| 维度 | [`ast`](./knowledge-sources-ast.md) | GraphRAG |
|------|-------------------------------------|----------|
| 存储 | 向量库 | 向量库 + 图库 |
| 检索 | 语义相似 | 语义种子 + 图遍历 |
| 能回答 | "X 是什么" | "X 如何连接到 Y" |
| 部署复杂度 | 中 | 高（AGE + pgvector） |
| 加载耗时 | 中 | 高（要建边） |

**配套 [`code_context_engine`](./knowledge-features-code-context-engine.md) 的区别：**
后者把 code_search 通过 MCP 暴露给外部 Agent（如 Augment），是"对外服务化"；GraphRAG 是"对内增强检索能力"。

## 关键要点

1. **双存储**：AGE 存图（节点+边），pgvector 存向量种子。
2. **三工具协同**：search 找种子 → traverse 探邻居 → find_paths 找连接。
3. **指令是关键**：精心设计的 system prompt 教 LLM "必须 traverse"。
4. **`-recreate` 控制重建**：首次或大改时 true，日常 false。
5. **ToolSet 一次注册**：`NewCodeGraphSearchTool` 返回 ToolSet，含三个相关工具。

## 总结

GraphRAG 是代码 RAG 的"重武器"——用图建模代码关系，让 Agent 能回答调用链、实现关系、连接路径等结构化问题。部署门槛高（AGE + pgvector + 高并发加载），但效果是普通向量检索无法比拟的。配合 [`viewer`](./knowledge-features-graphrag-viewer.md) 可视化调试，配合 [`code_context_engine`](./knowledge-features-code-context-engine.md) 可把图检索能力服务化暴露给其它 Agent。
