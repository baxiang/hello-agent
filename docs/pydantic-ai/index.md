# Pydantic AI 系统学习

这个目录用于系统学习 Pydantic AI。目标不是只会写一个 demo，而是理解它为什么以 Pydantic 类型系统为中心，如何设计 Agent、结构化输出、工具、依赖注入、流式输出、可观测性、评估，以及如何把它放进生产系统。

> 当前资料按 2026-05-27 的官方文档和仓库信息整理。Pydantic AI 仍在快速演进，涉及 A2A、toolsets、provider 默认行为等内容时，以官方最新文档为准。

## 推荐阅读顺序

1. [00-pydantic-ai-from-zero.md](./00-pydantic-ai-from-zero.md)
   - Pydantic AI 的定位、适用场景和学习地图
2. [01-agent-core.md](./01-agent-core.md)
   - `Agent`、模型、instructions、运行方式、消息历史和复用
3. [02-structured-output.md](./02-structured-output.md)
   - `output_type`、Pydantic 模型、校验、重试和结果建模
4. [03-tools-deps.md](./03-tools-deps.md)
   - Function tools、`RunContext`、`deps_type`、依赖注入和测试替身
5. [04-streaming-observability-evals.md](./04-streaming-observability-evals.md)
   - 流式输出、Logfire、OpenTelemetry、evals 和调试策略
6. [05-mcp-a2a-production.md](./05-mcp-a2a-production.md)
   - MCP、A2A、Human-in-the-loop、部署、安全和生产清单

## 学习目标

学完本目录后，你应该能回答：

- Pydantic AI 和直接调用模型 SDK、LangChain 类框架的边界有什么不同。
- 为什么 `Agent` 是类型化容器，而不是普通 prompt wrapper。
- 如何用 Pydantic 模型把 LLM 输出变成可校验、可测试的业务对象。
- 如何设计工具函数、依赖注入和外部资源访问。
- 如何做流式体验、日志追踪、评估和回归测试。
- 如何把 Pydantic AI Agent 接入 MCP 工具和外部 Agent 协作系统。
- 上生产前需要哪些安全、权限、成本、重试和可观测性设计。

## 官方资料

- 官方文档：https://pydantic.dev/docs/ai/overview/
- 官方仓库：https://github.com/pydantic/pydantic-ai
- PyPI 包：https://pypi.org/project/pydantic-ai/

