# 知识库管理示例 - 运行时动态增删改数据源

> **源码路径**：[`trpc-agent-go/examples/knowledge/features/management/`](../../../../trpc-agent-go/examples/knowledge/features/management)
> **示例类型**：运行时知识库管理 · **难度**：进阶

## 概述

`features/management/` 演示**运行时动态**操作知识库：创建后还能 `AddSource` / `ReloadSource` / `RemoveSource` / 直接 `Search` / `UpdateByFilter` 改元数据。与其它示例"启动时一次性 Load 完就只读"的模式完全不同——本示例展示 Knowledge Base 作为**可变状态服务**的用法。是构建"知识库管理面板"或"增量同步管线"的基础。

## 核心概念

### Knowledge Base 作为可变服务

```go
kb := knowledge.New(
    knowledge.WithEmbedder(openaiembedder.New()),
    knowledge.WithVectorStore(vs),
    knowledge.WithSources([]source.Source{llmSource}),
    knowledge.WithEnableSourceSync(true),  // 关键：开启源同步
)
```

`WithEnableSourceSync(true)` 让 KB 进入"可增量同步"模式——后续 AddSource / ReloadSource 时框架会做变更检测、孤儿清理。

### 核心 API

| API | 作用 |
|-----|------|
| `kb.Load(ctx)` | 初始加载所有 source |
| `kb.AddSource(ctx, src)` | 动态加新 source |
| `kb.ReloadSource(ctx, src)` | 重载某个 source（同名替换，可更新元数据） |
| `kb.RemoveSource(ctx, name)` | 按 name 移除 source |
| `kb.Search(ctx, req)` | 直接检索（不经 Agent 工具） |
| `kb.ShowDocumentInfo(ctx)` | 查看文档统计 |
| `vs.UpdateByFilter(ctx, ...)` | 直接改向量库里的元数据（后端相关） |

注意 `Search` 和 `ShowDocumentInfo` 让 KB 可作为**库**被代码直接调用，而不必经过 Agent——这对管理脚本、ETL、统计面板很有用。

### 增量同步：变更检测 + 孤儿清理

`ReloadSource` 不是简单删除再插入，而是做 **diff**：

- 文档内容未变 → 保留原 embedding（省 API 调用）
- 内容变化 → 重新 embed + 替换
- 源里已不存在的文档 → 作为"孤儿"清理

这对大文档库的"定期刷新"至关重要——只重算变化部分。

## 代码解析

### 七步演示

`main()` 用 7 个编号步骤演示完整生命周期：

```go
1️⃣ 创建 KB（带初始 LLMDocs 源）
2️⃣ AddSource（GolangDocs）
3️⃣ Search（验证两源都在）
4️⃣ ReloadSource（LLMDocs 加 version=v2 元数据）
5️⃣ RemoveSource（GolangDocs）
6️⃣ Search（验证只剩 LLMDocs）
7️⃣ UpdateByFilter（直接改向量库元数据）
```

### Search 直接调用

```go
result, err := kb.Search(ctx, &knowledge.SearchRequest{
    Query:      "machine learning",
    MaxResults: 2,
})
```

不经 Agent 工具，直接调 KB 的 Search 方法——返回 `*knowledge.SearchResult`，包含 `Documents`（每条带 `Score` / `Document`）。

### ShowDocumentInfo 统计

```go
func showSources(ctx context.Context, kb *knowledge.BuiltinKnowledge) {
    docInfos, _ := kb.ShowDocumentInfo(ctx)
    sourceCounts := make(map[string]int)
    for _, info := range docInfos {
        sourceCounts[info.SourceName]++
    }
    fmt.Printf("   Sources: %d, Total documents: %d\n", len(sourceCounts), len(docInfos))
}
```

输出形如 `Sources: 2, Total documents: 28`，便于运维监控。

### 元数据直接改（UpdateByFilter）

```go
updates := map[string]any{
    "metadata.category": "reviewed-docs",  // 改现有字段
    "metadata.status":   "published",      // 加新字段
}
rows, err := vs.UpdateByFilter(ctx,
    vectorstore.WithUpdateByFilterCondition(&searchfilter.UniversalFilterCondition{
        Field:    "metadata.topic",
        Operator: searchfilter.OperatorEqual,
        Value:    "llm",
    }),
    vectorstore.WithUpdateByFilterUpdates(updates),
)
```

直接在向量库层面按 filter 批量改元数据，跳过 KB 抽象。注意这是**后端相关**能力——非 pgvector 等后端会返回 `not supported`：

```go
if storeType != util.VectorStorePGVector && strings.Contains(err.Error(), "not supported") {
    fmt.Printf("   ⚠️ UpdateByFilter not supported by %s (expected)\n", storeType)
}
```

## 运行方式

### 环境变量与参数

| 变量/参数 | 必需 | 说明 | 默认值 |
|----------|------|------|--------|
| `OPENAI_API_KEY` | 是 | embedding | — |
| `MODEL_NAME` | 否 | 模型（本示例无对话） | `deepseek-v4-flash` |
| `-vectorstore` | 否 | 后端（推荐 pgvector） | **`pgvector`** |

> 注意：本示例默认 `-vectorstore pgvector`（与其它示例默认 `inmemory` 不同），因为 `UpdateByFilter` 需要后端支持。

### 运行命令

```bash
cd examples/knowledge/features/management
export OPENAI_API_KEY="sk-xxxx"
# 先启动 pgvector（参考 vectorstores/postgres 文档）
go run main.go                    # 默认 pgvector
go run main.go -vectorstore inmemory   # 演示前 6 步（第 7 步会报 not supported）
```

### 预期输出

```
📚 Knowledge Management Demo
============================
Vector Store: pgvector

1️⃣ Creating knowledge base with initial source...
   ✅ Initial source loaded
   Sources: 1, Total documents: 23
   - LLMDocs: 23 docs, metadata: map[category:documentation topic:llm]

2️⃣ Adding new source (GolangDocs)...
   ✅ Source added successfully
   Sources: 2, Total documents: 28

3️⃣ Searching for 'machine learning'...
   Found 2 results:
   1. [LLMDocs] score=0.449: ...
   2. [LLMDocs] score=0.433: ...

4️⃣ Reloading source (LLMDocs)...
   ✅ Source reloaded with new metadata
   - LLMDocs: 23 docs, metadata: map[... topic:llm version:v2]

5️⃣ Removing source (GolangDocs)...
   ✅ Source removed
   Sources: 1, Total documents: 23

6️⃣ Searching after removal...
   Found 2 results: ...

7️⃣ Updating Metadata via VectorStore (LLMDocs -> category: reviewed-docs)...
   📄 Before Update:
      Metadata: category:documentation status:...
   ✅ Updated 23 documents
   📄 After Update:
      Metadata: category:reviewed-docs status:published

✅ Demo completed!
```

## 适用场景与对比

**选 management 当：**
- 构建知识库管理面板（增删改 source）
- 文档会持续更新，需要增量同步（ReloadSource）
- 需要在代码里直接 Search KB（不经 Agent）
- 需要批量改元数据（UpdateByFilter）

**对比一次性 Load 模式（basic / sources/*）：**

| 维度 | 一次性 Load | management |
|------|------------|-----------|
| source 变更 | 重启程序 | 运行时动态 |
| 增量同步 | ❌ | ✅（diff + 孤儿清理） |
| 直接 Search | ❌（要经 Agent） | ✅ |
| UpdateByFilter | ❌ | ✅（pgvector 等后端） |
| 复杂度 | 简单 | 中等 |

## 关键要点

1. **`WithEnableSourceSync(true)`**：开启增量同步能力的前提。
2. **变更检测省 embedding**：ReloadSource 只重算变化部分。
3. **直接 Search API**：KB 可作为库被代码调用，不必经 Agent。
4. **UpdateByFilter 后端相关**：pgvector 支持，inmemory 等不支持。
5. **运维友好**：`ShowDocumentInfo` 提供文档级统计。

## 总结

management 示例把 Knowledge Base 从"启动配置"升级为"运行时可变服务"——支持动态增删改 source、增量同步、直接检索、批量元数据更新。它是构建知识库管理后台、文档增量同步管线、ETL 任务的基础。生产环境建议默认开启 `WithEnableSourceSync(true)`，配合 [`features/extractor`](./knowledge-features-extractor.md) 处理新格式文档，配合 [`features/transform`](./knowledge-features-transform.md) 清洗内容。
