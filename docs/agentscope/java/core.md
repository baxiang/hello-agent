# io.agentscope.core — 核心包文档

## 概述

AgentScope Java 核心模块 — 面向 Agent 编程框架，用于构建 LLM 驱动的应用。

## 入口点

主要入口点是 `ReActAgent`，实现 Reasoning-Acting (ReAct) 范式。使用流式 Builder API 构建 Agent：

```java
ReActAgent agent = ReActAgent.builder()
    .name("Assistant")
    .sysPrompt("You are a helpful AI assistant.")
    .model(DashScopeChatModel.builder().apiKey(key).modelName("qwen-plus").build())
    .toolkit(toolkit)
    .memory(new InMemoryMemory())
    .maxIters(10)
    .build();

Msg response = agent.call(userMsg).block(); // .block() 仅允许在 main() 或测试中使用
```

## 核心架构

| 层次 | 说明 | 关键类 |
|---|---|---|
| **Agent 层级** | `AgentBase` 提供基础设施（Hook、中断、状态管理）；`ReActAgent` 添加推理-执行循环 | `Agent`, `AgentBase`, `ReActAgent` |
| **消息系统** | `Msg` 包含类型化 `ContentBlock` 列表（TextBlock, ToolUseBlock, ToolResultBlock 等） | `Msg`, `MsgRole`, `ContentBlock` 变体 |
| **模型抽象** | `Model` 接口，实现支持 DashScope、OpenAI、Gemini、Anthropic、Ollama | `Model`, `DashScopeChatModel`, `OpenAIChatModel` |
| **工具系统** | `Toolkit` 管理工具注册、分组和执行。通过 `@Tool` 注解定义工具 | `Toolkit`, `@Tool`, `@ToolParam`, `AgentTool` |
| **Hook 系统** | `Hook` 接口拦截 12 种生命周期事件 | `Hook`, `HookEvent` 变体（12 种事件类型） |
| **内存** | `Memory` 接口管理对话历史，`InMemoryMemory` 短期，`LongTermMemory` 跨会话持久化 | `Memory`, `InMemoryMemory`, `LongTermMemory` |
| **Pipeline 模式** | `SequentialPipeline`（链式）、`FanoutPipeline`（并行）、`MsgHub`（广播） | `SequentialPipeline`, `FanoutPipeline`, `MsgHub` |

## 响应式执行模型

所有 I/O 操作返回 `Mono<T>` 或 `Flux<T>`（Project Reactor）。**绝不在 Agent 逻辑、服务方法或库代码中使用 `.block()`。** 仅允许在 `main()` 方法和测试中使用。

## 线程安全

Agent 实例**不是**为并发执行设计的。单个 Agent 实例不应被多线程并发调用。框架使用 `Mono.using` 配合 acquire/release 语义保证清理。

## 相关文档

- [Agent 包](package-docs/agent.md)
- [消息包](package-docs/message.md)
- [模型包](package-docs/model.md)
- [工具包](package-docs/tool.md)
- [Hook 包](package-docs/hook.md)
- [内存包](package-docs/memory.md)
- [Pipeline 包](package-docs/pipeline.md)
