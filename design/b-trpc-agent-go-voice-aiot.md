# AIoT 语音 Agent 技术方案：trpc-agent-go 路线

## 零、场景定义

```
硬件终端 (Android/Linux)                      云端服务 (gRPC 双向流)
─────────────────────                        ───────────────────────
麦克风 ──► ASR(本地或云端) ──文本──►  进入 Agent RunLoop
                                       │
                                       ├─ 推理阶段 1
                                       │   └─ 中间文本: "好的，我先帮您查天气" → 下行
                                       │
                                       ├─ 调用云端工具: query_weather → 立即执行 ✓
                                       │
                                       ├─ 推理阶段 2
                                       │   └─ 中间文本: "北京今天 32 度，帮您开空调" → 下行
                                       │
                                       ├─ 调用端侧工具: control_aircon → 下发硬件 ⏸
                                       │   └─ 中间文本: "正在打开空调..." → 下行
                                       │
                                       │   ← 硬件回报: {"status":"ok"} ─
                                       │
                                       ├─ 推理阶段 3
                                       │   └─ 中间文本: "空调已设到 26 度" → 下行
                                       │
┌──────────────────────────────────────────────────────────────┐
│  ★ 关键：抢占式，不是排队式                                     │
│                                                              │
│  执行中（推理/调云端工具/等端侧回报）                              │
│      │                                                       │
│      │  用户又说了一句                                        │
│      ▼                                                       │
│  cancel → 当前 RunLoop 所有 goroutine 退出 → 新 RunLoop 启动    │
└──────────────────────────────────────────────────────────────┘
```

**核心需求：**

| # | 需求 | 说明 |
|---|------|------|
| 1 | **多阶段 RunLoop** | Agent 在单次会话中多次"推理→调工具→得结果→再推理"，中间文本流式下播 |
| 2 | **抢占式打断** | 新的 ASR 文本到达 → 立刻取消当前 RunLoop（不论正在推理/调云端工具/等端侧回报）→ 启动新 RunLoop |
| 3 | **端侧工具异步回报** | 端侧工具暂停 RunLoop 等待，硬件端并行执行后批量回报，超时兜底 |
| 4 | **中间文本缓解焦虑** | 工具调用前/后、长时间等待时，Agent 自述进度文本 |
| 5 | **gRPC 双向流 + 断网恢复** | 双向流承载文本上下行 + 工具调用/回报，断网后从 checkpoint 恢复 |

---

## 一、RunLoop 模型

trpc-agent-go 的 `Runner.Run()` 本质是单次执行的，需要自建 loop 层：

```
                    一个 RunLoop（一次 ASR 触发）
┌────────────────────────────────────────────────────────────────┐
│  VoiceSession (自建 loop)                                       │
│                                                                │
│  ┌─ LLM 推理 ─┐    ┌─ LLM 推理 ─┐    ┌─ LLM 推理 ─┐           │
│  │            │    │            │    │            │           │
│  │ 中间文本   │    │ 中间文本   │    │ 中间文本   │           │
│  │            │    │            │    │            │           │
│  └──┬──┬──┬──┘    └──┬────┬────┘    └─────┬──────┘           │
│     │  │  │          │    │               │                  │
│     ▼  ▼  ▼          ▼    ▼               ▼                  │
│   云端工具         云端工具 端侧工具     最终回复               │
│   (立即执行)       (立即)  (Interrupt)                        │
│                              │                                │
│                              ▼                                │
│                     ← 硬件回报 ───                            │
│                              │                                │
│                     RunLoop 从 checkpoint 恢复继续推理          │
│                                                                │
│  ◄─ 新 ASR → cancelCtx() → 退出 → 新 RunLoop                  │
└────────────────────────────────────────────────────────────────┘
```

---

## 二、trpc-agent-go 方案：整体架构

```
┌────────────────────────────────────────────────────────────────┐
│                         gRPC 双向流                             │
│  UpStream:   {asr_text}  /  {resume: 端侧工具结果}              │
│  DownStream: {interim_text}  /  {device_tool_call}  /  {done}  │
├────────────────────────────────────────────────────────────────┤
│                      VoiceSession (自建，per device)            │
│                                                                │
│  VoiceSession                                                  │
│  ├─ runCtx + cancelFn       ← 抢占：新 ASR 触发 cancel()       │
│  ├─ run(ctx, text)          ← 启动 GraphAgent 执行              │
│  ├─ eventLoop(eventCh)      ← 事件流分发：                      │
│  │   ├─ 中间文本 delta → gRPC 下行                              │
│  │   ├─ 工具调用事件 → 识别端侧/云端                            │
│  │   ├─ graph interrupt → gRPC 下行(端侧工具) + 等待 resume     │
│  │   └─ 最终完成 → gRPC 下行 + session 持久化                   │
│  │                                                             │
│  └─ resume(checkpointID, results) ← 从 checkpoint 恢复执行      │
│                                                                │
│  GraphAgent                                                    │
│  ├─ StateGraph: agent_node → router → aggregate                │
│  ├─ agent_node: LLMAgent (OpenAI/DeepSeek/Anthropic)          │
│  ├─ router 节点: BeforeTool callback 分流                       │
│  ├─ graph.Interrupt(state, key, payload) ← 端侧工具挂起点       │
│  ├─ graph.WithNodeTimeout: 超时控制                            │
│  └─ Checkpoint Store: 断网恢复 + Time Travel                   │
│                                                                │
│  LLMAgent                                                      │
│  ├─ Tools: [query_weather, query_db,                          │
│  │           read_temperature★, control_aircon★, ...]         │
│  │           ★ = 端侧工具                                      │
│  ├─ Plugins: logging, guardrail, global_instruction            │
│  └─ Session: redis / mysql / postgres / inmemory               │
└────────────────────────────────────────────────────────────────┘
```

---

## 三、核心技术实现

### 3.1 抢占式打断（自建 VoiceSession loop）

trpc-agent-go 没有 TurnLoop 原语，需要自己在 gRPC handler 中实现抢占逻辑：

```go
type VoiceSession struct {
    deviceID  string
    runner    *runner.Runner
    session   *session.Session
    mu        sync.Mutex
    cancelFn  context.CancelFunc  // ← 抢占取消点
    downCh    chan<- DownMsg       // gRPC 下行通道
}

func (s *VoiceSession) Run(ctx context.Context, upCh <-chan UpMsg, downCh chan<- DownMsg) {
    s.downCh = downCh

    for msg := range upCh {
        switch msg.Type {
        case "asr_text":
            // ★ 抢占：取消当前 RunLoop
            s.mu.Lock()
            if s.cancelFn != nil {
                s.cancelFn() // ← 立刻取消（正在推理中/正在调云端工具/正在等端侧回报）
            }
            runCtx, cancel := context.WithCancel(ctx)
            s.cancelFn = cancel
            s.mu.Unlock()

            // 启动新 RunLoop（不排队）
            go s.executeRunLoop(runCtx, msg.Text)

        case "resume":
            // 端侧工具结果回报 → 从 checkpoint 恢复继续执行
            go s.resumeRunLoop(ctx, msg.ResumeData)
        }
    }
}

func (s *VoiceSession) executeRunLoop(ctx context.Context, text string) {
    defer func() {
        s.mu.Lock()
        s.cancelFn = nil
        s.mu.Unlock()
    }()

    msg := model.NewUserMessage(text)
    eventCh, err := s.runner.Run(ctx, s.deviceID, s.session.ID, msg)
    if err != nil {
        s.downCh <- DownMsg{Type: "error", Error: err}
        return
    }

    for event := range eventCh {
        // ctx 取消 → 立刻退出，丢弃所有中间结果
        if ctx.Err() != nil {
            return
        }

        // ★ 中间文本 delta → gRPC 下行
        if event.Response != nil && len(event.Response.Choices) > 0 {
            delta := event.Response.Choices[0].Delta.Content
            if delta != "" {
                s.downCh <- DownMsg{
                    Type: "interim_text",
                    Text: delta,
                }
            }
        }

        // ★ 工具调用识别
        if isToolCall(event) {
            if isDeviceTool(event.ToolName) {
                // 端侧工具：GraphAgent 内部会触发 graph.Interrupt
                // 不用在这里额外处理
            }
        }

        // ★ 图中断事件 → gRPC 下行
        if isGraphInterrupt(event) {
            s.downCh <- DownMsg{
                Type:         "device_tool_call",
                InterruptPayload: extractInterruptPayload(event),
            }
            return // RunLoop 暂停，等待 resume
        }

        // ★ 最终回复
        if event.IsFinal() {
            s.downCh <- DownMsg{
                Type:    "turn_finished",
                Content: event.Response.Choices[0].Message.Content,
            }
        }
    }
}
```

**抢占流程（关键）：**

```
用户说"查天气" → executeRunLoop(ctx_1, "查天气")
  │
  ├─ LLM 推理 → 中间文本 "好的，我先帮您查询"
  ├─ 调用 query_weather("北京") → 云端工具执行中...
  │
  │  ◄── ★ 用户又说"订机票" ★
  │
  ├─ cancel_1()  ← 立刻取消 ctx_1
  │   ├─ LLM 推理 goroutine 收到 ctx.Done() → 退出
  │   ├─ 云端工具如果有 ctx 感知 → 退出
  │   └─ executeRunLoop 的 for event range 退出
  │
  └─ executeRunLoop(ctx_2, "订机票")  ← 新 RunLoop 立即启动
```

### 3.2 多阶段 RunLoop + 中间文本流

**GraphAgent 结构：**

```go
func BuildVoiceGraph() *graph.StateGraph {
    sg := graph.NewStateGraph(graph.MessagesStateSchema())

    // 节点 1: LLM 推理 + 工具调用
    sg.AddLLMNode("agent_node", llmModel, allTools,
        systemPrompt,
        graph.WithGenerationConfig(model.GenerationConfig{Stream: true}), // ← 流式
    )

    // 节点 2: 工具路由
    sg.AddNode("tool_router", toolRouter,
        graph.WithNodeCallbacks(graph.NodeCallbacks{
            PreToolCallback: beforeToolRouter, // 端侧/云端分流
        }),
    )

    // 节点 3: 结果汇总
    sg.AddNode("aggregate", aggregateResults)

    // 边
    sg.AddEdge(graph.START, "agent_node")
    sg.AddConditionalEdge("agent_node", routeAfterLLM, map[string]string{
        "tools":     "tool_router",    // 有工具调用
        "interrupt": graph.END,        // 端侧工具 → 暂停
        "done":      "aggregate",      // 推理完成
    })
    sg.AddEdge("tool_router", "agent_node") // 工具结果 → 回 LLM
    sg.AddEdge("aggregate", graph.END)

    return sg
}
```

**中间文本流产生方式：**

trpc-agent-go 的 LLMAgent 在 `Stream: true` 模式下，每次 LLM 推理会逐步产出 delta，Runner 把这些 delta 作为事件推送：

```
agent_node 执行:
  LLM 流式输出:
    "好的"     → Event{Delta: "好的"}     → gRPC 下行
    "，我先"   → Event{Delta: "，我先"}   → gRPC 下行
    "帮您查"   → Event{Delta: "帮您查"}   → gRPC 下行
    ...
    决定调用工具  → Event{ToolCalls: [...]}
  ↓
tool_router 执行:
  云端工具直接执行 ✓
  端侧工具 → BeforeTool 拦截 → graph.Interrupt
  ↓
agent_node 再次执行 (收到工具结果后):
  LLM 流式输出:
    "北京今天" → Event{Delta: "北京今天"} → gRPC 下行
    ...
```

### 3.3 端侧工具调用 + 等待回报

```go
// ===== BeforeTool 回调：端侧/云端分流 =====

var toolMetaMap = map[string]ToolMeta{
    "query_weather":    {ExecuteAt: "cloud"},
    "query_db":         {ExecuteAt: "cloud"},
    "read_temperature": {ExecuteAt: "device", Timeout: 3 * time.Second},
    "control_aircon":   {ExecuteAt: "device", Timeout: 5 * time.Second},
}

func beforeToolRouter(ctx context.Context, args *tool.BeforeToolArgs,
    state graph.State) (*tool.BeforeToolResult, error) {

    meta := toolMetaMap[args.ToolName]

    if meta.ExecuteAt == "cloud" {
        return nil, nil // 放行，框架正常执行
    }

    // 端侧工具：拦截，存入 state pending 列表
    pending, _ := state[StateKeyPending].([]DeviceToolRequest)
    pending = append(pending, DeviceToolRequest{
        ToolCallID: toolCallIDFromCtx(ctx),
        ToolName:   args.ToolName,
        Arguments:  args.Arguments,
        Deadline:   time.Now().Add(meta.Timeout),
    })
    state[StateKeyPending] = pending

    // 返回占位结果
    return &tool.BeforeToolResult{
        CustomResult: map[string]any{"status": "dispatched"},
    }, nil
}

// ===== 所有端侧工具收集齐后，graph.Interrupt 批量挂起 =====
func toolRouter(ctx context.Context, state graph.State) (any, error) {
    pending, _ := state[StateKeyPending].([]DeviceToolRequest)
    if len(pending) == 0 {
        return state, nil
    }

    maxTimeout := maxDeadline(pending)

    // ★ graph.Interrupt: 挂起图执行，等待客户端回报
    resumeValue, err := graph.Interrupt(ctx, state, "device_tools", InterruptPayload{
        Requests: pending,
        Deadline: time.Now().Add(maxTimeout),
    })
    if err != nil {
        // 超时兜底
        return graph.State{
            StateKeyDeviceResults: timeoutFallback(pending),
        }, nil
    }

    results := resumeValue.(map[string]any)
    return graph.State{
        StateKeyDeviceResults: results,
    }, nil
}
```

**端侧工具恢复：**

```go
func (s *VoiceSession) resumeRunLoop(ctx context.Context, data ResumeData) {
    // 通过 Runner.Run 注入 graph.Command 恢复中断节点
    // RuntimeState 中的 StateKeyCommand 携带 ResumeMap
    eventCh, err := s.runner.Run(ctx, s.deviceID, s.session.ID,
        nil, // 无新消息
        agent.WithRuntimeState(graph.StateKeyCommand, &graph.Command{
            ResumeMap: map[string]any{
                "device_tools": data.Results, // map[toolCallID]result
            },
        }),
    )
    if err != nil {
        s.downCh <- DownMsg{Type: "error", Error: err}
        return
    }

    // 从恢复点继续处理事件流
    for event := range eventCh {
        if ctx.Err() != nil { return }
        // 继续推送中间文本、最终回复...
    }
}
```

**硬件端并行执行 + 批量回报：**

```go
func (c *DeviceClient) handleDeviceTools(payload InterruptPayload) {
    var wg sync.WaitGroup
    results := make(map[string]any)
    var mu sync.Mutex

    for _, req := range payload.Requests {
        wg.Add(1)
        go func(r DeviceToolRequest) {
            defer wg.Done()

            ctx, cancel := context.WithTimeout(context.Background(),
                time.Until(r.Deadline))
            defer cancel()

            result, err := c.execute(ctx, r)
            mu.Lock()
            if err != nil {
                results[r.ToolCallID] = map[string]any{
                    "error": err.Error(), "tool": r.ToolName,
                }
            } else {
                results[r.ToolCallID] = result
            }
            mu.Unlock()
        }(req)
    }
    wg.Wait()

    // 一次性回报
    c.upStream.Send(&pb.UpStreamMsg{
        Type: "resume",
        ResumeData: &pb.ResumeData{
            Results: results,
        },
    })
}
```

### 3.4 超时三层兜底

| 层级 | 机制 | 说明 |
|------|------|------|
| 工具级 | `DeviceToolRequest.Deadline` 下发 | 硬件端 `context.WithTimeout` 执行 |
| Graph 节点级 | `graph.WithNodeTimeout(60s)` | agent_node / tool_router 超时 → graph.Interrupt 返回 error |
| RunLoop 级 | `ctx.WithTimeout(120s)` | 整个 RunLoop 上限 |

### 3.5 断网重连 + Time Travel

trpc-agent-go 的独有优势：**Checkpoint Time Travel**

```go
// ===== GraphAgent 创建时配置 CheckpointSaver =====
// CheckpointSaver 支持: inmemory / sqlite / redis
saver := checkpointinmemory.NewSaver()

graphAgent, _ := graphagent.New("voice-agent", compiledGraph,
    graphagent.WithCheckpointSaver(saver),
    graphagent.WithCheckpointSaveTimeout(5*time.Second),
)

// Runner 封装 GraphAgent
r := runner.NewRunner("voice-app", graphAgent)
```

**Interrupt 时自动保存 checkpoint。设备断网 → 重连 → 从 checkpoint 恢复：**

```go
// 恢复方式 1: 标准恢复 — 从最近的 checkpoint 继续
eventCh, err := r.Run(ctx, deviceID, sessionID, nil,
    agent.WithRuntimeState(graph.CfgKeyCheckpointID, checkpointID),
    agent.WithRuntimeState(graph.StateKeyCommand, &graph.Command{
        ResumeMap: map[string]any{"device_tools": results},
    }),
)

// 恢复方式 2: ★ Time Travel — 回到更早的 checkpoint 重试
// 用户: "刚才空调没反应，重新开一下"
// → 回到 control_aircon 调用之前的 checkpoint
// → 只重新执行 control_aircon，不需要重新查天气

executor := graphAgent.Executor()
checkpoints, _ := executor.CheckpointManager().List(ctx, config, nil)
// [ckpt_1(开始), ckpt_2(查天气后), ckpt_3(调空调前), ckpt_4(中断)]

// 回退到查天气之后的 checkpoint
eventCh, err := r.Run(ctx, deviceID, sessionID, nil,
    agent.WithRuntimeState(graph.CfgKeyCheckpointID, checkpoints[2].Checkpoint.ID),
    agent.WithRuntimeState(graph.StateKeyCommand, &graph.Command{
        ResumeMap: map[string]any{"device_tools": results},
    }),
)
```

---

## 四、技术路线

```
Phase 1: 基础链路
  ├─ LLMAgent(Stream:true) + 全部工具注册
  ├─ 中间文本 delta → gRPC 下行
  └─ Session(Redis) 持久化

Phase 2: 抢占 + 端侧工具
  ├─ VoiceSession 自建 loop (ctx cancel 抢占)
  ├─ GraphAgent + BeforeTool callback 分流
  ├─ graph.Interrupt 端侧工具挂起
  └─ graph.Command{ResumeMap} 批量恢复

Phase 3: 生产加固
  ├─ CheckpointStore 断网恢复 + Time Travel
  ├─ graph.WithNodeTimeout 超时控制
  ├─ Plugins: guardrail, global_instruction
  └─ Distributed cancel (多实例取消信号)

Phase 4: 多设备 + 灰度
  ├─ Session + Checkpoint 按 deviceID 隔离
  ├─ Time Travel 高级体验: 用户"撤回"到任意历史点
  └─ Model warmup + prompt cache 优化首字延迟
```

---

## 五、成熟度评估

| 维度 | 评分 | 说明 |
|:---|:---:|:---|
| 抢占式打断 | ⭐⭐⭐ | 自建 loop + ctx cancel 实现，需手动管理生命周期 |
| 多阶段 RunLoop | ⭐⭐⭐⭐ | LLMAgent Stream + GraphAgent 节点循环天然支持 |
| 中间文本流 | ⭐⭐⭐⭐⭐ | LLMAgent Stream:true → 逐 delta 推送，粒度为 token 级 |
| 端侧工具批量 | ⭐⭐⭐⭐ | graph.Interrupt + ResumeMap 批量恢复 |
| 超时处理 | ⭐⭐⭐⭐ | 三层兜底 + graph.WithNodeTimeout 节点级 |
| 断网恢复 | ⭐⭐⭐⭐⭐ | Checkpoint Time Travel，可回退到任意历史点重试 |
| Time Travel 重试 | ⭐⭐⭐⭐⭐ | **独有特性**，用户"撤销"操作回到历史 checkpoint |
| gRPC 适配 | ⭐⭐⭐⭐ | 框架不绑定协议，需手动映射 event stream → gRPC |

---

## 六、与 Eino 方案的关键差异

| 场景 | Eino | trpc-agent-go |
|------|------|---------------|
| 实现抢占打断 | `TurnLoop.Push(WithPreempt)` 框架原生 | 自建 VoiceSession + ctx cancel |
| 端侧工具挂起 | `compose.Interrupt` 工具层直接触发 | GraphAgent `graph.Interrupt` 图节点级 |
| 批量工具处理 | `CompositeInterrupt` 自动合并 | 手动在 state 维护 pending 列表 |
| 端侧工具恢复 | `ResumeWithParams{Targets}` 一次恢复 | `graph.Command{ResumeMap}` 一次恢复 |
| 断网恢复 | `CheckPointStore` 声明式恢复 | `CheckPointStore` + **Time Travel 重试** |
| 中间文本粒度 | Agent 回复级 | LLM token 级流式（更细粒度） |
