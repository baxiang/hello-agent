# Graph 执行引擎、错误控制与检查点 - DAG/重试/缓存/时间旅行

> **源码路径**：[`trpc-agent-go/examples/graph/`](../../../../trpc-agent-go/examples/graph)（本篇覆盖 `dag_engine` / `concurrency_race` / `error_handling` / `execution_trace` / `retry` / `nodecache` / `tool_call_retry` / `checkpoint` / `time_travel_edit_state`）
> **主题**：执行控制 · **难度**：进阶→高级

## 概述

当 Graph 工作流从"能跑通"走向"可上线"，问题就不再是拓扑怎么画，而是：

- **可靠性**：节点会失败、外部 API 会超时、工具会偶发抖动——如何让流程在扰动下仍交付结果？
- **可调试性**：一次执行究竟走了哪些步？某个中间状态出错后能否回放/篡改重跑？
- **可恢复性**：长流程中途崩了，能否从断点续跑，而不是从零重来？
- **可扩展性**：并行分支里有快有慢，能否让快的下游不被慢的兄弟节点拖住？

本篇 9 个示例正是围绕这四件事展开。它们共享同一套 `graph` 编排底座（`StateGraph` + `Compile` + `Executor`），但分别切中执行引擎选择（`dag_engine`）、并发隔离正确性（`concurrency_race`）、错误收集与降级（`error_handling`）、执行轨迹（`execution_trace`）、节点级重试（`retry`）、节点缓存（`nodecache`）、工具调用重试（`tool_call_retry`）、检查点全生命周期（`checkpoint`）、以及基于检查点的"时间旅行"状态编辑（`time_travel_edit_state`）。

## 核心概念

### 执行引擎：BSP vs DAG

tRPC-Agent-Go 默认采用 **BSP（Bulk Synchronous Parallel）** 引擎：执行被切成 superstep，每一跳先规划可运行节点、并行执行、合并更新，**等本 superstep 全部节点结束**才进入下一跳。安全、易推理，但下游节点要为不相关的兄弟分支买单。

**DAG 引擎**（`graph.ExecutionEngineDAG`）去掉全局屏障，节点一旦满足自身依赖就立刻调度，是真正的依赖驱动流水线。代价是：`WithStepTimeout` 不再生效（应改用 `context` 超时或 `WithNodeTimeout`），`WithMaxSteps` 计的是节点执行数而非 superstep 数；checkpoint/interrupt 虽支持但节奏与 BSP 不同。

```go
exec, err := graph.NewExecutor(
    g,
    graph.WithExecutionEngine(graph.ExecutionEngineDAG), // 默认是 ExecutionEngineBSP
    graph.WithMaxConcurrency(3),
)
```

### Checkpointer 与执行上下文隔离

Checkpoint 的本质是把图执行过程中的 `ChannelValues` + 版本 + 待写 + 中断态 + NextNodes 序列化到外部 Saver，从而支持 resume / fork / 时间旅行。三种后端：`checkpointinmemory.NewSaver()`（演示）、`checkpointsqlite.NewSaver(db)`（持久化）、`checkpointredis.NewSaver(...)`（分布式）。配线只需一行：

```go
graphagent.New("app", g, graphagent.WithCheckpointSaver(saver))
```

**关键正确性前提**：Pregel channel 状态必须 **per-execution 隔离**。`concurrency_race` 就是用 32 goroutine × 64 round 的压测来回归这一点——同一 `Runner` 并发跑时，每个 run 的 `counter` 必须严格等于 1。

### 错误语义：可恢复 vs 致命

`graph.ExecutionErrorCollector` 提供了一种"结构化错误收集 + 业务降级"模式：节点返回的错误若实现 `Recoverable() bool`（或被 `graph.MarkRecoverable` 标记），框架会把它写入 `graph.StateKeyExecutionErrors` 状态字段、**继续往下跑**；否则记为 `fatal`、走 fallback 路径、把收集到的错误透传到 `runner.completion.StateDelta`。子图错误还能通过 `collector.SubgraphOutputMapper()` 自动冒泡到父图。

### 重试语义：节点级 vs 工具调用级

| 层级 | API | 关键字段 | 适用 |
|------|-----|---------|------|
| 节点级 | `graph.WithRetryPolicy(graph.RetryPolicy{...})` | `MaxAttempts` / `InitialInterval` / `BackoffFactor` / `MaxInterval` / `Jitter` / `RetryOn` | 整个节点函数失败（外部 API、数据库） |
| 工具调用级 | `graph.WithToolCallRetryPolicy(*tool.RetryPolicy)` | `MaxAttempts` / `InitialInterval` / `BackoffFactor` / `MaxInterval` | LLM 的某次 tool_call 偶发失败，**只重试这一次调用**，不重跑整个 ToolsNode |

二者都遵循"失败不写状态"原则——重试期间不会污染 State，只有成功的那次才落盘。

### 节点缓存

`graph.NewInMemoryCache()` + `graph.DefaultCachePolicy()` 提供图级缓存；节点可经 `graph.WithNodeCachePolicy(pol)` + `graph.WithCacheKeyFields("n")` 覆盖 TTL 与 cache key。命中时跳过节点函数、走 after-callbacks、在 `node.complete` 事件里打上 `_cache_hit` 标记。最适合纯函数节点（同输入同输出、无副作用）。

---

## dag_engine（DAG 引擎对比）

> 源码：[`trpc-agent-go/examples/graph/dag_engine/`](../../../../trpc-agent-go/examples/graph/dag_engine)

通过 `-engine bsp|dag|both` 切换引擎，对比同一拓扑下下游节点的启动时机。拓扑刻意做成不平衡扇出，让 BSP 的全局屏障效应显形：

```
split ─┬─ slow_a (800ms)
       ├─ fast_b (200ms) ── fast_b_next (120ms)
       └─ mid_c  (400ms)
```

`fast_b_next` 只依赖 `fast_b`，但 BSP 下它必须等 `slow_a` 也跑完；DAG 下它在 `fast_b` 完成的瞬间就启动。

```go
execEngine := graph.ExecutionEngineBSP
if engine == "dag" {
    execEngine = graph.ExecutionEngineDAG
}
exec, err := graph.NewExecutor(
    g,
    graph.WithExecutionEngine(execEngine),
    graph.WithMaxConcurrency(3),
)
```

每行日志带相对时间戳（`[elapsed]`），运行：

```bash
cd examples/graph/dag_engine
go run . -engine both          # 顺序跑 bsp 与 dag 做对比
```

预期输出（节选）：

```
[   4ms] engine=bsp start
[ 204ms] fast_b start
[ 804ms] slow_a end
[ 824ms] fast_b_next start      # ← BSP：等到 slow_a(800ms) 结束后才开始
...
[   3ms] engine=dag start
[ 203ms] fast_b start
[ 403ms] fast_b end
[ 423ms] fast_b_next start      # ← DAG：fast_b(200ms) 一结束就立刻开始
```

---

## concurrency_race（并发竞态回归）

> 源码：[`trpc-agent-go/examples/graph/concurrency_race/`](../../../../trpc-agent-go/examples/graph/concurrency_race)

不是功能演示，而是 **回归测试**：验证"单个 `GraphAgent`/`Runner` 被多 goroutine 复用时，Pregel channel 状态严格 per-run 隔离"。图极简——`start -> worker`，`worker` 把 `counter` 自增 1。压测参数：32 goroutine × 64 round = 2048 次并发 run，每次都必须观察到 `counter == 1`。

```go
sg.AddNode("worker", func(ctx context.Context, state graph.State) (any, error) {
    current, _ := state[stateKeyCounter].(int)
    return graph.State{stateKeyCounter: current + 1}, nil
})
```

复用 Runner 是真实生产姿势（构造图开销不小），因此这个隔离性至关重要——若 channel 在 Graph 层共享，会出现 `counter == 0`（worker 被跳过）或 `counter > 1`（worker 被触发多次）。

```bash
cd examples/graph
go run ./concurrency_race
```

预期输出（健康）：

```
🚀 concurrency_race example: 32 goroutines × 64 rounds
✅ No missing worker executions observed (try increasing rounds/concurrency if needed).
```

可调大 `defaultConcurrency` / `defaultRounds`（`main.go:43-45`）加大压力，作为修改 channel 隔离逻辑后的回归用例。

---

## error_handling（结构化错误与降级）

> 源码：[`trpc-agent-go/examples/graph/error_handling/`](../../../../trpc-agent-go/examples/graph/error_handling)

演示 `graph.ExecutionErrorCollector` 在三种错误场景下的行为。所有场景都把自定义 `codedError`（实现 `Code()` 与 `Recoverable()`）作为节点返回值，并通过 `collector.NodeCallbacks()` 把回调挂到 `StateGraph`：

```go
type codedError struct {
    code, message string
    recoverable   bool
}
func (e codedError) Recoverable() bool { return e.recoverable }

collector := graph.NewExecutionErrorCollector()
sg := graph.NewStateGraph(schema).WithNodeCallbacks(collector.NodeCallbacks())
```

三个场景：

1. **recoverable_local_node**：`lookup` 节点返回 `recoverable: true` 的 `LOOKUP_SOFT_TIMEOUT`，框架记录错误但继续执行 `finalize`，后者从 `state[graph.StateKeyExecutionErrors]` 读出错误并写一条"completed with fallback"备注。
2. **fatal_local_node**：`write` 节点返回致命的 `WRITE_FATAL`，框架立即走 fallback、把收集到的错误透传到 `runner.completion.StateDelta`，下游消费者仍能读到业务错误。
3. **fatal_child_subgraph**：父图通过 `AddAgentNode` 调用子图，子图在 `child_write` 致命失败。父图用 `graph.WithSubgraphOutputMapper(collector.SubgraphOutputMapper())` 自动把子图的 `execution_errors` 合并到父状态。

```bash
go run ./examples/graph/error_handling
```

预期输出（节选）：

```
== recoverable_local_node ==
runner completion received
runner completion collected 1 error(s)
  - recoverable code=LOOKUP_SOFT_TIMEOUT message=catalog lookup timed out
runner completion note: completed with fallback after catalog lookup timed out

== fatal_local_node ==
stream error: code=WRITE_FATAL message=database write failed
runner completion received
runner completion collected 1 error(s)
  - fatal code=WRITE_FATAL message=database write failed

== fatal_child_subgraph ==
runner completion received
runner completion collected 1 error(s)
  - fatal code=CHILD_AGENT_FATAL message=child agent database write failed
runner completion note: parent received child error child agent database write failed
```

业务侧可通过 `graph.WithExecutionErrorPolicy(...)` 自定义可恢复判定、`graph.WithExecutionErrorStateKey(...)` 改存储键、`graph.EmitCustomStateDelta(...)` 在致命路径补发业务态。

---

## execution_trace（执行轨迹追踪）

> 源码：[`trpc-agent-go/examples/graph/execution_trace/`](../../../../trpc-agent-go/examples/graph/execution_trace)

开启 `agent.WithExecutionTraceEnabled(true)` 后，`runner.completion.ExecutionTrace` 会携带本次运行的完整 step 序列——包括 fan-out、fan-in、条件路由、循环、重复节点、以及"图里有但本次没走到"的静态节点。

图拓扑刻意覆盖所有控制流模式：`start` 同时扇出到 `route` 与 `prepare`；`route` 第一次走 `tools` 再回到 `route`（构成循环），第二次走 `branch_a`；`branch_a` 与 `branch_b` 经 `AddJoinEdge` 汇聚到 `join`；`branch_never` 静态存在但本次永不命中。

```go
eventCh, err := r.Run(ctx, "user-1", "session-1",
    model.NewUserMessage("hello graph trace"),
    agent.WithExecutionTraceEnabled(true),
)
// ...
for evt := range eventCh {
    if evt != nil && evt.IsRunnerCompletion() {
        completion = evt
    }
}
printExecutionTrace(completion.ExecutionTrace, staticNodeIDs)
```

`printExecutionTrace`（见 `print.go`）从 `atrace.Trace.Steps` 归一化出每步的 Label（`node#序号`）、前驱、输入/输出快照、错误，并据此推出 trace 边、重复节点、跳过节点。

```bash
cd examples/graph
go run ./execution_trace          # 纯函数节点，无需 API Key
```

预期输出（节选）：

```
GraphAgent execution trace
========================================================================
Root Agent: assistant
Step Count: 9

Step order
1. assistant/start#1
   predecessors: (root)
   output: visited=[start]
2. assistant/prepare#1
   predecessors: assistant/start#1
3. assistant/route#1
   predecessors: assistant/start#1
   output: route_count=1, visited=[route]
...
6. assistant/route#2
   predecessors: assistant/tools#1
   output: route_count=2, visited=[route]

Trace edges
- assistant/start#1 -> assistant/prepare#1
- assistant/start#1 -> assistant/route#1
- assistant/tools#1 -> assistant/route#2
- assistant/branch_a#1 -> assistant/join#1
- assistant/branch_b#1 -> assistant/join#1

Summary
- Repeated nodes: assistant/route x2
- Skipped nodes: assistant/branch_never
- Final step labels: assistant/done#1
```

trace 是排查"为什么走了这条路""为什么这个节点跑了两次"的黄金工具，强烈建议在生产长流程默认开启。

---

## retry（节点级重试与退避）

> 源码：[`trpc-agent-go/examples/graph/retry/`](../../../../trpc-agent-go/examples/graph/retry)

`unstable_api` 节点模拟外部 API：前 N 次失败、第 N+1 次成功。通过 `graph.WithRetryPolicy` 配置指数退避 + 抖动，并经 `RetryOn` 自定义匹配（示例里 `return true` 表示任何错误都重试）。

```go
demoRetry := graph.RetryPolicy{
    MaxAttempts:     3,
    InitialInterval: 200 * time.Millisecond,
    BackoffFactor:   2.0,
    MaxInterval:     1 * time.Second,
    Jitter:          true,
    RetryOn: []graph.RetryCondition{
        graph.RetryConditionFunc(func(error) bool { return true }),
    },
}
sg.AddNode("unstable_api", unstableAPINode, graph.WithRetryPolicy(demoRetry))
```

`unstable_api` 用 `sync.Map` 按 `invocationID:nodeID` 维护每轮 attempt 计数，模拟幂等失败；只有成功那次才会把 `fetched_data` 写入 State。verbose 模式下，`MetadataKeyNode` 携带的 `NodeExecutionMetadata` 会暴露 `Attempt` / `MaxAttempts` / `NextDelay` / `Retrying` 字段：

```go
if meta.Phase == graph.ExecutionPhaseError && meta.Retrying {
    fmt.Printf("⏳ Retrying node %s: attempt %d/%d, next delay %v\n",
        meta.NodeID, meta.Attempt, meta.MaxAttempts, meta.NextDelay)
}
```

```bash
cd examples/graph/retry
export OPENAI_API_KEY=...                    # answer 节点用 LLM
go run . --fail=2 --latency=200ms --verbose
```

预期输出（节选，verbose）：

```
⏳ Retrying node unstable_api: attempt 1/3, next delay 200ms
⏳ Retrying node unstable_api: attempt 2/3, next delay 400ms
🚀 Start node unstable_api (attempt 3/3)
✅ Completed node unstable_api
🤖 The data was fetched after 3 attempts...
```

---

## nodecache（节点结果缓存）

> 源码：[`trpc-agent-go/examples/graph/nodecache/`](../../../../trpc-agent-go/examples/graph/nodecache)

`compute` 节点 sleep 300ms 模拟重计算，返回 `out = 2 * n`。图级开启 `InMemoryCache` + `DefaultCachePolicy`，节点级用 `WithNodeCachePolicy` 覆盖 TTL、用 `WithCacheKeyFields("n")` 声明 key 字段。

```go
sg := graph.NewStateGraph(schema).
    WithCache(graph.NewInMemoryCache()).
    WithCachePolicy(graph.DefaultCachePolicy())

pol := &graph.CachePolicy{
    KeyFunc: graph.DefaultCachePolicy().KeyFunc,
    TTL:     ttl,
}
sg.AddNode("compute", compute,
    graph.WithNodeCachePolicy(pol),
    graph.WithCacheKeyFields("n"),
)
```

为了"跨 session 也能命中"，示例每次 run 都换新 sessionID（避免会话状态污染 cache key），但 cache 本身是图级的，所以同输入仍命中。命中判定读 `node.complete` 事件里的 `MetadataKeyCacheHit`：

```go
case graph.ObjectTypeGraphNodeComplete:
    if _, ok := e.StateDelta[graph.MetadataKeyCacheHit]; ok {
        fmt.Println("✅ Cache hit: skipped node function")
    }
```

```bash
cd examples/graph/nodecache
go run . --ttl=60
# 输入 42 → 等 300ms → out=84
# 再输入 42 → 立刻 "✅ Cache hit" → out=84
# --ttl=2 等 2 秒后再输入 42 → 重新计算
```

预期输出：

```
👤 Enter integer: 42
🟡 Node start: compute
📦 Final result: input=42, output=84

👤 Enter integer: 42
✅ Cache hit: skipped node function
📦 Final result: input=42, output=84
```

注意：生产环境内存后端不够，应换持久化后端并配 TTL sweeper；缓存只对"纯函数型"节点安全。

---

## tool_call_retry（工具调用级重试）

> 源码：[`trpc-agent-go/examples/graph/tool_call_retry/`](../../../../trpc-agent-go/examples/graph/tool_call_retry)

与 `retry/` 的区别：这里重试的是 LLM 发出的 **某一次 tool_call**，而非整个节点。图为 `assistant(LLM) ⇄ tools(ToolsNode)` 循环；工具 `get_weather` 前 N 次返回 `io.ErrUnexpectedEOF`、第 N+1 次成功。程序自动跑两个场景——不带 policy（直接失败）vs 带 `tool.RetryPolicy`（重试到成功）。

```go
policy := &tool.RetryPolicy{
    MaxAttempts:     *failCount + 1,
    InitialInterval: *initialBackoff,
    BackoffFactor:   2.0,
    MaxInterval:     2 * time.Second,
}
// 带 policy：
sg.AddToolsNode(nodeTools, tools, graph.WithToolCallRetryPolicy(policy))
// 不带 policy：
sg.AddToolsNode(nodeTools, tools)
```

默认重试分类器会识别常见瞬时 I/O 错误（`io.ErrUnexpectedEOF` 等），无需额外配置。注意 `MaxAttempts` 设成 `failCount + 1` 恰好让最后一次成功。

```bash
cd examples
export OPENAI_API_KEY=...
go run ./graph/tool_call_retry -model deepseek-v4-flash -fail 2 -backoff 200ms
```

预期输出：

```
== without_retry ==
llm tool call: get_weather args={"location":"Shenzhen"}
tool attempt 1 for Shenzhen
result: failed after 1 attempt(s): unexpected EOF

== with_retry ==
llm tool call: get_weather args={"location":"Shenzhen"}
tool attempt 1 for Shenzhen
tool attempt 2 for Shenzhen
tool attempt 3 for Shenzhen
result: succeeded after 3 attempt(s)
answer: The weather in Shenzhen is sunny.
```

若需要把"MCP 返回 `isError=true`"也视作可重试，请在 `tool.RetryPolicy` 里自定义 `RetryOn`。

---

## checkpoint（检查点全生命周期）

> 源码：[`trpc-agent-go/examples/graph/checkpoint/`](../../../../trpc-agent-go/examples/graph/checkpoint)

这是本篇体量最大的示例（~1400 行），用交互式 CLI 完整演示检查点能力。图为 `increment1 -> increment2 -> increment3 -> final`，每步把 `counter` +1 并写 `messages`。核心配线：

```go
saver := checkpointinmemory.NewSaver()   // 或 sqlite / redis
w.graphAgent, err = graphagent.New("checkpoint-demo", workflowGraph,
    graphagent.WithCheckpointSaver(saver),
)
w.manager = w.graphAgent.Executor().CheckpointManager()
```

执行时通过 `agent.WithRuntimeState(runtimeState)` 传入 lineage / namespace，框架会**每个 superstep 自动落检查点**。CLI 提供完整命令集：

| 命令 | 作用 |
|------|------|
| `run [lineage-id]` | 跑新工作流，自动生成 lineage |
| `list [lineage-id]` | 列出该 lineage 全部检查点（含 step / source / state 摘要） |
| `latest [lineage-id]` | 展示最新检查点的完整状态与消息 |
| `history [lineage-id]` | 按时间倒序展示执行时间线 |
| `resume <lineage> [ckpt-id] ["input"]` | 从最新或指定检查点恢复（可附带新输入） |
| `branch <lineage> <ckpt-id>` | 在同 lineage 内 fork，`executor.Fork(ctx, config)` |
| `tree [lineage-id]` | 用 `GetCheckpointTree` 打印分支树 |
| `delete <lineage-id>` | 删除整条 lineage |
| `demo` | 一键串起上述全部能力 |

```bash
cd examples/graph/checkpoint
go run . -storage memory                 # 或 -storage sqlite -db checkpoints.db
```

预期输出（`demo` 命令节选）：

```
checkpoint> demo

1️⃣ Running workflow...
✅ Workflow execution finished

2️⃣ Listing checkpoints...
1. ID: 78824eea-...
   Created: 14:23:45 | Source: loop | Step: 3
   State: counter=3, steps=4, last_action=final
...

6️⃣ Creating a branch from checkpoint...
🌿 Creating branch in lineage demo-... from checkpoint ...
✅ Branch created successfully
   Branched checkpoint ID: 4b3789c4-...
   Parent checkpoint ID: b8b99ece-...

7️⃣ Resuming from branched checkpoint...
✅ Workflow execution finished
```

关键概念：**Lineage**（工作流线程标识）、**Namespace**（lineage 内的并行分支隔离单元）、**Source**（`input`/`loop`/`interrupt`/`fork` 四种来源）、**Step 编号**（初始 -1，之后 0,1,2,...）。Step -1 的 fork 现已支持重跑全部节点。

---

## time_travel_edit_state（时间旅行：编辑历史状态）

> 源码：[`trpc-agent-go/examples/graph/time_travel_edit_state/`](../../../../trpc-agent-go/examples/graph/time_travel_edit_state)

Checkpoint 的"高级玩法"：不只从历史点恢复，还能**改写历史点的状态**再继续跑。示例图只有一个 `review` 节点，里面用 `graph.Interrupt` 暂停等用户审批；运行会在中断处停下来，落下一个 interrupt 检查点。

```go
v, err := graph.Interrupt(ctx, st, interruptKeyReview,
    fmt.Sprintf("Please review counter=%d", counter))
```

随后主流程通过 `exec.TimeTravel()` 拿到时间旅行句柄，做四件事：

```go
tt, _ := exec.TimeTravel()

// 1. 取最近 1 条历史
h, _ := tt.History(ctx, lineageID, namespace, 1)
base := h[0].Ref

// 2. 读该检查点的状态
before, _ := tt.GetState(ctx, base)

// 3. 把 counter 从 1 改成 42，写出一条新检查点
updatedRef, _ := tt.EditState(ctx, base, graph.State{
    stateKeyCounter: editedCounter, // = 42
})

// 4. 基于 updatedRef 构造 resume state，带上审批值，继续执行
cmd := graph.NewResumeCommand().AddResumeValue(interruptKeyReview, "approved")
resumeState := graph.State(updatedRef.ToRuntimeState())
resumeState[graph.StateKeyCommand] = cmd
exec.Execute(ctx, resumeState, inv2)
```

注意 `EditState` 不是原地改——它**派生一条新 checkpoint**（保留原历史可追溯），后续 resume 基于新 ref。

```bash
go run ./examples/graph/time_travel_edit_state
```

预期输出：

```
Base checkpoint: <ckpt-id> (source=interrupt)
Before edit: counter=1
Updated checkpoint: <new-ckpt-id>
After edit: counter=42
Final: counter=43 decision=approved
Done.
```

`Final` 的 `counter=43` 来自 `review` 节点恢复后执行了 `counter + 1`（42 → 43），证明编辑生效且从中断点正确续跑。这是调试"如果当时状态是 X，后续会怎样"的最直接手段。

---

## 选型对比

### 引擎与隔离

| 维度 | BSP（默认） | DAG |
|------|------------|-----|
| 调度模型 | superstep 全局屏障 | 依赖就绪即调度 |
| 慢分支影响 | 拖慢同 superstep 的所有下游 | 仅影响自身依赖链 |
| `WithStepTimeout` | 生效 | **不生效**，改用 `context` / `WithNodeTimeout` |
| `WithMaxSteps` | 计 superstep | 计节点执行数 |
| checkpoint / interrupt | 支持 | 支持，节奏语义不同 |
| 推荐场景 | 流程规整、需要严格同步推理 | 分支时长差异大、追求吞吐 |

### 容错手段

| 需求 | 选 | 原因 |
|------|----|------|
| 单次外部调用偶发失败 | `retry/`（节点级） | 整节点重跑，状态不污染 |
| LLM 的某次 tool_call 抖动 | `tool_call_retry/` | 只重试这一次调用，开销最小 |
| 业务级错误要收集 + 降级继续 | `error_handling/` | `ExecutionErrorCollector` 把错误写进 State |
| 长流程断点续跑 | `checkpoint/` | 框架自动落点，`resume` 即可 |
| "若当时状态是 X 会怎样" | `time_travel_edit_state/` | `TimeTravel.EditState` 派生新检查点 |
| 纯函数节点加速 | `nodecache/` | 图级缓存 + TTL |
| 排查"为什么走这条路" | `execution_trace/` | step 级轨迹含前驱与快照 |
| 回归并发安全 | `concurrency_race/` | 压测 channel per-run 隔离 |

---

## 关键要点

1. **引擎选择是架构决策**：吞吐敏感且分支时长不均选 DAG；流程规整、需要可预测的同步语义选 BSP。切到 DAG 后记得把 `WithStepTimeout` 换成 `context` 超时。
2. **错误有两个层面**：流式 `Response.Error` 给 UI 报警，`StateDelta[StateKeyExecutionErrors]` 给业务留痕。`ExecutionErrorCollector` 让你同时拿到两者，且支持子图冒泡。
3. **重试粒度决定成本**：能定位到 tool_call 就别重试整节点；节点级重试的 `RetryPolicy` 务必配 `MaxInterval` 与 `Jitter`，避免雪崩。
4. **缓存只对纯函数安全**：`WithCacheKeyFields` 必须覆盖所有影响输出的输入字段，否则会命中脏数据。
5. **Checkpoint 的单位是 lineage**：同 lineage 内 fork 不改 lineage ID，便于追溯；resume 时 `checkpoint_id` 可省略（默认取最新）。
6. **EditState 不破坏历史**：它派生新 checkpoint，原历史完整保留——这是"时间旅行"可重复实验的前提。
7. **生产化检查**：上线前用 `concurrency_race` 的姿势做并发回归；长流程默认开 `execution_trace`，故障复盘事半功倍。

## 总结

这 9 个示例合起来回答了"Graph 工作流如何变得可靠、可调试、可恢复"。`dag_engine` 决定调度骨架，`concurrency_race` 守住隔离底线，`error_handling` / `retry` / `tool_call_retry` / `nodecache` 各管一类容错与加速，`checkpoint` / `time_travel_edit_state` 提供断点续跑与历史反事实推演，`execution_trace` 则是贯穿全程的观测工具。

进一步学习可参考同级主题文章：

- [`graph-topology.md`](./graph-topology.md) —— 拓扑结构（basic / fanout / diamond / join_edge / mapreduce / parallel / multiends）
- [`graph-interrupt.md`](./graph-interrupt.md) —— 中断与恢复（interrupt / static_interrupt / nested_interrupt / external_interrupt / dag_interrupt）
- [`graph-subagent.md`](./graph-subagent.md) —— 子图与多 Agent（subgraph / isolated_subagent / subagent_runtime_state / a2asubagent）
- [`graph-streaming-io.md`](./graph-streaming-io.md) —— 流式与 IO 约定（stream_mode / streaming_node_consumer / io_conventions / terminal_messages_only）
- [`graph-advanced.md`](./graph-advanced.md) —— 高级特性（visualization / structure_export / per_node_callbacks / placeholder / oneshotoverride 等）
