# Session 直接追加事件 - 绕过模型写入会话历史

> **源码路径**：[`trpc-agent-go/examples/session/appendevent/`](../../../../trpc-agent-go/examples/session/appendevent)
> **示例类型**：交互式 Chat · **难度**：入门

## 概述

`appendevent/` 演示一种"绕过模型"的会话写入姿势：用 `session.Service.AppendEvent` 直接把消息持久化到会话，**不触发任何 LLM 调用**。后续用 `Runner.Run()` 发正常消息时，框架会自动加载这些预置事件，作为上下文一并喂给模型。

这正是预加载对话历史、注入系统上下文、记录用户操作元数据的标准做法。与 [`simple`](./session-simple.md) 的对比：simple 的每条消息都经过模型；appendevent 让你能"先填档、再对话"。

## 核心概念

### Event = 会话历史的原子单位

一个 Event 既能表示用户请求，也能表示模型响应。`Runner.Run()` 每次都会自动产生 2 类事件（用户消息 + 模型响应）；而 `AppendEvent` 允许你**手动**追加任意角色（user/system/assistant）的事件，无需经过模型。

### 手工构造事件的必备字段

`event.NewResponseEvent(invocationID, author, response)` 三个参数都必填：

| 字段 | 含义 | 取值建议 |
|------|------|---------|
| `invocationID` | 本次调用的唯一标识 | `uuid.New().String()` |
| `author` | 事件作者 | `"user"` / `"system"` / agent 名 |
| `response` | 响应对象 | 必须含 `Choices[].Message`，且 `Message.Content` 或 `ContentParts` 非空 |

> **持久化前提**：`Response != nil`、`!IsPartial`、`IsValidContent()` 为真。`ID` / `Timestamp` / `Version` 由 `NewResponseEvent` 自动生成。

### 三步直写流程

```go
// 1. 取（或创建）会话
sess, _ := c.sessionSvc.GetSession(ctx, sessionKey)
if sess == nil {
    sess, _ = c.sessionSvc.CreateSession(ctx, sessionKey, session.StateMap{})
}

// 2. 用 NewResponseEvent 构造事件
invocationID := uuid.New().String()
evt := event.NewResponseEvent(invocationID, author, &model.Response{
    Done: false,
    Choices: []model.Choice{{Index: 0, Message: message}},
})
evt.RequestID = uuid.New().String()  // 可选：便于追踪

// 3. 持久化
c.sessionSvc.AppendEvent(ctx, sess, evt)
```

## 代码解析

### 角色化追加（`main.go`）

示例提供三个命令分别对应三种角色的事件：

```go
func (c *appendEventChat) appendSystemMessage(ctx context.Context, content string) error {
    message := model.Message{Role: model.RoleSystem, Content: content}
    return c.appendMessageToSession(ctx, message, "system")
}
// appendUserMessage → model.NewUserMessage(content)
// appendAssistantMessage → model.Message{Role: model.RoleAssistant, ...}
```

三个函数最终都汇入 `appendMessageToSession`（见上"三步直写流程"），差异只在 `model.Message.Role` 和 author。

### 运行时自动加载

直写的事件不会立即被模型处理；它们只是"躺在档案里"。当用户发一条**正常消息**时，`Runner.Run()` 会：

1. 加载会话（含所有手工追加的事件）
2. 把事件转回 `model.Message` 列表
3. 拼接本轮新消息，整体发给模型

因此 `/append-system You are a Go expert.` 之后再发"什么是 goroutine"，模型会"看到"这条系统指令并据此作答——尽管它从未真正"说过"这句话。

### 事件检视（`listEvents`）

`/events` 命令调 `sess.GetEventCount()` 并遍历 `sess.Events`（在 `sess.EventMu.RLock()` 保护下），打印每个事件的 `ID` / `Author` / `Timestamp` / `Role` / `Content`，是验证直写效果的直观手段。

```go
sess.EventMu.RLock()
for i, evt := range sess.Events {
    fmt.Printf("Event %d: ID=%s Author=%s Role=%s\n", ...)
}
sess.EventMu.RUnlock()
```

## 运行方式

### 环境变量

| 变量 | 必需 | 说明 | 默认值 |
|------|------|------|--------|
| `OPENAI_API_KEY` | 是 | 模型 API Key | — |
| `OPENAI_BASE_URL` | 否 | 模型端点 | `https://api.openai.com/v1` |

> 本示例**硬编码使用 inmemory 后端**（`sessioninmemory.NewSessionService()`），不支持 `-session` 切换。

### 命令行参数

| 参数 | 说明 | 默认值 |
|------|------|--------|
| `-model` | 模型名 | `deepseek-v4-flash` |
| `-streaming` | 流式输出 | `true` |

### 运行命令

> **注意**：本目录有 `main.go` 和 `helper.go` 两个文件，必须**同时编译**。

```bash
cd examples/session/appendevent
export OPENAI_API_KEY="your-api-key"

go run main.go helper.go                              # 默认流式
go run main.go helper.go -model gpt-4o -streaming=false
```

### 交互命令

| 命令 | 作用 |
|------|------|
| `/append <message>` | 直写一条 **user** 消息 |
| `/append-system <message>` | 直写一条 **system** 消息 |
| `/append-assistant <msg>` | 直写一条 **assistant** 消息 |
| `/events` | 列出当前会话所有事件 |
| `/new` | 新建会话 |
| `/use <id>` | 切到指定会话 |
| `/sessions` | 列出已知会话 |
| `/exit` | 退出 |

### 预期输出

```
🚀 AppendEvent Demo
==================================================
✅ Chat ready! Session: session-1718600000

👤 You: /append-system You are a helpful assistant specialized in Go programming.
✅ Message appended to session (author: system)

👤 You: /append Hello, I'm learning Go.
✅ Message appended to session (author: user)

👤 You: /events
📋 Session: session-1718600000
   Total events: 2
   Event 1:
     Author: system
     Role: system
     Content: You are a helpful assistant specialized in Go programming.
   Event 2:
     Author: user
     Role: user
     Content: Hello, I'm learning Go.

👤 You: What is a goroutine?
🤖 Assistant: A goroutine is a lightweight thread managed by the Go runtime...
```

## 适用场景与对比

**选 appendevent 当：**
- 启动时需要预灌系统上下文/历史对话
- 要把外部数据源（CRM、工单）转成对话历史
- 想记录用户操作作为隐式上下文（"用户刚点了收藏"）
- 单元测试中需要快速构造会话夹具

**对比 [`simple`](./session-simple.md)：**

| 维度 | simple | appendevent |
|------|--------|-------------|
| 写入触发方 | 模型一轮对话产生 2 事件 | 用户命令直写，可任意角色 |
| 是否调模型 | 每条消息都调 | `/append*` 不调，普通消息才调 |
| 后端 | 9 种可切换 | 仅 inmemory |
| 文件数 | 1（main.go） | 2（main.go + helper.go） |

## 关键要点

1. **绕过模型**：`AppendEvent` 是会话的"后门写入"，不消耗模型 token。
2. **三必填**：`invocationID` + `author` + 含 `Choices.Message` 的 `Response`，缺一不可。
3. **运行时自动加载**：手工事件在下次 `Runner.Run()` 时自动并入上下文，模型无感。
4. **角色自由**：可伪造任意角色（user/system/assistant），适合构造"假装发生过"的对话。
5. **两文件编译**：`go run main.go helper.go`，漏掉 helper.go 会编译失败。

## 总结

appendevent 揭示了 Session 的另一面：它不只是"模型的备忘录"，更是**可编程的历史档案**。理解了 AppendEvent，就能解释 [`hook`](./session-hook.md) 里"直接追加模拟用户断线"的技巧，也更容易在 [`graph`](./session-graph.md) 里看清图编排结果如何沉淀为会话状态。需要多后端持久化时，回到 [`simple`](./session-simple.md) 即可。
