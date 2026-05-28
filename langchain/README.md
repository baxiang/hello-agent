# 09-LangChain与LangGraph篇

本篇介绍 LangChain 和 LangGraph 框架，帮助 Python 开发者快速入门 AI 应用开发。

## 学习路径

```
01-LangChain入门 → 02-LangGraph入门 → 03-Agent入门
(基础组件)         (底层架构)         (组合使用)
        ↓
04-LangChain进阶 → 05-LangGraph进阶 → 06-Agent实战 → 07-DeepAgents篇
(应用场景)         (控制能力)         (完整项目)     (深度Agent)
```

## 章节目录

| 章节 | 内容 | 文件数 | 示例项目 |
|------|------|--------|----------|
| 01-LangChain入门 | 模型、消息、Prompt | 基础 | langchain_basics |
| 02-LangGraph入门 | StateGraph、Nodes、Edges | 基础 | langgraph_basics |
| 03-Agent入门 | 工具、Agent构建、ReAct | 基础 | agent_basics |
| 04-LangChain进阶 | 中间件、上下文工程、RAG、动态选择、结构化输出、流式 | 9 | langchain_advanced |
| 05-LangGraph进阶 | 记忆管理、长期记忆、中断、多中断、持久化、子图、Map-Reduce、迁移缓存 | 9 | langgraph_advanced |
| 06-Agent实战 | 多Agent、中间件扩展、Guardrails、流式部署、生产部署、可观测性、4个实战项目 | 8 | 4个实战项目 |
| 07-DeepAgents篇 | 深度Agent、子代理、沙箱 | 进阶 | deepagents_researcher |

## 04-LangChain进阶 详细内容

| 序号 | 标题 | 核心内容 |
|------|------|---------|
| 01 | 中间件概述 | Agent loop 架构、四种钩子（@before_agent / @after_agent / @wrap_model_call / @wrap_tool_call）、预置中间件 |
| 02 | 自定义中间件 | 装饰器详解、AgentMiddleware 类、State 更新、动态模型/工具/response_format 选择 |
| 03 | 上下文工程 | Model Context、State/Store/Context 三层架构、Tool Context、Life-cycle Context |
| 04 | RAG 架构 | Embeddings、Vector Store、Text Splitter、Retriever、RAG 注入 Agent 的三种方式 |
| 05 | 动态模型选择 | State-based / Store-based / Context-based 模型选择、多因素打分、降级策略 |
| 06 | 动态工具选择 | 按名称/类别/查询/权限过滤、运行时工具注册、MCP 集成 |
| 07 | 结构化输出进阶 | Union 类型、ToolStrategy、ProviderStrategy + Strict Mode、验证循环 |
| 08 | 流式输出 | Message 流式、astream_events v2、SSE FastAPI 部署、前端集成 |
| 09 | 进阶实战 | 智能客服 Agent：中间件链 + RAG + 动态选择 + 结构化输出 + FastAPI SSE |

## 05-LangGraph进阶 详细内容

| 序号 | 标题 | 核心内容 |
|------|------|---------|
| 01 | 记忆管理 | MessagesState、add_messages reducer、trim_messages、摘要压缩、滑动窗口 |
| 02 | 长期记忆 | BaseStore、InMemoryStore / PostgresStore、namespace 模式、语义搜索、三种记忆类型 |
| 03 | 中断与审核 | interrupt()、Command(resume=)、审批/编辑模式、工具中断、验证循环 |
| 04 | 多中断处理 | 并行中断、中断 ID 映射、串行中断、工具多中断、超时处理 |
| 05 | 持久化 | MemorySaver、SqliteSaver、PostgresSaver、异步 checkpointers、加密序列化 |
| 06 | 子图架构 | 嵌套 StateGraph、状态映射、父子通信、Command.PARENT、多层嵌套 |
| 07 | Map-Reduce 模式 | Send API、并行扇出、扇入聚合、动态图构建、容错处理 |
| 08 | 图迁移与缓存 | CachePolicy、状态模式演进、自动迁移、图版本管理、灰度发布 |
| 09 | 进阶实战 | 智能审批工作流：自动审核子图 + 人工审核中断 + PostgresSaver + SSE |

## 06-Agent实战 详细内容

| 序号 | 标题 | 核心内容 |
|------|------|---------|
| 01 | 多 Agent 协作 | Subagents、Handoffs、Skills、Router、自定义工作流、模式对比 |
| 02 | 中间件扩展 | 结构化日志、限流（Token Bucket）、PII 检测、审计、缓存 |
| 03 | 上下文工程实战 | State/Store/Context 综合应用、用户画像、交互历史、权限控制 |
| 04 | Guardrails 与安全 | 输入验证、输出过滤、PII 脱敏、速率限制、Prompt 注入防御 |
| 05 | 流式部署 | SSE vs WebSocket、FastAPI StreamingResponse、前端集成、Nginx 配置 |
| 06 | 生产部署 | PostgreSQL、Docker、健康检查、Prometheus 监控、环境变量、错误处理 |
| 07 | 可观测性 | LangSmith 追踪、评估器、调试、自定义监控、持续评估 |
| 08 | 实战项目合集 | 对话机器人、文档 QA、Agent 助手、多 Agent 系统（4 个完整项目） |

## 参考资源

- [LangChain 官方文档](https://docs.langchain.com/oss/python/langchain/overview)
- [LangGraph 官方文档](https://docs.langchain.com/oss/python/langgraph/overview)
- [Deep Agents 官方文档](https://docs.langchain.com/oss/python/deepagents/overview)
