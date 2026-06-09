# Runner 执行器详解

Runner 是 Agent 的执行器，提供会话管理、事件流处理、插件系统的统一入口。**强烈推荐始终通过 Runner 来执行 Agent**，而非直接调用 Agent 接口。

## 1. Runner 架构

```
┌──────────────────────────────────────────────────────────────┐
│                        Runner                                 │
│  - Session 管理      - Event 流处理      - 插件系统             │
│  - ID 生成           - 可观测集成        - Completion 事件      │
└────────────────────────┬─────────────────────────────────────┘
                         │ agent.RunWithPlugins(ctx, inv, agent)
                         ▼
                    Agent 实现
```

Runner 的核心职责：
1. 获取或创建 Session
2. 生成 Invocation ID
3. 调用 Agent 执行
4. 处理返回的事件流
5. 将非 partial 响应事件写入 Session
6. 在事件流结束时发出 `runner.completion` 事件

## 2. 创建 Runner

### 2.1 基础创建

```go
import "trpc.group/trpc-go/trpc-agent-go/runner"

r := runner.NewRunner("my-app", agent,
    runner.WithSessionService(sessionService),
    runner.WithMemoryService(memoryService),
    runner.WithArtifactService(artifactService),
    runner.WithPlugins(plugin.NewLogging()),
)
defer r.Close()
```

参数说明：
- **appName**：应用名，用于 Session 隔离和 FilterKey
- **agent**：默认 Agent 实例
- **WithSessionService**：会话存储后端
- **WithMemoryService**：长期记忆服务
- **WithArtifactService**：制品存储服务
- **WithPlugins**：全局插件列表

### 2.2 Agent Factory 模式

当需要为每个请求创建不同的 Agent 时（不同 prompt、model、工具等）：

```go
r := runner.NewRunnerWithAgentFactory("my-app", "assistant",
    func(ctx context.Context, ro agent.RunOptions) (agent.Agent, error) {
        return llmagent.New("assistant",
            llmagent.WithInstruction(ro.Instruction),
        ), nil
    },
)

// 或注册多个命名工厂
r := runner.NewRunner("my-app", defaultAgent,
    runner.WithAgentFactory("sandboxed", func(ctx context.Context, ro agent.RunOptions) (agent.Agent, error) {
        return llmagent.New("sandboxed"), nil
    }),
)

// 按名称选择
events, _ := r.Run(ctx, userID, sessionID, message,
    agent.WithAgentByName("sandboxed"),
)
```

> Factory 内部的资源（如 MCP 连接、临时 ToolSet）不会在 Runner.Close() 时自动清理。需要调用方在 run 完成后自行清理。

---

## 3. Run 方法详解

```go
eventChan, err := r.Run(ctx, userID, sessionID, message, options...)
```

### 3.1 完整 RunOptions

| 选项 | 说明 | 场景 |
|------|------|------|
| `WithRequestID(id)` | 请求标识，用于取消和状态查询 | 日志关联、运行控制 |
| `WithStream(b)` | 是否流式输出 | 交互式对话 |
| `WithMaxRunDuration(d)` | 最大运行时间 | 超时保护 |
| `WithDetachedCancel(b)` | true 时父 context 取消不影响运行 | 后台任务 |
| `WithAgent(a)` | 覆盖 Runner 的默认 Agent | 测试 |
| `WithAgentByName(n)` | 按名称选择已注册的 Factory Agent | 动态路由 |
| `WithInstruction(i)` | 覆盖 Agent 的 Instruction | 动态提示 |
| `WithAppName(n)` | 覆盖 appName（多租户隔离） | SaaS |
| `WithMessages(msgs)` | 提供完整对话历史 | 外部上下文注入 |
| `WithResume(b)` | 恢复中断的运行（tools-first resume） | 长时任务继续 |
| `WithToolFilter(f)` | 过滤可见工具 | 权限控制 |
| `WithToolPermissionPolicyFunc(f)` | 工具权限策略 | 安全审批 |
| `WithToolCallArgumentsJSONRepairEnabled(b)` | 自动修复 JSON 参数 | 模型输出不稳定 |
| `WithUserMessageRewriter(f)` | 重写用户消息 | 业务上下文注入 |
| `WithInjectedContextMessages(msgs)` | 注入临时上下文（不持久化） | 动态规则/约束 |
| `WithLateContextMessages(msgs)` | 在最后 user 消息前注入上下文 | RAG 结果注入 |
| `WithSurfacePatchForNode(nodeID, patch)` | 覆盖特定 Graph 节点的配置 | GraphAgent 调试 |
| `WithPersistInterruptedAssistant(b)` | 取消时持久化已输出内容 | "继续生成"场景 |

### 3.2 Request ID 与运行控制

```go
requestID := "req-123"
events, _ := r.Run(ctx, userID, sessionID, message,
    agent.WithRequestID(requestID),
)

// 查询运行状态
managed := r.(runner.ManagedRunner)
status, ok := managed.RunStatus(requestID)

// 取消运行
managed.Cancel(requestID)
```

### 3.3 多租户隔离

通过 `WithAppName` 让单 Runner 实例服务多个项目：

```go
r := runner.NewRunner("default-app", myAgent)

// 项目 A
evA, _ := r.Run(ctx, userID, sessionID, msg,
    agent.WithAppName("project-a"),
)
// 项目 B — 完全隔离
evB, _ := r.Run(ctx, userID, sessionID, msg,
    agent.WithAppName("project-b"),
)
```

隔离维度包括 Session Key 和 Event FilterKey。

### 3.4 注入对话历史

```go
msgs := []model.Message{
    model.NewSystemMessage("You are a helpful assistant."),
    model.NewUserMessage("Previous user input"),
    model.NewAssistantMessage("Previous reply"),
    model.NewUserMessage("What's next?"),
}

// 方式 A：便捷方法
ch, err := runner.RunWithMessages(ctx, r, userID, sessionID, msgs)

// 方式 B：RunOption
ch, err := r.Run(ctx, userID, sessionID, model.Message{},
    agent.WithMessages(msgs),
)
```

首次使用时自动 seed 到 Session，后续复用。

### 3.5 用户消息重写

```go
events, _ := r.Run(ctx, userID, sessionID, userMessage,
    agent.WithUserMessageRewriter(
        func(ctx context.Context, args *agent.UserMessageRewriteArgs) ([]model.Message, error) {
            raw := strings.TrimSpace(args.OriginalMessage.Content)
            return []model.Message{
                model.NewUserMessage("Business context: ..."),
                model.NewUserMessage(raw),
            }, nil
        },
    ),
)
```

支持 1→1 重写和 1→N 展开。最后一条消息成为 `invocation.Message`。

---

## 4. 停止运行

### 4.1 Ctrl+C（终端程序）

```go
ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt)
defer stop()

events, _ := r.Run(ctx, userID, sessionID, message)
for range events {} // 消费到 channel 关闭
```

### 4.2 代码取消

```go
ctx, cancel := context.WithCancel(context.Background())
defer cancel()

events, _ := r.Run(ctx, userID, sessionID, message)

go func() {
    time.Sleep(2 * time.Second)
    cancel()
}()

for range events {} // 持续排空
```

### 4.3 RequestID 取消

```go
events, _ := r.Run(ctx, userID, sessionID, message,
    agent.WithRequestID("req-123"),
)

mr := r.(runner.ManagedRunner)
mr.Cancel("req-123")
```

### 4.4 内部 StopError

```go
// 在 Tool 或回调中
return agent.NewStopError("reason")
```

> **关键规则**：取消 context 后必须持续排空 event channel 直到关闭，否则 agent goroutine 可能阻塞在 channel 写入上。

---

## 5. 插件系统

### 5.1 注册插件

```go
r := runner.NewRunner("my-app", agent,
    runner.WithPlugins(
        plugin.NewLogging(),
        plugin.NewGlobalInstruction("You must follow security policies."),
    ),
)
```

规则：
- Plugin 名称必须唯一
- 按注册顺序执行
- 实现 `plugin.Closer` 的插件会在 `Close()` 时清理

### 5.2 插件生命周期

插件可以挂载到三个级别：
- **Agent 级**：BeforeAgent / AfterAgent
- **Tool 级**：BeforeTool / AfterTool
- **Model 级**：BeforeModel / AfterModel

---

## 6. Ralph Loop 模式

外循环模式，不信任 LLM 自行判断完成，持续迭代直到验证条件满足：

```go
r := runner.NewRunner("my-app", agent,
    runner.WithRalphLoop(runner.RalphLoopConfig{
        MaxIterations:     20,
        CompletionPromise: "DONE",                // 输出中查找 <promise>DONE</promise>
        VerifyCommand:     "go test ./... -count=1", // 验证命令
        VerifyTimeout:     2 * time.Minute,
    }),
)
```

**常见完成条件**：
- **CompletionPromise**：如 `<promise>DONE</promise>`
- **VerifyCommand**：如 `go test ./...`（exit code 0 表示通过）
- **Verifier**：自定义检查函数

---

## 7. 运行恢复

### 7.1 Resume 模式

当用户中断工具调用后，用相同 sessionID 恢复执行：

```go
events, _ := r.Run(ctx, userID, sessionID,
    model.Message{},
    agent.WithResume(true),
)
```

行为：
- 检查最后一个 session event
- 若为 `tool_calls` 且无后续 tool result → 执行待处理工具
- 工具结果写入后，继续正常 LLM 循环

### 7.2 AwaitUserReply 路由

在多 Agent 对话中，子 Agent 可能向用户提问。下次请求可路由回该子 Agent：

```go
r := runner.NewRunner("crm-app", coordinatorAgent,
    runner.WithAwaitUserReplyRouting(true),
)
```

两种方式触发：
1. LLMAgent 启用 `WithAwaitUserReplyTool(true)`，模型调用 `await_user_reply`
2. 自定义 Agent 调用 `agent.MarkAwaitingUserReply(invocation)`

---

## 8. Event 处理

### 8.1 完成判断

```go
for event := range events {
    if event.Error != nil {
        log.Printf("Error: %s (type: %s)", event.Error.Message, event.Error.Type)
        continue
    }

    if len(event.Response.Choices) > 0 {
        fmt.Print(event.Response.Choices[0].Delta.Content)
    }

    // 推荐：Runner 发出 completion 时结束
    if event.IsRunnerCompletion() {
        break
    }
}
```

`event.IsFinalResponse()` vs `event.IsRunnerCompletion()`：
- `IsFinalResponse()`：当前 Agent 回复完成（后续可能还有 tool 处理和二次回复）
- `IsRunnerCompletion()`：整个 Runner.Run 结束（所有处理完成）

### 8.2 EnqueueUserMessage

在同一 run 中插入新的 user 消息：

```go
events, _ := r.Run(ctx, userID, sessionID,
    model.NewUserMessage("Draft a launch note."),
    agent.WithRequestID("req-123"),
)

go func() {
    time.Sleep(time.Second)
    runner.EnqueueUserMessage(r, "req-123",
        model.NewUserMessage("Also make the tone warmer."),
    )
}()
```

消息在**当前 assistant round 完全结束后**才插入，保证 `tool_call → tool_response` 结构完整。

---

## 9. 上下文压缩

```go
agent := llmagent.New("assistant",
    llmagent.WithEnableContextCompaction(true),        // 主开关
    llmagent.WithContextCompactionToolResultMaxTokens(1024),  // Pass 1：旧工具结果 → 占位符
    llmagent.WithContextCompactionOversizedToolResultMaxTokens(8192), // Pass 2：超大结果截断
    llmagent.WithContextCompactionKeepRecentRequests(1),
)
```

Pass 1 默认启用，Pass 2 需要设置正数阈值。

---

## 10. 最佳实践

1. **始终使用 Runner**：不要直接调用 Agent 接口
2. **defer r.Close()**：释放 Session/Memory 等资源
3. **取消后排空 channel**：防止 goroutine 泄漏
4. **生产环境使用持久化 Session**：Redis / PostgreSQL
5. **设置 MaxRunDuration**：防止异常场景下的无限执行
