# 定长分块示例 - FixedSizeChunking 策略

> **源码路径**：[`trpc-agent-go/examples/knowledge/sources/fixed-chunking/`](../../../../trpc-agent-go/examples/knowledge/sources/fixed-chunking)
> **示例类型**：分块策略 · **难度**：入门

## 概述

`sources/fixed-chunking/` 演示最简单的分块策略——**FixedSizeChunking**：按固定字符数切分文档，可选重叠。它在加载前先 `Chunk()` 一份预览展示效果，再通过 `file.WithCustomChunkingStrategy` 把策略注入 source。与 [`recursive-chunking`](./knowledge-sources-recursive-chunking.md) 是同系列对照示例。

## 核心概念

### FixedSizeChunking 配置

```go
fixedChunking := chunking.NewFixedSizeChunking(
    chunking.WithChunkSize(100),  // 每块最多 100 字符
    chunking.WithOverlap(10),     // 相邻块重叠 10 字符
)
```

| 参数 | 作用 | 取值 |
|------|------|------|
| `WithChunkSize(n)` | 每块最大字符数 | 任意正整数（UTF-8 安全） |
| `WithOverlap(n)` | 相邻块共享的字符数 | `< chunkSize` |

### 重叠的作用

重叠保证句子/词组不会从中间被切断时丢失上下文。例：

```
chunk1: [...A B C D E F G H I J]   ← 100 chars
chunk2: [I J K L M N O P Q R S T]  ← 重叠 "I J" 10 chars
```

这样检索 chunk2 时仍能看到 chunk1 末尾的几个字符，避免边界信息丢失。

### 预览 + 入库两阶段

示例先在加载前调用 `Chunk()` 拿到分块结果，打印预览，再用同样策略真正入库：

```go
// 预览
doc := &document.Document{ID: "llm-doc", Name: "llm.md", Content: string(content)}
chunks, _ := fixedChunking.Chunk(doc)
fmt.Printf("Number of chunks: %d\n", len(chunks))

// 入库（注入策略）
src := file.New([]string{filePath},
    file.WithCustomChunkingStrategy(fixedChunking),
)
```

这种"先预览后入库"的写法便于调参：先看 chunk 数和内容切片是否合理，再决定是否入库。

## 代码解析

### 与默认分块的区别

不指定 `WithCustomChunkingStrategy` 时，框架用默认策略（通常是 recursive + 较大 chunk size）。指定后整个 source 的所有文档都走该策略。

### chunk ID 与 metadata

每个 chunk 自动带 `trpc_agent_go_chunk_index` 元数据，便于追溯。预览输出：

```
Original document size: 4200 characters
Number of chunks: 47

Chunk details(first 3):
  Chunk 1: ID=llm-doc-0, Size=100 chars
    Preview: A Large Language Model (LLM) is a neural network trained on massive...
  Chunk 2: ID=llm-doc-1, Size=100 chars
    Preview: ... corpora. LLMs can process and generate human-like text...
```

## 运行方式

### 环境变量与参数

| 变量/参数 | 必需 | 说明 | 默认值 |
|----------|------|------|--------|
| `OPENAI_API_KEY` | 是 | LLM + embedding | — |
| `MODEL_NAME` | 否 | 模型 | `deepseek-v4-flash` |
| `-vectorstore` | 否 | 后端 | `inmemory` |

### 运行命令

```bash
cd examples/knowledge/sources/fixed-chunking
export OPENAI_API_KEY="sk-xxxx"
go run main.go
```

## 参数调优经验

### chunkSize 怎么选

| 场景 | 推荐 chunkSize | 理由 |
|------|---------------|------|
| 短问答（FAQ） | 200–400 | 答案紧凑，大 chunk 引入噪声 |
| 技术文档 | 500–1000 | 平衡上下文与精度 |
| 长文综述 | 1000–2000 | 保留段落连贯性 |
| 代码 | 不建议用 Fixed | 用 [`ast`](./knowledge-sources-ast.md) 按 AST 切 |

chunkSize 过小 → chunk 数爆炸、embedding 成本高、上下文碎片化；过大 → 单 chunk 信息过多、检索精度下降、可能超 embedding 模型上限。

### overlap 怎么选

- 经验值：`chunkSize` 的 10%–20%
- 例：`chunkSize=500` → `overlap=50–100`
- 太小 → 边界句子被切断丢失
- 太大 → chunk 数膨胀、重复内容多

### 与 embedding 模型 token 上限的关系

chunkSize 是**字符数**，embedding 模型限制是 **token 数**。中文 1 字符 ≈ 1–2 token，英文 1 字符 ≈ 0.25 token。`text-embedding-3-small` 上限 8191 token，所以中文 chunkSize 不要超过 4000、英文不要超过 30000（实际远低于此即可）。

## 适用场景与对比

**选 FixedSizeChunking 当：**
- 文档格式统一、无强语义结构（纯文本日志、聊天记录）
- 需要可预测的 chunk 数量（按字符均匀切）
- 想要简单可控的基线策略

**选 [`RecursiveChunking`](./knowledge-sources-recursive-chunking.md) 当：**
- 文档有段落/句子结构（Markdown、文章）
- 想优先在自然边界切分

| 维度 | FixedSize | Recursive |
|------|-----------|-----------|
| 切分依据 | 字符数 | 分隔符层级（段落→行→句→空格） |
| 边界质量 | 可能切断句子 | 优先在自然边界 |
| chunk 大小 | 严格均匀 | 大致均匀（受分隔符影响） |
| 配置复杂度 | 2 参数 | 3 参数（含分隔符列表） |

## 关键要点

1. **最简策略**：FixedSize 只需 `chunkSize` + `overlap` 两个参数。
2. **UTF-8 安全**：按 rune 切，不会切出半个中文。
3. **重叠防丢上下文**：相邻块共享若干字符，缓解边界断裂。
4. **预览再入库**：`Chunk()` 可独立调用，便于调参。
5. **注入方式统一**：`file.WithCustomChunkingStrategy` 是所有策略的注入点。

## 总结

FixedSizeChunking 是分块策略的"下限基线"——简单、可预测、UTF-8 安全。生产文档（带段落结构）建议升级到 [`recursive-chunking`](./knowledge-sources-recursive-chunking.md)，让切分尽量发生在自然边界。两者通过同一个 `WithCustomChunkingStrategy` 注入，切换零成本。
