# Runner 执行器 - Agent 的运行时基础设施

> **源码路径**：[`trpc-agent-go/examples/`](../../../../trpc-agent-go/examples)（本分类覆盖 runner/managedrunner/cancelrun/runwithmessages/ralphloop）
> **本页**：分类索引 + 深度原理（源自原 03-runner.md）

## 子示例导航

| 子示例 | 文章 | 难度 | 一句话说明 |
|--------|------|------|-----------|
| [`runner/`](./runner.md) | Runner | 入门 | 工具调用 + 会话管理 + 流式切换的完整实战 |
| [`managedrunner/`](./managedrunner.md) | ManagedRunner | 进阶 | 后台运行控制、分离式取消、状态轮询 |
| [`cancelrun/`](./cancelrun.md) | CancelRun | 入门 | 通过取消 context 安全停止运行中的 Agent |
| [`runwithmessages/`](./runwithmessages.md) | RunWithMessages | 进阶 | 注入外部对话历史驱动 Agent（中间件场景） |
| [`ralphloop/`](./ralphloop.md) | RalphLoop | 进阶 | 迭代式任务循环，防止 LLM 过早停止 |

## 选型建议

```
需要运行时基础设施？
├── 完整的会话 + 工具 + 流式           → runner（标准 Runner）
├── 后台长跑、需要状态查询/取消        → managedrunner（ManagedRunner）
├── 需要安全停止运行中的 Agent         → cancelrun（ctx.Cancel）
└── 上游已维护对话历史                 → runwithmessages（WithMessages）

需要外循环防 LLM 早停？               → ralphloop（CompletionPromise）
```

## 核心概念

- **Runner**：Agent 的执行器，封装 Session 持久化、Memory 提取、插件注入。详见 [深度原理 › Runner 生命周期](#runner-生命周期)
- **Completion 事件**：Runner 在 Agent channel 关闭后注入的请求结束信号。详见 [深度原理 › Completion 事件的设计考量](#completion-事件的设计考量)
- **ManagedRunner**：支持后台运行、状态查询、分离式取消的 Runner 变体。详见 [`managedrunner`](./managedrunner.md)

## 深度原理

> 本节源自原「核心组件」深度文（03-runner.md），整合接口源码、设计哲学与配置速查。

### Runner 生命周期

Runner 是 Agent 的执行器，封装 Session 管理、Event 流处理、插件注入等完整请求生命周期：

```
Runner.Run(ctx, userID, sessionID, message)
  │
  ├─ Session 管理：GetSession → 构建 Invocation → AppendEvent
  ├─ Agent 执行：agent.RunWithPlugins(ctx, inv, agent)
  ├─ Memory 提取：异步 Extractor 分析对话
  └─ Event 流桥接：转发 Agent 事件 + 注入 runner.completion
```

**为什么需要 Runner 而非直接调用 Agent？**

- Agent 只关心"如何处理 Invocation"，不关心 Session 持久化
- Runner 遵循关注分离——Agent 执行 vs 基础设施管理
- 插件在 Runner 层注册一次，全局生效

#### Runner.Run 四阶段执行链

1. **准备阶段**：解析 `RunOptions` → 确定 `appName`（多租户隔离）→ GetSession（不存在则 CreateSession）→ 注入 `WithMessages` 历史 → 处理 Resume 模式 → UserMessageRewriter 重写
2. **构建 Invocation**：通过 `agent.NewInvocation(...)` 装配 Session / Message / Agent / RunOptions，注入 `MemoryService`、`ArtifactService`
3. **执行 Agent**：`agent.RunWithPlugins(ctx, inv, selectedAgent, r.plugins...)` 在 `Agent.Run` 之前调用各插件的 `BeforeAgent`
4. **桥接事件流**：开 goroutine 持续转发 agentCh → bridgeCh，同时
   - 持久化非 partial 事件到 Session
   - 可选持久化被中断的 assistant 文本
   - Agent 关闭后发出 `runner.completion` 事件
   - 触发 Memory 后台 `ExtractAsync`

#### Agent Factory 模式

```go
type AgentFactory func(ctx context.Context, ro agent.RunOptions) (agent.Agent, error)
```

`NewRunnerWithAgentFactory` 每次 `Run()` 调用 factory 创建 Agent。**资源生命周期注意**：Factory 生成的 Agent 不会被 `Runner.Close()` 自动清理；如需释放 MCP 连接、ToolSet 等资源，调用方需在 run 完成后手动清理。

#### 插件机制

```go
func RunWithPlugins(ctx, inv, a, plugins...) {
    for _, p := range plugins {
        p.BeforeAgent(ctx, inv)
    }
    return a.Run(ctx, inv)
}
```

插件通过修改 Invocation 中的 Callbacks / Tool Filter 等实现全局拦截，在 Runner 层注册一次即全局生效。

### 设计哲学

#### 为什么 Runner 不属于 Agent 接口？

分离关注（Separation of Concerns）：

- **Agent**：纯逻辑——如何处理输入，生成什么输出
- **Runner**：纯基础设施——Session 持久化、Memory 提取、插件注入

好处：

1. 同一个 Agent 可以用不同 Runner 配置运行（不同 Session 后端、不同插件）
2. Agent 可独立测试——直接调用 `agent.Run()` 不依赖 Session 服务
3. Runner 层可以叠加 Ralph Loop、Steer 等高级模式而不修改 Agent

#### Completion 事件的设计考量

Runner 在 Agent channel 关闭后额外注入 `runner.completion` 事件：

- 调用方可以通过 `event.IsRunnerCompletion()` 判等长事件流是否真正结束（agent 关闭 channel ≠ 整个请求生命周期结束）
- 把 Memory 后台提取、Session 持久化的"完成"信号统一收口到事件流，调用方无需额外的同步机制
- 与 `flow_error`、`StopError` 等异常信号正交，调用方按需消费

#### Ralph Loop vs CycleAgent

| | Ralph Loop | CycleAgent |
|----|----|----|
| **循环层级** | Runner 层 | Agent 层 |
| **驱动方式** | 验证条件（CompletionPromise/VerifyCommand） | LLM 自主判断 |
| **适用场景** | 代码生成 + 测试验证 | 多轮思考优化 |
| **安全** | MaxIterations 硬限制 | MaxIterations 硬限制 |

#### 取消与清理的正确模式

取消 context 后，**必须持续排空 channel 直到关闭**，否则 agent goroutine 会阻塞在 channel 写入上，造成 goroutine 泄漏：

```go
for range events {
    // 即使 ctx 已取消，也要消费到 channel 关闭
}
```

Runner 会检测到 ctx 取消并停止 LLM 调用，但需要外部消费 channel 直到 agent goroutine 正常退出。详见 [`cancelrun`](./cancelrun.md)。

### 配置速查

#### Runner 配置（`NewRunner` functional options）

| 配置选项 | 类型 | 说明 |
|----------|------|------|
| `WithSessionService(s)` | `session.Service` | Session 存储后端 |
| `WithMemoryService(m)` | `memory.Service` | 长期记忆服务 |
| `WithArtifactService(a)` | `artifact.Service` | 制品存储服务 |
| `WithPlugins(p...)` | `[]plugin.Plugin` | 全局插件列表 |
| `WithAgentFactory(name, f)` | `string, AgentFactory` | 注册命名工厂 |
| `WithRalphLoop(c)` | `RalphLoopConfig` | 外循环验证模式 |
| `WithAwaitUserReplyRouting(b)` | `bool` | HITL 路由支持 |
| `WithPersistInterruptedAssistant(b)` | `bool` | 中断时持久化已输出内容 |

## 学习路径建议

1. **先读 [`runner`](./runner.md)**：看会话管理 + 工具调用的完整实战，建立"Runner 提供基础设施"的直觉
2. **按运行时需求分支**：
   - 后台运行 + 状态查询 → [`managedrunner`](./managedrunner.md)
   - 安全停止 → [`cancelrun`](./cancelrun.md)
   - 注入外部历史 → [`runwithmessages`](./runwithmessages.md)
3. **进阶读 [`ralphloop`](./ralphloop.md)**：理解 Runner 层的外循环模式，对照本文「Ralph Loop vs CycleAgent」表
4. **回到本页「深度原理」节**：在跑通示例后重读接口签名与设计哲学，理解"为什么这么设计"

## 总结

Runner 的设计精髓在于**关注分离**：

- **Agent 管逻辑，Runner 管基础设施**——同一 Agent 可换不同 Runner 配置（不同 Session 后端、不同插件）
- **Completion 事件**统一了请求生命周期的结束信号，调用方无需额外同步
- **插件机制**在 Runner 层注册一次即全局生效，支持 Ralph Loop、Steer 等高级模式叠加

进一步学习：

- Agent 接口与执行循环：[`01-agent-basics`](../01-agent-basics/)
- Session / Memory 深度：[`06-memory-system`](../07-memory-system/memory.md) / [`07-session-management`](../08-session-management/session.md)
- 宏观架构：[`18-architecture`](../../18-architecture.md) / [`19-diagrams`](../../19-diagrams.md)
