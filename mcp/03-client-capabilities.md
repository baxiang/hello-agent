# Client 能力

> **协议详解篇第四节。** [上一节](./02-server-capabilities.md) 小张把 Server 的三件套搭起来了，本节他撞上一堵墙——Server 自己也有"伸手要东西"的时候。
>
> **本节你将跟着小张学到**：Roots（Host 给 Server 划工作区）、Sampling（Server 反过来请 Host 调 LLM）、Elicitation（Server 通过 Host 问用户要信息），以及 Logging、Completion、Ping 这些辅助能力。
>
> **一句话比喻**：Sampling=**请外援**、Roots=**划定工作区**、Elicitation=**举手提问**。

## 1. 小张撞墙：Server 凭什么找 Host 帮忙？

小张的「代码评审助手」Server 已经跑起来了：能读 GitHub PR、能查公司数据库、能发飞书。他正得意，第二天就接连撞上三件怪事。

**怪事一**：他写了个 Tool 想自动总结 PR 改动，但 Server 进程里根本没装大模型。总不能自己塞个 OpenAI key 进去吧——key 一旦进了 Server，怎么审计？怎么计费？出了问题算谁的？

**怪事二**：他要做一个"扫描代码风格"的 Tool，但 Server 根本不知道该扫哪些目录。它手上没有"工作区"的概念。扫到 `/etc` 怎么办？扫到用户家目录里的隐私文件怎么办？

**怪事三**：发飞书之前，Server 想问一句"发到哪个群？"——可 Server 没有 UI，它甚至不知道屏幕另一头的用户是谁。

小张翻协议时才发现：**MCP 根本不是单向的"Server 暴露、Client 调用"**。Host / Client 也向 Server 暴露一组受控能力——让 Server 在需要时反过来"请外援""问边界""问用户"。这就是 Client 能力。

> 小张的顿悟：上一节是 Server 把工具递出去，这一节是 Server 把手伸回来——但**伸回来必须经过 Host 同意**。

## 2. Roots：Host 给 Server 划定工作区

小张先解决怪事二。他意识到：Server 不该自己猜能碰哪些文件，应该**由 Host 告诉它边界**。这就是 Roots——Host 声明一组"可操作根"，通常是工作区目录。

比喻：**Roots = 划定工作区**。Host 把白板上的几个目录圈给 Server 看："你就在这几个圈里干活。"

Client 在 `initialize` 时声明 `capabilities.roots`，之后 Server 就能反向请求列表：

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "roots/list",
  "params": {}
}
```

Client 返回一组 URI：

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "result": {
    "roots": [
      {
        "uri": "file:///Users/zhang/projects/code-review",
        "name": "code-review"
      },
      {
        "uri": "file:///Users/zhang/projects/shared-lib",
        "name": "shared-lib"
      }
    ]
  }
}
```

小张扫目录的 Tool 现在就只扫这两个 root，再也不会误闯 `/etc`。

但他读到这里警觉了：**Roots 是边界提示，不是通行证**。万一用户给的 root 里混进来 `../../etc/passwd` 这种路径，Server 仍然要自己校验路径穿越。协议把"提示"和"强制"分得很清楚——Roots 是前者。

工作区变了怎么办？Client 会主动推 `notifications/roots/list_changed`，Server 听到后再 `roots/list` 拉一次新列表。小张特意加了这个监听，避免用户切了项目他还扫旧目录。

设计要点：

- Root 是**提示**，Server 仍要校验路径穿越（防 `../`）。
- 别假设只有一个 root——多项目工作区很常见。
- 监听 `list_changed`，工作区切了要重新拉。
- URI 不一定是 `file://`，也可以是 git 仓库、虚拟目录等。

## 3. Sampling：Server 反向请 Host 调 LLM

回到怪事一。小张想让 Server 借大模型总结 PR，但他**坚决不把 API key 塞进 Server**——key 一旦泄漏，全公司的账单和上下文都暴露了。

正确做法是 Sampling：Server 反过来请求 Host 帮它调一次模型。比喻：**Sampling = 请外援**。Server 没有算力，去敲 Host 的门："能不能帮我跑一段提示词？我把参数给你。"

调用方法：

```json
{
  "jsonrpc": "2.0",
  "id": 10,
  "method": "sampling/createMessage",
  "params": {
    "messages": [
      {
        "role": "user",
        "content": {
          "type": "text",
          "text": "把这份 PR 的 diff 总结成三句话。"
        }
      }
    ],
    "maxTokens": 500,
    "stop_sequences": ["\n##", "<|end|>"]
  }
}
```

`maxTokens` 限制输出长度，`stop_sequences` 让 Server 指定提前终止的标记——小张用 `\n##` 防止模型在总结后继续瞎写下一节标题。

### 3.1 为什么 Sampling 必须由 Host 掌控

小张最初觉得"反正都是调模型，谁来调不一样"。带他的前辈一句话点醒他：

> Sampling 涉及**钱、隐私、意图、供应商策略**四件事。这四件都不能让 Server 自己说了算。

具体来说：

- **钱**：模型调用要花钱。该走哪个账户、哪档模型，由 Host 决定。
- **隐私**：Server 传过来的 messages 可能含敏感数据。Host 知道当前对话的隐私级别，能否发给这个模型供应商，Host 说了算。
- **意图**：用户有没有同意这次调用？Host 应该弹确认。
- **供应商策略**：公司规定某些数据只能走内网模型，模型由 Host 来选。

所以协议规定，Client 收到 `sampling/createMessage` 后可以——

- 接受请求；
- **修改或裁剪上下文**（删掉 Server 偷偷塞进去的敏感字段）；
- **选择模型**（不一定用 Server 想要的那个）；
- **要求用户确认**（弹个对话框：Server 想调模型，同意吗？）；
- **直接拒绝**。

一句话：**Server 不能偷偷调 LLM**。每一次 Sampling 都要过 Host 这道关卡。

### 3.2 Sampling 适合干什么，不适合干什么

适合：

- Server 让模型给自己的 Resource 写摘要（小张的 PR 总结就是这种）。
- Server 把数据库 schema 翻译成自然语言给用户看。
- Server 给一段日志生成可读解释。

不适合：

- Server 借 Sampling 偷偷搭一个自己的 Agent（绕过用户监督）。
- Server 请求用户的完整聊天记录（上下文越权）。
- Server 用模型处理敏感信息但**不告诉用户**。

小张最后把 PR 总结做成了 Sampling：Server 只发"PR diff + 总结指令"，Host 弹个确认框，用户点同意后才调模型。账单走 Host，上下文走 Host，Server 全程碰不到 key。

## 4. Elicitation：Server 举手向用户提问

怪事三：Server 想问"发到哪个群？"但它没有 UI，也没有对话窗口。这时该用 Elicitation——Server 通过 Host 向用户要信息。比喻：**Elicitation = 举手提问**。Server 在课堂上举手，老师（Host）把它的问题转给学生（用户）。

Elicitation 分两种模式。

### 4.1 form 模式：普通结构化提问

适合"用户选一下、填一下"这种轻交互。Server 提交一个 JSON Schema，Host 据此渲染表单。

```json
{
  "jsonrpc": "2.0",
  "id": 20,
  "method": "elicitation/create",
  "params": {
    "message": "请选择要把评审结论发到哪个群",
    "requestedSchema": {
      "type": "object",
      "properties": {
        "group": {
          "type": "string",
          "enum": ["前端组", "后端组", "全员"]
        }
      },
      "required": ["group"]
    }
  }
}
```

小张选群的 Tool 现在就走这个：Server 说"我要一个 group 字段，三选一"，Host 渲染成下拉框，用户一点，结果回传。

### 4.2 url 模式：跳出去做敏感操作

有些事不能在表单里做——OAuth 登录、支付确认、企业审批。这些要走 url 模式：Host 在新窗口打开一个网址，让用户在**可信的外部页面**完成操作。

**url 模式的红线**：以下东西**绝对不能**走表单收集——

- 密码
- API key
- OAuth token
- 银行卡号
- 其他任何凭证

原因很直接：表单数据会被 Server 拿到，等于凭证落进 Server 进程。一旦 Server 被攻陷或日志泄露，凭证就跟着泄漏。OAuth 这类流程的设计本身就是"凭证永远不经过应用"，所以必须跳外部页面完成。

Host 在显示 url 时还应该：

- 明确显示目标域名（防钓鱼）；
- 提醒用户"即将离开当前应用"；
- 不在 iframe 里偷偷嵌入。

小张后来要做"绑定 GitHub 账号"，他毫不犹豫选了 url 模式，让用户跳到 GitHub 完成授权，token 直接回到 Host，Server 永远碰不到。

## 5. 辅助能力：Logging、Completion、Ping

### 5.1 Logging：让 Server 的肚子叫出声

Server 内部发生的事（"索引建好了""缓存命中""慢查询"），Host 和用户都看不见。Logging 让 Server 把这些事上报。

Client 先设级别：

```json
{
  "jsonrpc": "2.0",
  "id": 30,
  "method": "logging/setLevel",
  "params": {
    "level": "info"
  }
}
```

Server 按级别发通知：

```json
{
  "jsonrpc": "2.0",
  "method": "notifications/message",
  "params": {
    "level": "info",
    "logger": "indexer",
    "data": "Index completed"
  }
}
```

小张把索引、缓存、慢查询都接上了 logging，Host 那边立刻能看到他 Server 的"心跳"。

但他也踩过坑：有一次 debug 时把完整 SQL（含用户邮箱）打进了日志。前辈 Review 时一眼指出——**日志里不能出现这些东西**：

- API key、token；
- 用户隐私数据；
- 完整文件内容；
- stack trace 里的敏感路径。

### 5.2 Completion：给参数配自动补全

小张的 Prompt 有个 `path` 参数，用户每次都要手敲 `src/auth.ts` 太痛苦。Completion 让 Server 给参数提供候选项：

```json
{
  "jsonrpc": "2.0",
  "id": 40,
  "method": "completion/complete",
  "params": {
    "ref": {
      "type": "ref/prompt",
      "name": "review_code"
    },
    "argument": {
      "name": "path",
      "value": "src/"
    }
  }
}
```

Server 返回候选：

```json
{
  "jsonrpc": "2.0",
  "id": 40,
  "result": {
    "completion": {
      "values": ["src/auth.ts", "src/server.ts"],
      "total": 2,
      "hasMore": false
    }
  }
}
```

但小张学乖了：补全结果是**体验，不是权限**。用户没有访问权限的文件，不该出现在补全里——否则等于变相泄露目录结构。补全也要遵守 roots 和访问控制。

### 5.3 Ping：心跳

最简单的能力，健康检查：

```json
{
  "jsonrpc": "2.0",
  "id": 50,
  "method": "ping",
  "params": {}
}
```

```json
{
  "jsonrpc": "2.0",
  "id": 50,
  "result": {}
}
```

小张的 Host 每分钟 ping 一次所有 Server，挂了立刻标红。

## 6. Client 能力设计清单

小张做 Host 设计时，前辈给了他这张表，让他一项项过：

| 能力 | 必须想清楚的几个问题 |
| --- | --- |
| Roots | 支不支持？工作区变了怎么推 `list_changed`？ |
| Sampling | 每次都要用户确认吗？模型由谁选？上下文要不要裁剪？ |
| Elicitation | form 字段怎么校验？url 模式怎么显示域名和风险？ |
| Logging | 显示在哪？要不要持久化？是否过滤敏感信息？ |
| Completion | 补全结果会不会泄露用户无权访问的路径或对象？ |
| Ping | 多久一次？超时阈值多少？ |

## 7. 本章检查点

读完这节，你应该能像小张一样说清楚：

- Roots 和文件系统权限有什么关系？（提示 vs 强制）
- Sampling 为什么必须由 Host 控制？（钱、隐私、意图、供应商）
- Elicitation 为什么不能直接收集敏感凭证？（凭证不应进 Server 进程）
- Completion 的体验价值和安全限制各是什么？
- 为什么说 MCP 是**双向能力协议**？

## 动手实验

1. **观察 roots 协商**：用支持 roots 的 Host（Claude Desktop 或 Inspector），在 `initialize` 响应里找到 `capabilities.roots`，再发 `roots/list` 看返回的工作区。试着在 Host 里切换工作区，观察 Server 是否收到 `notifications/roots/list_changed`。
2. **走通一次 Sampling**：写一个会调 `sampling/createMessage` 的 Server（比如给自己的 Resource 生成摘要），在 Host 里观察确认弹窗、上下文裁剪、模型选择。故意把 `maxTokens` 调小，看输出怎么被截断。
3. **触发 Elicitation**：写一个缺参时调 `elicitation/create` 的 Tool，让它通过表单问用户"选哪个环境"。验证 form 模式的完整闭环：Schema 提交 → 表单渲染 → 用户填写 → 结果回传。
4. **对比 form 与 url**：思考"让用户填邮箱"和"让用户完成 OAuth 登录"分别该用哪种 Elicitation 模式。写下你的判断依据（提示：参考 §4.2 的凭证红线）。再想一个反例：什么场景下"填手机号"也必须走 url 模式？

## 接下来

- [传输与安全](./04-transports-security.md) —— 这些 Client 能力的传输载体和安全边界
- [实现指南](./05-implementation-guide.md) —— 实现 Host 时如何统一管控 roots / sampling / elicitation
- [Server 能力](./02-server-capabilities.md) —— 回看 Server 侧，理解"双向协议"的另一端
