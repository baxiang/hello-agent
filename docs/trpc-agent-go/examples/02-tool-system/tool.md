# 内置工具集 - 框架预置的开箱即用工具

## 概述

tRPC-Agent-Go 框架提供了多种内置工具（Built-in Tools），涵盖代码执行、主机命令执行、知识库检索和网页抓取等常见场景。本文将介绍 `tool/` 目录下的四类内置工具示例：`codeexec`（代码执行）、`hostexec`（主机命令执行）、`openviking`（知识库检索）和 `webfetch`（网页内容抓取），帮助开发者快速了解框架的工具生态。

## 核心概念

框架内置工具通过 `tool.ToolSet` 或 `tool.Tool` 接口提供，可以直接注册到 Agent 上使用。每种工具封装了特定领域的能力，开发者无需从零实现。

## 代码解析

### 1. codeexec - 代码执行工具

该示例展示如何让 Agent 执行 Python 或 Bash 代码。核心在于创建代码执行器并绑定工具：

```go
// 创建代码执行器（支持 local、jupyter、e2b 三种后端）
executor = local.New(local.WithTimeout(30 * time.Second))

// 创建代码执行工具
codeExecTool := codeexec.NewTool(executor,
    codeexec.WithDescription("Execute Python or Bash code..."),
)

// 注册到 Agent
llmagent.WithTools([]tool.Tool{codeExecTool})
```

框架通过 `codeexecutor` 抽象层支持多种执行后端，`local` 直接在本地进程执行，`jupyter` 通过 Jupyter Kernel 执行，`e2b` 使用云端沙箱。

### 2. hostexec - 主机命令执行工具

`hostexec` 提供 ToolSet 级别的工具集，支持在宿主机上执行 Shell 命令：

```go
toolSet, err := hostexec.NewToolSet(
    hostexec.WithBaseDir(baseDir),
)

llmagent.WithToolSets([]tool.ToolSet{toolSet})
```

该工具集内部包含 `exec_command`、`write_stdin`、`kill_session` 等多个工具，支持长时间运行的命令和交互式操作。注意它使用 `WithToolSets` 而非 `WithTools` 注册。

### 3. openviking - 知识库检索工具

`openviking` 工具集对接 OpenViking 上下文数据库，遵循"先搜索后读取"的检索模式：

```go
ts, err := openviking.NewToolSet(
    openviking.WithBaseURL(*ovURL),
    openviking.WithAPIKey(*apiKey),
    openviking.WithProfile(selectedProfile),
)

llmagent.WithToolSets([]tool.ToolSet{ts})
```

工具集提供 `viking_search`、`viking_find`、`viking_read` 等工具，Agent 先搜索定位相关文档的 URI，再读取具体内容。Profile 参数（retrieval/agent/admin）控制暴露的工具范围。

### 4. webfetch - 网页抓取工具

`webfetch` 提供两种实现：基于 HTTP 的 `httpfetch` 和基于 Gemini 的 `geminifetch`。

**httpfetch** 直接通过 HTTP 请求抓取网页并转换为 Markdown：

```go
fetchTool := httpfetch.NewTool(
    httpfetch.WithMaxContentLength(50000),
    httpfetch.WithMaxTotalContentLength(150000),
)
```

**geminifetch** 利用 Gemini 的 URL Context 功能在服务端完成抓取和分析：

```go
fetchTool, err := geminifetch.NewTool(geminiModel)
```

## 运行方式

```bash
# 代码执行工具
cd examples/tool/codeexec
export OPENAI_API_KEY="your-key"
go run . -executor=local

# 主机命令执行工具
cd examples/tool/hostexec
go run . -base-dir=.

# OpenViking 知识库工具（需要 OpenViking 服务）
cd examples/tool/openviking
go run . -openviking=http://localhost:1933

# HTTP 网页抓取工具
cd examples/tool/webfetch/httpfetch
go run .

# Gemini 网页抓取工具
cd examples/tool/webfetch/geminifetch
go run . -gemini-model=gemini-2.5-flash
```

## 总结

内置工具是 tRPC-Agent-Go 工具系统的基石。关键要点：

- **Tool vs ToolSet**：单一功能使用 `tool.Tool`，多工具组合使用 `tool.ToolSet`
- **执行后端可插拔**：如 `codeexec` 支持 local/jupyter/e2b 三种后端
- **安全边界**：`hostexec` 限制工作目录，`webfetch` 限制内容长度
- 这些内置工具可以与自定义的 `function.NewFunctionTool` 混合使用，参见 [multitools](./multitools.md) 示例
