# Server 能力

> **协议详解篇第三节。** [上一节](./01-protocol-architecture.md) 你看清了协议骨架与消息格式，本节聚焦 Server 侧——Server 到底能暴露哪几类能力，以及为什么**不是所有东西都该做成 Tool**。
>
> **本节你将学到**：Resources / Prompts / Tools 的选择原则、三类能力的对象结构与调用方法、Resource Template、订阅与变更通知、Tool 输入 schema 设计、协议错误 vs 业务错误。
>
> **一句话比喻**：Server 三件套像「**资料柜 / 命令手册 / 工具箱**」——Resource 给模型读、Prompt 给用户选、Tool 给模型动手，三者各司其职。

MCP Server 的价值在于把外部系统能力暴露给 AI 应用。但不是所有能力都应该做成 Tool。MCP 把 Server 能力拆成 Resources、Prompts、Tools，分别对应“给上下文的数据”“给用户触发的模板”“给模型执行的动作”。

## 1. 能力选择原则

| 你要表达的东西 | 优先用什么 | 原因 |
| --- | --- | --- |
| 文件、文档、schema、记录、日志 | Resource | 主要是读取和附加上下文 |
| 常用工作流入口 | Prompt | 用户主动选择，参数化生成提示 |
| 查询、计算、创建、修改、发送 | Tool | 模型可以请求执行 |
| 参数自动补全 | Completion | 提升 Prompt/Resource 参数体验 |

判断问题：

- 这个能力会不会产生副作用？如果会，倾向 Tool，并增加确认。
- 用户是否应该主动选择它？如果是，倾向 Prompt。
- 结果是否主要作为上下文被读取？如果是，倾向 Resource。

## 2. Resources

Resource 是 Server 暴露的可读取上下文。它不等同于文件，也可以是数据库表、issue、网页、日志、配置项。

### 2.1 Resource 对象

典型字段：

```json
{
  "uri": "file:///workspace/README.md",
  "name": "README.md",
  "description": "Project overview",
  "mimeType": "text/markdown"
}
```

字段意义：

- `uri`：资源唯一标识，Client 用它读取。
- `name`：给用户看的名称。
- `description`：帮助用户和模型理解资源内容。
- `mimeType`：内容类型，影响渲染和上下文处理。

### 2.2 resources/list

列出可发现资源。

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "resources/list",
  "params": {}
}
```

响应：

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "result": {
    "resources": [
      {
        "uri": "docs://guide/mcp",
        "name": "MCP Guide",
        "description": "Internal MCP guide",
        "mimeType": "text/markdown"
      }
    ]
  }
}
```

### 2.3 resources/read

读取指定资源。

```json
{
  "jsonrpc": "2.0",
  "id": 2,
  "method": "resources/read",
  "params": {
    "uri": "docs://guide/mcp"
  }
}
```

响应可以包含文本或二进制内容：

```json
{
  "jsonrpc": "2.0",
  "id": 2,
  "result": {
    "contents": [
      {
        "uri": "docs://guide/mcp",
        "mimeType": "text/markdown",
        "text": "# MCP Guide\n..."
      }
    ]
  }
}
```

### 2.4 Resource Templates

不是所有资源都适合预先列出。比如：

- `file:///{path}`
- `postgres:///{database}/{schema}/{table}`
- `github://repos/{owner}/{repo}/issues/{number}`

这类资源适合用 Resource Template 表达。

示例：

```json
{
  "uriTemplate": "github://repos/{owner}/{repo}/issues/{number}",
  "name": "GitHub Issue",
  "description": "Read one issue by owner, repo, and number",
  "mimeType": "application/json"
}
```

### 2.5 订阅与变更通知

如果 Server 支持 `resources.subscribe`，Client 可以订阅资源变化。

订阅：

```json
{
  "jsonrpc": "2.0",
  "id": 3,
  "method": "resources/subscribe",
  "params": {
    "uri": "file:///workspace/README.md"
  }
}
```

资源更新通知：

```json
{
  "jsonrpc": "2.0",
  "method": "notifications/resources/updated",
  "params": {
    "uri": "file:///workspace/README.md"
  }
}
```

资源列表变化通知：

```json
{
  "jsonrpc": "2.0",
  "method": "notifications/resources/list_changed"
}
```

## 3. Prompts

Prompt 是用户可选择的提示词模板。它的价值是把常用工作流标准化。

### 3.1 Prompt 对象

示例：

```json
{
  "name": "review_code",
  "description": "Review code for correctness, security, and maintainability",
  "arguments": [
    {
      "name": "path",
      "description": "Path to review",
      "required": true
    },
    {
      "name": "focus",
      "description": "Review focus",
      "required": false
    }
  ]
}
```

### 3.2 prompts/list

```json
{
  "jsonrpc": "2.0",
  "id": 10,
  "method": "prompts/list",
  "params": {}
}
```

### 3.3 prompts/get

```json
{
  "jsonrpc": "2.0",
  "id": 11,
  "method": "prompts/get",
  "params": {
    "name": "review_code",
    "arguments": {
      "path": "src/auth.ts",
      "focus": "security"
    }
  }
}
```

响应：

```json
{
  "jsonrpc": "2.0",
  "id": 11,
  "result": {
    "description": "Review code for security",
    "messages": [
      {
        "role": "user",
        "content": {
          "type": "text",
          "text": "Review src/auth.ts for security issues."
        }
      }
    ]
  }
}
```

### 3.4 Prompt 设计建议

- Prompt 应该表达用户意图，不要偷偷执行动作。
- 参数要少而明确。
- 参数缺失时返回清楚错误。
- Prompt 可以引用 Resource，但不要强行读取用户未授权内容。

## 4. Tools

Tool 是模型可以请求调用的动作。它最强，也最危险。

### 4.1 Tool 对象

示例：

```json
{
  "name": "search_issues",
  "description": "Search open issues in a GitHub repository",
  "inputSchema": {
    "type": "object",
    "properties": {
      "owner": {
        "type": "string"
      },
      "repo": {
        "type": "string"
      },
      "query": {
        "type": "string"
      }
    },
    "required": ["owner", "repo", "query"]
  }
}
```

### 4.2 tools/list

```json
{
  "jsonrpc": "2.0",
  "id": 20,
  "method": "tools/list",
  "params": {}
}
```

### 4.3 tools/call

```json
{
  "jsonrpc": "2.0",
  "id": 21,
  "method": "tools/call",
  "params": {
    "name": "search_issues",
    "arguments": {
      "owner": "example",
      "repo": "api",
      "query": "is:open label:bug"
    }
  }
}
```

响应：

```json
{
  "jsonrpc": "2.0",
  "id": 21,
  "result": {
    "content": [
      {
        "type": "text",
        "text": "Found 3 issues."
      }
    ],
    "isError": false
  }
}
```

### 4.4 Tool 的两类错误

有两种错误要区分。

协议错误：请求格式不对、方法不存在、参数不合法。

```json
{
  "jsonrpc": "2.0",
  "id": 21,
  "error": {
    "code": -32602,
    "message": "Missing required argument: owner"
  }
}
```

工具执行错误：Tool 被正常调用，但业务失败。

```json
{
  "jsonrpc": "2.0",
  "id": 21,
  "result": {
    "content": [
      {
        "type": "text",
        "text": "Repository not found or access denied."
      }
    ],
    "isError": true
  }
}
```

建议：

- JSON-RPC error 用于协议层错误。
- `isError: true` 用于工具业务执行失败。
- 不要把 stack trace 直接暴露给模型。

## 5. Tool 输入 schema 设计

Tool 的输入 schema 是模型能否正确调用的关键。

差的 schema：

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

好的 schema：

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

原则：

- 字段名明确。
- description 写业务含义，不写废话。
- 用 enum 限制可选值。
- 用 minimum、maximum 限制数字。
- 默认拒绝多余字段。
- 对路径、URL、SQL 等危险输入做二次校验。

## 6. 方法清单

| 领域 | 方法/通知 | 方向 | 用途 |
| --- | --- | --- | --- |
| Resources | `resources/list` | Client -> Server | 列资源 |
| Resources | `resources/read` | Client -> Server | 读资源 |
| Resources | `resources/templates/list` | Client -> Server | 列资源模板 |
| Resources | `resources/subscribe` | Client -> Server | 订阅资源 |
| Resources | `resources/unsubscribe` | Client -> Server | 取消订阅 |
| Resources | `notifications/resources/updated` | Server -> Client | 资源更新 |
| Resources | `notifications/resources/list_changed` | Server -> Client | 资源列表变化 |
| Prompts | `prompts/list` | Client -> Server | 列提示词 |
| Prompts | `prompts/get` | Client -> Server | 获取提示词实例 |
| Prompts | `notifications/prompts/list_changed` | Server -> Client | 提示词列表变化 |
| Tools | `tools/list` | Client -> Server | 列工具 |
| Tools | `tools/call` | Client -> Server | 调用工具 |
| Tools | `notifications/tools/list_changed` | Server -> Client | 工具列表变化 |

## 7. 实战建模示例

需求：让 AI 帮助分析一个 Git 仓库。

合理拆分：

| 能力 | MCP 类型 | 示例 |
| --- | --- | --- |
| README、源码文件 | Resource | `file:///repo/README.md` |
| 当前 diff | Resource | `git://repo/diff/current` |
| 代码审查模板 | Prompt | `review_diff` |
| 搜索文件 | Tool | `search_files(query)` |
| 运行测试 | Tool | `run_tests(target)` |
| 创建 PR 评论 | Tool | `create_review_comment(...)` |

高风险边界：

- `run_tests` 可能执行任意代码，需要沙箱或用户确认。
- `create_review_comment` 会对外部系统产生副作用，需要确认。
- 文件 Resource 必须限制在仓库根目录内。

## 8. 本章检查点

读完本章，你应该能：

- 判断一个能力应建模为 Resource、Prompt 还是 Tool。
- 写出一个带 JSON Schema 的 Tool 定义。
- 区分协议错误和工具业务错误。
- 解释 Resource Template 适合什么场景。
- 列出 Server 能力相关的主要方法。

## 动手实验

1. **三类原语都跑通**：用 [入门篇 02](./getting-started/02-primitives-tour.md) 的 demo Server，在 Inspector 里分别调 `resources/list`、`prompts/get`、`tools/call`，对照本章字段表看清每个响应的结构。
2. **Resource Template 实战**：给你的 Server 加一个 `file:///{path}` 风格的 Resource Template，调用 `resources/templates/list`，再用模板拼一个真实 URI 去 `resources/read`。
3. **构造两类错误**：分别触发一次「缺必填参数」（应得 JSON-RPC error）和「Tool 业务失败」（应得 `isError: true`），对比 §4.4 的两种错误形态。
4. **订阅一次资源变化**：写一个会定期更新内容的 Resource，用 `resources/subscribe` 订阅它，修改内容后观察 `notifications/resources/updated` 是否到达。

## 接下来

- [Client 能力](./03-client-capabilities.md) —— Server 反过来向 Client 请求的 Roots / Sampling / Elicitation
- [传输与安全](./04-transports-security.md) —— 这些能力在 stdio 和 HTTP 下分别怎么传
- [实现指南](./05-implementation-guide.md) —— 把本章的三类能力落成一个完整 Server

