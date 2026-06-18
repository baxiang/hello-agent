# 协议总览

> **协议详解篇第一节。** [入门篇](./getting-started/02-primitives-tour.md) 你已经会写最小 Server、知道三大原语。本节通过一个新工程师「小张」的真实需求，把协议的**全景地图**讲清楚——JSON-RPC 消息、生命周期、能力协商、安全边界一次性串起来。
>
> **本节你将学到**：JSON-RPC 2.0 三种消息、初始化与能力协商、生命周期三阶段、三大原语快速回顾、Client 反向能力、两种传输方式、最小实现清单。
>
> **一句话比喻**：如果入门篇教你「**装一个 USB-C U 盘**」，本节教你「**整个 USB-C 标准的电气规范**」——从消息格式到握手协议到安全边界。

## 小张的第一个需求

小张刚入职第一周，组长把他叫到会议室：「我们想做一个**代码评审助手**。它能读 GitHub 上的 PR、查公司数据库里这个仓库的历史记录，最后把评审结论发到**飞书群**。你看看怎么搞。」

小张是个实干派，回工位就开始画架构：

- 接 GitHub：调 REST API，搞 OAuth token，写分页、写错误重试。
- 接数据库：用 SQLAlchemy，写连接池、写超时、写 SQL 注入防护。
- 接飞书：搞机器人 webhook，写消息卡片模板、写 @ 提醒。

写到第三天，小张有点不对劲。三个系统，三套鉴权、三套错误处理、三套日志格式。更要命的是组长又加了一条：「下个月可能还要接 Jira 和 Confluence。」小张脑子里立刻浮出一个公式：**N 个 AI 应用 × M 个外部系统 = N×M 套粘合代码**。他突然意识到自己不是在写代码评审助手，是在写**一堆永远不会复用的对接层**。

「难道没人把这事儿标准化过？」小张问隔壁工位的老王。老王推了推眼镜：「你说的这个，去年 Anthropic 出了个东西叫 **MCP**，干的就是这件事。」

本节跟着小张，把 MCP 这套标准从「**为什么要它**」一路看到「**它具体长什么样**」。

## 1. MCP 想解决的问题：N×M 对接地狱

小张梳理了一下自己刚才踩的坑：

- **每接一个系统都要重写鉴权**。GitHub 用 OAuth，数据库用账号密码，飞书用 webhook token——全都不一样。
- **错误处理各搞各的**。GitHub 返回 422，数据库抛 `OperationalError`，飞书 webhook 静默失败。
- **消息格式五花八门**。有的是 JSON，有的是 form，有的要 base64。
- **权限边界混乱**。到底哪个模块能调 GitHub 写接口？哪个只能读？没人能说清。

MCP（Model Context Protocol，模型上下文协议）就是来解决这件事的。它的目标用一句话说清：

> **让任何 AI 应用用统一方式连接任何外部工具和数据。**

老王给小张打了个比方——**MCP 就是 USB-C 标准接口**。USB-C 出现之前，每个外设都自带一根专用线、一个专用驱动；USB-C 把接口、电气、协议全标准化之后，任何外设插任何设备都能用。MCP 之于 AI 应用，就像 USB-C 之于电脑。

| 角色 | USB-C 世界 | MCP 世界 |
| --- | --- | --- |
| Host | 你的手机或电脑 | 跑大模型的 AI 应用（Claude Desktop、Cursor、自研 Agent） |
| Client | 数据线 | Host 内部的连接器，1 个 Client 连 1 个 Server |
| Server | U 盘 / 移动硬盘 / 显示器 | 提供工具/数据/提示词的外部能力（GitHub Server、数据库 Server、飞书 Server） |

回到小张的代码评审助手：他不用自己写三套对接，而是找三个 MCP Server——GitHub Server、数据库 Server、飞书 Server，把它们「插」到自己的 Host 上就行。剩下的事情，全部交给 MCP 这套标准。

## 2. 消息长什么样：JSON-RPC 2.0

小张的下一个问题是：「**这根『数据线』上传的，到底是什么东西？**」

答案是一种叫 **JSON-RPC 2.0** 的消息格式。选它原因很直接：纯文本、跨语言、足够简单。Client 和 Server 之间来回传的，本质上只有三类消息。

### 2.1 Request：我要你做一件事

请求需要对方返回响应，所以必须带 `id`：

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "tools/list",
  "params": {}
}
```

- `jsonrpc` 永远是 `"2.0"`，相当于接头暗号。
- `id` 用来匹配「这个响应是对哪个请求的回复」，不能为 `null`。
- `method` 是要干什么，比如 `tools/list`。
- `params` 是参数，可有可无。

### 2.2 Response：我回来了

成功响应把结果塞进 `result`：

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "result": {
    "tools": []
  }
}
```

失败响应换成 `error`，并带标准错误码：

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "error": {
    "code": -32602,
    "message": "Invalid params"
  }
}
```

小张一开始奇怪「为啥不直接用 HTTP 状态码」——因为他忘了 MCP 不一定跑在 HTTP 上（下面讲 stdio 就明白）。所以错误必须放在消息体里，**和传输层解耦**。这样同一套消息格式既能跑 HTTP，也能跑管道。

### 2.3 Notification：跟你说一声，不用回

通知没有 `id`，因为不需要响应：

```json
{
  "jsonrpc": "2.0",
  "method": "notifications/initialized"
}
```

最典型的通知是「我准备好了」这种状态广播。小张稍后看生命周期时就会再遇见它。

::: tip 三类消息怎么一眼区分
看到消息先扫两个字段：有 `method` 又有 `id` → Request；有 `id` 没 `method` → Response（再看 `result` 还是 `error`）；有 `method` 没 `id` → Notification。
:::

## 3. 一次连接的生命周期

消息格式有了，小张接着问：「**Client 和 Server 一开始怎么搭上话？总不能上来就 `tools/call` 吧？**」

确实不能。一次 MCP 会话通常分三段：

1. **Initialization**（初始化）：互相认门、对暗号。
2. **Operation**（正常通信）：干活。
3. **Shutdown**（关闭）：再见。

### 3.1 初始化：能力协商

Client 必须先发一个 `initialize` 请求，把自己是谁、支持什么版本、有什么能力都告诉 Server：

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "initialize",
  "params": {
    "protocolVersion": "2025-11-25",
    "capabilities": {
      "roots": {
        "listChanged": true
      },
      "sampling": {},
      "elicitation": {
        "form": {},
        "url": {}
      }
    },
    "clientInfo": {
      "name": "example-client",
      "version": "1.0.0"
    }
  }
}
```

Server 回复自己支持的协议版本、能力、服务信息：

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "result": {
    "protocolVersion": "2025-11-25",
    "capabilities": {
      "resources": {
        "subscribe": true,
        "listChanged": true
      },
      "prompts": {
        "listChanged": true
      },
      "tools": {
        "listChanged": true
      }
    },
    "serverInfo": {
      "name": "example-server",
      "version": "1.0.0"
    }
  }
}
```

小张注意到一个关键设计：**双方都在 `capabilities` 里声明「我会什么」**。这叫**能力协商**。它意味着协议是「按需启用」的——Server 没暴露 `tools`，Client 就不会问 `tools/list`；Client 不支持 `roots`，Server 也不去碰。这避免了「我假定对方一定支持」带来的崩溃。USB-C 也是这么干的：插上之后先协商供电电压、协商速率，再开始传数据。

协商成功后，Client 再发一个 `notifications/initialized` 通知（还记得 §2.3 吗，这就是 Notification 的典型用法），告诉 Server「**握手结束，可以开干了**」。

### 3.2 正常通信：原语登场

进入 Operation 阶段，双方根据协商出的能力交换消息。小张会用到的方法基本就这几类：

- `tools/list`、`tools/call`
- `resources/list`、`resources/read`
- `prompts/list`、`prompts/get`

这些就是下一节要讲的「三大原语」。

### 3.3 关闭

stdio 传输下，Host 通常直接关闭 stdin 或终止子进程。HTTP 传输下，连接和会话的关闭取决于实现细节。MCP 没有强制的告别消息，靠传输层自己处理。

## 4. 三大原语：Server 到底能给什么

握手完了，小张真正关心的问题来了：**「我那三个 Server——GitHub、数据库、飞书——到底能给我什么？」**

MCP 把 Server 能给的东西抽象成三大类，叫「**原语**」。它们之间的区别，本质上是**谁来决定用它**。

### 4.1 Resources：模型/应用主动读的「上下文数据」

Resource 是给模型或用户**看**的数据。小张的代码评审助手用得着的有：

- PR 的 diff 文件内容。
- 数据库里这个仓库的历史评审记录。
- README、文档片段、API 返回的业务对象。

Resource 由**应用控制**——Server 暴露一个资源列表，Client（或 Host）决定什么时候读。

列出资源：

```json
{
  "jsonrpc": "2.0",
  "id": 2,
  "method": "resources/list",
  "params": {}
}
```

读取某个资源（注意 `uri` 字段，资源用 URI 定位）：

```json
{
  "jsonrpc": "2.0",
  "id": 3,
  "method": "resources/read",
  "params": {
    "uri": "file:///workspace/README.md"
  }
}
```

### 4.2 Prompts：用户选的「工作流入口」

Prompt 是 Server 暴露给**用户**的提示词模板。它适合表达「固定流程」，小张能想到的有：

- 「评审这段 PR」。
- 「生成提交信息」。
- 「根据数据库 schema 写查询」。
- 「分析日志」。

Prompt 由**用户控制**——通常以 slash command、菜单或按钮触发，模型不能擅自调用。

列出提示词：

```json
{
  "jsonrpc": "2.0",
  "id": 4,
  "method": "prompts/list",
  "params": {}
}
```

获取一个具体提示词（可以带参数）：

```json
{
  "jsonrpc": "2.0",
  "id": 5,
  "method": "prompts/get",
  "params": {
    "name": "code_review",
    "arguments": {
      "path": "src/main.py"
    }
  }
}
```

### 4.3 Tools：模型决定调用的「动作」

Tool 是**模型**可以请求调用的函数。小张的助手要执行的「**动作**」都属于这一类：

- 调 GitHub API 查 PR 评论。
- 查数据库某张表。
- 把结论发到飞书。
- 修改文件、创建 issue、转账、删数据……

**Tool 是三类原语里风险最高的**，因为它可能写外部系统。Host 应该让用户理解和确认敏感操作，不能模型说调就调。

列出工具：

```json
{
  "jsonrpc": "2.0",
  "id": 6,
  "method": "tools/list",
  "params": {}
}
```

调用工具：

```json
{
  "jsonrpc": "2.0",
  "id": 7,
  "method": "tools/call",
  "params": {
    "name": "search_issues",
    "arguments": {
      "query": "is:open label:bug"
    }
  }
}
```

::: tip 一句话区分三大原语
**Resources 给模型看（应用控制）、Prompts 给用户选（用户控制）、Tools 让模型做（模型控制）**。控制方不同，安全模型也不同——这是 MCP 设计上最容易被忽略、但最重要的一点。
:::

## 5. 反过来：Client 也能给 Server 提供能力

小张以为 MCP 就是「Server 卖能力，Client 买能力」，结果老王补了一句：**「协议不是单向的。在允许范围内，Server 也能反过来向 Client 请求能力。」**小张愣了一下，然后理解了——这让 Server 能做更复杂的事，又不会越权。

Client 可以提供三种反向能力。

### 5.1 Sampling：让 Server 借模型用一下

Sampling 允许 Server 反过来**请求 Client 让模型生成内容**。这个能力必须由 Host 控制，因为它会消耗模型资源、可能涉及上下文泄露。小张的 GitHub Server 在生成 PR 总结时，就可能反过来请求 Client：「让模型帮我把这段 diff 总结成一段话」。

### 5.2 Roots：告诉 Server 你的地盘在哪

Roots 表示 Server 可以操作或理解的**边界**，例如工作区目录。它帮 Server 知道自己能访问哪些 URI 或文件范围——避免文件系统 Server 跑去读 `/etc/passwd` 这种事。

### 5.3 Elicitation：Server 通过 Client 问用户问题

Elicitation 允许 Server 通过 Client **向用户请求额外信息**。它有两个典型模式：

- `form`：让用户填结构化字段（比如「请填一下分支名」）。
- `url`：把用户引导到外部页面完成敏感交互（OAuth 授权、支付等）。

小张的飞书 Server 要发消息到某个敏感群之前，就可以通过 Elicitation 让用户确认目标群——**绝不能**在普通表单里收集密码、API key、access token 或支付凭证。敏感信息要走 `url` 流程，由 Host 明确展示目标域名并要求用户确认。

## 6. 数据线怎么接：传输方式

「USB-C 还分公头母头呢，MCP 用什么『线』连？」小张继续问。

MCP 当前标准传输主要有两种：**stdio** 和 **Streamable HTTP**。它们对应了「本地插件」和「远程服务」两种典型场景。

### 6.1 stdio：本地子进程

stdio 适合本地 Server。流程通常是：

1. Host 启动 Server 子进程。
2. Client 通过 stdin 向 Server 写 JSON-RPC 消息。
3. Server 通过 stdout 返回 JSON-RPC 消息。
4. Server 可以把日志写到 stderr。

小张的本地开发场景用 stdio 最舒服。但他踩过坑——**stdout 只能写合法 MCP 消息，日志混进去就会让协议解析挂掉**。每条消息用换行分隔。

stdio 的优点：

- 简单，适合本地开发和桌面应用。
- 不需要独立 HTTP 服务。

stdio 的限制：

- 不适合多客户端共享（一个 Server 子进程绑定一个 Client）。
- 不适合跨网络部署。
- 进程生命周期由 Host 管理。

### 6.2 Streamable HTTP：远程服务化

Streamable HTTP 适合远程或服务化的 Server。它用 HTTP POST 和 GET，Server 可以选择用 SSE 流式返回多条消息。

优点：

- 适合远程服务，可以跨网络。
- 一个 Server 可以接多个客户端。
- 容易接入认证、网关、可观测性系统。

小张的代码评审助手如果将来要在公司内部署成「公共服务」，让所有团队的 AI 应用都来连，就得用 Streamable HTTP。但安全要求也更高：

- 校验 `Origin` 头，防止 DNS rebinding 攻击。
- 本地服务优先绑定 `127.0.0.1`，**不要**随手监听 `0.0.0.0`。
- 远程服务必须实现认证和授权。

## 7. 从 0 写一个 Server：小张的设计清单

理论够了。小张回到自己的需求，开始列「先做什么」。老王提醒他：**不要一上来就追求大而全**。先回答这几个问题：

1. 这个 Server 只做什么？（一句话能说清。）
2. 它需要暴露 Resources、Prompts、Tools 中的哪几类？
3. 每个 Tool 的输入 schema 是什么？
4. Tool 是否会产生副作用？写还是只读？
5. 哪些操作必须让用户确认？
6. Server 能访问哪些路径、数据库或 API？
7. 错误返回给模型时，是否足够清晰，能让模型自我修正？

小张决定第一版飞书 Server 只做 4 件事：

- `initialize`
- `tools/list`
- `tools/call`
- 一个只读的 `search_messages` 工具

等基本链路跑通，再加 Resources、Prompts、分页、日志、认证、订阅。「**先把 USB-C 的口焊上，再考虑能插多少外设。**」老王总结。

## 8. 小张差点踩的坑：常见误区

老王临走前，给小张甩了一份「四个新手最容易踩的坑」：

**误区一：Server 什么都能访问**
不应该。Server 应该只拿到完成任务所需的最小权限。文件系统 Server 不要全盘访问、数据库 Server 不要 DBA 权限。

**误区二：Tool 调用可以默认执行**
高风险 Tool（写文件、发请求、删数据、转账、发消息）必须由 Host 展示给用户确认。**默认怀疑一切有副作用的 Tool**。

**误区三：MCP Server 能看到完整聊天记录**
不能。Server 通常只看到 Host 明确传给它的请求和上下文。**完整对话由 Host 控制**，Server 不该是「另一个监听者」。

**误区四：MCP 只是本地插件**
不是。stdio 是本地，Streamable HTTP 是远程。**MCP 既能当插件用，也能当服务用**。小张的助手迟早要把飞书 Server 部成远程服务。

## 9. 核心术语速查

跟了小张一路，最后留一张「字典」。后面 5 篇专题都会反复用到这些词。

| 术语 | 含义 |
| --- | --- |
| Host | 用户使用的 AI 应用，负责 UI、权限、模型集成和 Client 管理 |
| Client | Host 内部的 MCP 连接器，一个 Client 通常连接一个 Server |
| Server | 外部能力提供者，暴露资源、提示词和工具 |
| Resource | 可读上下文数据（application-driven），例如文件、schema、文档 |
| Prompt | 用户可选择的提示词模板或工作流入口（user-controlled） |
| Tool | 模型可请求调用的函数或动作（model-controlled） |
| Sampling | Server 请求 Client 调用模型生成内容 |
| Roots | Client 告诉 Server 的可操作边界 |
| Elicitation | Server 通过 Client 向用户请求额外信息 |
| Transport | 传输层，例如 stdio 或 Streamable HTTP |

## 动手实验

1. **抓 JSON-RPC 消息**：用 [入门篇 01](./getting-started/01-first-server.md) 的 Server + Inspector，打开浏览器开发者工具或看 Inspector 的日志，找出一条 `tools/list` 请求和响应，对照本节 §2 的格式逐字段解读。
2. **生命周期观察**：用 Inspector 连接 Server 时，看左侧日志里的 `initialize` → 能力协商 → 正常调用 → 关闭四步，对照本节 §3 的生命周期阶段。
3. **传输方式对比**：把同一个 Server 分别用 stdio 和 Streamable HTTP 启动（Streamable HTTP 需要改 `mcp.run(transport="http")`），用 Inspector 连接两种，观察启动方式、可远程性、配置差异。
4. **能力清单核对**：找一个开源 MCP Server（如 filesystem），用 Inspector 读它的 `initialize` 响应里的 `capabilities` 字段，看它声明了哪些原语（resources/tools/prompts 哪些勾选了）。

## 接下来

跟着小张把代码评审助手做完——他下一篇会遇到更具体的问题：

- [协议架构](./01-protocol-architecture.md) —— 小张第一次抓包，JSON-RPC 消息、初始化握手、能力协商的完整细节
- [Server 能力](./02-server-capabilities.md) —— 小张的三个 Server 怎么把 Resources / Prompts / Tools 暴露出来
- [Client 能力](./03-client-capabilities.md) —— 小张的 Host 怎么用 Roots / Sampling / Elicitation 这些反向能力
- [传输与安全](./04-transports-security.md) —— 小张的飞书 Server 从本地 stdio 迁到远程 Streamable HTTP 时要处理什么
- [实现指南](./05-implementation-guide.md) —— 小张按工程清单把 Server 真正落地

## 官方参考

- MCP 规范：https://modelcontextprotocol.io/specification/2025-11-25
- MCP 架构：https://modelcontextprotocol.io/specification/2025-11-25/architecture
- MCP 基础协议：https://modelcontextprotocol.io/specification/2025-11-25/basic
- MCP 生命周期：https://modelcontextprotocol.io/specification/2025-11-25/basic/lifecycle
- MCP 传输：https://modelcontextprotocol.io/specification/2025-11-25/basic/transports
- MCP Server 能力：https://modelcontextprotocol.io/specification/2025-11-25/server
- MCP 官方仓库：https://github.com/modelcontextprotocol/modelcontextprotocol
