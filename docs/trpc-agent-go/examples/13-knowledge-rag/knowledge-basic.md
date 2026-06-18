# 基础 RAG 示例 - 文件 + 目录源 + 内存向量库的入门 Knowledge Chat

> **源码路径**：[`trpc-agent-go/examples/knowledge/basic/`](../../../../trpc-agent-go/examples/knowledge/basic)
> **示例类型**：基础 RAG · **难度**：入门

## 概述

`basic/` 是 Knowledge RAG 系列的"Hello World"：把一份 Markdown 文件 + 一个目录加载进内存向量库，封装成 `knowledge_search` 工具交给 LLM Agent，由模型自主决定何时检索、何时回答。没有元数据过滤、没有重排序、没有查询增强，只有最纯粹的 RAG 主干——因此它是理解所有其它子示例的前置条件。

与同系列其它示例的差别：

| 维度 | basic | [`query-enhancer`](./knowledge-query-enhancer.md) | [`features/management`](./knowledge-features-management.md) |
|------|-------|------|------|
| 数据源 | file + dir（静态） | file（静态） | 动态增删改 |
| 向量库 | 可切换 `-vectorstore` | 可切换 | 默认 `pgvector` |
| 工具 | `knowledge_search` | `knowledge_search` + 内嵌 enhancer | 直接调 `kb.Search()` |
| 用途 | 最小可运行 RAG | 多轮代词消解 | 运行时变更知识 |

## 核心概念

### RAG 五步主干

basic 示例把 RAG 管线压缩成五步，所有其它示例都是在这五步上做加法：

```go
// 1. 创建数据源（file + dir）
fileSrc := file.New([]string{util.ExampleDataPath("file/llm.md")})
dirSrc  := dir.New([]string{util.ExampleDataPath("dir/")})

// 2. 创建向量库（默认 inmemory，可 -vectorstore 切换）
vs, _ := util.NewVectorStoreByType(storeType)

// 3. 创建 embedder（OpenAI）
emb := openai.New()

// 4. 组装 Knowledge Base 并 Load
kb := knowledge.New(
    knowledge.WithVectorStore(vs),
    knowledge.WithEmbedder(emb),
    knowledge.WithSources([]source.Source{fileSrc, dirSrc}),
)
kb.Load(ctx, loadOpts...)

// 5. 把 KB 包成工具交给 Agent
searchTool := knowledgetool.NewKnowledgeSearchTool(kb, knowledgetool.WithMaxResults(3))
agent := llmagent.New("basic-assistant",
    llmagent.WithModel(openaimodel.New(modelName)),
    llmagent.WithTools([]tool.Tool{searchTool}),
)
```

### 共享工具 `util.NewVectorStoreByType`

所有 Knowledge 子示例都通过 [`examples/knowledge/util.go`](../../../../trpc-agent-go/examples/knowledge/util.go) 的 `NewVectorStoreByType` 按字符串切换后端，避免每个示例重复写一遍后端构造逻辑：

```go
// util.go:54
func NewVectorStoreByType(storeType VectorStoreType) (vectorstore.VectorStore, error) {
    switch storeType {
    case VectorStorePGVector:      return newPGVectorStore(0)
    case VectorStoreSQLiteVec:     return newSQLiteVecStore()
    case VectorStoreTCVector:      return newTCVectorStore()
    case VectorStoreElasticsearch: return newElasticsearchStore()
    case VectorStoreMilvus:        return newMilvusStore()
    case VectorStoreInMemory: fallthrough
    default:                       return inmemory.New(), nil
    }
}
```

后端选择通过 `-vectorstore` flag 控制，默认 `inmemory`。

### 加载进度回调

basic 默认启用一个"多行原地刷新"的进度条（`prettyProgress=true`），通过 `knowledge.WithLoadProgressCallback` 注入回调，每个 source 一行：

```go
loadOpts = append(loadOpts,
    knowledge.WithShowProgress(false),
    knowledge.WithShowStats(false),
    knowledge.WithLoadProgressCallback(pp.onProgress),
)
```

关掉用 `-pretty-progress=false`，此时回退到框架内置日志进度（`WithShowProgress(true)`）。

## 代码解析

### 整体流程（`basic/main.go`）

`main()` 一条直线走完五步，然后调用 `r.Run()` 把用户 query 喂给 Runner，再消费事件流：

```go
eventChan, err := r.Run(ctx, "user", "session-1", model.NewUserMessage(*query))
for evt := range eventChan {
    util.PrintEventWithToolCalls(evt)          // 打印工具调用/响应
    if choice := evt.Response.Choices[0]; choice.Delta.Content != "" {
        fullResponse.WriteString(choice.Delta.Content)  // 收集流式输出
    }
    if evt.IsFinalResponse() { /* 打印最终答案 */ }
}
```

`util.PrintEventWithToolCalls`（在 `util.go:186`）会渲染 `🔧 Tool Calls`、`📦 Tool Response` 以及检索到的 `Documents` 列表（含 score、dense/sparse 分数、metadata），是调试所有 Knowledge 示例的通用可视化工具。

### 默认查询

```go
var defaultQuery = "What are Large Language Models and how do they work?"
```

可以用 `-query` 覆盖，例如 `-query "What is a Large Language Model?"`。示例数据是 `exampledata/file/llm.md`（LLM 科普）+ `exampledata/dir/`（多个文档）。

### 索引刷新等待

切换到 Elasticsearch / Milvus 等需要后台刷新索引的后端时，加载后必须等待：

```go
// util.go:176
func WaitForIndexRefresh(storeType VectorStoreType) {
    if storeType == VectorStoreElasticsearch { time.Sleep(30 * time.Second) }
    if storeType == VectorStoreMilvus        { time.Sleep(5 * time.Second) }
}
```

`inmemory` / `sqlitevec` / `pgvector` 同步可见，无需等待。

## 运行方式

### 环境变量

| 变量 | 必需 | 说明 | 默认值 |
|------|------|------|--------|
| `OPENAI_API_KEY` | 是 | LLM 与 embedding 的 API Key | — |
| `OPENAI_BASE_URL` | 否 | OpenAI 兼容端点 | `https://api.openai.com/v1` |
| `MODEL_NAME` | 否 | 对话模型 | `deepseek-v4-flash` |

切换非 inmemory 后端还需对应变量，见下表。

### 命令行参数

| 参数 | 说明 | 默认值 |
|------|------|--------|
| `-vectorstore` | `inmemory` \| `sqlitevec` \| `pgvector` \| `tcvector` \| `elasticsearch` \| `milvus` | `inmemory` |
| `-query` | 一次性查询问题 | `What are Large Language Models and how do they work?` |
| `-show-progress` | 框架内置日志进度 | `false` |
| `-pretty-progress` | 多行原地刷新进度条（覆盖上一项） | `true` |

### 运行命令

```bash
cd examples/knowledge/basic
export OPENAI_API_KEY="sk-xxxx"

go run main.go                                # 默认 inmemory + 默认 query
go run main.go -query "What are transformers?"
go run main.go -vectorstore sqlitevec         # 切 SQLite 向量后端
go run main.go -vectorstore pgvector          # 切 PostgreSQL（需额外 PGVECTOR_*）
go run main.go -pretty-progress=false         # 用框架内置进度日志
```

### 各后端额外变量

| 后端 | 关键环境变量 |
|------|-------------|
| `sqlitevec` | `SQLITEVEC_DSN`、`SQLITEVEC_TABLE`、`SQLITEVEC_METADATA_TABLE` |
| `pgvector` | `PGVECTOR_HOST`、`PGVECTOR_PORT`、`PGVECTOR_USER`、`PGVECTOR_PASSWORD`、`PGVECTOR_DATABASE`、`PGVECTOR_TABLE` |
| `tcvector` | `TCVECTOR_URL`、`TCVECTOR_USERNAME`、`TCVECTOR_PASSWORD`、`TCVECTOR_COLLECTION` |
| `elasticsearch` | `ELASTICSEARCH_HOSTS`、`ELASTICSEARCH_USERNAME`、`ELASTICSEARCH_PASSWORD`、`ELASTICSEARCH_INDEX_NAME`、`ELASTICSEARCH_VERSION` |
| `milvus` | `MILVUS_ADDRESS`、`MILVUS_USERNAME`、`MILVUS_PASSWORD`、`MILVUS_DB_NAME`、`MILVUS_COLLECTION` |

后端细节对比详见各 [`vectorstores/*`](./knowledge-vectorstores-postgres.md) 文档。

### 预期输出

```
🧠 Basic Knowledge Chat Demo
Model: deepseek-v4-flash
==================================================
Vector Store: inmemory
  LLM Docs  [####################] 100%  23/23  done
  total: 28 docs  elapsed: 1.2s

💬 Query: What are Large Language Models and how do they work?
==================================================

🔧 Tool Calls:
  - ID: call_abc123
    Function: knowledge_search
    Arguments: {"query":"Large Language Models how they work"}
📦 Tool Response:
  Documents:
  #1 score=0.521
    text: A Large Language Model (LLM) is a neural network trained on...
    meta: source_name=LLM Docs, ...

🤖 Final Answer:
Large Language Models are neural networks trained on massive text corpora...

✅ Done!
```

## 适用场景与对比

**选 basic 当：**
- 第一次接触 trpc-agent-go RAG，需要最小可运行示例
- 想验证 LLM + embedding + 向量库整条链路是否打通
- 后续要在此基础上加 enhancer / reranker / filter，先把骨架跑通

**升级路径：**
- 多轮对话有代词 → [`query-enhancer`](./knowledge-query-enhancer.md)
- 检索质量不够 → [`reranker/cohere`](./knowledge-reranker-cohere.md) 或 [`reranker/infinity`](./knowledge-reranker-infinity.md)
- 想按元数据筛 → [`features/agentic-filter`](./knowledge-features-agentic-filter.md) 或 [`features/metadata-filter`](./knowledge-features-metadata-filter.md)
- 想运行时增删数据源 → [`features/management`](./knowledge-features-management.md)
- 数据要持久化 → [`vectorstores/postgres`](./knowledge-vectorstores-postgres.md) 等

## 关键要点

1. **五步主干**：Source → VectorStore → Embedder → Knowledge.Load → KnowledgeSearchTool 是所有 Knowledge 示例的公共骨架。
2. **统一后端切换**：`util.NewVectorStoreByType` + `-vectorstore` flag 让任何示例都能一行切换 6 种后端。
3. **Agent 自主检索**：知识库以 `knowledge_search` 工具形式暴露给 LLM，模型根据 query 自行决定是否调用、调用几次。
4. **事件流调试**：`util.PrintEventWithToolCalls` 是观察检索过程的通用工具。
5. **进度可观测**：`WithLoadProgressCallback` 让大文件加载有可视化进度。

## 总结

basic 示例的 168 行代码刻画了 trpc-agent-go RAG 的完整骨架：**数据源 → 向量化 → 工具封装 → Agent 调用**。其它 23 个子示例都在这个骨架的某个环节做替换或增强——换数据源（[`sources/`](./knowledge-sources-file.md)）、换后端（[`vectorstores/`](./knowledge-vectorstores-postgres.md)）、加查询改写（[`query-enhancer`](./knowledge-query-enhancer.md)）、加重排（[`reranker/`](./knowledge-reranker-cohere.md)）、加过滤（[`features/`](./knowledge-features-agentic-filter.md)）。先读懂 basic，再按需扩展。
