# 递归分块示例 - RecursiveChunking 按语义边界切分

> **源码路径**：[`trpc-agent-go/examples/knowledge/sources/recursive-chunking/`](../../../../trpc-agent-go/examples/knowledge/sources/recursive-chunking)
> **示例类型**：分块策略 · **难度**：入门

## 概述

`sources/recursive-chunking/` 演示 **RecursiveChunking**：按"段落 → 行 → 句子 → 空格"的分隔符层级递归切分，尽量让 chunk 落在自然语义边界。是 [`fixed-chunking`](./knowledge-sources-fixed-chunking.md) 的"语义升级版"，也是生产文档（Markdown、文章）的推荐默认策略。

## 核心概念

### 分隔符层级

```go
recursiveChunking := chunking.NewRecursiveChunking(
    chunking.WithRecursiveChunkSize(1000),
    chunking.WithRecursiveOverlap(0),
    chunking.WithRecursiveSeparators([]string{"\n\n", "\n", ". ", " "}),
)
```

分隔符按优先级从高到低尝试：

| 优先级 | 分隔符 | 语义含义 |
|--------|--------|---------|
| 1 | `\n\n` | 段落 |
| 2 | `\n` | 行 |
| 3 | `. ` | 句子 |
| 4 | ` ` | 单词 |

### 递归切分算法

1. 先用最高级分隔符（`\n\n`）切成段落
2. 若某段仍超过 `chunkSize`，降级用 `\n` 切
3. 还超就降级 `. `，再不行降级 ` `
4. 若所有分隔符都切不动（连续无分隔符的超长串），最后**强制按 chunkSize 切**

这样能在"chunk 大小受控"和"边界自然"之间取平衡：能切在段落就切段落，切不动再退到句子。

### 与 FixedSize 的关键区别

```go
// FixedSize：只看字符数，可能切在词中间
[0-99] [90-189] [180-279] ...   ← 重叠 10

// Recursive：先尝试语义边界
[段落1] [段落2前半 + 段落3] [段落3后半] ...   ← 大小大致均匀但边界自然
```

| 维度 | FixedSize | Recursive |
|------|-----------|-----------|
| 切分依据 | 字符数 | 分隔符层级 |
| chunk 大小方差 | 极小（严格均匀） | 中等（受分隔符位置影响） |
| 边界质量 | 可能切断句子 | ✅ 优先自然边界 |
| 适用 | 无结构文本 | 文章/Markdown/文档 |

## 代码解析

### 多 source 共享策略

示例给两个文件都注入同一个 recursiveChunking 实例：

```go
sources := []source.Source{
    file.New([]string{filePath},
        file.WithName("LLM Docs"),
        file.WithMetadataValue("chunking", "recursive"),
        file.WithCustomChunkingStrategy(recursiveChunking),
    ),
    file.New([]string{util.ExampleDataPath("file/golang.md")},
        file.WithName("Golang Docs"),
        file.WithMetadataValue("chunking", "recursive"),
        file.WithCustomChunkingStrategy(recursiveChunking),
    ),
}
```

策略实例是 stateless 的，可安全跨 source 共享。

### 默认分隔符

若不调 `WithRecursiveSeparators`，默认 `["\n\n", "\n", " ", ""]`。本示例显式传入 `". "` 把句子级分隔提前，更适合英文文档。中文场景可考虑加入 `"。"`、`"；"` 等。

## 运行方式

### 环境变量与参数

| 变量/参数 | 必需 | 说明 | 默认值 |
|----------|------|------|--------|
| `OPENAI_API_KEY` | 是 | LLM + embedding | — |
| `MODEL_NAME` | 否 | 模型 | `deepseek-v4-flash` |
| `-vectorstore` | 否 | 后端 | `inmemory` |

### 运行命令

```bash
cd examples/knowledge/sources/recursive-chunking
export OPENAI_API_KEY="sk-xxxx"
go run main.go
```

### 预期输出（预览部分）

```
Recursive Chunking Demo
========================

--- Chunking Result Preview ---
Original document size: 4200 characters
Number of chunks: 5
Separators: [paragraph(\n\n), line(\n), sentence(. ), space( ), char]

Chunk details(first 3):
  Chunk 1: ID=llm-doc-0, Size=980 chars
    Preview: A Large Language Model (LLM) is a neural network trained...
  Chunk 2: ID=llm-doc-1, Size=1000 chars
    Preview: Transformers revolutionized NLP through the attention mechanism...
```

注意 chunk 大小不严格等于 1000，而是接近——这是为了落在自然边界。

## 适用场景与对比

**选 RecursiveChunking 当：**
- 文档有段落/句子结构（绝大多数人类文档）
- chunk 边界质量直接影响检索效果
- 多语言（可自定义分隔符）

**注意点：**
- 中文要自定义分隔符（默认偏英文）
- 代码文档可考虑加入 `"\t"`、`"}"` 等
- 极长无分隔符串会被强制按字符切

**对比代码场景：**
代码的"自然边界"是函数/类，不是段落——这种场景请用 [`ast`](./knowledge-sources-ast.md) source，它按 AST 切分。

## 关键要点

1. **分隔符层级**：`\n\n` → `\n` → `. ` → ` ` → 强制切，逐级降级。
2. **大小近似均匀**：受分隔符位置影响，但都接近 `chunkSize`。
3. **多语言可配**：`WithRecursiveSeparators` 可加入 `。` `；` 等中文标点。
4. **stateless 可共享**：一个策略实例可跨多个 source 复用。
5. **生产推荐**：是人类文档的默认分块策略。

## 总结

RecursiveChunking 是文章/Markdown 等结构化文档的推荐分块策略。它通过分隔符层级让 chunk 尽量落在语义边界，既保证大小受控又避免切断句子。代码类内容应升级到 [`ast`](./knowledge-sources-ast.md) source 按 AST 切分；纯日志类无结构文本退回 [`fixed-chunking`](./knowledge-sources-fixed-chunking.md)。
