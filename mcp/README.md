# MCP 协议系统学习

这个目录用于系统学习 MCP（Model Context Protocol，模型上下文协议）。目标不是只记住几个名词，而是能理解协议边界、消息模型、能力协商、安全要求，并能自己设计一个可维护的 MCP Server 或 Host 集成。

## 推荐阅读顺序

1. [00-mcp-from-zero.md](./00-mcp-from-zero.md)
   - MCP 的问题背景、核心角色和学习地图
2. [01-protocol-architecture.md](./01-protocol-architecture.md)
   - Host、Client、Server、Session、Transport 的分层关系
   - JSON-RPC 2.0 消息、请求、响应、通知和错误
   - 初始化、能力协商、生命周期和版本兼容
3. [02-server-capabilities.md](./02-server-capabilities.md)
   - Resources、Resource Templates、Prompts、Tools
   - 分页、订阅、变更通知、工具结果和错误表达
4. [03-client-capabilities.md](./03-client-capabilities.md)
   - Roots、Sampling、Elicitation、Logging、Progress、Completion
   - 为什么 MCP 不是 Server 单向暴露工具
5. [04-transports-security.md](./04-transports-security.md)
   - stdio、Streamable HTTP、SSE、会话与安全边界
   - 本地权限、远程认证、Origin 校验、用户确认
6. [05-implementation-guide.md](./05-implementation-guide.md)
   - 从 0 设计 MCP Server
   - 方法清单、输入 schema、错误处理、测试与发布

## 学习目标

学完本目录后，你应该能回答：

- MCP 为什么不是“另一个插件系统”，而是一套上下文和工具接入协议。
- 一个 MCP Host、MCP Client、MCP Server 分别负责什么。
- MCP 请求、响应、通知如何基于 JSON-RPC 2.0 表达。
- 一个 MCP Server 如何暴露资源、资源模板、提示词模板和工具。
- Client 能力为什么重要，Sampling、Roots、Elicitation 分别解决什么问题。
- 本地 stdio Server 与远程 Streamable HTTP Server 的区别。
- 写 MCP Server 时哪些权限、安全和用户确认边界不能省略。
- 如何判断一个功能应该做成 Resource、Prompt、Tool，还是 Host 内部能力。

## 官方资料

- 官方规范：https://modelcontextprotocol.io/specification/2025-11-25
- 官方文档与规范仓库：https://github.com/modelcontextprotocol/modelcontextprotocol
