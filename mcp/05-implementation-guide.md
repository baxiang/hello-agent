# 05 - MCP 实现指南：从 0 设计一个 Server

这一章给出实现路线。重点不是绑定某个 SDK，而是把协议设计、能力建模、安全和测试串起来。

## 1. 先写 Server 设计说明

不要一上来写代码。先回答：

1. Server 的唯一职责是什么？
2. 面向谁使用？
3. 连接什么外部系统？
4. 默认只读还是可写？
5. 需要 Resources、Prompts、Tools 中哪些能力？
6. 哪些操作有副作用？
7. 哪些数据不能进入模型上下文？
8. 错误如何让模型或用户修正？

示例：

```text
Server: docs-search
职责: 查询内部文档并返回摘要与链接
能力:
  - Tool: search_docs(query, limit)
  - Resource: docs://document/{id}
  - Prompt: summarize_doc(document_id)
权限:
  - 只读
  - 按用户 token 过滤可见文档
风险:
  - 文档内容可能包含 prompt injection
  - 搜索结果不能泄露无权限文档标题
```

## 2. 最小方法集

一个最小可用 Server 至少需要：

- `initialize`
- `notifications/initialized` 处理
- `tools/list` 或 `resources/list` 或 `prompts/list`
- 对应的 `tools/call`、`resources/read` 或 `prompts/get`
- `ping`

如果只做工具 Server：

```text
initialize
tools/list
tools/call
ping
```

## 3. 能力建模

### 3.1 Tool 命名

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

Tool 名称应表达动作和对象。

### 3.2 Description

描述要告诉模型何时使用，而不是重复名字。

差：

```text
Search docs.
```

好：

```text
Search internal engineering documentation by natural language query. Use this when the user asks about internal APIs, deployment procedures, or runbooks.
```

### 3.3 输入 schema

schema 应限制模型自由度。

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

## 4. 错误策略

错误要分层。

| 类型 | 表达方式 | 示例 |
| --- | --- | --- |
| 方法不存在 | JSON-RPC error | `Method not found` |
| 参数 schema 不合法 | JSON-RPC error | `Missing required argument: query` |
| 外部系统超时 | Tool result `isError: true` | `Search service timed out` |
| 用户无权限 | Tool result 或 JSON-RPC error | 取决于是否已进入业务执行 |
| Server bug | JSON-RPC error | `Internal error`，日志保留细节 |

不要返回：

- Python/Java/Go 原始 stack trace。
- 数据库连接串。
- 内部主机名和 secret。

## 5. 测试矩阵

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

## 6. 发布清单

发布前检查：

- README 包含用途、安装、配置、权限说明。
- 明确支持的协议版本。
- 列出所有 Tools/Resources/Prompts。
- 标出有副作用的 Tool。
- 提供最小权限配置示例。
- 默认只读或默认安全。
- 有超时和取消机制。
- 有审计日志。

## 7. 示例：文件搜索 Server

需求：让模型搜索指定工作区里的文本文件。

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

- query 为空：参数错误。
- glob 无匹配：业务结果为空，不是错误。
- 文件太大：Tool result `isError: true`，提示用户缩小范围。

## 8. MCP Host 集成清单

如果你实现的是 Host/Client，而不是 Server，要重点做：

- 管理多个 Server 的连接生命周期。
- 按 Server 隔离上下文。
- 把 Tool schema 转成模型可用格式。
- Tool 调用前做用户确认。
- Tool 结果标记来源。
- 控制 Sampling 请求。
- 展示 Elicitation 表单或 URL。
- 处理 Server 断开、超时和版本不兼容。

## 9. 学习任务

按顺序完成：

1. 写一个只实现 `tools/list` 和 `tools/call` 的 `get_time` Server。
2. 给 `get_time` 加参数 `timezone` 和 JSON Schema。
3. 增加 `ping`。
4. 增加一个 `docs://hello` Resource。
5. 增加 `summarize_doc` Prompt。
6. 增加错误测试：缺参数、未知 Tool、外部失败。
7. 把 stdio 版本改造成 HTTP 版本。
8. 给 HTTP 版本加认证和审计日志。

