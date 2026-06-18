# RAG 与 Embedding — trpc-agent-go 的检索增强基石

> trpc-agent-go 的 Knowledge 模块本质是一个 RAG 框架——不懂 Embedding / 向量库 / 重排，example 里的「检索增强」对你来说就是个黑盒：你不知道文档是怎么被切成块、怎么变成向量、又怎么被「按语义相似度」捞回来喂给 LLM 的。

## 核心概念

RAG（Retrieval-Augmented Generation，检索增强生成）的核心思路是：**在调用 LLM 之前，先从知识库里检索出与用户问题最相关的若干段文本，拼到 prompt 里作为上下文**，让模型基于这些事实作答，从而缓解幻觉、引入私有知识、降低 token 成本。整套流程可以拆成「入库」和「查询」两条流水线：

```
【入库 Ingest】
原始文档 ──► chunking（切块）──► Embedding（向量化）──► 写入 VectorStore
  PDF/MD/URL    按语义/字数拆    每块文本 → N 维 float64    存向量 + 原文 + metadata

【查询 Query】
用户问题 ──► Embedding（同一模型）──► VectorStore 相似度检索 ──► (可选) Rerank 精排
                                                                     │
                                                                     ▼
                                                            取 top-k → 拼进 prompt → 调 LLM
```

下面五个概念必须吃透：

1. **Embedding**：把一段文本映射成高维浮点向量（OpenAI `text-embedding-3-small` 是 1536 维，`embedder.go:52` 返回的就是 `[]float64`）。语义相近的文本，向量在空间中也彼此接近——「猫在睡觉」和「小猫打盹」的向量距离远小于「猫」和「汽车」。
2. **相似度（Similarity）**：衡量两个向量「有多接近」的标量，最常用的是**余弦相似度**（cosine）和**点积**（dot product）。VectorStore 的 `Search` 返回的 `Score`（`vectorstore.go:311`）就是这个值，范围 0.0~1.0，越大越相似。
3. **VectorStore**：专为「存向量 + 按相似度检索」优化的存储，常见实现有 pgvector（PostgreSQL 扩展）、Milvus、Qdrant、Elasticsearch。和普通数据库的区别是：查询条件不是一个 SQL 表达式，而是一个**向量**，DBMS 用 ANN（近似最近邻）算法在毫秒级从百万向量里捞出 top-k。
4. **chunking（切块）**：长文档不能整篇做 Embedding——既超过模型 token 上限，又稀释语义。需要切成小块（chunk），策略直接影响检索质量：**固定切块**（按字符数硬切，简单但可能切断句子）和**递归切块**（按段落 → 句子逐层降级切，语义更完整）是两种主流方案。
5. **Reranker（重排器）**：VectorStore 的 ANN 检索追求速度，召回偏粗——常用的是双塔模型，只算 query 和 doc 的向量距离。Reranker 用更重的 **cross-encoder** 把 `[query, doc]` 拼起来一起过模型，精度更高但慢，所以只在 VectorStore 召回的 50~100 条上做二次精排，再取最终 top-k。

一句话总结：**Embedding 负责「把文本变成可比的距离」，VectorStore 负责「在海量向量里快速找近邻」，chunking 决定「检索粒度」，Reranker 负责「把粗排打磨成精排」**。四者合起来就是 RAG。

## 在 trpc-agent-go 里

trpc-agent-go 把整套 RAG 流水线抽象成一组**可插拔接口**：`Embedder` 决定向量怎么来、`VectorStore` 决定向量存哪、chunking 由 Source 实现、Reranker 由独立组件实现。框架在 `knowledge` 包里把这些零件自动组装，业务代码只面对统一的上层 API。

### Embedder 接口

定义在 `knowledge/embedder/embedder.go:44`：

```go
// knowledge/embedder/embedder.go:44
type Embedder interface {
	// GetEmbedding generates an embedding vector for the given text.
	//
	// Returns:
	// - A slice of float64 values representing the embedding
	// - An error for system-level failures (prevents communication)
	//
	// The embedding slice may be empty for API-level errors.
	GetEmbedding(ctx context.Context, text string) ([]float64, error)

	// GetEmbeddingWithUsage generates an embedding vector for the given text
	// and returns usage information if available.
	GetEmbeddingWithUsage(ctx context.Context, text string) ([]float64, map[string]any, error)

	// GetDimensions returns the dimensionality of the embeddings produced by this embedder.
	// Returns 0 if dimensions are not known or configurable.
	GetDimensions() int
}
```

注意接口刻意做了**双层错误处理**（见 `embedder.go:17-43` 的注释）：`error` 表示系统级失败（网络、参数），而 API 级失败（限流、内容过滤）会返回**空 slice + nil error**，调用方必须同时检查 `err != nil` 和 `len(embedding) == 0`。`GetDimensions()` 用于让 VectorStore 在建索引时知道向量宽度（pgvector 的 `VECTOR(N)` 需要这个 N）。具体实现可以是 OpenAI、本地模型，只要实现这三个方法就能接入。

### VectorStore 接口

定义在 `knowledge/vectorstore/vectorstore.go:22`：

```go
// knowledge/vectorstore/vectorstore.go:22
type VectorStore interface {
	// Add stores a document with its embedding vector.
	Add(ctx context.Context, doc *document.Document, embedding []float64) error

	// Get retrieves a document by ID along with its embedding.
	Get(ctx context.Context, id string) (*document.Document, []float64, error)

	// Update modifies an existing document and its embedding.
	Update(ctx context.Context, doc *document.Document, embedding []float64) error

	// Delete removes a document and its embedding.
	Delete(ctx context.Context, id string) error

	// Search performs similarity search and returns the most similar documents.
	// Used for search tool
	Search(ctx context.Context, query *SearchQuery) (*SearchResult, error)

	// DeleteByFilter deletes documents by filter.
	DeleteByFilter(ctx context.Context, opts ...DeleteOption) error

	// UpdateByFilter updates documents matching the filter with the specified field values.
	UpdateByFilter(ctx context.Context, opts ...UpdateByFilterOption) (int64, error)

	// Count counts documents in the vector store.
	Count(ctx context.Context, opts ...CountOption) (int, error)

	// GetMetadata retrieves metadata from the vector store.
	GetMetadata(ctx context.Context, opts ...GetMetadataOption) (map[string]DocumentMetadata, error)

	// Close closes the vector store connection.
	Close() error
}
```

CRUD（`Add`/`Get`/`Update`/`Delete`）对应入库流水线，`Search` 对应查询流水线。关键看 `SearchQuery`（`vectorstore.go:254`）：除了必填的 `Vector`（查询向量）和 `Limit`（top-k），还带 `Filter`（按 metadata 预过滤）、`MinScore`（相似度阈值）、`SearchMode`（`SearchModeVector` / `SearchModeKeyword` / `SearchModeHybrid` / `SearchModeFilter`，见 `vectorstore.go:277-286`）。`SearchResult.Results` 是 `[]*ScoredDocument`，每个带 `Score` 字段（`vectorstore.go:306-312`）——这就是前面说的相似度分数。框架已经实现了 pgvector、Milvus、Elasticsearch、TCVector 等多种 backend，业务侧通过 functional option 切换即可。

### 流水线的自动组装

trpc-agent-go 的 Knowledge 模块在内部把 `Source（切块）→ Embedder（向量化）→ VectorStore（存储）→ Search（检索）→ Reranker（重排）` 串成完整 RAG 链路，业务代码只调一个高层 API，框架按依赖注入的方式自动调用每个接口。这也意味着：换 Embedding 模型不影响 VectorStore，换 VectorStore 不影响 chunking——这正是接口抽象的价值。

## 常见陷阱

### 陷阱 1：chunk 切得太大 → 召回不精，上下文浪费 token

❌ 把整篇文档按「每 4096 字符」切块入库。检索时一个 chunk 命中，塞给 LLM 的就是一大段，里面真正相关的话只有两句——既稀释了相似度信号（chunk 越大、Embedding 越像「平均脸」，召回越不准），又白白烧 token。

✅ 修复：chunk 大小通常 **256~1024 token**，并配合 overlap（块之间重叠 50~100 token）避免句子被切断。trpc-agent-go 提供了 `fixed-chunking` 和 `recursive-chunking` 两种 Source 实现，递归切块优先按段落/句子分，语义更完整，**生产环境默认选 recursive**。

### 陷阱 2：纯向量相似度、不加 Rerank → top-k 里混进无关项

❌ 直接拿 VectorStore 的 `Search` top-5 喂给 LLM，认为「分数高就是相关」。双塔 ANN 的召回是**粗排**：它只看 query 和 doc 的向量距离，常会把「字面不像但语义沾边」或「短 doc 占便宜」的结果排到前面，top-5 里可能混进 2~3 条无关内容。

✅ 修复：让 VectorStore 召回更多（比如 top-50），再用 **Reranker** 做精排取最终 top-5。trpc-agent-go 提供 `knowledge-reranker-cohere` 和 `knowledge-reranker-infinity` 两种重排器，cross-encoder 精度显著高于纯向量相似度。

```go
// ❌ 错误：直接信任粗排
result, _ := store.Search(ctx, &SearchQuery{Vector: q, Limit: 5})

// ✅ 正确：粗排召回多一些，再过 Reranker 精排
recall, _ := store.Search(ctx, &SearchQuery{Vector: q, Limit: 50})
topK := reranker.Rerank(ctx, query, recall.Results, 5)
```

### 陷阱 3：混淆 Embedding 模型和 LLM

❌ 以为「我用 GPT-4 做 Agent，所以检索也用 GPT-4 的向量」。**Embedding 模型和生成式 LLM 是两个完全独立的模型**：Embedding 模型（如 `text-embedding-3-small`、`bge-large`）只输出向量、不做对话；LLM（如 GPT-4）只生成文本、不输出向量。两者可以、也通常应该来自不同 provider。

✅ 修复：在 trpc-agent-go 里 `Embedder` 和 `LLM` 是分开配置的接口。换 LLM 不需要重新 Embedding 已入库的文档——**只要 Embedding 模型不变，向量空间就不变，VectorStore 里的数据可以复用**。反过来，一旦换了 Embedding 模型（维度变了），**全库必须重新向量化**，否则旧向量和新查询向量不在同一个空间，相似度毫无意义。

### 陷阱 4：不做 metadata 预过滤 → 在全库里做向量检索

❌ 用户问「2024 年 Q3 的销售数据」，你直接拿问题 Embedding 在**全公司所有文档**里做相似度检索，结果 top-k 里混进了 2022 年的财报——向量上确实「语义相似」，但时间维度根本不对。

✅ 修复：先用 `SearchQuery.Filter` 按 metadata 缩小范围，再做向量检索。trpc-agent-go 的 `SearchFilter`（`vectorstore.go:289`）支持按 `Metadata` key-value 过滤，`SearchMode`（`vectorstore.go:277`）里甚至有专门的 `SearchModeFilter`。**先用结构化字段（时间、部门、文档类型）圈定候选集，再让向量相似度在这个小集合里排序**，精度和性能都大幅提升。

```go
// ❌ 错误：全库向量检索
result, _ := store.Search(ctx, &SearchQuery{
    Vector: q, Limit: 5,
})

// ✅ 正确：先按 metadata 过滤再向量检索
result, _ := store.Search(ctx, &SearchQuery{
    Vector: q, Limit: 5,
    Filter: &SearchFilter{
        Metadata: map[string]any{
            "year":   2024,
            "quarter": "Q3",
            "type":   "finance",
        },
    },
})
```

## 小结

- RAG = **chunking 切块 → Embedding 向量化 → VectorStore 存储/检索 → (可选) Rerank 精排 → 拼 prompt 喂 LLM**，每一步都有独立的理论和工程取舍。
- trpc-agent-go 把这条流水线拆成可插拔接口：`Embedder`（`embedder.go:44`）负责向量化、`VectorStore`（`vectorstore.go:22`）负责存检，框架自动组装，业务侧只配置不写胶水。
- 工程上要避开四个坑：**chunk 别太大、粗排后要精排、Embedding 模型 ≠ LLM、检索前先用 metadata 过滤**。
- Embedding 接口的双层错误处理（`error` + 空 slice）是 trpc-agent-go 的特殊约定，调用时两个都要判。

**延伸阅读：**

- [知识检索 RAG](../examples/12-knowledge-rag/knowledge.md)
- [OpenAI Embedding 文档](https://platform.openai.com/docs/guides/embeddings)
- [Tool Calling 工作机制](./08-tool-calling)
