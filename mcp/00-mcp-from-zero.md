# 00 - 从 0 开始学习 MCP 协议

MCP 的全称是 Model Context Protocol，通常翻译为“模型上下文协议”。它的目标是让 AI 应用用统一方式连接外部数据、工具和工作流，而不是每接一个系统都重新写一套私有插件接口。

可以把 MCP 理解为：AI 应用和外部能力之间的一层标准协议。

## 1. 先理解 MCP 解决的问题

大模型本身不知道你的本地文件、数据库、Git 仓库、Slack、工单系统或公司内部 API。传统做法是给每个 AI 应用分别写集成：

- 给 A 应用写 GitHub 插件。
- 给 B 应用再写一套 GitHub 插件。
- 给 C 应用又写一套数据库插件。

这会带来几个问题：

- 接入成本高：每个应用都有自己的插件格式。
- 权限边界不清：工具能读什么、写什么，经常和应用强绑定。
- 可复用性差：一个工具集成很难在多个 AI 客户端之间迁移。

MCP 的思路是把集成抽象成通用协议：

- 工具提供方实现 MCP Server。
- AI 应用作为 MCP Host。
- Host 内部创建 MCP Client，与 MCP Server 建立一对一会话。
- 双方通过 JSON-RPC 2.0 消息交换能力、上下文和调用结果。

## 2. 三个核心角色

### Host

Host 是用户正在使用的 AI 应用，例如 IDE、桌面助手、聊天应用或自动化平台。Host 负责：

- 管理用户界面和用户授权。
- 创建和管理多个 MCP Client。
- 决定哪些 Server 可以连接。
- 聚合上下文，并把必要信息交给模型。
- 执行安全策略，例如工具调用前让用户确认。

Host 是安全边界的核心。Server 不应该直接看到完整对话，也不应该绕过 Host 读取用户数据。

### Client

Client 是 Host 内部的连接器。通常一个 Client 只连接一个 Server。Client 负责：

- 建立一个有状态会话。
- 发送初始化请求。
- 协商协议版本和能力。
- 路由请求、响应、通知。
- 隔离不同 Server 之间的上下文。

简单说：Host 可以有多个 Client，每个 Client 管一个 Server。

### Server

Server 是能力提供者。它可以连接本地文件系统、数据库、HTTP API、内部服务或业务系统。Server 负责暴露：

- Resources：可读取的上下文数据。
- Prompts：可复用的提示词模板或工作流入口。
- Tools：可执行的函数或动作。

Server 应该聚焦于清晰的小能力。例如：

- filesystem server：读写指定目录。
- postgres server：查询数据库 schema 和执行受控 SQL。
- github server：读取 issue、创建 PR、查看 diff。

## 3. MCP 的通信基础：JSON-RPC 2.0

MCP 的基础消息格式来自 JSON-RPC 2.0。常见消息有三类。

### Request

请求需要对方返回响应。

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "tools/list",
  "params": {}
}
```

关键点：

- `jsonrpc` 固定为 `"2.0"`。
- `id` 用于匹配响应，不能为 `null`。
- `method` 是协议方法名。
- `params` 是方法参数。

### Response

成功响应包含 `result`。

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "result": {
    "tools": []
  }
}
```

失败响应包含 `error`。

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

### Notification

通知不需要响应，因此没有 `id`。

```json
{
  "jsonrpc": "2.0",
  "method": "notifications/initialized"
}
```

## 4. 一次连接的生命周期

MCP 会话通常分三段：

1. Initialization：初始化。
2. Operation：正常通信。
3. Shutdown：关闭连接。

### 4.1 初始化

Client 必须先发送 `initialize`。

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

Server 返回自己支持的协议版本、能力和服务信息。

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

初始化成功后，Client 发送 `notifications/initialized`，表示可以进入正常通信。

### 4.2 正常通信

进入 Operation 阶段后，Client 和 Server 可以根据协商出的能力交换消息。例如：

- `tools/list`
- `tools/call`
- `resources/list`
- `resources/read`
- `prompts/list`
- `prompts/get`

### 4.3 关闭

stdio 传输下，Host 通常会关闭 stdin 或终止子进程。HTTP 传输下，连接和会话的关闭取决于实现和传输细节。

## 5. Server 提供的三类核心能力

### 5.1 Resources：上下文数据

Resource 是给模型或用户看的数据，常见例子：

- 文件内容。
- 数据库 schema。
- Git diff。
- API 返回的业务对象。
- 文档片段。

Resource 通常由应用控制如何附加到上下文中。Server 暴露资源列表，Client 决定何时读取。

示例：列出资源。

```json
{
  "jsonrpc": "2.0",
  "id": 2,
  "method": "resources/list",
  "params": {}
}
```

示例：读取资源。

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

### 5.2 Prompts：提示词模板

Prompt 是 Server 暴露给用户选择的模板。它适合表达常用工作流，例如：

- 代码审查。
- 生成提交信息。
- 分析日志。
- 根据数据库 schema 写查询。

Prompt 是用户控制的能力，通常通过 slash command、菜单或按钮触发。

示例：列出提示词。

```json
{
  "jsonrpc": "2.0",
  "id": 4,
  "method": "prompts/list",
  "params": {}
}
```

示例：获取一个提示词。

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

### 5.3 Tools：可执行动作

Tool 是模型可以请求调用的函数。常见例子：

- 查询数据库。
- 创建 issue。
- 发送消息。
- 修改文件。
- 调用公司内部 API。

Tool 风险最高，因为它可能读写外部系统。Host 应该让用户理解和确认敏感操作。

示例：列出工具。

```json
{
  "jsonrpc": "2.0",
  "id": 6,
  "method": "tools/list",
  "params": {}
}
```

示例：调用工具。

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

## 6. Client 可以提供的能力

MCP 不是单向协议。Server 不只被调用，也可以在允许范围内向 Client 请求能力。

### 6.1 Sampling

Sampling 允许 Server 请求 Client 让模型生成内容。这个能力需要 Host 控制，因为它可能消耗模型资源，也可能涉及上下文泄露。

### 6.2 Roots

Roots 表示 Server 可以操作或理解的边界，例如工作区目录。它帮助 Server 知道自己能访问哪些 URI 或文件范围。

### 6.3 Elicitation

Elicitation 允许 Server 通过 Client 向用户请求额外信息。它有两个典型模式：

- form：让用户填写结构化字段。
- url：把用户引导到外部页面完成敏感交互。

安全原则：不要通过普通表单收集密码、API key、访问令牌或支付凭证。敏感信息应使用更受控的 URL 流程，并由 Host 明确展示目标域名和用户确认。

## 7. 传输方式

MCP 当前标准传输主要包括 stdio 和 Streamable HTTP。

### 7.1 stdio

stdio 适合本地 Server。流程通常是：

1. Host 启动 Server 子进程。
2. Client 通过 stdin 向 Server 写 JSON-RPC 消息。
3. Server 通过 stdout 返回 JSON-RPC 消息。
4. Server 可以把日志写到 stderr。

注意：

- stdout 只能写合法 MCP 消息。
- 日志不要写 stdout。
- 每条消息用换行分隔。

stdio 的优点：

- 简单。
- 适合本地开发和桌面应用。
- 不需要独立 HTTP 服务。

stdio 的限制：

- 不适合多客户端共享。
- 不适合跨网络部署。
- 进程生命周期由 Host 管理。

### 7.2 Streamable HTTP

Streamable HTTP 适合远程或服务化 Server。它使用 HTTP POST 和 GET，Server 可以选择用 SSE 流式返回多条消息。

优点：

- 适合远程服务。
- 可以支持多个客户端连接。
- 更容易接入认证、网关和可观测性系统。

安全要求更高：

- 校验 `Origin`，防止 DNS rebinding。
- 本地服务优先绑定 `127.0.0.1`，不要随意监听 `0.0.0.0`。
- 远程服务应该实现认证和授权。

## 8. MCP 和普通 Function Calling 的区别

Function Calling 通常是模型供应商 API 内的一种工具调用格式。它回答的是：

> 模型如何表达“我要调用这个函数”？

MCP 回答的是：

> AI 应用如何发现、连接、协商、读取、调用和管理外部能力？

两者可以配合使用：

- MCP Server 暴露 tools。
- Host 把可用工具转换成模型可理解的工具定义。
- 模型选择工具。
- Host 通过 MCP Client 调用 Server。
- Server 返回结果。
- Host 再把结果交给模型继续推理。

## 9. 最小 MCP Server 的设计清单

从 0 写一个 MCP Server，不要先追求大而全。先明确以下问题：

1. 这个 Server 只做什么？
2. 它需要暴露 Resources、Prompts、Tools 中的哪几类？
3. 每个 Tool 的输入 schema 是什么？
4. Tool 是否会产生副作用？
5. 哪些操作必须让用户确认？
6. Server 能访问哪些路径、数据库或 API？
7. 错误返回给模型时，是否足够清晰，能让模型自我修正？

一个好的第一版 Server 可以只实现：

- `initialize`
- `tools/list`
- `tools/call`
- 少量只读工具

等基本链路跑通后，再加入 Resources、Prompts、分页、日志、认证和订阅。

## 10. 常见误区

### 误区一：Server 什么都能访问

不应该。Server 应该只拿到完成任务所需的最小权限。

### 误区二：Tool 调用可以默认执行

高风险 Tool 应该由 Host 展示给用户确认，尤其是写文件、发请求、删数据、转账、发消息等动作。

### 误区三：MCP Server 能看到完整聊天记录

不应该。Server 通常只看到 Host 明确传给它的请求和上下文。完整对话应由 Host 控制。

### 误区四：MCP 只是本地插件

不是。MCP 可以通过 stdio 跑本地 Server，也可以通过 Streamable HTTP 连接远程 Server。

## 11. 从这里继续学

建议按下面顺序实践：

1. 只读 Tool：写一个 `get_time` 或 `list_files`。
2. 带参数 Tool：写一个 `search_docs(query)`。
3. Resource：暴露一个 `file://` 或 `docs://` 资源。
4. Prompt：暴露一个 `summarize_doc` 模板。
5. 权限：限制 Server 只能读取指定目录。
6. 错误处理：让错误信息能帮助模型修正参数。
7. 传输升级：从 stdio 迁移到 Streamable HTTP。

## 12. 核心术语速查

| 术语 | 含义 |
| --- | --- |
| Host | 用户使用的 AI 应用，负责 UI、权限、模型集成和 Client 管理 |
| Client | Host 内部的 MCP 连接器，一个 Client 通常连接一个 Server |
| Server | 外部能力提供者，暴露资源、提示词和工具 |
| Resource | 可读上下文数据，例如文件、schema、文档 |
| Prompt | 用户可选择的提示词模板或工作流入口 |
| Tool | 模型可请求调用的函数或动作 |
| Sampling | Server 请求 Client 调用模型生成内容 |
| Roots | Client 告诉 Server 的可操作边界 |
| Elicitation | Server 通过 Client 向用户请求额外信息 |
| Transport | 传输层，例如 stdio 或 Streamable HTTP |

## 13. 官方参考

- MCP 规范：https://modelcontextprotocol.io/specification/2025-11-25
- MCP 架构：https://modelcontextprotocol.io/specification/2025-11-25/architecture
- MCP 基础协议：https://modelcontextprotocol.io/specification/2025-11-25/basic
- MCP 生命周期：https://modelcontextprotocol.io/specification/2025-11-25/basic/lifecycle
- MCP 传输：https://modelcontextprotocol.io/specification/2025-11-25/basic/transports
- MCP Server 能力：https://modelcontextprotocol.io/specification/2025-11-25/server
- MCP 官方仓库：https://github.com/modelcontextprotocol/modelcontextprotocol

## 14. 本目录接下来怎么学

这篇只建立第一层地图。继续阅读时建议按下面顺序推进：

1. 先读 `01-protocol-architecture.md`，弄清楚协议分层、生命周期和 JSON-RPC 消息。
2. 再读 `02-server-capabilities.md`，重点掌握 Server 到底能暴露什么。
3. 再读 `03-client-capabilities.md`，理解 Host/Client 为什么也能向 Server 提供能力。
4. 然后读 `04-transports-security.md`，把本地进程、远程 HTTP、权限、安全确认联系起来。
5. 最后读 `05-implementation-guide.md`，按清单设计一个最小可用 MCP Server。

学习 MCP 的关键不是背方法名，而是建立判断：

- 数据给模型看，优先考虑 Resource。
- 用户主动触发工作流，优先考虑 Prompt。
- 模型需要执行动作，优先考虑 Tool。
- Server 需要模型能力，考虑 Sampling，但必须由 Host 控制。
- Server 需要用户输入，考虑 Elicitation，但敏感信息不能用普通表单收集。
