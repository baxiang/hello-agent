# io.agentscope.core.rag — RAG 包文档

## 核心抽象

| 类型 | 说明 |
|---|---|
| `Knowledge` | 知识库接口，提供 `addDocuments()` 和 `retrieve()` 方法 |
| `RAGMode` | 操作模式：`GENERIC`（框架自动检索注入）、`AGENTIC`（Agent 通过工具控制检索）、`NONE`（禁用） |
| `RetrieveConfig` | 检索参数：limit、scoreThreshold 等 |

## 与 ReActAgent 集成

```java
ReActAgent agent = ReActAgent.builder()
    .knowledge(knowledgeBase)
    .ragMode(RAGMode.GENERIC)
    .retrieveConfig(RetrieveConfig.builder().limit(5).scoreThreshold(0.5).build())
    .build();
```

## Hook

| Hook | 说明 |
|---|---|
| `GenericRAGHook` | 将检索到的知识注入推理输入（GENERIC 模式） |
| `KnowledgeRetrievalTools` | 将检索注册为 Agent 可调用的工具（AGENTIC 模式） |

## 扩展实现

在 `agentscope-extensions` 中可用的外部 RAG 实现：

| 扩展 | 描述 |
|---|---|
| `agentscope-extensions-rag-bailian` | 阿里云百灵 |
| `agentscope-extensions-rag-dify` | Dify RAG 平台 |
| `agentscope-extensions-rag-haystack` | Haystack 框架 |
| `agentscope-extensions-rag-ragflow` | RAGFlow |
| `agentscope-extensions-rag-simple` | 简单内存 RAG |

## 相关文档

- [核心包](../core.md)
