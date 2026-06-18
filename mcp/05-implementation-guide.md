# 实现指南

> **协议详解篇最后一节。** [协议架构](./01-protocol-architecture.md)、[Server 能力](./02-server-capabilities.md)、[Client 能力](./03-client-capabilities.md)、[传输与安全](./04-transports-security.md) 都讲完了，本节把它们串成一条**从 0 到 1 的实现路线**。
>
> **本节你将学到**：Server 设计说明怎么写、最小方法集、Tool 命名与 description、输入 schema 约束、错误分层策略、测试矩阵、发布清单、Host 集成要点。
>
> **一句话比喻**：前面几节是「**零件图**」，本节是「**装配手册**」——照着走，能拼出一台能跑、安全、可维护的 MCP Server。

---

周五晚上九点，飞书机器人第一次成功把代码评审结论推到群里。小张盯着屏幕看了三秒，长舒一口气——过去五天，他从接需求、选三原语、踩传输坑、补安全洞，一路跌跌撞撞到上线。

下周一他要做项目复盘。打开文档，他想：「**要是有人在我开工前塞给我一份清单，我至少少走一半弯路**。」于是他没有写流水账，而是把所有教训整理成一份《给后来人的实战指南》：怎么设计、怎么建模、怎么测、怎么发。这份复盘文档，就是本篇实现指南。

> 小张的故事从这里开始。下面每一节，他都先讲一个自己踩过的坑，再给出对应的实现规则。

## 1. 先写 Server 设计说明

**小张的坑**：第一天接到需求——「代码评审助手：读 GitHub PR、查公司数据库、发结论到飞书」——他没多想，直接 `npm init` 开干。结果写到一半发现：飞书这条 Tool 到底要不要带副作用？数据库只读还是可写？文档查得到吗？一连串问题让代码改了又改。

**复盘后的规则**：写代码前，先回答这八个问题。

1. Server 的唯一职责是什么？
2. 面向谁使用？
3. 连接什么外部系统？
4. 默认只读还是可写？
5. 需要 Resources、Prompts、Tools 中哪些能力？
6. 哪些操作有副作用？
7. 哪些数据不能进入模型上下文？
8. 错误如何让模型或用户修正？

小张给自己的代码评审助手写了这么一份：

```text
Server: code-review-assistant
职责: 读取 GitHub PR、查询缺陷数据库、把评审结论发飞书
能力:
  - Tool: read_pr(repo, pr_number)
  - Tool: query_defects(component, severity)
  - Tool: send_lark(message, chat_id)
  - Resource: github://pr/{repo}/{number}
  - Prompt: review_pr(repo, pr_number)
权限:
  - read_pr / query_defects: 只读
  - send_lark: 副作用，必须用户确认
  - 数据库查询按用户 token 过滤可见缺陷
风险:
  - PR 描述里可能藏 prompt injection
  - 查询结果不能泄露无权限缺陷标题
```

写完这份小张才发现：原来 `send_lark` 必须用户确认、原来 PR 内容要做来源标记。这些都是后面所有实现决策的**根**。

## 2. 最小方法集

**小张的坑**：他一开始想一次性把 `tools/list`、`resources/list`、`prompts/list`、`sampling`、`elicitation` 全实现，三天没睡好还没跑通。后来 leader 说：「**先把一条腿走通**。」

**复盘后的规则**：一个最小可用 Server 至少需要：

- `initialize`
- `notifications/initialized` 处理
- `tools/list` 或 `resources/list` 或 `prompts/list`
- 对应的 `tools/call`、`resources/read` 或 `prompts/get`
- `ping`

只做工具 Server 时，就这么几个：

```text
initialize
tools/list
tools/call
ping
```

小张第二版就只实现了这四个方法，一个下午跑通。第三天才往里加 Resource、加 Prompt。**先把骨架立起来，再往里塞肉**。

## 3. 能力建模

### 3.1 Tool 命名

**小张的坑**：他给读取 PR 的 Tool 起名 `do`，模型一脸懵——「到底 do 啥？」调用率惨不忍睹。

**复盘后的规则**：Tool 名称要表达**动作 + 对象**。

好名字：

- `search_docs`
- `read_issue`
- `create_ticket`
- `run_test_target`

差名字：

- `do`
- `execute`
- `query`
- `helper`

小张改名为 `read_pr` 之后，模型调用准确率立刻上来。

### 3.2 Description

**小张的坑**：description 写的是「Search docs.」——和名字重复，等于没写。模型不知道什么时候该用它。

**复盘后的规则**：描述要告诉模型**何时使用**，不是重复名字。

差：

```text
Search docs.
```

好：

```text
Search internal engineering documentation by natural language query. Use this when the user asks about internal APIs, deployment procedures, or runbooks.
```

小张给 `read_pr` 写的最终版本：「Read a GitHub pull request by repo and PR number. Use this when the user mentions reviewing, merging, or commenting on a specific PR.」

### 3.3 输入 schema

**小张的坑**：`limit` 字段没限制，模型有一次传了 `100000`，把他后端搜索服务打挂了。

**复盘后的规则**：schema 要限制模型自由度。

```json
{
  "type": "object",
  "properties": {
    "query": {
      "type": "string",
      "description": "Natural language search query.",
      "minLength": 1,
      "maxLength": 500
    },
    "limit": {
      "type": "integer",
      "description": "Maximum number of results.",
      "minimum": 1,
      "maximum": 10,
      "default": 5
    }
  },
  "required": ["query"],
  "additionalProperties": false
}
```

`additionalProperties: false`、`maxLength`、`maximum`——这三个是**护栏**，一个都不能省。

## 4. 错误策略

**小张的坑**：第一天他把所有错误都抛 JSON-RPC error，结果飞书接口超时，模型看到的是 `Internal error`，完全不知道下一步该怎么办；第二天他把所有错误都包成 Tool result，结果参数 schema 不合法也走业务通道，Client 那边完全没法区分。

**复盘后的规则**：错误要**分层**——协议层归协议，业务层归业务。

| 类型 | 表达方式 | 示例 |
| --- | --- | --- |
| 方法不存在 | JSON-RPC error | `Method not found` |
| 参数 schema 不合法 | JSON-RPC error | `Missing required argument: query` |
| 外部系统超时 | Tool result `isError: true` | `Search service timed out` |
| 用户无权限 | Tool result 或 JSON-RPC error | 取决于是否已进入业务执行 |
| Server bug | JSON-RPC error | `Internal error`，日志保留细节 |

**关键判断**：模型能不能根据这个错误**自己调整下一步**？如果能（比如「重试」「换参数」），就用 `isError: true` 把语义化错误信息塞进 content；如果不能（比如「协议版本不对」「方法不存在」），就是协议级错误，直接 JSON-RPC error。

小张还给自己定了一条铁律——**绝不返回**：

- Python/Java/Go 原始 stack trace。
- 数据库连接串。
- 内部主机名和 secret。

这些东西进上下文就是事故。

## 5. 测试矩阵

**小张的坑**：他上线前一天才意识到自己只测了 happy path——「能搜到」「能发飞书」。同事 review 时随手发了个 `../../etc/passwd`，Server 竟然老老实实读出来了。

**复盘后的规则**：协议、能力、安全、传输，**四层都要测**。

协议层测试：

- initialize 成功。
- 不支持的协议版本返回清楚错误。
- 未初始化前调用业务方法被拒绝。
- unknown method 返回标准错误。
- ping 正常。

能力测试：

- tools/list 返回 schema。
- tools/call 参数合法时成功。
- 缺少必填参数时报错。
- 多余参数被拒绝。
- Tool 业务失败返回 `isError: true`。

安全测试：

- 路径穿越被拒绝。
- 超出 root 的文件不能读。
- 无权限文档不出现在搜索结果。
- 高风险 Tool 标记清楚。
- 日志不包含 secret。

传输测试：

- stdio stdout 不混日志。
- Server 退出时 Client 能感知。
- HTTP 认证失败返回 401/403。
- 流式响应中断能清理资源。

小张把这套矩阵写成了 CI 里的测试用例，每次 PR 自动跑。再没有「上线前夜抓瞎」。

## 6. 发布清单

**小张的坑**：上线那天他差点把数据库密码打进 README，又差点忘了加超时——一个查询卡死，整个 Server 卡住。

**复盘后的规则**：发布前对着清单**逐项打勾**。

- README 包含用途、安装、配置、权限说明。
- 明确支持的协议版本。
- 列出所有 Tools/Resources/Prompts。
- 标出有副作用的 Tool。
- 提供最小权限配置示例。
- 默认只读或默认安全。
- 有超时和取消机制。
- 有审计日志。

小张把这份清单贴在工位上，每次发版都过一遍。前三项最容易漏——超时取消、审计日志、默认只读。

## 7. 示例：文件搜索 Server

**复盘小结**：小张把代码评审助手上线后，又用同一个套路做了个文件搜索 Server，作为「教学复刻版」。需求：让模型搜索指定工作区里的文本文件。

能力设计：

```text
Tools:
  search_files(query, glob, max_results)
Resources:
  file:///{path}
Prompts:
  summarize_file(path)
```

权限：

- 只允许访问启动参数指定的 root。
- 默认不写文件。
- glob 不能包含绝对路径。
- 单个文件最大读取 200KB。

错误：

- query 为空：参数错误（JSON-RPC error）。
- glob 无匹配：业务结果为空，**不是错误**（这点容易混）。
- 文件太大：Tool result `isError: true`，提示用户缩小范围。

「**结果为空 ≠ 错误**」——这条规则小张专门用红字标了出来。

## 8. MCP Host 集成清单

**给做 Client 的同事**：小张的复盘文档里专门留了一节给那些实现 Host/Client（而不是 Server）的同事。

如果你做的是 Host/Client，重点要处理：

- 管理多个 Server 的连接生命周期。
- 按 Server 隔离上下文。
- 把 Tool schema 转成模型可用格式。
- Tool 调用前做用户确认。
- Tool 结果标记来源。
- 控制 Sampling 请求。
- 展示 Elicitation 表单或 URL。
- 处理 Server 断开、超时和版本不兼容。

小张说：「Server 把自己做好不够，Host 那边也得守规矩——否则上下文一串、权限一乱，Server 再安全也白搭。」

## 9. 给后来人的练习路线

小张在文档最后留了一条循序渐进的练习清单：

按顺序完成：

1. 写一个只实现 `tools/list` 和 `tools/call` 的 `get_time` Server。
2. 给 `get_time` 加参数 `timezone` 和 JSON Schema。
3. 增加 `ping`。
4. 增加一个 `docs://hello` Resource。
5. 增加 `summarize_doc` Prompt。
6. 增加错误测试：缺参数、未知 Tool、外部失败。
7. 把 stdio 版本改造成 HTTP 版本。
8. 给 HTTP 版本加认证和审计日志。

「**做完这八步，你就有了一个生产可用的 Server 雏形**。」小张在文档末尾写道。

## 动手实验

1. **写完设计说明再动手**：照 §1 的模板，为你正在做的 Server 写一份不超过 20 行的设计说明（职责 / 能力 / 权限 / 风险），写完再开始改代码——小张第一天就是跳过这步，结果边写边返工。
2. **跑一遍测试矩阵**：按 §5 的四层（协议 / 能力 / 安全 / 传输）各挑两条用例，落到你熟悉的测试框架里，至少让「缺必填参数」「路径穿越」「未初始化调用业务方法」「stdout 不混日志」这四条有自动化测试。
3. **过一次发布清单**：拿 §6 的清单逐项核对一个你已有的 Server，标出哪些没做（常见漏项：超时取消、审计日志、默认只读），补齐最关键的前三项。
4. **错误分层自查**：在你的 Server 里故意制造一次「外部系统超时」，确认它返回的是 `isError: true` 而非 JSON-RPC error；再制造一次「参数非法」，确认走的是 JSON-RPC error 而非 `isError`。如果两条都对了，说明你吃透了 §4。

## 接下来

协议详解篇到这里就结束了。你已经从零走到了「能拼出一台能跑、安全、可维护的 MCP Server」的程度。**接下来该动手做完整的实战项目了**——下面的实践模块把本篇的清单落到具体语言和场景里：

- [MCP Server（Python）](./10-mcp-server-python.md) —— 用官方 Python SDK 实现本节的清单，从最小 Server 到带认证的 HTTP 版
- [MCP Server（Go）](./11-mcp-server-go.md) —— 用 Go 实现一个生产级 Server，重点放在性能、并发与错误分层
- [MCP Client 集成](./12-mcp-client-integration.md) —— 把 §8 的 Host 集成清单落到代码：多 Server 管理、用户确认、上下文隔离
- [MCP 进阶](./13-mcp-advanced.md) —— Sampling、Elicitation、Roots 等高级能力的实战用法

也可以回到 [协议总览](./00-mcp-from-zero.md) 重新定位自己当前在哪一层。
