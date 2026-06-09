# Runner 执行器 — 源码·实战·原理

Runner 是 Agent 的执行器，封装了 Session 管理、Event 流处理、插件注入等完整请求生命周期。

## 1. 概念概述

Runner 的核心职责：

```
Runner.Run(ctx, userID, sessionID, message)
  │
  ├─ Session 管理：GetSession → 构建 Invocation → AppendEvent
  ├─ Agent 执行：agent.RunWithPlugins(ctx, inv, agent)
  ├─ Memory 提取：异步 Extractor 分析对话
  ├─ Event 流桥接：转发 Agent 事件 + 注入 runner.completion
  └─ 可观测注入：创建 OTel Span
```

**为什么需要 Runner 而非直接调用 Agent？**
- Agent 只关心"如何处理 Invocation"，不关心 Session 持久化
- Runner 遵循关注分离——Agent 执行 vs 基础设施管理
- 插件在 Runner 层注册一次，全局生效

## 2. 源码走读

### 2.1 Runner 结构

```go
// runner/runner.go（简化）
type runner struct {
    appName         string
    defaultAgent    agent.Agent
    agentFactories  map[string]AgentFactory
    sessionService  session.Service
    memoryService   memory.Service
    artifactService artifact.Service
    plugins         []plugin.Plugin
    // ...更多配置
}

// Runner 构造函数
func NewRunner(appName string, a agent.Agent, opts ...Option) Runner {
    r := &runner{
        appName:      appName,
        defaultAgent: a,
    }
    for _, opt := range opts {
        opt(r)
    }
    return r
}
```

### 2.2 Run() 完整链路

```go
func (r *runner) Run(
    ctx context.Context,
    userID string,
    sessionID string,
    message model.Message,
    runOpts ...agent.RunOption,
) (<-chan *event.Event, error) {

    // ═══════════════════════════════
    // 阶段 1：准备阶段
    // ═══════════════════════════════

    // 1.1 解析 RunOptions
    ro := agent.RunOptions{}
    for _, opt := range runOpts {
        opt(&ro)
    }

    // 1.2 确定 appName（多租户隔离）
    appName := r.appName
    if ro.AppName != "" {
        appName = ro.AppName
    }

    // 1.3 创建/获取 Session
    sess, err := r.sessionService.GetSession(ctx, session.Key{
        AppName:   appName,
        UserID:    userID,
        SessionID: sessionID,
    })
    if err != nil {
        if errors.Is(err, session.ErrSessionNotFound) {
            sess, err = r.sessionService.CreateSession(ctx, key, nil)
        } else {
            return nil, err
        }
    }

    // 1.4 注入对话历史（如果提供了 WithMessages）
    if len(ro.Messages) > 0 {
        r.seedSession(ctx, sess, ro.Messages)
    }

    // 1.5 处理 Resume 模式
    if ro.Resume {
        if r.canResume(sess) {
            r.executePendingTools(ctx, inv, sess)
        }
    }

    // 1.6 用户消息重写
    if ro.UserMessageRewriter != nil {
        rewritten, err := ro.UserMessageRewriter(ctx, &agent.UserMessageRewriteArgs{
            AppName:         appName,
            UserID:          userID,
            SessionID:       sessionID,
            OriginalMessage: message,
        })
        // ... 处理重写结果
    }

    // ═══════════════════════════════
    // 阶段 2：构建 Invocation
    // ═══════════════════════════════

    inv := agent.NewInvocation(
        agent.WithInvocationSession(sess),
        agent.WithInvocationMessage(message),
        agent.WithInvocationAgent(selectedAgent),
        agent.WithInvocationRunOptions(ro),
    )
    inv.MemoryService = r.memoryService
    inv.ArtifactService = r.artifactService

    // ═══════════════════════════════
    // 阶段 3：执行 Agent
    // ═══════════════════════════════

    agentCh, err := agent.RunWithPlugins(ctx, inv, selectedAgent, r.plugins...)

    // ═══════════════════════════════
    // 阶段 4：桥接事件流
    // ═══════════════════════════════

    bridgeCh := make(chan *event.Event, 256)
    go func() {
        defer close(bridgeCh)
        for evt := range agentCh {
            // 4.1 转发事件
            bridgeCh <- evt

            // 4.2 持久化非 partial 事件到 Session
            if !evt.IsPartial {
                r.sessionService.AppendEvent(ctx, sess, evt)
            }

            // 4.3 处理中断的 assistant 文本
            if ro.PersistInterruptedAssistant && isInterrupted {
                r.persistPartialAssistant(ctx, sess, evt)
            }
        }

        // 4.4 发出 completion 事件
        bridgeCh <- &event.Event{
            Object: "runner.completion",
            // ...
        }

        // 4.5 触发 Memory 后台提取
        if shouldExtractMemory(r.memoryService, sess) {
            go r.memoryService.ExtractAsync(ctx, sess)
        }
    }()

    return bridgeCh, nil
}
```

### 2.3 Agent Factory 模式

```go
// runner/runner_with_factory.go
type AgentFactory func(ctx context.Context, ro agent.RunOptions) (agent.Agent, error)

func NewRunnerWithAgentFactory(appName, defaultName string, factory AgentFactory) Runner {
    return NewRunner(appName, nil, /*...*/)
    // 每次 Run() 时调用 factory 创建 Agent
}
```

**Factory 资源生命周期**：Factory 生成的 Agent 不会被 Runner.Close() 自动清理。如需释放 MCP 连接、ToolSet 等资源，调用方在 run 完成后手动清理。

### 2.4 插件注入

```go
// agent/run_with_plugins.go
func RunWithPlugins(
    ctx context.Context,
    inv *Invocation,
    a Agent,
    plugins ...Plugin,
) (<-chan *event.Event, error) {
    // 插件在 Agent.Run 之前注册到 inv 中
    for _, p := range plugins {
        p.BeforeAgent(ctx, inv)
    }
    return a.Run(ctx, inv)
}
```

插件通过修改 Invocation 中的 Callbacks / Tool Filter 等实现全局拦截。

---

## 3. 实战

### 3.1 带完整配置的 Runner 创建

```go
import (
    "trpc.group/trpc-go/trpc-agent-go/runner"
    "trpc.group/trpc-go/trpc-agent-go/session/inmemory"
    "trpc.group/trpc-go/trpc-agent-go/memory/inmemory"
    "trpc.group/trpc-go/trpc-agent-go/plugin"
)

sessionService := inmemory.NewSessionService(
    inmemory.WithSessionEventLimit(500),
    inmemory.WithSessionTTL(30*time.Minute),
)

memoryService := memoryinmemory.NewMemoryService(
    memoryinmemory.WithAsyncMemoryNum(2),
)

r := runner.NewRunner("my-app", agent,
    runner.WithSessionService(sessionService),
    runner.WithMemoryService(memoryService),
    runner.WithPlugins(
        plugin.NewLogging(),
    ),
    runner.WithRalphLoop(runner.RalphLoopConfig{
        MaxIterations:     20,
        CompletionPromise: "DONE",
    }),
    runner.WithAwaitUserReplyRouting(true),
    runner.WithPersistInterruptedAssistant(true),
)
defer r.Close()
```

### 3.2 自定义 Plugin

```go
// 实现 plugin.Plugin 接口
type AuditPlugin struct{}

func (p *AuditPlugin) Name() string { return "audit" }

func (p *AuditPlugin) BeforeAgent(ctx context.Context, inv *agent.Invocation) (*agent.Invocation, error) {
    log.Printf("[AUDIT] Agent: %s, User: %s, Message: %s",
        inv.AgentName,
        inv.Session.UserID,
        inv.Message.Content,
    )
    return inv, nil
}

func (p *AuditPlugin) AfterAgent(ctx context.Context, inv *agent.Invocation, err error) error {
    log.Printf("[AUDIT] Completed with error: %v", err)
    return nil
}
```

### 3.3 对话历史注入+多租户

```go
// 项目 A 的历史对话
eventsA, _ := r.Run(ctx, "user-1", "session-1", msg,
    agent.WithAppName("project-a"),
    agent.WithMessages([]model.Message{
        model.NewSystemMessage("You serve project A."),
        model.NewUserMessage("Previous question about A."),
        model.NewAssistantMessage("Previous answer about A."),
        model.NewUserMessage("New question about A."),
    }),
)

// 项目 B — 完全隔离，同一个 Runner
eventsB, _ := r.Run(ctx, "user-1", "session-1", msg,
    agent.WithAppName("project-b"),
    agent.WithMessages([]model.Message{
        model.NewSystemMessage("You serve project B."),
        model.NewUserMessage("Question about B."),
    }),
)
```

### 3.4 Steer（动态插入用户消息）

```go
events, _ := r.Run(ctx, userID, sessionID,
    model.NewUserMessage("Draft a launch note."),
    agent.WithRequestID("req-123"),
)

// 在 Agent 回答过程中插入额外指令
go func() {
    time.Sleep(time.Second)
    runner.EnqueueUserMessage(r, "req-123",
        model.NewUserMessage("Also make the tone warmer."),
    )
}()

for evt := range events {
    // 完整事件包含两轮处理：
    // 1. "Draft a launch note." → assistant reply
    // 2. tool work（如果有） → "Also make the tone warmer." → assistant reply
}
```

**Steer 的时序保证**：新消息只在当前 assistant round（包括其 tool call 之后的 tool response）完全结束后才插入。不会打断 `tool_call → tool_response` 的配对结构。

---

## 4. 设计原理

### 4.1 为什么 Runner 不属于 Agent 接口？

分离关注（Separation of Concerns）：
- **Agent**：纯逻辑——如何处理输入，生成什么输出
- **Runner**：纯基础设施——Session 持久化、Memory 提取、插件注入

好处：
1. 同一个 Agent 可以用不同 Runner 配置运行（不同 Session 后端、不同插件）
2. Agent 可独立测试——直接调用 `agent.Run()` 不依赖 Session 服务
3. Runner 层可以叠加 Ralph Loop、Steer 等高级模式而不修改 Agent

### 4.2 多租户隔离的实现

`WithAppName("project-a")` 修改的维度：
- `session.Key.AppName` → 不同项目的 Session 存储在不同 key 下
- `Event.FilterKey` → 消息过滤使用 appName:userID:sessionID 作为前缀

这样同一个 Runner 实例可以同时服务多个项目，它们的 Session 数据完全隔离。

### 4.3 Ralph Loop vs CycleAgent

| | Ralph Loop | CycleAgent |
|----|----|----|
| **循环层级** | Runner 层 | Agent 层 |
| **驱动方式** | 验证条件（CompletionPromise/VerifyCommand） | LLM 自主判断 |
| **适用场景** | 代码生成+测试验证 | 多轮思考优化 |
| **安全** | MaxIterations 硬限制 | MaxIterations 硬限制 |

### 4.4 取消与清理的正确模式

```go
ctx, cancel := context.WithCancel(context.Background())
defer cancel()

events, err := r.Run(ctx, userID, sessionID, message)
if err != nil { return err }

// ⚠️ 关键：取消后必须持续排空 channel
go func() {
    time.Sleep(2 * time.Second)
    cancel()
}()

for range events {
    // 即使 ctx 已取消，也要消费到 channel 关闭
    // 否则 agent goroutine 会阻塞在 channel 写入上，造成 goroutine 泄漏
}
```

Runner 会检测到 ctx 取消并停止 LLM 调用，但需要外部消费 channel 直到 agent goroutine 正常退出。

---

## 5. 配置速查

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
