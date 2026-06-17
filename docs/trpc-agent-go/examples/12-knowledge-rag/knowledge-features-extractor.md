# Docling Extractor 示例 - PDF/HTML 高质量转换

> **源码路径**：[`trpc-agent-go/examples/knowledge/features/extractor/`](../../../../trpc-agent-go/examples/knowledge/features/extractor)
> **示例类型**：文档转换 · **难度**：进阶

## 概述

`features/extractor/` 用开源 [Docling](https://github.com/docling-project/docling-serve) 服务把 PDF / HTML 高质量转成 Markdown，对比内置 PDF reader 的"纯文本提取"基线，并展示如何通过 `urlsource.WithExtractor` 把转换能力挂到 URL source 上。是处理论文 PDF、复杂 HTML 页面、扫描件的关键工具。

## 核心概念

### 为什么需要 extractor

内置 PDF reader 只能抽纯文本，遇到以下情况效果差：

| 场景 | 内置 reader | Docling |
|------|------------|---------|
| 多栏排版 | 阅读顺序错乱 | ✅ 识别栏序 |
| 公式/表格 | 丢失或乱码 | ✅ 转 LaTeX/Markdown 表格 |
| 图片中文字 | 完全丢失 | ✅ 内置 OCR |
| 链接 PDF（arxiv） | 需先下载 | ✅ 直传 URL |

### Docling Serve：独立 Docker 服务

Docling 是独立进程，通过 Docker 启动：

```bash
docker run -p 5001:5001 ghcr.io/docling-project/docling-serve
```

Go 侧通过 HTTP 调用，不依赖本地 Python 环境。

### 三种用法对照

本示例分三部分演示：

| Part | 用法 | 输出 |
|------|------|------|
| Part 0 | 内置 PDF reader 读 URL（基线） | `.txt` 纯文本 |
| Part 1 | Docling 直接 Extract（PDF + HTML） | `.md` Markdown |
| Part 2 | `urlsource.WithExtractor(docling)` 集成 | 分块 chunk 文件 |

## 代码解析

### Part 0：基线（内置 PDF reader）

```go
pdfReader := pdfreader.New()
docs, err := pdfReader.ReadFromURL(demoPDFURL)  // https://arxiv.org/pdf/1706.03762
```

展示内置 reader 的纯文本效果——作为对照。

### Part 1：直接调用 Docling

```go
ext := docling.New(
    docling.WithEndpoint(*endpoint),       // http://localhost:5001
    docling.WithTimeout(10*time.Minute),   // 大 PDF 解析慢
)
defer ext.Close()

data, _ := downloadURL(ctx, rawURL)        // 先把 URL 内容下载成 bytes
result, err := ext.Extract(ctx, data)      // Docling 转 Markdown
content, _ := io.ReadAll(result.Reader)
```

`Extract` 接受原始 bytes（不限于 URL，也可以本地文件读出的 bytes），返回包含 Markdown reader 的结果。

### Part 2：URL source 集成（推荐用法）

```go
src := urlsource.New(
    urls,
    urlsource.WithName("docling-extracted-urls"),
    urlsource.WithExtractor(ext),              // 关键：挂 Docling
    urlsource.WithMetadataValue("extractor", "docling"),
    urlsource.WithChunkSize(500),
    urlsource.WithChunkOverlap(50),
)

docs, err := src.ReadDocuments(ctx)  // 自动抓 URL → Docling 转 → 分块
```

挂上 `WithExtractor` 后，URL source 自动把抓到的内容喂给 Docling 转换，再做分块——这是把 Docling 集成进 Knowledge Base 的标准方式。

### 演示 URL

```go
const demoPDFURL = "https://arxiv.org/pdf/1706.03762"          // Attention Is All You Need
const demoHTMLURL = "https://www.rfc-editor.org/rfc/rfc9110.html"  // HTTP Semantics RFC
```

arxiv PDF 验证复杂学术排版，RFC HTML 验证长文档结构。

### 输出结构

示例把结果写到 `./output/`：

```
output/
├── 1706.03762_pdfreader.txt      ← Part 0 基线
├── 1706.03762_docling.md         ← Part 1 Docling PDF
├── rfc9110_docling.md            ← Part 1 Docling HTML
└── chunked/                      ← Part 2 URL source 分块
    ├── 1706.03762_chunks.md
    └── rfc9110_chunks.md
```

`chunked/` 下每个文件包含该 URL 的所有 chunk，按 chunk_index 顺序，含完整 metadata。

## 运行方式

### 前置：启动 Docling Serve

```bash
docker run -p 5001:5001 ghcr.io/docling-project/docling-serve
```

启动后默认监听 `http://localhost:5001`。

### 环境变量与参数

| 变量/参数 | 必需 | 说明 | 默认值 |
|----------|------|------|--------|
| `OPENAI_API_KEY` | 否 | 本示例不调 embedding，可选 | — |
| `-endpoint` | 否 | Docling 端点 | `http://localhost:5001` |
| `-output` | 否 | 输出目录 | `./output` |
| 网络 | 是 | 能访问 arxiv / rfc-editor | — |

### 运行命令

```bash
cd examples/knowledge/features/extractor

# 先启动 Docling Serve（另一终端）
docker run -p 5001:5001 ghcr.io/docling-project/docling-serve

# 运行示例
go run . -endpoint http://127.0.0.1:5001 -output ./output
```

### 预期输出

```
Docling Extractor Demo
============================================================
Endpoint:   http://localhost:5001
Output Dir: ./output
PDF URL:    https://arxiv.org/pdf/1706.03762
HTML URL:   https://www.rfc-editor.org/rfc9110.html
============================================================

Supported formats: [pdf html docx pptx ...]

Part 0: Built-in PDF Reader from URL (no extractor, text only)
[1] Reading with built-in PDF reader: https://arxiv.org/pdf/1706.03762
  Chunks:   42
  Output:   ./output/1706.03762_pdfreader.txt (28501 bytes)

Part 1: Direct Extraction from URLs (PDF/HTML -> Markdown)
[1] Extracting: https://arxiv.org/pdf/1706.03762
  Input size: 2198432 bytes
  Format:   pdf
  Output:   ./output/1706.03762_docling.md (48213 bytes)
[2] Extracting: https://www.rfc-editor.org/rfc9110.html
  ...

Part 2: URL Source with Docling Extractor
  Read time:  45.2s
  Chunks:     128
  Source: https://arxiv.org/pdf/1706.03762
  Chunks: 75
  Output: ./output/chunked/1706.03762_chunks.md

Done!
```

## 适用场景与对比

**选 Docling extractor 当：**
- 论文 PDF（多栏、公式、表格）
- 扫描件 / 图片型 PDF（需 OCR）
- 复杂 HTML（结构化长文档）
- 内置 reader 抽出来的文本质量差

**对比其它 PDF 处理方式：**

| 方式 | 部署 | 质量 | OCR | 适用 |
|------|------|------|-----|------|
| 内置 PDF reader | 无依赖 | 中（纯文本） | ❌ | 简单文本 PDF |
| **Docling extractor** | Docker 服务 | 高（结构化） | ✅ | 论文、扫描件 |
| [`OCR`](./knowledge-features-ocr.md) (Tesseract) | 本地二进制 | 中（OCR） | ✅ | 图片型 PDF |

## 关键要点

1. **独立服务**：Docling 是 Docker 进程，Go 通过 HTTP 调用。
2. **三种用法**：基线对照、直接 Extract、URL source 集成。
3. **`WithExtractor` 是集成点**：URL source 挂上后自动转换 + 分块。
4. **质量优于内置 reader**：保留结构、公式、表格、图片中文字。
5. **输出可观察**：所有结果写文件，便于对比质量。

## 总结

Docling extractor 是处理"难啃"PDF/HTML 的瑞士军刀。简单文本 PDF 用内置 reader 足够；论文、扫描件、复杂排版升级到 Docling；纯图片型 PDF 也可考虑 [`OCR`](./knowledge-features-ocr.md) (Tesseract)。通过 `urlsource.WithExtractor` 集成后，整个 Knowledge Base 自动获得高质量文档转换能力，与 [`management`](./knowledge-features-management.md) 的动态加源配合可构建增量文档同步管线。
