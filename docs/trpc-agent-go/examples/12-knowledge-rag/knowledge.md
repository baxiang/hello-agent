# Knowledge 示例 - 构建知识增强的 RAG 对话系统

## 概述

本示例是 tRPC-Agent-Go 框架中最完整的知识检索增强生成（RAG）示例集合，涵盖从基础知识库构建到高级特性的全链路演示。它展示了如何将文件、目录、URL 等多种数据源加载到向量数据库中，并通过 Embedding 检索与 LLM 结合，实现基于私有知识的智能问答。

## 核心概念

### Knowledge 知识库

`knowledge.New()` 是 RAG 管线的核心入口，通过组合三大组件构建知识库：

- **Source（数据源）**：支持 `file.New()`（单文件）、`dir.New()`（目录递归）、`url.New()`（网页抓取）和 `auto.New()`（自动识别）四种类型
- **Embedder（嵌入器）**：将文本转换为向量表示，默认使用 OpenAI Embedding API
- **VectorStore（向量存储）**：存储和检索向量，支持 `inmemory`、`pgvector`、`elasticsearch`、`tcvector`、`milvus` 五种后端

### 知识搜索工具

`knowledgetool.NewKnowledgeSearchTool(kb)` 将知识库封装为 Agent 可调用的 Tool，Agent 在对话中自动判断何时调用知识检索。

### 高级特性

- **Query Enhancer（查询增强）**：利用 LLM 改写多轮对话中的模糊查询（如 "它是怎么工作的？"），解决代词消解问题
- **Reranker（重排序）**：对初始检索结果进行二次排序，提升相关性
- **Metadata Filter（元数据过滤）**：支持 AND/OR/NOT 条件的程序化过滤和 LLM 自动生成过滤条件的 Agentic Filter
- **Source Management（数据源管理）**：动态添加、移除、重新加载数据源

## 代码解析

**1. 构建知识库（basic/main.go）**

```go
fileSrc := file.New([]string{util.ExampleDataPath("file/llm.md")})
dirSrc := dir.New([]string{util.ExampleDataPath("dir/")})
emb := openai.New()
vs := inmemory.New()

kb := knowledge.New(
    knowledge.WithVectorStore(vs),
    knowledge.WithEmbedder(emb),
    knowledge.WithSources([]source.Source{fileSrc, dirSrc}),
)
kb.Load(ctx)
```

通过 `file.New()` 和 `dir.New()` 创建数据源，`openai.New()` 创建 Embedding 模型，`inmemory.New()` 创建内存向量存储，最后组装并加载知识库。

**2. 查询增强（query-enhancer/main.go）**

```go
enhancer := query.NewLLMEnhancer(llm)
kb := knowledge.New(
    knowledge.WithQueryEnhancer(enhancer),
    // ...其他配置
)
```

`LLMEnhancer` 利用对话历史将 "它是怎么工作的？" 改写为 "Large Language Models 是如何处理上下文长度的？"，使检索器获得完整语义的查询。

**3. 挂载为 Agent 工具**

```go
searchTool := knowledgetool.NewKnowledgeSearchTool(kb, knowledgetool.WithMaxResults(3))
agent := llmagent.New("assistant", llmagent.WithTools([]tool.Tool{searchTool}))
r := runner.NewRunner("chat", agent)
```

将知识搜索封装为 Tool 后，Agent 会在对话中自动决定何时检索知识库。

## 运行方式

```bash
export OPENAI_API_KEY="your-key"
export OPENAI_BASE_URL="https://api.openai.com/v1"
export MODEL_NAME="deepseek-v4-flash"

# 基础示例
cd examples/knowledge/basic && go run .

# 查询增强
cd examples/knowledge/query-enhancer && go run .

# 使用 PostgreSQL 向量存储
cd examples/knowledge/basic && go run . -vectorstore pgvector
```

使用不同向量存储后端时，需额外配置对应环境变量（如 `PGVECTOR_HOST`、`ELASTICSEARCH_HOSTS` 等）。

## 总结

Knowledge 示例集合展示了 RAG 系统的完整构建流程：数据源接入 → 文档分块 → 向量化存储 → 语义检索 → LLM 生成回答。框架通过统一的 `knowledge.New()` 入口和可插拔的组件设计，使得从内存原型到生产级部署只需替换向量存储后端。Query Enhancer 和 Reranker 等高级特性进一步提升了多轮对话和检索质量，可与 arxivsearch、wiki 等搜索工具示例结合使用。
