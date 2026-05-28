# 03 - A2A 协议方法、流式事件与错误处理

A2A 可以有不同传输绑定，常见是 HTTP + JSON-RPC 2.0，并用 SSE 支持流式事件。本章关注调用层面的协议方法和交互模式。

## 1. JSON-RPC 基础

请求：

```json
{
  "jsonrpc": "2.0",
  "id": "req-001",
  "method": "message/send",
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

## 2. message/send

`message/send` 用于发送一条消息并等待结果。

请求：

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
          "text": "请审查 PR 42 的安全风险"
        }
      ]
    }
  }
}
```

可能返回 Message：

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
        "text": "这个任务可以处理，请提供仓库地址。"
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
      "state": "submitted"
    }
  }
}
```

选择建议：

- 简单问答：返回 Message。
- 需要几秒以上、进度、补充输入或异步执行：返回 Task。

## 3. message/stream

`message/stream` 用于发送消息并接收流式事件。适合长任务和实时进度展示。

请求体与 `message/send` 类似，但响应是事件流。

典型事件序列：

```text
Task created
Task status: working
Artifact update: partial report
Task status: input-required
Task status: working
Artifact update: final report
Task status: completed
```

流式模式的价值：

- 用户不用等待最后结果。
- Client 可以展示进度。
- Server 可以分批返回产物。
- 长任务体验更好。

实现注意：

- 事件要能被 Client 增量处理。
- 断线后要能用 `tasks/get` 查询最终状态。
- 不要只依赖流式连接保存唯一状态。

## 4. tasks/get

`tasks/get` 用于查询 Task 当前状态。

请求：

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
      "state": "completed"
    },
    "artifacts": [
      {
        "artifactId": "art-001",
        "name": "review",
        "parts": [
          {
            "kind": "text",
            "text": "发现 3 个问题。"
          }
        ]
      }
    ]
  }
}
```

## 5. tasks/cancel

`tasks/cancel` 请求取消任务。

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

注意：

- 取消是请求，不一定立即成功。
- 如果任务已完成，Server 应返回当前最终状态或合理错误。
- 对外部系统动作要设计补偿或不可取消说明。

## 6. Push Notification

Push Notification 适合超长任务。Client 提供回调配置，Server 在状态变化时通知。

适用：

- 任务运行几分钟到几小时。
- Client 不想保持流式连接。
- 移动端或后台任务。

安全要求：

- 回调 URL 需要验证。
- 通知应有签名或认证。
- 不要把敏感 Artifact 全量推送到不可信 URL。
- 重试要有退避和上限。

## 7. 错误处理

### 7.1 JSON-RPC 错误

用于协议层错误：

- 方法不存在。
- 参数不合法。
- JSON 解析失败。
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

### 7.2 Task 失败

业务执行失败应体现在 Task 状态：

```json
{
  "kind": "task",
  "id": "task-001",
  "status": {
    "state": "failed",
    "message": {
      "kind": "message",
      "messageId": "msg-failed-001",
      "role": "agent",
      "parts": [
        {
          "kind": "text",
          "text": "无法访问仓库：权限不足。"
        }
      ]
    }
  }
}
```

## 8. 幂等性

Agent 协作中常会重试。需要考虑：

- Client 超时后重发 `message/send`。
- 流式连接中断后重连。
- Push Notification 重试。

设计建议：

- 使用 `messageId` 去重。
- 对产生副作用的任务使用幂等 key。
- `tasks/cancel` 可重复调用。
- 任务创建和外部动作分阶段提交。

## 9. 超时与重试

Client 应设置：

- 连接超时。
- 请求超时。
- 流式空闲超时。
- 最大任务等待时间。

Server 应设置：

- 单任务最长运行时间。
- 外部 API 超时。
- 队列等待超时。
- Artifact 大小限制。

## 10. 本章检查点

读完本章，你应该能：

- 判断 `message/send` 和 `message/stream` 如何选择。
- 用 `tasks/get` 补偿流式连接中断。
- 区分 JSON-RPC 错误和 Task 业务失败。
- 解释 Push Notification 的适用场景和安全要求。
- 为 A2A 调用设计幂等和重试策略。

