# HostExec 主机命令工具集 - 让 LLM 在工作目录里跑 Shell

> **源码路径**：[`trpc-agent-go/examples/tool/hostexec/`](../../../../trpc-agent-go/examples/tool/hostexec)
> **示例类型**：ToolSet 模式（多工具组合） · **难度**：入门

## 概述

`hostexec/` 演示如何把"宿主机 shell"作为一组工具交给 LLM。它注册的不是单个 `tool.Tool`，而是一个 `tool.ToolSet`，内部包含 `exec_command`、`write_stdin`、`kill_session` 三个协同工具，可启动长任务、轮询输出、按需终止。

与 [`codeexec`](./tool-codeexec.md) 的核心差异：`codeexec` 执行的是**代码块**（python/bash，无状态），`hostexec` 执行的是**带会话的 shell 命令**（可以一直跑、可以发 stdin、可以 kill），更贴近"个人开发助手"的场景：浏览仓库、跑测试、起后台任务。

## 核心概念

### ToolSet vs Tool

`codeexec` 用 `tool.Tool`（单一工具），`hostexec` 用 `tool.ToolSet`（工具集合）。这种差异直接反映在 Agent 的注册 API 上：

| 项 | `codeexec` | `hostexec` |
|----|------------|------------|
| 构造 | `codeexec.NewTool(...)` 返回 `tool.Tool` | `hostexec.NewToolSet(...)` 返回 `tool.ToolSet` |
| 注册 | `llmagent.WithTools([]tool.Tool{...})` | `llmagent.WithToolSets([]tool.ToolSet{...})` |
| 模型可见工具数 | 1（`execute_code`） | 3（`exec_command`/`write_stdin`/`kill_session`） |

### 三个协同工具

| 工具 | 作用 | 关键参数 |
|------|------|---------|
| `exec_command` | 在 base dir 下执行 shell 命令 | `command`、`yield_time_ms`（>0 表示后台跑并等待该毫秒数） |
| `write_stdin` | 向运行中的 session 写输入；`chars` 为空时等价于"轮询输出" | `session_id`、`chars`、`yield_time_ms` |
| `kill_session` | 终止运行中的 session | `session_id` |

`yield_time_ms` + 空 `chars` 的组合让模型可以**反复轮询长任务**而不阻塞——这是 `hostexec` 与一次性的 `exec_command` 类工具的关键区别。

## 代码解析

### 应用结构与生命周期

示例用 `cliApp` 封装状态。注意 **ToolSet 本身也需要 `Close()`**——它可能持有后台 session 资源：

```go
type cliApp struct {
    modelName string
    baseDir   string
    tools     tool.ToolSet
    runner    runner.Runner
    userID    string
    sessionID string
}

func main() {
    app, err := newApp(*modelName, *baseDir)
    defer app.runner.Close()
    defer app.tools.Close()
    ...
}
```

### 构建 ToolSet 并注册

整个接线只有四步，但每一步都不可省：

```go
toolSet, err := hostexec.NewToolSet(
    hostexec.WithBaseDir(baseDir),
)
if err != nil {
    return nil, fmt.Errorf("create hostexec tool set: %w", err)
}

agt := llmagent.New(
    "hostexec-assistant",
    llmagent.WithModel(openai.New(modelName)),
    llmagent.WithDescription("An assistant that can run local shell commands"),
    llmagent.WithInstruction(hostExecInstruction),
    llmagent.WithGenerationConfig(model.GenerationConfig{
        MaxTokens: intPtr(2000),
        Stream:    true,
    }),
    llmagent.WithToolSets([]tool.ToolSet{toolSet}),
)
```

### 通过 Instruction 约束行为

模型如何使用这套工具主要靠 `Instruction` 控制。示例的 system prompt（`hostExecInstruction`）明确了几条规则：

```go
const hostExecInstruction = `You are a careful assistant with a direct
host command tool.

Use exec_command for project-local shell work such as listing files,
running builds, running tests, or collecting command output.

Rules:
- Stay inside the configured base directory unless the user explicitly
  asks for another workdir.
- Prefer concise, non-interactive commands.
- For long-running commands, use exec_command with a positive
  yield_time_ms, then continue polling with write_stdin using empty
  chars.
- Use kill_session if a background command should stop.
- Summarize command results clearly after the tool output is available.`
```

这正是把 `yield_time_ms` + 空 `chars` 的轮询技巧教给模型的方式——**Instruction 是 ToolSet 行为的一部分**，不能省略。

### 事件输出

相比 `codeexec` 的三段式分发，`hostexec` 走了更简洁的输出路径：

```go
for ev := range evCh {
    if ev.Error != nil {
        fmt.Printf("\nError: %s\n", ev.Error.Message)
        continue
    }
    if err := printToolCalls(ev); err != nil { return err }
    if len(ev.Response.Choices) == 0 { continue }
    choice := ev.Response.Choices[0]
    if choice.Delta.Content != "" {
        fmt.Print(choice.Delta.Content)
    }
}
```

`printToolCalls` 只是把工具名和参数打印出来，不做复杂的事件归类。

## 运行方式

### 环境变量

| 变量 | 必需 | 说明 |
|------|------|------|
| `OPENAI_API_KEY` | 是 | 模型 API Key |
| `OPENAI_BASE_URL` | 否 | 模型端点（用非 OpenAI 兼容服务时需要） |

### 命令行参数

| 参数 | 说明 | 默认值 |
|------|------|--------|
| `-model` | 模型名 | `deepseek-v4-flash` |
| `-base-dir` | 命令的工作根目录，相对路径都从这里解析 | `.` |

### 运行命令

```bash
cd examples/tool/hostexec
export OPENAI_API_KEY="your-api-key"

go run . -model deepseek-v4-flash -base-dir .
go run . -base-dir /path/to/repo         # 限定工作目录
```

### 预期输出

短任务示例：

```
Host Exec Demo
Model: deepseek-v4-flash
Base Dir: .
Session: hostexec-1703123456
==================================================
Ask for local shell work inside the base directory.

You: List the first few files in this repository.

Assistant:
Tool: exec_command
Args: {"command":"ls | head","yield_time_ms":0}
Assistant: I listed the repository root and found ...
```

长任务示例（启动 → 轮询）：

```
You: Run go test ./... and tell me whether anything failed.

Assistant:
Tool: exec_command
Args: {"command":"go test ./...","yield_time_ms":500}
Tool: write_stdin
Args: {"session_id":"...","chars":"","yield_time_ms":500}
Assistant: The test run completed and ...
```

## 适用场景与对比

**选 hostexec 当：**
- 需要模型在本地仓库里跑 shell（编译、测试、查看文件）
- 需要支持**长任务**（带 `yield_time_ms` 轮询）
- 需要给交互式命令发 stdin
- 可信环境（命令直接在本机执行）

**选 [`codeexec`](./tool-codeexec.md) 当：**
- 只关心计算结果（python/bash 代码片段）
- 需要 e2b / jupyter 等沙箱后端隔离执行

| 维度 | hostexec | codeexec |
|------|----------|----------|
| 注册 API | `WithToolSets` | `WithTools` |
| 内含工具 | 3 个（exec/write_stdin/kill） | 1 个（execute_code） |
| 状态 | 跨调用保持 session | 每次独立 |
| 后端 | 仅宿主机 | local / jupyter / e2b |
| 长任务支持 | ✅（yield_time_ms + 轮询） | ❌ |
| 适用场景 | 工程作业 | 数据分析 / 计算 |

## 关键要点

1. **ToolSet 是 Tool 的组合**：`WithToolSets` 接收 `tool.ToolSet`，内部可以暴露多个协同工具
2. **ToolSet 也有生命周期**：`hostexec.ToolSet` 持有 session 资源，必须 `defer tools.Close()`
3. **`yield_time_ms` 是长任务的关键**：>0 让命令后台运行并立即返回当前输出；配合 `write_stdin` 空 `chars` 可反复轮询
4. **base-dir 是安全边界**：所有相对 workdir 都从 `-base-dir` 解析；约束模型行为主要靠 Instruction 显式声明
5. **本机执行=仅限可信环境**：`hostexec` 直接调用宿主机 shell，生产环境务必评估风险

## 总结

`hostexec` 把 `codeexec` 的"单工具 + 单次执行"模型扩展为"工具集 + 有状态会话"，是构建本地开发助手（让模型帮你跑测试、看日志、起服务）的关键拼图。同样的 `WithToolSets` 注册模式在 [`openviking`](./tool-openviking.md) 里还会再出现一次——但那里的工具集对接的是外部知识库，而不是宿主机 shell。
