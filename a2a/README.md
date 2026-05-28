# A2A 协议系统学习

这个目录用于系统学习 A2A（Agent2Agent，智能体到智能体协议）。目标不是只理解“Agent 调 Agent”，而是掌握 Agent 发现、能力声明、消息模型、任务生命周期、流式事件、安全边界和工程实现方法。

## 推荐阅读顺序

1. [00-a2a-from-zero.md](./00-a2a-from-zero.md)
   - A2A 的问题背景、核心角色和学习地图
2. [01-agent-discovery-card.md](./01-agent-discovery-card.md)
   - Agent Card、Skill、Capabilities、Security、Interfaces
   - well-known 发现、注册中心发现和版本兼容
3. [02-message-task-model.md](./02-message-task-model.md)
   - Message、Part、Task、TaskStatus、Artifact、Context
   - 任务状态机、多轮输入、产物建模
4. [03-protocol-methods.md](./03-protocol-methods.md)
   - JSON-RPC、HTTP、SSE
   - `message/send`、`message/stream`、`tasks/get`、`tasks/cancel`
   - Push Notification、错误处理和幂等性
5. [04-security-architecture.md](./04-security-architecture.md)
   - 认证、授权、数据最小化、opaque execution
   - Prompt Injection、回调安全、审计和人类确认
6. [05-implementation-guide.md](./05-implementation-guide.md)
   - 从 0 设计 A2A Agent Server 和 Client Agent
   - 测试矩阵、工程清单、A2A 与 MCP 组合

## 学习目标

学完本目录后，你应该能回答：

- A2A 为什么用于“智能体之间协作”，而不是单纯工具调用。
- 一个 Agent Card 如何描述远程 Agent 的身份、能力、技能和安全要求。
- A2A 的 Message、Part、Task、Artifact 分别表达什么。
- 同步消息、流式消息和长任务之间如何选择。
- Task 状态机如何支持多轮补充输入、认证和异步执行。
- Push Notification 和 streaming 分别解决什么问题。
- 如何设计一个不会泄露内部工具、记忆和推理过程的 Remote Agent。
- A2A 与 MCP 在定位和使用场景上有什么不同。

## 官方资料

- 官方规范：https://a2a-protocol.org/latest/specification/
- 官方仓库：https://github.com/a2aproject/A2A
