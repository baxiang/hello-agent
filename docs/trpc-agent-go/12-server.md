# Server 与协议 — 部署·AG-UI·A2A

本文覆盖 tRPC-Agent-Go 的生产部署方案、AG-UI 实时交互协议、A2A 跨框架互操作协议。

## 1. Gateway HTTP 服务

### 1.1 最简部署

```go
import "trpc.group/trpc-go/trpc-agent-go/server/gateway"

func main() {
    agent := buildAgent()
    r := runner.NewRunner("my-app", agent)
    defer r.Close()

    server := gateway.NewServer(
        gateway.WithRunner(r),
        gateway.WithPort(8080),
        gateway.WithHost("0.0.0.0"),
    )

    server.Start()
}
```

### 1.2 Gateway 内部架构

```
HTTP Request
    │
    ▼
Gateway Handler
    │
    ├─ 路由匹配
    ├─ 会话管理（Session Service）
    ├─ 调用 Runner.Run()
    ├─ SSE 流式推送（实时）
    └─ 错误转换与返回
```

### 1.3 安全控制（OpenClaw Runtime）

```go
server := openclaw.NewServer(
    openclaw.WithRunner(r),
    openclaw.WithSessionStore(sessionService),
    openclaw.WithAllowlist([]string{"user-1", "user-2"}),
    openclaw.WithMentionGating(true),  // 仅 @mention 时响应
    openclaw.WithTelegramBot(token),
)
```

**OpenClaw 的安全设计**：
- **Allowlist**：白名单用户才能使用
- **Mention Gating**：群聊中需要 @机器人 才回复
- **Stable Session IDs**：跨重启的稳定会话标识
- **Per-Session 序列化**：同一会话串行处理，避免竞态

---

## 2. AG-UI 协议

### 2.1 协议概述

AG-UI（Agent-User Interaction）是 tRPC-Agent-Go 定义的实时交互协议，基于 SSE（Server-Sent Events）。它将 Agent 的执行过程实时推送到前端。

### 2.2 三大路由

| 路由 | 方法 | 功能 |
|------|------|------|
| `/agui/chat` | POST | 发起对话，返回 SSE 事件流 |
| `/agui/history` | GET | 获取会话历史消息快照 |
| `/agui/cancel` | POST | 取消正在执行的对话 |

### 2.3 SSE 事件类型

```
event: text_message_content
data: {"content": "Hello"}

event: text_message_content
data: {"content": ", how can I help?"}

event: tool_call
data: {"tool_name": "get_weather", "arguments": {...}}

event: tool_result
data: {"tool_name": "get_weather", "result": {...}}

event: text_message_content
data: {"content": "The weather in Beijing is sunny..."}

event: run_finished
data: {}
```

### 2.4 部署 AG-UI 服务

```go
import "trpc.group/trpc-go/trpc-agent-go/server/agui"

server := agui.NewServer(
    agui.WithRunner(r),
    agui.WithPort(8081),
    agui.WithPath("/agui"),
)

server.Start()
```

### 2.5 前端集成

AG-UI 兼容两种前端框架：
- **CopilotKit**：React 组件库，直接在 JSX 中使用 AG-UI 后端
- **TDesign Chat**：腾讯 TDesign 体系下的聊天组件

### 2.6 事件转换管道

当 Graph 节点使用 EventEmitter 时，事件会自动转换为 AG-UI 协议：

```
NodeFunc.EmitCustom("data.loaded", payload)
        │
        ▼
AG-UI Translator
        │
        ▼
SSE: event: custom_event
     data: {"type": "data.loaded", "value": {...}}
```

---

## 3. A2A 协议

### 3.1 协议概述

A2A（Agent-to-Agent）是 Google 提出的跨框架 Agent 互操作标准。tRPC-Agent-Go 通过 `tRPC-A2A-Go` 实现了完整的 A2A 客户端和服务端。

### 3.2 A2A Agent 客户端

```go
import "trpc.group/trpc-go/trpc-agent-go/agent/a2aagent"

a2aAgent := a2aagent.New(
    a2aagent.WithA2AClient(a2aClient),
    a2aagent.WithStreaming(true),
)

// 将远程 A2A Agent 当作本地 Agent 使用
coordinator := llmagent.New("coordinator",
    llmagent.WithSubAgents([]agent.Agent{a2aAgent}),
)
```

### 3.3 A2A 工作流程

```
[本地 Agent]                          [远程 A2A Agent]
    │                                       │
    ├─ 发起任务（Task）                      │
    │   ├─ task_id: UUID                    │
    │   ├─ message: 用户输入                 │
    │   └─ context: 上下文                   │
    │                                       │
    ├──────── HTTP POST /tasks ──────────→  │
    │                                       ├─ 处理任务
    │                                       ├─ 调用自己的 LLM/Tools
    │  ←──────── SSE 流式推送 ────────────  │
    │                                       │
    ├─ 收到最终结果                           │
    └─ 合并到本地响应                          │
```

### 3.4 A2A 与 AgentTool 对比

| | A2A Agent | AgentTool |
|----|----|----|
| **通信** | HTTP/SSE 远程调用 | 进程内调用 |
| **协议** | A2A 标准协议 | 框架内部接口 |
| **跨语言** | ✅（任何语言的 A2A 实现） | ❌（仅 Go） |
| **延迟** | 网络延迟 | 函数调用延迟 |
| **解耦** | 强（独立部署） | 弱（同一进程） |

---

## 4. 生产部署清单

### 4.1 核心组件配置

```
1. Session 持久化
   └─ 生产：Redis / PostgreSQL（非 dev: Memory）

2. Memory 持久化
   └─ 生产：Redis / PostgreSQL / PGVector

3. 可观测性
   └─ OTel SDK → Collector → Jaeger/Prometheus

4. 安全
   ├─ ToolPermissionPolicy
   ├─ MaxLLMCalls / MaxToolIterations
   └─ Allowlist / Mention Gating

5. 日志
   └─ 结构化日志 + spanID 关联

6. 健康检查
   └─ /health endpoint + 就绪探针
```

### 4.2 容器化部署

```dockerfile
FROM golang:1.22-alpine AS builder
WORKDIR /app
COPY . .
RUN go build -o /server ./cmd/server

FROM alpine:3.19
COPY --from=builder /server /server
EXPOSE 8080
CMD ["/server"]
```

```yaml
# Kubernetes Service 配置要点
env:
  - name: SESSION_BACKEND
    value: "redis"
  - name: REDIS_URL
    valueFrom:
      secretKeyRef:
        name: agent-secrets
        key: redis-url
```
