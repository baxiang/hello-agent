# Server 能力

> **协议详解篇第三节。** [上一节](./01-protocol-architecture.md) 小张把协议骨架和消息格式摸清楚了，本节跟着他给「代码评审助手」装**工具包**——结果发现：把所有能力都做成函数，AI 反而不会用了。
>
> **本节你将学到**：Resources / Prompts / Tools 三大原语的区别与选择原则、三类对象的结构与调用方法、Resource Template、订阅与变更通知、Tool 输入 schema 设计、协议错误 vs 业务错误。
>
> **一句话比喻**：Server 三件套像「**资料柜 / 模板库 / 工具箱**」——Resource 给模型读、Prompt 给用户选、Tool 给模型动手，三者各司其职。

## 小张的「全家桶」翻车现场

小张把 GitHub、公司数据库、飞书三家的 Server 跑通之后，兴奋地把所有能力一股脑做成了**函数**，对外暴露了这么一坨：

```text
get_pr_diff(owner, repo, number)        # 读 PR 改了啥
get_review_history(pr_id)               # 查公司数据库里历史评审
get_team_style_guide()                  # 读团队代码规范
run_code_review(path, focus)            # 执行审查流程
send_feishu_message(chat_id, content)   # 发结论到飞书
```

他满怀信心地让 AI 跑一次：「评审 example/api 的 PR #42」。结果 AI 当场懵圈：

- 它**先调** `send_feishu_message` 发了一条空消息——因为它以为「评审」就是发消息。
- 它**不读** `get_pr_diff`，因为没人告诉它「动手前先看资料」。
- 它**反复问**小张「focus 选 security 还是 performance?」，却不知道团队规范里就有默认答案。

小张更崩溃的是，他点开 Cursor 的界面，发现自己写的五个函数全挤在一个 `tools` 列表里——AI 看到的就是「一堆可以调用的动作」，根本分不清**哪些是给读的、哪些是给做的、哪些是给用户挑的**。

他盯着那五个函数想：能不能告诉 AI「这个是用来翻资料的、那个是用来干活的、还有个是固定流程模板」？

MCP 给的答案就是**三大原语**。本节跟着小张把它们一个个装到 Server 上。

## 1. 三大原语：先分清「谁说了算」

小张重新审视自己的五个函数，按 MCP 的视角重新归类：

| 小张的能力 | 该做成什么 | 为什么 |
| --- | --- | --- |
| PR diff、历史评审、团队规范 | **Resource**（资料柜） | 内容是给 AI 看的「上下文资料」，AI 读了才能干活 |
| 代码审查的固定流程模板 | **Prompt**（模板库） | 是给**用户主动选**的入口：「我要走一遍安全审查」 |
| 发飞书消息、执行测试 | **Tool**（工具箱） | 是要**动手执行**的动作，AI 自己决定何时调 |

最关键的一点：**这三类原语，发起方不同**。小张一开始没意识到这点，是翻车的根因。

```text
谁主导？
  Resource → application-driven   （Host 决定何时把资料塞给模型）
  Prompt   → user-controlled      （用户从菜单里主动挑）
  Tool     → model-controlled     （模型根据上下文自己决定要不要调）
```

- **Resource 是 application-driven（应用主导）**：Host 决定要不要把某个资源塞进上下文。比如小张的助手每次评审前，Host 自动把团队规范 `team://style-guide` 读进 system message——用户和模型都不用关心。
- **Prompt 是 user-controlled（用户主导）**：Prompt 出现在用户菜单里，由用户点一下「我要走这个流程」。模型不能擅自调起一个 Prompt。
- **Tool 是 model-controlled（模型主导）**：模型在对话里根据需要自己决定调不调、何时调、传什么参数。

选型判断三条问：结果是上下文吗 → Resource；是用户主动触发的固定流程吗 → Prompt；会产生副作用吗 → Tool（高风险加确认）。带着这三条，小张开始一个个装。

## 2. Resources：给 AI 用的「资料柜」

小张把 `get_pr_diff`、`get_review_history`、`get_team_style_guide` 三个函数全部改造成 Resource。它们都是「拿过来给 AI 翻一翻」的资料——读 PR、读历史、读规范，没有副作用。

### 2.1 Resource 长什么样

一个 Resource 至少要有 `uri`、`name`，再加 `description` 和 `mimeType` 帮助理解：

```json
{
  "uri": "file:///workspace/README.md",
  "name": "README.md",
  "description": "Project overview",
  "mimeType": "text/markdown"
}
```

字段含义：

- `uri`：资源唯一标识，Client 拿它去读。
- `name`：给用户看的名字。
- `description`：帮助判断「这资料值不值得读」。
- `mimeType`：内容类型，影响 Host 渲染和模型处理。

### 2.2 resources/list：列出所有资料

小张的助手启动时，先调一次 `resources/list`，看看资料柜里有什么：

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "resources/list",
  "params": {}
}
```

Server 把 GitHub、公司数据库里能读的资料列出来：

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "result": {
    "resources": [
      {
        "uri": "github://repos/example/api/pulls/42",
        "name": "PR #42 diff",
        "description": "Latest diff of pull request #42",
        "mimeType": "text/plain"
      },
      {
        "uri": "db://reviews/pr-42",
        "name": "Review history of PR #42",
        "description": "Past review comments on this PR",
        "mimeType": "application/json"
      }
    ]
  }
}
```

资源多的时候用**分页 cursor** 翻页：第一次响应里带 `nextCursor`，下次请求把它作为 `cursor` 参数传进去，直到返回里没有 `nextCursor` 为止。

### 2.3 resources/read：读取一份资料

小张的 Host 决定把团队规范读进上下文（application-driven 的体现），发起一次读：

```json
{
  "jsonrpc": "2.0",
  "id": 2,
  "method": "resources/read",
  "params": {
    "uri": "db://reviews/pr-42"
  }
}
```

响应可以是文本，也可以是二进制（base64）：

```json
{
  "jsonrpc": "2.0",
  "id": 2,
  "result": {
    "contents": [
      {
        "uri": "db://reviews/pr-42",
        "mimeType": "application/json",
        "text": "{\"reviews\": [...] }"
      }
    ]
  }
}
```

注意 `contents` 是个数组——一个 URI 可以返回多段内容，比如一个目录资源返回多个文件。

### 2.4 Resource Template：动态拼出来的 URI

小张很快发现一个问题：`github://repos/example/api/pulls/42` 这个 URI 是写死的，可每个 PR 编号都不一样。难道每个 PR 都要预先在 `resources/list` 里列出来？那列表会爆炸。

这种「带参数的资源」要用 **Resource Template** 表达：

```json
{
  "uriTemplate": "github://repos/{owner}/{repo}/pulls/{number}",
  "name": "GitHub PR",
  "description": "Read one pull request by owner, repo, and number",
  "mimeType": "text/plain"
}
```

`{owner}`、`{repo}`、`{number}` 是 URI Template（RFC 6570）占位符。Client 通过 `resources/templates/list` 拿到模板列表，需要时拼一个具体 URI 去 `resources/read`：

```text
模板:  github://repos/{owner}/{repo}/pulls/{number}
填值:  owner=example, repo=api, number=42
拼出:  github://repos/example/api/pulls/42
```

小张用这套模板，无论评审第几号 PR 都不用改 Server——把模板参数化，剩下的交给 Client 拼。

### 2.5 订阅：资料变了通知我

PR 是会变的——有人 push 新 commit，diff 就变了。小张希望助手能感知到这种变化，而不是一直读旧数据。

如果 Server 支持 `resources/subscribe`，Client 可以订阅某个 URI：

```json
{
  "jsonrpc": "2.0",
  "id": 3,
  "method": "resources/subscribe",
  "params": {
    "uri": "github://repos/example/api/pulls/42"
  }
}
```

之后 PR 一更新，Server 主动推一条通知：

```json
{
  "jsonrpc": "2.0",
  "method": "notifications/resources/updated",
  "params": {
    "uri": "github://repos/example/api/pulls/42"
  }
}
```

Client 收到通知后再去 `resources/read` 拿最新内容。不想听了就 `resources/unsubscribe`。

如果资源列表本身变了（比如仓库里新增了一个 PR 可读），Server 会推：

```json
{
  "jsonrpc": "2.0",
  "method": "notifications/resources/list_changed"
}
```

提醒 Client 重新 `resources/list` 一次。

到这一步，小张的「资料柜」就齐活了：能列、能读、能模板化、能订阅更新。AI 翻资料的问题解决了。

## 3. Prompts：给用户挑的「模板库」

资料能读了，但小张还有个头疼事：每次评审他都重复说一遍「请重点看安全、命名规范、有没有越权访问」——这套话术是固定的。他不想每次都手敲，希望做成一个**可复用的流程入口**。

这正是 Prompt 的用武之地。注意它和 Tool 的区别：**Prompt 是给用户从菜单里点的**，不是模型自己调的。

### 3.1 Prompt 对象

小张把团队的代码审查流程固化成一个 Prompt：

```json
{
  "name": "review_pr",
  "description": "Review a PR with team's standard checklist (security, naming, auth)",
  "arguments": [
    {
      "name": "pr_url",
      "description": "Full URL of the pull request",
      "required": true
    },
    {
      "name": "focus",
      "description": "Additional focus area, e.g. 'performance'",
      "required": false
    }
  ]
}
```

关键点：

- `arguments` 是用户填的参数，不是模型填的。
- Prompt 的输出是**一组 messages**，会插入到对话里，相当于用户「点了菜单后系统替他说了一段话」。

### 3.2 prompts/list：用户能看到哪些模板

Host 在 UI 里展示一个「模板菜单」时，调 `prompts/list`：

```json
{
  "jsonrpc": "2.0",
  "id": 10,
  "method": "prompts/list",
  "params": {}
}
```

Server 把所有可用的流程模板返回，小张的助手可能有两个：`review_pr`（标准评审）、`triage_issues`（issue 分类）。

### 3.3 prompts/get：拿到展开后的提示词

用户在菜单里点了 `review_pr`，填上参数，Host 调 `prompts/get` 把模板展开：

```json
{
  "jsonrpc": "2.0",
  "id": 11,
  "method": "prompts/get",
  "params": {
    "name": "review_pr",
    "arguments": {
      "pr_url": "github://repos/example/api/pulls/42",
      "focus": "performance"
    }
  }
}
```

Server 把模板填好返回：

```json
{
  "jsonrpc": "2.0",
  "id": 11,
  "result": {
    "description": "Review PR with team checklist",
    "messages": [
      {
        "role": "user",
        "content": {
          "type": "text",
          "text": "Review the PR at github://repos/example/api/pulls/42. Apply the team checklist: security, naming, auth scope. Extra focus: performance."
        }
      }
    ]
  }
}
```

这条 message 会作为新一轮对话的开头送给模型——模型看到的就是「用户让我按团队清单评审这个 PR」，但它并不知道这是从一个模板展开的。

### 3.4 Prompt 设计三条线

小张踩过几个坑后总结：

- **Prompt 表达的是用户意图，不要偷偷执行动作。** 它产出 messages，不应该有副作用。需要执行的事交给 Tool。
- **参数要少而明确。** 用户不是来填表的，能省则省。
- **Prompt 可以引用 Resource。** 比如模板里写「读 `db://reviews/pr-42` 作为参考」，但不要在模板里强行读取用户没授权的内容。

到这一步，用户挑模板的入口搭好了。

## 4. Tools：给模型用的「工具箱」

最后一类：真正要**动手执行**的动作。小张的 `send_feishu_message` 必须做成 Tool——它有副作用、对外发消息，必须由模型在「评审完成、结论出来」之后自己决定何时调用（model-controlled）。

Tool 是三类原语里**最强也最危险**的：它能改世界。所以这一节要重点讲安全。

### 4.1 Tool 对象

```json
{
  "name": "send_feishu_message",
  "description": "Send a text message to a Feishu group chat",
  "inputSchema": {
    "type": "object",
    "properties": {
      "chat_id": {
        "type": "string",
        "description": "Target Feishu group chat ID"
      },
      "content": {
        "type": "string",
        "description": "Message body in plain text"
      }
    },
    "required": ["chat_id", "content"]
  }
}
```

关键字段是 `inputSchema`——它是一份 JSON Schema，告诉模型「调用这个工具时要传什么」。模型完全靠 schema 来决定怎么填参数，schema 写得烂，模型就乱填。

### 4.2 tools/list：模型能看到哪些工具

Host 在初始化后调一次 `tools/list`，把结果交给模型当上下文：

```json
{
  "jsonrpc": "2.0",
  "id": 20,
  "method": "tools/list",
  "params": {}
}
```

Server 返回所有可调工具的清单。小张的助手现在只有两个 Tool：`send_feishu_message`、`create_review_comment`（给 PR 打评论）。读 PR 这种事已经挪到 Resource 了，列表清爽很多。

### 4.3 tools/call：模型决定动手了

模型在对话里推理出「该发飞书了」，就会发起一次调用：

```json
{
  "jsonrpc": "2.0",
  "id": 21,
  "method": "tools/call",
  "params": {
    "name": "send_feishu_message",
    "arguments": {
      "chat_id": "oc_xxx_review_group",
      "content": "PR #42 评审通过，无阻塞问题。"
    }
  }
}
```

正常返回：

```json
{
  "jsonrpc": "2.0",
  "id": 21,
  "result": {
    "content": [
      {
        "type": "text",
        "text": "Message sent to chat oc_xxx_review_group."
      }
    ],
    "isError": false
  }
}
```

注意返回里有个 `isError` 字段——这是区分「调用失败」和「业务失败」的关键，下一节展开。

### 4.4 两类错误：协议层 vs 业务层

小张一开始把所有错误都抛成 JSON-RPC error，结果模型经常困惑：到底是参数填错了，还是飞书服务挂了？MCP 把错误分成两类，**模型要分别对待**。

**协议错误**：请求本身就不合法——方法不存在、参数缺、schema 校验失败。这种用标准 JSON-RPC error 返回：

```json
{
  "jsonrpc": "2.0",
  "id": 21,
  "error": {
    "code": -32602,
    "message": "Missing required argument: chat_id"
  }
}
```

模型看到这种错误，应该**修正参数重试**。

**工具执行错误**：请求合法、Tool 也被正常调用了，但业务执行失败——飞书 token 过期、群不存在、网络超时。这种用 `isError: true` 返回，错误信息放在 `content` 里：

```json
{
  "jsonrpc": "2.0",
  "id": 21,
  "result": {
    "content": [
      {
        "type": "text",
        "text": "Feishu API returned 401: access token expired."
      }
    ],
    "isError": true
  }
}
```

模型看到 `isError: true`，应该**告诉用户、可能请求新凭证**，而不是傻乎乎重试。

小张给自己定了三条规矩：

- 协议层错误（参数/schema 问题）→ JSON-RPC error。
- 业务层错误（执行失败）→ `isError: true` + 友好文案。
- **绝不把 stack trace 直接吐给模型**——那只会污染上下文。

## 5. Tool 输入 schema 设计：写得好模型才不乱填

Tool 的 `inputSchema` 是模型能不能正确调用的关键。小张被坑过一次后，专门花了一节研究怎么写。

**差的 schema**（模型会乱猜）：

```json
{
  "type": "object",
  "properties": {
    "data": {
      "type": "object"
    }
  }
}
```

`data` 是啥？模型完全不知道该填什么，只能瞎编。

**好的 schema**（模型一看就懂）：

```json
{
  "type": "object",
  "properties": {
    "path": {
      "type": "string",
      "description": "Relative path inside the allowed workspace root."
    },
    "maxBytes": {
      "type": "integer",
      "description": "Maximum number of bytes to read.",
      "minimum": 1,
      "maximum": 100000
    }
  },
  "required": ["path"],
  "additionalProperties": false
}
```

小张总结的设计原则：

- **字段名直白。** `path` 比 `data` 好，`chat_id` 比 `target` 好。
- **description 写业务含义。** 不是「the path」，而是「Relative path inside the allowed workspace root」。
- **用 `enum` 限制可选值。** 比如 focus 只能是 `security | performance | readability`。
- **用 `minimum` / `maximum` 圈住数字范围。** 别让模型传个 `maxBytes: 9999999999` 把内存吃光。
- **`additionalProperties: false` 拒绝多余字段。** 模型瞎加字段不该被默认接受。
- **对路径、URL、SQL 等危险输入做二次校验。** schema 只挡类型，挡不住 `../../etc/passwd` 路径穿越。

写 Tool schema 像写一份给新人的交接文档——你不说清楚，他就自己脑补。

## 6. 方法清单：一张表收齐

到这里小张已经把三类原语都装上了。整理成一张速查表：

| 领域 | 方法/通知 | 方向 | 用途 |
| --- | --- | --- | --- |
| Resources | `resources/list` | Client → Server | 列资源（支持 cursor 分页） |
| Resources | `resources/read` | Client → Server | 读一份资源 |
| Resources | `resources/templates/list` | Client → Server | 列资源模板 |
| Resources | `resources/subscribe` | Client → Server | 订阅资源变化 |
| Resources | `resources/unsubscribe` | Client → Server | 取消订阅 |
| Resources | `notifications/resources/updated` | Server → Client | 某资源内容更新了 |
| Resources | `notifications/resources/list_changed` | Server → Client | 资源列表变了，重新 list |
| Prompts | `prompts/list` | Client → Server | 列提示词模板 |
| Prompts | `prompts/get` | Client → Server | 展开一个模板成 messages |
| Prompts | `notifications/prompts/list_changed` | Server → Client | 模板列表变了 |
| Tools | `tools/list` | Client → Server | 列工具 |
| Tools | `tools/call` | Client → Server | 调用一个工具 |
| Tools | `notifications/tools/list_changed` | Server → Client | 工具列表变了 |

规律一眼可见：每类原语都是 `list` + 一个核心动作（`read` / `get` / `call`）+ 一个 `list_changed` 通知。Resources 多了 `templates/list` 和订阅相关的一组方法，因为它要处理动态 URI 和实时变化。

## 7. 实战建模：把整个评审助手拆开

回到小张最初的需求。把他的代码评审助手完整建模一遍：

| 小张的能力 | MCP 类型 | 主导方 | 示例 |
| --- | --- | --- | --- |
| PR 的 diff 内容 | Resource | application-driven | `github://repos/{owner}/{repo}/pulls/{number}` |
| 历史评审记录 | Resource | application-driven | `db://reviews/pr-{number}` |
| 团队代码规范 | Resource | application-driven | `team://style-guide` |
| 标准代码审查流程 | Prompt | user-controlled | `review_pr(pr_url, focus)` |
| Issue 分类流程 | Prompt | user-controlled | `triage_issues(repo)` |
| 发飞书群消息 | Tool | model-controlled | `send_feishu_message(chat_id, content)` |
| 给 PR 打评审评论 | Tool | model-controlled | `create_review_comment(pr_url, comment)` |

对比小张最初的「五个函数挤一坨」，现在跑起来的流程是：Host 启动时把团队规范作为 Resource 读进上下文 → 用户点 `review_pr` 模板填 PR URL → 模型推理时 `resources/read` 拉 PR diff → 评审完自己调 `send_feishu_message` 发结论。每个能力都有清晰角色。

小张标出的几条**高风险边界**：

- `send_feishu_message` 和 `create_review_comment` 有外部副作用，Host 应在调 Tool 前向用户**弹确认**（这是 Host 的责任，不是 Server 的）。
- PR diff Resource 要限制在授权仓库范围内，不能让模型随手读私有仓库。
- `create_review_comment` 的 schema 要校验评论长度和格式，防止模型刷屏。

## 8. 本章检查点

读完本章，你应该能回答：

- 一个能力什么时候做成 Resource、什么时候做成 Prompt、什么时候做成 Tool？
- Resources / Prompts / Tools 分别由谁主导（application / user / model）？
- 写出一个带 JSON Schema 的 Tool 定义。
- Resource Template 解决什么问题？什么时候用它而不是预先 `resources/list`？
- 协议错误（JSON-RPC error）和工具业务错误（`isError: true`）怎么区分？模型该怎么分别应对？
- 列出三类原语各自的核心方法名。

## 动手实验

1. **三类原语都跑通**：用 [入门篇 02](./getting-started/02-primitives-tour.md) 的 demo Server，在 Inspector 里分别调 `resources/list` + `resources/read`、`prompts/list` + `prompts/get`、`tools/list` + `tools/call`，对照本章字段表看清每个响应结构。重点观察 Resource 的 `contents` 数组、Prompt 的 `messages` 数组、Tool 的 `isError` 字段。
2. **Resource Template 实战**：给你的 Server 加一个 `file:///{path}` 风格的 Resource Template，调 `resources/templates/list` 看到模板，再用模板拼一个真实 URI 去 `resources/read`。体会「URI 是填出来的、不是写死的」。
3. **构造两类错误**：分别触发一次「缺必填参数」（应得到 JSON-RPC error，code 类似 `-32602`）和「Tool 业务失败」（应得到 `result.isError: true`），对比 §4.4 的两种形态。观察模型对两种错误的反应有何不同。
4. **订阅一次资源变化**：写一个会定期更新内容的 Resource（比如每隔 5 秒改一次文本），用 `resources/subscribe` 订阅它，修改内容后观察 `notifications/resources/updated` 是否到达；再触发一次列表变化看 `notifications/resources/list_changed`。

## 接下来

- [Client 能力](./03-client-capabilities.md) —— 球到 Server 这边还不够，Server 有时也要反过来向 Client 请求：Roots（工作目录在哪）、Sampling（让 Client 帮忙跑一次 LLM）、Elicitation（让 Client 弹窗问用户）。
- [传输与安全](./04-transports-security.md) —— 这些能力在 stdio 和 HTTP 两种传输下分别怎么跑、Token 和权限怎么管。
- [实现指南](./05-implementation-guide.md) —— 把本章的三类原语落成一个完整可跑的 Server。
