# Memory 检索对比（compare）- SQLite 关键词 vs SQLiteVec 向量检索

> **源码路径**：[`trpc-agent-go/examples/memory/compare/`](../../../../trpc-agent-go/examples/memory/compare)
> **示例类型**：后端检索能力基准对比 · **难度**：入门

## 概述

`compare/` 是一个**非交互式基准脚本**：把同一批记忆分别写入 SQLite（关键词/token 匹配）和 SQLiteVec（向量语义搜索）两种后端，然后用一组**故意换词**的查询（同义词/改写）跑检索，对比两者的 hit@k 命中率。帮助你直观理解"为什么需要向量检索"。

这不是 chat 示例，而是数据集驱动的离线评测——跑完即退出，输出命中统计。

## 核心概念

### 两种检索后端

| 后端 | 检索方式 | 优势 | 劣势 |
|------|---------|------|------|
| `sqlite` | token / 关键词匹配 | 零依赖、快、精确匹配强 | 同义词/改写命中差 |
| `sqlitevec` | 语义向量搜索（`sqlite-vec` + embeddings） | 同义词/改写命中好、理解语义 | 需要 embedding 端点、有推理开销 |

### 为什么需要这个对比？

[`simple`](./memory-simple.md) 和 [`auto`](./memory-auto.md) 都支持 `-memory sqlitevec`，但用户往往不清楚切换到向量检索到底带来多大收益。`compare/` 用最小可复现的实验回答这个问题：**当用户用不同的词描述同一件事时，向量检索能否找回正确记忆？**

## 代码解析

### 数据集与查询设计

`compare/main.go` 内嵌了一组精心设计的种子记忆和"换词查询"：

```go
seeds := []memorySeed{
    {text: "I have a golden retriever named Coco.", topics: []string{"pet"}},
    {text: "I commute by subway on weekdays.",     topics: []string{"transport"}},
    {text: "My sister is a pediatrician.",         topics: []string{"family"}},
    {text: "I moved to Tokyo in 2021.",            topics: []string{"location"}},
}

queries := []queryCase{
    {query: "Do I have a dog? What's its name?",  expected: seeds[0].text}, // golden retriever → dog
    {query: "How do I get to the office?",         expected: seeds[1].text}, // commute by subway → get to office
    {query: "What does my sibling do for work?",   expected: seeds[2].text}, // sister → sibling, pediatrician → work
    {query: "When did I relocate to Japan?",       expected: seeds[3].text}, // moved → relocate, Tokyo → Japan
}
```

注意每个查询都做了**语义改写**：`golden retriever` → `dog`，`sister` → `sibling`，`moved` → `relocate`，`Tokyo` → `Japan`。这正是关键词检索容易翻车、向量检索擅长的场景。

### 双后端并行评测

```go
sqliteSvc, sqliteCleanup := mustCreateSQLiteService(ctx)
defer sqliteCleanup()
sqliteVecSvc, sqliteVecCleanup := mustCreateSQLiteVecService(ctx)
defer sqliteVecCleanup()

// 同一批记忆写入两个后端
mustSeed(ctx, sqliteSvc, userKey, seeds)
mustSeed(ctx, sqliteVecSvc, userKey, seeds)

for _, tc := range queries {
    gotSQLite, _    := sqliteSvc.SearchMemories(ctx, userKey, tc.query)
    gotSQLiteVec, _ := sqliteVecSvc.SearchMemories(ctx, userKey, tc.query)

    sqliteHit    := containsExpected(gotSQLite, tc.expected, topK)
    sqliteVecHit := containsExpected(gotSQLiteVec, tc.expected, topK)
    // 统计 hit@k
}
```

`containsExpected` 检查 top-k 结果里是否包含期望记忆条目。最终输出两个后端的命中总数。

### SQLiteVec Embedder 配置

SQLiteVec 需要 embedding 模型。`compare/main.go` 用 OpenAI embedder，从环境变量读取（支持独立的 embedding key/endpoint）：

```go
func newOpenAIEmbedderFromEnv() *openaiembedder.Embedder {
    modelName := openaiembedder.DefaultModel  // text-embedding-3-small
    if env := os.Getenv(envOpenAIEmbeddingModel); env != "" {
        modelName = env
    }
    // API key: 优先 OPENAI_EMBEDDING_API_KEY，回退 OPENAI_API_KEY
    // base URL: 优先 OPENAI_EMBEDDING_BASE_URL，回退 OPENAI_BASE_URL
    return openaiembedder.New(opts...)
}
```

## 运行方式

### 环境变量

| 变量 | 必需 | 说明 |
|------|------|------|
| `OPENAI_API_KEY` | 是 | embedding API key（无独立 embedding key 时用它） |
| `OPENAI_EMBEDDING_API_KEY` | 否 | 独立的 embedding API key |
| `OPENAI_EMBEDDING_BASE_URL` | 否 | 独立的 embedding 端点 |
| `OPENAI_EMBEDDING_MODEL` | 否 | 覆盖默认 `text-embedding-3-small` |

### 命令行参数

| 参数 | 说明 | 默认值 |
|------|------|--------|
| `-k` | top-k 命中评估的 k 值 | `3` |

### 运行命令

```bash
cd examples/memory/compare
export OPENAI_API_KEY="your-api-key"

go run .           # 默认 hit@3
go run . -k 1      # 更严格：只在 top1 命中算成功
go run . -k 5      # 更宽松
```

### 预期输出

```
Dataset: 4 memories, 4 queries
Evaluating hit@3
============================================================
[1/4] Query: "Do I have a dog? What's its name?"
  sqlite:    hit=false, results=4, time=1.2ms
  sqlitevec: hit=true,  results=4, time=180ms

[2/4] Query: "How do I get to the office?"
  sqlite:    hit=false, results=4, time=1.1ms
  sqlitevec: hit=true,  results=4, time=175ms
...
============================================================
sqlite hit@3: 0/4
sqlitevec hit@3: 4/4
```

> 实际数字会因 embedding 模型和数据不同而变化，但典型结果：**向量检索在语义改写查询上命中率显著高于关键词检索**。

## 解读与启示

1. **关键词检索的盲区**：当用户用同义词、上位词、改写提问时，token 匹配往往失败（`golden retriever` ≠ `dog`）
2. **向量检索的代价**：每次查询要调 embedding 端点，延迟和成本高于关键词检索
3. **选型决策**：
   - 用户提问多变、需要语义理解 → `sqlitevec` / `pgvector` / `mysqlvec`
   - 精确匹配优先、低成本 → `sqlite`
   - 生产环境 + 规模化 → `pgvector` / `mysqlvec`（向量数据库级性能）
4. **可扩展**：把 `compare/main.go` 的 `seeds` / `queries` 换成你自己的业务数据，就能得到针对自己场景的选型依据

## 关键要点

1. **最小可复现**：4 条记忆 + 4 个查询，几十行代码讲清两种检索的差异
2. **改写查询是关键**：测试集必须包含同义词/改写，否则测不出向量检索的价值
3. **hit@k 指标**：`-k` 参数让你在不同严格度下评估
4. **embedder 解耦**：embedding key/endpoint 可独立于对话模型配置，便于接私有化 embedding 服务
5. **回退逻辑**：`OPENAI_EMBEDDING_*` 未设时自动回退到 `OPENAI_*`，减少配置负担

## 总结

`compare/` 是选型决策的最佳起点：在你决定是否为 [`simple`](./memory-simple.md) / [`auto`](./memory-auto.md) 切换到向量后端之前，先用这个脚本跑一下自己的真实查询样本。如果关键词检索的命中率已经满足需求，就没必要引入 embedding 依赖；如果命中差，再升级到 `sqlitevec` / `pgvector`。这个小示例能帮你避免过度工程化或选型失误。
