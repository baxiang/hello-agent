# PDF OCR 示例 - Tesseract 集成图片型 PDF 检索

> **源码路径**：[`trpc-agent-go/examples/knowledge/features/OCR/`](../../../../trpc-agent-go/examples/knowledge/features/OCR)
> **示例类型**：OCR 文档处理 · **难度**：进阶

## 概述

`features/OCR/` 用 Tesseract OCR 引擎把**图片型 PDF**（扫描件、含图文字）转成可检索文本，再走标准 Knowledge Base 管线。与 [`extractor`](./knowledge-features-extractor.md) (Docling) 是互补关系：Docling 处理结构化 PDF（论文、表格），OCR 处理纯图片型 PDF（扫描合同、截图文档）。本示例**需要特殊 build tag** `tesseract`。

## 核心概念

### 图片型 PDF 的挑战

| PDF 类型 | 内置 reader | Docling | Tesseract OCR |
|---------|-------------|---------|---------------|
| 文本型（Word 导出） | ✅ | ✅ | 不需要 |
| 结构化（论文、表格） | 中 | ✅✅ | 一般 |
| **扫描件 / 截图** | ❌（无文本层） | 部分 | ✅✅ |
| 含中文图片 | ❌ | 部分 | ✅（需 chi_sim 语言包） |

扫描件 PDF 的"文本层"是空的，内置 reader 抽不出任何东西——必须 OCR。

### Build Tag 隔离

```go
//go:build tesseract
// +build tesseract
```

OCR 依赖 CGO + Tesseract C 库，不是所有环境都有。用 build tag 隔离：

```bash
# 正常 build 看不到这个 main.go
go build .

# 显式启用 tesseract tag 才编译
go run -tags tesseract main.go
```

这也解释了为什么 `run_examples.sh` 把 OCR 排除在批量运行之外（脚本注释明确说 "excluding OCR which requires special build tag"）。

### Tesseract + Directory Source 集成

```go
ocrExtractor, err := tesseract.New(
    tesseract.WithLanguage("eng+chi_sim"),       // 英文 + 简体中文
    tesseract.WithConfidenceThreshold(60.0),     // 置信度门槛
)

sources := []source.Source{
    dir.New(
        []string{absDataDir},
        dir.WithName("PDF Documents with OCR"),
        dir.WithMetadataValue("type", "pdf"),
        dir.WithOCRExtractor(ocrExtractor),      // 关键：挂 OCR
    ),
}
```

OCR 通过 `dir.WithOCRExtractor` 挂在 **directory source** 上——目录里的所有 PDF 都会过 OCR。

## 代码解析

### 三阶段流程

`main()` 分三阶段：

```go
// 1. 构造 KB（Tesseract + embedder + 向量库 + dir 源）
kb, err := setupKnowledgeBase(ctx, storeType)

// 2. 统计（chunk 数、OCR 处理数、字符数）
showStats(ctx, kb, storeType)

// 3. 检索（默认 query "What is trpc-agent-go?"）
search(ctx, kb, *query)
```

### Tesseract 配置

```go
ocrExtractor, err := tesseract.New(
    tesseract.WithLanguage("eng+chi_sim"),
    tesseract.WithConfidenceThreshold(60.0),
)
```

| 选项 | 作用 |
|------|------|
| `WithLanguage("eng+chi_sim")` | 识别语言（多语言用 `+` 连接） |
| `WithConfidenceThreshold(60.0)` | 低于此置信度的文本丢弃 |

中文扫描件要装 `tesseract-ocr-chi-sim` 语言包（见前置依赖）。

### 统计：区分 OCR chunk

```go
for _, doc := range result.Documents {
    totalChars += len(doc.Document.Content)
    if ocrEnabled, ok := doc.Document.Metadata["ocr_enabled"].(string); ok && ocrEnabled == "true" {
        ocrCount++
    }
}
```

OCR 处理过的 chunk 会带 `ocr_enabled=true` 元数据，统计时可区分 OCR 来源和文本来源。

### 检索过滤

```go
result, err := kb.Search(ctx, &knowledge.SearchRequest{
    Query:      query,
    MaxResults: 5,
    MinScore:   0.3,    // 过滤低分结果
})
```

`MinScore: 0.3` 过滤掉相似度太低的结果——OCR 文本有时质量不稳，低分结果可能纯噪声。

## 运行方式

### 前置依赖

#### 1. Tesseract OCR 引擎

```bash
# Ubuntu/Debian
sudo apt-get install tesseract-ocr libtesseract-dev tesseract-ocr-chi-sim

# macOS
brew install tesseract
# 中文语言包需额外安装
```

#### 2. 准备 PDF 数据

```bash
mkdir -p ./data
cp /path/to/your/*.pdf ./data/
```

PDF 放在 `./data` 目录（硬编码 `dataDir = "./data"`）。

### 环境变量

| 变量 | 必需 | 说明 | 默认值 |
|------|------|------|--------|
| `OPENAI_API_KEY` | 是 | embedding | — |
| `OPENAI_BASE_URL` | 否 | 端点 | `https://api.openai.com/v1` |

### 命令行参数

| 参数 | 说明 | 默认值 |
|------|------|--------|
| `-vectorstore` | `inmemory` / `pgvector` / `tcvector` / `elasticsearch` | `inmemory` |
| `-query` | 检索 query | `What is trpc-agent-go?` |

### 运行命令

```bash
cd examples/knowledge/features/OCR
export OPENAI_API_KEY="sk-xxxx"

# 必须带 -tags tesseract
go run -tags tesseract main.go

# 切后端
go run -tags tesseract main.go -vectorstore pgvector

# 自定义 query
go run -tags tesseract main.go -query "What are the key features?"
```

### 预期输出

```
PDF OCR Knowledge Demo
==================================================
Data Directory: ./data
OCR Engine: Tesseract
Vector Store: inmemory
==================================================

Setting up knowledge base...
  Creating Tesseract OCR engine...
  Creating OpenAI embedder...
  Creating vector store...
  Creating directory source for PDFs in /abs/path/to/data...
  Creating knowledge base...

Loading PDFs into knowledge base...
Knowledge base loaded successfully in 5.2s

📊 Knowledge Base Statistics
--------------------------------------------------
  Total Chunks: 42
  Source Files: 1
  OCR-Processed Chunks: 12
  Total Characters: 28500
  Avg Chars/Chunk: 678
  OCR Engine: Tesseract
  Vector Store: inmemory

🔍 Query: What is trpc-agent-go?
--------------------------------------------------
Search completed in 120ms
Found 3 results:

  #1 (Score: 0.8234)
    Source: trpc-agent-go.pdf
    Metadata: type=pdf, ocr_enabled=true
    Content: trpc-agent-go is an AI agent framework...

✅ Done!
```

## 适用场景与对比

**选 Tesseract OCR 当：**
- 知识库主要是扫描件（合同、发票、旧文档扫描）
- PDF 是图片型（无文本层）
- 含中文图片文字（配合 chi_sim）

**选 [`Docling`](./knowledge-features-extractor.md) 当：**
- 结构化 PDF（论文、表格、公式）
- HTML 复杂排版
- 不想本地装 Tesseract C 库

**对比：**

| 维度 | Tesseract OCR | Docling |
|------|---------------|---------|
| 部署 | 本地 C 库 + 语言包 | Docker 服务 |
| Build tag | `tesseract`（CGO） | 无 |
| 强项 | 扫描件、图片中文字 | 结构化排版 |
| 弱项 | 表格、公式 | 纯图片 |
| 中文 | ✅（chi_sim） | 取决于配置 |

## 关键要点

1. **build tag 隔离**：`-tags tesseract` 启用，默认不编译。
2. **挂在 dir source 上**：`dir.WithOCRExtractor` 让目录里所有 PDF 过 OCR。
3. **多语言支持**：`WithLanguage("eng+chi_sim")` 识别中英混合。
4. **置信度过滤**：`WithConfidenceThreshold` 丢低质量识别结果。
5. **OCR chunk 可追溯**：`ocr_enabled=true` 元数据区分来源。

## 总结

OCR 示例处理 Knowledge 系列里最"脏"的输入——扫描件和图片型 PDF。通过 Tesseract 把图片转文本后走标准 RAG 管线。结构化 PDF 应优先用 [`extractor`](./knowledge-features-extractor.md) (Docling)，扫描件才需要 OCR。生产环境建议两者都备：Docling 处理"Born-digital" PDF，Tesseract 处理扫描件，通过文件类型或元数据自动路由。
