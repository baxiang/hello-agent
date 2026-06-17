# 消息与任务模型

> **协议详解篇第三节。** [Agent Card](./01-agent-discovery-card.md) 让 Client 发现 Agent，但真正干活靠的是 Message、Task、Artifact 这三个对象。本节深入 A2A 的**数据模型**——它和 OpenAI API 的 messages 数组很不一样。
>
> **本节你将学到**：六大对象（Context/Message/Part/Task/TaskStatus/Artifact）的关系、Message 与 Part 的 v1.0 结构、Task 状态机完整枚举、`TASK_STATE_INPUT_REQUIRED` 和 `TASK_STATE_AUTH_REQUIRED` 的多轮协作、Artifact 设计原则。
>
> **一句话比喻**：把一次 A2A 协作想象成**外包一个项目**——Message 是你们互通的邮件、Part 是邮件里的附件、Task 是一张有进度可追踪的工作单、Artifact 是最终交付的成果物。

A2A 的核心不是「调用一个接口拿结果」，而是支持 Agent 之间**围绕任务协作**。它用 Message 表达交流，用 Task 表达可追踪工作，用 Artifact 表达结果。

::: tip 和 OpenAI API 的关键区别
OpenAI API 只有 `messages` 数组（无状态、每次全发）。A2A 多了 **Task** 这个一等公民——长任务可以追踪状态、可中断补充输入、可异步执行。Message 是「瞬时交流」，Task 是「持久工作」。
:::

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

- **Context** 把一组相关交互串起来
- **Message** 是一次交流
- **Part** 是消息里的内容块
- **Task** 是可追踪工作单元
- **TaskStatus** 表达任务当前状态
- **Artifact** 是任务结果

## 2. Message

Message 是 A2A 中的基本交流单位。

示例（**v1.0 正确写法**）：

```json
{
  "kind": "message",
  "messageId": "msg-001",
  "role": "ROLE_USER",
  "contextId": "ctx-001",
  "parts": [
    { "text": "请分析这个故障单的根因" }
  ]
}
```

关键字段：

| 字段 | 含义 |
| --- | --- |
| `kind` | 对象类型，通常为 `message` |
| `messageId` | 消息 ID（必填） |
| `role` | ⭐ **`ROLE_USER`**（来自 Client）或 **`ROLE_AGENT`**（来自 Server） |
| `contextId` | 多轮上下文 ID |
| `taskId` | 关联任务 ID |
| `parts` | 内容块数组（必填） |
| `metadata` | 扩展信息 |

::: warning v0.x → v1.0 变化
- `role` 值从 `user`/`agent` 改为带前缀的 **`ROLE_USER`** / **`ROLE_AGENT`**
:::

## 3. Part（v1.0 单一对象）

Part 表示内容块。**v1.0 用单一 `Part` 对象**，每个 Part 必须含 `text` / `raw` / `url` / `data` 四者之一（用字段名本身区分类型，不再用 `kind` discriminator）。

### 3.1 Text Part

```json
{ "text": "请审查这个补丁。" }
```

### 3.2 Data Part

```json
{
  "data": {
    "repo": "example/api",
    "pullRequest": 42,
    "focus": ["security", "correctness"]
  }
}
```

### 3.3 文件 Part：url

文件 URL 引用：

```json
{
  "url": "https://storage.example.com/logs/error.log"
}
```

### 3.4 文件 Part：raw

原始字节（base64 编码）：

```json
{
  "raw": {
    "name": "error.log",
    "mimeType": "text/plain",
    "data": "<base64 编码内容>"
  }
}
```

设计建议：

- 大文件优先用 `url`，不要内联 `raw`
- URL 应有访问控制和过期时间
- MIME type 要准确
- 不信任远程文件名

::: warning v0.x → v1.0 关键变化
旧版用 `{"kind": "text", "text": "..."}` / `{"kind": "file", "file": {...}}` / `{"kind": "data", "data": {...}}` 区分。**v1.0 移除了 `kind` discriminator**，直接看 Part 里含哪个字段：含 `text` 就是文本 Part，含 `data` 就是数据 Part，含 `url`/`raw` 就是文件 Part。
:::

## 4. Task

Task 是 A2A 支持长任务和异步协作的核心。

示例：

```json
{
  "kind": "task",
  "id": "task-001",
  "contextId": "ctx-001",
  "status": {
    "state": "TASK_STATE_WORKING",
    "message": {
      "kind": "message",
      "messageId": "msg-status-001",
      "role": "ROLE_AGENT",
      "parts": [
        { "text": "正在分析日志和变更记录。" }
      ]
    }
  },
  "artifacts": []
}
```

## 5. Task 状态机（v1.0 完整枚举）

| 状态 | 含义 | 是否终态 | Client 应做什么 |
|------|------|---------|----------------|
| `TASK_STATE_UNSPECIFIED` | 未指定 | — | — |
| `TASK_STATE_SUBMITTED` | 已提交 | — | 等待或查询 |
| `TASK_STATE_WORKING` | 正在处理 | — | 展示进度 |
| `TASK_STATE_INPUT_REQUIRED` | 需要补充输入（可中断） | — | 向用户收集信息并继续发送 |
| `TASK_STATE_AUTH_REQUIRED` | 需要认证授权（可中断） | — | 引导用户完成授权 |
| `TASK_STATE_COMPLETED` | ✅ 完成 | **终态** | 读取 artifacts |
| `TASK_STATE_FAILED` | ❌ 执行失败 | **终态** | 展示错误，可调整后重试 |
| `TASK_STATE_CANCELED` | 已取消（单 L） | **终态** | 停止等待 |
| `TASK_STATE_REJECTED` | 被拒绝执行 | **终态** | 展示原因，不重试同请求 |

典型状态流：

```text
TASK_STATE_SUBMITTED -> TASK_STATE_WORKING -> TASK_STATE_COMPLETED
TASK_STATE_SUBMITTED -> TASK_STATE_WORKING -> TASK_STATE_INPUT_REQUIRED -> TASK_STATE_WORKING -> TASK_STATE_COMPLETED
TASK_STATE_SUBMITTED -> TASK_STATE_AUTH_REQUIRED -> TASK_STATE_WORKING -> TASK_STATE_COMPLETED
TASK_STATE_SUBMITTED -> TASK_STATE_REJECTED
TASK_STATE_SUBMITTED -> TASK_STATE_WORKING -> TASK_STATE_FAILED
TASK_STATE_SUBMITTED -> TASK_STATE_WORKING -> TASK_STATE_CANCELED
```

::: tip 四个终态
**completed / failed / canceled / rejected** 是终态——进入这四个状态后任务不能再发消息。`input-required` 和 `auth-required` 是「可中断」状态，Client 补充输入或完成认证后任务可继续。
:::

## 6. `TASK_STATE_INPUT_REQUIRED`：多轮协作的关键

`TASK_STATE_INPUT_REQUIRED` 是 A2A 多轮协作的关键。

示例场景：

- 用户没有说明 repo
- 需要选择环境：dev/staging/prod
- 需要上传日志
- 需要确认分析范围

状态消息示例：

```json
{
  "state": "TASK_STATE_INPUT_REQUIRED",
  "message": {
    "kind": "message",
    "messageId": "msg-ask-001",
    "role": "ROLE_AGENT",
    "parts": [
      { "text": "请提供要分析的时间范围和服务名称。" }
    ]
  }
}
```

Client 后续应带上同一个 `contextId` 或 `taskId` 继续发送用户补充信息。

## 7. `TASK_STATE_AUTH_REQUIRED`：需要认证授权

`TASK_STATE_AUTH_REQUIRED` 表示任务需要认证或授权。

示例：

```json
{
  "state": "TASK_STATE_AUTH_REQUIRED",
  "message": {
    "kind": "message",
    "messageId": "msg-auth-001",
    "role": "ROLE_AGENT",
    "parts": [
      { "text": "需要授权访问 GitHub 仓库 example/api。" }
    ]
  }
}
```

Client 应：

- 展示授权目标
- 使用安全流程获取授权（OAuth 等）
- **不把密码或 token 当普通 Message 发送**

## 8. Artifact

Artifact 是 Agent 的产物。它可以是最终结果，也可以是阶段性结果。

示例：

```json
{
  "artifactId": "art-001",
  "name": "incident-analysis-report",
  "description": "Root cause analysis report",
  "parts": [
    { "text": "根因可能是数据库连接池耗尽。" },
    {
      "data": {
        "confidence": 0.78,
        "evidence": ["db_pool_timeout", "deploy_2026_05_27"]
      }
    }
  ]
}
```

Artifact 设计原则：

- **最终可消费结果**放 Artifact
- **进度说明**放 TaskStatus message
- 多个结果可以拆多个 Artifact
- 结构化结果用 Data Part，方便下游 Agent 继续处理

## 9. Context

Context 用于把多条 Message 和 Task 关联起来。

使用场景：

- 同一个用户问题拆成多轮
- 一个 Task 需要补充输入
- Client 调用多个 Agent 后汇总

注意：

- Context **不等于完整聊天历史**
- 不要把所有历史都发给 A2A Server
- Context ID 是关联标识，**不代表权限**

## 10. 本章检查点

读完本章，你应该能：

- 画出 Message、Part、Task、Artifact 的关系
- 判断什么时候返回 Message，什么时候返回 Task
- 解释 `TASK_STATE_INPUT_REQUIRED` 和 `TASK_STATE_AUTH_REQUIRED` 的处理方式
- 把最终结果建模为 Artifact，而不是散落在状态消息中
- 设计一个支持长任务和多轮补充输入的状态流

## 动手实验

1. **状态机演练**：用纸笔或工具画一个完整的 Task 状态机图，标出 9 个状态、4 个终态、可中断状态，并画出 3 条典型流转路径（正常完成、需补充输入、需认证）。
2. **Part 类型对照**：写 4 种 Part（text / data / url 文件 / raw 文件）的最小示例，对比 v1.0 和 v0.x 的写法差异。
3. **input-required 场景**：构造一个会触发 `TASK_STATE_INPUT_REQUIRED` 的请求（如「分析故障」但故意不给时间范围），观察返回，然后正确补充输入让任务继续。
4. **Artifact 设计**：为「代码审查 Agent」设计一个 Artifact 结构——文本部分放人读的总结，data 部分放机器可处理的问题清单（含 severity/file/line）。

## 接下来

- [协议方法](./03-protocol-methods.md) —— Message 和 Task 怎么通过 JSON-RPC 方法发送、查询、取消
- [安全架构](./04-security-architecture.md) —— Context 和 Artifact 的数据最小化、Prompt Injection 防护
- [协议总览](./00-a2a-from-zero.md) —— 这些对象在完整流程里的位置
