# Graph Agent（下）— 高级模式

本文深入 GraphAgent 的高级特性：Checkpoint 机制、HITL 中断恢复、Command 动态路由、NodeRetry 和 Event Emitter。

## 1. Checkpoint 机制

### 1.1 概念

Checkpoint 是 Graph 执行状态的快照，用于实现时间旅行、恢复中断、和调试回放。

### 1.2 Checkpoint 存储

```go
import (
    "trpc.group/trpc-go/trpc-agent-go/graph/checkpoint/inmemory"
    "trpc.group/trpc-go/trpc-agent-go/graph/checkpoint/sqlite"
    "trpc.group/trpc-go/trpc-agent-go/graph/checkpoint/redis"
)

// InMemory（开发/测试）
saver := inmemory.NewSaver()

// SQLite（持久化）
saver, _ := sqlite.NewSaver("/path/to/checkpoints.db")

// Redis（分布式）
saver, _ := redis.NewSaver("redis://localhost:6379")

g, _ := sg.Compile(graph.WithCheckpointSaver(saver))
```

### 1.3 Checkpoint 数据结构

```go
type Checkpoint struct {
    ID            string             // 检查点 ID
    ParentID      string             // 父检查点（构建 lineage）
    State         State              // 当前 State
    NextNodes     []string           // 下一步待执行节点
    Interrupts    []Interrupt        // 当前中断列表
    Metadata      map[string]any     // 附加信息
    CreatedAt     time.Time
}
```

**Lineage 链**：`ParentID` 构建父子关系，支持时间旅行——从任意 checkpoint 恢复执行。

### 1.4 时间旅行

```go
// 1. 列出历史 Checkpoint
checkpoints, _ := g.ListCheckpoints(ctx, config)

// 2. 回退到历史状态
targetState, _ := g.GetState(ctx, config, checkpointID)

// 3. 修改 State 后重新执行（"编辑后继续"）
g.UpdateState(ctx, config, modifiedState, checkpointID)
```

---

## 2. Human-in-the-Loop（中断与恢复）

### 2.1 中断类型

```go
// 1. 编程式中断 — 节点内触发
func approvalNode(ctx context.Context, s graph.State) (any, error) {
    if !s["approved"].(bool) {
        return nil, graph.NewInterruptError("Human approval required")
    }
    return graph.State{"status": "approved"}, nil
}

// 2. 静态中断点 — 编译时设置（调试用）
sg.AddNode("debug", debugFunc,
    graph.WithNodeInterruptBefore(true),  // 执行前中断
    graph.WithNodeInterruptAfter(true),   // 执行后中断
)

// 3. 外部中断 — Runner 层触发
mr := r.(runner.ManagedRunner)
mr.Cancel(requestID)
```

### 2.2 中断恢复流程

```
[执行到中断点]
  ↓
[保存 Checkpoint] → channel 发出 interrupt event → channel 关闭
  ↓（等待外部输入）
[下次 Run 时]
  ↓ agent.WithResume(true)
[从 Checkpoint 恢复 State]
  ↓
[从中断点继续执行]
```

```go
// 第一次执行 — 在审批节点中断
events, _ := r.Run(ctx, userID, sessionID,
    model.NewUserMessage("Submit leave request"),
)

for evt := range events {
    if evt.Object == "graph.interrupt" {
        // 中断了 — 提示用户审批
        fmt.Println("Waiting for approval...")
        break
    }
}

// 第二次执行 — 恢复（假设用户已审批）
// 修改 state 中的 approved 字段
g.UpdateState(ctx, config, graph.State{"approved": true})

events, _ = r.Run(ctx, userID, sessionID,
    model.Message{},
    agent.WithResume(true),  // 关键：启用 Resume 模式
)
```

### 2.3 嵌套 Graph 中断

子 GraphAgent 中断时，父 Graph 也会中断——中断向上传播：

```go
// 父 Graph 的 Agent 节点中断时
// 父 Graph 保存 Checkpoint（含子 Graph checkpoint 引用）
// 恢复时，子 Graph 先恢复，父 Graph 再继续
```

### 2.4 AgentNode 子 LLMAgent 外部工具

AgentNode 中的子 LLMAgent 如果调用了外部工具（标记为 pending），父 Graph 也会中断，等待外部完成。

---

## 3. Command 动态路由

### 3.1 概念

Command 允许节点在运行时动态决定下一步路由和目标 State 更新。

```go
type Command struct {
    Update graph.State    // 要合并的 State delta
    GoTo   string         // 目标节点 ID
    GoTo   []string       // 扇出：并行执行多个节点
}
```

### 3.2 使用示例

```go
sg.AddNode("dynamic_router", func(ctx context.Context, s graph.State) (any, error) {
    priority, _ := s["priority"].(int)

    if priority > 5 {
        return &graph.Command{
            Update: graph.State{"urgent": true},
            GoTo:   "escalation_node",
        }, nil
    }

    return &graph.Command{
        GoTo: []string{"normal_node_a", "normal_node_b"}, // 并行
    }, nil
})
```

**Command vs ConditionalEdge**：
- `ConditionalEdge`：路由逻辑在边定义中（编译时确定路由 map）
- `Command`：路由逻辑在节点内部（运行时完全动态）

Command 更灵活但更难可视化。ConditionalEdge 更推荐——路由逻辑可见、可追溯。

---

## 4. 节点重试

```go
sg.AddNode("unreliable_api", unreliableFunc,
    graph.WithNodeRetryPolicy(&graph.RetryPolicy{
        MaxAttempts:     3,
        InitialInterval: 500 * time.Millisecond,
        BackoffFactor:   2.0,
        MaxInterval:     10 * time.Second,
        Jitter:          true,
        RetryOn: func(ctx context.Context, info *graph.RetryInfo) (bool, error) {
            // info.Attempt, info.MaxAttempts, info.Error
            if info.Attempt < info.MaxAttempts && isTransient(info.Error) {
                return true, nil
            }
            return false, nil
        },
    }),
)
```

**重试元数据**：每次重试的信息通过 Event StateDelta 暴露（`MetadataKeyNode`），包含 `Attempt`、`MaxAttempts`、`NextDelay`、`Retrying`。

---

## 5. Event Emitter — 节点内广播事件

### 5.1 接口

```go
type EventEmitter interface {
    Emit(evt *event.Event) error
    EmitCustom(eventType string, payload any) error
    EmitProgress(progress float64, message string) error
    EmitText(text string) error
    Context() context.Context
}
```

### 5.2 使用

```go
sg.AddNode("data_process", func(ctx context.Context, s graph.State) (any, error) {
    emitter := graph.GetEventEmitter(s)

    // 1. 自定义事件
    emitter.EmitCustom("data.loaded", map[string]any{
        "source": "database", "records": 10000,
    })

    // 2. 进度事件
    for i := 0; i < total; i++ {
        processItem(i)
        emitter.EmitProgress(float64(i+1)/float64(total)*100,
            fmt.Sprintf("Processing %d/%d", i+1, total))
    }

    // 3. 流式文本（在消息上下文中 → AG-UI TextMessageContentEvent）
    emitter.EmitText("Processing complete. Found 42 anomalies.")

    return nil, nil
})
```

**AG-UI 自动转换**：

| Node Event | AG-UI Event |
|------------|-------------|
| `EmitCustom` | `CustomEvent`（payload 在 value 字段） |
| `EmitProgress` | `CustomEvent`（含 progress/message） |
| `EmitText`（消息上下文内） | `TextMessageContentEvent` |
| `EmitText`（消息上下文外） | `CustomEvent`（含 nodeId/content） |

---

## 6. Node Cache

```go
sg.AddNode("expensive_computation", expensiveFunc,
    graph.WithNodeCacheKey(func(ctx context.Context, s graph.State) string {
        // 相同输入 → 跳过执行，返回缓存结果
        return fmt.Sprintf("%v", s["input"])
    }),
)
```

适用场景：
- 确定性计算（相同输入 → 相同输出）
- 配置有 ConcurrencySafe 标记的重计算

---

## 7. StreamMode

```go
g, _ := sg.Compile(
    graph.WithStreamMode(
        graph.StreamModeValues,    // State 变化事件
        graph.StreamModeUpdates,   // 节点更新事件
        graph.StreamModeDebug,     // 调试信息
    ),
)
```

不同 StreamMode 影响 Event 中携带的信息量。`StreamModeValues` 模式下可以观测每个超步后的 State 全量。

---

## 8. 架构总结

```
                  StateGraph (构建)
                       │
                       ▼ Compile()
                    Graph (编译后)
                       │
                       ▼ GraphAgent.New()
                  GraphAgent (Agent 接口)
                       │
                       ▼ Runner.Run()
                    Executor
                   ┌───┴───┐
                   │       │
               BSP 引擎  DAG 引擎
                   │
         ┌────────┼────────┐
         ▼        ▼        ▼
    Checkpoint  Retry   EventEmitter
```

GraphAgent 的三个关键扩展点：
1. **Checkpoint**：执行状态的持久化和恢复
2. **Retry**：节点级容错
3. **EventEmitter**：可观测的中间状态
