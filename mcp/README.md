# MCP 协议系统学习

> 用最简单的例子，一步步理解模型如何标准化接入工具和上下文。
>
> MCP 让任何 AI 应用（Claude、Cursor、VS Code 等）通过统一协议接入任何工具提供方——所有想做工具/上下文接入的 AI 应用，最终都要面对这层协议。

## 从哪开始

| 你的情况 | 起点章节 |
|---|---|
| 没接触过 MCP，想从零开始 | 入门基础 → [00 什么是 MCP](./getting-started/00-what-is-mcp.md) |
| 知道 MCP 概念，想深入协议细节 | 协议详解 → [协议总览](./00-mcp-from-zero.md) |
| 想实战写 MCP Server | 实践模块 → [Python Server 实战](./10-mcp-server-python.md) |

## 文档目录

### 入门基础

零基础起步，每篇都用最小可运行例子演示。建立对 MCP 的直觉。

| # | 文档 | 说明 |
|---|------|------|
| 00 | [什么是 MCP 协议](./getting-started/00-what-is-mcp.md) | 问题背景、三角色（Host/Client/Server）、vs Function Calling |
| 01 | [第一次写 MCP Server](./getting-started/01-first-server.md) | FastMCP 最小 Server、Inspector 连接、Claude Desktop 接入 |
| 02 | [三大原语初体验](./getting-started/02-primitives-tour.md) | Resources / Tools / Prompts 各一个最小例子、何时用哪个 |

### 协议详解

已建立直觉后，深入协议本身——架构、能力协商、Server/Client 能力、传输与安全、实现指南。

| # | 文档 | 说明 |
|---|------|------|
| 00 | [协议总览](./00-mcp-from-zero.md) | MCP 全景地图、对象模型、生命周期 |
| 01 | [协议架构](./01-protocol-architecture.md) | Host/Client/Server 分层、JSON-RPC 2.0、初始化、能力协商 |
| 02 | [Server 能力](./02-server-capabilities.md) | Resources、Resource Templates、Prompts、Tools、分页订阅 |
| 03 | [Client 能力](./03-client-capabilities.md) | Roots、Sampling、Elicitation、Logging、Progress |
| 04 | [传输与安全](./04-transports-security.md) | stdio、Streamable HTTP、会话、本地权限、远程认证 |
| 05 | [实现指南](./05-implementation-guide.md) | 从 0 设计 Server、方法清单、错误处理、测试与发布 |

### 实践模块

具体语言/平台的实战——Python Server、Go Server、Client 接入、进阶架构。

| # | 文档 | 说明 |
|---|------|------|
| 10 | [Python Server 实战](./10-mcp-server-python.md) | FastMCP 深入、完整示例、部署 |
| 11 | [Go Server 实战](./11-mcp-server-go.md) | go-mcp SDK、Server/Client 完整示例 |
| 12 | [Client 多平台接入](./12-mcp-client-integration.md) | Claude Desktop / Cursor / VS Code / 自研 Host 接入 |
| 13 | [进阶架构与部署](./13-mcp-advanced.md) | 多 Server 编排、生产部署、可观测性 |

## 为什么需要学这个

学完本目录后，你应该能回答：

- MCP 为什么不是「另一个插件系统」，而是一套上下文和工具接入协议
- 一个 MCP Host、MCP Client、MCP Server 分别负责什么
- MCP 请求、响应、通知如何基于 JSON-RPC 2.0 表达
- 一个 MCP Server 如何暴露资源、资源模板、提示词模板和工具
- Client 能力为什么重要，Sampling、Roots、Elicitation 分别解决什么问题
- 本地 stdio Server 与远程 Streamable HTTP Server 的区别
- 写 MCP Server 时哪些权限、安全和用户确认边界不能省略
- 如何判断一个功能应该做成 Resource、Prompt、Tool，还是 Host 内部能力

## 学习路径

1. **入门**：[00 什么是 MCP](./getting-started/00-what-is-mcp.md) → [01 第一次写 Server](./getting-started/01-first-server.md) → [02 三大原语](./getting-started/02-primitives-tour.md)
2. **详解**：[协议总览](./00-mcp-from-zero.md) → [协议架构](./01-protocol-architecture.md) → [Server 能力](./02-server-capabilities.md) → [Client 能力](./03-client-capabilities.md) → [传输与安全](./04-transports-security.md) → [实现指南](./05-implementation-guide.md)
3. **实战**：[Python Server](./10-mcp-server-python.md) → [Go Server](./11-mcp-server-go.md) → [Client 接入](./12-mcp-client-integration.md) → [进阶架构](./13-mcp-advanced.md)

## 官方资料

- 官方规范：https://modelcontextprotocol.io/specification/2025-11-25
- 官方文档与规范仓库：https://github.com/modelcontextprotocol/modelcontextprotocol
