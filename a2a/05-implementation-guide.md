# 实现指南

> **协议详解篇第六节（最后一节）。** [安全架构](./04-security-architecture.md) 把协议约束讲清楚了，但要落到真实代码，还有一堆工程决策要做：Agent 边界怎么切、Task store 怎么选、streaming 断线怎么办、Client 何时该委派任务。本节把前 5 节的概念组装成一条可执行的实现路径。
>
> **本节你将学到**：从 0 设计 A2A Server 的三段渐进路径（最小 Server → 支持 Task → 支持 streaming）、Client Agent 的委派决策流程、A2A + MCP 的组合架构、覆盖 5 个维度的测试矩阵和发布清单。
>
> **一句话比喻**：前 5 节是**建筑图纸**，本节是**施工指南**——从打地基（最小 Server）到封顶（streaming + 多 Agent 协作），每一步都给你一个可验收的中间态。

实现 A2A Agent 不是把协议规范翻译成代码，而是做一连串工程权衡。本章面向 **A2A Server**（别名 Remote Agent，即接收请求、执行任务的一方）的开发者，以及写 **Client Agent**（发起委派的一方）的开发者，按「先跑通、再加 Task、再上 streaming」的顺序展开，每一段都对应一个可独立验收的里程碑。

## 1. 先定义 Agent 边界

写第一行代码前，先用文字把 Agent 的边界讲清楚。这一步决定了 Agent Card 的字段、Skill 的粒度、安全模型和 Task 设计。

需要回答的 10 个问题：

1. 这个 Agent 是专家 Agent 还是通用 Agent？
2. 它提供哪些 Skill？
3. 输入模态是什么？
4. 输出模态是什么？
5. 哪些任务短响应，哪些任务长任务？
6. 是否需要 streaming？
7. 是否需要 push notification？
8. 需要什么认证和授权？
9. 是否会调用 MCP 工具或内部系统？
10. 哪些结果需要人类确认后才能执行下一步？

以「故障分析 Agent」为例，边界定义写成一段可直接对应 Agent Card 的描述：

```text
Agent: Incident Analysis Agent
职责: 分析服务故障，输出根因和处置建议
Skills:
  - analyze_incident
  - summarize_logs
输入:
  - text/plain
  - application/json
  - text/plain log file URI
输出:
  - text/markdown
  - application/json
任务:
  - 短日志摘要可直接 Message
  - 完整事故分析返回 Task
安全:
  - Bearer token
  - 只访问用户授权服务的日志
```

::: tip 边界即合约
这份边界定义就是 Agent Card 的草稿，也是 Client Agent 决策「是否委派」的依据。边界模糊（比如「什么都能分析」）会让 Client 无法选择，也会让 Skill 描述失真。
:::

## 2. 最小 Server

第一版只做能跑通一次问答的最小集：

- 暴露 `/.well-known/agent-card.json`
- 一个 JSON-RPC endpoint
- 实现 **`SendMessage`** 方法
- 对简单请求直接返回 Message
- 返回标准 JSON-RPC 错误响应

最小流程：

```text
Client GET /.well-known/agent-card.json
Client POST JSON-RPC: SendMessage
Server validates params
Server runs agent logic
Server returns Message
```

::: tip v1.0 命名提醒
本文用 v1.0 的 **PascalCase 方法名**：`SendMessage` / `SendStreamingMessage` / `GetTask` / `CancelTask` / `CreateTaskPushNotificationConfig` 等；Task 状态用带前缀的枚举，如 `TASK_STATE_WORKING` / `TASK_STATE_INPUT_REQUIRED`。如果你看到网上老资料写的是 `message/send` / `message/stream` / `tasks/get` / `tasks/cancel` / `input-required` 这种 snake-case 或短横线形式，那是 v0.x 旧规范，不要混用。
:::

这一版的目标是：Client 拿到 Agent Card、发一个 `SendMessage`、拿到一个 Message 回来。先不要做 Task、不要做 streaming。

## 3. 支持 Task

第二版加入 Task。当请求满足下列任一条件时，应返回 Task 而不是直接返回 Message：

- 任务耗时长（秒级以上）
- 需要进度反馈
- 需要补充输入（`TASK_STATE_INPUT_REQUIRED`）
- 需要认证授权（`TASK_STATE_AUTH_REQUIRED`）
- 可能异步执行

实现组件：

- **Task store**：保存 Task 状态和 Artifact
- **Task executor**：异步执行任务逻辑
- **Task status updater**：更新 `TASK_STATE_*` 状态
- **Artifact store**：保存任务产物
- **`GetTask`** 方法：按 ID 查询 Task
- **`CancelTask`** 方法：取消 Task

Task store 开发期可以先用内存，生产环境必须用数据库或持久化队列，否则进程重启会丢失正在执行的任务。

典型 Task 状态流（完整状态机见 [消息与任务模型](./02-message-task-model.md)）：

```text
TASK_STATE_SUBMITTED -> TASK_STATE_WORKING -> TASK_STATE_COMPLETED
TASK_STATE_SUBMITTED -> TASK_STATE_WORKING -> TASK_STATE_INPUT_REQUIRED -> TASK_STATE_WORKING -> TASK_STATE_COMPLETED
TASK_STATE_SUBMITTED -> TASK_STATE_WORKING -> TASK_STATE_FAILED
TASK_STATE_SUBMITTED -> TASK_STATE_WORKING -> TASK_STATE_CANCELED
```

## 4. 支持 streaming

第三版加入 **`SendStreamingMessage`**，用 SSE 或类似机制推送事件。

Server 需要在流上发送这几类事件：

- Task 创建
- 状态更新（如 `TASK_STATE_WORKING`）
- Artifact 增量更新
- 最终状态（`TASK_STATE_COMPLETED` / `TASK_STATE_FAILED` / `TASK_STATE_CANCELED`）
- 错误事件

设计要求：

- **状态必须落 Task store**——流只是事件通道，不是状态真相源
- **流断开不等于任务失败**——网络抖动不应让 Task 进入 `TASK_STATE_FAILED`
- **Client 可用 `GetTask` 恢复**——断线后凭 `taskId` 重新查询
- 每个事件要能独立解析（不依赖前后事件顺序）

## 5. Client Agent 设计

Client Agent 不是简单的 HTTP 客户端，它需要决策「这个请求要不要委派给远程 Agent」。

```text
User asks main agent
  |
Main agent decides whether remote skill is needed
  |
Load or refresh Agent Card
  |
Check security and modality
  |
Send SendMessage or SendStreamingMessage
  |
Track Task
  |
Handle TASK_STATE_INPUT_REQUIRED / TASK_STATE_AUTH_REQUIRED
  |
Consume Artifact
  |
Summarize result for user
```

Client 应避免的反模式：

- 把全部对话无脑转发给远程 Agent（违反数据最小化，见 [安全架构](./04-security-architecture.md)）
- 选择与请求不匹配的 Skill
- 忽略 Agent Card 声明的安全要求
- 把远程 Agent 的输出直接拼接成系统指令（Prompt Injection 风险）
- 在 `TASK_STATE_INPUT_REQUIRED` 时直接放弃，而不是向用户收集信息

## 6. A2A 与 MCP 组合实现

A2A 和 MCP 不是替代关系，而是不同层：A2A 解决 Agent 之间委派任务，MCP 解决 Agent 调用外部工具和数据源。

常见组合架构：

```text
Main Agent
  |
  | A2A
  v
Specialist Agent
  |
  | MCP
  +-- GitHub MCP Server
  +-- Filesystem MCP Server
  +-- Database MCP Server
```

设计原则：

- **A2A 用于 Agent 之间委派任务**——Main Agent 把「审查 PR」这个完整工作委派给 Code Review Agent
- **MCP 用于 Specialist Agent 调外部工具和上下文**——Code Review Agent 内部用 MCP 拉 diff、读文件
- **不要把低层数据库查询暴露成 A2A Skill**——A2A Skill 应是「能交付结果的工作单元」，不是「裸接口」
- **不要把完整 Agent 协作流程塞成一个 MCP Tool**——MCP Tool 是无状态的原子操作，不是 Agent

::: warning 边界判断
简单记法：**A2A 是「外包项目」，MCP 是「调用工具」**。如果对方需要理解任务、做规划、产出结果，用 A2A；如果只是「读个文件 / 查个数据库 / 调个 API」，用 MCP。
:::

## 7. 测试矩阵

发布前至少覆盖 5 个维度。

**Agent Card 测试**：

- `/.well-known/agent-card.json` 路径可访问
- 必填字段存在
- Skill 描述准确
- 输入输出模态正确
- 安全声明正确

**协议测试**：

- `SendMessage` 返回 Message
- 复杂请求返回 Task
- `GetTask` 可查询状态
- `CancelTask` 可取消
- 非法参数返回 JSON-RPC error
- 未认证请求被拒绝

**任务状态测试**：

- `TASK_STATE_SUBMITTED` → `TASK_STATE_WORKING` → `TASK_STATE_COMPLETED`
- `TASK_STATE_INPUT_REQUIRED` 后补充输入可继续
- `TASK_STATE_AUTH_REQUIRED` 不泄露 token
- `TASK_STATE_FAILED` 包含可读失败原因
- `TASK_STATE_CANCELED` 后不会继续产生副作用

**流式测试**：

- `SendStreamingMessage` 返回完整事件序列
- 中途断线后 `GetTask` 可恢复
- Artifact 增量更新可被 Client 正确合并

**安全测试**：

- 无权用户不能调用受限 Skill
- 不能通过 Task ID 读取其他用户的结果
- Push Notification 不回调非 allowlist URL
- 输出中的恶意指令不会自动触发下游动作

## 8. 发布清单

正式发布 A2A Server 前，逐项检查：

- Agent Card 可被机器读取且字段完整
- Skill 粒度合适（不太粗也不太细）
- 认证方式明确声明且强制执行
- 输入输出模态明确
- 长任务有持久化的 Task store
- Artifact 有大小限制和保留策略
- 支持超时和 `CancelTask`
- 有审计日志
- 错误信息清楚但不泄露内部细节（堆栈、SQL、内部 ID）
- 有版本兼容策略（Agent Card 的 `version` 字段）

## 9. 示例：代码审查 Agent

把前面的概念综合成一个具体例子。

**Agent Card 摘要**：

```text
name: Code Review Agent
skills:
  - review_pull_request
input:
  - text/plain
  - application/json
output:
  - text/markdown
  - application/json
capabilities:
  - streaming
  - pushNotifications
security:
  - bearer
```

**Task 状态流**：

```text
TASK_STATE_SUBMITTED
TASK_STATE_WORKING: fetching diff
TASK_STATE_WORKING: analyzing security
TASK_STATE_WORKING: analyzing tests
artifact: partial findings
TASK_STATE_COMPLETED: final review report
```

**最终 Artifact（v1.0 Part 结构，无 `kind` discriminator）**：

```json
{
  "artifactId": "review-001",
  "name": "pull-request-review",
  "parts": [
    {
      "text": "## Summary\nFound 2 high priority issues..."
    },
    {
      "data": {
        "findings": [
          {
            "severity": "high",
            "file": "src/auth.ts",
            "line": 42,
            "title": "Token validation bypass"
          }
        ]
      }
    }
  ]
}
```

::: tip 为什么 Artifact 用两种 Part
文本 Part 给**人读**（开发者直接看总结），Data Part 给**机器读**（IDE、CI、下游 Agent 程序化处理 findings 列表）。这是 Artifact 设计的常见模式——同一份结果，按消费者区分表达。
:::

## 10. 本章检查点

读完本章，你应该能：

- 用 10 个问题界定一个 Agent 的边界，并对应到 Agent Card 字段
- 写出一个支持 `SendMessage` 的最小 A2A Server
- 说明什么时候返回 Message、什么时候返回 Task
- 解释 streaming 场景下「流断开 ≠ 任务失败」的实现要点
- 描述 Client Agent 委派任务的决策流程
- 区分 A2A 和 MCP 的适用场景，避免层级错用
- 按测试矩阵和发布清单验收自己的实现

## 动手实验

1. **最小 Server 跑通**：写一个静态 `/.well-known/agent-card.json`，实现 `SendMessage` 固定返回文本 Message，加一个非法参数的 JSON-RPC 错误响应。用 curl 完成一次完整调用。
2. **Task + 状态机**：给 Server 加 Task 支持，实现 `GetTask` 和 `CancelTask`，构造一个会进入 `TASK_STATE_INPUT_REQUIRED` 的请求（如「审查 PR」但故意不给 repo），观察返回，然后正确补充输入让任务走到 `TASK_STATE_COMPLETED`。
3. **streaming + 断线恢复**：实现 `SendStreamingMessage`，在客户端读到一半时主动断开连接，然后用 `GetTask` 凭 `taskId` 恢复并拿到最终 Artifact，验证「流断开 ≠ 任务失败」。
4. **A2A + MCP 组合**：让你的 Specialist Agent 在执行 Task 时内部调用一个 MCP Tool（如读文件或查 Git），画出 Main Agent → Specialist Agent → MCP Server 的完整调用链，确认 A2A 边界没有泄漏 MCP 细节给 Client。

## 接下来

这是「协议详解」系列的最后一节。建议：

- 回到 [协议总览](./00-a2a-from-zero.md) —— 用学到的实现视角重新看一遍完整流程图
- 重读 [消息与任务模型](./02-message-task-model.md) 和 [协议方法](./03-protocol-methods.md) —— 实现过一遍后再看规范会有新理解
- 看 [安全架构](./04-security-architecture.md) —— 把发布清单里的「审计日志」「数据最小化」逐项落到代码
- 动手完成上面的 [动手实验](#动手实验)，把协议变成肌肉记忆
