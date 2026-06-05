# OpenAI Agents SDK 技术学习文档

OpenAI Agents SDK 是一个轻量级但功能强大的多 Agent 工作流框架，支持 100+ LLM 提供商，内置追踪、护栏、会话管理和语音 Agent 等生产级能力。

源码位置：`../source/`

## 文档目录

### 入门篇

| # | 文档 | 说明 |
|---|------|------|
| 00 | [项目总览](./00-overview.md) | 项目简介、设计哲学、与 ADK 对比、核心概念 |
| 01 | [Agent 核心](./01-agent.md) | Agent 创建、指令、模型配置、子 Agent、输出类型 |
| 02 | [工具系统](./02-tools.md) | FunctionTool、MCP 工具、托管工具、工具 Schema |
| 03 | [Agent 转移（Handoffs）](./03-handoffs.md) | Agent 间委托、handoff 配置、历史追踪 |
| 04 | [护栏（Guardrails）](./04-guardrails.md) | 输入/输出安全检查、工具级护栏 |
| 05 | [追踪（Tracing）](./05-tracing.md) | Span/Trace 体系、处理器、导出配置 |
| 06 | [会话与记忆](./06-sessions-memory.md) | Session 持久化、SQLite、OpenAI 托管 |
| 07 | [实时语音 Agent](./07-realtime-voice.md) | gpt-realtime-2、WebSocket、音频管线 |
| 08 | [沙箱 Agent](./08-sandbox.md) | 容器化执行、清单、快照、远程挂载 |

## 版本说明

- 仓库：<https://github.com/openai/openai-agents-python>
- 许可证：MIT
- 文档编写日期：2026-06-05

## 相关链接

- 官方文档：<https://openai.github.io/openai-agents-python/>
- PyPI：<https://pypi.org/project/openai-agents/>
- VS Code 扩展：<https://github.com/openai/openai-agents-vscode>
