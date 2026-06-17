# AST 仓库源示例 - 代码 AST 解析 + 多语言仓库入库

> **源码路径**：[`trpc-agent-go/examples/knowledge/sources/ast/`](../../../../trpc-agent-go/examples/knowledge/sources/ast)
> **示例类型**：代码 RAG 数据源 · **难度**：进阶

## 概述

`sources/ast/` 是 Knowledge 系列里**最特殊**的源示例：用 `repo.New` 直接 clone 一个 Git 仓库，按 AST（抽象语法树）解析 Go 文件，再叠加一个 `dir` 源加载 Proto 文件。所有 chunk 都带 `trpc_ast_*` 前缀的结构化元数据（包名、签名、行号、接收者类型等），让代码检索能精确到"函数 / 类型 / 方法"粒度。是 [`graphrag`](./knowledge-features-graphrag.md) 和 [`code_context_engine`](./knowledge-features-code-context-engine.md) 的数据基础。

## 核心概念

### repo source：Git URL → AST 文档

```go
src := repo.New(
    repo.WithRepository(repo.Repository{
        URL:    "https://github.com/trpc-group/trpc-go",
        Branch: "main",
    }),
    repo.WithName("AST Repository"),
    repo.WithFileExtensions([]string{".go", ".md"}),
)
```

`repo.New` 内部完成：clone 仓库 → 按扩展名筛选 → 调用对应 reader（Go reader 做 AST 解析，markdown reader 做纯文本）→ 输出带 `trpc_ast_*` 元数据的文档。

### dir source 加载 Proto

```go
protoSrc := dir.New(
    []string{util.ExampleDataPath("ast/proto-lib")},
    dir.WithName("AST Proto Source"),
    dir.WithRecursive(true),
    dir.WithFileExtensions([]string{".proto"}),
)
```

两个源最终合并进同一个 Knowledge Base。

### `trpc_ast_*` 元数据层

AST reader 提取的元数据全部以 `trpc_ast_` 前缀对齐 [`trpc-ast-rag`](../../../../trpc-ast-rag) 约定：

| 元数据 Key | 含义 |
|-----------|------|
| `trpc_ast_name` | 实体名（如 `Server`） |
| `trpc_ast_full_name` | 全限定名（如 `trpc.group/trpc-go/trpc-go/server.Server`） |
| `trpc_ast_package` | 包路径 |
| `trpc_ast_signature` | 签名（如 `type Server struct`、`func WithTimeout(t time.Duration) Option`） |
| `trpc_ast_type` | 实体类型（`Struct` / `Function` / `Method` / `Service`） |
| `trpc_ast_scope` | `code` / `proto` |
| `trpc_ast_language` | `go` / `proto` |
| `trpc_ast_file_path` | 相对仓库的文件路径 |
| `trpc_ast_line_start` / `trpc_ast_line_end` | 行号范围 |
| `trpc_ast_receiver_type` | Go 方法接收者类型 |
| `trpc_ast_services` / `trpc_ast_service_count` | Proto 服务名 |
| `trpc_ast_imports` / `trpc_ast_import_count` | 依赖 |

这套元数据是后续 [`metadata-filter`](./knowledge-features-metadata-filter.md) 和 [`graphrag`](./knowledge-features-graphrag.md) 图遍历的基础。

### 两阶段时间：parse vs Load

| 阶段 | 耗时来源 |
|------|---------|
| `Repo source parse time` | git clone + AST 解析 + reader 分发 |
| `knowledge.Load time` | 上述 + embedding 生成 + 向量库写入 |

mock embedder 模式下两者差距主要是 embedding；real OpenAI 模式下 Load 远大于 parse。

## 代码解析

### embedder 三模式

```go
var embedderMode = flag.String("embedder", "mock",
    "Embedder mode: auto|mock|openai. mock is useful for chunk preview...")

func chooseEmbedder(mode, apiKey string) (embedder.Embedder, string, error) {
    switch strings.ToLower(strings.TrimSpace(mode)) {
    case "", "auto":
        if apiKey != "" { return openai.New(), "openai", nil }
        return mockEmbedder{}, "mock", nil
    case "mock":   return mockEmbedder{}, "mock", nil
    case "openai":
        if apiKey == "" { return nil, "", fmt.Errorf("embedder=openai requires OPENAI_API_KEY") }
        return openai.New(), "openai", nil
    }
}
```

- `auto`：有 Key 用 OpenAI，否则 mock
- `mock`：强制用进程内 mock（3 维伪向量），**仅用于本地预览 chunk**，语义检索不可靠
- `openai`：强制用 OpenAI，无 Key 直接报错

mock 模式下 AST 解析、chunk 生成、元数据提取、仓库加载、dump 输出都正常，**只有语义相似度不可信**——这让本示例可在无 API Key 环境下跑通，验证 chunking 行为。

### 维度协商

```go
vs, err := util.NewVectorStoreByTypeWithDimension(storeType, emb.GetDimensions())
```

注意这里用的是 `WithDimension` 版本（而非 `NewVectorStoreByType`），因为 mock embedder 是 3 维，OpenAI 是高维，向量库要按实际维度建表/索引。

### dump 输出

```go
var dumpDir = flag.String("dumpdir", "chunked",
    "Output directory for parsed documents... under go-reader/proto-reader/repo-source")
```

AST 解析后的每个 chunk 会按源码目录结构 dump 到 `./chunked/{section}/...`，每个 `.txt` 包含：parsed content、embedding text（JSON）、完整 metadata。这是调试 AST 提取效果的核心工件。

dump 片段示例（Go `Server` 结构体）：

```
parsed content:
index: 7
name: Server
content_length: 570

content:
// Server is a tRPC server.
type Server struct { ... }

embedding text:
{
  "comment": "Server is a tRPC server...",
  "full_name": "trpc.group/trpc-go/trpc-go/server.Server",
  "name": "Server",
  "package": "trpc.group/trpc-go/trpc-go/server",
  "signature": "type Server struct",
  "type": "Struct"
}

metadata:
trpc_ast_full_name: trpc.group/trpc-go/trpc-go/server.Server
trpc_ast_signature: type Server struct
trpc_ast_type: Struct
trpc_ast_line_start: 26
trpc_ast_line_end: 42
trpc_ast_imports: [context errors os sync time]
...
```

## 运行方式

### 环境变量与参数

| 变量/参数 | 必需 | 说明 | 默认值 |
|----------|------|------|--------|
| `OPENAI_API_KEY` | 否 | 缺失则用 mock embedder | — |
| `MODEL_NAME` | 否 | 模型 | `deepseek-v4-flash` |
| `-vectorstore` | 否 | 后端 | `inmemory` |
| `-dumpdir` | 否 | dump 目录 | `chunked` |
| `-gorepo` | 否 | Go 仓库 URL | `https://github.com/trpc-group/trpc-go` |
| `-embedder` | 否 | `auto` / `mock` / `openai` | `mock` |

### 运行命令

```bash
cd examples/knowledge/sources/ast

# 无 Key：mock embedder，预览 AST chunk
go run main.go

# 真 OpenAI：完整语义检索
export OPENAI_API_KEY="sk-xxxx"
go run main.go -embedder openai

# 自定义 dump 目录
mkdir -p /tmp/ast-demo-output
go run main.go -dumpdir /tmp/ast-demo-output

# 切后端
go run main.go -vectorstore pgvector
```

### 预期输出

```
🔮 AST Source Demo (Repo Source)
================================
Go repository URL: https://github.com/trpc-group/trpc-go
Proto repository root: .../exampledata/ast/proto-lib

📦 Step 1: Repo source preview on a repository
----------------------------------------------
✓ Repo source parsed 312 documents from repository
✓ Repo source parse time: 2.314s
✓ This source path covers Go AST extraction and markdown/document ingestion
✓ Proto AST is loaded via an additional directory source

⚠️  Using MOCK embedder. Similarity search quality is not reliable...
✓ Loading mixed-language repository into knowledge base with vector store=inmemory
✓ knowledge.Load completed
✓ knowledge.Load time: 13.019s

✅ Demo completed!
```

## 适用场景与对比

**选 ast source 当：**
- 知识库是代码仓库（问答、辅助阅读、跨仓库搜索）
- 需要"按函数 / 类型 / 方法"粒度检索
- 要为 [`graphrag`](./knowledge-features-graphrag.md) / [`code_context_engine`](./knowledge-features-code-context-engine.md) 准备数据
- 多语言仓库（Go + Proto + Markdown 等）

**对比通用源：**

| 维度 | file / dir | repo（AST） |
|------|-----------|-------------|
| 输入粒度 | 文件 / 文本块 | 函数 / 类型 / 方法 |
| 元数据 | 用户自定义 | `trpc_ast_*` 结构化 |
| 是否 clone | 否 | ✅（Git URL） |
| 多语言 | reader 按扩展名 | reader 按 AST（Go/Proto/Python 等） |
| 适合 | 文档 RAG | 代码 RAG |

## 关键要点

1. **repo source 是代码 RAG 入口**：Git URL 直接 clone + AST 解析。
2. **`trpc_ast_*` 是统一语义层**：所有 AST reader 输出一致前缀的元数据。
3. **mock embedder 可离线预览**：无 Key 也能跑通 chunk 生成与 dump。
4. **维度协商**：用 `NewVectorStoreByTypeWithDimension` 适配 embedder 维度。
5. **dump 是调试工件**：每个 chunk 的 content + embedding text + metadata 全落盘。

## 总结

ast source 是代码 RAG 的根基——把仓库转成结构化的、带 `trpc_ast_*` 元数据的 chunk 文档。它是 [`graphrag`](./knowledge-features-graphrag.md)（图遍历）和 [`code_context_engine`](./knowledge-features-code-context-engine.md)（MCP 暴露）的共享数据层。如果只需要简单的代码语义检索，直接用本示例 + [`basic`](./knowledge-basic.md) 模式的工具封装即可；需要调用链分析时再升级到 graphrag。
