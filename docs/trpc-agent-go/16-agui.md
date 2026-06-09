# AG-UI 协议 — 规范·实现·集成

AG-UI（Agent-User Interaction）是 tRPC-Agent-Go 原生的 Agent-前端实时交互协议，基于 SSE（Server-Sent Events）流式推送 Agent 执行全过程。

## 1. 协议定位

```
                 传统方式                          AG-UI 方式
              ┌──────────┐                    ┌──────────┐
              │ 前端 Poll │                    │ 前端 SSE  │
              │ 5s/次轮询 │                    │ 实时接收  │
              └────┬─────┘                    └────┬─────┘
                   │                               │
              ┌────▼─────┐                    ┌────▼─────┐
              │  REST API │                    │  AG-UI   │
              │ /chat     │                    │ /chat    │
              └────┬─────┘                    └────┬─────┘
                   │                               │
              ┌────▼─────┐                    ┌────▼─────┐
              │  Agent    │                    │  Agent    │
              │  直接执行  │                    │  流式推送  │
              └──────────┘                    └──────────┘

  前端不知道工具调用过程                   前端看到完整思考链
```

**AG-UI 解决的核心问题**：传统 REST API 只能等 Agent 执行完毕再返回结果，用户看到的是"转圈→结果"。AG-UI 通过 SSE 实时推送每一步：LLM 思考→工具调用→工具结果→最终回复，比传统方式延迟更低、体验更好。

## 2. 协议规范

### 2.1 三大路由

| 路由 | 方法 | Content-Type | 说明 |
|------|------|-------------|------|
| `/agui/chat` | POST | `application/json` → `text/event-stream` | 发起对话，返回 SSE 事件流 |
| `/agui/history` | GET | `application/json` | 获取会话历史消息快照 |
| `/agui/cancel` | POST | `application/json` | 取消正在执行的对话 |

### 2.2 Chat 请求格式

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

### 2.3 SSE 事件类型

#### 2.3.1 文本消息（流式增量）

```
event: text_message_content
data: {"content": "北"}

event: text_message_content
data: {"content": "京"}

event: text_message_content
data: {"content": "今天"}

event: text_message_content
data: {"content": "晴天"}

...

event: text_message_end
data: {}
```

每个 `text_message_content` 是一个增量文本块，前端累加拼接显示。`text_message_end` 标记当前消息的文本流结束。

#### 2.3.2 工具调用

```
event: tool_call
data: {
    "tool_call_id": "call_abc123",
    "tool_name": "get_weather",
    "arguments": {"city": "北京", "unit": "celsius"}
}

event: tool_result
data: {
    "tool_call_id": "call_abc123",
    "tool_name": "get_weather",
    "result": {"temperature": 22, "condition": "晴", "humidity": 0.45}
}
```

前端可利用这些事件渲染工具调用卡片（显示调用参数和返回结果）。

#### 2.3.3 Agent 转移（委托）

```
event: agent_transfer
data: {
    "from_agent": "coordinator",
    "to_agent": "weather_specialist",
    "message": "Handing off to weather specialist"
}
```

前端可渲染委托动画或路由提示。

#### 2.3.4 自定义事件（来自 Graph Node EventEmitter）

```
event: custom_event
data: {
    "type": "data.loaded",
    "value": {"source": "database", "records": 10000}
}

event: custom_event
data: {
    "type": "progress",
    "progress": 50.0,
    "message": "Processing 500/1000"
}
```

#### 2.3.5 运行状态

```
event: run_started
data: {"run_id": "run-xyz"}

event: run_finished
data: {"run_id": "run-xyz"}

event: run_error
data: {"run_id": "run-xyz", "error": "timeout exceeded"}
```

#### 2.3.6 完整事件流示例

```
POST /agui/chat → SSE 连接建立

event: run_started
data: {"run_id":"run-001"}

event: text_message_content
data: {"content":"让"}

event: text_message_content
data: {"content":"我"}

event: text_message_content
data: {"content":"查"}

event: text_message_content
data: {"content":"一下"}

event: text_message_end
data: {}

event: tool_call
data: {"tool_call_id":"call_001","tool_name":"get_weather","arguments":{"city":"北京"}}

event: tool_result
data: {"tool_call_id":"call_001","result":{"temperature":22,"condition":"晴"}}

event: text_message_content
data: {"content":"北京"}

event: text_message_content
data: {"content":"今天"}

event: text_message_content
data: {"content":"晴天"}

event: text_message_content
data: {"content":"，22°C"}

event: text_message_end
data: {}

event: run_finished
data: {"run_id":"run-001"}

—— SSE 连接关闭 ——
```

## 3. 部署

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

---

## 4. 前端集成

### 4.1 CopilotKit 集成

```tsx
import { CopilotKit } from "@copilotkit/react-core";

function App() {
  return (
    <CopilotKit
      runtimeUrl="http://localhost:8081/agui/chat"
    >
      <YourChatComponent />
    </CopilotKit>
  );
}
```

CopilotKit 内置 AG-UI 协议适配，自动处理 SSE 事件解析和 UI 渲染。

### 4.2 TDesign Chat 集成

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

### 4.3 自定义前端适配

```javascript
const eventSource = new EventSource('http://localhost:8081/agui/chat');

// 需要先 POST 发起对话，然后通过 SSE channel 接收
async function chat(message) {
  const response = await fetch('/agui/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      app_name: 'my-agent',
      user_id: 'user-1',
      session_id: 'session-1',
      message: { role: 'user', content: message },
      stream: true,
    }),
  });

  const reader = response.body.getReader();
  const decoder = new TextDecoder();

  let currentText = '';
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    const text = decoder.decode(value);
    const lines = text.split('\n');

    for (const line of lines) {
      if (line.startsWith('event: ')) {
        const eventType = line.slice(7).trim();
        // 下一个 data: 行是事件数据
        continue;
      }
      if (line.startsWith('data: ')) {
        const data = JSON.parse(line.slice(6));
        handleEvent(eventType, data);
      }
    }
  }
}

function handleEvent(type, data) {
  switch (type) {
    case 'text_message_content':
      currentText += data.content;
      updateUI(currentText);
      break;
    case 'text_message_end':
      finalizeMessage();
      break;
    case 'tool_call':
      showToolCallCard(data.tool_name, data.arguments);
      break;
    case 'tool_result':
      showToolResult(data.tool_call_id, data.result);
      break;
    case 'run_error':
      showError(data.error);
      break;
  }
}
```

---

## 5. EventEmitter → AG-UI 转换桥

Graph 节点中使用 `EventEmitter` 发射的事件会自动转换为 AG-UI 协议：

```go
// Node 中发射
emitter := graph.GetEventEmitter(state)
emitter.EmitCustom("data.loaded", payload)
emitter.EmitProgress(50.0, "half done")
emitter.EmitText("result summary")
```

```
┌──────────────────────────────────────────────┐
│            AG-UI Translator                   │
│                                                │
│  EmitCustom("data.loaded", {...})             │
│      → event: custom_event                    │
│        data: {"type":"data.loaded","value":{}}│
│                                                │
│  EmitProgress(50.0, "half done")              │
│      → event: custom_event                    │
│        data: {"type":"progress",              │
│               "progress":50.0,                │
│               "message":"half done"}          │
│                                                │
│  EmitText("result")  (消息上下文内)            │
│      → event: text_message_content            │
│        data: {"content":"result"}             │
│                                                │
│  EmitText("result")  (消息上下文外)            │
│      → event: custom_event                    │
│        data: {"type":"text",                  │
│               "nodeId":"..","content":".."}   │
└──────────────────────────────────────────────┘
```

---

## 6. History 路由

```
GET /agui/history?app_name=my-agent&user_id=user-1&session_id=session-1
```

返回：

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

用于页面刷新后恢复对话历史。

## 7. Cancel 路由

```
POST /agui/cancel
Content-Type: application/json

{
    "app_name": "my-agent",
    "user_id": "user-1",
    "session_id": "session-1",
    "request_id": "req-123"
}
```

取消当前正在执行的对话，Agent 停止 LLM 调用和工具执行。前端收到 `run_error` 事件确认取消。

---

## 8. 协议对比

| | AG-UI | REST API | WebSocket |
|----|----|----|----|
| **通信模式** | SSE（单向推送） | 请求-响应 | 双向 |
| **流式支持** | ✅ 原生 | ❌ 需 chunked | ✅ 原生 |
| **前端复杂度** | 低（EventSource） | 低（fetch） | 中（ws 库） |
| **代理兼容** | ✅ HTTP | ✅ HTTP | ⚠️ 部分代理 |
| **重连** | 浏览器自动 | N/A | 手动 |
| **适用场景** | Agent 实时交互 | 批量/后台 | 实时双向（如协作编辑） |

AG-UI 选择 SSE 而非 WebSocket 的原因：
- Agent 场景是单向推送（服务器→前端），不需要双向通信
- SSE 基于 HTTP，兼容所有代理和负载均衡器
- 浏览器原生 `EventSource` 自动重连，前端零配置
