# 01 - A2A Agent 发现与 Agent Card

A2A 的第一步不是发消息，而是发现远程 Agent 并理解它能做什么。这个发现契约就是 Agent Card。

## 1. 为什么需要 Agent Card

如果没有 Agent Card，Client Agent 只能通过人工配置知道：

- 远程 Agent 在哪里。
- 它能做什么。
- 它支持哪些输入输出。
- 是否支持流式。
- 是否需要认证。
- 应该调用哪个 endpoint。

Agent Card 把这些信息变成机器可读结构。Client Agent 可以读取它，决定是否委派任务，以及如何委派。

## 2. 发现方式

### 2.1 well-known 发现

最常见方式：

```text
GET https://agent.example.com/.well-known/agent-card.json
```

优点：

- 简单。
- 不需要中心注册服务。
- 适合公开或半公开 Agent。

限制：

- 多环境、多租户、大规模 Agent 管理时不够灵活。
- 需要额外处理认证、缓存、版本更新。

### 2.2 直接配置

Client 直接配置 Agent Card 或 endpoint。

适合：

- 测试。
- 内网固定服务。
- Agent 数量少。

### 2.3 注册中心发现

企业环境可能使用 Nacos、服务发现系统、API Catalog 或内部 Registry。

适合：

- 多 Agent 动态注册。
- 环境隔离。
- 灰度发布。
- 权限和审计集中管理。

## 3. Agent Card 的核心字段

一个 Agent Card 通常包含：

| 字段 | 作用 |
| --- | --- |
| `name` | Agent 名称 |
| `description` | Agent 能力描述 |
| `url` 或 `supportedInterfaces` | 调用地址或协议接口 |
| `version` | Agent 自身版本 |
| `protocolVersion` | 支持的 A2A 协议版本 |
| `capabilities` | 是否支持 streaming、push notification 等 |
| `defaultInputModes` | 默认输入模态 |
| `defaultOutputModes` | 默认输出模态 |
| `skills` | Agent 提供的技能列表 |
| `securitySchemes` / `security` | 认证和授权要求 |

不同版本的规范和 SDK 字段可能有演进。实现时应以当前规范 schema 为准，同时对未知字段保持兼容。

## 4. Agent Card 示例

```json
{
  "name": "Code Review Agent",
  "description": "Reviews pull requests for correctness, security, and maintainability.",
  "url": "https://agents.example.com/code-review",
  "version": "1.0.0",
  "protocolVersion": "0.3.0",
  "defaultInputModes": ["text/plain", "application/json"],
  "defaultOutputModes": ["text/plain", "application/json"],
  "capabilities": {
    "streaming": true,
    "pushNotifications": true
  },
  "skills": [
    {
      "id": "review_pull_request",
      "name": "Review Pull Request",
      "description": "Analyzes a pull request and returns prioritized review findings.",
      "tags": ["code", "security", "review"],
      "examples": [
        "Review PR 42 in repo example/api"
      ],
      "inputModes": ["text/plain", "application/json"],
      "outputModes": ["text/plain", "application/json"]
    }
  ],
  "securitySchemes": {
    "bearer": {
      "type": "http",
      "scheme": "bearer"
    }
  },
  "security": [
    {
      "bearer": []
    }
  ]
}
```

## 5. Skill 设计

Skill 是 Agent Card 中最重要的能力声明。

好的 Skill 描述：

```json
{
  "id": "analyze_incident",
  "name": "Analyze Incident",
  "description": "Analyzes incident timelines, logs, and service metadata to produce likely causes and next actions.",
  "tags": ["incident", "sre", "logs"],
  "examples": [
    "Analyze incident INC-1234 and summarize likely root causes"
  ]
}
```

差的 Skill 描述：

```json
{
  "id": "do_task",
  "name": "Task",
  "description": "Does things"
}
```

Skill 应说明：

- 适合什么任务。
- 需要什么输入。
- 产出什么结果。
- 有哪些限制。
- 是否适合长任务。

## 6. Capabilities

Capabilities 告诉 Client 远程 Agent 支持哪些交互模式。

常见能力：

| 能力 | 含义 |
| --- | --- |
| `streaming` | 支持流式事件 |
| `pushNotifications` | 支持任务状态变化回调 |
| `stateTransitionHistory` | 可能返回状态变化历史 |

Client 不应假设所有 Agent 都支持 streaming。如果不支持，就应使用 `message/send` 加 `tasks/get` 轮询。

## 7. 输入输出模态

A2A 不是只能传文本。常见模态：

- `text/plain`
- `application/json`
- `image/png`
- `image/jpeg`
- `application/pdf`
- `text/markdown`

模态设计建议：

- 默认输入输出写最常用的。
- Skill 可以覆盖默认模态。
- 不支持的模态要尽早拒绝。
- 文件类输入要限制大小和类型。

## 8. Security

Agent Card 可以声明认证方式，但不要把 secret 放进 Card。

常见安全方案：

- Bearer Token。
- OAuth 2.0。
- API Key。
- mTLS。
- 企业网关。

Client 读取 Agent Card 后，应判断：

- 当前用户是否有凭证。
- 任务是否允许发送给这个 Agent。
- 这个 Agent 是否属于可信域。
- 输出是否允许进入当前上下文。

## 9. 版本与缓存

Agent Card 通常会被缓存。要考虑：

- Agent version 变化。
- 协议版本变化。
- Skill 增删。
- endpoint 迁移。
- 安全要求变化。

建议：

- 使用 HTTP 缓存头或 registry version。
- Client 定期刷新。
- 调用失败时重新拉取 Agent Card。
- 对不兼容变更提高版本号。

## 10. 本章检查点

读完本章，你应该能：

- 解释为什么 Agent Card 是 A2A 的入口契约。
- 设计一个可用于生产发现的 Agent Card。
- 判断 Skill 描述是否足够机器可读。
- 区分 well-known、直接配置、注册中心三种发现方式。
- 说明 Capabilities 和输入输出模态如何影响调用策略。

