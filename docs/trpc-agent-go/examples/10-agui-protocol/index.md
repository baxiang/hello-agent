# AG-UI 协议 - Agent-to-UI 前端实时交互

> **源码路径**：[`trpc-agent-go/examples/`](../../../../trpc-agent-go/examples)（本分类覆盖 agui/a2ui）
> **本页**：分类索引 + 深度原理（融合原 16-agui.md）

## 子示例导航

| 子示例 | 文章 | 难度 | 一句话说明 |
|--------|------|------|-----------|
| [`agui/`](./agui.md) | AG-UI 协议 | 入门 | 搭建 AG-UI 服务端，跑通文本流/工具调用/Agent 转移，对接 CopilotKit、TDesign、Raw Go 客户端 |
| [`a2ui/`](./a2ui.md) | A2UI 协议 | 进阶 | 在 AG-UI 之上用 A2UI 翻译器把 LLM 输出渲染成结构化交互组件（表单/问卷/数据面板） |

## 选型建议

```
需要 Agent ↔ 前端实时通信？
├── 只要文本流式 + 工具调用 + Agent 转移      → agui（标准 AG-UI 协议）
└── 要让 Agent 动态生成交互式 UI 组件          → a2ui（AG-UI 扩展，结构化渲染）

不确定要不要 AG-UI？
├── 单向推送（服务端 → 前端）即可             → AG-UI（SSE，最省事）
├── 需要双向实时（如协同编辑）                 → 用 WebSocket，不要 AG-UI
└── 一次性请求/后台批处理                      → 普通 REST 即可，无需 AG-UI

a2ui vs agui？
├── agui 是协议层：定义事件格式、SSE 推送
└── a2ui 是渲染层：在 agui 事件流上叠加 UI 组件翻译，依赖 agui 做传输
```

## 核心概念

- **AG-UI**：tRPC-Agent-Go 原生的 Agent-User Interaction 协议，基于 SSE 实时推送 Agent 执行全过程（思考→工具调用→工具结果→最终回复）。详见 [深度原理 › AG-UI 协议核心接口](#ag-ui-协议核心接口)
- **SSE 事件流**：服务器通过 `text/event-stream` 单向推送事件，浏览器 `EventSource` 自动重连。事件类型分文本流、工具调用、Agent 转移、自定义、运行状态五大类。详见 [深度原理 › SSE 事件流设计](#sse-事件流设计)
- **三大路由**：`/agui/chat`（发起对话）、`/agui/history`（历史快照）、`/agui/cancel`（取消运行）。详见 [深度原理 › AG-UI 协议核心接口](#ag-ui-协议核心接口)
- **EventEmitter 转换桥**：Graph 节点内 `EmitCustom/EmitProgress/EmitText` 自动翻译为 AG-UI 事件，业务无需手写协议层。详见 [深度原理 › SSE 事件流设计 › EventEmitter 转换桥](#eventemitter-转换桥)

## 深度原理

> 本节源自原「核心组件」深度文（16-agui.md），整合接口源码、设计哲学与配置速查。

### AG-UI 协议核心接口

#### 三大路由

| 路由 | 方法 | Content-Type | 说明 |
|------|------|-------------|------|
| `/agui/chat` | POST | `application/json` → `text/event-stream` | 发起对话，返回 SSE 事件流 |
| `/agui/history` | GET | `application/json` | 获取会话历史消息快照 |
| `/agui/cancel` | POST | `application/json` | 取消正在执行的对话 |

#### Chat 请求格式

```json
POST /agui/chat
Content-Type: application/json

{
    "app_name": "my-agent",
    "user_id": "user-1",
    "session_id": "session-1",
    "message": {
        "role": "user",
        "content": "北京今天天气怎么样？"
    },
    "stream": true
}
```

#### 服务端部署（Go）

```go
import "trpc.group/trpc-go/trpc-agent-go/server/agui"

func main() {
    agent := buildAgent()
    r := runner.NewRunner("my-app", agent)
    defer r.Close()

    server := agui.NewServer(
        agui.WithRunner(r),
        agui.WithPort(8081),
        agui.WithPath("/agui"),
    )

    server.Start()
}
```

`NewServer` 绑定一个 Runner，对外暴露 `chat`/`history`/`cancel` 三个路由（前缀由 `WithPath` 决定）。Agent 的 `<-chan *event.Event` 在服务端被翻译为 SSE 事件流推给前端。

#### 辅助路由

**History**（页面刷新恢复对话）：

```
GET /agui/history?app_name=my-agent&user_id=user-1&session_id=session-1
```

```json
{
    "messages": [
        {"role": "user", "content": "北京今天天气怎么样？"},
        {"role": "assistant", "content": "北京今天晴天，22°C。"}
    ],
    "session_id": "session-1",
    "updated_at": "2026-06-10T10:00:00Z"
}
```

**Cancel**（取消正在执行的对话）：

```json
POST /agui/cancel
{ "app_name": "my-agent", "user_id": "user-1", "session_id": "session-1", "request_id": "req-123" }
```

取消后 Agent 停止 LLM 调用和工具执行，前端收到 `run_error` 事件确认取消。

### SSE 事件流设计

#### 事件类型体系

| 事件类别 | event 名 | data 关键字段 | 语义 |
|----------|----------|--------------|------|
| 文本流（增量） | `text_message_content` | `content` | 增量文本块，前端累加拼接 |
| 文本流（结束） | `text_message_end` | `{}` | 当前消息的文本流结束 |
| 工具调用 | `tool_call` | `tool_call_id` / `tool_name` / `arguments` | Agent 发起工具调用 |
| 工具结果 | `tool_result` | `tool_call_id` / `result` | 工具执行返回 |
| Agent 转移 | `agent_transfer` | `from_agent` / `to_agent` / `message` | 子 Agent 委托/交接 |
| 自定义事件 | `custom_event` | `type` / `value`(或 `progress`/`message`) | Graph 节点透传业务事件 |
| 运行开始 | `run_started` | `run_id` | 一次运行开始 |
| 运行完成 | `run_finished` | `run_id` | 一次运行正常结束 |
| 运行出错 | `run_error` | `run_id` / `error` | 运行异常或被取消 |

#### 流式推送机制

文本以增量块逐字推送，工具调用与结果作为独立事件，运行状态用 `run_started`/`run_finished`/`run_error` 收口。典型事件序列：

```
event: run_started
data: {"run_id":"run-001"}

event: text_message_content      ← "让/我/查/一下" 逐块推送
data: {"content":"让"}

event: text_message_end
data: {}

event: tool_call
data: {"tool_call_id":"call_001","tool_name":"get_weather","arguments":{"city":"北京"}}

event: tool_result
data: {"tool_call_id":"call_001","result":{"temperature":22,"condition":"晴"}}

event: text_message_content      ← 最终回复逐块推送
data: {"content":"北京今天晴天，22°C"}

event: text_message_end
data: {}

event: run_finished
data: {"run_id":"run-001"}
```

前端据此可分别渲染：流式文本光标、工具调用卡片、Agent 转移动画、进度条、错误提示。

#### EventEmitter 转换桥

Graph 节点中使用 `EventEmitter` 发射的事件会自动转换为 AG-UI 事件，业务侧无需手写 SSE 协议。接口签名（`graph.EventEmitter`）：

```go
type EventEmitter interface {
    Emit(evt *event.Event) error
    EmitCustom(eventType string, payload any) error
    EmitProgress(progress float64, message string) error
    EmitText(text string) error
    Context() context.Context
}
```

节点内通过 `graph.GetEventEmitter(state)` 取出 emitter：

```go
emitter := graph.GetEventEmitter(state)
emitter.EmitCustom("data.loaded", payload)
emitter.EmitProgress(50.0, "half done")
emitter.EmitText("result summary")
```

**自动转换映射**（AG-UI Translator 完成）：

| Node 调用 | AG-UI 事件 | 说明 |
|-----------|-----------|------|
| `EmitCustom("data.loaded", {...})` | `custom_event` | payload 放 `value` 字段 |
| `EmitProgress(50.0, "half done")` | `custom_event` | 含 `progress` / `message` |
| `EmitText("result")`（消息上下文内） | `text_message_content` | 当作流式文本块 |
| `EmitText("result")`（消息上下文外） | `custom_event` | 含 `nodeId` / `content` |

> 设计要点：`EmitText` 是否落在"消息上下文内"决定它被翻译成文本流还是自定义事件——这让同一个 API 能在"正在回复用户"与"节点内部处理"两种语境下复用，无需调用方关心协议细节。

### 前端集成架构

Agent 的内部事件流（`<-chan *event.Event`）→ AG-UI 服务端翻译为 SSE → 前端通过三种方式消费：

| 集成方式 | 适用 | 协议处理 |
|----------|------|---------|
| CopilotKit | React 应用，内置 AG-UI 适配 | 自动解析 SSE、渲染 UI |
| TDesign Chat | 腾讯 TDesign 生态 | 回调式接入，工具/转交有钩子 |
| 自定义前端 | 任意语言/框架 | 手动 `fetch` + 流式读 `data:` 行 |

#### CopilotKit

```tsx
import { CopilotKit } from "@copilotkit/react-core";

function App() {
  return (
    <CopilotKit runtimeUrl="http://localhost:8081/agui/chat">
      <YourChatComponent />
    </CopilotKit>
  );
}
```

CopilotKit 内置 AG-UI 协议适配，自动处理 SSE 事件解析和 UI 渲染。

#### TDesign Chat

```tsx
import { TDesignChat } from "@tdesign-react/chat";

function App() {
  return (
    <TDesignChat
      endpoint="http://localhost:8081/agui/chat"
      onToolCall={(tool) => showToolCard(tool)}
      onTransfer={(from, to) => showTransferAnimation(from, to)}
    />
  );
}
```

#### 自定义前端（事件分发骨架）

```javascript
async function chat(message) {
  const response = await fetch('/agui/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      app_name: 'my-agent', user_id: 'user-1', session_id: 'session-1',
      message: { role: 'user', content: message }, stream: true,
    }),
  });

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let currentText = '';
  let eventType = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    for (const line of decoder.decode(value).split('\n')) {
      if (line.startsWith('event: '))      eventType = line.slice(7).trim();
      else if (line.startsWith('data: '))  handleEvent(eventType, JSON.parse(line.slice(6)));
    }
  }
}

function handleEvent(type, data) {
  switch (type) {
    case 'text_message_content': currentText += data.content; updateUI(currentText); break;
    case 'text_message_end':     finalizeMessage(); break;
    case 'tool_call':            showToolCallCard(data.tool_name, data.arguments); break;
    case 'tool_result':          showToolResult(data.tool_call_id, data.result); break;
    case 'run_error':            showError(data.error); break;
  }
}
```

#### 状态同步设计

- **会话恢复**：页面刷新后先 `GET /agui/history` 拉历史快照重建消息列表，再发起新 `/agui/chat` 续接
- **取消传播**：前端 `POST /agui/cancel` → 服务端停 Agent → 前端收 `run_error` 确认，保证取消可见
- **文本累加**：`text_message_content` 是增量，前端维护缓冲区，`text_message_end` 落定一轮
- **工具可见性**：`tool_call`/`tool_result` 用 `tool_call_id` 配对，前端渲染独立卡片而非塞进文本流

### 设计哲学

#### 为什么选择 SSE 而非 WebSocket？

| | AG-UI | REST API | WebSocket |
|----|----|----|----|
| **通信模式** | SSE（单向推送） | 请求-响应 | 双向 |
| **流式支持** | 原生 | 需 chunked | 原生 |
| **前端复杂度** | 低（EventSource） | 低（fetch） | 中（ws 库） |
| **代理兼容** | HTTP | HTTP | 部分代理不支持 |
| **重连** | 浏览器自动 | N/A | 手动 |
| **适用场景** | Agent 实时交互 | 批量/后台 | 实时双向（如协作编辑） |

选 SSE 的三个理由：

1. **Agent 场景是单向推送**（服务器→前端），不需要双向通信，WebSocket 的全双工能力是过剩开销
2. **SSE 基于 HTTP**，兼容所有反向代理、负载均衡器、CDN，部署零特殊配置
3. **浏览器原生 `EventSource` 自动重连**，前端零配置即可获得断线恢复

> 这与 Runner「Agent 通过 channel 单向返回事件流」的模型天然契合——服务端只需把 channel 事件按序翻译为 SSE 行，无需任何双向状态机。

#### 与 A2A / MCP 的边界

AG-UI 在协议栈中的定位是**专攻 Agent ↔ 用户（前端）的交互层**，与另两个协议正交：

| 协议 | 通信两端 | 解决的问题 | 在 AG-UI 中的角色 |
|------|---------|-----------|------------------|
| **AG-UI** | Agent ↔ 前端（用户） | 把执行过程实时推给用户 | 本体 |
| **A2A** | Agent ↔ Agent | 多 Agent 间委托/调用 | AG-UI 的 `agent_transfer` 事件是其在 UI 层的投影 |
| **MCP** | Agent ↔ 工具/模型 | 标准化工具与模型接入 | AG-UI 的 `tool_call`/`tool_result` 在 UI 层呈现 MCP 工具 |

要点：AG-UI 不替代 A2A/MCP，而是把它们在 Agent 内部发生的事**显式投影到前端**。底层 Agent 仍可用 A2A 做多 Agent 编排、用 MCP 接工具，AG-UI 只负责"让用户看见并交互"。

#### AG-UI 解决的核心问题

传统 REST API 只能等 Agent 执行完毕再返回结果，用户体验是"转圈→结果"。AG-UI 通过 SSE 实时推送每一步（LLM 思考→工具调用→工具结果→最终回复），延迟更低、过程透明、可中途取消。

### 配置速查

#### AG-UI Server 配置（`agui.NewServer` functional options）

| 配置 | 类型 | 说明 | 默认 |
|------|------|------|------|
| `WithRunner(r)` | `*runner.Runner` | 绑定的 Runner 实例，Agent 执行入口 | 必填 |
| `WithPort(port)` | `int` | HTTP 监听端口 | 必填 |
| `WithPath(path)` | `string` | 路由前缀（`<path>/chat`、`<path>/history`、`<path>/cancel`） | `/agui` |

#### Chat 请求字段（`/agui/chat` body）

| 字段 | 类型 | 说明 |
|------|------|------|
| `app_name` | `string` | 应用名（多租户隔离） |
| `user_id` | `string` | 用户标识 |
| `session_id` | `string` | 会话标识（决定历史归属） |
| `message.role` | `string` | 消息角色（一般 `user`） |
| `message.content` | `string` | 用户输入文本 |
| `stream` | `bool` | 是否流式（AG-UI 场景恒为 `true`） |

## 学习路径建议

1. **先读 [`agui`](./agui.md)**：跑通最小 AG-UI 服务端，用 Raw Go 客户端看到完整 SSE 事件序列，建立"事件流"直觉
2. **对照本页「SSE 事件流设计」**：把客户端打印的事件与事件类型体系一一对应，理解 `tool_call`/`tool_result` 的 `tool_call_id` 配对
3. **再试 CopilotKit / TDesign 接入**：体验协议适配层如何把裸事件渲染成 UI 卡片
4. **进阶读 [`a2ui`](./a2ui.md)**：理解在 AG-UI 之上如何叠加 A2UI 翻译器，把输出变成结构化交互组件
5. **回到本页「深度原理」节**：重读 EventEmitter 转换桥与设计哲学，理解"AG-UI 是 A2A/MCP 在前端的投影"

## 总结

AG-UI 分类的设计精髓在于**协议极简、传输单向、关注正交**：

- **三大路由 + 一套事件类型**覆盖发起、历史、取消全生命周期，事件分文本流/工具/转交/自定义/运行状态五类
- **SSE 单向推送**与 Runner 的 channel 事件流模型天然契合，浏览器自动重连、代理全兼容
- **EventEmitter 转换桥**让业务零成本接入——节点内 `Emit*` 自动翻译为 AG-UI 事件
- **与 A2A/MCP 正交**：AG-UI 不替代它们，只把 Agent 内部发生的事投影给前端

进一步学习：

- Runner 与 Agent 事件流基础：[`01-agent-basics`](../01-agent-basics/)
- Graph 节点 EventEmitter 深度：[`11-graph-advanced`](../../11-graph-advanced.md)
- Server 层全景：[`12-server`](../../12-server.md)
- 宏观架构与协议栈定位：[`18-architecture`](../../18-architecture.md) / [`19-diagrams`](../../19-diagrams.md)
