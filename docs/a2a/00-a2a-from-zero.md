# 00 - 从 0 开始学习 A2A 协议

A2A 的全称是 Agent2Agent，意思是“智能体到智能体”。它是一套让不同框架、不同语言、不同厂商实现的 AI Agent 互相发现、互相发送任务、交换进度和返回结果的开放协议。

一句话理解：

> MCP 让模型应用连接工具和上下文；A2A 让一个 Agent 连接另一个 Agent。

## 1. A2A 解决什么问题

随着 Agent 系统变复杂，一个应用往往不会只有一个 Agent。例如：

- 一个前台客服 Agent 需要把退款问题交给财务 Agent。
- 一个 IDE Agent 需要把安全审计交给安全 Agent。
- 一个企业助理 Agent 需要调用 HR、CRM、工单、数据分析等多个专业 Agent。

如果每两个 Agent 都用私有 HTTP API 对接，就会出现这些问题：

- 每个 Agent 都要适配不同接口。
- 很难统一发现远程 Agent 的能力。
- 长任务、流式进度、多轮补充信息没有统一模型。
- 不同系统之间容易暴露内部状态、工具和私有记忆。

A2A 的目标是提供一套通用交互模型：

- 发现 Agent 能力。
- 发送消息和任务。
- 获取任务状态。
- 接收流式进度。
- 交换文本、文件和结构化数据。
- 在不暴露内部推理、记忆和工具实现的前提下协作。

## 2. A2A 的核心角色

### Client Agent

Client Agent 是发起请求的一方。它可能是用户正在交互的主 Agent，也可能是一个编排器。它负责：

- 发现远程 Agent。
- 读取 Agent Card。
- 根据能力决定是否委派任务。
- 发送 Message。
- 追踪 Task 状态。
- 处理流式事件、补充输入和最终结果。

### Remote Agent

Remote Agent 是接收请求并执行任务的一方。它负责：

- 暴露 Agent Card。
- 接收 A2A 消息。
- 返回 Message 或 Task。
- 在长任务中更新状态。
- 生成 Artifact。
- 必要时请求更多输入或认证。

Remote Agent 可以是任何内部实现：LangGraph、ADK、Semantic Kernel、自研框架、普通服务，甚至人工流程。A2A 不要求对方公开内部工具、链路或思考过程。

### Agent Card

Agent Card 是远程 Agent 的“名片”。Client 通过它理解这个 Agent：

- 是谁。
- 服务地址在哪里。
- 支持哪些协议和能力。
- 能处理哪些技能。
- 接受哪些输入模态。
- 输出哪些结果模态。
- 需要什么认证方式。

常见发现路径是：

```text
GET /.well-known/agent-card.json
```

一个极简示例：

```json
{
  "name": "Code Review Agent",
  "description": "Reviews source code and returns actionable findings.",
  "url": "https://agents.example.com/code-review",
  "version": "1.0.0",
  "defaultInputModes": ["text/plain"],
  "defaultOutputModes": ["text/plain"],
  "capabilities": {
    "streaming": true
  },
  "skills": [
    {
      "id": "review_code",
      "name": "Review Code",
      "description": "Finds correctness, security, and maintainability issues."
    }
  ]
}
```

## 3. A2A 的基础数据模型

A2A 重点围绕四个对象组织：Message、Part、Task、Artifact。

### 3.1 Message

Message 是一次对话消息。它通常包含：

- `role`：消息角色，例如 `user` 或 `agent`。
- `messageId`：消息唯一 ID。
- `parts`：消息内容块。
- `contextId`：可选，用于把一组交互归到同一个上下文。
- `taskId`：可选，用于继续某个任务。

示例：

```json
{
  "kind": "message",
  "messageId": "msg-001",
  "role": "user",
  "parts": [
    {
      "kind": "text",
      "text": "请审查这个 PR 的安全风险"
    }
  ]
}
```

### 3.2 Part

Part 是 Message 或 Artifact 里的内容块。常见类型：

- `text`：纯文本。
- `file`：文件，可以是 URI 或字节内容。
- `data`：结构化 JSON 数据。

示例：结构化数据 Part。

```json
{
  "kind": "data",
  "data": {
    "repository": "example/api",
    "pullRequest": 42
  }
}
```

### 3.3 Task

Task 是一次可追踪的工作单元。A2A 特别适合长任务，例如：

- 生成一份报告。
- 分析一个代码库。
- 等待用户补充信息。
- 调用外部系统完成审批。

Task 通常包含：

- `id` 或 `taskId`：任务 ID。
- `contextId`：上下文 ID。
- `status`：当前状态。
- `artifacts`：任务产物。
- `history`：可选消息历史。
- `metadata`：扩展元数据。

常见状态：

| 状态 | 含义 |
| --- | --- |
| `submitted` | 已提交，等待处理 |
| `working` | 正在处理 |
| `input-required` | 需要 Client 或用户补充输入 |
| `auth-required` | 需要完成认证或授权 |
| `completed` | 已成功完成 |
| `canceled` | 已取消 |
| `rejected` | 被拒绝执行 |
| `failed` | 执行失败 |
| `unknown` | 状态未知 |

### 3.4 Artifact

Artifact 是 Agent 产生的结果。它可以是：

- 文本回答。
- 报告文件。
- 图表。
- JSON 数据。
- 中间产物或最终产物。

示例：

```json
{
  "artifactId": "artifact-001",
  "name": "security_review",
  "parts": [
    {
      "kind": "text",
      "text": "发现 2 个高风险问题和 3 个中风险问题。"
    }
  ]
}
```

## 4. 通信基础：HTTP + JSON-RPC 2.0

A2A 可以有不同协议绑定，最常见的是 JSON-RPC 2.0 over HTTP。

一个最小请求：

```json
{
  "jsonrpc": "2.0",
  "id": "req-001",
  "method": "message/send",
  "params": {
    "message": {
      "kind": "message",
      "messageId": "msg-001",
      "role": "user",
      "parts": [
        {
          "kind": "text",
          "text": "你好，请介绍你的能力"
        }
      ]
    }
  }
}
```

成功响应可能直接返回 Message：

```json
{
  "jsonrpc": "2.0",
  "id": "req-001",
  "result": {
    "kind": "message",
    "messageId": "msg-002",
    "role": "agent",
    "parts": [
      {
        "kind": "text",
        "text": "我可以审查代码、分析日志并生成报告。"
      }
    ]
  }
}
```

也可能返回 Task：

```json
{
  "jsonrpc": "2.0",
  "id": "req-001",
  "result": {
    "kind": "task",
    "id": "task-001",
    "contextId": "ctx-001",
    "status": {
      "state": "working"
    }
  }
}
```

## 5. 常见协议操作

### 5.1 `message/send`

发送一条消息，等待远程 Agent 返回一个结果。结果可以是：

- 直接 Message：适合短回答。
- Task：适合长任务或需要后续查询。

使用场景：

- 问一个简单问题。
- 启动一个任务。
- 给已有上下文继续补充消息。

### 5.2 `message/stream`

发送消息，并通过流式方式接收多个事件。通常用于：

- 实时显示进度。
- 返回部分结果。
- 长时间运行任务。
- 需要更好的用户体验。

常见底层方式是 SSE（Server-Sent Events）。

### 5.3 `tasks/get`

查询某个任务的当前状态和结果。

```json
{
  "jsonrpc": "2.0",
  "id": "req-002",
  "method": "tasks/get",
  "params": {
    "id": "task-001"
  }
}
```

### 5.4 `tasks/cancel`

请求取消正在执行的任务。

```json
{
  "jsonrpc": "2.0",
  "id": "req-003",
  "method": "tasks/cancel",
  "params": {
    "id": "task-001"
  }
}
```

### 5.5 Push Notification

对于很长的任务，Client 不一定一直保持连接。A2A 支持通过推送通知配置，让 Server 在任务变化时回调 Client 指定地址。

实现时要格外注意：

- 回调 URL 必须校验。
- 通知内容不能泄露敏感数据。
- 应有签名、认证或来源校验。
- 失败重试要有上限。

## 6. 一次典型 A2A 流程

### 6.1 发现远程 Agent

Client 读取 Agent Card。

```text
GET https://agents.example.com/.well-known/agent-card.json
```

Client 检查：

- Agent 名称和描述是否匹配需求。
- 是否支持需要的输入输出模态。
- 是否支持 streaming。
- 是否需要认证。
- 是否有合适的 skill。

### 6.2 发送消息

Client 调用 `message/send` 或 `message/stream`。

短任务可以用 `message/send`。

长任务或需要进度展示时用 `message/stream`。

### 6.3 处理返回

如果返回 Message，说明远程 Agent 已直接完成回答。

如果返回 Task，Client 保存：

- `contextId`
- `taskId`
- 当前状态

后续可以通过 `tasks/get` 查询，也可以在同一 `contextId` 中继续发消息。

### 6.4 补充输入

如果状态是 `input-required`，说明远程 Agent 需要更多信息。例如：

- 缺少文件。
- 需要选择范围。
- 需要用户确认。
- 参数不够明确。

Client 应把问题展示给用户，再把补充内容作为新 Message 发回。

### 6.5 获取最终产物

当状态进入 `completed`，Client 读取 Task 的 `artifacts`。这些 Artifact 才是远程 Agent 的可消费结果。

## 7. A2A 与 MCP 的区别

| 维度 | MCP | A2A |
| --- | --- | --- |
| 主要对象 | 工具、资源、提示词 | Agent、消息、任务、产物 |
| 典型关系 | AI 应用连接外部工具/上下文 | 一个 Agent 委派或协作另一个 Agent |
| 关注点 | 工具发现、上下文读取、工具调用 | Agent 发现、任务协作、状态追踪 |
| 内部状态 | Server 不应看到完整对话 | Agent 不需要暴露内部记忆和工具 |
| 长任务 | 可以做，但不是核心抽象 | Task 是核心抽象 |
| 常见传输 | stdio、Streamable HTTP | HTTP JSON-RPC、SSE、可扩展绑定 |

一个实践判断：

- 如果你要把“数据库查询、文件读取、GitHub API”接给模型，用 MCP。
- 如果你要把“代码审查 Agent、财务 Agent、客服 Agent”接给另一个 Agent，用 A2A。

两者可以组合：

```text
主 Agent --A2A--> 代码审查 Agent --MCP--> GitHub / 文件系统 / CI 系统
```

## 8. 安全和权限边界

A2A 让 Agent 能互相协作，但不意味着彼此完全信任。

### 8.1 认证

远程 Agent 应通过 Agent Card 声明安全要求。生产环境常见方式：

- Bearer Token。
- OAuth 2.0。
- mTLS。
- 企业 API 网关。

### 8.2 授权

认证只说明“是谁”，授权才说明“能做什么”。Client 调用前应确认：

- 这个 Agent 是否允许访问该用户的数据。
- 这个任务是否允许委派给外部系统。
- 返回结果是否可以进入当前上下文。

### 8.3 数据最小化

不要把完整对话、全部文件、所有客户信息直接发给远程 Agent。只发送完成任务必需的数据。

### 8.4 不暴露内部推理

A2A 的一个重要原则是 opaque execution：Agent 可以协作，但不需要公开内部思考、私有工具、记忆或编排策略。

### 8.5 人类确认

如果远程 Agent 的结果会触发高风险动作，例如：

- 发邮件。
- 创建工单。
- 修改生产数据。
- 提交代码。
- 执行付款。

Host 或 Client Agent 应该把动作展示给用户确认。

## 9. 从 0 实现一个 A2A Server 的清单

第一版不要做复杂。建议先做只读、无副作用 Agent。

最小能力：

1. 提供 `/.well-known/agent-card.json`。
2. 提供 JSON-RPC HTTP 入口。
3. 支持 `message/send`。
4. 能返回简单 Message。
5. 错误时返回标准 JSON-RPC error。

第二阶段加入：

1. 返回 Task。
2. 实现 `tasks/get`。
3. 实现 `tasks/cancel`。
4. 支持 `message/stream`。
5. 产出 Artifact。

第三阶段再考虑：

1. 认证和授权。
2. Push Notification。
3. 多租户隔离。
4. 审计日志。
5. OpenTelemetry 追踪。
6. 限流和超时。

## 10. 常见误区

### 误区一：A2A 是工具调用协议

不是。A2A 的抽象对象是 Agent、Message、Task 和 Artifact。工具调用更适合由 Agent 内部或 MCP 来处理。

### 误区二：所有请求都应该变成 Task

不是。短响应直接返回 Message 更简单。只有长任务、需要进度、需要补充输入或异步执行时才需要 Task。

### 误区三：Agent Card 只是文档

不是。Agent Card 是机器可读的发现与能力声明。Client 应根据它决定是否连接、如何认证、是否启用流式等。

### 误区四：远程 Agent 可以信任

不能默认信任。远程 Agent 的输出要当作外部输入处理，敏感动作必须经过权限控制和确认。

## 11. 练习路线

建议按下面顺序学习和实现：

1. 写一个静态 Agent Card。
2. 写一个 `message/send`，收到文本后返回文本 Message。
3. 让 `message/send` 对复杂请求返回 Task。
4. 写 `tasks/get` 查询 Task 状态。
5. 用 SSE 写 `message/stream` 返回进度。
6. 给 Task 添加 Artifact。
7. 加入 Bearer Token 认证。
8. 写一个 Client 读取 Agent Card 并调用远程 Agent。
9. 把 A2A Agent 内部接入 MCP 工具。

## 12. 核心术语速查

| 术语 | 含义 |
| --- | --- |
| A2A | Agent2Agent，智能体到智能体通信协议 |
| Client Agent | 发起请求、委派任务的一方 |
| Remote Agent | 接收请求、执行任务的一方 |
| Agent Card | 远程 Agent 的机器可读能力说明 |
| Skill | Agent Card 中声明的一项能力 |
| Message | 一条对话消息 |
| Part | Message 或 Artifact 中的内容块 |
| Task | 可追踪的工作单元 |
| Task Status | Task 的当前状态 |
| Artifact | Agent 产生的结果或产物 |
| Context ID | 把多条消息和任务归为同一交互上下文的 ID |
| Streaming | 通过流式事件返回进度和中间结果 |
| Push Notification | 长任务状态变化时回调 Client 的机制 |

## 13. 官方参考

- A2A 最新规范：https://a2a-protocol.org/latest/specification/
- A2A 任务生命周期：https://a2a-protocol.org/latest/topics/life-of-a-task/
- A2A 官方仓库：https://github.com/a2aproject/A2A

## 14. 本目录接下来怎么学

这篇只建立第一层地图。继续阅读建议按下面顺序：

1. `01-agent-discovery-card.md`：先理解 Agent 如何被发现，以及 Agent Card 怎么描述能力。
2. `02-message-task-model.md`：深入 Message、Part、Task、Artifact 和任务状态机。
3. `03-protocol-methods.md`：学习 JSON-RPC 方法、流式事件、错误处理和回调。
4. `04-security-architecture.md`：把认证、授权、隐私、prompt injection 和人类确认串起来。
5. `05-implementation-guide.md`：按工程清单实现一个最小 A2A Server 和 Client。

学习 A2A 的关键判断：

- 远程能力是“Agent 能完成的任务”，不是低层工具函数。
- Agent Card 是机器可读契约，不是说明文档。
- 短请求可以直接返回 Message，长请求应该返回 Task。
- Task 的 `input-required` 和 `auth-required` 是多轮协作的重要状态。
- Artifact 是可消费结果，history 是过程上下文，不要混用。
- 远程 Agent 输出要当作外部输入处理，不能默认可信。

