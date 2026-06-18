# 什么是 MCP 协议

> 本节带你从零理解 MCP（Model Context Protocol）：它解决什么问题、三个核心角色是谁、和 Function Calling 有什么不同。
>
> **本节你将学到**：为什么需要工具接入标准、MCP 的定位、三个角色（Host / Client / Server）、它和 Function Calling 的关键区别。
>
> **一句话比喻**：MCP 像「**USB-C 标准接口**」——以前每个外设都自带专用驱动线，有了 USB-C 标准后，任何外设插任何设备都能用。MCP 让任何 AI 应用都能用标准方式接入任何工具。

## 为什么需要 MCP

随着 AI 应用变复杂，它们都需要接入外部工具和数据：

- Claude Desktop 想读你的 GitHub、文件系统、Slack
- Cursor 想调你的数据库、终端、文档
- 自研 Agent 想接公司的 CRM、工单系统、内部 API

如果每个 AI 应用都自己写一套集成，就会出现这些痛点：

- **N × M 适配地狱**：N 个 AI 应用 × M 个工具 = N×M 套对接代码，没人写得完
- **重复造轮子**：每个 IDE 都要重新实现「读 GitHub」的功能
- **没有统一抽象**：工具发现、调用、结果返回、错误处理各搞各的
- **安全边界混乱**：每个工具自己决定权限、确认、隔离

MCP 的目标就是提供**一套统一协议**：让任何 AI 应用（Host）通过统一的 Client，连接任何遵循 MCP 标准的工具提供方（Server），就像 USB-C 让任何设备都能用标准接口连接任何外设。

## MCP 是什么

MCP（Model Context Protocol，模型上下文协议）是一个**开放标准**，标准化 AI 应用如何接入**工具、资源、上下文**。

它有几个核心特点：

1. **跨应用跨工具**——不绑定任何特定 AI 应用或工具
2. **基于 JSON-RPC 2.0**——消息格式标准化、跨语言
3. **传输中立**——支持 stdio（本地）和 Streamable HTTP（远程）等多种传输
4. **能力协商**——连接时双方声明自己支持什么，按需启用

::: tip 核心理解
MCP 不是「另一个插件系统」，而是**工具接入的通用语言**。就像 HTTP 让浏览器能访问任何网站——不管你用 Chrome 还是 Safari、用 Nginx 还是 Apache，大家说的是同一种话。MCP 让 Claude、ChatGPT、Cursor、VS Code 都能用同一种方式接入同一个工具。
:::

## 三个核心角色

MCP 用「**手机 / 数据线 / 外设**」比喻最容易理解：

### Host（宿主应用）

Host 是**跑大模型的 AI 应用**，是工具的消费者。典型 Host：

- Claude Desktop（Anthropic 桌面应用）
- Cursor、VS Code（AI 编辑器）
- ChatGPT（OpenAI 应用）
- 任何你自研、集成了 LLM 的应用

Host 负责管理多个 Client、把 Server 提供的工具/资源/上下文整合给模型用、对用户做最终展示。

### Client（协议会话）

Client 是 Host **内部的连接器**。每个 Client 和**一个** Server 是 1:1 关系——你接几个 Server，Host 里就有几个 Client 实例。

::: tip Host vs Client 的关系
Client 是 Host 的「手」，Host 是「大脑」。你不用单独装 Client——当你配置 Claude Desktop 连接一个新 Server 时，Host 自动起一个对应的 Client。
:::

### Server（工具提供方）

Server 是**提供工具/资源/提示词**的一方。它可以是：

- 一个读 GitHub 的 Server
- 一个查数据库的 Server
- 一个查天气的 Server
- 一个操作文件系统的 Server

Server 可以用任何语言写（Python、Go、Node、Rust 都有 SDK），只要遵守 MCP 协议。它**不关心** Host 是 Claude 还是 Cursor——大家都说一样的协议。

::: warning Server ≠ 工具本身
一个 Server 可以暴露**多个**工具、资源、提示词（下一节会讲三大原语）。比如「GitHub Server」可以同时提供 `create_issue` / `list_prs` / `read_file` 等多个工具。Server 是「工具包」，工具是「工具包里的一件件工具」。
:::

## MCP vs Function Calling：协议层 vs 单次调用

很多人会问：Function Calling 已经能让模型调用工具了，为什么还要 MCP？

| 维度 | Function Calling | MCP |
|------|------------------|-----|
| **是什么** | 一次 LLM 调用的能力（让模型决定调哪个函数） | 一套协议（标准化工具发现、调用、生命周期） |
| **粒度** | 单次请求-响应 | 整个工具接入生命周期（发现→协商→调用→取消） |
| **工具从哪来** | 每次请求你手动塞 `tools` 数组 | Server 自动暴露，Client 自动发现 |
| **跨应用复用** | 每个 AI 应用自己集成 | 写一次 Server，所有 Host 都能用 |
| **层级** | 协议内部的一个机制 | 协议层（Function Calling 是 MCP 内部 Tool 调用的一部分） |

::: tip 一句话理解
**Function Calling 是模型决定「我想调用工具 X」的能力；MCP 是把「工具怎么暴露、怎么发现、怎么调用、怎么返回」全部标准化的协议。** MCP 的 Tool 调用内部用的就是类似 Function Calling 的机制，但 MCP 在上面加了发现、协商、生命周期、安全等一整套规范。
:::

实际场景判断：

- **简单场景**：你只有一个 AI 应用、一两个固定工具 → 用 Function Calling 够了
- **复杂场景**：你想让工具被多个 AI 应用复用、想标准化工具接入、想支持动态发现 → 用 MCP

## 动手实验

1. **数一数你身边的 Host**：列出你日常用的 AI 应用（Claude Desktop、Cursor、ChatGPT、Copilot……），理解它们都是 MCP 的「Host」角色，只是各自接的 Server 不同。
2. **逛 Server 市场**：打开 `https://github.com/modelcontextprotocol/servers` 看官方维护的 Server 列表（GitHub、Filesystem、Slack、PostgreSQL 等），感受「写一次 Server 处处可用」。
3. **对比 Function Calling**：找一个你写过的 Function Calling 示例，思考——如果要把它变成 MCP Server，哪些东西需要抽出来（工具声明、调用协议、返回格式），哪些可以保留（具体函数实现）。
