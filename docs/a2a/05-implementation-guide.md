# 05 - A2A 实现指南：从 0 设计 Agent Server 与 Client

这一章把协议概念落到工程实现。目标是你能设计一个可用、可测、可维护的 A2A Remote Agent，并写一个 Client Agent 调用它。

## 1. 先定义 Agent 边界

实现前先写清楚：

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

示例：

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

## 2. 最小 Server

第一版只做：

- `/.well-known/agent-card.json`
- JSON-RPC endpoint
- `message/send`
- 直接返回 Message
- 标准错误响应

最小流程：

```text
Client GET Agent Card
Client POST message/send
Server validates params
Server runs agent logic
Server returns Message
```

## 3. 支持 Task

第二版加入 Task。

适用场景：

- 任务耗时长。
- 需要进度。
- 需要补充输入。
- 需要认证。
- 可能异步执行。

实现组件：

- Task store。
- Task executor。
- Task status updater。
- Artifact store。
- `tasks/get`。
- `tasks/cancel`。

Task store 可以先用内存，生产环境用数据库或队列。

## 4. 支持 streaming

第三版加入 `message/stream`。

Server 需要能发送事件：

- Task 创建。
- 状态更新。
- Artifact 更新。
- 最终状态。
- 错误事件。

设计要求：

- 状态仍要落 Task store。
- 流断开不等于任务失败。
- Client 可用 `tasks/get` 恢复。
- 每个事件要能独立解析。

## 5. Client Agent 设计

Client Agent 不是简单 HTTP 客户端。它需要决策是否委派任务。

流程：

```text
User asks main agent
  |
Main agent decides whether remote skill is needed
  |
Load or refresh Agent Card
  |
Check security and modality
  |
Send message/send or message/stream
  |
Track Task
  |
Handle input-required/auth-required
  |
Consume Artifact
  |
Summarize result for user
```

Client 应避免：

- 把全部对话无脑转发。
- 选择不匹配的 Skill。
- 忽略 Agent Card 的安全要求。
- 把远程输出直接作为系统指令。

## 6. A2A 与 MCP 组合实现

常见架构：

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

- A2A 用于 Agent 之间委派任务。
- MCP 用于 Specialist Agent 调外部工具和上下文。
- 不要把低层数据库查询暴露成 A2A Skill。
- 不要把完整 Agent 协作流程塞成一个 MCP Tool。

## 7. 测试矩阵

Agent Card 测试：

- well-known 路径可访问。
- 必填字段存在。
- Skill 描述准确。
- 输入输出模态正确。
- 安全声明正确。

协议测试：

- `message/send` 返回 Message。
- 复杂请求返回 Task。
- `tasks/get` 查询状态。
- `tasks/cancel` 可取消。
- 非法参数返回 JSON-RPC error。
- 未认证请求被拒绝。

任务测试：

- submitted -> working -> completed。
- input-required 后可继续。
- auth-required 不泄露 token。
- failed 状态包含可读失败原因。
- canceled 状态不会继续产生副作用。

流式测试：

- `message/stream` 返回事件序列。
- 中途断线后 `tasks/get` 可恢复。
- Artifact 增量更新可被 Client 处理。

安全测试：

- 无权用户不能调用受限 Skill。
- 不能通过 Task ID 读取其他用户结果。
- Push Notification 不回调非 allowlist URL。
- 输出中的恶意指令不会自动触发下游动作。

## 8. 发布清单

发布 A2A Agent 前检查：

- Agent Card 可机器读取。
- Skill 粒度合适。
- 认证方式明确。
- 输入输出模态明确。
- 长任务有 Task store。
- Artifact 有大小限制和保留策略。
- 支持超时和取消。
- 有审计日志。
- 错误信息清楚但不泄露内部细节。
- 有版本兼容策略。

## 9. 示例：代码审查 Agent

Agent Card：

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

Task 流：

```text
submitted
working: fetching diff
working: analyzing security
working: analyzing tests
artifact: partial findings
completed: final review report
```

Artifact：

```json
{
  "artifactId": "review-001",
  "name": "pull-request-review",
  "parts": [
    {
      "kind": "text",
      "text": "## Summary\nFound 2 high priority issues..."
    },
    {
      "kind": "data",
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

## 10. 学习任务

按顺序实践：

1. 写一个静态 Agent Card。
2. 写 `message/send`，固定返回文本 Message。
3. 增加参数校验和 JSON-RPC error。
4. 对长请求返回 Task。
5. 实现 `tasks/get`。
6. 实现 `tasks/cancel`。
7. 实现 `message/stream`。
8. 给 Task 增加 Artifact。
9. 增加 Bearer Token 认证。
10. 写一个 Client Agent：读取 Agent Card，选择 Skill，发送任务，消费 Artifact。
11. 让 Remote Agent 内部调用一个 MCP Tool。

