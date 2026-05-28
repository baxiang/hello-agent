# 02 - A2A 消息、任务与产物模型

A2A 的核心不是“调用一个接口拿结果”，而是支持 Agent 之间围绕任务协作。它用 Message 表达交流，用 Task 表达可追踪工作，用 Artifact 表达结果。

## 1. 对象关系

```text
Context
  |
  +-- Message
  |     |
  |     +-- Part
  |
  +-- Task
        |
        +-- TaskStatus
        +-- Artifact
              |
              +-- Part
```

理解这张图：

- Context 把一组相关交互串起来。
- Message 是一次交流。
- Part 是消息里的内容块。
- Task 是可追踪工作单元。
- TaskStatus 表达任务当前状态。
- Artifact 是任务结果。

## 2. Message

Message 是 A2A 中的基本交流单位。

示例：

```json
{
  "kind": "message",
  "messageId": "msg-001",
  "role": "user",
  "contextId": "ctx-001",
  "parts": [
    {
      "kind": "text",
      "text": "请分析这个故障单的根因"
    }
  ]
}
```

关键字段：

| 字段 | 含义 |
| --- | --- |
| `kind` | 对象类型，通常为 `message` |
| `messageId` | 消息 ID |
| `role` | `user` 或 `agent` |
| `contextId` | 多轮上下文 ID |
| `taskId` | 关联任务 ID |
| `parts` | 内容块 |
| `metadata` | 扩展信息 |

## 3. Part

Part 表示内容块。A2A 用 Part 支持多模态和结构化数据。

### 3.1 Text Part

```json
{
  "kind": "text",
  "text": "请审查这个补丁。"
}
```

### 3.2 Data Part

```json
{
  "kind": "data",
  "data": {
    "repo": "example/api",
    "pullRequest": 42,
    "focus": ["security", "correctness"]
  }
}
```

### 3.3 File Part

文件可以用 URI 或字节内容表达。

```json
{
  "kind": "file",
  "file": {
    "name": "error.log",
    "mimeType": "text/plain",
    "uri": "https://storage.example.com/logs/error.log"
  }
}
```

设计建议：

- 大文件优先用 URI，不要内联。
- URI 应有访问控制和过期时间。
- MIME type 要准确。
- 不信任远程文件名。

## 4. Task

Task 是 A2A 支持长任务和异步协作的核心。

示例：

```json
{
  "kind": "task",
  "id": "task-001",
  "contextId": "ctx-001",
  "status": {
    "state": "working",
    "message": {
      "kind": "message",
      "messageId": "msg-status-001",
      "role": "agent",
      "parts": [
        {
          "kind": "text",
          "text": "正在分析日志和变更记录。"
        }
      ]
    }
  },
  "artifacts": []
}
```

## 5. Task 状态机

常见状态：

| 状态 | 含义 | Client 应做什么 |
| --- | --- | --- |
| `submitted` | 已提交 | 等待或查询 |
| `working` | 正在处理 | 展示进度 |
| `input-required` | 需要补充输入 | 向用户收集信息并继续发送 |
| `auth-required` | 需要认证授权 | 引导用户完成授权 |
| `completed` | 完成 | 读取 artifacts |
| `canceled` | 已取消 | 停止等待 |
| `rejected` | 拒绝执行 | 展示原因，不重试同请求 |
| `failed` | 执行失败 | 展示错误，可调整后重试 |
| `unknown` | 状态未知 | 刷新或降级处理 |

典型状态流：

```text
submitted -> working -> completed
submitted -> working -> input-required -> working -> completed
submitted -> auth-required -> working -> completed
submitted -> rejected
submitted -> working -> failed
submitted -> working -> canceled
```

## 6. input-required

`input-required` 是 A2A 多轮协作的关键。

示例场景：

- 用户没有说明 repo。
- 需要选择环境：dev/staging/prod。
- 需要上传日志。
- 需要确认分析范围。

状态消息示例：

```json
{
  "state": "input-required",
  "message": {
    "kind": "message",
    "messageId": "msg-ask-001",
    "role": "agent",
    "parts": [
      {
        "kind": "text",
        "text": "请提供要分析的时间范围和服务名称。"
      }
    ]
  }
}
```

Client 后续应带上同一个 `contextId` 或 `taskId` 继续发送用户补充信息。

## 7. auth-required

`auth-required` 表示任务需要认证或授权。

示例：

```json
{
  "state": "auth-required",
  "message": {
    "kind": "message",
    "messageId": "msg-auth-001",
    "role": "agent",
    "parts": [
      {
        "kind": "text",
        "text": "需要授权访问 GitHub 仓库 example/api。"
      }
    ]
  }
}
```

Client 应：

- 展示授权目标。
- 使用安全流程获取授权。
- 不把密码或 token 当普通 Message 发送。

## 8. Artifact

Artifact 是 Agent 的产物。它可以是最终结果，也可以是阶段性结果。

示例：

```json
{
  "artifactId": "art-001",
  "name": "incident-analysis-report",
  "description": "Root cause analysis report",
  "parts": [
    {
      "kind": "text",
      "text": "根因可能是数据库连接池耗尽。"
    },
    {
      "kind": "data",
      "data": {
        "confidence": 0.78,
        "evidence": ["db_pool_timeout", "deploy_2026_05_27"]
      }
    }
  ]
}
```

Artifact 设计原则：

- 最终可消费结果放 Artifact。
- 进度说明放 TaskStatus message。
- 多个结果可以拆多个 Artifact。
- 结构化结果用 Data Part，方便下游 Agent 继续处理。

## 9. Context

Context 用于把多条 Message 和 Task 关联起来。

使用场景：

- 同一个用户问题拆成多轮。
- 一个 Task 需要补充输入。
- Client 调用多个 Agent 后汇总。

注意：

- Context 不等于完整聊天历史。
- 不要把所有历史都发给 Remote Agent。
- Context ID 是关联标识，不代表权限。

## 10. 本章检查点

读完本章，你应该能：

- 画出 Message、Part、Task、Artifact 的关系。
- 判断什么时候返回 Message，什么时候返回 Task。
- 解释 `input-required` 和 `auth-required` 的处理方式。
- 把最终结果建模为 Artifact，而不是散落在状态消息中。
- 设计一个支持长任务和多轮补充输入的状态流。

