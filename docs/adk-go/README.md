# ADK-Go 技术工程代码学习文档

本文档系列基于 [google/adk-go](https://github.com/google/adk-go) 源码（v1.2.0）编写，旨在帮助 Go 开发者系统性地学习和掌握 ADK-Go 这一开源 AI Agent 开发工具包。

源码位置：`../source/`（已克隆到本目录同级位置）

## 文档目录

### 一、入门篇

| # | 文档 | 说明 |
|---|------|------|
| 00 | [项目总览](./00-overview.md) | 项目简介、设计哲学、竞品对比、核心概念、模块一览、常见问题 |
| 01 | [整体架构](./01-architecture.md) | 架构图、模块依赖、数据流、事件模型、生命周期 |
| 02 | [快速入门](./02-quickstart.md) | 环境准备、最简示例、自定义工具、多 Agent 组合 |

### 二、核心概念篇

| # | 文档 | 说明 |
|---|------|------|
| 03 | [Agent 模型详解](./03-agent.md) | Agent 接口、LLMAgent 完整 Config、Custom Agent 实战、Workflow Agents、回调系统、A2A、InvocationContext |
| 04 | [Runner 执行模型](./04-runner.md) | Runner 结构、Run/RunLive 执行流程、Agent 路由、配置项 |
| 05 | [LLM 接入层](./05-model.md) | model.LLM 接口、DeepSeek 自定义模型实战、Gemini 内置实现、Go 版本限制 |
| 06 | [工具系统](./06-tool.md) | Tool 接口、FunctionTool 最佳实践、Tool Context 实战、HITL 三级确认、Skills 技能系统、常见问题 |

### 三、状态与存储篇

| # | 文档 | 说明 |
|---|------|------|
| 07 | [会话与状态管理](./07-session.md) | Session/State/Event 接口、状态作用域、Service 实现 |
| 08 | [长期记忆服务](./08-memory.md) | Memory Service、InMemory/VertexAI 实现、记忆工具 |
| 09 | [制品/文件存储](./09-artifact.md) | Artifact Service、版本管理、GCS 实现、制品引用 |

### 四、进阶篇

| # | 文档 | 说明 |
|---|------|------|
| 10 | [插件系统](./10-plugin.md) | Plugin 结构、生命周期、内置插件（Logging/RetryAndReflect） |
| 11 | [服务化部署](./11-server-deploy.md) | REST/A2A/AgentEngine、CLI 工具、Launcher、容器化 |
| 12 | [可观测性与追踪](./12-telemetry.md) | OpenTelemetry 集成、Tracing、Logging |

### 五、附录

| # | 文档 | 说明 |
|---|------|------|
| 13 | [示例代码导读](./13-examples-walkthrough.md) | examples/ 目录全部示例的逐一介绍 |

### Go 前置知识详解（go-fundamentals/）

| # | 文档 | 说明 |
|---|------|------|
| 01 | [迭代器 iter.Seq2](./go-fundamentals/01-iterators.md) | Go 1.23 迭代器协议、Agent.Run 返回值、yield 机制 |
| 02 | [接口与组合](./go-fundamentals/02-interfaces-composition.md) | Agent 接口、密封模式、agent.New() 构造器、接口嵌套 |
| 03 | [函数选项模式](./go-fundamentals/03-functional-options.md) | Config+Option 混合模式、RunOption、WithStateDelta |
| 04 | [genai.Content 多模态消息](./go-fundamentals/04-genai-content.md) | genai 包、Content/Part 结构、FunctionCall/Response |
| 05 | [Context 与 State](./go-fundamentals/05-context-state.md) | InvocationContext、session.State、作用域前缀、StateDelta |
| 06 | [错误处理](./go-fundamentals/06-error-handling.md) | iter.Seq2 错误传播、Plugin 错误回调、RetryAndReflect |

## 学习路径建议

**新手路径**（约 2-3 小时）：
- Go 前置知识 → 00 总览 → 02 快速入门 → 03 Agent → 06 工具 → 13 示例

**系统学习路径**（约 1-2 天）：
- Go 前置知识 → 按文档编号 00 → 13 顺序阅读，配合源码阅读

**部署路径**（已熟悉概念，需要部署）：
- 11 服务化部署 → 12 可观测性 → 13 示例（rest/a2a/agentengine）

**贡献者路径**（深入源码）：
- 01 架构 → 04 Runner → 03 Agent → 10 插件 → 阅读 `internal/` 目录

## 源码核心入口速查

| 入口 | 路径 | 行号 |
|------|------|------|
| Agent 接口 | `source/agent/agent.go` | 43 |
| LLMAgent 构造 | `source/agent/llmagent/llmagent.go` | 34 |
| Runner.Run | `source/runner/runner.go` | 131 |
| Runner.RunLive | `source/runner/runner.go` | 328 |
| LLM 接口 | `source/model/llm.go` | 26 |
| Tool 接口 | `source/tool/tool.go` | 42 |
| FunctionTool 构造 | `source/tool/functiontool/function.go` | 78 |
| Session 接口 | `source/session/session.go` | 32 |
| Event 结构 | `source/session/session.go` | 92 |
| Plugin 配置 | `source/plugin/plugin.go` | 26 |
| Telemetry 初始化 | `source/telemetry/telemetry.go` | 118 |
| Quickstart 示例 | `source/examples/quickstart/main.go` | 1 |

## 版本说明

- ADK-Go 版本：v1.2.0
- Go 模块：`google.golang.org/adk`
- 许可证：Apache 2.0
- 文档编写日期：2026-05-26

## 相关链接

- 官方仓库：<https://github.com/google/adk-go>
- 官方文档：<https://google.github.io/adk-docs/>
- Code Wiki：<https://codewiki.google/github.com/google/adk-go>
- Python ADK：<https://github.com/google/adk-python>
- Java ADK：<https://github.com/google/adk-java>
- ADK Web：<https://github.com/google/adk-web>
