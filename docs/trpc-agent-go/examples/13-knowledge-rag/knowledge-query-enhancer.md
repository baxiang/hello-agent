# 查询增强示例 - LLM 改写多轮对话中的代词与指代

> **源码路径**：[`trpc-agent-go/examples/knowledge/query-enhancer/`](../../../../trpc-agent-go/examples/knowledge/query-enhancer)
> **示例类型**：检索质量增强 · **难度**：进阶

## 概述

`query-enhancer/` 解决 RAG 在**多轮对话**中的经典痛点：用户的追问里满是"它"、"上面那个"、"刚才说的"，把这些代词直接喂给检索器等于噪声。本示例用 `query.NewLLMEnhancer` 在每次检索前用 LLM 把代词消解回完整的实体名，让向量检索拿到自洽的查询。

与 [`basic`](./knowledge-basic.md) 的唯一差别：在 `knowledge.New(...)` 上多挂一个 `knowledge.WithQueryEnhancer(enhancer)` 选项。

## 核心概念

### 问题：检索器看不懂代词

| 轮次 | 用户原话 | 检索器看到的（无 enhancer） |
|------|---------|-----------------------------|
| 1 | What are Large Language Models? | ✅ 完整 query |
| 2 | How does **it** handle context length? | ❌ "it" 是噪声 |
| 3 | Compare **the above** with traditional search | ❌ "the above" 丢失 |

`Embedder` 是无状态的双塔模型，无法访问对话历史，所以它对"it"和"the above"给出的向量与上下文毫无关系。

### 解法：LLMEnhancer 在检索前改写

```go
// 创建增强器（复用同一个 LLM）
enhancer := &debugEnhancer{inner: query.NewLLMEnhancer(llm)}

kb := knowledge.New(
    knowledge.WithVectorStore(vs),
    knowledge.WithEmbedder(openai.New()),
    knowledge.WithSources(sources),
    knowledge.WithQueryEnhancer(enhancer),   // 关键一行
)
```

| 轮次 | 原始 query | 增强后 query |
|------|-----------|--------------|
| 2 | How does it handle context length? | How do **Large Language Models** handle context length? |
| 3 | Compare the above with traditional search | Compare **Large Language Models** with traditional search engines |

### 装饰器模式观察改写过程

`query.Enhancer` 是单方法接口，任何实现 `EnhanceQuery` 的结构体都能包装另一个 enhancer。本示例用 `debugEnhancer` 打印 before/after 和对话历史：

```go
type debugEnhancer struct { inner query.Enhancer }

func (d *debugEnhancer) EnhanceQuery(ctx context.Context, req *query.Request) (*query.Enhanced, error) {
    if len(req.History) > 0 {
        fmt.Printf("   📜 History (%d messages):\n", len(req.History))
        for _, h := range req.History {
            fmt.Printf("      [%s] %s\n", h.Role, truncate(h.Content, 80))
        }
    }
    result, err := d.inner.EnhanceQuery(ctx, req)
    if err != nil { return nil, err }
    if result.Enhanced != req.Query {
        fmt.Printf("   🔄 Query enhanced: %q -> %q\n", req.Query, result.Enhanced)
    }
    return result, nil
}
```

这种装饰器写法无需框架钩子，是扩展 enhancer 行为（HyDE、子问题分解、日志、缓存）的推荐范式。

## 代码解析

### 多轮共享 sessionID

要让 enhancer 拿到对话历史，多轮 query 必须共享同一个 `sessionID`，否则 SessionService 里没有上下文可读：

```go
userID := "demo-user"
sessionID := "multi-turn-session"   // 三轮都复用

conversation := []string{
    "What are Large Language Models?",
    "How does it handle context length?",
    "Compare the above with traditional search engines",
}

for i, q := range conversation {
    eventChan, err := r.Run(ctx, userID, sessionID, model.NewUserMessage(q))
    // 消费事件流
}
```

> 注意：`sessionID` 不能像 basic 那样每次循环都换新值，否则 enhancer 拿不到 history。

### 增强与重排的协同

enhancer 改写后的 query 同时用于 embedding 和（如果配置了）reranker。README 给出完整数据流：

```
User Query + Session History
        │
        ▼
   Query Enhancer   ← 改写 "how does it work?" → "how do LLMs work?"
        │
        ▼
     Embedder       ← 用改写后的 query 生成向量
        │
        ▼
   Vector Store     ← 用改写后的 query 检索
        │
        ▼
  Reranker (可选)    ← 用【原始】query 对候选重排
        │
        ▼
     Results
```

reranker 用原始 query（`query.FinalQuery` 字段）而非改写后 query，避免 enhancer 引入的失真污染 cross-encoder。

### 自定义 system prompt

默认 prompt 适合通用知识问答，做代码检索或专业领域可以覆盖：

```go
enhancer := query.NewLLMEnhancer(llm, query.WithSystemPrompt(`
Rewrite the query for a code search engine.
Focus on function names, types, and package names.
Output ONLY the rewritten query.
`))
```

## 运行方式

### 环境变量

| 变量 | 必需 | 说明 | 默认值 |
|------|------|------|--------|
| `OPENAI_API_KEY` | 是 | LLM（对话+改写）+ embedding 的 Key | — |
| `OPENAI_BASE_URL` | 否 | OpenAI 兼容端点 | `https://api.openai.com/v1` |
| `MODEL_NAME` | 否 | 模型名 | `deepseek-v4-flash` |

### 命令行参数

| 参数 | 说明 | 默认值 |
|------|------|--------|
| `-vectorstore` | `inmemory` \| `sqlitevec` \| `pgvector` \| `tcvector` \| `elasticsearch` | `inmemory` |

### 运行命令

```bash
cd examples/knowledge/query-enhancer
export OPENAI_API_KEY="sk-xxxx"
go run main.go
go run main.go -vectorstore pgvector   # 持久化后端
```

### 预期输出

```
🔄 Query Enhancer Demo — Multi-turn Knowledge Chat
===================================================
Model: deepseek-v4-flash
Vector Store: inmemory

── Turn 1 ─────────────────────────────────
👤 User: What are Large Language Models?
   🔄 Query unchanged: "What are Large Language Models?"
   🤖 Assistant: Large Language Models (LLMs) are ...

── Turn 2 ─────────────────────────────────
👤 User: How does it handle context length?
   📜 History (2 messages):
      [user] What are Large Language Models?
      [assistant] Large Language Models (LLMs) are ...
   🔄 Query enhanced: "How does it handle context length?" -> "How do Large Language Models handle context length?"
   🤖 Assistant: LLMs handle context length through ...

── Turn 3 ─────────────────────────────────
👤 User: Compare the above with traditional search engines
   📜 History (4 messages): ...
   🔄 Query enhanced: "Compare the above with traditional search engines" -> "Compare Large Language Models with traditional search engines"
   🤖 Assistant: ...
```

## 适用场景与对比

**选 query-enhancer 当：**
- 多轮对话里出现代词、省略、指代（中文：它、这个、那个、上面那个）
- 用户喜欢碎片化提问而非一次说清
- 检索器是双塔 embedding（无状态），无法利用 session 上下文

**不必用 enhancer 当：**
- 单轮 QA（无历史可消解）
- 检索器本身已支持上下文（罕见）
- 想节省一次 LLM 调用开销（enhancer 每轮多一次 LLM 调用）

| 维度 | 无 enhancer | LLMEnhancer |
|------|-------------|-------------|
| 多轮代词 | 检索失败 | ✅ 消解到完整实体 |
| 每轮开销 | 1× LLM | 2× LLM（多一次改写） |
| 改写质量 | — | 取决于 LLM 能力 |
| 可扩展性 | — | `query.Enhancer` 接口可换 HyDE 等 |

## 关键要点

1. **enhancer 接在 Knowledge 上**：通过 `knowledge.WithQueryEnhancer(...)` 一行接入，对 Agent 透明。
2. **多轮共享 sessionID**：enhancer 依赖 SessionService 历史，sessionID 必须跨轮复用。
3. **装饰器模式**：`query.Enhancer` 单方法接口便于用包装器加日志/缓存/分支逻辑。
4. **与 reranker 协同**：enhancer 改写用于 embedding，reranker 用原始 query。
5. **可自定义 prompt**：`query.WithSystemPrompt` 适配代码检索、法律、医疗等垂直领域。

## 总结

query-enhancer 是 RAG 检索质量的"第一道防线"——在向量检索之前先把 query 写完整。它和 [`reranker`](./knowledge-reranker-cohere.md)（检索之后重排）正交组合：前者提高召回上限，后者提高精度上限。如果数据带丰富元数据，再叠加 [`features/agentic-filter`](./knowledge-features-agentic-filter.md) 进一步缩小搜索空间。
