# Agentic Filter 示例 - LLM 自动生成元数据过滤条件

> **源码路径**：[`trpc-agent-go/examples/knowledge/features/agentic-filter/`](../../../../trpc-agent-go/examples/knowledge/features/agentic-filter)
> **示例类型**：检索精度增强 · **难度**：进阶

## 概述

`features/agentic-filter/` 让 **LLM 自动**根据用户 query 生成元数据过滤条件，缩小向量检索范围。与 [`metadata-filter`](./knowledge-features-metadata-filter.md) 是一对：后者由**开发者硬编码**过滤逻辑，前者把过滤决策也交给 LLM。两者底层都依赖 source 上挂的元数据。

## 核心概念

### 问题：检索范围太广

如果知识库里有"机器学习文档"和"编程文档"两类，用户问"Go 语言怎么写"时，无差别向量检索会把 ML 文档也算进来——虽然分数低，但浪费 Top-K 名额。先按 `topic=programming` 过滤，就能让检索聚焦。

### 解法：LLM 自动选 filter

```go
knowledgeSearchTool := knowledgetool.NewAgenticFilterSearchTool(
    kb,
    source.GetAllMetadata(sources),  // 把所有可能的元数据键值告诉 LLM
    knowledgetool.WithMaxResults(3),
)
```

`NewAgenticFilterSearchTool` 的关键参数：

| 参数 | 作用 |
|------|------|
| `kb` | 知识库 |
| `source.GetAllMetadata(sources)` | 提取所有 source 的元数据键值集合，作为 LLM 选 filter 的"菜单" |
| `knowledgetool.WithMaxResults(n)` | 检索 Top-N |

LLM 看到"菜单"和用户 query 后，自己决定要不要加 filter、加哪个 filter。

### 与 metadata-filter 的对照

| 维度 | agentic-filter | metadata-filter |
|------|---------------|-----------------|
| filter 来源 | LLM 自动生成 | 开发者硬编码 |
| 灵活性 | 高（每个 query 不同） | 低（固定逻辑） |
| LLM 调用 | 多一次（生成 filter） | 无 |
| 适合 | 元数据丰富、查询多样 | 逻辑明确、查询模式固定 |

## 代码解析

### 给 source 打丰富元数据

```go
sources := []source.Source{
    file.New([]string{util.ExampleDataPath("file/llm.md")},
        file.WithName("LLM Docs"),
        file.WithMetadataValue("category", "documentation"),
        file.WithMetadataValue("topic", "machine_learning"),
        file.WithMetadataValue("content_type", "llm"),
    ),
    file.New([]string{util.ExampleDataPath("file/golang.md")},
        file.WithName("Golang Docs"),
        file.WithMetadataValue("category", "documentation"),
        file.WithMetadataValue("topic", "programming"),
        file.WithMetadataValue("content_type", "golang"),
    ),
}
```

每个 source 打三个元数据字段，给 LLM 提供"菜单"。`source.GetAllMetadata(sources)` 会聚合所有 source 的元数据键值集合。

### 三组测试 query

```go
queries := []string{
    "Find programming-related content",                 // 期望 LLM 选 topic=programming
    "Show me machine learning documentation",           // 期望选 topic=machine_learning
    "What's in the golang content?",                    // 期望选 content_type=golang
}
```

每条 query 由 LLM 独立判断该加什么 filter，体现了 agentic 的灵活性。

## 运行方式

### 环境变量与参数

| 变量/参数 | 必需 | 说明 | 默认值 |
|----------|------|------|--------|
| `OPENAI_API_KEY` | 是 | LLM + embedding | — |
| `MODEL_NAME` | 否 | 模型 | `deepseek-v4-flash` |
| `-vectorstore` | 否 | 后端 | `inmemory` |

### 运行命令

```bash
cd examples/knowledge/features/agentic-filter
export OPENAI_API_KEY="sk-xxxx"
go run main.go
go run main.go -vectorstore pgvector
```

### 预期输出

```
🎯 Agentic Filter Demo
======================
Model: deepseek-v4-flash
Vector Store: inmemory

1. 🔍 Query: Find programming-related content
   🤖 Response: Go is a statically typed, compiled programming language...

2. 🔍 Query: Show me machine learning documentation
   🤖 Response: Large Language Models are neural networks...

3. 🔍 Query: What's in the golang content?
   🤖 Response: ...
```

工具调用参数里能看到 LLM 自动生成的 filter（如 `{"filter":{"topic":"programming"}}`）。

## 适用场景与对比

**选 agentic-filter 当：**
- 元数据维度多（topic / category / language / version 等）
- 用户查询表达多样，无法预先枚举所有过滤逻辑
- 想让 RAG "更聪明"，自动聚焦相关子集

**选 [`metadata-filter`](./knowledge-features-metadata-filter.md) 当：**
- 过滤逻辑明确且固定（如"只搜已发布文档"）
- 不想多花一次 LLM 调用
- 需要 AND/OR/NOT 复合逻辑且要严格可控

**组合使用：**
两者并不互斥——可以先 agentic 生成 filter，再叠加硬编码约束。

## 关键要点

1. **filter 交给 LLM**：`NewAgenticFilterSearchTool` 让模型看元数据菜单自主选 filter。
2. **元数据是前提**：source 没打元数据，agentic filter 无从下手。
3. **每 query 独立判断**：不同 query 可生成不同 filter，比硬编码灵活。
4. **多一次 LLM 调用**：换灵活性，代价是延迟和 token。
5. **与 metadata-filter 正交**：可叠加使用。

## 总结

agentic-filter 是"智能版"的元数据过滤——让 LLM 替你写 filter 逻辑。它要求 source 上有足够丰富的元数据（先用 [`file-source`](./knowledge-sources-file.md) 的 `WithMetadataValue` 注入）。如果过滤逻辑明确固定，回到 [`metadata-filter`](./knowledge-features-metadata-filter.md) 省一次 LLM 调用；如果查询多样且元数据丰富，agentic 更省心。
