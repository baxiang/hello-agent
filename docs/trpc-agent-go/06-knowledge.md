# Knowledge RAG 知识库详解

Knowledge 是 tRPC-Agent-Go 的 RAG（检索增强生成）系统，为 Agent 提供基于向量相似度的知识检索能力。

## 1. 系统架构

```
用户问题 → Query Enhancer（可选） → Embedder → VectorStore（检索）
                                                      ↓
                                                    Reranker（可选）
                                                      ↓
LLM ← 相关文档片段 ← Filter（可选） ← 检索结果
```

### 模块组成

| 模块 | 包路径 | 职责 |
|------|--------|------|
| **Knowledge** | `knowledge/` | 核心编排，管理加载、检索流程 |
| **Embedder** | `knowledge/embedder/` | 文本向量化 |
| **VectorStore** | `knowledge/vectorstore/` | 向量存储与相似度搜索 |
| **Source** | `knowledge/source/` | 知识源（文件/目录/URL） |
| **Reranker** | `knowledge/reranker/` | 结果重排序 |
| **Query Enhancer** | `knowledge/query/` | 查询重写与增强 |
| **Filter** | `knowledge/filter/` | 元数据过滤 |
| **Extractor** | `knowledge/extractor/` | 复杂格式提取（Docling） |
| **OCR** | `knowledge/ocr/` | 图像文字识别（Tesseract） |
| **Document Reader** | `knowledge/document/reader/` | 文档读取（txt/md/csv/json/docx/pdf） |

---

## 2. 完整使用流程

```go
import (
    "trpc.group/trpc-go/trpc-agent-go/knowledge"
    openaiembedder "trpc.group/trpc-go/trpc-agent-go/knowledge/embedder/openai"
    "trpc.group/trpc-go/trpc-agent-go/knowledge/source"
    dirsource "trpc.group/trpc-go/trpc-agent-go/knowledge/source/dir"
    filesource "trpc.group/trpc-go/trpc-agent-go/knowledge/source/file"
    urlsource "trpc.group/trpc-go/trpc-agent-go/knowledge/source/url"
    knowledgetool "trpc.group/trpc-go/trpc-agent-go/knowledge/tool"
    vectorinmemory "trpc.group/trpc-go/trpc-agent-go/knowledge/vectorstore/inmemory"
)

// 1. 创建 Embedder
embedder := openaiembedder.New(
    openaiembedder.WithModel("text-embedding-3-small"),
)

// 2. 创建 Vector Store
vectorStore := vectorinmemory.New()

// 3. 创建知识源
sources := []source.Source{
    filesource.New([]string{"./data/llm.md"}),
    dirsource.New([]string{"./docs"}),
    urlsource.New([]string{"https://example.com/doc.md"}),
}

// 4. 创建 Knowledge
kb := knowledge.New(
    knowledge.WithEmbedder(embedder),
    knowledge.WithVectorStore(vectorStore),
    knowledge.WithSources(sources),
    knowledge.WithEnableSourceSync(true), // 自动同步源变更
)

// 5. 加载文档
if err := kb.Load(ctx,
    knowledge.WithShowProgress(true),
    knowledge.WithProgressStepSize(10),
    knowledge.WithShowStats(true),
    knowledge.WithSourceConcurrency(4),   // 源级并发
    knowledge.WithDocConcurrency(64),     // 文档级并发
); err != nil {
    log.Fatal(err)
}

// 6. 创建搜索工具
searchTool := knowledgetool.NewKnowledgeSearchTool(kb,
    knowledgetool.WithToolName("knowledge_search"),
    knowledgetool.WithToolDescription("Search the knowledge base."),
    knowledgetool.WithMaxResults(10),
    knowledgetool.WithMinScore(0.5),
)

// 7. 集成到 Agent
agent := llmagent.New("knowledge-assistant",
    llmagent.WithModel(modelInstance),
    llmagent.WithTools([]tool.Tool{searchTool}),
)
```

---

## 3. Embedder 嵌入模型

| 平台 | 包 | 示例 |
|------|-----|------|
| OpenAI | `embedder/openai` | `text-embedding-3-small`, `text-embedding-3-large` |
| Gemini | `embedder/gemini` | `text-embedding-004` |
| Ollama | `embedder/ollama` | `nomic-embed-text`, `mxbai-embed-large` |
| HuggingFace | `embedder/huggingface` | 自部署 TEI 服务 |

```go
// 自定义 Embedder 配置
embedder := openaiembedder.New(
    openaiembedder.WithModel("text-embedding-3-large"),
    openaiembedder.WithDimensions(1024),       // 降维
    openaiembedder.WithBatchSize(100),         // 批量大小
)
```

---

## 4. VectorStore 向量存储

| 后端 | 场景 | 特点 |
|------|------|------|
| **In-Memory** | 开发/测试 | 零配置，进程重启丢失 |
| **PGVector** | 生产 | PostgreSQL 扩展，成熟稳定 |
| **TcVector** | 腾讯云 | 全托管向量数据库 |
| **Elasticsearch** | 已有 ES 集群 | 复用基础设施 |
| **Qdrant** | 高性能 | Rust 实现，过滤强大 |
| **Milvus** | 大规模 | 分布式向量数据库 |

```go
// PGVector 示例
import "trpc.group/trpc-go/trpc-agent-go/knowledge/vectorstore/pgvector"

vs, _ := pgvector.New(
    pgvector.WithHost("localhost"),
    pgvector.WithPort(5432),
    pgvector.WithUser("postgres"),
    pgvector.WithPassword("password"),
    pgvector.WithDatabase("knowledge"),
    pgvector.WithTable("embeddings"),
)
```

---

## 5. Source 知识源

### 5.1 File 源

```go
filesource.New([]string{
    "./data/doc.md",
    "./data/report.pdf",  // 需要导入 pdf reader
})
```

### 5.2 Directory 源

```go
dirsource.New(
    []string{"./docs"},
    dirsource.WithRecursive(true),
    dirsource.WithExtensions([]string{".md", ".txt", ".pdf"}),
)
```

### 5.3 URL 源

```go
urlsource.New(
    []string{"https://example.com/doc.md"},
    urlsource.WithTimeout(30*time.Second),
    urlsource.WithHeaders(map[string]string{"Authorization": "Bearer xxx"}),
)
```

### 5.4 自动检测

```go
import "trpc.group/trpc-go/trpc-agent-go/knowledge/source/auto"

sources := auto.New([]string{"./data", "https://example.com/doc.md"})
```

自动识别路径类型（文件/目录/URL）并创建对应 Source。

---

## 6. Reranker 重排序

| 后端 | 说明 |
|------|------|
| **TopK** | 简单取前 K 个，无重排 |
| **Cohere** | SaaS 服务，质量高 |
| **Infinity/TEI** | 自部署，标准 Rerank API |

```go
import "trpc.group/trpc-go/trpc-agent-go/knowledge/reranker/cohere"

reranker := cohere.New(
    cohere.WithAPIKey("your-cohere-api-key"),
    cohere.WithModel("rerank-english-v3.0"),
    cohere.WithTopN(5),
)

kb := knowledge.New(
    knowledge.WithEmbedder(embedder),
    knowledge.WithVectorStore(vectorStore),
    knowledge.WithReranker(reranker),
    knowledge.WithSources(sources),
)
```

---

## 7. Filter 过滤器

### 7.1 静态过滤

```go
searchTool := knowledgetool.NewKnowledgeSearchTool(kb,
    knowledgetool.WithFilter(map[string]any{
        "category": "technical",
        "language": "go",
    }),
)
```

### 7.2 复杂条件过滤

```go
import "trpc.group/trpc-go/trpc-agent-go/knowledge/filter"

searchTool := knowledgetool.NewKnowledgeSearchTool(kb,
    knowledgetool.WithConditionedFilter(
        filter.Or(
            filter.Eq("category", "technical"),
            filter.And(
                filter.Eq("language", "go"),
                filter.Gte("stars", 100),
            ),
        ),
    ),
)
```

### 7.3 智能过滤（AgenticFilterSearchTool）

让 Agent 根据用户查询自动构建过滤条件：

```go
// 自动从 sources 提取元数据
sourcesMetadata := source.GetAllMetadata(sources)

filterSearchTool := knowledgetool.NewAgenticFilterSearchTool(
    kb,
    sourcesMetadata,
    knowledgetool.WithToolName("knowledge_search_with_filter"),
    knowledgetool.WithMaxResults(10),
)
```

---

## 8. Query Enhancer 查询增强

```go
import "trpc.group/trpc-go/trpc-agent-go/knowledge/query"

// LLM 查询重写
enhancer := query.NewLLMEnhancer(queryModel)

kb := knowledge.New(
    knowledge.WithQueryEnhancer(enhancer),
    // ...
)
```

适合多轮对话场景，结合上下文改写用户查询。

---

## 9. 搜索工具

### KnowledgeSearchTool

```go
searchTool := knowledgetool.NewKnowledgeSearchTool(kb,
    knowledgetool.WithToolName("knowledge_search"),
    knowledgetool.WithToolDescription("Search for relevant information."),
    knowledgetool.WithMaxResults(10),       // 默认 10
    knowledgetool.WithMinScore(0.5),        // 默认 0.0（不过滤）
)
```

### 两种集成方式

**方式 1：手动添加工具（推荐）**

```go
agent := llmagent.New("assistant",
    llmagent.WithTools([]tool.Tool{searchTool}),
)
```

**方式 2：自动集成**

```go
agent := llmagent.New("assistant",
    llmagent.WithKnowledge(kb), // 自动注册 knowledge_search 工具
)
```

> 自动集成简单但不可自定义工具名、描述等参数，不支持多知识库。

---

## 10. 文档加载与内容提取

### 10.1 加载进度回调

```go
err := kb.Load(ctx,
    knowledge.WithLoadProgressCallback(func(ctx context.Context, evt knowledge.LoadProgressEvent) {
        if evt.Done {
            fmt.Printf("All done: %d docs, %s\n", evt.Total, evt.TotalElapsed)
            return
        }
        if evt.Err != nil {
            fmt.Printf("Source %s failed: %v\n", evt.SourceName, evt.Err)
            return
        }
        fmt.Printf("Source %s: %d/%d docs, ETA: %s\n",
            evt.SourceName, evt.SourceProcessed, evt.SourceTotal, evt.SourceETA)
    }),
)
```

### 10.2 复杂格式提取

```go
import "trpc.group/trpc-go/trpc-agent-go/knowledge/extractor/docling"

extractor := docling.New(
    docling.WithEndpoint("http://localhost:8000"),
)

kb := knowledge.New(
    knowledge.WithExtractor(extractor),
    // ...
)
```

Docling 可将 PDF、HTML、DOCX 等复杂格式转换为 Markdown/纯文本后再加载。

### 10.3 支持的文件格式

| 格式 | Reader | 需要额外导入 |
|------|--------|:---:|
| .txt | 内置 | — |
| .md | 内置 | — |
| .csv | 内置 | — |
| .json | 内置 | — |
| .docx | 内置 | — |
| .pdf | reader/pdf | ✅ |
| .html | extractor/docling | ✅ |

---

## 11. 知识库管理

启用 `WithEnableSourceSync(true)` 后，框架会智能同步向量存储数据与配置的 source 保持一致：

```go
kb := knowledge.New(
    knowledge.WithEnableSourceSync(true),
)

// 运行时添加/移除 source
kb.AddSource(ctx, newSource)
kb.RemoveSource(ctx, "old-source")

// 检查同步状态
status, _ := kb.GetSyncStatus(ctx)
```

---

## 12. 性能调优

```go
err := kb.Load(ctx,
    knowledge.WithSourceConcurrency(4),   // 源级并行（默认 2）
    knowledge.WithDocConcurrency(64),     // 文档级并行（默认 16）
)
```

> 提高并发会增加 Embedder API 调用频率，可能触发限流。根据吞吐、成本和限流平衡调整。

## 13. 评测对比

tRPC-Agent-Go 使用 [RAGAS](https://docs.ragas.io/) 框架与 LangChain、Agno、CrewAI 进行了 RAG 质量评测（数据集：HuggingFace 文档）。在 7 项标准 RAGAS 指标上，同等配置下各框架表现接近。
