# Cohere Reranker 示例 - Cross-Encoder 重排 vs Bi-Encoder 召回

> **源码路径**：[`trpc-agent-go/examples/knowledge/reranker/cohere/`](../../../../trpc-agent-go/examples/knowledge/reranker/cohere)
> **示例类型**：检索质量增强 · **难度**：进阶

## 概述

`reranker/cohere/` 用 Cohere 的 `rerank-english-v3.0` 模型对一批候选文档做 cross-encoder 重排，并与 OpenAI embedding 的 bi-encoder 余弦相似度做对照展示。本示例**不调用 Knowledge Base**，是一个纯粹的"重排算法对比"实验台——但展示的 `cohere.New()` + `knowledge.WithReranker()` 接线方式可直接搬进任何 RAG 管线。

与 [`reranker/infinity`](./knowledge-reranker-infinity.md) 的差别：cohere 用 SaaS API（一行 Key 即可），infinity 用自托管推理服务（数据不出本地）。

## 核心概念

### Bi-Encoder vs Cross-Encoder

| 维度 | Bi-Encoder（embedding） | Cross-Encoder（reranker） |
|------|------------------------|--------------------------|
| 架构 | query 和 doc 独立编码 → 余弦相似 | query+doc 拼接 → 单网络打分 |
| 速度 | 快（向量可预计算） | 慢（每对都要前向） |
| 精度 | 中（粗召回去重够用） | 高（细排判别真伪相关） |
| 用法 | 先召回 Top-K（如 20） | 再从 K 个里精选 Top-N（如 5） |

经典两阶段管线：**Embedding 召回 → Reranker 精排**。

### "Lexical Overlap Trap" 案例

最经典的对照案例：query `How to kill a Python process?`

```
--- Embedding Similarity (Bi-Encoder) ---
1. [0.718] Use kill -9 PID or pkill python to terminate a Python process.   ✅
2. [0.485] Python is a non-venomous snake that kills prey by constriction.  ❌ 词面陷阱
3. [0.454] Kill is a Unix command to send signals to processes.
4. [0.337] The process of learning Python takes about 3 months.
5. [0.269] Python programming language was created by Guido van Rossum.

--- Reranker Scores (Cohere Cross-Encoder) ---
1. [0.9997] Use kill -9 PID or pkill python to terminate a Python process.  ✅
2. [0.1461] Kill is a Unix command to send signals to processes.
3. [0.0263] Python is a non-venomous snake that kills prey by constriction. ❌ 被压到第3
4. [0.0001] Python programming language was created by Guido van Rossum.
5. [0.0000] The process of learning Python takes about 3 months.
```

bi-encoder 把"Python 是蛇"排到第 2（kill、Python、process 三个词都命中），cross-encoder 直接把它打到 0.026——它真正理解"kill a Python process"是问终止进程。

## 代码解析

### 数据结构与三步流程

```go
// 1. 用 OpenAI embedding 算 bi-encoder 分
emb := util.NewOpenAIEmbedder(*embeddingModel)
embeddingScores := util.CalculateEmbeddingScores(ctx, queryText, documents, emb)
util.PrintEmbeddingResults(embeddingScores, documents)

// 2. 把 embedding 分塞进 reranker.Result 作为候选
candidates := make([]*reranker.Result, len(documents))
for i, doc := range documents {
    candidates[i] = &reranker.Result{
        Document: &document.Document{Content: doc},
        Score:    embeddingScores[i],
    }
}

// 3. 用 Cohere cross-encoder 重排
query := &reranker.Query{Text: queryText, FinalQuery: queryText}
r, _ := cohere.New(cohere.WithAPIKey(*apiKey), cohere.WithModel(*modelName))
results, _ := r.Rerank(ctx, query, candidates)
printRerankerResults(results)
```

`reranker.Query` 有两个字段：`Text` 是原始 query，`FinalQuery` 是 enhancer 改写后的 query。reranker 用 `FinalQuery` 做语义匹配，与 [`query-enhancer`](./knowledge-query-enhancer.md) 协同。

### 接入 Knowledge Base 的方式

本示例不直接接 KB，但 README 给出集成模板：

```go
reranker, _ := cohere.New(cohere.WithTopN(5))
kb := knowledge.New(
    knowledge.WithReranker(reranker),
    // ... vectorStore / embedder / sources
)
```

挂上后，`knowledge_search` 工具的检索结果会自动走"召回 → 重排"两阶段。

### 三个测试用例

`testCases` 内置三组对照，覆盖不同失真模式：

| Case | Query | 验证什么 |
|------|-------|---------|
| Lexical Overlap Trap | How to kill a Python process? | 词面陷阱（蛇 vs 进程） |
| Semantic Precision | What year was Bitcoin created? | 时间精度（2008 白皮书 vs 2009 上线） |
| Implicit Answer | Can I use React without Node.js? | 隐含答案（CDN 直引） |

## 运行方式

### 环境变量

| 变量 | 必需 | 说明 |
|------|------|------|
| `COHERE_API_KEY` | 是 | Cohere API Key（也可用 `-apikey` flag） |
| `OPENAI_API_KEY` | 是 | 用于 embedding 对比 |
| `OPENAI_BASE_URL` | 否 | 自定义端点 |

### 命令行参数

| 参数 | 说明 | 默认值 |
|------|------|--------|
| `-apikey` | Cohere API Key（默认读 `COHERE_API_KEY`） | 环境变量 |
| `-model` | Cohere reranker 模型 | `rerank-english-v3.0` |
| `-embedding-model` | OpenAI embedding 模型 | `text-embedding-3-small` |

### 运行命令

```bash
cd examples/knowledge/reranker/cohere
export COHERE_API_KEY="your-cohere-key"
export OPENAI_API_KEY="sk-xxxx"
go run main.go
go run main.go -model rerank-multilingual-v3.0   # 多语言
```

## 适用场景与对比

**选 cohere reranker 当：**
- 不想自己部署推理服务，付费用 SaaS
- 需要 multilingual 支持（`rerank-multilingual-v3.0`）
- 团队已在用 Cohere 生态

**选 [`infinity`](./knowledge-reranker-infinity.md) 当：**
- 数据合规要求不出本地
- 想用 `BAAI/bge-reranker-v2-m3` 等开源模型
- 有 GPU 自托管能力

| 维度 | cohere | infinity |
|------|--------|----------|
| 部署 | SaaS API | 自托管（Infinity/TEI） |
| 模型 | Cohere 私有 | 任意 HuggingFace 模型 |
| 数据出境 | 是 | 否 |
| 多语言 | ✅ v3.0 | 取决于模型 |

## 关键要点

1. **两阶段检索**：embedding 粗召回 → reranker 精排，是生产 RAG 的标配。
2. **cross-encoder 慢但准**：每对 query+doc 一次前向，所以只对 Top-K 候选用。
3. **`FinalQuery` 字段**：与 query-enhancer 协同，reranker 用改写后的 query。
4. **三案例覆盖**：词面陷阱、时间精度、隐含答案是评估 reranker 的经典样本。
5. **接入 KB 一行**：`knowledge.WithReranker(cohere.New(...))` 即可。

## 总结

Cohere reranker 是"开箱即用"的重排方案，三行代码就能让现有 RAG 的检索精度上一个台阶。如果数据敏感或想换开源模型，转 [`infinity`](./knowledge-reranker-infinity.md) 即可——两者共用 `reranker.Reranker` 接口，切换零成本。配合 [`query-enhancer`](./knowledge-query-enhancer.md) 用 LLM 改写 query，再加 [`features/agentic-filter`](./knowledge-features-agentic-filter.md) 做元数据预筛，可以构建非常稳健的检索管线。
