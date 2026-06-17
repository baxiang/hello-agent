# 文件源示例 - 多文件 + 元数据的 RAG 接入

> **源码路径**：[`trpc-agent-go/examples/knowledge/sources/file-source/`](../../../../trpc-agent-go/examples/knowledge/sources/file-source)
> **示例类型**：数据源 · **难度**：入门

## 概述

`sources/file-source/` 演示最常用的 RAG 数据源——**本地文件**：把 `llm.md` 和 `golang.md` 两个 Markdown 文件挂上自定义元数据，注入 Knowledge Base，让 Agent 跨文件回答问题。它是 [`basic`](./knowledge-basic.md) 的"去目录、纯文件、加元数据"版本，也是其它源类型（[`directory`](./knowledge-sources-directory.md)、[`url`](./knowledge-sources-url.md)、[`auto`](./knowledge-sources-auto.md)）的对照基准。

## 核心概念

### `file.New` + 元数据注入

```go
sources := []source.Source{
    file.New(
        []string{util.ExampleDataPath("file/llm.md")},
        file.WithName("LLM Docs"),
        file.WithMetadataValue("category", "machine_learning"),
        file.WithMetadataValue("format", "markdown"),
    ),
    file.New(
        []string{util.ExampleDataPath("file/golang.md")},
        file.WithName("Golang Docs"),
        file.WithMetadataValue("category", "programming"),
        file.WithMetadataValue("format", "markdown"),
    ),
}
```

`WithName` 给 source 起人类可读名（出现在检索结果的 `source_name` 元数据里），`WithMetadataValue` 逐字段附加自定义元数据——这些字段后续可被 [`metadata-filter`](./knowledge-features-metadata-filter.md) / [`agentic-filter`](./knowledge-features-agentic-filter.md) 用来过滤。

### 支持的文件格式

| 扩展名 | 说明 | 是否需额外 import |
|--------|------|------------------|
| `.md` | Markdown | 内置 |
| `.txt` | 纯文本 | 内置 |
| `.csv` | CSV | 内置 |
| `.json` | JSON | 内置 |
| `.pdf` | PDF | 需 `_ "...document/reader/pdf"` |
| `.docx` | Word | 需对应 reader |

本示例 main.go 顶部就 blank-import 了 PDF reader：

```go
_ "trpc.group/trpc-go/trpc-agent-go/knowledge/document/reader/pdf"
```

### 与其它源的对比

| 源 | 输入 | 是否抓取 | 是否递归 | 元数据 |
|----|------|---------|---------|--------|
| **file** | 本地文件路径 | 否 | 否 | ✅ |
| [`dir`](./knowledge-sources-directory.md) | 本地目录 | 否 | ✅ | ✅ |
| [`url`](./knowledge-sources-url.md) | URL | ✅ HTTP | 否 | ✅ |
| [`auto`](./knowledge-sources-auto.md) | 混合（自动判别） | ✅ | ✅ | ✅ |

## 代码解析

### 标准五步 + 元数据

```go
// 1. 创建带元数据的 file 源（见上）
// 2-3. 向量库 + embedder
storeType := util.VectorStoreType(*vectorStore)
vs, _ := util.NewVectorStoreByType(storeType)

// 4. Knowledge Base
kb := knowledge.New(
    knowledge.WithVectorStore(vs),
    knowledge.WithEmbedder(openai.New()),
    knowledge.WithSources(sources),
)
kb.Load(ctx)

// 5. 工具 + Agent + Runner
searchTool := knowledgetool.NewKnowledgeSearchTool(kb)
agent := llmagent.New("file-assistant",
    llmagent.WithModel(openaimodel.New(modelName)),
    llmagent.WithTools([]tool.Tool{searchTool}),
)
```

### 元数据在检索结果里的呈现

检索结果每条文档的 `metadata` 会带上：

| key | 来源 |
|-----|------|
| `category`、`format` | 你通过 `WithMetadataValue` 注入 |
| `source_name` | 框架自动加（= `WithName` 的值） |
| `trpc_agent_go_*` | 框架自动加（chunk_index、file_path 等） |

## 运行方式

### 环境变量

| 变量 | 必需 | 说明 | 默认值 |
|------|------|------|--------|
| `OPENAI_API_KEY` | 是 | LLM + embedding Key | — |
| `OPENAI_BASE_URL` | 否 | 端点 | `https://api.openai.com/v1` |
| `MODEL_NAME` | 否 | 模型 | `deepseek-v4-flash` |

### 命令行参数

| 参数 | 说明 | 默认值 |
|------|------|--------|
| `-vectorstore` | `inmemory` \| `sqlitevec` \| `pgvector` \| `tcvector` \| `elasticsearch` | `inmemory` |

### 运行命令

```bash
cd examples/knowledge/sources/file-source
export OPENAI_API_KEY="sk-xxxx"
go run main.go
```

### 预期输出

```
📄 File Source Demo
===================
Vector Store: inmemory

🔍 Testing knowledge search...
🔧 Tool Calls:
  - Function: knowledge_search
    Arguments: {"query":"difference between LLMs and traditional programming"}
📦 Tool Response:
  Documents:
  #1 score=0.521
    text: LLMs differ from traditional programming because...
    meta: category=machine_learning, format=markdown, source_name=LLM Docs
  #2 score=0.412
    text: Go is a statically typed programming language...
    meta: category=programming, format=markdown, source_name=Golang Docs
🤖 Response: ...
```

## 适用场景与对比

**选 file-source 当：**
- 文档已是本地文件（PDF/DOCX/MD/TXT）
- 每个文件需要打自定义标签（部门、机密级、语言等）
- 文件数量不多，可手动列举

**升级路径：**
- 文件多到列不过来 → [`directory-source`](./knowledge-sources-directory.md)（递归扫目录）
- 文档在网上 → [`url-source`](./knowledge-sources-url.md)
- 来源混杂（文本+文件+URL）→ [`auto-source`](./knowledge-sources-auto.md)
- 想控制分块策略 → [`fixed-chunking`](./knowledge-sources-fixed-chunking.md) / [`recursive-chunking`](./knowledge-sources-recursive-chunking.md)
- 代码仓库 → [`ast`](./knowledge-sources-ast.md)

## 关键要点

1. **元数据是过滤的基石**：`WithMetadataValue` 注入的字段后续可被 metadata-filter / agentic-filter 利用。
2. **`WithName` 影响可观测性**：检索结果的 `source_name` 来自这里，起好名字便于调试。
3. **PDF 等格式需 import reader**：blank-import 注册 reader 是 trpc-agent-go 的扩展机制。
4. **五步骨架不变**：与 basic 完全一致，只是 Source 实现换了。

## 总结

file-source 是最朴素也最常用的 RAG 数据源。理解了它，就理解了"数据如何进入 Knowledge Base"。需要批量加载时换 [`directory`](./knowledge-sources-directory.md)，需要抓网页时换 [`url`](./knowledge-sources-url.md)，需要按语义切块时配合 [`chunking`](./knowledge-sources-fixed-chunking.md) 策略。
