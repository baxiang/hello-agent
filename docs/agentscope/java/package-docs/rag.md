# RAG 模式

`io.agentscope.core.rag` 包实现了检索增强生成（Retrieval-Augmented Generation），提供自动检索和 Agent 主动检索两种模式。

---

## 1. Knowledge 接口

```java
// Knowledge.java:30
public interface Knowledge {
    Mono<Void> addDocuments(List<Document> documents);        // :40
    Mono<List<Document>> retrieve(String query, RetrieveConfig config);  // :53
}
```

统一的知识库 API，支持文档存储和检索。

| 方法 | 位置 | 说明 |
|------|------|------|
| `addDocuments(List<Document>)` | Knowledge.java:40 | 嵌入并存储文档到向量数据库 |
| `retrieve(String, RetrieveConfig)` | Knowledge.java:53 | 根据查询检索相关文档，按相关性排序 |

---

## 2. RAGMode 枚举

```java
// RAGMode.java:28
public enum RAGMode {
    GENERIC,    // :36  自动检索注入（Hook 模式）
    AGENTIC,    // :44  Agent 主动检索（Tool 模式）
    NONE        // :51  禁用 RAG
}
```

| 模式 | 检索方式 | 注入方式 | Agent 自主性 | 适用场景 |
|------|----------|----------|-------------|----------|
| `GENERIC` | 每次 PreCall 自动检索 | 自动注入到消息列表 | 低 | 简单问答，全面检索 |
| `AGENTIC` | Agent 通过工具主动检索 | 工具返回结果 | 高 | 复杂推理，选择性检索 |
| `NONE` | 不启用 | — | — | 不需要 RAG |

---

## 3. GenericRAGHook：自动检索模式

```java
// GenericRAGHook.java:65
public class GenericRAGHook implements Hook {
    private final Knowledge knowledge;       // :69
    private final RetrieveConfig defaultConfig;  // :70
}
```

实现 `GENERIC` 模式，拦截 `PreCallEvent` 自动检索并注入知识。

### 3.1 工作流程

1. **提取查询** (`GenericRAGHook.java:173`): 从输入消息中逆序查找最后一条 USER 消息作为查询
2. **检索文档** (`GenericRAGHook.java:141`): 调用 `knowledge.retrieve(query, config)`
3. **注入知识** (`GenericRAGHook.java:148-153`): 将检索结果构建为 USER 消息追加到输入列表
4. **错误处理** (`GenericRAGHook.java:156-161`): 检索失败时记录日志但不中断流程

### 3.2 知识注入格式

```java
// GenericRAGHook.java:215-228
<retrieved_knowledge>Use the following content from the knowledge base(s) if it is helpful:

- Score: 0.956, Content: 文档内容1
- Score: 0.823, Content: 文档内容2
</retrieved_knowledge>
```

### 3.3 配置

```java
// 默认配置（limit=5, scoreThreshold=0.5）
GenericRAGHook hook = new GenericRAGHook(knowledgeBase);  // :84

// 自定义配置
GenericRAGHook hook = new GenericRAGHook(knowledgeBase,   // :95
    RetrieveConfig.builder()
        .limit(10)
        .scoreThreshold(0.7)
        .build());
```

优先级为 50（`GenericRAGHook.java:118`），确保在 Hook 链中较早执行。

---

## 4. KnowledgeRetrievalTools：Agent 主动检索

```java
// KnowledgeRetrievalTools.java:52
public class KnowledgeRetrievalTools {
    private final Knowledge knowledge;       // :54
    private final RetrieveConfig defaultConfig;  // :56
}
```

实现 `AGENTIC` 模式，将知识检索适配为 `@Tool` 方法，Agent 自主决定何时检索。

### 4.1 retrieve_knowledge 工具

```java
// KnowledgeRetrievalTools.java:114
@Tool(name = "retrieve_knowledge")
public String retrieveKnowledge(
    String query,     // 搜索查询
    Integer limit,    // 最大文档数（默认5）
    Agent agent       // 自动注入，用于获取对话历史
);
```

**特性**（`KnowledgeRetrievalTools.java:140-151`）：
- 自动从 Agent 记忆提取对话历史，传入 `RetrieveConfig`
- 支持多轮对话上下文的知识库（如百炼）可利用历史提升检索精度
- 同步调用（`block()`），匹配 `@Tool` 接口

### 4.2 返回格式

```
Retrieved 2 relevant document(s):

Document 1 (Score: 0.956):
文档内容1

Document 2 (Score: 0.823):
文档内容2
```

---

## 5. 与 Memory/Tool 的协作

### 5.1 与 Memory 的关系

RAG 和 Memory 服务不同目的：

| 维度 | RAG (Knowledge) | Memory |
|------|----------------|--------|
| 数据源 | 外部知识库文档 | 对话历史 |
| 检索方式 | 语义向量检索 | 时间序列访问 |
| 用途 | 提供领域知识 | 维护对话上下文 |
| 持久性 | 独立于会话 | 可跨会话（Session） |

### 5.2 与 LongTermMemory 的对比

| 维度 | RAG | LongTermMemory |
|------|-----|----------------|
| 数据性质 | 结构化知识文档 | 用户偏好/个人信息 |
| 写入方式 | `addDocuments()` 预加载 | `record()` 自动/主动记录 |
| 检索目标 | 领域知识 | 用户相关记忆 |

### 5.3 Tool 集成

- `GENERIC` 模式：通过 `GenericRAGHook`（Hook 机制），不需要注册 Tool
- `AGENTIC` 模式：通过 `KnowledgeRetrievalTools`（Tool 机制），注册到 Toolkit

```java
// AGENTIC 模式
KnowledgeRetrievalTools tools = new KnowledgeRetrievalTools(knowledgeBase);
Toolkit toolkit = new Toolkit();
toolkit.registerObject(tools);

ReActAgent agent = ReActAgent.builder()
    .name("助手")
    .model(model)
    .toolkit(toolkit)
    .build();
```

---

## 6. 扩展实现

实现自定义知识库只需实现 `Knowledge` 接口：

```java
public class MyKnowledge implements Knowledge {
    @Override
    public Mono<Void> addDocuments(List<Document> documents) {
        // 嵌入并存储到自定义向量存储
    }

    @Override
    public Mono<List<Document>> retrieve(String query, RetrieveConfig config) {
        // 语义搜索并返回结果
    }
}
```

可扩展点：
- **向量存储**: 替换底层向量数据库（Milvus、Pinecone、Weaviate 等）
- **嵌入模型**: 使用不同的 Embedding 模型
- **检索策略**: 实现混合检索（向量 + 关键词）、重排序等
- **RetrieveConfig**: 自定义检索参数（limit、scoreThreshold、conversationHistory 等）
