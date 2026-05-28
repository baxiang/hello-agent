# 04-LangChain进阶

本章介绍 LangChain Agent 的进阶应用：中间件系统、上下文工程、RAG、动态选择、结构化输出、流式输出。

## 学习目标

- 掌握 Agent 中间件系统（四种钩子）
- 理解三层上下文模型（State / Store / Context）
- 构建 RAG 文档问答系统
- 实现动态模型和工具选择
- 使用结构化输出控制 LLM 响应格式
- 部署流式 SSE API

## 章节内容

| 序号 | 标题 | 内容 |
|------|------|------|
| 01 | 中间件概述 | Agent loop 架构、四种钩子（@before_agent / @after_agent / @wrap_model_call / @wrap_tool_call）、预置中间件（SummarizationMiddleware / HumanInTheLoopMiddleware / ModelFallbackMiddleware / ToolRetryMiddleware） |
| 02 | 自定义中间件 | 装饰器详解、AgentMiddleware 类、State 更新、动态模型/工具/response_format 选择、工具错误处理、限流和缓存 |
| 03 | 上下文工程 | Model Context（prompt/messages/tools/model/response_format）、State/Store/Context 三层架构对比、Tool Context（reads/writes）、Life-cycle Context、上下文注入和压缩模式 |
| 04 | RAG 架构 | Embeddings 模型对比、Vector Store（FAISS/Chroma/Qdrant）、Text Splitter 策略、Retriever 类型、RAG 注入 Agent 的三种方式、文档问答系统完整示例、混合搜索和重排序优化 |
| 05 | 动态模型选择 | State-based（消息数/用户等级/任务类型）、Store-based（用户偏好/历史）、Context-based（优先级/功能）、多因素打分系统、模型降级策略、使用监控 |
| 06 | 动态工具选择 | 按名称/类别/查询/权限过滤预注册工具、运行时工具注册（AgentMiddleware）、MCP 集成、工具缓存、智能意图分析 |
| 07 | 结构化输出进阶 | Union 类型多格式输出、ToolStrategy 与自定义错误处理、ProviderStrategy 与 Strict Mode、验证循环自动重试、嵌套模型和列表输出、策略选择指南 |
| 08 | 流式输出 | Message 流式输出、工具调用流式、astream_events v2 事件类型、SSE FastAPI 部署、前端 EventSource 集成、超时控制和心跳包 |
| 09 | 进阶实战 | 智能客服 Agent 完整项目：结合中间件链（输入验证 → RAG → 动态模型 → 动态工具）、结构化输出、FastAPI SSE 部署 |

## 示例项目

`langchain_advanced/` - RAG 文档问答基础版 + 中间件示例

## 关键概念

### Agent Loop 中间件架构

```
Agent Loop：
before_agent → wrap_model_call → model.invoke() → wrap_tool_call → tool.invoke() → 循环
```

### 三层上下文

| 层 | 生命周期 | 作用域 | 典型内容 |
|----|---------|--------|---------|
| State | 单次执行 | 当前对话 | 消息、临时变量 |
| Store | 持久化 | 跨对话 | 用户偏好、知识库 |
| Context | 单次请求 | 当前请求 | 用户 ID、角色 |

### 动态选择架构

```
查询 → 分析意图 → 选择模型 + 过滤工具 → 执行 → 结构化输出
```
