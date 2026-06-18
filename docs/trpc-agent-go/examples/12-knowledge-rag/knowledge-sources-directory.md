# 目录源示例 - 递归扫描整个文档目录

> **源码路径**：[`trpc-agent-go/examples/knowledge/sources/directory-source/`](../../../../trpc-agent-go/examples/knowledge/sources/directory-source)
> **示例类型**：数据源 · **难度**：入门

## 概述

`sources/directory-source/` 用 `dir.New` **递归扫描**整个目录，自动识别支持的文件格式并批量入库——不用逐个文件列举。与 [`file-source`](./knowledge-sources-file.md) 的区别是输入从"文件路径列表"升级为"目录路径"，框架自动遍历。

## 核心概念

### `dir.New` + 递归选项

```go
src := dir.New(
    []string{util.ExampleDataPath("dir")},
    dir.WithName("Documentation Directory"),
    dir.WithMetadataValue("source_type", "directory"),
    dir.WithMetadataValue("category", "docs"),
)
```

主要选项：

| 选项 | 作用 |
|------|------|
| `WithName` | source 名称（写入元数据 `source_name`） |
| `WithMetadataValue` / `WithMetadata` | 注入自定义元数据 |
| `WithRecursive(true)` | 是否递归子目录（部分示例默认开启） |
| `WithFileExtensions([]string{".md"})` | 只入指定扩展名 |
| `WithOCRExtractor(ocr)` | 给 PDF 图片做 OCR（见 [`OCR`](./knowledge-features-ocr.md)） |

### 与 file-source 的关系

`dir` 本质是"自动展开成多个 file"：扫描结果中的每个文件，等价于一个 file source 的实例。所以元数据机制、reader 注册机制、五步骨架完全相同。

| 维度 | file-source | directory-source |
|------|-------------|------------------|
| 输入 | 显式文件路径 | 目录路径 |
| 文件数 | 少量（手动列举） | 任意（自动遍历） |
| 递归 | 否 | ✅ |
| 文件类型筛选 | 通过路径隐式 | `WithFileExtensions` |
| 适用 | 文档少且固定 | 文档多或动态变化 |

## 代码解析

### 目录结构的语义价值

directory source 的真正威力在于：**目录结构本身就是元数据**。例：

```
docs/
├── product-a/
│   ├── api.md          ← 隐含 category=product-a
│   └── guide.md
├── product-b/
│   └── api.md
└── internal/
    └── design.md        ← 隐含 audience=internal
```

虽然 `dir.New` 默认不会自动把路径转成元数据字段，但你可以：

1. 在每个子目录放一个 `.metadata.json` 注入该目录的元数据
2. 用多个 `dir.New` 分别扫不同子目录，各自打不同 `WithMetadataValue`
3. 加载后用 [`management`](./knowledge-features-management.md) 的 `UpdateByFilter` 按路径模式批量改元数据

第二种是常见做法：

```go
sources := []source.Source{
    dir.New([]string{"docs/product-a"},
        dir.WithName("ProductA"),
        dir.WithMetadataValue("product", "a"),
    ),
    dir.New([]string{"docs/product-b"},
        dir.WithName("ProductB"),
        dir.WithMetadataValue("product", "b"),
    ),
}
```

配合 [`metadata-filter`](./knowledge-features-metadata-filter.md) 就能做"只在 product-a 里搜"。

### 加载进度可视化

directory-source 通常文件多，加载耗时显眼，所以示例开启了内置进度日志：

```go
fmt.Println("\n📥 Loading directory contents...")
if err := kb.Load(ctx, knowledge.WithShowProgress(true)); err != nil {
    log.Fatalf("Failed to load: %v", err)
}
```

`WithShowProgress(true)` 让框架在加载每个文件时打印进度行；想要更精美的多行进度条可用 `WithLoadProgressCallback`（见 [`basic`](./knowledge-basic.md)）。

### 测试查询

```go
eventChan, err := r.Run(ctx, "user", "session-1",
    model.NewUserMessage("What topics are covered in the documentation?"))
```

由于整个目录都入了库，Agent 可以回答"这个目录里都讲了什么"这类**全局概览**问题——这是单文件源做不到的。

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
| `-vectorstore` | 同其它源 | `inmemory` |

### 运行命令

```bash
cd examples/knowledge/sources/directory-source
export OPENAI_API_KEY="sk-xxxx"
go run main.go
```

### 预期输出

```
📁 Directory Source Demo
========================
Vector Store: inmemory

📥 Loading directory contents...
Loading source Documentation Directory: 5/5 documents
Vector store: added 5 documents

🔍 Searching knowledge base...
🤖 Response: The documentation covers machine learning, programming languages...
```

## 适用场景与对比

**选 directory-source 当：**
- 文档多到无法手动列（企业知识库、产品手册、内部 wiki 导出）
- 目录结构本身有语义（按部门/产品/年份分文件夹）
- 文档会持续新增，希望"丢进目录就生效"

**升级路径：**
- 文档在网上 → [`url-source`](./knowledge-sources-url.md)
- 含 PDF 图片要 OCR → 配合 `dir.WithOCRExtractor`（见 [`OCR`](./knowledge-features-ocr.md)）
- 想限定只入 `.md` 不入 `.pdf` → `dir.WithFileExtensions([]string{".md"})`
- 代码仓库（按 AST 解析）→ [`ast`](./knowledge-sources-ast.md)

## 关键要点

1. **递归是默认能力**：dir source 自动遍历子目录，无需手写 `filepath.Walk`。
2. **扩展名可筛**：`WithFileExtensions` 控制只入特定格式。
3. **OCR 可挂载**：`WithOCRExtractor` 让目录里的 PDF 图片也能被检索。
4. **元数据沿用**：与 file-source 完全一致的 `WithName` / `WithMetadataValue` 机制。

## 总结

directory-source 是企业知识库场景的默认选择。把整个文档目录丢进去，框架自动完成扫描、reader 分发、分块、向量化、入库。需要更精细的代码语义解析时升级到 [`ast`](./knowledge-sources-ast.md)，需要单文件控制时回到 [`file-source`](./knowledge-sources-file.md)。
