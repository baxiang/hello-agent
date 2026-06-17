# A2A ADK 互操作示例 - Go 客户端对接 Python ADK 服务器

## 概述

本示例演示如何使用 tRPC-Agent-Go 的 A2A 客户端与 Python ADK（Agent Development Kit）A2A 服务器进行跨语言互操作。示例包含两个场景：工具调用（Tool Call）和代码执行（Code Execution），展示了 A2A 协议在异构技术栈间实现无缝 Agent 通信的能力。

## 核心概念

### A2A 协议跨语言互操作

A2A（Agent-to-Agent）协议是一个标准化的 Agent 间通信协议，基于 HTTP/JSON 传输。由于协议本身与语言无关，不同语言实现的 Agent 可以通过 A2A 协议直接通信。本示例中，Go 客户端通过 `a2aagent` 包连接到 Python ADK 服务器，验证了这种跨语言互操作性。

### ADK 兼容性处理

ADK 的 A2A 实现存在一些特殊行为，tRPC-Agent-Go 的客户端进行了针对性适配：

- **累积式流式传输**：ADK 的每个流式事件发送的是"截至目前的完整内容"，而非增量内容。客户端通过捕获最后一个有效的中间事件来获取完整响应
- **最终事件重复**：ADK 可能发送格式异常的最终事件，客户端忽略最终事件的 payload
- **代码执行事件去重**：ADK 可能重复发送相同 MessageID 的代码执行事件，客户端通过 MessageID 去重

## 代码解析

**1. 创建 A2A Agent 客户端**

```go
a2aAgent, err := a2aagent.New(
    a2aagent.WithAgentCardURL(*agentURL),
)
```

通过 `WithAgentCardURL` 指定远程 ADK 服务器地址，客户端自动从 `/.well-known/agent.json` 发现并解析 Agent Card 元数据。

**2. 构建 Runner 执行查询**

```go
sessionService := inmemory.NewSessionService()
agentRunner := runner.NewRunner("test", a2aAgent, runner.WithSessionService(sessionService))
defer agentRunner.Close()

events, err := agentRunner.Run(ctx, userID, sessionID, model.NewUserMessage(query))
```

A2A Agent 实现了标准的 `agent.Agent` 接口，可以直接交给 Runner 调度。对调用方而言，远程 Agent 与本地 Agent 的使用方式完全一致。

**3. 处理 ADK 累积式流式响应**

```go
if !evt.IsFinalResponse() {
    if content := captureFinalContent(evt); content != "" {
        lastValidContent = content
    }
}
if evt.IsFinalResponse() {
    fmt.Println(lastValidContent)
}
```

针对 ADK 的累积式传输特性，客户端仅从非最终事件中捕获内容，并在收到最终事件时输出最后一次有效内容。

**4. 处理代码执行事件（Code Execution 场景）**

```go
if evt.Response.Object == model.ObjectTypePostprocessingCodeExecution &&
    evt.ContainsTag(event.CodeExecutionResultTag) {
    // 处理代码执行结果
}
```

代码执行事件通过 `ObjectType` 和 `Tag` 两个字段联合区分：同为 `postprocessing.code_execution` 类型，`code` 标签表示代码内容，`code_execution_result` 标签表示执行结果。

## 运行方式

**环境准备：**

```bash
# Python 端
cd examples/a2aadk/adk
python3 -m venv venv && source venv/bin/activate
pip install -r requirements.txt
export OPENAI_API_KEY="your-key"

# 启动 ADK 服务器（工具调用场景）
python3 adk_server.py          # 监听 8081 端口

# 启动 ADK 服务器（代码执行场景）
python3 adk_codeexec_server.py # 监听 8082 端口
```

```bash
# Go 客户端
cd trpc-agent-go

# 工具调用场景
go run ./examples/a2aadk/trpc_agent --url http://localhost:8081

# 代码执行场景
go run ./examples/a2aadk/trpc_agent_codeexec --url http://localhost:8082
```

**预期输出（工具调用）：**

```
Test 3: Tool Calling Query
--------------------------
Query: What is 123 + 456? And what time is it now?

🔧 Tool calls initiated:
   • calculator (ID: ...)
   • current_time (ID: ...)

🤖 Assistant:
123 + 456 = 579. The current time is ...
```

## 总结

本示例验证了 A2A 协议的跨语言互操作能力，展示了 Go 客户端如何无缝对接 Python ADK 服务器。关键收获：

- A2A 协议天然支持异构技术栈间的 Agent 通信
- `a2aagent` 封装了 ADK 的特殊行为差异，调用方无需关心底层协议细节
- 代码执行事件通过 `ObjectType + Tag` 的组合标识进行区分

进一步学习可参考 **a2aagent** 示例了解纯 Go 环境下的 A2A 通信，以及 **a2acodeexecution** 示例了解原生代码执行能力。
