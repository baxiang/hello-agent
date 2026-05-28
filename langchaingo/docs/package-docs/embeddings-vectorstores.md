# 向量存储与嵌入详解

LangChainGo 提供了完整的向量存储和文本嵌入系统，包括嵌入生成、向量存储、文档加载和文本分割四大模块，构成 RAG 应用的基础设施。

---

## 1. Embedder 接口

`embeddings.Embedder` 是嵌入生成的核心接口，定义于 `embeddings/embedding.go:27`：

```go
type Embedder interface {
    EmbedDocuments(ctx context.Context, texts []string) ([][]float32, error)
    EmbedQuery(ctx context.Context, text string) ([]float32, error)
}
```

### EmbedderClient 接口

底层客户端接口（`embeddings/embedding.go:35`）：

```go
type EmbedderClient interface {
    CreateEmbedding(ctx context.Context, texts []string) ([][]float32, error)
}
```

### EmbedderClientFunc 适配器

`embeddings/embedding.go:42` 提供了函数适配器：

```go
type EmbedderClientFunc func(ctx context.Context, texts []string) ([][]float32, error)

embedder, _ := embeddings.NewEmbedder(embeddings.EmbedderClientFunc(
    func(ctx context.Context, texts []string) ([][]float32, error) {
        return nil, nil
    },
))
```

### EmbedderImpl 实现

`embeddings/embedding.go:48` 提供了标准实现：

```go
type EmbedderImpl struct {
    client        EmbedderClient
    StripNewLines bool  // 是否去除换行符（默认 true）
    BatchSize     int   // 批处理大小（默认 512）
}
```

- **EmbedQuery**（`embeddings/embedding.go:56`）：去除换行 -> 调用 CreateEmbedding -> 返回首个向量
- **EmbedDocuments**（`embeddings/embedding.go:70`）：去除换行 -> BatchedEmbed 分批处理
- **BatchedEmbed**（`embeddings/embedding.go:100`）：按 BatchSize 分批调用 CreateEmbedding

### 配置选项（`embeddings/options.go`）

| 选项 | 默认值 | 说明 |
|------|--------|------|
| `WithStripNewLines` | `true` | 是否去除换行符 |
| `WithBatchSize` | `512` | 批处理大小 |

### 向量数学工具（`embeddings/vector_math.go`）

- `CombineVectors`（`:17`）：加权平均合并多个向量并归一化
- `getAverage`（`:34`）：计算加权平均
- `getNorm`（`:76`）：计算向量范数

---

## 2. Embedding 实现

langchaingo 提供了多种嵌入模型的后端实现：

| 实现包 | 路径 | 说明 |
|--------|------|------|
| OpenAI | `llms/openai/` | OpenAI Embedding API |
| Ollama | `llms/ollama/` | 本地 Ollama 嵌入模型 |
| HuggingFace | `embeddings/huggingface/` | HuggingFace Inference API |
| Jina | `embeddings/jina/` | Jina Embeddings API |
| VoyageAI | `embeddings/voyageai/` | Voyage AI 嵌入 API |
| Cybertron | `embeddings/cybertron/` | Cybertron 本地嵌入 |
| Bedrock | `embeddings/bedrock/` | AWS Bedrock 嵌入服务 |

使用示例：

```go
llm, _ := ollama.New(ollama.WithModel("nomic-embed-text"))
embedder, _ := embeddings.NewEmbedder(llm)
docVectors, _ := embedder.EmbedDocuments(ctx, []string{"文档1", "文档2"})
queryVector, _ := embedder.EmbedQuery(ctx, "搜索查询")
```

---

## 3. VectorStore 接口

`vectorstores.VectorStore` 定义于 `vectorstores/vectorstores.go:12`：

```go
type VectorStore interface {
    AddDocuments(ctx context.Context, docs []schema.Document, options ...Option) ([]string, error)
    SimilaritySearch(ctx context.Context, query string, numDocuments int, options ...Option) ([]schema.Document, error)
}
```

### Document 结构（`schema/documents.go:4`）

```go
type Document struct {
    PageContent string
    Metadata    map[string]any
    Score       float32
}
```

### Retriever 适配器（`vectorstores/vectorstores.go:18`）

```go
type Retriever struct {
    CallbacksHandler callbacks.Handler
    v                VectorStore
    numDocs          int
    options          []Option
}
```

`GetRelevantDocuments`（`:28`）在搜索前后触发回调，`ToRetriever`（`:47`）创建适配器：

```go
retriever := vectorstores.ToRetriever(store, 5)
```

### 配置选项（`vectorstores/options.go:14`）

| 选项 | 行号 | 说明 |
|------|------|------|
| `WithNameSpace` | `:23` | 命名空间，多租户隔离 |
| `WithScoreThreshold` | `:29` | 相似度阈值 |
| `WithFilters` | `:39` | 元数据过滤器 |
| `WithEmbedder` | `:48` | 覆盖默认嵌入器 |
| `WithDeduplicater` | `:57` | 去重函数 |

---

## 4. VectorStore 实现

| 实现包 | 路径 | 说明 |
|--------|------|------|
| Chroma | `vectorstores/chroma/` | 开源向量数据库 |
| Pinecone | `vectorstores/pinecone/` | 托管向量数据库 |
| Redis | `vectorstores/redisvector/` | Redis 向量存储 |
| PGVector | `vectorstores/pgvector/` | PostgreSQL + pgvector |
| Qdrant | `vectorstores/qdrant/` | 高性能开源向量数据库 |
| Weaviate | `vectorstores/weaviate/` | 语义搜索引擎 |
| Milvus | `vectorstores/milvus/` | 云原生向量数据库 |
| OpenSearch | `vectorstores/opensearch/` | Amazon OpenSearch |
| MariaDB | `vectorstores/mariadb/` | MariaDB 向量存储 |
| AlloyDB | `vectorstores/alloydb/` | Google AlloyDB |
| CloudSQL | `vectorstores/cloudsql/` | Google CloudSQL |
| Azure AI Search | `vectorstores/azureaisearch/` | Azure AI 搜索 |
| Mongo Vector | `vectorstores/mongovector/` | MongoDB Atlas 向量搜索 |

使用示例：

```go
store, _ := chroma.New(
    chroma.WithChromaURL("http://localhost:8000"),
    chroma.WithEmbedder(embedder),
)
ids, _ := store.AddDocuments(ctx, []schema.Document{
    {PageContent: "Go 是静态类型语言", Metadata: map[string]any{"topic": "prog"}},
})
docs, _ := store.SimilaritySearch(ctx, "静态类型", 2,
    vectorstores.WithScoreThreshold(0.7),
)
```

---

## 5. DocumentLoader

`documentloaders.Loader` 定义于 `documentloaders/documentloaders.go:11`：

```go
type Loader interface {
    Load(ctx context.Context) ([]schema.Document, error)
    LoadAndSplit(ctx context.Context, splitter textsplitter.TextSplitter) ([]schema.Document, error)
}
```

| 实现 | 文件 | 输入源 | 说明 |
|------|------|--------|------|
| Text | `documentloaders/text.go:13` | `io.Reader` | 纯文本 |
| CSV | `documentloaders/csv.go` | `io.Reader` | CSV 格式 |
| HTML | `documentloaders/html.go` | `io.Reader` | HTML 格式 |
| PDF | `documentloaders/pdf.go` | `io.Reader` | PDF 格式 |
| Notion | `documentloaders/notion.go` | 文件路径 | Notion 导出 |
| Directory | `documentloaders/directory.go` | 目录路径 | 目录遍历 |
| AssemblyAI | `documentloaders/assemblyai.go` | 音频 URL | 音频转录 |

Text Loader 示例：

```go
loader := documentloaders.NewText(strings.NewReader("文本内容"))
splitter := textsplitter.NewRecursiveCharacter(
    textsplitter.WithChunkSize(500),
    textsplitter.WithChunkOverlap(50),
)
docs, _ := loader.LoadAndSplit(ctx, splitter)
```

---

## 6. TextSplitter

`textsplitter.TextSplitter` 定义于 `textsplitter/text_spliter.go:4`：

```go
type TextSplitter interface {
    SplitText(text string) ([]string, error)
}
```

### 6.1 RecursiveCharacter（`textsplitter/recursive_character.go:9`）

按分隔符递归分割，默认分隔符为 `["\n\n", "\n", " ", ""]`，默认 ChunkSize=4000，ChunkOverlap=200。

`SplitText`（`:38`）递归执行：找到合适的分隔符 -> 分割 -> 短片段合并，长片段用下级分隔符递归 -> mergeSplits 合并。

### 6.2 MarkdownTextSplitter（`textsplitter/markdown_splitter.go:52`）

语义感知的 Markdown 分割，解析 AST 按标题、段落、引用、列表、代码块、表格分别处理。

关键选项：`CodeBlocks`（包含代码块）、`HeadingHierarchy`（保留标题层级）、`JoinTableRows`（合并表格行）。

### 6.3 TokenSplitter（`textsplitter/token_splitter.go:18`）

基于 Token 数量分割，使用 tiktoken 库。默认 ChunkSize=512，ChunkOverlap=100，模型 `gpt-3.5-turbo`。

### 配置选项（`textsplitter/options.go`）

| 选项 | 行号 | 默认值 | 说明 |
|------|------|--------|------|
| `WithChunkSize` | `:45` | 4000/512 | 块大小 |
| `WithChunkOverlap` | `:52` | 200/100 | 重叠大小 |
| `WithSeparators` | `:59` | `["\n\n","\n"," ",""]` | 分隔符 |
| `WithLenFunc` | `:66` | `utf8.RuneCountInString` | 长度函数 |
| `WithCodeBlocks` | `:109` | `false` | 渲染代码块 |
| `WithHeadingHierarchy` | `:144` | `false` | 保留标题层级 |

### SplitDocuments（`textsplitter/split_documents.go:17`）

将 `[]schema.Document` 逐个分割后重新包装为 `schema.Document`，复制元数据。

### RAG 完整流程

```go
// 1. 加载 -> 2. 分割 -> 3. 嵌入 -> 4. 存储 -> 5. 检索
loader := documentloaders.NewText(reader)
splitter := textsplitter.NewRecursiveCharacter(
    textsplitter.WithChunkSize(1000),
    textsplitter.WithChunkOverlap(200),
)
docs, _ := loader.LoadAndSplit(ctx, splitter)

llm, _ := ollama.New(ollama.WithModel("nomic-embed-text"))
embedder, _ := embeddings.NewEmbedder(llm)

store, _ := chroma.New(
    chroma.WithChromaURL("http://localhost:8000"),
    chroma.WithEmbedder(embedder),
)
store.AddDocuments(ctx, docs)

retriever := vectorstores.ToRetriever(store, 5)
results, _ := retriever.GetRelevantDocuments(ctx, "查询内容")
```

---

## 模块间协作关系

```
DocumentLoader --> TextSplitter --> Embedder --> VectorStore
                                              |
                                    SimilaritySearch
                                              |
                                          Retriever --> Chain --> LLM
```

1. **DocumentLoader** 加载原始文档
2. **TextSplitter** 将长文档分割为合适大小的块
3. **Embedder** 为每个块生成向量嵌入
4. **VectorStore** 存储文档及其嵌入向量
5. **SimilaritySearch** 根据查询向量找到最相似的文档
6. **Retriever** 将 VectorStore 适配为 Chain 可用的接口
7. **Chain** 将检索结果与 LLM 结合，生成最终回答

每个模块都可通过 `Option` 模式灵活配置，且各向量数据库实现共享统一的 `VectorStore` 接口，便于切换。
