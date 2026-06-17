# Agent 发现与名片

> **协议详解篇第二节。** [协议总览](./00-a2a-from-zero.md) 给了你一张全景地图，本节开始深入第一块——**Agent Card**。这是 A2A 的「入口契约」，决定了 Client 能不能发现你、怎么联系你、你能干什么。
>
> **本节你将学到**：为什么需要 Agent Card、三种发现方式（well-known / 直接配置 / 注册中心）、Agent Card 的全部 v1.0 字段、Skill 怎么设计、Capabilities、输入输出模态、安全声明、版本与缓存策略。
>
> **一句话比喻**：Agent Card 是 Agent 的「**企业黄页条目**」——不是给人读的广告，而是给 Client 程序读的机器契约，决定要不要联系、怎么联系。

A2A 的第一步不是发消息，而是发现远程 Agent 并理解它能做什么。这个发现契约就是 Agent Card。

::: tip 重要认知
Agent Card **不是文档**——它是**机器可读的入口契约**。A2A Client 程序读它来决定：要不要连接、怎么认证、是否启用流式、能不能处理我要委派的任务。设计 Card 时要从「机器怎么读」出发，不是「人怎么读」。
:::

## 1. 为什么需要 Agent Card

如果没有 Agent Card，A2A Client 只能通过人工配置知道：

- 远程 Agent 在哪里
- 它能做什么
- 它支持哪些输入输出
- 是否支持流式
- 是否需要认证
- 应该调用哪个 endpoint

Agent Card 把这些信息变成**机器可读结构**。Client 可以读取它，决定是否委派任务，以及如何委派。

## 2. 发现方式

### 2.1 well-known 发现

最常见方式：

```text
GET https://agent.example.com/.well-known/agent-card.json
```

优点：

- 简单
- 不需要中心注册服务
- 适合公开或半公开 Agent

限制：

- 多环境、多租户、大规模 Agent 管理时不够灵活
- 需要额外处理认证、缓存、版本更新

### 2.2 直接配置

Client 直接配置 Agent Card 或 endpoint。

适合：测试、内网固定服务、Agent 数量少。

### 2.3 注册中心发现

企业环境可能使用 Nacos、服务发现系统、API Catalog 或内部 Registry。

适合：多 Agent 动态注册、环境隔离、灰度发布、权限和审计集中管理。

## 3. Agent Card 的核心字段（v1.0）

v1.0 的 Agent Card 字段：

| 字段 | 作用 |
| --- | --- |
| `name` | Agent 名称（必填） |
| `description` | Agent 能力描述（必填） |
| `version` | Agent 自身版本（必填） |
| `supportedInterfaces` | ⭐ **接口数组**，每个含 `url` / `protocolBinding` / `protocolVersion`（必填） |
| `capabilities` | 是否支持 streaming、pushNotifications、extensions、extendedAgentCard |
| `defaultInputModes` | 默认输入模态 |
| `defaultOutputModes` | 默认输出模态 |
| `skills` | Agent 提供的技能列表（必填） |
| `securitySchemes` | 认证方案声明 |
| `securityRequirements` | 哪些方案必须满足 |
| `provider` | 提供方信息 |
| `documentationUrl` | 文档地址 |
| `iconUrl` | 图标地址 |
| `signatures` | Card 签名（用于验证完整性） |

::: warning v0.x → v1.0 关键变化
- **URL 不再在顶层**：v0.x 是 `url`，v1.0 是 `supportedInterfaces[].url`（一个 Agent 可以有多个接口，第一个是 preferred）
- **`capabilities` 字段精简**：去掉了 v0.x 的 `stateTransitionHistory`，v1.0 只有 `streaming` / `pushNotifications` / `extensions` / `extendedAgentCard`
- **新增字段**：`signatures`、`iconUrl`、`extendedAgentCard`
:::

## 4. Agent Card 示例（v1.0）

```json
{
  "name": "Code Review Agent",
  "description": "Reviews pull requests for correctness, security, and maintainability.",
  "version": "1.0.0",
  "supportedInterfaces": [
    {
      "url": "https://agents.example.com/a2a",
      "protocolVersion": "1.0.0"
    }
  ],
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
  "securityRequirements": [
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

- 适合什么任务
- 需要什么输入
- 产出什么结果
- 有哪些限制
- 是否适合长任务

## 6. Capabilities（v1.0）

Capabilities 告诉 Client 远程 Agent 支持哪些交互模式。

v1.0 的 capabilities 字段：

| 能力 | 含义 |
| --- | --- |
| `streaming` | 支持流式事件（`SendStreamingMessage`） |
| `pushNotifications` | 支持任务状态变化回调 |
| `extensions` | 支持协议扩展 |
| `extendedAgentCard` | 支持扩展 Card（Client 可请求更详细的 Card） |

Client 不应假设所有 Agent 都支持 streaming。如果不支持，就应使用 `SendMessage` 加 `GetTask` 轮询。

## 7. 输入输出模态

A2A 不是只能传文本。常见模态：

- `text/plain`
- `application/json`
- `image/png`
- `image/jpeg`
- `application/pdf`
- `text/markdown`

模态设计建议：

- 默认输入输出写最常用的
- Skill 可以覆盖默认模态
- 不支持的模态要尽早拒绝
- 文件类输入要限制大小和类型

## 8. Security

Agent Card 可以声明认证方式，但**不要把 secret 放进 Card**。

常见安全方案：Bearer Token、OAuth 2.0、API Key、mTLS、企业网关。

Client 读取 Agent Card 后，应判断：

- 当前用户是否有凭证
- 任务是否允许发送给这个 Agent
- 这个 Agent 是否属于可信域
- 输出是否允许进入当前上下文

## 9. 版本与缓存

Agent Card 通常会被缓存。要考虑：

- Agent version 变化
- 协议版本变化
- Skill 增删
- endpoint 迁移
- 安全要求变化

建议：

- 使用 HTTP 缓存头或 registry version
- Client 定期刷新
- 调用失败时重新拉取 Agent Card
- 对不兼容变更提高版本号

## 10. 本章检查点

读完本章，你应该能：

- 解释为什么 Agent Card 是 A2A 的入口契约
- 设计一个可用于生产发现的 Agent Card
- 判断 Skill 描述是否足够机器可读
- 区分 well-known、直接配置、注册中心三种发现方式
- 说明 Capabilities 和输入输出模态如何影响调用策略

## 动手实验

1. **读一张真实 Card**：用 `curl https://某域名/.well-known/agent-card.json` 拉一张真实 A2A Agent 的 Card，逐字段对照本节 §3 的字段表，找出它的 `supportedInterfaces`、`capabilities`、`skills`、`securitySchemes`。
2. **写一张 Card**：为你想做的 Agent（如「简历优化 Agent」）手写一张 v1.0 格式的 Agent Card，至少含 1 个 skill、明确 capabilities、声明 bearer 认证。
3. **Skill 描述对比**：写 3 个 Skill 描述（好/中/差），对照 §5 的清单，体会 description 和 tags 怎么影响 Client 的委派决策。
4. **缓存策略**：为你的 Agent Card 设计缓存方案——用 HTTP `Cache-Control` 头还是 registry version？失效后 Client 怎么自动刷新？

## 接下来

- [消息与任务模型](./02-message-task-model.md) —— Card 里 skills 声明的能力，实际通过 Message/Task 交换
- [协议方法](./03-protocol-methods.md) —— `supportedInterfaces[].url` 指向的端点接受哪些 JSON-RPC 方法
- [实现指南](./05-implementation-guide.md) —— 怎么把 Card 暴露成真实的 HTTP 服务
