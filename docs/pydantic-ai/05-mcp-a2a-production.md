# 05 - MCP、A2A 与生产工程

Pydantic AI 的核心是类型化 Agent，但生产系统往往还需要接外部工具、和其他 Agent 协作、处理人工审批，并部署到可观测、可回滚的环境里。

## 1. MCP 集成

MCP 适合把外部工具和上下文接给 Agent。

常见场景：

- 文件系统。
- GitHub。
- 数据库。
- 内部文档。
- 浏览器或自动化工具。

架构：

```text
Pydantic AI Agent
  |
  | tool / toolset
  v
MCP Server
  |
  +-- external system
```

设计原则：

- MCP 工具仍要经过 Pydantic AI 的权限和审批策略。
- 不要让 Agent 自动调用高风险 MCP tool。
- MCP 返回内容是外部输入，要防 prompt injection。
- 对大型 resource 做摘要或分块。

## 2. A2A 集成现状

A2A 用于 Agent 和 Agent 协作。需要注意当前官方文档提示：Pydantic AI 1.x 中 `Agent.to_a2a()` 和 `pydantic-ai-slim[a2a]` extra 已标记弃用，并计划在 2.0 移除；新的 A2A 桥接方向应关注 `fasta2a` 包。

所以学习时应区分：

- 概念上：Pydantic AI Agent 可以成为 A2A Remote Agent 的内部实现。
- 工程上：不要把已弃用 API 当长期主路径。
- 生产上：用明确维护的桥接层暴露 A2A 协议。

典型架构：

```text
Main Agent
  |
  | A2A
  v
Remote Agent Server
  |
  v
Pydantic AI Agent
  |
  +-- MCP tools
  +-- internal APIs
```

## 3. Human-in-the-loop

Agent 工具调用分风险等级：

| 风险 | 示例 | 策略 |
| --- | --- | --- |
| 低 | 查询订单、搜索文档 | 可自动 |
| 中 | 创建草稿、生成 PR 评论建议 | 可能需要确认 |
| 高 | 退款、发邮件、写数据库、执行命令 | 必须确认 |

审批信息应包括：

- Agent 名称。
- 工具名。
- 参数摘要。
- 目标系统。
- 影响范围。
- 是否可撤销。

## 4. 安全设计

### 4.1 Prompt Injection

工具结果、MCP resource、A2A 远程输出都可能包含恶意指令。

防护：

- 标记外部内容来源。
- 不把外部内容当系统指令。
- 高风险工具调用需要审批。
- 对 URL、路径、SQL、shell 参数做 allowlist。

### 4.2 Secrets

不要把 secret 放进：

- prompt。
- message history。
- tool 返回值。
- eval fixtures。
- trace 明文。

通过 deps 注入 client，由 client 内部使用凭证。

### 4.3 权限

权限应绑定：

- 用户。
- 租户。
- 工具。
- 数据范围。
- 操作类型。

不要只在前端隐藏按钮。工具函数和外部 API 层都要校验权限。

## 5. 部署形态

常见部署：

```text
FastAPI service
  |
  +-- Pydantic AI Agent
  +-- dependency providers
  +-- background task queue
  +-- Logfire / OTel
```

建议：

- Agent 定义放模块级复用。
- 每个请求创建 deps。
- 外部 clients 使用连接池。
- 长任务放队列。
- 结果和 trace id 入库。

## 6. 成本和限流

生产 Agent 必须控制成本。

策略：

- 用户级 rate limit。
- 租户级预算。
- 单次 run 最大 token。
- 最大工具调用次数。
- 模型 fallback。
- 缓存只读工具结果。
- evals 中记录成本变化。

## 7. 错误处理

错误分类：

| 类型 | 示例 | 策略 |
| --- | --- | --- |
| 用户输入错误 | 缺少 order_id | 返回可操作提示 |
| 工具业务错误 | 订单不存在 | 告诉模型和用户事实 |
| 外部服务错误 | API timeout | 重试或降级 |
| 输出校验错误 | schema 不匹配 | 框架重试，最终失败入日志 |
| 权限错误 | 无权访问 | 拒绝并审计 |

## 8. 测试策略

最小测试层：

1. Pydantic output model 单元测试。
2. Tool 函数单元测试。
3. deps fake 测试。
4. Agent 使用 test model 的行为测试。
5. evals 回归测试。
6. 少量真实 provider smoke test。

不要把所有测试都变成真实 LLM 调用。那会慢、贵、不稳定。

## 9. 生产清单

上线前确认：

- Agent 单一职责清楚。
- output schema 有版本。
- tool 有权限校验。
- 高风险 tool 有审批。
- deps 不泄露 secret。
- 观测字段完整。
- evals 覆盖关键行为。
- 成本和限流已配置。
- provider 超时和重试已配置。
- 用户数据保留策略明确。
- MCP/A2A 接入点有安全边界。

## 10. 学习任务

按顺序实践：

1. 写一个结构化输出 Agent。
2. 加入只读工具。
3. 用 deps 注入 fake 数据源。
4. 写单元测试。
5. 接入一个 MCP 工具。
6. 为高风险工具加审批流程设计。
7. 加入 Logfire 或 OTel trace。
8. 写 10 个 eval cases。
9. 用 FastAPI 暴露 Agent。
10. 设计 A2A bridge，但避免依赖已弃用 API。

