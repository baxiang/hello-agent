# io.agentscope.core.shutdown — 关闭包文档

## 概述

管理 Agent 在 JVM 关闭或收到外部关闭信号时的安全关闭。

## GracefulShutdownManager

单例，协调关闭流程：
- 注册 JVM 关闭 Hook（`AgentScopeJvmShutdownHook`）
- 跟踪活跃的 Agent 请求
- 将 Agent 绑定到 Session 以便关闭时状态持久化
- 配置 `PartialReasoningPolicy` 处理中断的推理

## 关闭流程

1. JVM 关闭信号或显式 `initiateShutdown()` 调用
2. Agent 通过 `interrupt(InterruptSource.SYSTEM)` 标记为正在关闭
3. 如果绑定到 Session，Agent 保存状态
4. Agent 抛出 `AgentShuttingDownException`（由调用方捕获）
5. 所有 Agent 完成后，JVM 退出

## PartialReasoningPolicy

控制中断推理的处理方式：

| 策略 | 说明 |
|---|---|
| `SAVE` | 将部分推理结果保存到内存（默认） |
| `DISCARD` | 丢弃部分结果，不修改内存 |

## GracefulShutdownHook

系统级 Hook，注册到所有 `AgentBase` 实例。确保关闭状态被正确记录。

## 相关文档

- [核心包](../core.md)
- [Agent 包](agent.md)
