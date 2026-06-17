# 什么是 A2A 协议

> 本节带你从零理解 A2A（Agent2Agent）协议：它解决什么问题、核心角色是谁、Agent Card 是什么。
>
> **本节你将学到**：为什么需要 Agent 间协议、A2A 的定位、两个核心角色（A2A Client / A2A Server）、Agent Card 的作用。
>
> **一句话比喻**：A2A 像「公司间协作流程」——不同公司用统一的外发公文格式沟通，而不是各自发明一套。

## 为什么需要 Agent 间协议

随着 Agent 系统变复杂，一个应用往往不会只有一个 Agent。真实场景：

- 一个前台客服 Agent 需要把退款问题交给**财务 Agent** 处理
- 一个 IDE Agent 需要把安全审计交给**安全审计 Agent**
- 一个企业助理 Agent 需要调用 HR、CRM、工单、数据分析等多个**专业 Agent**

如果每两个 Agent 都用私有 HTTP API 对接，就会出现这些痛点：

- 每个 Agent 都要**适配 N 套不同接口**，对接成本爆炸
- 很难统一**发现**远程 Agent 的能力（得看各家文档）
- 长任务、流式进度、多轮补充信息**没有统一模型**（每家自己发明）
- 不同系统之间容易**暴露内部状态**、工具和私有记忆

A2A 的目标就是提供一套**通用交互模型**：发现 Agent → 发送消息/任务 → 跟踪状态 → 接收流式进度 → 交换产物——**在不暴露各方内部实现的前提下协作**。

## A2A 是什么

A2A（Agent2Agent）是 Google 联合多家厂商推出的**开放协议**，让不同框架（LangGraph、ADK、Semantic Kernel、自研系统……）、不同语言、不同厂商实现的 AI Agent **互相发现、互相委派任务、交换结果**。

它有三个核心特点：

1. **跨框架跨厂商**——不绑定任何特定 Agent 框架
2. **不透明执行（opaque execution）**——Agent 可以协作，但**不需要公开**自己的内部思考、私有工具、记忆或编排策略。A2A Server 把自己当「黑盒」提供服务
3. **传输协议中立**——支持 JSON-RPC、gRPC、HTTP/REST 等多种绑定

::: tip 核心理解
A2A 不是一个 Agent 框架，而是 Agent 之间的**沟通语言**。就像 HTTP 是浏览器和服务器之间的语言——不管你用 Chrome 还是 Firefox、用 Nginx 还是 Apache，大家说的是同一种话。
:::

## 两个核心角色

A2A 用「**委托方/承包方**」的比喻最容易理解：

### A2A Client（发起方，委托方）

A2A Client 是**发起请求**的一方。它可能是用户正在交互的主 Agent，也可能是一个编排器（orchestrator）。职责：

- 发现远程 Agent（读 Agent Card）
- 根据能力决定是否委派任务
- 发送 Message
- 追踪 Task 状态
- 处理流式事件、补充输入和最终结果

### A2A Server（执行方，承包方）

A2A Server 又叫 **Remote Agent**，是**接收请求并执行任务**的一方。职责：

- 暴露 Agent Card（让 Client 发现自己）
- 接收 A2A 消息
- 返回 Message（短回答）或 Task（长任务）
- 在长任务中更新状态
- 产出 Artifact（可消费的结果）

::: tip A2A Server 可以是任何东西
A2A Server 内部可以是 LangGraph、ADK、Semantic Kernel、自研框架、普通服务，甚至人工流程——A2A **完全不管**你内部怎么实现。它只规定「对外怎么说」，不规定「内部怎么做」。这就是 opaque execution 的精髓。
:::

## Agent Card：Agent 的「名片」

Agent Card 是 A2A Server 的**机器可读能力声明**。用「企业黄页」比喻：每个 Agent 在黄页上挂一张名片，写清自己是谁、能干什么、怎么联系、需要什么认证。

::: warning 重要认知
Agent Card **不是给人看的说明文档**，而是给 Client 程序读的**机器契约**。Client 读它来决定：要不要连接、怎么认证、是否启用流式、能不能处理我要委派的任务。
:::

### 怎么发现一张 Agent Card

A2A 规定了一个统一的发现路径：

```bash
GET https://agents.example.com/.well-known/agent-card.json
```

这是 [RFC 8615 well-known URI](https://www.rfc-editor.org/rfc/rfc8615) 约定——所有 A2A Server 都把自己的 Card 放在 `/.well-known/agent-card.json` 这个固定位置。

### 一张极简的 Agent Card 长什么样

```json
{
  "name": "Code Review Agent",
  "description": "审查源代码，返回可执行的安全和正确性建议。",
  "version": "1.0.0",
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
      "description": "找出代码里的正确性、安全和可维护性问题。",
      "tags": ["security", "code-review"]
    }
  ]
}
```

逐字段看：

| 字段 | 含义 |
|------|------|
| `name` / `description` | Agent 是谁、做什么 |
| `version` | 版本号 |
| `supportedInterfaces` | **真正的服务端点 URL**（注意：URL 在数组里，不在顶层） |
| `capabilities` | 支持的能力：`streaming`（流式）、`pushNotifications`（推送）、`extensions`、`extendedAgentCard` |
| `skills` | 能力清单：每项有 `id` / `name` / `description` / `tags` |

Client 拿到这张 Card，就知道：联系谁、能不能流式、有没有我要的能力、下一步该怎么发请求。

## 动手实验

1. **看真实 Card**：浏览器打开官方 demo `https://a2a-protocol.org/` 找一个示例 Agent 的 Card，或自己跑一个开源 A2A Server，用 `curl https://你的域名/.well-known/agent-card.json` 看返回。
2. **字段对照**：拿一张真实 Card，逐字段对照本节的表格，找出 `supportedInterfaces`、`capabilities`、`skills` 各是什么。
3. **对比两张 Card**：找两个不同的 A2A Agent（如一个代码审查 Agent、一个翻译 Agent），对比它们的 `skills` 和 `capabilities` 差异，体会 Card 怎么表达「能力」。
