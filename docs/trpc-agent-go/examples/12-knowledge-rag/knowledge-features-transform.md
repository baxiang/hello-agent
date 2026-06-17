# 文档转换示例 - CharFilter / CharDedup 文本清洗

> **源码路径**：[`trpc-agent-go/examples/knowledge/features/transform/`](../../../../trpc-agent-go/examples/knowledge/features/transform)
> **示例类型**：内容清洗 · **难度**：入门

## 概述

`features/transform/` 演示 **Transformer** 接口：在分块和向量化之前对文档内容做字符级清洗。本示例展示两种内置 transformer——`CharFilter`（删字符）和 `CharDedup`（合并连续重复字符），并演示如何组合使用。是处理含 tab、多余空格、乱码字符的"脏数据"的轻量工具。

## 核心概念

### Transformer 接口

`transform.Transformer` 是文档入库前的"清洗管线"，通过 `file.WithTransformers(...)` 注入：

```go
src := file.New([]string{path},
    file.WithTransformers(transformer1, transformer2, ...),
)
```

多个 transformer 按顺序执行，前一个的输出是后一个的输入。

### 两种内置 Transformer

```go
// CharFilter：删除指定字符
charFilter := transform.NewCharFilter("\t")     // 删除所有 tab

// CharDedup：合并连续重复的指定字符
charDedup := transform.NewCharDedup(" ", "x")   // 连续空格→1个，连续 x→1个
```

| Transformer | 作用 | 参数 |
|------------|------|------|
| `NewCharFilter(chars...)` | 删除指定字符 | 要删的字符列表 |
| `NewCharDedup(chars...)` | 合并连续重复 | 要去重的字符列表 |

### 对照实验

本示例用同一份"脏"测试数据（`exampledata/file/content_transform.md`，含 tab、连续空格、`xxxxx` 模式）跑四种配置：

| # | 配置 | 效果 |
|---|------|------|
| 1 | 无 transformer（基线） | 保留所有脏字符 |
| 2 | CharFilter("\t") | 删 tab |
| 3 | CharDedup(" ", "x") | 合并连续空格和 x |
| 4 | CharFilter + CharDedup | 先删 tab 再去重 |

## 代码解析

### 四种配置的复用函数

```go
func runDemo(ctx context.Context, demoName string, transformers ...transform.Transformer) {
    opts := []file.Option{file.WithName(demoName)}
    if len(transformers) > 0 {
        opts = append(opts, file.WithTransformers(transformers...))
    }
    src := file.New([]string{util.ExampleDataPath("file/content_transform.md")}, opts...)

    kb := knowledge.New(
        knowledge.WithVectorStore(inmemory.New()),
        knowledge.WithEmbedder(openai.New()),
        knowledge.WithSources([]source.Source{src}),
    )
    kb.Load(ctx)

    // 用 SearchModeFilter 拿到所有 chunk（无相似度过滤）
    result, _ := kb.Search(ctx, &knowledge.SearchRequest{
        Query:      "",
        MaxResults: len(docInfos),
        SearchMode: vectorstore.SearchModeFilter,
    })
    for i, res := range result.Documents {
        fmt.Printf("   Chunk %d: %q\n", i+1, res.Document.Content)
    }
}
```

关键点：用 `SearchModeFilter` 模式 + 空 query 拿到所有 chunk，便于对比清洗前后内容。

### 主流程：四种配置对比

```go
func main() {
    // 1. 基线（无清洗）
    runDemo(ctx, "No Transform")

    // 2. 删 tab
    charFilter := transform.NewCharFilter("\t")
    runDemo(ctx, "CharFilter", charFilter)

    // 3. 合并连续空格和 x
    charDedup := transform.NewCharDedup(" ", "x")
    runDemo(ctx, "CharDedup", charDedup)

    // 4. 组合：先删 tab 再去重
    filter := transform.NewCharFilter("\t")
    dedup := transform.NewCharDedup(" ", "x")
    runDemo(ctx, "Combined", filter, dedup)
}
```

### 组合顺序很重要

transformer 按传入顺序执行。例 4 先删 tab 再去重——如果反过来，连续 tab 会先被 CharDedup（未配置 tab）跳过，再被 CharFilter 删，效果不同。

## 运行方式

### 环境变量

| 变量 | 必需 | 说明 | 默认值 |
|------|------|------|--------|
| `OPENAI_API_KEY` | 是 | embedding | — |
| `OPENAI_BASE_URL` | 否 | 端点 | `https://api.openai.com/v1` |

> 注意：本示例无 `-vectorstore` flag，硬编码用 `inmemory.New()`。

### 运行命令

```bash
cd examples/knowledge/features/transform
export OPENAI_API_KEY="sk-xxxx"
go run main.go
```

### 预期输出（对照效果）

```
Transform Demo
==============

1. No Transformer (baseline)
   Source: No Transform
   Total chunks: 3
   Chunk 1: "This\tdocument\t\thas\ttabs        and     xxxxx..."
   Chunk 2: "..."

2. CharFilter: Remove tabs
   Chunk 1: "Thisdocumenthas tabs        and     xxxxx..."   ← tab 没了

3. CharDedup: Collapse consecutive spaces and 'x' characters
   Chunk 1: "This	document		has	tabs and x..."   ← 空格和 x 去重

4. Combined: CharFilter(tabs) + CharDedup(spaces, x)
   Chunk 1: "Thisdocumenthas tabs and x..."   ← 最干净
```

## 适用场景与对比

**选 transform 当：**
- 文档含特殊字符（tab、零宽字符、控制字符）
- 多余空白影响 chunk 质量
- 来自爬虫/OCR/旧系统的"脏数据"

**对比其它清洗时机：**

| 时机 | 工具 | 优点 | 缺点 |
|------|------|------|------|
| 入库前（Source） | `transform.Transformer` | 一次清洗永久受益 | 需重新入库才能改 |
| 入库前（Extractor） | [`Docling`](./knowledge-features-extractor.md) | 结构化转换 | 重（需服务） |
| 查询时 | [`query-enhancer`](./knowledge-query-enhancer.md) | 改 query | 不改文档 |

transform 适合"轻量字符级清洗"，Docling 适合"重型的格式转换"。

### 扩展自定义 transformer

`transform.Transformer` 是接口，可实现自定义逻辑：

```go
type MyTransformer struct{}
func (t *MyTransformer) Transform(...) (...) { /* 自定义逻辑 */ }

src := file.New(..., file.WithTransformers(&MyTransformer{}))
```

例如：去 HTML 实体、归一化 Unicode、脱敏手机号等。

## 关键要点

1. **入库前清洗**：Transformer 在分块和向量化之前生效，一次清洗永久受益。
2. **`WithTransformers` 是注入点**：可传多个，按顺序执行。
3. **两种内置**：`CharFilter` 删字符，`CharDedup` 合并连续重复。
4. **顺序敏感**：多个 transformer 的传入顺序决定效果。
5. **可自定义**：实现 `transform.Transformer` 接口可写任意字符级逻辑。

## 总结

transform 是 RAG 管线里的"清洁工"——在分块前把脏数据洗干净，避免脏字符污染 chunk 边界和 embedding。轻量字符清洗用本示例的 `CharFilter` / `CharDedup`；重型格式转换用 [`extractor`](./knowledge-features-extractor.md) (Docling)；查询侧的清洗用 [`query-enhancer`](./knowledge-query-enhancer.md)。三者正交，可叠加使用。
