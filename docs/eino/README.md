# Eino 中文文档索引

> Eino（发音 "I-know"）是字节跳动 CloudWeGo 团队开源的 Go 语言 LLM 应用开发框架。
> 本文档集从源码出发，以中文系统讲解 Eino 的架构、组件、编排与 Agent 开发。

---

## 文档目录

| 编号 | 文件 | 标题 | 说明 |
|------|------|------|------|
| 00 | [00-overview.md](00-overview.md) | 项目概览 | 设计哲学、核心概念、模块总览与快速上手 |
| 01 | [01-architecture.md](01-architecture.md) | 架构设计 | 分层架构、数据流向、模块间依赖关系 |
| 02 | [02-schema.md](02-schema.md) | Schema 数据模型 | Message、Document、ToolInfo、StreamReader 等核心类型 |
| 03 | [03-components.md](03-components.md) | Components 组件 | 7 种组件接口：Model、Tool、Prompt、Retriever 等 |
| 04 | [04-compose.md](04-compose.md) | Compose 编排 | Chain、Graph、Workflow 三种编排方式 |
| 05 | [05-callbacks.md](05-callbacks.md) | Callbacks 回调 | 5 种回调时机与可观测性体系 |
| 06 | [06-flow.md](06-flow.md) | Flow 预构建流程 | React Agent、MultiQuery、Router 等开箱即用流程 |
| 07 | [07-adk.md](07-adk.md) | ADK Agent 开发套件 | ChatModelAgent、Runner、AgentTool、Workflow |
| 08 | [08-prebuilt-agents.md](08-prebuilt-agents.md) | 预构建 Agent | Supervisor、PlanExecute、Deep |
| 09 | [09-middlewares.md](09-middlewares.md) | ADK 中间件 | 8 种内置中间件 |
| 10 | [10-quickstart.md](10-quickstart.md) | 快速入门 | 10 分钟从零构建 Eino 应用的完整指南 |
| 11 | [11-examples.md](11-examples.md) | 示例导读 | 源码中的关键示例索引与导读 |
| 12 | [12-prerequisites.md](12-prerequisites.md) | 前置知识 | Go 语言技术能力清单与自检 |

### Go 前置知识详解（go-fundamentals/）

| 编号 | 文件 | 标题 | 说明 |
|------|------|------|------|
| 01 | [01-generics.md](go-fundamentals/01-generics.md) | 泛型 | 类型参数、类型约束、Eino 泛型实例 |
| 02 | [02-interfaces.md](go-fundamentals/02-interfaces.md) | 接口与类型系统 | 接口组合、类型别名、密封约束 |
| 03 | [03-functional-options.md](go-fundamentals/03-functional-options.md) | 函数选项模式 | Eino 配置的统一范式 |
| 04 | [04-channel-concurrency.md](go-fundamentals/04-channel-concurrency.md) | Channel 与并发 | stream[T] 底层、Copy/合并、sync 原语 |
| 05 | [05-context.md](go-fundamentals/05-context.md) | Context 传播 | 状态/回调/取消信号的生命线 |
| 06 | [06-error-handling.md](go-fundamentals/06-error-handling.md) | 错误处理 | 哨兵错误、errors.Is/As、流式错误 |
| 07 | [07-io-pattern.md](go-fundamentals/07-io-pattern.md) | io 模式 | io.Reader/Writer 对照 StreamReader |
| 08 | [08-reflection.md](go-fundamentals/08-reflection.md) | 反射 | Graph 编译时类型检查、reflect.Select |
| 09 | [09-struct-embedding-tags.md](go-fundamentals/09-struct-embedding-tags.md) | 结构体嵌入与标签 | 配置复用、JSON/gob 序列化 |

---

## 学习路径

### 路径一：入门路径

适合刚接触 Eino 的开发者，快速了解框架并上手编码。

```
12 前置知识 → 00 项目概览 → 10 快速入门 → 03 组件接口 → 04 编排方式
```

- **12** 自检 Go 语言知识储备
- **00** 建立全局认知：设计哲学与模块关系
- **10** 动手实践：从 ChatModel 调用到 Agent 构建
- **03** 理解组件：掌握 Model、Tool、Prompt 等核心接口
- **04** 学习编排：用 Chain 和 Graph 串联组件

### 路径二：架构路径

适合需要深入理解框架设计或贡献代码的开发者。

```
00 项目概览 → 01 架构设计 → 02 Schema 数据模型 → 05 Callbacks 回调
```

- **00** 全局视角
- **01** 理解分层架构与模块边界
- **02** 深入数据模型：Message 生命周期与流式处理
- **05** 可观测性：回调机制与追踪集成

### 路径三：Agent 开发路径

适合以构建 LLM Agent 为目标的开发者。

```
06 Flow 预构建 → 11 示例导读 → 10 快速入门（Agent 部分） → 04 编排方式
```

- **06** 理解 ReAct 循环与预构建流程
- **11** 通过源码示例学习 Agent 编写模式
- **10** 实践 ChatModelAgent 和 Runner
- **04** 深入编排：自定义 Agent 内部的 Graph 拓扑

### 路径四：全量学习

按编号顺序通读所有文档，建立完整认知。

```
12 → 00 → 01 → 02 → 03 → 04 → 05 → 06 → 07 → 08 → 09 → 10 → 11
```

---

## 源码参考

文档中的代码引用均基于源码目录 `/source/`，关键包路径：

| 包 | 路径 | 说明 |
|----|------|------|
| `schema` | `source/schema/` | 统一数据模型 |
| `components` | `source/components/` | 组件接口定义 |
| `compose` | `source/compose/` | 流程编排 |
| `callbacks` | `source/callbacks/` | 回调体系 |
| `flow` | `source/flow/` | 预构建流程 |
| `adk` | `source/adk/` | Agent 开发套件 |

---

## 贡献

文档源文件位于 `/docs/`，欢迎补充和修正。
