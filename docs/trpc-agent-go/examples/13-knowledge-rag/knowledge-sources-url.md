# URL 源示例 - 抓取网页内容建知识库

> **源码路径**：[`trpc-agent-go/examples/knowledge/sources/url-source/`](../../../../trpc-agent-go/examples/knowledge/sources/url-source)
> **示例类型**：数据源 · **难度**：入门

## 概述

`sources/url-source/` 用 `url.New` 抓取一组 URL，把 HTML 转成纯文本后入库。与 [`file-source`](./knowledge-sources-file.md) 的区别：输入是 URL 而非本地路径，框架自动 HTTP 抓取 + HTML 解析。

## 核心概念

### `url.New` + 网页抓取

```go
src := url.New(
    []string{
        "https://en.wikipedia.org/wiki/Byte-pair_encoding",
        "https://en.wikipedia.org/wiki/N-gram",
    },
    url.WithName("NLP Wikipedia Articles"),
    url.WithMetadataValue("source_type", "web"),
    url.WithMetadataValue("category", "encyclopedia"),
)
```

URL 源的核心能力：

| 能力 | 说明 |
|------|------|
| HTTP 抓取 | 框架自动 GET 每个 URL |
| HTML→文本 | 剥离标签，保留正文 |
| 多 URL | 一个 source 实例管理多个页面 |
| 元数据 | 同 file/dir 源，支持 `WithName` / `WithMetadataValue` |

### 与 extractor 协同（高级）

URL 指向的若是 PDF/复杂 HTML，可挂 [`Docling`](./knowledge-features-extractor.md) extractor 做高质量转换：

```go
src := urlsource.New(urls,
    urlsource.WithExtractor(doclingExtractor),
    urlsource.WithChunkSize(500),
    urlsource.WithChunkOverlap(50),
)
```

本基础示例不挂 extractor，仅依赖内置 HTML 解析。

### 与其它源的对比

| 源 | 数据位置 | 是否联网 | 转换需求 |
|----|---------|---------|---------|
| [`file`](./knowledge-sources-file.md) | 本地 | 否 | reader 按 ext 分发 |
| [`dir`](./knowledge-sources-directory.md) | 本地 | 否 | 同上 + 递归 |
| **url** | 网络 | ✅ | HTML→文本（+ 可选 extractor） |
| [`auto`](./knowledge-sources-auto.md) | 混合 | ✅ | 自动判别 |

## 代码解析

### 抓取进度

```go
fmt.Println("\n📥 Fetching web content...")
if err := kb.Load(ctx, knowledge.WithShowProgress(true)); err != nil {
    log.Fatalf("Failed to load: %v", err)
}
```

`Load` 会逐个 HTTP GET，每个 URL 一行进度。

### 元数据来源标记

`WithMetadataValue("source_type", "web")` 让后续过滤可以"只搜网页内容"或"排除网页"，便于在混合源（如 file + url）场景下做来源路由。

## 运行方式

### 环境变量

| 变量 | 必需 | 说明 | 默认值 |
|------|------|------|--------|
| `OPENAI_API_KEY` | 是 | LLM + embedding Key | — |
| `OPENAI_BASE_URL` | 否 | 端点 | `https://api.openai.com/v1` |
| `MODEL_NAME` | 否 | 模型 | `deepseek-v4-flash` |
| 网络 | 是 | 能访问目标 URL | — |

### 命令行参数

| 参数 | 说明 | 默认值 |
|------|------|--------|
| `-vectorstore` | 同其它源 | `inmemory` |

### 运行命令

```bash
cd examples/knowledge/sources/url-source
export OPENAI_API_KEY="sk-xxxx"
go run main.go
```

### 预期输出

```
🌐 URL Source Demo
==================
Vector Store: inmemory

📥 Fetching web content...
Loading source NLP Wikipedia Articles: 2/2 documents

🔍 Asking about fetched content...
🤖 Response: Byte-pair encoding (BPE) is a subword tokenization algorithm...
```

## 适用场景与对比

**选 url-source 当：**
- 知识在公网/内网 wiki/博客/文档站
- 不想手动下载 HTML 再喂给 file source
- 内容会更新，希望每次 Load 拉最新版

**注意事项：**
- 抓取受目标站点反爬限制（User-Agent、速率）
- 复杂页面（PDF、JS 渲染）需配合 [`extractor`](./knowledge-features-extractor.md)
- 大量 URL 时考虑配合 [`management`](./knowledge-features-management.md) 分批加载

**升级路径：**
- URL 指向 PDF → 配合 Docling extractor
- 来源混杂（文本+文件+URL）→ [`auto-source`](./knowledge-sources-auto.md)

## 关键要点

1. **HTTP 抓取内置**：`url.New` 自动 GET，无需自己写 `http.Client`。
2. **HTML 自动转文本**：剥离标签保留正文。
3. **元数据标记来源**：`source_type=web` 便于在混合源中过滤。
4. **可挂 extractor**：复杂页面（PDF/JS 渲染）通过 `WithExtractor` 接 Docling。

## 总结

url-source 让 RAG 知识库不再局限于本地文件，可以无缝纳入互联网内容。简单页面直接用，复杂页面配合 [`extractor`](./knowledge-features-extractor.md)。如果来源类型混杂（一段纯文本 + 一个本地文件 + 一个 URL），用 [`auto-source`](./knowledge-sources-auto.md) 让框架自动判别。
