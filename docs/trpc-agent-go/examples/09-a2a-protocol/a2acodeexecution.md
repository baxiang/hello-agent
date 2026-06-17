# A2A 代码执行示例 - 通过 A2A 协议远程执行 Python 代码

## 概述

本示例演示如何构建一个具备代码执行能力的 A2A 服务器，并通过 A2A 客户端与之交互。服务端 Agent 集成了本地 Python 代码执行器，LLM 生成的 Python 代码会被自动执行并返回结果，整个过程通过 A2A 协议在客户端和服务端之间透明传输。

## 核心概念

### 代码执行器（Code Executor）

tRPC-Agent-Go 通过 `codeexecutor/local` 包提供本地代码执行能力。将其注入 LLMAgent 后，LLM 生成的代码块会被自动提取并在本地 Python 环境中执行，执行结果作为上下文反馈给 LLM 生成最终回答。

### 代码执行事件模型

代码执行过程产生两类事件，共享同一个 `ObjectType`（`postprocessing.code_execution`），通过 `Tag` 字段区分：

| 事件类型 | Tag | 含义 |
|---------|-----|------|
| 代码执行 | `code` | LLM 生成的代码内容 |
| 执行结果 | `code_execution_result` | 代码的运行输出 |

客户端通过 `evt.ContainsTag()` 方法检查 Tag 来区分事件类型。

## 代码解析

**1. 服务端：创建带代码执行能力的 Agent**

```go
codeAgent := llmagent.New(
    "code_execution_agent",
    llmagent.WithModel(modelInstance),
    llmagent.WithDescription("An agent that can execute Python code to solve problems"),
    llmagent.WithInstruction(codeExecutionInstruction),
    llmagent.WithGenerationConfig(genConfig),
    llmagent.WithCodeExecutor(local.New()),
)
```

关键在于 `llmagent.WithCodeExecutor(local.New())`，它为 Agent 注入本地代码执行器。Agent 的 System Prompt 指导 LLM 使用 Python 代码块格式生成可执行代码。

**2. 服务端：暴露为 A2A 服务**

```go
server, err := a2a.New(
    a2a.WithHost(*host),
    a2a.WithAgent(codeAgent, *streaming),
)
server.Start(*host)
```

标准的 A2A 服务器创建流程，代码执行事件会自动通过 A2A 协议传输到客户端。

**3. 客户端：区分代码执行事件**

```go
// 代码内容事件
if evt.Response.Object == model.ObjectTypePostprocessingCodeExecution &&
    evt.ContainsTag(event.CodeExecutionTag) {
    content := choice.Delta.Content
    fmt.Println("[Code Execution]")
    fmt.Println(content)
}

// 代码执行结果事件
if evt.Response.Object == model.ObjectTypePostprocessingCodeExecution &&
    evt.ContainsTag(event.CodeExecutionResultTag) {
    content := choice.Delta.Content
    fmt.Println("[Code Execution Result]")
    fmt.Println(content)
}
```

客户端先通过 `ObjectType` 判断是否为代码执行相关事件，再通过 `Tag` 区分是代码内容还是执行结果，分别以不同格式展示。

**4. 客户端：过滤代码执行事件避免重复输出**

```go
func captureFinalContent(evt *event.Event) string {
    // 跳过代码执行事件
    if evt.Response.Object == model.ObjectTypePostprocessingCodeExecution {
        return ""
    }
    // 只捕获 assistant 角色消息
    content := choice.Message.Content
    if content == "" {
        content = choice.Delta.Content
    }
    return content
}
```

在捕获最终助手回复时，需要过滤掉代码执行事件，避免将代码内容误当作最终回答。

## 运行方式

**环境准备：**

```bash
export OPENAI_API_KEY="your-api-key"
export OPENAI_BASE_URL="https://api.deepseek.com/v1"
# 确保本地有 Python 环境
```

**启动服务端：**

```bash
cd examples/a2acodeexecution/server
go run main.go -model deepseek-v4-flash -host 0.0.0.0:8888
```

**启动客户端：**

```bash
cd examples/a2acodeexecution/client
go run main.go -url http://localhost:8888
```

**预期输出：**

```
Test 1: Simple Python Code Execution
=====================================
Query: Calculate the sum of numbers from 1 to 10 using Python code

[Code Execution]
---------------------------------------------
```python
result = sum(range(1, 11))
print(f"The sum is: {result}")
```
---------------------------------------------

[Code Execution Result]
The sum is: 55
---------------------------------------------
```

## 总结

本示例展示了如何将代码执行能力通过 A2A 协议暴露为远程服务。关键收获：

- `WithCodeExecutor(local.New())` 一行代码即可为 Agent 添加代码执行能力
- 代码执行事件通过 `ObjectType + Tag` 组合标识，客户端可精确区分代码和执行结果
- 流式和非流式模式下客户端需要分别从 `Delta.Content` 和 `Message.Content` 读取内容

进一步学习可参考 **a2aadk** 示例了解与 Python ADK 代码执行的互操作，以及 **a2aagent** 示例了解 A2A 协议的完整功能。
