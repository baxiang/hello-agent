# AG-UI 协议示例 - Agent 与前端的标准化流式通信

## 概述

AG-UI（Agent-UI Protocol）是一个标准化的 Agent-to-UI 通信协议，定义了 Agent 运行生命周期、文本消息流、工具调用等事件的统一格式。本示例演示了如何用 tRPC-Agent-Go 搭建 AG-UI 服务端，并提供多种客户端接入方式（Raw Go 客户端、CopilotKit、TDesign Chat），是理解框架 Server 层和协议层的核心入口。

## 核心概念

**AG-UI 事件类型**：AG-UI 协议定义了一组标准事件，通过 SSE（Server-Sent Events）流式推送给客户端：
- `RunStartedEvent` / `RunFinishedEvent`：标记一次 Agent 运行的开始与结束
- `TextMessageStartEvent` / `TextMessageContentEvent` / `TextMessageEndEvent`：文本消息的生命周期
- `ToolCallStartEvent` / `ToolCallArgsEvent` / `ToolCallEndEvent` / `ToolCallResultEvent`：工具调用全过程
- `CustomEvent`：自定义扩展事件

**agui.Server**：框架提供的 HTTP Server 封装，自动处理 SSE 协议细节、将 Runner 的事件流翻译为 AG-UI 标准事件格式。

**消息快照（Message Snapshot）**：`messagessnapshot` 子示例展示了如何在 AG-UI 流中启用消息快照功能，让客户端可以获取完整的历史消息状态。

## 代码解析

### 服务端：最小化搭建 AG-UI Server

```go
// server/default/main.go
agent := llmagent.New(
    "agui-agent",
    llmagent.WithTools([]tool.Tool{calculatorTool}),
    llmagent.WithModel(modelInstance),
    llmagent.WithGenerationConfig(generationConfig),
    llmagent.WithInstruction("You are a helpful assistant."),
)
runner := runner.NewRunner(agent.Info().Name, agent)
defer runner.Close()
server, err := agui.New(runner, agui.WithPath(*path))
http.ListenAndServe(*address, server.Handler())
```

整个服务端搭建仅需三步：创建 Agent、创建 Runner、创建 AG-UI Server。`agui.New()` 接收 Runner 并返回一个标准的 `http.Handler`，自动将 Agent 的事件流转换为 AG-UI SSE 协议格式。

### Function Tool 注册

```go
calculatorTool := function.NewFunctionTool(
    calculator,
    function.WithName("calculator"),
    function.WithDescription("A calculator tool..."),
)
```

`function.NewFunctionTool` 接收一个类型安全的 Go 函数，通过结构体 Tag 自动生成 JSON Schema 描述。参数结构体的 `json` 和 `description` tag 会被框架解析并传递给 LLM。

### Go 客户端：消费 AG-UI 事件流

```go
// client/raw/main.go
client := sse.NewClient(sse.Config{Endpoint: endpoint})
payload := types.RunAgentInput{
    ThreadID: "demo-thread",
    Messages: []types.Message{{Role: types.RoleUser, Content: prompt}},
}
frames, errCh, err := client.Stream(sse.StreamOptions{Context: ctx, Payload: payload})
```

Go 客户端使用 AG-UI 官方 SDK 的 SSE Client，通过 `RunAgentInput` 结构体发送请求，获得事件帧 Channel。每个帧通过 `events.EventFromJSON()` 解析为强类型事件对象，客户端根据事件类型（如 `TextMessageContentEvent`）提取增量内容并展示。

### 多客户端支持

示例提供了四种客户端实现：
- **raw**：纯 Go 命令行客户端，直接消费 SSE 流
- **copilotkit**：基于 CopilotKit 的 React 前端
- **tdesign-chat**：基于 TDesign Chat 的 Vue 前端
- **event_emitter**：基于事件发射器模式的客户端

## 运行方式

**启动服务端**：

```bash
cd examples/agui
go run ./server/default -model deepseek-v4-flash
```

**方式一：Go 命令行客户端**：

```bash
go run ./client/raw -endpoint http://127.0.0.1:8080/agui
# 输入: Calculate 2*(10+11)
# 观察 ToolCall 事件和最终文本响应
```

**方式二：Web 前端客户端**：

```bash
cd client/tdesign-chat && pnpm install && pnpm dev
# 或
cd client/copilotkit && pnpm install && pnpm dev
```

**预期输出**（命令行客户端）：
```
Agent> [RUN_STARTED]
Agent> [TEXT_MESSAGE_START] message_id=msg-xxx
Agent> [TOOL_CALL_START] tool call 'calculator' started
Agent> [TOOL_CALL_ARGS] tool args: {"operation":"multiply","a":2,"b":21}
Agent> [TOOL_CALL_END] tool call completed
Agent> [TOOL_CALL_RESULT] tool result: {"result":42}
Agent> [TEXT_MESSAGE_CONTENT] The result is 42.
Agent> [TEXT_MESSAGE_END]
Agent> [RUN_FINISHED]
```

## 总结

AG-UI 示例是理解 tRPC-Agent-Go 协议层的最佳起点。核心收获：`agui.Server` 将 Runner 的内部事件流自动映射为标准 AG-UI 协议，实现了 Agent 后端与任意前端框架的解耦；Function Tool 的类型安全注册机制让工具调用过程对 LLM 透明且可追踪。该示例与 `a2ui` 示例的关系是：AG-UI 提供基础的文本流和工具调用协议，A2UI 在此之上增加了结构化 UI 渲染能力。
