# 代码执行示例 - 为 Agent 赋予本地代码运行能力

## 概述

本示例演示了如何为 LLM Agent 配置代码执行器（Code Executor），使 Agent 在对话过程中自动识别代码块并执行，将执行结果反馈到后续推理中。示例提供了三种执行器实现：本地进程（Local）、Docker 容器（Container）和 Jupyter Kernel，覆盖了从轻量开发到生产级隔离的完整场景。

## 核心概念

**Code Executor 接口**：tRPC-Agent-Go 定义了统一的代码执行器接口，Agent 通过 `llmagent.WithCodeExecutor()` 注入执行器。当 LLM 回复中包含可执行的代码块时，框架自动提取并交由执行器运行，将 stdout/stderr 作为新的上下文消息注入对话，驱动 LLM 进行下一轮推理。

**三种执行器**：
- `local.New()`：直接在宿主机上以子进程方式执行，零配置启动，适合开发调试
- `container.New()`：基于 Docker 创建隔离容器，无网络访问，适合生产环境
- `jupyter.New()`：启动 Jupyter Kernel，支持跨代码块状态保持，适合数据科学场景

**Instruction 工程**：通过 `instruction.md` 文件为 Agent 注入详细的代码执行指南，约束其只使用标准库、提供完整可执行代码、并打印输出结果。

## 代码解析

### 本地执行器（主入口）

```go
// main.go
llmAgent := llmagent.New(
    name,
    llmagent.WithModel(modelInstance),
    llmagent.WithInstruction(baseSystemInstruction() + `...`),
    llmagent.WithGenerationConfig(genConfig),
    llmagent.WithCodeExecutor(local.New()),
)
```

`local.New()` 创建本地执行器，代码在宿主机进程中运行。`baseSystemInstruction()` 从 `instruction.md` 文件读取系统指令，其中定义了可用的 Python 标准库列表、输出要求和代码完整性约束。

### Docker 容器执行器

```go
// container/main.go
containerExecutor, err := container.New()
defer containerExecutor.Close()

llmAgent := llmagent.New(
    name,
    llmagent.WithCodeExecutor(containerExecutor),
)
```

`container.New()` 自动拉取 `python:3.9-slim` 镜像，启动无网络访问的一次性容器。支持通过 `container.WithContainerConfig()` 自定义镜像、`container.WithDockerFilePath()` 从本地 Dockerfile 构建、以及 `container.WithBindMount()` 挂载宿主目录。注意必须调用 `defer containerExecutor.Close()` 确保容器资源释放。

### Jupyter 执行器

```go
// jupyter/main.go
jupyterExecutor, err := jupyter.New()
defer jupyterExecutor.Close()
```

Jupyter 执行器的核心优势是**状态保持**：多次代码执行共享同一个 Kernel 会话，后续代码块可以直接使用前一个代码块定义的变量。还支持通过 `jupyter.NewClient()` 连接到远程 Jupyter Gateway 服务。

### 事件流处理

```go
eventChan, err := r.Run(ctx, "user-id", "session-id", model.NewUserMessage("analyze some sample data..."))
for event := range eventChan {
    if len(event.Response.Choices) > 0 {
        choice := event.Response.Choices[0]
        if choice.Delta.Content != "" {
            fmt.Printf("Delta Content: %s\n", choice.Delta.Content)
        }
    }
    if event.Done { break }
}
```

Runner 返回事件 Channel，包含 LLM 生成内容和代码执行结果。当 Agent 输出代码块时，框架自动执行并将结果注入，LLM 在下一轮基于执行结果生成最终分析。

## 运行方式

**环境准备**：

```bash
export OPENAI_API_KEY="your-api-key"
export OPENAI_BASE_URL="https://api.openai.com/v1"
```

**本地执行器**（需要 Python 环境）：

```bash
cd examples/codeexecution
go run . -model deepseek-v4-flash
```

**Docker 容器执行器**（需要 Docker）：

```bash
cd examples/codeexecution/container
go run . -model deepseek-v4-flash
```

**Jupyter 执行器**（需要 Jupyter）：

```bash
cd examples/codeexecution/jupyter
go run . -model deepseek-v4-flash
```

**预期输出**：Agent 会生成 Python 代码计算样本数据的统计指标（均值、中位数等），框架自动执行后，Agent 基于执行结果输出最终的数据分析报告。

## 总结

本示例展示了 tRPC-Agent-Go 代码执行能力的三种模式，核心收获：`WithCodeExecutor` 的插拔式设计让 Agent 无需修改即可切换执行环境；Instruction 工程是控制代码执行质量的关键；Container 和 Jupyter 模式分别解决了安全隔离和状态保持两个核心需求。与 `sandboxcodeexecution` 示例的关系是：本示例聚焦基础代码执行能力，后者则深入探索沙箱安全策略。
