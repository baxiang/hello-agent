# A2A Agent 示例 - 构建完整的 Agent 间远程通信系统

## 概述

本示例演示 tRPC-Agent-Go 中 A2A（Agent-to-Agent）通信的核心功能，包括 A2A 服务器搭建、客户端连接、Agent 自动发现以及协议转换。示例同时运行远程 A2A Agent 和本地 Agent，对比展示两者响应结果的一致性，并涵盖自定义 DataPart 传输和结构化错误处理两个进阶子示例。

## 核心概念

### A2A Server

A2A Server 将本地 Agent 通过 A2A 协议暴露为 HTTP 服务。它自动在 `/.well-known/agent.json` 端点发布 Agent Card，客户端通过该端点发现 Agent 的元信息和能力。框架支持两种构建模式：

- **WithAgent 模式**：传入 Agent 和流式标志，框架自动创建 Runner 和 Agent Card
- **WithRunner + WithAgentCard 模式**：手动传入自定义 Runner 和 Agent Card，适合需要精细控制的场景

### A2A Agent（客户端代理）

`a2aagent.A2AAgent` 是一个实现了 `agent.Agent` 接口的代理 Agent，它将本地调用透明转发到远程 A2A Server。对上层调用者来说，使用远程 Agent 与本地 Agent 无异。

### 自定义 DataPart（customdatapart 子示例）

A2A 协议支持通过 DataPart 传输结构化数据。服务端通过 `WithEventToA2APartMapper` 将自定义事件转换为 DataPart，客户端通过 `WithA2ADataPartMapper` 将 DataPart 还原为本地事件扩展数据。

### 结构化错误处理（error_handling 子示例）

通过 `WithStructuredTaskErrors(true)` 启用结构化任务错误，远程 Agent 的业务错误会以类型化的 `model.ResponseError` 形式传递到客户端，包含错误类型、错误码和错误消息。

## 代码解析

**1. 启动 A2A 服务器**

```go
server, err := a2a.New(
    a2a.WithHost(*host),
    a2a.WithAgent(remoteAgent, *streaming),
    a2a.WithDebugLogging(false),
    a2a.WithErrorHandler(func(ctx context.Context, msg *protocol.Message, err error) (*protocol.Message, error) {
        return &errMsg, nil
    }),
    a2a.WithProcessMessageHook(func(next taskmanager.MessageProcessor) taskmanager.MessageProcessor {
        return &hookProcessor{next: next}
    }),
)
server.Start(*host)
```

`WithErrorHandler` 允许自定义错误处理逻辑，`WithProcessMessageHook` 以中间件模式拦截和处理入站 A2A 消息，可用于读取客户端注入的自定义 metadata。

**2. 创建 A2A Agent 客户端**

```go
a2aAgent, err := a2aagent.New(
    a2aagent.WithAgentCardURL(httpURL),
    a2aagent.WithTransferStateKey(optionalStateKey),
    a2aagent.WithBuildMessageHook(func(next a2aagent.ConvertToA2AMessageFunc) a2aagent.ConvertToA2AMessageFunc {
        return func(isStream bool, agentName string, inv *agent.Invocation) (*protocol.Message, error) {
            msg, err := next(isStream, agentName, inv)
            msg.Metadata["trace_id"] = fmt.Sprintf("trace-%d", time.Now().UnixNano())
            return msg, nil
        }
    }),
)
```

`WithBuildMessageHook` 以中间件模式包装消息构建逻辑，可以在发送前注入 trace_id 等自定义 metadata，实现分布式追踪。

**3. 传递自定义 HTTP 请求头**

```go
events, err := runner.Run(ctx, userID, sessionID, msg,
    agent.WithA2ARequestOptions(
        client.WithRequestHeader("Authorization", "Bearer token"),
        client.WithRequestHeader("X-Request-ID", "req-12345"),
    ),
)
```

通过 `WithA2ARequestOptions` 可以为每次请求附加自定义 HTTP 头，适用于认证和分布式追踪场景。

**4. 结构化错误处理**

```go
server, err := a2aserver.New(
    a2aserver.WithHost(*host),
    a2aserver.WithAgent(&structuredErrorAgent{}, true),
    a2aserver.WithStructuredTaskErrors(true),
)
```

服务端 Agent 发出的 `model.ObjectTypeError` 类型事件会被转换为 A2A 协议的结构化任务错误，客户端可以读取 `evt.Response.Error` 中的类型化错误信息。

## 运行方式

**环境准备：**

```bash
export OPENAI_API_KEY="your-api-key"
export OPENAI_BASE_URL="https://api.deepseek.com/v1"
```

**运行主示例：**

```bash
cd examples/a2aagent
go run . -model deepseek-v4-flash -host 127.0.0.1:8888
```

**运行自定义 DataPart 子示例：**

```bash
go run ./examples/a2aagent/customdatapart
```

**运行错误处理子示例：**

```bash
go run ./examples/a2aagent/error_handling
```

**预期输出：**

```
------- Agent Card -------
Name: agent_remote_joker
Description: I am a remote agent, I can tell a joke
URL: http://127.0.0.1:8888
------------------------
User: tell me a joke
======== remote agent ========
🤖 Assistant: Why don't scientists trust atoms? Because they make up everything!
======== local agent ========
🤖 Assistant: Why did the programmer quit his job? Because he didn't get arrays!
```

## 总结

本示例是 A2A 协议的综合性示例，覆盖了服务端搭建、客户端代理、消息钩子、自定义数据传输和结构化错误处理。关键收获：

- A2A Agent 实现了 `agent.Agent` 接口，远程调用与本地调用完全透明
- Hook 机制（`BuildMessageHook`/`ProcessMessageHook`）支持灵活的消息拦截和增强
- 自定义 DataPart 和结构化错误使 A2A 协议具备丰富的数据传输能力

进一步学习可参考 **a2amultipath** 示例了解单端口多 Agent 路由，以及 **a2asubagent** 示例了解多 Agent 协作编排。
