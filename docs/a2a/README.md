# A2A 协议系统学习

> 用最简单的 curl 调用，一步步理解 Agent 间协作的底层协议。
>
> A2A 让不同框架、不同语言、不同厂商的 AI Agent 互相发现、互相委派任务、交换结果——所有 Agent 框架（LangGraph、ADK、自研系统）想做 Agent 间协作，最终都要面对这层协议。

## 从哪开始

| 你的情况 | 起点章节 |
|---|---|
| 没接触过 A2A，想从零开始 | 入门基础 → [00 什么是 A2A](./getting-started/00-what-is-a2a.md) |
| 知道 A2A 概念，想深入协议细节 | 协议详解 → [协议总览](./00-a2a-from-zero.md) |
| 想实现一个 Agent Server | 协议详解 → [实现指南](./05-implementation-guide.md) |

## 文档目录

### 入门基础

零基础起步，每篇都用 curl 演示，不依赖任何 SDK。建立对 A2A 的直觉。

| # | 文档 | 说明 |
|---|------|------|
| 00 | [什么是 A2A 协议](./getting-started/00-what-is-a2a.md) | 问题背景、A2A 定位、A2A Client/Server、Agent Card |
| 01 | [第一次调用 A2A](./getting-started/01-first-call.md) | curl 跑通发现→发消息→拿结果闭环、JSON-RPC 解读、3 个常见错误 |

### 协议详解

已建立直觉后，深入协议本身——Agent Card 全字段、消息任务模型、协议方法、安全架构、工程实现。

| # | 文档 | 说明 |
|---|------|------|
| 00 | [协议总览](./00-a2a-from-zero.md) | A2A 全景地图、数据模型、通信基础、典型流程 |
| 01 | [Agent 发现与名片](./01-agent-discovery-card.md) | Agent Card 字段全解、Skill、SecuritySchemes、发现机制 |
| 02 | [消息与任务模型](./02-message-task-model.md) | Message、Part、Task、TaskStatus、Artifact、任务状态机 |
| 03 | [协议方法](./03-protocol-methods.md) | JSON-RPC 方法、流式事件、Push Notification、错误处理 |
| 04 | [安全架构](./04-security-architecture.md) | 认证、授权、数据最小化、不透明执行、人类确认 |
| 05 | [实现指南](./05-implementation-guide.md) | 从 0 实现 Agent Server 与 Client、测试矩阵、工程清单 |

## 为什么需要学这个

学完本目录后，你应该能回答：

- A2A 为什么用于「智能体之间协作」，而不是单纯的工具调用
- 一个 Agent Card 如何描述远程 Agent 的身份、能力、技能和安全要求
- A2A 的 Message、Part、Task、Artifact 分别表达什么
- 同步消息、流式消息和长任务之间如何选择
- Task 状态机如何支持多轮补充输入、认证和异步执行
- Push Notification 和 streaming 分别解决什么问题
- 如何设计一个不会泄露内部工具、记忆和推理过程的 Remote Agent

## 学习路径

1. **入门**：[00 什么是 A2A](./getting-started/00-what-is-a2a.md) → [01 第一次调用](./getting-started/01-first-call.md)
2. **详解**：[协议总览](./00-a2a-from-zero.md) → [Agent 发现](./01-agent-discovery-card.md) → [消息任务模型](./02-message-task-model.md) → [协议方法](./03-protocol-methods.md) → [安全架构](./04-security-architecture.md) → [实现指南](./05-implementation-guide.md)

## 官方资料

- 官方规范：https://a2a-protocol.org/latest/specification/
- 官方仓库：https://github.com/a2aproject/A2A
