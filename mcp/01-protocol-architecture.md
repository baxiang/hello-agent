# 协议架构

> **协议详解篇第二节。** [上一节](./00-mcp-from-zero.md) 小张拿到了协议全景地图，本节把镜头拉近，跟他一起拆开 MCP 的**协议骨架**——谁和谁通信、消息怎么编码、会话怎么建立、能力怎么协商。
>
> **本节你将学到**：Host/Client/Server 三角架构、协议五层划分、JSON-RPC 2.0 三种消息、初始化握手与能力协商、分页与进度通知、方法命名规律。
>
> **一句话比喻**：上一节是「**地图**」，本节是「**底盘拆解**」——把 MCP 这辆车架起来，看清每颗螺丝怎么受力。

## 小张遇到的第一个坎

小张入职第三天，老板甩来一个需求：**做一个代码评审助手**——能读 GitHub 上的 PR、查公司数据库里的历史评审记录、最后把结论发到飞书群里。

他自信满满地打开 Cursor，准备让 AI 直接干活。第一关就懵了：

- 调 GitHub API，返回的是 REST JSON，字段叫 `pull_request`。
- 调公司内部的数据库服务，返回的是另一种 JSON，字段叫 `pr`。
- 飞书的 Webhook 又是另一套协议，错误码风格完全不同。

更要命的是**错误处理**。GitHub 返回 `404 Not Found` 时是个 HTML 页面，公司服务返回的是一个嵌套六层的 JSON，飞书干脆只给个 `-1`。小张发现自己不是在写「评审助手」，而是在写**三家公司的协议翻译层**。

他盯着屏幕想：难道每接一个新工具，就得把这套胶水代码重写一遍？

他需要的不是更聪明的 AI，而是一种**通用语言**——让 AI 应用和所有工具说同一种话。这就是 MCP 要解决的问题。本节跟随小张，把这套语言的语法拆开。

## 1. Host、Client、Server：三角关系先理清

在动手之前，小张得先搞清楚一件事：**到底谁在和谁说话？**

MCP 里三个角色要分清：

```text
User (小张)
  |
  v
MCP Host (Cursor / 自己写的 Agent 应用)
  |
  +-- MCP Client A <---- session/transport ----> MCP Server A (GitHub)
  |
  +-- MCP Client B <---- session/transport ----> MCP Server B (公司数据库)
  |
  +-- MCP Client C <---- session/transport ----> MCP Server C (飞书)
```

小张一开始以为「Host 和 Client 是同一个东西」，踩坑之后才明白：

- **Host** 是用户真正在用的 AI 应用。小张的 Cursor、或者他自己写的 Agent 程序，都是 Host。
- **Client** 是 Host 内部的「协议连接器」。每接一个 Server，Host 就生一个 Client 实例出来专门伺候它。
- **Server** 是外部能力的提供者。GitHub Server 暴露读 PR 的能力，飞书 Server 暴露发消息的能力。

**一条铁律**：一个 Client 通常只对应一个 Server（**1:1**）。小张的 Host 里同时跑三个 Client，每个 Client 只跟自己那个 Server 说话。

这样设计的好处很直接：**Server 之间天然隔离**。GitHub Server 拿不到飞书 Server 的结果，也碰不到用户的对话历史和凭证。小张不用担心一个写得不小心的 Server 把整段对话泄露出去。

## 2. 协议五层：别把所有东西混进一锅粥

小张准备开干，却发现文档里同时出现 `stdio`、`tools/call`、`capabilities`、`JSON-RPC` 几个词，分不清谁是谁。其实 MCP 可以拆成五层来理解：

| 层级 | 负责什么 | 示例 |
| --- | --- | --- |
| Application | AI 应用如何使用上下文和工具 | IDE、聊天应用、Agent 平台 |
| Capability | 双方声明能做什么 | `tools`、`resources`、`sampling` |
| Method | 具体协议操作 | `tools/list`、`resources/read` |
| Message | JSON-RPC 请求、响应、通知 | `id`、`method`、`params` |
| Transport | 字节如何传输 | stdio、Streamable HTTP |

小张一开始最容易犯的错就是把这几件事混在一起：

- `tools/call` 是 **Method**，不是 Transport。
- `stdio` 是 **Transport**，它不决定你能调用哪些 Tool。
- Tool 的输入 schema 属于 **Capability** 里的业务描述，跟 JSON-RPC 本身没关系。

分层之后再看文档，每个词归哪一层一目了然。下面先从最底层的 **Message** 开始拆。

## 3. JSON-RPC 2.0：一种像「点外卖」的协议

小张要给所有工具定一种共同语言。他翻了一圈，发现 MCP 选了 **JSON-RPC 2.0**。说白了就是「点外卖协议」：

- **Request（下单）**：你点一份「鱼香肉丝」，附上订单号（`id`），等店家出餐。
- **Response（出餐）**：店家按订单号把菜端回来。要么是菜（`result`），要么是「卖光了」的说明（`error`）。
- **Notification（通知）**：店家通过 APP 推送「骑手已取餐」——你只需要知道，不需要回他「收到」。

只有三种消息形态，小张松了口气——再不用记每家 API 的十几种状态码了。

### Request：下单

Request 表示「我请求你做某件事，并且**需要**响应」。

```json
{
  "jsonrpc": "2.0",
  "id": 10,
  "method": "tools/list",
  "params": {
    "cursor": "next-page-token"
  }
}
```

小张学到几条硬规则：

- `jsonrpc` 永远是 `"2.0"`，相当于告诉对方「我说的是哪一版黑话」。
- `id` 是订单号，用来**匹配**响应。不能是 `null`，否则对方回了你也对不上号。
- `method` 是「鱼香肉丝」——你想点的菜名。
- `params` 是「少放辣、不要葱」——附加要求，一般是个对象。

### Response：出餐

成功响应：

```json
{
  "jsonrpc": "2.0",
  "id": 10,
  "result": {
    "tools": []
  }
}
```

注意 `id` 跟请求里的 `id` 完全一致——这就是订单号匹配。小张发出去 10 个请求，靠 `id` 把响应一一对应回去，**并发**就这么自然支持了。

失败响应：

```json
{
  "jsonrpc": "2.0",
  "id": 10,
  "error": {
    "code": -32602,
    "message": "Invalid params",
    "data": {
      "field": "name"
    }
  }
}
```

小张之前最讨厌的就是各家错误格式不同。JSON-RPC 把错误统一成 `code + message + data`：

- `message` 给人和模型都能读懂。
- `data` 放结构化细节，比如哪个字段错了。
- 参数错误要指出字段和期望类型。
- 权限错误要说明**需要什么授权**，但绝不泄露凭证本身。

### Notification：通知

Notification 表示「告诉你一件事，**不需要**响应」。

```json
{
  "jsonrpc": "2.0",
  "method": "notifications/initialized"
}
```

小张一眼就看出区别：**通知没有 `id`**。没有订单号，对方自然不会回你。Server 进度推送、列表变更提醒，都走这一类。

::: tip 三种消息怎么快速区分
小张总结的口诀：**有 `id` 又有 `method` → Request；有 `id` 又有 `result`/`error` → Response；只有 `method` 没 `id` → Notification。**
:::

## 4. 初始化握手：见面先互报家门

会说话了，但能直接调 `tools/list` 吗？小张试了一下，Server 直接报错——**还没握手呢**。

MCP 会话有清晰的阶段：

```text
Client 启动 transport
  |
  v
initialize request
  |
  v
initialize response
  |
  v
notifications/initialized
  |
  v
正常操作阶段
  |
  v
shutdown / transport 关闭
```

这套流程可以类比「**两个陌生人见面**」：你不会一上来就问对方借钱，肯定先互通姓名、谈妥底线，再开始办事。

### 第一步：initialize ——「你好，我叫……」

Client 先发 `initialize`，把自己的身份和能耐摆出来：

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
      "name": "my-host",
      "version": "0.1.0"
    }
  }
}
```

小张第一次看这段参数时一脸懵，后来逐字段翻译给自己听：

- `protocolVersion`：「我说的是 **2025-11-25** 版的 MCP，你听得懂吗？」
- `capabilities`：「我这边能给你提供 `roots`、`sampling`、`elicitation` 这些反向能力。」
- `clientInfo`：「我叫 `my-host`，版本 `0.1.0`。」

### 第二步：Server 回应——「你好，我叫……」

Server 收到后回一份对称的回应：

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "result": {
    "protocolVersion": "2025-11-25",
    "capabilities": {
      "tools": {
        "listChanged": true
      },
      "resources": {
        "subscribe": true,
        "listChanged": true
      },
      "prompts": {
        "listChanged": true
      },
      "logging": {}
    },
    "serverInfo": {
      "name": "filesystem-server",
      "version": "1.0.0"
    }
  }
}
```

小张对比一下两边：

- **协议版本必须对得上**。Server 可以返回一个**自己支持的最高版本**作为最终协商结果。
- 双方各自声明 `capabilities`——这是后面能不能调某些方法的关键。

### 第三步：initialized notification——「好，开聊」

Client 收到响应后，再补一条**通知**：

```json
{
  "jsonrpc": "2.0",
  "method": "notifications/initialized"
}
```

注意这是 Notification，**没有 `id`**。它就一句潜台词：「**握手完成，可以正式干活了**」。

为什么设计成两步（响应 + 通知）？小张后来才想明白：响应只能确认「我收到你的提议」，而通知表示「**我也准备好了**」。少了这一步，Server 可能在 Client 还没就绪时就开始推消息过来。

### 第四步：正常操作

握手之后，下面这些方法才能开始调用：

- `tools/list`、`tools/call`
- `resources/list`、`resources/read`、`resources/templates/list`、`resources/subscribe`
- `prompts/list`、`prompts/get`
- `completion/complete`
- `logging/setLevel`

小张的总结：**没有 initialize，就没有后面的一切**。

## 5. 能力协商：签合同前先谈条款

小张写完握手代码，兴冲冲地调了一个 `tools/list`，结果 Server 直接返回 `Method not found`。一查才发现：这个 Server 压根没声明 `tools` 能力。

这就是**能力协商**的意义——**双方必须先声明自己能做什么，没声明的能力就不能用**。就像签合同前先把条款谈清楚：你不肯提供发票，我就别指望报销。

### Server 能力：Server 能给什么

| 能力 | 说明 |
| --- | --- |
| `tools` | Server 暴露可调用工具 |
| `resources` | Server 暴露可读取资源 |
| `prompts` | Server 暴露提示词模板 |
| `logging` | Server 可发送日志 |
| `completions` | Server 支持参数补全 |

### Client 能力：Client 反向能给什么

| 能力 | 说明 |
| --- | --- |
| `roots` | Client 提供可访问边界 |
| `sampling` | Client 允许 Server 请求模型采样 |
| `elicitation` | Client 允许 Server 向用户请求输入 |

### 不协商就翻车

小张踩过的坑：

- Server 不支持 `tools`，Client 就**不应该**调 `tools/list`——会直接报错。
- Client 不支持 `sampling`，Server 就**不应该**反过来请求模型生成——会卡住。
- Server 声明了 `listChanged: true`，Client 才能期待列表变更通知；没声明就别等。

好处显而易见：**每一边都可以放心地只实现自己关心的部分**。小张的飞书 Server 完全可以不实现 `resources`，Client 也不会去骚扰它。

## 6. 分页：当结果太多时

小张连上 GitHub Server，调 `resources/list` 想列出所有可读的 PR——结果一口气返回了两千条，Cursor 直接卡死。

正确做法是**分页**。MCP 用 `cursor` 这种不透明 token 实现分页。

请求第二页：

```json
{
  "jsonrpc": "2.0",
  "id": 20,
  "method": "resources/list",
  "params": {
    "cursor": "page-2"
  }
}
```

响应里带上**下一页的游标**：

```json
{
  "jsonrpc": "2.0",
  "id": 20,
  "result": {
    "resources": [],
    "nextCursor": "page-3"
  }
}
```

小张给自己总结了几条纪律：**不要一次返回几千条**（模型上下文塞不下）；`cursor` 是 Server 自认的不透明 token，Client 别试图解析；`cursor` 里**不要塞敏感信息**——它可能会被打印到日志里。

## 7. 进度通知：让长任务不再「黑屏」

小张写了个 `index_repository` 工具，要给一个大型仓库建索引。一调用，Cursor 就转圈圈——他不知道是死掉了，还是真在跑，只能干等。

长任务需要进度反馈。MCP 的做法是：Client 调用时塞一个 `progressToken`，Server 用 `notifications/progress` 回报进度。

请求里带上 token：

```json
{
  "jsonrpc": "2.0",
  "id": 30,
  "method": "tools/call",
  "params": {
    "_meta": {
      "progressToken": "progress-001"
    },
    "name": "index_repository",
    "arguments": {
      "path": "/workspace"
    }
  }
}
```

Server 在执行过程中持续推送进度：

```json
{
  "jsonrpc": "2.0",
  "method": "notifications/progress",
  "params": {
    "progressToken": "progress-001",
    "progress": 35,
    "total": 100,
    "message": "Indexed 350 of 1000 files"
  }
}
```

小张注意到两件事：进度用 **Notification** 推送，**没有 `id`**——它是对原请求的「旁白」，不是响应；而 `progressToken` 必须跟原请求里的对得上，Client 才知道这条进度归属哪一次调用。

加上进度之后，UI 终于能显示个进度条，用户体验直线上升。

## 8. 版本兼容：协议会演进

小张的代码跑得好好的，某天升级 Server 后突然握手失败。一查是协议版本对不上了。

MCP 在演进，`protocolVersion` 不是装饰。实现时必须处理这几种情况：Client 请求的版本**高于** Server 支持的版本；Server 返回一个**不同但兼容**的版本；某个能力在旧版本里根本不存在；新字段出现时，旧实现**应忽略未知字段**，而不是报错。

小张给自己定的保守策略：文档里明确记录支持的协议版本；初始化失败时返回**清晰的错误**，告诉对方是版本不兼容；**不要**根据 Server 名字猜它的行为；**不要**依赖未声明的能力——哪怕你「知道」它支持。

## 9. 方法命名规律：一看就知道是哪家的

小张看了一堆方法名后，总结出规律：

```text
<domain>/<operation>
```

例如：

- `tools/list`、`tools/call`
- `resources/read`
- `prompts/get`
- `sampling/createMessage`

通知则是：

```text
notifications/<event>
```

例如：

- `notifications/initialized`
- `notifications/progress`
- `notifications/resources/list_changed`

这条规律帮小张快速读懂了规范——看到 `tools/call` 就知道是 Tool 域的 call 操作，看到 `notifications/progress` 就知道是进度事件。但**真要写代码时，仍要以官方 schema 为准**，规律只是导航。

## 动手实验

1. **抓一次完整握手**：用 Inspector 连任意 Server，从日志里找出 `initialize` 请求、`initialize` 响应、`notifications/initialized` 三条消息，对照第 4 节逐字段标注「这一步在协商什么」。
2. **构造能力缺失场景**：写一个只声明 `tools` 能力的 Server，故意调用 `resources/list`，观察 Server 返回什么错误，亲身验证能力协商的作用。
3. **对比三种消息**：在抓到的报文里各挑一条 Request、Response、Notification，标出哪条有 `id`、哪条没有，验证第 3 节的规则。
4. **触发一次进度通知**：写一个会 `sleep` 的长任务 Tool，调用时带上 `_meta.progressToken`，观察 `notifications/progress` 是否按预期到达。

## 接下来

- [Server 能力](./02-server-capabilities.md) —— Resources / Prompts / Tools 三原语的字段、方法与设计取舍，小张继续往下搭 GitHub Server。
- [Client 能力](./03-client-capabilities.md) —— Roots / Sampling / Elicitation 等反向能力。
- [传输与安全](./04-transports-security.md) —— stdio 与 Streamable HTTP 的部署与安全。
