# 知识库 RAG - 构建检索增强生成的完整示例集合

> **源码路径**：[`trpc-agent-go/examples/knowledge/`](../../../../trpc-agent-go/examples/knowledge)
> **子示例数**：24 个 · 本页为分类索引，每个子示例有独立详解

## 概述

Knowledge 是 trpc-agent-go 里最庞大的示例分类，用 **24 个独立子示例**覆盖 RAG（检索增强生成）的全链路：从最简的"文件 + 内存向量库 + Agent"，到代码 AST 解析、GraphRAG 图遍历、MCP 服务化、OCR 扫描件处理。所有示例共用同一套"Source → VectorStore → Embedder → Knowledge → Tool → Agent"骨架，只在各环节做替换或增强。

## 子示例导航

### 基础（1）

| 子示例 | 类型 | 难度 | 一句话说明 |
|--------|------|------|-----------|
| [`basic/`](./knowledge-basic.md) | 基础 RAG | 入门 | 文件 + 目录 + 内存向量库 + Agent，最小可运行 RAG |

### 检索质量增强（3）

| 子示例 | 类型 | 难度 | 一句话说明 |
|--------|------|------|-----------|
| [`query-enhancer/`](./knowledge-query-enhancer.md) | 查询改写 | 进阶 | LLM 改写多轮对话中的代词，让检索拿到完整 query |
| [`reranker/cohere/`](./knowledge-reranker-cohere.md) | 重排（SaaS） | 进阶 | Cohere cross-encoder 重排，对照 bi-encoder 召回 |
| [`reranker/infinity/`](./knowledge-reranker-infinity.md) | 重排（自托管） | 进阶 | 自托管 Infinity/TEI + bge-reranker，数据不出本地 |

### 数据源（7）

| 子示例 | 类型 | 难度 | 一句话说明 |
|--------|------|------|-----------|
| [`sources/file-source/`](./knowledge-sources-file.md) | 文件源 | 入门 | 多文件 + 元数据，最常用的 RAG 数据源 |
| [`sources/directory-source/`](./knowledge-sources-directory.md) | 目录源 | 入门 | 递归扫目录批量入库 |
| [`sources/url-source/`](./knowledge-sources-url.md) | URL 源 | 入门 | 抓网页内容建知识库 |
| [`sources/auto-source/`](./knowledge-sources-auto.md) | 混合源 | 入门 | 自动判别文本/文件/URL |
| [`sources/fixed-chunking/`](./knowledge-sources-fixed-chunking.md) | 分块策略 | 入门 | FixedSizeChunking 定长切分 |
| [`sources/recursive-chunking/`](./knowledge-sources-recursive-chunking.md) | 分块策略 | 入门 | RecursiveChunking 按语义边界切分 |
| [`sources/ast/`](./knowledge-sources-ast.md) | 代码源 | 进阶 | repo source + AST 解析，代码 RAG 数据层 |

### 高级特性（9）

| 子示例 | 类型 | 难度 | 一句话说明 |
|--------|------|------|-----------|
| [`features/agentic-filter/`](./knowledge-features-agentic-filter.md) | 元数据过滤 | 进阶 | LLM 自动生成元数据 filter |
| [`features/metadata-filter/`](./knowledge-features-metadata-filter.md) | 元数据过滤 | 进阶 | 程序化 AND/OR/NOT 复合过滤 |
| [`features/management/`](./knowledge-features-management.md) | 运行时管理 | 进阶 | 动态 AddSource/RemoveSource/ReloadSource/UpdateByFilter |
| [`features/extractor/`](./knowledge-features-extractor.md) | 文档转换 | 进阶 | Docling 把 PDF/HTML 高质量转 Markdown |
| [`features/transform/`](./knowledge-features-transform.md) | 内容清洗 | 入门 | CharFilter/CharDedup 字符级清洗 |
| [`features/graphrag/`](./knowledge-features-graphrag.md) | 代码图 RAG | 高级 | Apache AGE + pgvector，调用链/实现关系检索 |
| [`features/graphrag/viewer/`](./knowledge-features-graphrag-viewer.md) | 调试工具 | 进阶 | AGE 图可视化 Web 界面 |
| [`features/code_context_engine/`](./knowledge-features-code-context-engine.md) | MCP 服务化 | 高级 | 把 code_search 通过 MCP 暴露 + 本地 vs Augment 对比 |
| [`features/OCR/`](./knowledge-features-ocr.md) | OCR | 进阶 | Tesseract 处理图片型 PDF（需 build tag） |

### 向量库后端（4）

| 子示例 | 类型 | 难度 | 一句话说明 |
|--------|------|------|-----------|
| [`vectorstores/postgres/`](./knowledge-vectorstores-postgres.md) | 关系型 + 向量 | 进阶 | pgvector，生产首选，支持 ACID + 全文 + UPDATE |
| [`vectorstores/elasticsearch/`](./knowledge-vectorstores-elasticsearch.md) | 搜索引擎 | 进阶 | ES，关键词 + 向量混合检索强项 |
| [`vectorstores/tcvector/`](./knowledge-vectorstores-tcvector.md) | 云托管 | 进阶 | 腾讯 VectorDB，零运维 |
| [`vectorstores/milvus/`](./knowledge-vectorstores-milvus.md) | 大规模 | 进阶 | Milvus，十亿级专用向量库 |

## 选型建议

### 向量库后端选择

```
需要 RAG 后端？
├── 数据规模 < 千万级 chunk
│   ├── 需要事务/元数据 UPDATE/全文混合 → pgvector（默认首选）
│   ├── 已有 ES 集群，要复用 → elasticsearch
│   └── 腾讯云用户，想零运维 → tcvector
└── 数据规模 > 亿级 chunk
    └── milvus（专用向量库）
```

经验法则：**默认 pgvector，超大规模才换 milvus**。

### 检索质量增强何时用

| 痛点 | 用什么 | 代价 |
|------|--------|------|
| 多轮对话代词丢失 | [`query-enhancer`](./knowledge-query-enhancer.md) | +1 次 LLM 调用 |
| 召回结果排序不准 | [`reranker`](./knowledge-reranker-cohere.md)（cohere/infinity） | +1 次 cross-encoder 调用 |
| 检索范围太广 | [`agentic-filter`](./knowledge-features-agentic-filter.md) 或 [`metadata-filter`](./knowledge-features-metadata-filter.md) | agentic +1 LLM；metadata 0 |
| 普通向量检索答不了"调用链" | [`graphrag`](./knowledge-features-graphrag.md) | 部署 AGE + pgvector |

三者**正交可叠加**：enhancer 改 query → filter 缩范围 → 向量召回 → reranker 精排，构成完整管线。

### 数据源选择

| 数据形态 | 选什么 |
|---------|--------|
| 本地文档（少量） | [`file-source`](./knowledge-sources-file.md) |
| 本地文档（批量） | [`directory-source`](./knowledge-sources-directory.md) |
| 网页内容 | [`url-source`](./knowledge-sources-url.md) |
| 混合（文本+文件+URL） | [`auto-source`](./knowledge-sources-auto.md) |
| 代码仓库 | [`ast`](./knowledge-sources-ast.md) |
| 复杂 PDF/HTML | [`extractor`](./knowledge-features-extractor.md)（Docling） |
| 扫描件/图片 PDF | [`OCR`](./knowledge-features-ocr.md)（Tesseract） |

## 核心概念

### RAG 五步主干

所有子示例共用同一骨架：

```
1. Source        ← 数据从哪来（file/dir/url/repo/ast）
2. VectorStore   ← 向量存哪（inmemory/pgvector/es/milvus/tcvector）
3. Embedder      ← 谁把文本变向量（OpenAI）
4. Knowledge     ← 组装 + Load（含分块、可选 enhancer/reranker/filter）
5. Tool + Agent  ← 把 KB 包成工具交给 LLM
```

代码形态：

```go
kb := knowledge.New(
    knowledge.WithVectorStore(vs),
    knowledge.WithEmbedder(emb),
    knowledge.WithSources(sources),
    // 可选增强：
    knowledge.WithQueryEnhancer(enhancer),
    knowledge.WithReranker(reranker),
)
kb.Load(ctx)
searchTool := knowledgetool.NewKnowledgeSearchTool(kb)
```

### Knowledge 三层架构

```
Knowledge Service（知识服务）
    ├── Sources（数据源层：file/dir/url/repo/ast，含 chunking/transform）
    ├── VectorStore（存储层：inmemory/pgvector/es/milvus/tcvector）
    └── 增强层（可选）
        ├── Embedder（向量化）
        ├── QueryEnhancer（查询改写）
        ├── Reranker（结果重排）
        └── Filter（元数据过滤：agentic/programmatic）
```

### 共通运行约定

- **环境变量**：所有示例都需 `OPENAI_API_KEY` + `OPENAI_BASE_URL` + `MODEL_NAME`（默认 `deepseek-v4-flash`）
- **`-vectorstore` flag**：基础/源/特性类示例支持 `inmemory|sqlitevec|pgvector|tcvector|elasticsearch|milvus`，默认 `inmemory`
- **后端切换零代码**：`util.NewVectorStoreByType` + `-vectorstore` 一行切换 6 种后端
- **索引刷新等待**：`util.WaitForIndexRefresh` 对 ES sleep 30s，对 Milvus sleep 5s，其它同步可见
- **统一事件可视化**：`util.PrintEventWithToolCalls` 打印工具调用/响应/检索文档

### 知识搜索工具家族

| 工具构造函数 | 用途 | 出处 |
|-------------|------|------|
| `NewKnowledgeSearchTool` | 标准检索（可挂 filter） | basic / sources / vectorstores |
| `NewAgenticFilterSearchTool` | LLM 自动生成 filter | agentic-filter |
| `NewCodeSearchTool` | 代码检索（AST chunk） | code_context_engine |
| `NewCodeGraphSearchTool`（ToolSet） | 图检索 + 遍历 + 路径 | graphrag |

## 深度原理
> 本节源自原「核心组件」深度文（09-knowledge.md）。

### Knowledge Service 核心接口

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

`Load` 完成离线入库，`Search` 由 Tool 在线触发；`AddSource`/`RemoveSource` 支持运行时动态增删（详见 [`management`](./knowledge-features-management.md)）。

### RAG 架构设计

端到端 pipeline：

```
[知识源] → [Extractor(可选)] → [Reader] → [Splitter] → [Embedder] → [VectorStore]
                                                                          │
[用户问题] → [QueryEnhancer(可选)] → [Embedder] → [VectorStore.Search]   │
                                                      │                  │
                                                      ▼                  ▼
                                                    [Reranker(可选)] ← ──┘
                                                      │
                                                      ▼
[LLM] ← [Filter(可选)] ← [检索结果 + 相关文档]
```

`Load` 内部采用**双并发池**：
- Source 级并发（`WithSourceConcurrency`）：并发解析不同数据源
- Doc 级并发（`WithDocConcurrency`）：并发 Embedding + 存储
- 两池通过 channel 连接，构成生产者-消费者模式

### Source 与 VectorStore

两者是正交的独立关注点：

| 维度 | Source | VectorStore |
|------|--------|-------------|
| 职责 | 文本/文件/URL → Document | 向量存储 + 相似度搜索 |
| 关注点 | Extractor / Splitter / Transform | 索引 / 过滤 / 持久化 |
| 可选实现 | file / dir / url / auto / repo / ast | inmemory / pgvector / es / milvus / tcvector |

分离后用户可：同一 VectorStore 对接不同 Embedder（A/B 测试 embeddings 质量），或同一 Embedder 对接不同 VectorStore（开发用 In-Memory，生产用 PGVector）。

### 设计哲学

**为什么抽象成 pipeline**：RAG 各阶段（解析、分块、向量化、存储、重排、过滤）相互独立、各有复杂度，pipeline 化让每环节可独立替换或旁路，避免"一处改动牵全身"。

**Embedder / Reranker 可插拔**：
- Embedder 决定召回（bi-encoder，文本→向量，速度快）
- Reranker 决定精排（cross-encoder，query+doc 联合打分，质量高但慢）
- 典型组合：VectorStore 召回 10 候选 → Reranker 取 Top 3（成本 +1 次 cross-encoder 调用，质量显著提升，尤其长文档）

**为什么 Search 暴露为 Tool 而非直接注入 Agent**：
1. Agent 自主决定何时搜、搜什么
2. 只在需要时调用，控制成本
3. 多知识库 → 多 Tool，Agent 自行选择
4. 搜索调用作为 tool_call 事件可观测

**智能过滤 vs 静态过滤**：静态 `WithFilter` 固定不可变；`AgenticFilterSearchTool` 让 LLM 根据查询自动构建 filter（适合元数据丰富的场景，详见 [`agentic-filter`](./knowledge-features-agentic-filter.md)）。

### 配置速查

`knowledge.New` 的 functional options：

| Option | 作用 | 默认 / 说明 |
|--------|------|------------|
| `WithEmbedder(e)` | 向量化器 | 必填，OpenAI / Gemini / Ollama / HF |
| `WithVectorStore(vs)` | 向量库后端 | 必填，inmemory / pgvector / es / milvus / tcvector |
| `WithSources(srcs)` | 注册数据源 | 可多次调用累加 |
| `WithEnableSourceSync(true)` | 启用源同步 | 文件变动时自动 reload |
| `WithReranker(r)` | 重排器 | 可选，cohere / infinity / TopK |
| `WithQueryEnhancer(e)` | 查询改写 | 可选，passthrough / LLM |
| `WithExtractor(e)` | 文档转换器 | 可选，Docling（PDF/DOCX/HTML → MD） |

`Load` 的 runtime options：

| Option | 作用 | 典型值 |
|--------|------|--------|
| `WithShowProgress(true)` | 打印进度 | — |
| `WithLoadProgressCallback(cb)` | 进度回调 | 打印 ETA / 错误 |
| `WithSourceConcurrency(n)` | Source 解析并发 | 4 |
| `WithDocConcurrency(n)` | Embed + Store 并发 | 64 |

`knowledgetool.NewKnowledgeSearchTool` 的 options：

| Option | 作用 |
|--------|------|
| `WithToolName(name)` | 工具名（多 KB 时区分） |
| `WithToolDescription(d)` | 给 LLM 的工具说明 |
| `WithMaxResults(n)` | 返回文档数上限 |
| `WithMinScore(s)` | 相关性阈值过滤 |
| `WithFilter(m)` | 静态元数据过滤 |

## 学习路径建议

1. **先读 [`basic`](./knowledge-basic.md)**：理解五步主干，这是所有示例的基础（15 分钟）
2. **按数据源需求选读 [`sources/*`](./knowledge-sources-file.md)**：
   - 文档 RAG → file / directory / url / auto
   - 代码 RAG → ast
   - 分块调参 → fixed-chunking / recursive-chunking
3. **按检索质量需求选读增强**：
   - 多轮对话 → [`query-enhancer`](./knowledge-query-enhancer.md)
   - 排序不准 → [`reranker`](./knowledge-reranker-cohere.md)
   - 范围太广 → [`agentic-filter`](./knowledge-features-agentic-filter.md) / [`metadata-filter`](./knowledge-features-metadata-filter.md)
4. **按运维需求选读**：
   - 运行时增删改 → [`management`](./knowledge-features-management.md)
   - 后端选型 → [`vectorstores/*`](./knowledge-vectorstores-postgres.md)
5. **高级场景**：
   - 代码调用链 → [`graphrag`](./knowledge-features-graphrag.md) + [`viewer`](./knowledge-features-graphrag-viewer.md)
   - 对外服务化 → [`code_context_engine`](./knowledge-features-code-context-engine.md)
   - 复杂 PDF → [`extractor`](./knowledge-features-extractor.md)（Docling）/ [`OCR`](./knowledge-features-ocr.md)（Tesseract）
   - 内容清洗 → [`transform`](./knowledge-features-transform.md)

## 共通的运行命令

```bash
# 通用前置
export OPENAI_API_KEY="sk-xxxx"
export OPENAI_BASE_URL="https://api.openai.com/v1"
export MODEL_NAME="deepseek-v4-flash"

# 基础示例（入门必跑）
cd examples/knowledge/basic && go run .

# 切后端（任何支持 -vectorstore 的示例通用）
go run . -vectorstore pgvector      # 需 PGVECTOR_*
go run . -vectorstore elasticsearch # 需 ELASTICSEARCH_*
go run . -vectorstore milvus        # 需 MILVUS_*

# 批量跑多个示例（开发脚本）
cd examples/knowledge && ./run_examples.sh                  # 默认 inmemory
./run_examples.sh -v pgvector                                # 指定后端
./run_examples.sh -a                                          # 跑所有后端
./run_examples.sh -e "basic,features/management"             # 指定示例
./run_examples.sh -r                                          # 随机表名（避免数据混淆）
```

> 注意：`run_examples.sh` 默认排除 OCR（需 `tesseract` build tag）和 graphrag/code_context_engine（需 AGE 等额外服务）。

## 共同的环境变量

最关键的三个（详见各子示例）：

| 变量 | 说明 |
|------|------|
| `OPENAI_API_KEY` | 对话 + embedding 的 API Key |
| `OPENAI_BASE_URL` | OpenAI 兼容端点（默认 `https://api.openai.com/v1`） |
| `MODEL_NAME` | 对话模型（默认 `deepseek-v4-flash`） |

各后端的专属变量见对应 [`vectorstores/*`](./knowledge-vectorstores-postgres.md) 文档。

## 总结

Knowledge RAG 系列的设计精髓在于**完全解耦**：同一套 `knowledge.New()` 入口，数据源可换 7 种（file/dir/url/auto/repo/fixed-chunking/recursive-chunking），后端可换 6 种（inmemory/sqlitevec/pgvector/tcvector/elasticsearch/milvus），增强层可任意组合（enhancer/reranker/filter），工具形态可从单检索扩展到图遍历（graphrag）或 MCP 服务（code_context_engine）。

入门路径：先跑通 [`basic`](./knowledge-basic.md)，再按"数据源 → 后端 → 增强 → 高级"的顺序按需扩展。生产建议：默认 [`pgvector`](./knowledge-vectorstores-postgres.md) 后端 + [`recursive-chunking`](./knowledge-sources-recursive-chunking.md) 分块 + 必要时叠加 [`query-enhancer`](./knowledge-query-enhancer.md) 和 [`reranker`](./knowledge-reranker-cohere.md)。Knowledge 与 [`memory/`](../07-memory-system/memory.md) 系统正交：前者管"外部知识检索"，后者管"用户长期记忆"，生产可组合使用。
