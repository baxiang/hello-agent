# 第一次调用 A2A：5 分钟跑通

> 本节用一个 `curl` 跑通 A2A 的最小闭环：**发现 Agent → 发消息 → 拿结果**。
>
> 全程只用 curl，不安装任何 SDK。学完这节，你就掌握了 A2A 协议的最基本用法。

## 整个流程只有两步

A2A 调用比 OpenAI API 多一步——你得先「发现」这个 Agent，才能跟它说话：

```
1. 发现：GET Agent Card         → 知道联系谁、能干什么
2. 对话：POST 发 JSON-RPC 消息  → 拿到回答或任务
```

下面分别走一遍。

## 第一步：发现 Agent（拿 Agent Card）

[上一节](./00-what-is-a2a.md) 我们说过，每个 A2A Server 在固定路径 `/.well-known/agent-card.json` 暴露自己的「名片」。先把它拉下来：

```bash
curl https://agents.example.com/.well-known/agent-card.json
```

返回类似：

```json
{
  "name": "Code Review Agent",
  "description": "审查源代码，返回安全和正确性建议。",
  "supportedInterfaces": [
    { "url": "https://agents.example.com/a2a" }
  ],
  "capabilities": {
    "streaming": true,
    "pushNotifications": false
  },
  "skills": [
    {
      "id": "review_code",
      "name": "Review Code",
      "description": "找出代码里的安全、正确性、可维护性问题。",
      "tags": ["security", "code-review"]
    }
  ]
}
```

**重点看三个字段**（决定下一步怎么调）：

| 字段 | 用途 |
|------|------|
| `supportedInterfaces[].url` | ⭐ **这是真正要 POST 的服务端点**（`https://agents.example.com/a2a`） |
| `capabilities.streaming` | 是否支持流式（流式怎么用见协议详解篇） |
| `skills` | 这个 Agent 能干什么——确认有没有你要的能力 |

::: tip 和 OpenAI API 的关键区别
OpenAI API 的端点（`https://api.openai.com/v1/chat/completions`）是写死的、全世界统一。A2A 每个 Agent 的端点都不一样，必须**先读 Card 拿 URL**，再发请求。多这一步「发现」，是 Agent 间协议的精髓。
:::

## 第二步：发消息（`SendMessage`）

A2A 默认用 **JSON-RPC 2.0** 协议包消息。一个最小的发消息请求：

```bash
curl -X POST https://agents.example.com/a2a \
  -H "Content-Type: application/json" \
  -d '{
    "jsonrpc": "2.0",
    "id": "req-001",
    "method": "SendMessage",
    "params": {
      "message": {
        "messageId": "msg-001",
        "role": "ROLE_USER",
        "parts": [
          { "text": "请用一句话介绍你的能力" }
        ]
      }
    }
  }'
```

### 逐行拆解

外层是标准 JSON-RPC 2.0 envelope：

| 字段 | 含义 |
|------|------|
| `"jsonrpc": "2.0"` | 协议版本（固定） |
| `"id": "req-001"` | 本次请求的追踪 ID（响应会带回相同 id） |
| `"method": "SendMessage"` | ⭐ **方法名**（A2A v1.0 用 PascalCase） |
| `"params"` | 方法参数 |

`params.message` 是消息本体：

| 字段 | 含义 |
|------|------|
| `messageId` | 消息唯一 ID（自己生成） |
| `role` | ⭐ **`ROLE_USER`**（注意是带前缀的枚举值，不是 `user`） |
| `parts` | 消息内容数组，每个 Part 含 `text` / `raw` / `url` / `data` 之一 |

::: warning 方法名易踩坑
A2A 方法名是 **PascalCase**：`SendMessage`、`GetTask`、`CancelTask`。如果你看到老资料写 `message/send`、`tasks/get`，那是 v0.x 旧版，v1.0 已废弃。
:::

## 第三步：看返回

A2A Server 的响应有两种形态，取决于这是「短回答」还是「长任务」。

### 情况 A：直接返回 Message（短回答）

如果 Agent 能立刻回答，返回一条 Message：

```json
{
  "jsonrpc": "2.0",
  "id": "req-001",
  "result": {
    "kind": "message",
    "messageId": "msg-002",
    "role": "ROLE_AGENT",
    "parts": [
      { "text": "我可以审查代码，找出安全漏洞、逻辑错误和可维护性问题。" }
    ]
  }
}
```

看 `result.role`（**`ROLE_AGENT`**）和 `result.parts`——这就是 Agent 的回答。

### 情况 B：返回 Task（长任务）

如果是个需要时间的任务（比如「审查这个 1000 行的 PR」），返回一个 Task：

```json
{
  "jsonrpc": "2.0",
  "id": "req-001",
  "result": {
    "kind": "task",
    "id": "task-001",
    "contextId": "ctx-abc",
    "status": {
      "state": "TASK_STATE_WORKING"
    }
  }
}
```

| 字段 | 含义 |
|------|------|
| `result.kind` | `"task"` 表示这是个任务 |
| `result.id` | **任务 ID**（记下来，后面查它） |
| `result.contextId` | 上下文 ID（同一对话归一组） |
| `result.status.state` | ⭐ **`TASK_STATE_WORKING`** 表示正在处理 |

::: tip 状态名是带前缀的枚举
A2A v1.0 的 Task 状态全部是 `TASK_STATE_` 前缀：`TASK_STATE_SUBMITTED` / `TASK_STATE_WORKING` / `TASK_STATE_COMPLETED` / `TASK_STATE_FAILED` / `TASK_STATE_CANCELED` / `TASK_STATE_INPUT_REQUIRED` / `TASK_STATE_REJECTED` / `TASK_STATE_AUTH_REQUIRED`。看到 `"working"` 这种简写也是 v0.x 旧版。
:::

拿到 Task 后，你后续可以用 `GetTask` 方法查询状态、用 `CancelTask` 取消——这些在[协议详解篇](../03-protocol-methods.md)展开。

## 最常见的 3 个错误

### 404 Not Found

```json
{"error": {"code": -32601, "message": "Method not found"}}
```

**原因**：Card 路径或端点 URL 拼错。
**修复**：确认 Card 路径是 `/.well-known/agent-card.json`（**v1.0 是 `agent-card.json`，不是 `agent.json`**），POST 端点用 Card 里 `supportedInterfaces[].url` 的值。

### 认证失败

```json
{"error": {"code": -32001, "message": "Unauthorized"}}
```

**原因**：这个 Agent 的 Card 声明了 `securitySchemes`，你没带要求的 Bearer Token / API key。
**修复**：读 Card 的 `securitySchemes` 和 `securityRequirements`，按声明的方式加 `Authorization: Bearer xxx` 头。

### JSON-RPC 格式错（含方法名错）

```json
{"error": {"code": -32600, "message": "Invalid Request"}}
```

**原因**：缺 `jsonrpc`/`id` 字段、或方法名用了 v0.x 旧名（`message/send`）。
**修复**：核对 envelope 是 `{"jsonrpc":"2.0","id":"...","method":"SendMessage",...}`，方法名 PascalCase。

## 动手实验

1. **跑通完整闭环**：找官方 demo 或自起一个 A2A Server，连续跑「curl 拿 Card → curl 发消息」两步，亲眼看到响应。
2. **触发 Task**：把消息内容改成「请帮我审查这个 1000 行代码：[贴一段代码]」，看返回是不是从 Message 变成 Task（`result.kind="task"`）。
3. **方法名对比**：故意把 `"method": "SendMessage"` 改成旧的 `"message/send"`，看 A2A Server 怎么报错——亲身体验 v1.0 的命名变化。
