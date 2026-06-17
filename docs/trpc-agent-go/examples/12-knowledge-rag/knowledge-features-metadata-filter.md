# Metadata Filter 示例 - 程序化 AND/OR/NOT 元数据过滤

> **源码路径**：[`trpc-agent-go/examples/knowledge/features/metadata-filter/`](../../../../trpc-agent-go/examples/knowledge/features/metadata-filter)
> **示例类型**：检索精度增强 · **难度**：进阶

## 概述

`features/metadata-filter/` 由**开发者程序化**构造元数据过滤条件（Equal / OR / AND / NOT 及其嵌套），把检索范围严格限定在符合条件的子集。与 [`agentic-filter`](./knowledge-features-agentic-filter.md) 是一对：后者把过滤交给 LLM，本示例由代码完全掌控。底层用 `searchfilter` 包的 DSL 构造过滤树。

## 核心概念

### 两种注入方式

本示例演示把 filter **绑在工具上**（每个工具一种固定 filter），适合"为不同业务场景定制专用检索工具"：

```go
// 方式 1：简单等值过滤（map 形式）
tool := knowledgetool.NewKnowledgeSearchTool(kb,
    knowledgetool.WithToolName("search_programming"),
    knowledgetool.WithFilter(map[string]any{
        "metadata.topic": "programming",
    }),
)

// 方式 2：复合条件（searchfilter DSL）
tool := knowledgetool.NewKnowledgeSearchTool(kb,
    knowledgetool.WithToolName("search_all_topics"),
    knowledgetool.WithConditionedFilter(
        searchfilter.Or(
            searchfilter.Equal("metadata.topic", "programming"),
            searchfilter.Equal("metadata.topic", "machine_learning"),
        ),
    ),
)
```

| API | 用途 |
|-----|------|
| `WithFilter(map)` | 简单等值 AND（map 里多 key 自动 AND） |
| `WithConditionedFilter(cond)` | 任意复合条件（OR/AND/NOT/嵌套） |

### searchfilter DSL

`searchfilter` 包提供组合子构造过滤树：

```go
// Equal：等值
searchfilter.Equal("metadata.topic", "programming")

// OR：任一满足
searchfilter.Or(
    searchfilter.Equal("metadata.topic", "programming"),
    searchfilter.Equal("metadata.topic", "machine_learning"),
)

// AND：全部满足
searchfilter.And(
    searchfilter.Equal("metadata.topic", "programming"),
    searchfilter.Equal("metadata.difficulty", "beginner"),
)

// NOT：取反
searchfilter.Not(searchfilter.Equal("metadata.topic", "advanced"))
```

这些组合子可任意嵌套，例如 `(A AND B) OR (NOT C)`。

### metadata 字段路径

filter 的字段名要用 `metadata.` 前缀，对应 source 通过 `WithMetadataValue` 注入的键：

```go
// source 端
file.WithMetadataValue("topic", "programming")

// filter 端
searchfilter.Equal("metadata.topic", "programming")
```

## 代码解析

### 四个对照工具

示例构造 4 个工具演示不同 filter 写法：

| # | 工具名 | filter | 验证点 |
|---|--------|--------|--------|
| 1 | `search_programming` | `topic=programming`（map） | 简单等值 |
| 2 | `search_all_topics` | `topic=programming OR topic=machine_learning` | OR |
| 3 | `search_beginner_programming` | `topic=programming AND difficulty=beginner` | AND |
| 4 | `search_any_difficulty` | `difficulty=beginner OR difficulty=advanced` | 同字段多值 OR |

```go
// 示例 3：AND
andFilterTool := knowledgetool.NewKnowledgeSearchTool(kb,
    knowledgetool.WithToolName("search_beginner_programming"),
    knowledgetool.WithToolDescription("Search beginner-level programming documentation"),
    knowledgetool.WithConditionedFilter(
        searchfilter.And(
            searchfilter.Equal("metadata.topic", "programming"),
            searchfilter.Equal("metadata.difficulty", "beginner"),
        ),
    ),
    knowledgetool.WithMaxResults(5),
)
```

注意每个工具有独立的 `WithToolName` 和 `WithToolDescription`——这让 LLM 看到 N 个语义清晰的检索工具，按场景选用。

### 同字段 OR 的"参数冲突"测试

第 4 个工具故意用同一字段（`difficulty`）的两个值做 OR，验证框架对"同 key 多 value"的处理——这是元数据过滤的常见坑（部分后端不支持同字段多值 OR）。本示例验证 trpc-agent-go 的 `searchfilter` DSL 能正确处理。

### 元数据注入

```go
file.New([]string{util.ExampleDataPath("file/llm.md")},
    file.WithName("LLM Docs"),
    file.WithMetadataValue("topic", "machine_learning"),
    file.WithMetadataValue("difficulty", "advanced"),
)
```

注意 LLM 文档被打成 `advanced`，Golang 文档被打成 `beginner`——这是 AND 案例能筛掉 LLM 文档的关键。

## 运行方式

### 环境变量与参数

| 变量/参数 | 必需 | 说明 | 默认值 |
|----------|------|------|--------|
| `OPENAI_API_KEY` | 是 | LLM + embedding | — |
| `MODEL_NAME` | 否 | 模型 | `deepseek-v4-flash` |
| `-vectorstore` | 否 | 后端 | `inmemory` |

### 运行命令

```bash
cd examples/knowledge/features/metadata-filter
export OPENAI_API_KEY="sk-xxxx"
go run main.go
```

### 预期输出

```
🔎 Metadata Filter Demo
=======================
Model: deepseek-v4-flash
Vector Store: inmemory

1️⃣ Filter: metadata.topic=programming (using WithFilter)
   🔍 Query: What are the key features of Go programming language?
   🤖 Response: Go features goroutines, channels...

2️⃣ Filter: metadata.topic=programming OR metadata.topic=machine_learning (using WithConditionedFilter)
   🔍 Query: What advanced topics are covered?
   🤖 Response: ...

3️⃣ Filter: metadata.topic=programming AND metadata.difficulty=beginner (using WithConditionedFilter)
   🔍 Query: How do I get started with Go?
   🤖 Response: ...   (只命中 Golang Docs，LLM Docs 被 AND 筛掉)

4️⃣ Filter: metadata.difficulty=beginner OR metadata.difficulty=advanced (Parameter conflict test)
   🔍 Query: List all documents with any difficulty level.
   🤖 Response: ...
```

## 适用场景与对比

**选 metadata-filter 当：**
- 过滤逻辑明确固定（"只搜已发布"、"排除草稿"）
- 需要严格可控的复合条件（AND/OR/NOT 嵌套）
- 不想多花一次 LLM 调用
- 想为不同业务场景定制多个专用检索工具（每个工具一种 filter）

**选 [`agentic-filter`](./knowledge-features-agentic-filter.md) 当：**
- 元数据维度多、查询表达多样
- 想让 LLM 自动选 filter
- 接受多一次 LLM 调用

| 维度 | metadata-filter | agentic-filter |
|------|-----------------|----------------|
| filter 来源 | 代码硬编码 | LLM 生成 |
| 灵活性 | 低（编译期固定） | 高（每 query 不同） |
| 复合逻辑 | ✅ AND/OR/NOT/嵌套 | 取决于 LLM |
| LLM 调用 | 0 | +1 |
| 工具数量 | N 个（每种 filter 一个） | 1 个 |

## 关键要点

1. **两种注入 API**：`WithFilter(map)` 简单等值；`WithConditionedFilter(DSL)` 复合条件。
2. **searchfilter DSL**：`Equal` / `Or` / `And` / `Not` 可任意嵌套。
3. **字段路径前缀**：filter 字段必须以 `metadata.` 开头对应 source 元数据。
4. **多工具策略**：每种 filter 一个工具，靠 `WithToolName` 区分，LLM 按场景选用。
5. **同字段多值**：OR 能处理同字段多 value（部分后端有坑，本示例专门验证）。

## 总结

metadata-filter 是"确定性版"的元数据过滤——用代码完全掌控过滤逻辑，不引入额外 LLM 调用。它和 [`agentic-filter`](./knowledge-features-agentic-filter.md) 互补：固定逻辑用本示例，灵活判断用 agentic。两者都依赖 source 端通过 `WithMetadataValue` 注入的元数据，所以要先在 [`file-source`](./knowledge-sources-file.md) / [`directory-source`](./knowledge-sources-directory.md) 上把元数据打齐。
