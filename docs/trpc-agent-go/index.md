# tRPC-Agent-Go 技术调研报告

> 调研日期：2026-06-09
>
> 资料来源：[GitHub 仓库](https://github.com/trpc-group/trpc-agent-go) | [官方文档](https://trpc-group.github.io/trpc-agent-go/) | [Go Packages](https://pkg.go.dev/trpc.group/trpc-go/trpc-agent-go)

## 项目概述

### 基本信息

| 属性 | 说明 |
|------|------|
| **Go 模块路径** | `trpc.group/trpc-go/trpc-agent-go` |
| **最新版本** | v1.10.0 (2026-06-05) |
| **许可证** | Apache-2.0 |
| **Go 版本要求** | Go 1.21+ |
| **开发团队** | tRPC 团队（腾讯） |

### 定位

tRPC-Agent-Go 是 tRPC 团队开源的 Go 语言 AI Agent 开发框架，补齐了 tRPC 在 Go 语言 AI 生态的拼图。此前该团队已开源了 tRPC-A2A-Go（Agent-to-Agent 协议）和 tRPC-MCP-Go（Model Context Protocol）。

绝大多数主流 Agent 框架（AutoGen、CrewAI、Agno、ADK 等）都是 Python 实现，Go 在微服务、高并发和部署方面具有天然优势。tRPC-Agent-Go 利用 Go 的高并发能力和 tRPC 生态，满足"智能+性能"的复杂业务需求。

### 核心特性

- **多样化 Agent 系统**：LLMAgent、ChainAgent、ParallelAgent、CycleAgent、GraphAgent
- **丰富的工具生态**：内置常用工具，支持 Function、MCP 协议等多种扩展方式
- **智能会话管理**：支持 Redis/Memory/SQLite/MySQL/PostgreSQL/ClickHouse 等 7 种存储后端
- **长期记忆**：支持 Agentic 和 Auto 两种模式，8 种存储后端
- **RAG 知识检索**：支持 PGVector、Elasticsearch、Qdrant、Milvus 等向量数据库
- **GraphAgent**：类型安全的图工作流，等价于 Go 版 LangGraph
- **Agent Skills**：可复用的 SKILL.md 工作流，支持安全执行
- **Artifacts**：版本化文件存储（内存、S3、COS）
- **端到端可观测性**：OpenTelemetry 全链路追踪、Langfuse 集成
- **评测框架**：自动化评测集 + 指标度量
- **AG-UI / A2A 协议**：Agent-User Interaction 与 Agent-to-Agent 互操作

### 企业验证

已在腾讯元宝、腾讯视频、腾讯新闻、IMA、QQ 音乐等业务中落地验证。

---

## 架构设计

### 整体架构

tRPC-Agent-Go 采用模块化架构设计，核心组件均可插拔，组件间通过事件驱动机制解耦通信，支持回调注入自定义逻辑。

```
┌─────────────────────────────────────────────────────────────┐
│                         Runner                               │
│  - Session 管理   - Event 流处理   - 插件系统                  │
│  - ID 生成       - 可观测集成     - Completion 事件           │
└────────────────────────┬────────────────────────────────────┘
                         │ agent.RunWithPlugins(ctx, inv, agent)
┌────────────────────────▼────────────────────────────────────┐
│                         Agent                                │
│  - 接收 Invocation   - 返回 <-chan *event.Event               │
│  - 多种实现：LLMAgent / ChainAgent / ParallelAgent / ...      │
└────────────────────────┬────────────────────────────────────┘
                         │
        ┌────────────────┼────────────────┐
        ▼                ▼                ▼
   ┌─────────┐    ┌──────────┐    ┌──────────┐
   │  Model  │    │   Tool   │    │ Planner  │
   │  LLM 调用│    │ 工具执行  │    │ 规划推理  │
   └─────────┘    └──────────┘    └──────────┘
```

### 执行流程

1. **Runner** 编排整个执行管道，管理 Session
2. **Agent** 使用多个专用组件处理请求
3. **Planner** 确定最优策略和工具选择
4. **Tools** 执行具体任务（API 调用、计算、搜索）
5. **Memory** 维护上下文并从交互中学习
6. **Knowledge** 提供 RAG 能力支持文档理解

### 核心包职责

| 包 | 职责 |
|----|------|
| `agent` | 核心执行单元，处理用户输入并生成响应 |
| `runner` | Agent 执行器，管理执行流程并连接 Session/Memory 服务 |
| `model` | 支持多种 LLM 模型（OpenAI、Anthropic、DeepSeek 等） |
| `tool` | 提供各种工具能力（Function、MCP、DuckDuckGo 等） |
| `session` | 管理用户会话状态和事件 |
| `memory` | 记录用户长期记忆和个性化信息 |
| `knowledge` | 实现 RAG 知识检索能力 |
| `planner` | 提供 Agent 规划和推理能力 |
| `graph` | 图执行引擎 |
| `artifact` | 版本化的文件制品存储 |
| `skill` | 可复用的 Agent Skills（SKILL.md） |
| `event` | 事件类型和流式载荷定义 |
| `evaluation` | 评测框架 |
| `server` | HTTP 服务（Gateway、AG-UI、A2A） |
| `telemetry` | OpenTelemetry 追踪和指标 |
| `codeexecutor` | 代码执行器（本地、E2B、容器、Jupyter） |

---

## Quick Start

### 最简 Agent

```go
package main

import (
    "context"
    "fmt"
    "log"

    "trpc.group/trpc-go/trpc-agent-go/agent/llmagent"
    "trpc.group/trpc-go/trpc-agent-go/model"
    "trpc.group/trpc-go/trpc-agent-go/model/openai"
    "trpc.group/trpc-go/trpc-agent-go/runner"
    "trpc.group/trpc-go/trpc-agent-go/tool"
    "trpc.group/trpc-go/trpc-agent-go/tool/function"
)

func main() {
    modelInstance := openai.New("deepseek-v4-flash",
        openai.WithVariant(openai.VariantDeepSeek),
    )

    calculatorTool := function.NewFunctionTool(
        calculator,
        function.WithName("calculator"),
        function.WithDescription("加减乘除运算"),
    )

    agent := llmagent.New("assistant",
        llmagent.WithModel(modelInstance),
        llmagent.WithTools([]tool.Tool{calculatorTool}),
        llmagent.WithGenerationConfig(model.GenerationConfig{Stream: true}),
    )

    r := runner.NewRunner("calculator-app", agent)
    defer r.Close()

    events, err := r.Run(context.Background(),
        "user-001", "session-001",
        model.NewUserMessage("计算 2+3 等于多少"),
    )
    if err != nil {
        log.Fatal(err)
    }

    for event := range events {
        if event.Object == "chat.completion.chunk" {
            fmt.Print(event.Response.Choices[0].Delta.Content)
        }
    }
    fmt.Println()
}
```

---

## 最佳实践

- **始终使用 Runner**：不要直接调用 Agent 接口，Runner 提供了 Session、Memory、插件等集成
- **正确关闭 Runner**：使用 `defer r.Close()` 释放资源
- **设置安全限制**：`MaxLLMCalls` 和 `MaxToolIterations` 防止无限循环
- **生产环境**：使用 Redis/PostgreSQL 等持久化存储，启用 Session Summary 减少 Token 消耗
- **使用 `event.IsRunnerCompletion()` 判断结束**：比 `event.IsFinalResponse()` 更可靠

---

## 子包索引

```
trpc.group/trpc-go/trpc-agent-go/
├── agent/                    # Agent 核心接口与实现
│   ├── a2aagent/            # A2A 互操作 Agent
│   ├── chainagent/          # 链式 Agent
│   ├── claudecode/          # Claude Code CLI Agent
│   ├── codex/               # Codex CLI Agent
│   ├── cycleagent/          # 循环 Agent
│   ├── dify/                # Dify Agent
│   ├── extension/           # Agent 扩展（如 todoenforcer）
│   ├── graphagent/          # 图 Agent
│   ├── llmagent/            # LLM Agent
│   │   └── builtin/         # 内置 Agent 预设
│   ├── parallelagent/       # 并行 Agent
│   ├── structure/           # 静态结构导出
│   ├── taskrun/             # 后台任务运行
│   └── trace/               # 执行 Trace 模型
├── artifact/                 # 制品存储
│   ├── cos/                 # 腾讯云 COS
│   ├── inmemory/            # 内存存储
│   └── s3/                  # S3 存储
├── codeexecutor/             # 代码执行器
│   ├── container/           # 容器执行
│   ├── e2b/                 # E2B 代码解释器
│   ├── jupyter/             # Jupyter 执行
│   ├── local/               # 本地执行
│   └── workspaceio/         # 工作区 I/O
├── event/                    # 事件系统
├── evaluation/               # 评测框架
├── graph/                    # 图执行引擎
│   └── checkpoint/          # 检查点（inmemory/sqlite/redis）
├── knowledge/                # RAG 知识系统
│   ├── embedder/            # 嵌入模型
│   ├── reranker/            # 重排序
│   ├── source/              # 知识源
│   ├── vectorstore/         # 向量存储
│   ├── filter/              # 过滤器
│   ├── extractor/           # 内容提取器
│   ├── query/               # 查询增强器
│   └── ocr/                 # OCR 识别
├── memory/                   # 记忆服务
├── model/                    # 模型抽象层
│   ├── openai/              # OpenAI 兼容
│   ├── anthropic/           # Anthropic 兼容
│   └── provider/            # Provider 注册机制
├── planner/                  # 规划器
├── plugin/                   # 插件系统
├── runner/                   # 运行器
├── server/                   # HTTP 服务
│   ├── gateway/             # Gateway
│   ├── agui/                # AG-UI 协议
│   ├── a2a/                 # A2A 协议
│   └── openclaw-runtime/    # OpenClaw 运行时
├── session/                  # 会话管理
│   └── summary/             # 会话摘要
├── skill/                    # Agent Skills
├── telemetry/                # 可观测性
└── tool/                     # 工具系统
    ├── function/             # 函数工具
    ├── claudecode/           # Claude Code 工具集
    ├── duckduckgo/           # DuckDuckGo 搜索
    ├── mcp/                  # MCP 工具
    ├── todo/                 # Todo 工具
    └── webfetch/             # Web 抓取
```
