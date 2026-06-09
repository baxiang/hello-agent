# Knowledge RAG — 源码·实战·原理

Knowledge 提供检索增强生成（RAG）能力。本文深入文档加载流程、Embedder 调用链路、以及端到端的问答实战。

## 1. 概念概述

### 1.1 RAG 流水线

```
[知识源] → [Extractor(可选)] → [Reader] → [Splitter] → [Embedder] → [VectorStore]
                                                                          │
[用户问题] → [QueryEnhancer(可选)] → [Embedder] → [VectorStore.Search]   │
                                                      │                  │
                                                      ▼                  │
                                                    [Reranker(可选)]     │
                                                      │                  │
                                                      ▼                  ▼
[LLM] ← [Filter(可选)] ← ─ ─ ─ ─ ─ ─ ─ ─ ─[检索结果 + 相关文档]─────────┘
```

### 1.2 核心接口

```go
// knowledge/knowledge.go
type Knowledge interface {
    Load(ctx context.Context, opts ...LoadOption) error
    Search(ctx context.Context, query string, opts ...SearchOption) ([]*SearchResult, error)
    AddSource(ctx context.Context, src source.Source) error
    RemoveSource(ctx context.Context, name string) error
    Close() error
}

type SearchResult struct {
    Document *document.Document
    Score    float64  // 0.0 - 1.0
}
```

---

## 2. 源码走读：Load 流程

```go
func (k *Knowledge) Load(ctx context.Context, opts ...LoadOption) error {
    // ═══ 阶段 1：解析 Source → Documents ═══
    // 每个 Source 并发读取
    var docCh = make(chan *document.Document, k.docConcurrency)
    var wg sync.WaitGroup

    for _, src := range k.sources {
        wg.Add(1)
        go func(s source.Source) {
            defer wg.Done()
            // 1.1 读取原始内容
            reader, _ := s.Read(ctx)
            // 1.2 Extractor 处理（如 PDF → Markdown）
            if k.extractor != nil {
                reader = k.extractor.Extract(ctx, reader)
            }
            // 1.3 Reader 分割文档
            chunks, _ := k.splitter.Split(reader)
            // 1.4 发送到下游
            for _, chunk := range chunks {
                docCh <- chunk
            }
        }(src)
    }

    // 等待读取完成，关闭 doc channel
    go func() { wg.Wait(); close(docCh) }()

    // ═══ 阶段 2：Embed + Store ═══
    var embedWg sync.WaitGroup
    for i := 0; i < k.docConcurrency; i++ {
        embedWg.Add(1)
        go func() {
            defer embedWg.Done()
            for doc := range docCh {
                // 2.1 Embedding
                embedding, _ := k.embedder.Embed(ctx, doc.Content)
                // 2.2 存入 VectorStore
                k.vectorStore.Add(ctx, doc, embedding)
            }
        }()
    }
    embedWg.Wait()
    return nil
}
```

**双并发池设计**：
- Source 级并发（`WithSourceConcurrency(4)`）：解析文档
- Doc 级并发（`WithDocConcurrency(64)`）：Embedding + 存储

两者通过 `docCh` channel 连接，形成生产者-消费者模式。

---

## 3. 实战：端到端 RAG 问答

### 3.1 完整搭建

```go
package main

import (
    "trpc.group/trpc-go/trpc-agent-go/knowledge"
    openaiembedder "trpc.group/trpc-go/trpc-agent-go/knowledge/embedder/openai"
    "trpc.group/trpc-go/trpc-agent-go/knowledge/source/file"
    "trpc.group/trpc-go/trpc-agent-go/knowledge/source/dir"
    "trpc.group/trpc-go/trpc-agent-go/knowledge/source/url"
    knowledgetool "trpc.group/trpc-go/trpc-agent-go/knowledge/tool"
    "trpc.group/trpc-go/trpc-agent-go/knowledge/vectorstore/inmemory"
)

func main() {
    // 1. Embedder
    embedder := openaiembedder.New(
        openaiembedder.WithModel("text-embedding-3-small"),
    )

    // 2. VectorStore
    vs := inmemory.New()

    // 3. Sources（支持多种格式）
    sources := []source.Source{
        file.New([]string{"./docs/api-reference.md"}),
        dir.New([]string{"./wiki"},
            dir.WithRecursive(true),
            dir.WithExtensions([]string{".md", ".txt"}),
        ),
        url.New([]string{"https://example.com/changelog.md"},
            url.WithTimeout(30*time.Second),
        ),
    }

    // 4. 创建 Knowledge
    kb := knowledge.New(
        knowledge.WithEmbedder(embedder),
        knowledge.WithVectorStore(vs),
        knowledge.WithSources(sources),
        knowledge.WithEnableSourceSync(true),
    )

    // 5. 加载文档
    if err := kb.Load(ctx,
        knowledge.WithShowProgress(true),
        knowledge.WithSourceConcurrency(4),
        knowledge.WithDocConcurrency(64),
        knowledge.WithLoadProgressCallback(progressCallback),
    ); err != nil {
        log.Fatal(err)
    }

    // 6. 创建搜索工具
    searchTool := knowledgetool.NewKnowledgeSearchTool(kb,
        knowledgetool.WithToolName("search_docs"),
        knowledgetool.WithToolDescription(
            "Search internal documentation. Use for questions about our API, architecture, or policies.",
        ),
        knowledgetool.WithMaxResults(5),
        knowledgetool.WithMinScore(0.6),
    )

    // 7. 集成到 Agent
    agent := llmagent.New("docs-assistant",
        llmagent.WithModel(model),
        llmagent.WithTools([]tool.Tool{searchTool}),
        llmagent.WithInstruction(
            "You are a documentation assistant. Always search internal docs "+
            "before answering. Cite sources when possible.",
        ),
    )

    // 8. 运行
    r := runner.NewRunner("docs-bot", agent)
    defer r.Close()
    events, _ := r.Run(ctx, "user-1", "session-1",
        model.NewUserMessage("What is the authentication flow?"),
    )
}

func progressCallback(ctx context.Context, evt knowledge.LoadProgressEvent) {
    if evt.Done {
        fmt.Printf("\n✅ Loaded %d documents in %s\n", evt.Total, evt.TotalElapsed)
        return
    }
    if evt.Err != nil {
        fmt.Printf("\n❌ %s failed: %v\n", evt.SourceName, evt.Err)
        return
    }
    fmt.Printf("\r📄 %s: %d/%d docs, ETA: %s",
        evt.SourceName, evt.SourceProcessed, evt.SourceTotal, evt.SourceETA)
}
```

### 3.2 多知识库 + 智能过滤

```go
// 知识库 1：技术文档
techKB := knowledge.New(knowledge.WithEmbedder(embedder), ...)
techTool := knowledgetool.NewKnowledgeSearchTool(techKB,
    knowledgetool.WithToolName("search_tech_docs"),
    knowledgetool.WithFilter(map[string]any{"category": "technical"}),
)

// 知识库 2：产品文档
productKB := knowledge.New(knowledge.WithEmbedder(embedder2), ...)
productTool := knowledgetool.NewKnowledgeSearchTool(productKB,
    knowledgetool.WithToolName("search_product_docs"),
)

// Agent 拥有两个独立的搜索工具
agent := llmagent.New("assistant",
    llmagent.WithTools([]tool.Tool{techTool, productTool}),
)
```

### 3.3 带 Reranker 的精准检索

```go
import "trpc.group/trpc-go/trpc-agent-go/knowledge/reranker/cohere"

reranker := cohere.New(
    cohere.WithAPIKey(os.Getenv("COHERE_API_KEY")),
    cohere.WithModel("rerank-english-v3.0"),
    cohere.WithTopN(3),  // 从 VectorStore 返回的 10 个候选中取 Top 3
)

kb := knowledge.New(
    knowledge.WithEmbedder(embedder),
    knowledge.WithVectorStore(vs),
    knowledge.WithReranker(reranker),
)
```

**Reranker 的成本-收益**：
- VectorStore 召回 10 个候选（Embedding 相似度）
- Reranker 重排序 10 个 → 返回 Top 3（语义相关性）
- 前 3 个结果的质量显著提升（尤其对长文档）

### 3.4 Query Enhancer 多轮改写

```go
import "trpc.group/trpc-go/trpc-agent-go/knowledge/query"

enhancer := query.NewLLMEnhancer(lightweightModel)

kb := knowledge.New(
    knowledge.WithQueryEnhancer(enhancer),
    // ...
)

// 对话：
// User: "What is the authentication flow?"
//   → Search: "authentication flow" (原始查询)
// User: "How about for mobile?"
//   → Search: "mobile authentication flow implementation" (LLM 改写后)
```

---

## 4. 设计原理

### 4.1 为什么 Embedder 与 VectorStore 分离？

Embedder 和 VectorStore 是两个独立关注点：
- **Embedder**：文本 → 向量，涉及 LLM API 调用、批处理、限流
- **VectorStore**：向量存储 → 相似度搜索，涉及索引、过滤、持久化

分离后用户可以：
- 同一个 VectorStore 对接不同 Embedder（A/B 测试 embeddings 质量）
- 同一个 Embedder 对接不同 VectorStore（开发用 In-Memory，生产用 PGVector）

### 4.2 智能过滤（AgenticFilter）vs 静态过滤

静态过滤：
```go
// 固定 filter，Agent 不能改变
knowledgetool.WithFilter(map[string]any{"category": "technical"})
```

智能过滤（AgenticFilterSearchTool）：
```go
// LLM 根据用户查询自动选择 filter 条件
// 用户: "Show me Go-related performance docs"
// LLM 自动构建: {"category": "technical", "language": "go", "topic": "performance"}
```

AgenticFilter 适合源文档有丰富元数据（分类、标签、作者、日期）的场景。

### 4.3 为什么 Search 返回 Tool 而非直接注入 Agent？

Search 作为 Tool 的好处：
1. **Agent 自主决定**：何时搜索、搜索什么
2. **成本控制**：只在需要时调用，不每次对话都检索
3. **可组合**：多个知识库 → 多个 Tool，Agent 自行选择
4. **可观测**：搜索调用作为 tool_call 事件可见

---

## 5. 组件支持矩阵

| 类别 | 支持 |
|------|------|
| **Embedder** | OpenAI (`text-embedding-3-small/large`)、Gemini (`text-embedding-004`)、Ollama (`nomic-embed-text`)、HuggingFace (TEI) |
| **VectorStore** | InMemory / PGVector / TcVector / Elasticsearch / Qdrant / Milvus |
| **Reranker** | TopK (passthrough) / Cohere / Infinity (TEI Rerank) |
| **Source** | File / Directory (recursive+ext过滤) / URL / Auto (自动检测) |
| **QueryEnhancer** | Passthrough / LLM Rewriter |
| **Extractor** | Docling (PDF/DOCX/HTML → Markdown) |
| **OCR** | Tesseract |
