# 协议总览

> **协议详解篇第一节。** [入门篇](./getting-started/02-primitives-tour.md) 你已经会写最小 Server、知道三大原语。本节给你一张「**协议全景地图**」——JSON-RPC 消息、生命周期、能力协商、安全边界一次性串起来。
>
> **本节你将学到**：JSON-RPC 2.0 三种消息、初始化与能力协商、生命周期三阶段、三大原语快速回顾、常见协议错误、最小实现清单。
>
> **一句话比喻**：如果入门篇教你「**装一个 USB-C U 盘**」，本节教你「**整个 USB-C 标准的电气规范**」——从消息格式到握手协议到安全边界。

MCP 的全称是 Model Context Protocol，通常翻译为「模型上下文协议」。它的目标是让 AI 应用用统一方式连接外部数据、工具和工作流。

::: tip 本节是地图，不是手册
本节力求让你**看清 MCP 全貌**，每个对象的细节（字段、示例、边界情况）在后续 5 篇专题里展开。看完本节你应该知道「这块东西归哪一章查」。
:::

## 1. MCP 的通信基础：JSON-RPC 2.0

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

## 2. 一次连接的生命周期

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

## 3. Server 提供的三类核心能力

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

## 4. Client 可以提供的能力

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

## 5. 传输方式

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

## 6. 最小 MCP Server 的设计清单

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

## 7. 常见误区

### 误区一：Server 什么都能访问

不应该。Server 应该只拿到完成任务所需的最小权限。

### 误区二：Tool 调用可以默认执行

高风险 Tool 应该由 Host 展示给用户确认，尤其是写文件、发请求、删数据、转账、发消息等动作。

### 误区三：MCP Server 能看到完整聊天记录

不应该。Server 通常只看到 Host 明确传给它的请求和上下文。完整对话应由 Host 控制。

### 误区四：MCP 只是本地插件

不是。MCP 可以通过 stdio 跑本地 Server，也可以通过 Streamable HTTP 连接远程 Server。

## 8. 核心术语速查

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

1. **抓 JSON-RPC 消息**：用 [入门篇 01](./getting-started/01-first-server.md) 的 Server + Inspector，打开浏览器开发者工具或看 Inspector 的日志，找出一条 `tools/list` 请求和响应，对照本节 §1 的格式逐字段解读。
2. **生命周期观察**：用 Inspector 连接 Server 时，看左侧日志里的 `initialize` → 能力协商 → 正常调用 → 关闭四步，对照本节 §2 的生命周期阶段。
3. **传输方式对比**：把同一个 Server 分别用 stdio 和 Streamable HTTP 启动（Streamable HTTP 需要改 `mcp.run(transport="http")`），用 Inspector 连接两种，观察启动方式、可远程性、配置差异。
4. **能力清单核对**：找一个开源 MCP Server（如 filesystem），用 Inspector 读它的 `initialize` 响应里的 `capabilities` 字段，看它声明了哪些原语（resources/tools/prompts 哪些勾选了）。

## 接下来

- [协议架构](./01-protocol-architecture.md) —— JSON-RPC 消息、初始化握手、能力协商的完整细节
- [Server 能力](./02-server-capabilities.md) —— Resources / Prompts / Tools 三原语深入
- [Client 能力](./03-client-capabilities.md) —— Roots / Sampling / Elicitation 等反向能力
- [传输与安全](./04-transports-security.md) —— stdio 与 Streamable HTTP 的对比与安全
- [实现指南](./05-implementation-guide.md) —— 按工程清单落地一个 Server

## 官方参考

- MCP 规范：https://modelcontextprotocol.io/specification/2025-11-25
- MCP 架构：https://modelcontextprotocol.io/specification/2025-11-25/architecture
- MCP 基础协议：https://modelcontextprotocol.io/specification/2025-11-25/basic
- MCP 生命周期：https://modelcontextprotocol.io/specification/2025-11-25/basic/lifecycle
- MCP 传输：https://modelcontextprotocol.io/specification/2025-11-25/basic/transports
- MCP Server 能力：https://modelcontextprotocol.io/specification/2025-11-25/server
- MCP 官方仓库：https://github.com/modelcontextprotocol/modelcontextprotocol
