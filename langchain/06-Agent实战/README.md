# 06-Agent实战

本章通过 4 个完整项目，实践 LangChain 和 LangGraph 的综合应用。

## 学习目标

- 构建多 Agent 协作系统
- 实现生产级中间件扩展
- 管理复杂上下文工程
- 部署 Guardrails 安全防护
- 实现流式 SSE 部署
- 配置生产环境持久化和监控
- 集成 LangSmith 可观测性

## 章节内容

| 序号 | 标题 | 内容 |
|------|------|------|
| 01 | 多 Agent 协作 | Subagents（子 Agent 作为工具）、Handoffs（任务传递）、Skills（按需加载知识）、Router（路由分发）、自定义工作流（StateGraph）、模式对比（性能/适用场景）、子图流式输出 |
| 02 | 中间件扩展 | StructuredLoggingMiddleware（结构化日志）、RateLimitMiddleware（Token Bucket / 全局限流）、PII Detection（信用卡/身份证/手机/邮箱检测脱敏）、AuditMiddleware（完整审计日志）、ResponseCache（响应缓存）、生产中间件链组合 |
| 03 | 上下文工程实战 | 复杂 State 定义（TypedDict + Reducer）、Store 用户画像管理（Profile / Collection 模式）、交互历史存储与语义搜索、Context 运行时上下文注入、权限控制（角色 → 工具映射）、完整 ContextManagerMiddleware |
| 04 | Guardrails 与安全 | 输入验证（长度/格式/SQL 注入）、输出过滤（敏感词/格式验证）、PII 脱敏（检测和掩码）、速率限制（用户级 / Token Bucket）、Prompt 注入防御（模式检测 / 系统提示保护）、内容安全（敏感主题过滤） |
| 05 | 流式部署 | SSE vs WebSocket 对比、FastAPI StreamingResponse、OpenAI 兼容流式格式、前端 EventSource 集成、React 组件集成、Nginx 配置（关闭缓冲）、Gunicorn 部署 |
| 06 | 生产部署 | PostgreSQL Checkpointer（同步/异步）、PostgresStore 向量索引、Docker + docker-compose 部署、健康检查（/health / /health/ready / /health/live）、Prometheus 监控指标、结构化 JSON 日志、环境变量管理、错误处理 |
| 07 | 可观测性 | LangSmith 配置（环境变量 / 自动追踪）、Tracing（模型调用 / 工具调用 / 状态变化）、Evaluation（正确性 / 相关性评估器）、Debugging（比较追踪 / 查看子追踪）、Prometheus 自定义指标、持续评估循环 |
| 08 | 实战项目合集 | 4 个完整项目：① 对话机器人（Memory + Streaming + HITL + 用户偏好）② 文档 QA（RAG + PDF 解析 + Vector Store）③ Agent 助手（工具调用 + 动态选择 + 输入验证）④ 多 Agent 系统（Subgraph + Supervisor + 结果聚合） |

## 实战项目

| 项目 | 功能 | 技术要点 | 端口 |
|------|------|----------|------|
| chatbot | 对话机器人 | Memory + Streaming + HITL + Store | 8001 |
| doc_qa | 文档问答 | RAG + PDF 解析 + Vector Store | 8002 |
| agent_assistant | Agent 助手 | 工具调用 + Middleware + 动态选择 | 8003 |
| multi_agent_system | 多 Agent 系统 | Subgraph + Supervisor + Handoffs | 8004 |

## 生产部署架构

```
┌──────────────────────────────────────┐
│  Nginx (负载均衡)                     │
│    ↓                                 │
│  FastAPI × N (Gunicorn + Uvicorn)    │
│    ↓                                 │
│  PostgreSQL (Checkpointer + Store)   │
│    ↓                                 │
│  Redis (缓存)                        │
│    ↓                                 │
│  Prometheus + Grafana (监控)          │
│    ↓                                 │
│  LangSmith (可观测性)                 │
└──────────────────────────────────────┘
```

## 中间件链

```
输入 → 限流 → PII 检测 → 审计 → 缓存 → Agent → 输出过滤 → PII 脱敏 → 响应
```

## 关键概念

### 多 Agent 模式选择

| 场景 | 推荐模式 |
|------|---------|
| 上下文隔离 | Subagents |
| 直接交互 | Handoffs |
| 专业知识 | Skills |
| 并行处理 | Router |

### 安全防护

| 层级 | 措施 |
|------|------|
| 输入 | 验证、PII 检测、注入防御 |
| 执行 | 限流、权限控制 |
| 输出 | 过滤、脱敏、格式验证 |
| 系统 | 加密、监控、告警 |
