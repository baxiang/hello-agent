# 01 - MCP 协议架构与消息模型

这一章关注 MCP 的协议骨架：谁和谁通信、会话如何建立、消息如何编码、能力如何协商。理解这些之后，再看 Resources、Prompts、Tools 才不会停留在“几个 API 名字”的层面。

## 1. 总体架构

MCP 的基本结构是：

```text
User
  |
  v
MCP Host
  |
  +-- MCP Client A <---- session/transport ----> MCP Server A
  |
  +-- MCP Client B <---- session/transport ----> MCP Server B
  |
  +-- MCP Client C <---- session/transport ----> MCP Server C
```

几个关键点：

- Host 是用户真正使用的 AI 应用。
- Client 是 Host 内部的协议连接器。
- Server 是外部能力提供者。
- 一个 Client 通常只连接一个 Server。
- 多个 Server 之间默认互相隔离。
- Server 不应该绕过 Host 访问完整对话、用户凭证或其他 Server 的结果。

## 2. 协议分层

可以把 MCP 拆成五层理解。

| 层级 | 负责什么 | 示例 |
| --- | --- | --- |
| Application | AI 应用如何使用上下文和工具 | IDE、聊天应用、Agent 平台 |
| Capability | 双方声明能做什么 | `tools`、`resources`、`sampling` |
| Method | 具体协议操作 | `tools/list`、`resources/read` |
| Message | JSON-RPC 请求、响应、通知 | `id`、`method`、`params` |
| Transport | 字节如何传输 | stdio、Streamable HTTP |

这五层不要混在一起。例如：

- `tools/call` 是 Method，不是 Transport。
- stdio 是 Transport，不决定有哪些 Tool。
- Tool 的输入 schema 属于 Capability 里的业务描述，不属于 JSON-RPC 本身。

## 3. JSON-RPC 2.0 基础

MCP 消息基于 JSON-RPC 2.0。JSON-RPC 有三个基本消息形态。

### Request

Request 表示“我请求你做某件事，并且需要响应”。

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

要求：

- `jsonrpc` 固定是 `"2.0"`。
- `id` 用于匹配响应，不能为 `null`。
- `method` 是字符串。
- `params` 一般是对象。

### Response

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

错误设计建议：

- `message` 给人和模型都能读懂。
- `data` 放结构化细节。
- 参数错误要指出字段和期望类型。
- 权限错误要说明需要什么授权，但不要泄露凭证。

### Notification

Notification 表示“告诉你一件事，不需要响应”。

```json
{
  "jsonrpc": "2.0",
  "method": "notifications/initialized"
}
```

通知没有 `id`，所以对方不能回复结果。

## 4. 会话生命周期

MCP 会话有清晰阶段：

```text
Client starts transport
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
normal operation
  |
  v
shutdown / transport close
```

### 4.1 initialize

Client 首先发起 `initialize`。这个请求的目的不是调用业务功能，而是建立协议契约：

- 使用哪个协议版本。
- Client 支持哪些能力。
- Client 的名称和版本。
- Server 支持哪些能力。
- Server 的名称和版本。

初始化请求示例：

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

初始化响应示例：

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

### 4.2 initialized notification

Client 收到初始化响应后，发送：

```json
{
  "jsonrpc": "2.0",
  "method": "notifications/initialized"
}
```

这表示双方可以进入正常操作阶段。

### 4.3 正常操作阶段

正常阶段才能调用能力方法，例如：

- `tools/list`
- `tools/call`
- `resources/list`
- `resources/read`
- `resources/templates/list`
- `resources/subscribe`
- `prompts/list`
- `prompts/get`
- `completion/complete`
- `logging/setLevel`

## 5. 能力协商

MCP 的能力不是默认全部可用。双方必须通过初始化阶段声明。

Server 能力常见包括：

| 能力 | 说明 |
| --- | --- |
| `tools` | Server 暴露可调用工具 |
| `resources` | Server 暴露可读取资源 |
| `prompts` | Server 暴露提示词模板 |
| `logging` | Server 可发送日志 |
| `completions` | Server 支持参数补全 |

Client 能力常见包括：

| 能力 | 说明 |
| --- | --- |
| `roots` | Client 提供可访问边界 |
| `sampling` | Client 允许 Server 请求模型采样 |
| `elicitation` | Client 允许 Server 向用户请求输入 |

能力协商的意义：

- Server 不支持 `tools`，Client 就不应该调用 `tools/list`。
- Client 不支持 `sampling`，Server 就不应该请求模型生成。
- Server 声明 `listChanged`，Client 才能期待列表变更通知。

## 6. 分页模型

很多 `list` 方法都可能返回大量结果。MCP 使用 cursor 分页。

请求：

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

响应：

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

实现建议：

- 不要一次返回几千个 Tool 或 Resource。
- cursor 应该是 Server 可验证的 opaque token。
- cursor 不要包含敏感信息。

## 7. 进度通知

长时间操作可以带进度 token。Client 调用时提供 token，Server 用通知回报进度。

请求：

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

进度通知：

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

## 8. 版本兼容

协议版本协商不是装饰。实现时要处理：

- Client 请求版本高于 Server 支持版本。
- Server 返回不同但兼容的版本。
- 某个能力在旧版本不存在。
- 新字段出现时旧实现应尽量忽略未知字段。

保守策略：

- 明确记录支持的协议版本。
- 初始化失败时返回清晰错误。
- 不要根据 Server 名称猜协议行为。
- 不要依赖未声明能力。

## 9. 方法命名规律

MCP 方法名通常是：

```text
<domain>/<operation>
```

例如：

- `tools/list`
- `tools/call`
- `resources/read`
- `prompts/get`
- `sampling/createMessage`

通知通常是：

```text
notifications/<event>
```

例如：

- `notifications/initialized`
- `notifications/progress`
- `notifications/resources/list_changed`

命名规律帮助你读规范，但实现时仍应以官方 schema 为准。

## 10. 本章检查点

读完本章，你应该能解释：

- 为什么 Host 和 Client 不是同一个概念。
- 为什么 initialize 必须先于业务方法。
- JSON-RPC Request、Response、Notification 的区别。
- 能力协商如何避免调用不存在的方法。
- cursor、progress token、notification 分别解决什么问题。

