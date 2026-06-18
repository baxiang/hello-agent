# CodeExec 代码执行工具 - 让 LLM 自主决定何时运行代码

> **源码路径**：[`trpc-agent-go/examples/tool/codeexec/`](../../../../trpc-agent-go/examples/tool/codeexec)
> **示例类型**：Tool Call 模式（模型主动调用） · **难度**：入门

## 概述

`codeexec/` 是 Tool 工具系统里最典型的 "让模型自己决定是否运行代码" 示例。它把代码执行能力封装成一个名为 `execute_code` 的工具，由 LLM 在对话中根据用户意图**主动通过 Tool Call 触发**，而不是把所有代码块都强行执行。

与兄弟示例的定位区别：
- [`codeexec`](./tool-codeexec.md)（本文）：执行 Python / Bash 代码片段，关注**计算与逻辑**
- [`hostexec`](./tool-hostexec.md)：执行宿主机 shell 命令，关注**工程作业**（编译、测试、目录浏览）
- [`openviking`](./tool-openviking.md)：检索外部知识库内容
- [`webfetch`](./tool-webfetch.md)：抓取并分析网页

## 核心概念

### Tool Call 模式 vs `WithCodeExecutor` 框架自带模式

trpc-agent-go 提供两种让 Agent 执行代码的方式，本示例采用的是第二种：

| 特性 | `WithCodeExecutor`（自动执行） | `codeexec.NewTool()`（本示例） |
|------|-------------------------------|------------------------------|
| 执行控制 | 框架自动提取并执行所有代码块 | 模型通过 Tool Call 主动触发 |
| 模型感知 | 模型不知道代码会被执行 | 模型明确知道有 `execute_code` 工具 |
| 灵活度 | 低（强制执行） | 高（按需执行，可与其他工具组合） |
| 典型场景 | 数据分析、Notebook 风格 | 通用 Agent |

### 三种可插拔执行后端

框架通过 `codeexecutor.CodeExecutor` 接口抽象执行后端，本示例演示了其中三种：

| 后端 | 适用 | 生命周期 |
|------|------|---------|
| `local.New()` | 本地直接执行（不安全） | 无需关闭 |
| `jupyter.New()` | 通过 Jupyter Kernel Gateway 子进程执行 | **必须 `Close()`** 清理子进程 |
| `e2bexec.New()` | E2B / CubeSandbox 云端沙箱 | 无需关闭 |

## 代码解析

### 主结构与流程

示例用 `codeExecChat` 结构体管理状态，整体走 `setup()` → `startChat()` → 每轮 `processMessage()` 的流程：

```go
type codeExecChat struct {
    modelName    string
    executorKind string
    runner       runner.Runner
    userID       string
    sessionID    string
    cleanup      func() error
}
```

`cleanup` 字段只有在使用 Jupyter 后端时才会被设置成 `je.Close`——这是后端切换带来的关键差异。

### 后端选择与构建

`setup()` 根据 `-executor` 参数创建对应的 `CodeExecutor`：

```go
var executor codeexecutor.CodeExecutor
switch strings.ToLower(strings.TrimSpace(c.executorKind)) {
case "local":
    executor = local.New(
        local.WithTimeout(30 * time.Second),
    )
case "e2b":
    e2be, err := e2bexec.New()
    if err != nil {
        return fmt.Errorf("e2b executor: %w", err)
    }
    executor = e2be
case "jupyter":
    je, err := jupyter.New(
        jupyter.WithStartTimeout(30*time.Second),
        jupyter.WithWaitReadyTimeout(30*time.Second),
    )
    if err != nil {
        return fmt.Errorf("create jupyter executor: %w", err)
    }
    executor = je
    c.cleanup = je.Close
default:
    return fmt.Errorf("unknown -executor=%q (supported: local, jupyter)", c.executorKind)
}
```

注意 `jupyter` 分支会注册 cleanup 回调，`run()` 在退出前会调用：

```go
defer func() {
    if c.cleanup != nil {
        if err := c.cleanup(); err != nil {
            log.Printf("cleanup failed: %v", err)
        }
    }
}()
```

### 构建工具并注册给 Agent

工具本身只两行——把执行器包装成 `tool.Tool`，再通过 `WithTools` 注册：

```go
codeExecTool := codeexec.NewTool(executor,
    codeexec.WithDescription("Execute Python or Bash code and return the result. "+
        "Use this when you need to run code for computation, data analysis, or logic verification."),
)

llmAgent := llmagent.New(
    agentName,
    llmagent.WithModel(modelInstance),
    llmagent.WithDescription("An AI assistant that can execute Python and Bash code"),
    llmagent.WithInstruction(`You are an intelligent assistant that can execute code.
When users ask you to perform calculations, data analysis, or any task that requires code execution,
use the execute_code tool to run Python or Bash code and return the results.`),
    llmagent.WithGenerationConfig(genConfig),
    llmagent.WithTools([]tool.Tool{codeExecTool}),
)
```

### 流式事件分发

为了让用户能看到"模型决定调用工具 → 执行代码 → 拿到结果"全过程，示例把事件通道里的事件分成三类处理：

```go
for evt := range eventChan {
    if evt.Error != nil { /* 处理错误 */ continue }
    if c.handleToolCalls(evt, &toolCallsDetected, &assistantStarted) { continue }
    if c.handleToolResponses(evt) { continue }
    c.processStreamingContent(evt, &toolCallsDetected, &assistantStarted, &fullContent)
    if evt.IsFinalResponse() { break }
}
```

`handleToolCalls` 打印模型发出的 `execute_code` 调用与参数；`handleToolResponses` 打印执行结果；其余事件作为流式文本输出。这种三段式分发是**调试任意工具调用**的通用骨架。

## 运行方式

### 环境变量

| 变量 | 必需 | 说明 |
|------|------|------|
| `OPENAI_API_KEY` | 是 | 模型 API Key |
| `OPENAI_BASE_URL` | 否 | 模型端点（用 DeepSeek 等兼容服务时需要） |
| `E2B_API_KEY` | 仅 `e2b` 后端需要 | E2B / CubeSandbox API Key |
| `E2B_API_URL` | 仅自建 CubeSandbox 时 | 沙箱服务地址 |
| `SSL_CERT_FILE` | 仅自建 CubeSandbox 时 | 自签 CA 证书路径 |

### 命令行参数

| 参数 | 说明 | 默认值 |
|------|------|--------|
| `-model` | 模型名 | `deepseek-v4-flash` |
| `-executor` | 执行后端：`local` / `jupyter` / `e2b` | `local` |

### 运行命令

```bash
cd examples/tool/codeexec
export OPENAI_API_KEY="your-api-key"

go run .                                  # 默认 local 后端
go run . -executor jupyter                # 需先 pip install jupyter_kernel_gateway
go run . -executor e2b                    # 需 E2B_API_KEY 或自建 CubeSandbox
go run . -model gpt-4o -executor local
```

### 预期输出

```
🚀 Code Execution Tool Demo
Model: deepseek-v4-flash
Executor: local
Enter 'exit' to end the conversation
============================================================
✅ Code execution assistant is ready! Session ID: codeexec-session-1703123456

💡 Example questions you can try:
   📊 Math & Computation:
      • Calculate the factorial of 10
      ...

👤 User: Calculate the factorial of 10
🤖 Assistant: I'll calculate the factorial of 10 for you.

🔧 Tool calls:
   💻 execute_code (ID: call_3cf6cde9ac9c4eafac71b847)
     Arguments: {"code_blocks": [{"language": "python", "code": "import math\nresult = math.factorial(10)\nprint(f\"10! = {result}\")"}]}

⚡ Executing code...
✅ Execution result (ID: call_3cf6cde9ac9c4eafac71b847):
{"output":"10! = 3628800\n"}

🤖 Assistant: The factorial of 10 is **3,628,800**.
```

## 适用场景与对比

**选 codeexec 当：**
- 需要模型做数学计算、数据处理、文本分析等"纯计算"任务
- 希望模型自主判断是否需要执行代码（而不是强制执行每个代码块）
- 需要支持多种语言（python / bash，可通过 `WithLanguages` 扩展）

**选 [`hostexec`](./tool-hostexec.md) 当：**
- 需要的是工程作业：跑 `go test`、列目录、起长任务
- 希望命令复用同一会话、能 `kill_session`

| 维度 | codeexec | hostexec |
|------|----------|----------|
| 抽象层级 | 代码块（python/bash） | Shell 会话（exec/write_stdin/kill） |
| 注册方式 | `WithTools([]tool.Tool{...})` | `WithToolSets([]tool.ToolSet{...})` |
| 状态保持 | 每次调用独立 | 同 session 跨调用保持 |
| 后端可插拔 | local / jupyter / e2b | 仅宿主机 |
| 安全性 | local 不安全，建议用 e2b/jupyter | 仅本地，建议只在可信环境 |

## 关键要点

1. **两种代码执行范式**：`WithCodeExecutor` 自动执行所有代码块；`codeexec.NewTool` 让模型自主决定——本示例用的是后者
2. **执行后端可插拔**：通过 `codeexecutor.CodeExecutor` 接口切换 `local`/`jupyter`/`e2b`，业务代码不变
3. **生命周期注意**：Jupyter 后端需要 `Close()` 清理 Kernel Gateway 子进程，示例通过 `cleanup func()` 字段在退出前调用
4. **事件三段式分发**：tool calls / tool responses / streaming content 是调试工具调用的通用骨架，同样适用于其它工具示例
5. **可扩展语言**：默认 python + bash，通过 `codeexec.WithLanguages(...)` 可加入更多语言

## 总结

`codeexec` 是理解 Tool Call 模式的最佳入口：一段不到 200 行的代码同时演示了"工具定义、后端选择、生命周期管理、事件流分发"四个关键点。掌握后，再去看同样是 `WithToolSets` 注册、但关注工程作业的 [`hostexec`](./tool-hostexec.md)，以及关注外部数据源的 [`openviking`](./tool-openviking.md) / [`webfetch`](./tool-webfetch.md)，会发现它们都沿用同样的"Tool/ToolSet → WithTools/WithToolSets → Runner"接线模式。
