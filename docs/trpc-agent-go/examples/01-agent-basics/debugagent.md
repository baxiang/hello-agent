# Debug Agent 示例 - 集成文件工具和代码执行器的调试助手

## 概述

本示例构建了一个具备文件操作和代码执行能力的 AI 调试助手。它展示了如何为 `LLMAgent` 集成 `ToolSet`（文件工具集）和 `CodeExecutor`（本地代码执行器），使 Agent 能够读取、修改项目文件并执行命令，从而自动化地定位和修复代码 Bug。

## 核心概念

### ToolSet 工具集

`tool.ToolSet` 是一组相关工具的集合。框架内置了 `file.NewToolSet()` 文件操作工具集，包含以下工具：

| 工具 | 功能 |
|------|------|
| `save_file` | 保存文件 |
| `read_file` | 读取单个文件 |
| `read_multiple_files` | 批量读取文件 |
| `list_file` | 列出目录内容 |
| `search_file` | 按模式搜索文件 |
| `search_content` | 按内容搜索文件 |
| `replace_content` | 替换文件内容 |

### CodeExecutor 代码执行器

`codeexecutor/local` 提供本地代码执行能力。当 Agent 的响应中包含 fenced bash 代码块时，`CodeExecutor` 会提取并在指定工作目录中执行，将执行结果作为后处理事件返回。

### WithToolSets vs WithTools

- `WithTools([]tool.Tool{...})`: 添加单个工具列表
- `WithToolSets([]tool.ToolSet{...})`: 添加工具集，ToolSet 内部管理一组工具

## 代码解析

**1. 创建文件工具集**

```go
fileToolSet, err := file.NewToolSet(
    file.WithBaseDir(c.baseDir),
)
```

通过 `WithBaseDir` 限定文件操作的根目录，防止路径越界。所有文件操作只能在该目录下执行。

**2. 创建本地代码执行器**

```go
llmagent.WithCodeExecutor(local.New(
    local.WithWorkDir(c.baseDir),
    local.WithTimeout(30*time.Second),
    local.WithCleanTempFiles(true),
))
```

配置工作目录、超时时间和临时文件清理策略。

**3. 组装 LLMAgent**

```go
llmAgent := llmagent.New(
    agentName,
    llmagent.WithModel(modelInstance),
    llmagent.WithInstruction(instruction),
    llmagent.WithGenerationConfig(genConfig),
    llmagent.WithToolSets([]tool.ToolSet{fileToolSet}),
    llmagent.WithCodeExecutor(local.New(...)),
)
```

将模型、工具集和代码执行器统一注入 Agent。

**4. 处理工具调用事件**

```go
// 检测工具调用
if len(event.Response.Choices[0].Message.ToolCalls) > 0 {
    fmt.Printf("🔧 Tool call initiated:\n")
    for _, toolCall := range event.Response.Choices[0].Message.ToolCalls {
        fmt.Printf("   • %s (ID: %s)\n", toolCall.Function.Name, toolCall.ID)
    }
}

// 检测代码执行结果
if event.Response.Object == model.ObjectTypePostprocessingCodeExecution {
    fmt.Printf("✅ Code execution:\n %s\n", content)
}
```

事件流中包含三种类型的事件：工具调用请求、工具执行结果和代码执行结果，需要分别处理和展示。

## 运行方式

```bash
cd examples/debugagent
export OPENAI_API_KEY="your-api-key"

# 在 project 目录下运行调试
go run main.go -base-dir ./project
```

示例中 `project/counter/counter.go` 包含一个经典的 Go 并发 Bug（goroutine 未等待完成就返回）。Agent 会自动：
1. 列出项目文件 → 2. 读取代码 → 3. 定位 Bug → 4. 使用 `replace_content` 修复 → 5. 执行脚本验证

## 总结

本示例展示了 tRPC-Agent-Go 的 **工具调用能力**，核心收获：

- 使用 `file.NewToolSet` 快速集成文件操作工具
- 使用 `local.New` 集成本地代码执行器
- 理解事件流中工具调用和执行结果的区分处理

下一步可以学习 **runner** 示例了解自定义 Function Tool 的写法，或学习 **customagent** 了解如何完全自定义 Agent 逻辑。
