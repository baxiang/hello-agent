# 04-RAG架构

> Retrieval-Augmented Generation：检索增强生成的完整架构

## RAG 概述

RAG 将外部知识注入到 Agent 的上下文中，让模型能够回答训练数据之外的问题：

```
RAG 架构：
┌──────────────────────────────────────┐
│  文档 → 分割 → 嵌入 → 向量存储       │
│                       ↓              │
│  用户查询 → 嵌入 → 检索 → 上下文     │
│                       ↓              │
│  上下文 + 查询 → LLM → 回答         │
└──────────────────────────────────────┘
```

### 为什么需要 RAG？

| 问题 | 纯 LLM | RAG |
|------|--------|-----|
| 知识时效性 | 训练数据截止 | 实时知识 |
| 幻觉 | 可能编造信息 | 基于检索结果 |
| 私有数据 | 无法访问 | 可注入 |
| 可追溯性 | 无来源 | 可引用文档 |
| 成本 | 全量微调 | 仅检索 |

---

## 核心组件

### RAG 组件关系

```
RAG 组件：
┌──────────────────────────────────────┐
│  Document Loader                     │
│  ├─ 读取文档（PDF/网页/文本）        │
│  └─ 输出 Document 对象               │
│                                       │
│  Text Splitter                       │
│  ├─ 分割文档为块                     │
│  └─ 保留元数据                       │
│                                       │
│  Embeddings                          │
│  ├─ 文本 → 向量                      │
│  └─ 语义相似度计算                   │
│                                       │
│  Vector Store                        │
│  ├─ 存储向量                         │
│  ├─ 相似度搜索                       │
│  └─ 过滤搜索                         │
│                                       │
│  Retriever                           │
│  ├─ 封装向量存储                     │
│  └─ 提供统一检索接口                 │
└──────────────────────────────────────┘
```

---

## Embeddings

### 嵌入模型

```python
from langchain.embeddings import init_embeddings

# 智谱 Embedding
embeddings = init_embeddings("zhipuai:embedding-2")

# OpenAI Embedding
embeddings = init_embeddings("openai:text-embedding-3-small")

# 本地 Embedding
embeddings = init_embeddings("ollama:nomic-embed-text")
```

### 嵌入模型对比

| 模型 | 维度 | 最大输入 | 语言 | 速度 |
|------|------|---------|------|------|
| zhipuai:embedding-2 | 1024 | 4096 | 中英 | 快 |
| openai:text-embedding-3-small | 1536 | 8191 | 多语言 | 中 |
| openai:text-embedding-3-large | 3072 | 8191 | 多语言 | 慢 |
| ollama:nomic-embed-text | 768 | 8192 | 英文为主 | 本地 |

### 嵌入示例

```python
from langchain.embeddings import init_embeddings

embeddings = init_embeddings("zhipuai:embedding-2")

# 单个文本
vector = embeddings.embed("Python 是一门编程语言")
print(f"向量维度: {len(vector)}")  # 1024

# 批量文本
vectors = embeddings.embed_batch([
    "Python 是一门编程语言",
    "JavaScript 是另一门语言",
    "Rust 是系统编程语言",
])
print(f"批量向量: {len(vectors)} 个")
```

---

## Vector Store

### 向量存储类型

| 类型 | 安装 | 适用场景 |
|------|------|---------|
| InMemory | 内置 | 开发测试 |
| SQLiteVSS | `uv add sqlite-vss` | 本地持久化 |
| Chroma | `uv add chromadb` | 本地/轻量生产 |
| FAISS | `uv add faiss-cpu` | 本地高性能 |
| Qdrant | `uv add qdrant-client` | 生产环境 |
| Weaviate | `uv add weaviate-client` | 大规模生产 |

### InMemoryStore 向量搜索

```python
from langchain.embeddings import init_embeddings
from langgraph.store.memory import InMemoryStore

# 创建带向量索引的 Store
store = InMemoryStore(
    index={
        "embed": init_embeddings("zhipuai:embedding-2"),
        "dims": 1024,
        "fields": ["$"],  # 嵌入所有字段
    }
)

# 存储文档
docs = [
    {"title": "Python 基础", "content": "Python 是一种高级编程语言..."},
    {"title": "Python 函数", "content": "函数是可重复使用的代码块..."},
    {"title": "Python 类", "content": "类是面向对象编程的核心..."},
]

for i, doc in enumerate(docs):
    store.put(("docs",), f"doc_{i}", doc)

# 语义搜索
results = store.search(("docs",), query="什么是函数", limit=2)

for r in results:
    print(f"标题: {r.value['title']}")
    print(f"内容: {r.value['content'][:100]}")
    print(f"相似度: {r.score}")
```

### FAISS 向量存储

```python
from langchain_community.vectorstores import FAISS
from langchain.embeddings import init_embeddings
from langchain_core.documents import Document

# 准备文档
docs = [
    Document(page_content="Python 是一种高级编程语言", metadata={"source": "python.txt"}),
    Document(page_content="函数是可重复使用的代码块", metadata={"source": "python.txt"}),
    Document(page_content="类是面向对象编程的核心", metadata={"source": "python.txt"}),
]

# 创建 FAISS
embeddings = init_embeddings("zhipuai:embedding-2")
vectorstore = FAISS.from_documents(docs, embeddings)

# 保存和加载
vectorstore.save_local("faiss_index")
vectorstore = FAISS.load_local("faiss_index", embeddings, allow_dangerous_deserialization=True)

# 相似度搜索
results = vectorstore.similarity_search("什么是函数", k=2)
for r in results:
    print(f"内容: {r.page_content}")
    print(f"元数据: {r.metadata}")
```

### Chroma 向量存储

```python
from langchain_chroma import Chroma
from langchain.embeddings import init_embeddings
from langchain_core.documents import Document

docs = [
    Document(page_content="Python 是一种高级编程语言", metadata={"source": "python.txt"}),
    Document(page_content="函数是可重复使用的代码块", metadata={"source": "python.txt"}),
]

# 创建 Chroma
embeddings = init_embeddings("zhipuai:embedding-2")
vectorstore = Chroma.from_documents(docs, embeddings, persist_directory="./chroma_db")

# 搜索
results = vectorstore.similarity_search("什么是函数", k=2)

# 带过滤的搜索
results = vectorstore.similarity_search(
    "什么是函数",
    k=2,
    filter={"source": "python.txt"},
)
```

---

## Text Splitter

### 分割策略

```
Text Splitter 策略：
┌──────────────────────────────────────┐
│  CharacterSplitter                   │
│  ├─ 按字符分割                       │
│  └─ 简单但可能切断语义               │
│                                       │
│  RecursiveCharacterSplitter          │
│  ├─ 递归按字符分割                   │
│  ├─ 优先在段落/句子边界分割          │
│  └─ 推荐通用场景                     │
│                                       │
│  MarkdownHeaderTextSplitter          │
│  ├─ 按 Markdown 标题分割             │
│  └─ 保留文档结构                     │
│                                       │
│  TokenTextSplitter                   │
│  ├─ 按 Token 分割                    │
│  └─ 精确控制 Token 数                │
│                                       │
│  SemanticChunker                     │
│  ├─ 按语义相似度分割                 │
│  └─ 保持语义完整性                   │
└──────────────────────────────────────┘
```

### RecursiveCharacterSplitter

```python
from langchain_text_splitters import RecursiveCharacterSplitter

splitter = RecursiveCharacterSplitter(
    chunk_size=500,       # 每块最大字符数
    chunk_overlap=50,     # 重叠字符数
    length_function=len,  # 长度计算函数
    separators=[          # 分割符优先级
        "\n\n",           # 段落
        "\n",             # 换行
        "。",             # 句号
        "！",             # 叹号
        "？",             # 问号
        "，",             # 逗号
        " ",              # 空格
        "",              # 字符
    ],
)

text = """
Python 是一种高级编程语言。
它由 Guido van Rossum 创建。

Python 支持多种编程范式：
- 面向对象
- 函数式
- 过程式

Python 广泛应用于：
- Web 开发
- 数据科学
- 人工智能
"""

chunks = splitter.split_text(text)
for i, chunk in enumerate(chunks):
    print(f"块 {i}: {len(chunk)} 字符")
    print(f"内容: {chunk[:50]}...")
```

### MarkdownHeaderTextSplitter

```python
from langchain_text_splitters import MarkdownHeaderTextSplitter

markdown_text = """
# Python 入门

## 什么是 Python

Python 是一种高级编程语言。

## Python 特性

### 易用性

Python 语法简洁。

### 生态丰富

Python 有丰富的库。
"""

splitter = MarkdownHeaderTextSplitter(
    headers_to_split_on=[
        ("#", "header_1"),
        ("##", "header_2"),
        ("###", "header_3"),
    ]
)

chunks = splitter.split_text(markdown_text)
for chunk in chunks:
    print(f"元数据: {chunk.metadata}")
    print(f"内容: {chunk.page_content[:50]}")
    print()
```

### 文档加载 + 分割完整流程

```python
from langchain_community.document_loaders import TextLoader, PyPDFLoader, WebBaseLoader
from langchain_text_splitters import RecursiveCharacterSplitter

# 1. 加载文档
loader = TextLoader("data/python_guide.txt")
documents = loader.load()

# 或者加载 PDF
# loader = PyPDFLoader("data/python_guide.pdf")
# documents = loader.load()

# 或者加载网页
# loader = WebBaseLoader("https://example.com/python-guide")
# documents = loader.load()

print(f"加载了 {len(documents)} 个文档")

# 2. 分割文档
splitter = RecursiveCharacterSplitter(
    chunk_size=500,
    chunk_overlap=50,
)

chunks = splitter.split_documents(documents)
print(f"分割为 {len(chunks)} 个块")

# 3. 查看分割结果
for i, chunk in enumerate(chunks[:3]):
    print(f"\n块 {i}:")
    print(f"  字符数: {len(chunk.page_content)}")
    print(f"  元数据: {chunk.metadata}")
    print(f"  内容: {chunk.page_content[:100]}...")
```

---

## Retriever

### Retriever 类型

```
Retriever 类型：
┌──────────────────────────────────────┐
│  VectorStoreRetriever                │
│  ├─ 基于向量存储的相似度搜索         │
│  └─ 最常用                           │
│                                       │
│  MultiQueryRetriever                 │
│  ├─ 生成多个查询并合并结果           │
│  └─ 提高召回率                       │
│                                       │
│  ContextualCompressionRetriever      │
│  ├─ 检索后压缩上下文                 │
│  └─ 减少噪声                         │
│                                       │
│  ParentDocumentRetriever             │
│  ├─ 小块检索，大块返回               │
│  └─ 平衡精度和上下文                 │
└──────────────────────────────────────┘
```

### 基本 Retriever

```python
from langchain_community.vectorstores import FAISS
from langchain.embeddings import init_embeddings
from langchain_core.documents import Document

# 创建向量存储
docs = [
    Document(page_content="Python 是一种高级编程语言", metadata={"id": "1"}),
    Document(page_content="函数是可重复使用的代码块", metadata={"id": "2"}),
    Document(page_content="类是面向对象编程的核心", metadata={"id": "3"}),
]

embeddings = init_embeddings("zhipuai:embedding-2")
vectorstore = FAISS.from_documents(docs, embeddings)

# 创建 Retriever
retriever = vectorstore.as_retriever(
    search_type="similarity",  # 搜索类型
    search_kwargs={"k": 2},    # 返回结果数
)

# 检索
results = retriever.invoke("什么是函数")
for r in results:
    print(f"内容: {r.page_content}")
    print(f"元数据: {r.metadata}")
```

### ContextualCompressionRetriever

```python
from langchain.retrievers import ContextualCompressionRetriever
from langchain.retrievers.document_compressors import LLMChainExtractor
from langchain.chat_models import init_chat_model

# 创建基础 Retriever
retriever = vectorstore.as_retriever()

# 创建压缩器
llm = init_chat_model("moonshot:moonshot-v1-8k")
compressor = LLMChainExtractor.from_llm(llm)

# 创建压缩 Retriever
compression_retriever = ContextualCompressionRetriever(
    base_compressor=compressor,
    base_retriever=retriever,
)

# 检索并压缩
results = compression_retriever.invoke("什么是函数")
for r in results:
    print(f"压缩后内容: {r.page_content}")
```

### 多查询 Retriever

```python
from langchain.retrievers.multi_query import MultiQueryRetriever
from langchain.chat_models import init_chat_model

llm = init_chat_model("moonshot:moonshot-v1-8k")

multi_query_retriever = MultiQueryRetriever.from_llm(
    retriever=vectorstore.as_retriever(),
    llm=llm,
)

# 自动生成多个查询并合并结果
results = multi_query_retriever.invoke("什么是函数")
print(f"检索到 {len(results)} 个结果（去重后）")
```

---

## RAG 注入 Agent

### 方式1：在中间件中注入检索索结果

```python
from langchain.agents.middleware import before_agent

@before_agent
def inject_rag_context(state, runtime):
    """在 Agent 执行前注入 RAG 上下文"""
    last_msg = state["messages"][-1]
    
    # 检索相关文档
    retriever = runtime.context.retriever
    docs = retriever.invoke(last_msg.content)
    
    # 构建上下文
    if docs:
        context = "参考文档:\n" + "\n\n".join(
            f"[{i+1}] {doc.page_content}"
            for i, doc in enumerate(docs)
        )
        return {"context": context}
    
    return None
```

### 方式2：RAG 作为工具

```python
from langchain.tools import tool

@tool
def search_documents(query: str) -> str:
    """搜索内部文档知识库"""
    # 检索
    docs = retriever.invoke(query)
    
    if not docs:
        return "未找到相关文档"
    
    # 格式化结果
    result = "相关文档:\n" + "\n\n".join(
        f"[{i+1}] {doc.page_content}"
        for i, doc in enumerate(docs[:3])
    )
    
    return result

# 创建 Agent
agent = create_agent(
    model="moonshot:moonshot-v1-8k",
    tools=[search_documents],
)
```

### 方式3：完整 RAG Agent

```python
from langchain.agents import create_agent
from langchain.agents.middleware import before_agent
from langchain_community.vectorstores import FAISS
from langchain.embeddings import init_embeddings
from langchain_core.documents import Document
from langchain_text_splitters import RecursiveCharacterSplitter
from dataclasses import dataclass

# 1. 准备向量存储
docs = [
    Document(page_content="Python 是一种高级编程语言，由 Guido van Rossum 于 1991 年发布。", metadata={"id": "1"}),
    Document(page_content="函数是可重复使用的代码块，使用 def 关键字定义。", metadata={"id": "2"}),
    Document(page_content="类是面向对象编程的核心概念，使用 class 关键字定义。", metadata={"id": "3"}),
]

embeddings = init_embeddings("zhipuai:embedding-2")
vectorstore = FAISS.from_documents(docs, embeddings)
retriever = vectorstore.as_retriever(search_kwargs={"k": 2})

# 2. 定义上下文
@dataclass
class RAGContext:
    retriever: object

# 3. 创建中间件
@before_agent
def rag_middleware(state, runtime):
    last_msg = state["messages"][-1]
    docs = runtime.context.retriever.invoke(last_msg.content)
    
    if docs:
        context = "参考资料:\n" + "\n".join(
            f"- {doc.page_content}" for doc in docs
        )
        return {"context": context}
    
    return None

# 4. 创建 Agent
agent = create_agent(
    model="moonshot:moonshot-v1-8k",
    middleware=[rag_middleware],
    context_schema=RAGContext,
)

# 5. 调用
config = {"configurable": {"thread_id": "rag-session"}}
result = agent.invoke(
    {"messages": [{"role": "user", "content": "Python 是什么？"}]},
    config=config,
    context=RAGContext(retriever=retriever),
)

print(result["messages"][-1].content)
```

---

## RAG 完整示例：文档问答系统

```python
from langchain.agents import create_agent
from langchain.agents.middleware import before_agent
from langchain_community.document_loaders import TextLoader
from langchain_text_splitters import RecursiveCharacterSplitter
from langchain_community.vectorstores import FAISS
from langchain.embeddings import init_embeddings
from dataclasses import dataclass

# 1. 加载和分割文档
def load_documents(file_path: str):
    """加载并分割文档"""
    loader = TextLoader(file_path)
    documents = loader.load()
    
    splitter = RecursiveCharacterSplitter(
        chunk_size=500,
        chunk_overlap=50,
    )
    
    return splitter.split_documents(documents)

# 2. 创建向量存储
def create_vectorstore(documents):
    """创建向量存储"""
    embeddings = init_embeddings("zhipuai:embedding-2")
    return FAISS.from_documents(documents, embeddings)

# 3. RAG 中间件
@dataclass
class RAGContext:
    retriever: object

@before_agent
def inject_retrieved_context(state, runtime):
    """检索并注入上下文"""
    last_msg = state["messages"][-1]
    
    # 检索
    docs = runtime.context.retriever.invoke(last_msg.content)
    
    if docs:
        context = "根据以下资料回答问题:\n" + "\n\n".join(
            f"资料 {i+1}:\n{doc.page_content}"
            for i, doc in enumerate(docs[:3])
        )
        return {"context": context}
    
    return None

# 4. 主函数
def create_rag_agent(document_paths: list[str]):
    """创建 RAG Agent"""
    # 加载所有文档
    all_docs = []
    for path in document_paths:
        all_docs.extend(load_documents(path))
    
    print(f"加载了 {len(all_docs)} 个文档块")
    
    # 创建向量存储
    vectorstore = create_vectorstore(all_docs)
    retriever = vectorstore.as_retriever(
        search_kwargs={"k": 3}
    )
    
    # 创建 Agent
    agent = create_agent(
        model="deepseek:deepseek-chat",
        middleware=[inject_retrieved_context],
        context_schema=RAGContext,
    )
    
    return agent, RAGContext(retriever=retriever)

# 5. 使用
# agent, rag_context = create_rag_agent(["data/guide1.txt", "data/guide2.txt"])
# 
# config = {"configurable": {"thread_id": "rag-qa"}}
# result = agent.invoke(
#     {"messages": [{"role": "user", "content": "如何定义函数？"}]},
#     config=config,
#     context=rag_context,
# )
# 
# print(result["messages"][-1].content)
```

---

## RAG 优化技巧

### 1. 混合搜索

```python
# 结合相似度搜索和关键词搜索
def hybrid_search(query: str, retriever, keyword_index) -> list:
    """混合搜索"""
    # 向量搜索
    vector_results = retriever.invoke(query)
    
    # 关键词搜索
    keyword_results = keyword_index.search(query)
    
    # 合并并去重
    all_results = {r.page_content: r for r in vector_results + keyword_results}
    
    return list(all_results.values())[:5]
```

### 2. 重排序

```python
from langchain.retrievers.document_compressors import CrossEncoderReranker
from langchain.retrievers import ContextualCompressionRetriever

# 使用 CrossEncoder 重排序
compressor = CrossEncoderReranker(model="BAAI/bge-reranker-large")
reranker_retriever = ContextualCompressionRetriever(
    base_compressor=compressor,
    base_retriever=vectorstore.as_retriever(search_kwargs={"k": 10}),
)
```

### 3. 查询扩展

```python
@before_agent
def expand_query(state, runtime):
    """查询扩展"""
    last_msg = state["messages"][-1]
    query = last_msg.content
    
    # 简单扩展：添加同义词
    expanded_queries = [query]
    
    if "函数" in query:
        expanded_queries.append(query.replace("函数", "function"))
    if "类" in query:
        expanded_queries.append(query.replace("类", "class"))
    
    # 检索所有扩展查询的结果
    all_docs = []
    for q in expanded_queries:
        docs = runtime.context.retriever.invoke(q)
        all_docs.extend(docs)
    
    # 去重
    seen = set()
    unique_docs = []
    for doc in all_docs:
        if doc.page_content not in seen:
            seen.add(doc.page_content)
            unique_docs.append(doc)
    
    if unique_docs:
        context = "参考资料:\n" + "\n".join(
            f"- {doc.page_content}" for doc in unique_docs[:5]
        )
        return {"context": context}
    
    return None
```

---

## RAG 评估指标

| 指标 | 说明 | 计算方式 |
|------|------|---------|
| 命中率 | 检索到相关文档的比例 | 相关文档数 / 总检索数 |
| MRR | 首个相关文档的排名 | 1 / 排名 |
| NDCG | 排序质量 | 归一化折扣累积增益 |
| 回答准确率 | 回答正确性 | 人工评估或 LLM 评估 |
| 上下文相关性 | 检索文档与查询的相关度 | 嵌入相似度 |

---

## 小结

| 要点 | 说明 |
|------|------|
| RAG 组件 | Document Loader → Splitter → Embeddings → Vector Store → Retriever |
| Embeddings | 文本 → 向量，支持语义搜索 |
| Vector Store | FAISS、Chroma、Qdrant 等 |
| Text Splitter | RecursiveCharacterSplitter 最常用 |
| Retriever | 封装向量存储，提供检索接口 |
| 注入方式 | 中间件注入、工具调用、完整 RAG Agent |
| 优化技巧 | 混合搜索、重排序、查询扩展 |
