# io.agentscope.core.tracing — 可观测性包文档

## TracerRegistry

单例，为 Agent 执行管道提供追踪能力。通过 SPI 与外部可观测性系统集成。

## 集成点

追踪在 Agent 生命周期关键点激活：

| 点 | 捕获内容 |
|---|---|
| `AgentBase.call()` | Agent 执行 Span |
| `Model.stream()` | 模型推理 Span |
| `Toolkit.callTools()` | 工具执行 Span |

## OpenTelemetry 集成

原生 OpenTelemetry 集成通过 `agentscope-extensions-studio` 模块可用，提供：
- 整个 Agent 管道的分布式追踪
- AgentScope Studio 可视化调试
- 实时监控仪表板

## 相关文档

- [核心包](../core.md)
