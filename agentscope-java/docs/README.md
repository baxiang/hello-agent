# AgentScope Java 工程源码文档

面向贡献者和开发者的技术文档，描述 `agentscope-core` 模块的内部架构和设计决策。

## 文档导航

### 概览

| 文档 | 说明 |
|---|---|
| [README](README.md) | 模块架构总览 — 架构图、设计原则、ReAct 循环、线程安全模型 |
| [core](core.md) | 核心包文档 — 入口点、架构概述、响应式模型 |

### 包级文档

| 包 | 文档 | 说明 |
|---|---|---|
| `io.agentscope.core` | [core.md](core.md) | 核心入口点 |
| `io.agentscope.core.agent` | [agent](package-docs/agent.md) | Agent 层次、中断机制、扩展指南 |
| `io.agentscope.core.message` | [message](package-docs/message.md) | 7 种 ContentBlock、序列化、结构化输出 |
| `io.agentscope.core.model` | [model](package-docs/model.md) | 5 种模型实现、Formatter 架构 |
| `io.agentscope.core.tool` | [tool](package-docs/tool.md) | @Tool 定义、工具组、MCP 集成 |
| `io.agentscope.core.hook` | [hook](package-docs/hook.md) | 9 种事件时序图、优先级、可修改 vs 只通知 |
| `io.agentscope.core.memory` | [memory](package-docs/memory.md) | 短期/长期记忆、3 种模式 |
| `io.agentscope.core.pipeline` | [pipeline](package-docs/pipeline.md) | Sequential/Fanout/MsgHub 三种编排 |
| `io.agentscope.core.plan` | [plan](package-docs/plan.md) | PlanNotebook 10 个工具函数、子任务状态机 |
| `io.agentscope.core.rag` | [rag](package-docs/rag.md) | RAG 模式、扩展实现 |
| `io.agentscope.core.session` | [session](package-docs/session.md) | JsonSession/InMemorySession、扩展存储 |
| `io.agentscope.core.state` | [state](package-docs/state.md) | StateModule、StatePersistence 配置 |
| `io.agentscope.core.shutdown` | [shutdown](package-docs/shutdown.md) | 优雅关闭流程、PartialReasoningPolicy |
| `io.agentscope.core.tracing` | [tracing](package-docs/tracing.md) | 可观测性、OpenTelemetry 集成 |

## 源码位置

本文档对应的源码位于：
```
agentscope-java/src/
├── agentscope-core/              ← 核心模块
│   ├── README.md                 ← 模块架构文档
│   └── src/main/java/io/agentscope/core/
│       ├── package-info.java     ← 核心包文档
│       ├── agent/package-info.java
│       ├── message/package-info.java
│       └── ...（其他包）
├── agentscope-extensions/        ← 扩展模块（28 个）
├── agentscope-examples/          ← 示例代码
└── docs/                         ← 官方文档站点源文件（Jupyter Book）
```

## 与官方文档的区别

| 本文档（工程源码文档） | 官方文档（docs/） |
|---|---|
| 面向贡献者和开发者 | 面向用户和使用者 |
| 描述内部架构和设计决策 | 描述如何使用 API |
| 放在源码树中（package-info.java） | 独立的文档站点（Jupyter Book） |
| IDE 中可直接查看 | 需要访问 https://java.agentscope.io/ |
