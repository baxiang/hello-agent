# Tool 工具系统 - 让 Agent 拥有调用外部能力的手

> **源码路径**：[`trpc-agent-go/examples/tool/`](../../../../trpc-agent-go/examples/tool)
> **子示例数**：4 个 · 本页为分类索引，每个子示例有独立详解

## 概述

Tool 是 Agent 与外部世界交互的"手"——模型通过 Tool Call 主动决定何时执行代码、跑命令、查知识库、抓网页。trpc-agent-go 的 `tool/` 示例目录用 **4 个独立子示例**展示了内置工具生态的完整光谱：从本机代码执行到外部检索服务，从单一工具到工具集，从本地 HTTP 到云端智能抓取。

## 子示例导航

| 子示例 | 文章 | 类型 | 一句话说明 |
|--------|------|------|-----------|
| [`codeexec/`](./tool-codeexec.md) | [`tool-codeexec`](./tool-codeexec.md) | `tool.Tool`（单工具） | 让模型自主通过 Tool Call 执行 Python / Bash 代码 |
| [`hostexec/`](./tool-hostexec.md) | [`tool-hostexec`](./tool-hostexec.md) | `tool.ToolSet`（工具集） | 让模型在 base dir 里跑 shell，支持长任务与轮询 |
| [`openviking/`](./tool-openviking.md) | [`tool-openviking`](./tool-openviking.md) | 外部服务 ToolSet | 对接 OpenViking 知识库，"先搜后读"+ Profile 分级 |
| [`webfetch/`](./tool-webfetch.md) | [`tool-webfetch`](./tool-webfetch.md) | `tool.Tool`（两套实现） | HTTP 直抓 vs Gemini 服务端抓取，含原文对照 |

## 选型决策树

```
需要让 Agent 调用外部能力？
├── 纯计算 / 数据分析（Python、Bash 代码片段）
│   ├── 需要沙箱隔离 / 云端执行            → codeexec（local / jupyter / e2b）
│   └── 只在本机跑、可信环境               → codeexec（local）
│
├── 本机工程作业（跑测试、看目录、起服务）
│   ├── 需要长任务 + stdin 交互            → hostexec
│   └── 一次性命令                         → hostexec（yield_time_ms=0）
│
├── 查询数据
│   ├── 私有知识库（已建索引）             → openviking（search then read）
│   └── 开放网页
│       ├── 需要原文 / 精确限额            → webfetch/httpfetch
│       └── 需要智能总结 / 对比            → webfetch/geminifetch
```

## 核心概念

### Tool vs ToolSet

trpc-agent-go 工具系统有两个基础抽象，**注册 API 不同**：

| 抽象 | 接口 | 构造样例 | 注册方式 |
|------|------|---------|---------|
| **Tool**（单一工具） | `tool.Tool` | `codeexec.NewTool(...)` | `llmagent.WithTools([]tool.Tool{...})` |
| **ToolSet**（工具集） | `tool.ToolSet` | `hostexec.NewToolSet(...)` | `llmagent.WithToolSets([]tool.ToolSet{...})` |

ToolSet 内部可暴露多个协同工具（如 `hostexec` 的 exec/write_stdin/kill），模型看到的是一组工具。本目录的 4 个示例里，`codeexec` 和 `webfetch` 用 Tool，`hostexec` 和 `openviking` 用 ToolSet。

### 四类内置工具的能力光谱

| 维度 | codeexec | hostexec | openviking | webfetch |
|------|----------|----------|-----------|----------|
| 解决问题 | 算 / 处理 | 本机执行 | 查私库 | 查公网 |
| 数据来源 | 代码沙箱 | 宿主机 | OpenViking 服务 | 互联网 |
| 抽象层级 | 代码块 | shell 会话 | 检索 API | URL |
| 注册方式 | `WithTools` | `WithToolSets` | `WithToolSets` | `WithTools` |
| 内含工具数 | 1（execute_code） | 3（exec/write_stdin/kill） | 6~10（按 Profile） | 1（web_fetch / gemini_web_fetch） |
| 是否有状态 | 否 | ✅ session | ✅ 服务端 | 否 |
| 后端可插拔 | ✅ local/jupyter/e2b | ❌ | ❌ | ✅ http/gemini |
| 外部依赖 | 可选（jupyter/e2b） | 无 | openviking-server | 可选（GEMINI_API_KEY） |

### 共通的接线模式

无论用 Tool 还是 ToolSet，所有示例都遵循同样的"三件套"接线：

```go
// 1. 创建工具 / 工具集
fetchTool := httpfetch.NewTool(httpfetch.WithMaxContentLength(50000))

// 2. 注册给 LLM Agent
llmAgent := llmagent.New(
    "my-agent",
    llmagent.WithModel(modelInstance),
    llmagent.WithTools([]tool.Tool{fetchTool}),         // 或 WithToolSets
    llmagent.WithInstruction("...如何使用工具的指引..."),
)

// 3. 绑定到 Runner
r := runner.NewRunner("my-app", llmAgent)
```

`Instruction` 是这套模式里**容易被忽略但极其重要**的一环：模型如何使用工具（要不要先搜后读、要不要先用 overview、要不要避免递归 browse）全靠 system prompt 约束。每个子示例都有专门的 Instruction 段落说明这一点。

## 共通的运行约定

### 通用环境变量

| 变量 | 适用 | 说明 |
|------|------|------|
| `OPENAI_API_KEY` | 全部 | 对话模型 API Key |
| `OPENAI_BASE_URL` | 全部（可选） | 模型端点（兼容服务用） |
| `GEMINI_API_KEY` | 仅 geminifetch | Gemini 抓取模型 API Key |
| `E2B_API_KEY` | 仅 codeexec 的 e2b 后端 | E2B / CubeSandbox Key |
| `OPENVIKING_API_KEY` | 仅 openviking | OpenViking 鉴权 |

### 通用退出命令

所有 4 个示例都支持 `exit`（大小写不敏感）退出交互循环。

### 启动命令速查

```bash
# codeexec
cd examples/tool/codeexec       && go run . -executor local

# hostexec
cd examples/tool/hostexec       && go run . -base-dir .

# openviking（需先启动 openviking-server）
cd examples/tool/openviking     && go run . -profile agent

# webfetch（两套实现二选一）
cd examples/tool/webfetch/httpfetch   && go run .
cd examples/tool/webfetch/geminifetch && go run . -gemini-model gemini-2.5-flash
```

## 学习路径建议

1. **先读 [`codeexec`](./tool-codeexec.md)**：理解最基础的 "Tool 定义 + WithTools 注册 + 事件三段式分发" 模式，这是所有工具示例的骨架
2. **再读 [`hostexec`](./tool-hostexec.md)**：看 ToolSet 如何暴露多个协同工具、`yield_time_ms` 如何支撑长任务，理解 `WithToolSets` 与 `WithTools` 的差异
3. **进阶读 [`openviking`](./tool-openviking.md)**：外部服务对接、Profile 分级、search-then-read 范式，是构建企业级 Agent 的关键参考
4. **对照读 [`webfetch`](./tool-webfetch.md)**：同一问题的两种实现（本地 vs 云端），理解工具的可替换性

## 总结

Tool 系统的设计精髓在于**抽象统一、实现可换**：同一套 `tool.Tool` / `tool.ToolSet` 接口，下层可以是本机代码、宿主机 shell、外部检索服务、开放网页；上层注册方式只有 `WithTools` / `WithToolSets` 两种。理解了 codeexec 的最简骨架，其它三个示例都是在这个骨架上替换"工具来源"和"事件处理细节"。

Tool 与 [`06-memory-system/`](../06-memory-system/memory.md) 紧密配合：Memory 让 Agent 跨会话记住信息，Tool 让 Agent 在单次会话里调用外部能力。生产环境通常会把多个 Tool / ToolSet 一起注册给同一个 Agent——比如同时给模型 `execute_code` + `web_fetch` + `memory_search`，让它在一次对话中自由组合。
