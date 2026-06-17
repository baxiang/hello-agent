# 协议方法

> **协议详解篇第四节。** [消息与任务模型](./02-message-task-model.md) 定义了「数据长什么样」，本节回答「怎么发出去、怎么查、怎么取消、怎么流式拿进度」。这是 A2A 协议最贴近「API 调用」的一层，但比 REST 复杂——它要同时支持同步问答、长任务、流式事件、推送回调四种交互模式。
>
> **本节你将学到**：JSON-RPC 2.0 在 A2A 中的角色、v1.0 的 9 个核心方法（`SendMessage` / `SendStreamingMessage` / `GetTask` / `CancelTask` / `ListTasks` / `SubscribeToTask` / Push Notification 一族）、多种传输绑定（JSON-RPC、gRPC、HTTP/REST）、JSON-RPC 错误与 Task 业务失败的区分、幂等与重试策略。
>
> **一句话比喻**：把 A2A 方法想成**和外包团队打交道的方式**——`SendMessage` 是发邮件等回信，`SendStreamingMessage` 是开工后实时看直播进度，`GetTask` 是打电话问进度，`CancelTask` 是叫停项目，Push Notification 是「干完了发短信通知我」。

A2A 的方法层定义了 Client 与 Server 之间的交互原语。它**不绑定某一种传输**——v1.0 支持 JSON-RPC 2.0、gRPC、HTTP/REST 以及自定义绑定，只要语义一致即可。本章默认用 JSON-RPC 2.0 + HTTP 作为演示传输，因为它最直观、也最常见。

::: tip v1.0 传输不止 JSON-RPC
v0.x 时代 A2A 几乎等同于「HTTP + JSON-RPC + SSE」。**v1.0 把传输层抽象出来了**：你可以用 gRPC（强类型、二进制、原生流式）、JSON-RPC（轻量、文本）、HTTP/REST（Google-AIP 风格，如 `POST /message:send`、`GET /tasks`、`POST /tasks/{id}:cancel`）、甚至自定义绑定。SSE 只是 JSON-RPC/HTTP 绑定下实现流式的一种机制，**不是独立传输**。
:::

## 1. JSON-RPC 基础

请求：

```json
{
  "jsonrpc": "2.0",
  "id": "req-001",
  "method": "SendMessage",
  "params": {}
}
```

成功响应：

```json
{
  "jsonrpc": "2.0",
  "id": "req-001",
  "result": {}
}
```

错误响应：

```json
{
  "jsonrpc": "2.0",
  "id": "req-001",
  "error": {
    "code": -32602,
    "message": "Invalid params"
  }
}
```

JSON-RPC 把「方法名」和「参数」分开，把「成功结果」和「错误」分成 `result` / `error` 两个字段，非常适合 Agent 这种「同一个方法可能返回多种结果类型」的场景。

## 2. v1.0 方法清单

v1.0 把方法收敛为一组语义明确的核心 API：

| 方法 | 用途 | 返回/流 |
|------|------|---------|
| **`SendMessage`** | 发一条消息，同步等待结果 | Message 或 Task |
| **`SendStreamingMessage`** | 发消息并以事件流形式返回进度 | 流式 Message / Task 事件 |
| **`GetTask`** | 查询单个 Task 的当前状态 | Task |
| **`ListTasks`** ⭐ v1.0 新增 | 列出任务（可按 context、状态过滤） | Task 数组 |
| **`CancelTask`** | 请求取消任务 | Task |
| **`SubscribeToTask`** ⭐ v1.0 新增 | 订阅**已有任务**的后续更新 | 流式 Task 事件 |
| **`CreateTaskPushNotificationConfig`** | 注册推送回调配置 | PushNotificationConfig |
| **`GetTaskPushNotificationConfig`** | 查询推送回调配置 | PushNotificationConfig |
| **`ListTaskPushNotificationConfigs`** | 列出某任务的多个回调配置 | PushNotificationConfig 数组 |
| **`DeleteTaskPushNotificationConfig`** | 删除推送回调配置 | 空 |

::: warning v0.x → v1.0 方法名变化
网上大量老资料、博客、SDK 文档还在用 v0.x 方法名。**v1.0 已经全面改名**，请按下表对齐：

| v0.x 旧名 | v1.0 新名 |
|-----------|-----------|
| `message/send` | **`SendMessage`** |
| `message/stream` | **`SendStreamingMessage`** |
| `tasks/get` | **`GetTask`** |
| `tasks/cancel` | **`CancelTask`** |
| `tasks/pushNotification/set` | **`CreateTaskPushNotificationConfig`** |
| （无） | **`ListTasks`**（新增） |
| （无） | **`SubscribeToTask`**（新增） |
| （无） | **`GetTaskPushNotificationConfig`** / **`ListTaskPushNotificationConfigs`** / **`DeleteTaskPushNotificationConfig`** |

**最容易踩的坑**：把旧 demo 的 `message/send` 直接拷过来，结果 v1.0 Server 返回 `method not found`。
:::

## 3. SendMessage

`SendMessage` 用于发送一条消息并同步等待结果。它是最常用的入口。

请求：

```json
{
  "jsonrpc": "2.0",
  "id": "req-001",
  "method": "SendMessage",
  "params": {
    "message": {
      "kind": "message",
      "messageId": "msg-001",
      "role": "ROLE_USER",
      "parts": [
        { "text": "请审查 PR 42 的安全风险" }
      ]
    }
  }
}
```

可能返回 Message（适合简单问答）：

```json
{
  "jsonrpc": "2.0",
  "id": "req-001",
  "result": {
    "kind": "message",
    "messageId": "msg-002",
    "role": "ROLE_AGENT",
    "parts": [
      { "text": "可以处理，请提供仓库地址。" }
    ]
  }
}
```

也可能返回 Task（适合长任务）：

```json
{
  "jsonrpc": "2.0",
  "id": "req-001",
  "result": {
    "kind": "task",
    "id": "task-001",
    "contextId": "ctx-001",
    "status": {
      "state": "TASK_STATE_SUBMITTED"
    }
  }
}
```

选择建议：

- 简单问答：返回 Message。
- 需要几秒以上、需要进度、可能补充输入、或需要异步执行：返回 Task。

::: tip 同一个方法，两种返回
`SendMessage` 的返回是**联合类型**（Message | Task）。Client 必须先看 `result.kind`：是 `message` 就直接展示，是 `task` 就进入任务追踪流程（轮询、订阅或推送）。
:::

## 4. SendStreamingMessage

`SendStreamingMessage` 用于发送消息并接收**流式事件**。适合长任务和实时进度展示。

请求体与 `SendMessage` 一致（只改 `method`）：

```json
{
  "jsonrpc": "2.0",
  "id": "req-stream-001",
  "method": "SendStreamingMessage",
  "params": {
    "message": {
      "kind": "message",
      "messageId": "msg-stream-001",
      "role": "ROLE_USER",
      "parts": [
        { "text": "分析过去 24 小时的部署日志，找出所有失败的发布" }
      ]
    }
  }
}
```

响应是一条事件流（在 HTTP/JSON-RPC 绑定下通常走 SSE）。典型事件序列：

```text
Task created              -> state: TASK_STATE_SUBMITTED
Task status update        -> state: TASK_STATE_WORKING
Artifact update           -> 阶段性报告片段
Task status update        -> state: TASK_STATE_INPUT_REQUIRED
Task status update        -> state: TASK_STATE_WORKING
Artifact update           -> 最终报告
Task status update        -> state: TASK_STATE_COMPLETED
```

每个事件都是一个 `SendTaskStreamingResponse`，内含 Task 或 Message 的增量。

流式模式的价值：

- 用户不用干等最后结果。
- Client 可以展示进度。
- Server 可以分批返回产物。
- 长任务体验更好。

实现注意：

- 事件要能被 Client 增量处理。
- 断线后要能用 `GetTask` 查询最终状态。
- **不要只依赖流式连接保存唯一状态**——连接随时会断。

::: warning SendStreamingMessage vs SubscribeToTask
两者都返回流，但起点不同：
- **`SendStreamingMessage`** = 「发一条**新消息** + 同时开流」——用于发起交互。
- **`SubscribeToTask`** = 「**不**发新消息，只是订阅一个**已有 Task** 的后续更新」——用于已经发过 `SendMessage` 拿到 task id、但当时没开流（或流断了想重连）的场景。
:::

## 5. GetTask

`GetTask` 查询单个 Task 的当前快照。

请求：

```json
{
  "jsonrpc": "2.0",
  "id": "req-002",
  "method": "GetTask",
  "params": {
    "id": "task-001"
  }
}
```

响应：

```json
{
  "jsonrpc": "2.0",
  "id": "req-002",
  "result": {
    "kind": "task",
    "id": "task-001",
    "contextId": "ctx-001",
    "status": {
      "state": "TASK_STATE_COMPLETED"
    },
    "artifacts": [
      {
        "artifactId": "art-001",
        "name": "review",
        "parts": [
          { "text": "发现 3 个问题。" }
        ]
      }
    ]
  }
}
```

可带 `historyLength` 参数限制返回的历史消息条数，避免大任务回包过大。

## 6. ListTasks（v1.0 新增）

`ListTasks` 列出任务，可按 `contextId`、状态等过滤。v1.0 之前 Client 只能自己记住 task id，无法查询 Server 上有哪些任务——这对多会话、多 Client、运维场景非常不便，v1.0 补上了这个能力。

请求：

```json
{
  "jsonrpc": "2.0",
  "id": "req-list-001",
  "method": "ListTasks",
  "params": {
    "contextId": "ctx-001",
    "filter": {
      "state": ["TASK_STATE_WORKING", "TASK_STATE_INPUT_REQUIRED"]
    }
  }
}
```

响应：

```json
{
  "jsonrpc": "2.0",
  "id": "req-list-001",
  "result": {
    "tasks": [
      {
        "kind": "task",
        "id": "task-001",
        "contextId": "ctx-001",
        "status": { "state": "TASK_STATE_WORKING" }
      },
      {
        "kind": "task",
        "id": "task-009",
        "contextId": "ctx-001",
        "status": { "state": "TASK_STATE_INPUT_REQUIRED" }
      }
    ]
  }
}
```

典型用途：

- 仪表盘展示「这个上下文里还在跑的任务」。
- 重连后找回失联的 task id。
- 运维清理长期 `TASK_STATE_WORKING` 的僵尸任务。

## 7. CancelTask

`CancelTask` 请求取消任务。

```json
{
  "jsonrpc": "2.0",
  "id": "req-003",
  "method": "CancelTask",
  "params": {
    "id": "task-001"
  }
}
```

返回取消后的 Task（通常是 `TASK_STATE_CANCELED`，注意单 L）。

注意：

- 取消是**请求**，不保证立即成功——Server 可能正在执行不可中断的外部动作。
- 如果任务已是终态（completed / failed / canceled / rejected），Server 应返回当前状态或合理错误。
- 对外部系统（发邮件、调第三方 API、写库）的动作要设计补偿事务或明确标注「不可取消」。

## 8. SubscribeToTask（v1.0 新增）

`SubscribeToTask` 订阅**已存在任务**的后续更新，返回事件流。它和 `SendStreamingMessage` 的区别见 §4 的 warning 框——核心是**不发送新消息**。

请求：

```json
{
  "jsonrpc": "2.0",
  "id": "req-sub-001",
  "method": "SubscribeToTask",
  "params": {
    "id": "task-001"
  }
}
```

典型场景：

- 用 `SendMessage` 同步发起了一个 Task（拿到 task id），中途想改用流式看进度。
- `SendStreamingMessage` 的流断了，想重连续看同一个任务。
- 多个 Client / 多个面板订阅同一个任务的进展。

事件格式与 `SendStreamingMessage` 一致。

## 9. Push Notification 一族

Push Notification 适合**超长任务**（几分钟到几小时）。Client 先注册一个回调配置，Server 在状态变化时主动 POST 通知 Client。这避免了 Client 长时间挂流式连接。

### 9.1 注册回调：CreateTaskPushNotificationConfig

```json
{
  "jsonrpc": "2.0",
  "id": "req-push-001",
  "method": "CreateTaskPushNotificationConfig",
  "params": {
    "taskId": "task-001",
    "pushNotificationConfig": {
      "url": "https://client.example.com/a2a/callback",
      "token": "random-secret-token",
      "authentication": {
        "schemes": ["bearer"]
      }
    }
  }
}
```

### 9.2 配套方法

- **`GetTaskPushNotificationConfig`**：查询单个回调配置。
- **`ListTaskPushNotificationConfigs`**：列出某任务的所有回调（v1.0 支持一个任务挂多个回调，如一个发 webhook、一个发邮件）。
- **`DeleteTaskPushNotificationConfig`**：删除某个回调配置。

::: warning v0.x → v1.0 Push Notification 变化
v0.x 只有一个 `tasks/pushNotification/set` 一把梭。**v1.0 把它拆成完整 CRUD**：Create / Get / List / Delete，并支持「单任务多回调」。如果你的旧 SDK 只有 set 方法，升级时要重新设计回调生命周期管理。
:::

适用场景：

- 任务运行几分钟到几小时。
- Client 不想保持长流式连接。
- 移动端、后台任务、批处理。

安全要求（**重要**）：

- 回调 URL 必须验证归属（防止注册到攻击者服务器泄露数据）。
- 通知应带签名或预共享 token，Client 必须校验。
- **不要把敏感 Artifact 全量推送到不可信 URL**——优先推状态变更，敏感内容让 Client 回头用 `GetTask` 拉。
- 重试要有指数退避和上限。

## 10. 传输绑定

A2A v1.0 把「方法语义」和「传输」解耦。同一个 `SendMessage`，在不同绑定下有不同的 wire 表现：

| 绑定 | 风格 | 流式机制 | 适合 |
|------|------|---------|------|
| **JSON-RPC 2.0 over HTTP** | `method` + `params` | SSE | 通用、易调试、Web 友好 |
| **gRPC** | proto 服务 + 强类型 message | server-streaming / bi-stream | 强类型、高性能、内部服务间 |
| **HTTP/REST** | Google-AIP 风格资源路径 | SSE / chunked | 对 REST 生态友好、易接网关 |
| **自定义绑定** | 由实现定义 | 由实现定义 | 特殊网络（如消息队列、WebSocket） |

### 10.1 REST 绑定示例

REST 绑定用 Google-AIP 风格，把方法映射成「资源 + 动作」：

```text
POST   /message:send              -> SendMessage
POST   /message:stream            -> SendStreamingMessage（SSE 响应）
GET    /tasks/{id}                -> GetTask
GET    /tasks                     -> ListTasks
POST   /tasks/{id}:cancel         -> CancelTask
POST   /tasks/{id}:subscribe      -> SubscribeToTask（SSE 响应）
POST   /tasks/{id}/pushConfigs    -> CreateTaskPushNotificationConfig
GET    /tasks/{id}/pushConfigs     -> ListTaskPushNotificationConfigs
DELETE /tasks/{id}/pushConfigs/{cfgId} -> DeleteTaskPushNotificationConfig
```

`:` 是 Google-AIP 用来表示「自定义动作」的约定，区别于普通 CRUD。

### 10.2 gRPC 绑定示例（伪 proto）

```proto
service A2A {
  rpc SendMessage(SendMessageRequest)       returns (SendMessageResponse);
  rpc SendStreamingMessage(SendMessageRequest) returns (stream SendStreamingMessageResponse);
  rpc GetTask(GetTaskRequest)               returns (Task);
  rpc ListTasks(ListTasksRequest)           returns (ListTasksResponse);
  rpc CancelTask(CancelTaskRequest)         returns (Task);
  rpc SubscribeToTask(SubscribeToTaskRequest) returns (stream SendStreamingMessageResponse);
}
```

gRPC 绑定的优势是原生 `stream` 关键字，不需要 SSE 这一层。

::: tip 选哪个绑定
- 给 Web / 跨语言客户端用：**JSON-RPC over HTTP**（最通用）。
- 给内部强类型微服务用：**gRPC**（性能最好、契约最严）。
- 给已有 REST 网关 / API Gateway / Serverless 用：**HTTP/REST 绑定**。
- 特殊环境（消息队列、IoT）：**自定义绑定**，但必须保留方法语义。
:::

## 11. 错误处理

### 11.1 JSON-RPC 错误

用于**协议层**错误（请求都没进到业务逻辑）：

- 方法不存在（`-32601`）。
- 参数不合法（`-32602`）。
- JSON 解析失败（`-32700`）。
- 未认证。
- 无权限。

示例：

```json
{
  "jsonrpc": "2.0",
  "id": "req-004",
  "error": {
    "code": -32602,
    "message": "message.parts must not be empty"
  }
}
```

### 11.2 Task 业务失败

业务执行失败**不应**用 JSON-RPC 错误表达——因为请求本身是成功的。应体现在 Task 状态里：

```json
{
  "kind": "task",
  "id": "task-001",
  "status": {
    "state": "TASK_STATE_FAILED",
    "message": {
      "kind": "message",
      "messageId": "msg-failed-001",
      "role": "ROLE_AGENT",
      "parts": [
        { "text": "无法访问仓库：权限不足。" }
      ]
    }
  }
}
```

::: warning 别把业务失败当协议错误
新手常见错误：Agent 跑挂了，Client 直接 `error.code = -32603`（内部错误）。**正确做法**：HTTP 200 + JSON-RPC `result` 返回一个 `state: TASK_STATE_FAILED` 的 Task，错误细节放在 status.message 里。这样 Client 可以区分「我请求错了」和「Agent 干活了但没干成」。
:::

### 11.3 两种错误的判断流程

```text
收到响应
  |
  +-- 有 error 字段?  -> 协议层错误（请求没被接受）-> 改请求后重试
  |
  +-- 有 result 字段?
        |
        +-- result.kind == "task" && state == "TASK_STATE_FAILED"
        |                          -> 业务失败 -> 看错误信息，调整后重试
        |
        +-- 其他 -> 成功
```

## 12. 幂等性

Agent 协作中常会重试（网络抖动、超时、重连）。需要考虑：

- Client 超时后重发 `SendMessage`。
- 流式连接中断后重连。
- Push Notification 重试。

设计建议：

- **用 `messageId` 去重**——Server 收到已见过的 messageId 应返回之前的结果而不是再跑一遍。
- 对产生副作用的任务使用幂等 key（外部动作的请求 ID）。
- `CancelTask` 可重复调用——重复取消应返回当前状态而非报错。
- 任务创建和外部动作**分阶段提交**——先建 Task（已持久化），再触发外部副作用。

## 13. 超时与重试

Client 应设置：

- 连接超时（建立 TCP/TLS 的时间上限）。
- 请求超时（同步方法如 `SendMessage` 的等待上限）。
- 流式空闲超时（`SendStreamingMessage` / `SubscribeToTask` 两个事件之间的最大间隔）。
- 最大任务等待时间（即使有流式/推送，也别无限等）。

Server 应设置：

- 单任务最长运行时间（避免僵尸任务）。
- 外部 API 超时（Agent 调用工具的超时）。
- 队列等待超时（Task 从 `TASK_STATE_SUBMITTED` 到 `TASK_STATE_WORKING` 的最大延迟）。
- Artifact 大小限制（防止单个结果撑爆存储）。

::: tip 重试要用抖动
所有重试必须带**指数退避 + 抖动（jitter）**。Agent 任务往往集中触发（如批量审查 PR），同步重试会把下游打爆。Push Notification 重试尤其要注意——Server 重试风暴会把 Client 回调打挂。
:::

## 本章检查点

读完本章，你应该能：

- 说出 v1.0 全部 9 个核心方法及其用途，并指出 `ListTasks` / `SubscribeToTask` 是 v1.0 新增。
- 区分 `SendStreamingMessage`（发新消息+流）和 `SubscribeToTask`（订阅已有任务）。
- 解释 JSON-RPC 错误和 Task 业务失败（`TASK_STATE_FAILED`）的区别，以及为什么后者要走 `result` 而不是 `error`。
- 列出 v1.0 支持的四种传输绑定（JSON-RPC / gRPC / REST / 自定义）及各自的流式机制。
- 设计幂等和重试策略，知道为什么 `messageId` 去重是关键。

## 动手实验

1. **方法名迁移**：找一个网上的 v0.x A2A 示例（或本仓库历史 commit），把其中所有 `message/send` / `message/stream` / `tasks/get` / `tasks/cancel` / `tasks/pushNotification/set` 用本节的对照表逐个改成 v1.0 名字，并解释每处改动的理由。
2. **流式 vs 订阅**：对同一个长任务，分别用 `SendStreamingMessage`（直接开流）和 `SendMessage` + `SubscribeToTask`（先建任务再订阅）两种方式拿进度，对比事件流是否一致，并思考什么场景下选哪种。
3. **错误类型演练**：故意构造两种失败——(a) 发一个 `parts` 为空的请求触发 JSON-RPC `-32602`；(b) 让 Agent 处理一个不存在的仓库触发 `TASK_STATE_FAILED`。观察两者在响应结构上的差异（`error` vs `result`）。
4. **REST 绑定手写**：不用任何 SDK，纯 curl 调用一个 REST 绑定的 A2A Server，完成 `POST /message:send`、`GET /tasks/{id}`、`POST /tasks/{id}:cancel` 三次调用，并把 JSON-RPC 绑定下的等价请求也写出来对照。

## 接下来

- [安全架构](./04-security-architecture.md) —— Push Notification 回调如何鉴权、Artifact 数据最小化、Prompt Injection 防护
- [实现指南](./05-implementation-guide.md) —— 用具体代码实现这些方法
- [消息与任务模型](./02-message-task-model.md) —— 本章方法操作的「数据对象」详解
