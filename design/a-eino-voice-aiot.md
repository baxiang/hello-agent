# AIoT 语音 Agent 技术方案：Eino 路线

## 零、场景定义

```
硬件终端 (Android/Linux)                      云端服务 (gRPC 双向流)
─────────────────────                        ───────────────────────
麦克风 ──► ASR(本地或云端) ──文本──►  进入 Agent RunLoop
                                       │
                                       ├─ 推理阶段 1
                                       │   └─ 中间文本: "好的，我先帮您查天气"
                                       │      (通过 gRPC 下行推给客户端播放)
                                       │
                                       ├─ 调用云端工具: query_weather
                                       │   └─ 立即执行 ✓
                                       │
                                       ├─ 推理阶段 2
                                       │   └─ 中间文本: "北京今天 32 度，帮您打开空调"
                                       │
                                       ├─ 调用端侧工具: control_aircon ────► 等待硬件回报
                                       │                                          │
            ◄── 中间文本: "正在打开空调..." ──┘                                   │
                                       │                                          │
                                       │        ◄── 硬件回报: {"status":"ok"} ──┘
                                       │
                                       ├─ 推理阶段 3
                                       │   └─ 中间文本: "空调已设到 26 度，还要播放新闻吗？"
                                       │
┌──────────────────────────────────────────────────────────────┐
│  ★ 关键差异：这是抢占式，不是排队式                              │
│                                                              │
│  执行中           用户再说一句                                  │
│  ├─ LLM 推理中...    │                                       │
│  ├─ 云端工具执行中... │                                       │
│  └─ 等待端侧回报中... │                                       │
│                      ▼                                       │
│  立刻取消当前 RunLoop → 启动新的 RunLoop（新文本）              │
│  旧的中间结果全部丢弃，不做排队                                 │
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

这是整个方案的核心抽象：

```
                    一个 RunLoop（一次 ASR 触发）
┌────────────────────────────────────────────────────────────────┐
│                                                                │
│  ┌─ LLM 推理 ─┐    ┌─ LLM 推理 ─┐    ┌─ LLM 推理 ─┐           │
│  │            │    │            │    │            │           │
│  │ 中间文本   │    │ 中间文本   │    │ 中间文本   │           │
│  │            │    │            │    │            │           │
│  └──┬──┬──┬──┘    └──┬────┬────┘    └─────┬──────┘           │
│     │  │  │          │    │               │                  │
│     ▼  ▼  ▼          ▼    ▼               ▼                  │
│   云端工具         云端工具 端侧工具     最终回复               │
│   (立即执行)       (立即)  (暂停等待)                         │
│                              │                                │
│                              ▼                                │
│                     ← 硬件回报 ───                            │
│                              │                                │
│                     RunLoop 恢复继续推理                       │
│                                                                │
│  ◄─ 任意时刻，新 ASR 文本到达 → cancel → 启动新 RunLoop       │
└────────────────────────────────────────────────────────────────┘
```

---

## 二、Eino 方案：整体架构

```
┌────────────────────────────────────────────────────────────────┐
│                         gRPC 双向流                             │
│  UpStream:   {audio/ASR文本}  /  {resume: 端侧工具结果}        │
│  DownStream: {中间文本}  /  {interrupt: 端侧工具调用}  /  {结束}│
├────────────────────────────────────────────────────────────────┤
│                      VoiceSession (per device)                 │
│                                                                │
│  TurnLoop ←── Eino 第一公民：抢占式多轮执行引擎                 │
│  ├─ Push(text, WithPreempt(AnySafePoint))                      │
│  │   新 ASR 文本 → 抢占取消当前 turn → 开始新 turn               │
│  │                                                             │
│  ├─ GenInput()          ← 从队列取文本，构建 AgentInput         │
│  ├─ PrepareAgent()      ← 按需构建 Agent（可带动态配置）         │
│  ├─ GenResume()         ← 从 checkpoint 恢复 + 注入工具结果     │
│  └─ OnAgentEvents()     ← 事件流分发：                         │
│                              ├─ 中间文本 → gRPC 下行            │
│                              ├─ InterruptInfo → gRPC 下行(端侧工具)│
│                              └─ 最终回复 → gRPC 下行            │
│                                                                │
│  ChatModelAgent                                                │
│  ├─ ToolsNode: [query_weather, query_db,                      │
│  │               read_temperature★, control_aircon★, ...]     │
│  │               ★ = 端侧工具，内部调用 compose.Interrupt()    │
│  ├─ Middleware: skills, toolsearch, filesystem                │
│  └─ Callbacks: tracing, metrics, logging                      │
│                                                                │
│  compose.Interrupt(ctx, toolRequest) ← 端侧工具挂起点           │
│  CompositeInterrupt() ← 多工具批量打包                          │
│  ResumeWithParams{Targets: map[ID]result} ← 批量结果恢复        │
│                                                                │
│  CheckPointStore(Redis) ← 断网/重连时自动恢复                   │
└────────────────────────────────────────────────────────────────┘
```

---

## 三、核心技术实现

### 3.1 抢占式打断（不是排队）

```go
// ===== 每个设备一个 VoiceSession =====
type VoiceSession struct {
    loop      *adk.TurnLoop[VoiceItem, M]
    deviceID  string
}

// ===== gRPC stream handler =====
func (s *VoiceServer) Stream(stream pb.VoiceAgent_StreamServer) error {
    deviceID := extractDeviceID(stream)
    sess := s.getOrCreateLoop(deviceID)

    // goroutine: TurnLoop → gRPC 下行
    go func() {
        // OnAgentEvents 中分发事件到 gRPC
    }()

    // goroutine: gRPC 上行 → TurnLoop
    for {
        msg, err := stream.Recv()
        if err != nil { break }

        switch msg.Type {
        case "asr_text":
            // ★ 关键：Push 带 WithPreempt →
            //    不管当前在干什么（推理/调云端工具/等端侧回报/播文本）
            //    立刻取消当前 turn，开始新 turn
            accepted, ack := sess.loop.Push(
                VoiceItem{Text: msg.Text},
                adk.WithPreempt[VoiceItem, M](adk.AnySafePoint),
            )
            if accepted { <-ack } // 确认旧 turn 已取消

        case "resume":
            // 端侧工具结果回报 → Push 到 TurnLoop 恢复执行
            sess.loop.Push(VoiceItem{
                Type: "resume",
                ResumeData: msg.ResumeData,
            })
        }
    }
    return nil
}
```

**抢占 vs 排队的区别：**

```
排队式（错误）:
  用户说"查天气" → RunLoop_1 开始
  用户说"订机票" → 排队，等 RunLoop_1 完成后再执行
  → 用户要等天气查完（可能 10 秒+），体验极差

抢占式（正确）:
  用户说"查天气" → RunLoop_1 开始
  RunLoop_1 正在调云端工具 query_weather...
  用户说"订机票" → TurnLoop.Push(text, WithPreempt) → 
    ├─ cancel RunLoop_1（query_weather 中断）
    └─ start RunLoop_2（新文本"订机票"）
  → 用户立刻听到新回复，无需等待
```

### 3.2 多阶段 RunLoop + 中间文本流式下播

```go
// ===== OnAgentEvents: 中间文本分发 =====
OnAgentEvents: func(ctx context.Context,
    tc *adk.TurnContext[VoiceItem, M],
    events *adk.AsyncIterator[*adk.TypedAgentEvent[M]],
) error {

    for event := range events.Events() {
        // 检测抢占信号
        select {
        case <-tc.Preempted:
            // 被抢占了 → 当前输出全部丢弃，不推给客户端
            log.Println("turn preempted, discarding outputs")
            return nil
        default:
        }

        if event.Err != nil { return event.Err }

        // ★ 中间文本 → gRPC 下行
        // Agent 每推理一段就产出一段文本：
        // "好的，我先帮您查天气" → "北京今天 32 度" → "正在帮您打开空调" → ...
        if event.Output != nil && event.Output.MessageOutput != nil {
            text := event.Output.MessageOutput.Message.Content
            if !event.IsFinal() {
                // 中间态文本 → 推给客户端缓解焦虑
                sendToClient(DownMsg{
                    Type: "interim_text",
                    Text: text,
                })
            } else {
                // 最终回复
                sendToClient(DownMsg{
                    Type: "final_text",
                    Text: text,
                })
            }
        }

        // ★ 端侧工具调用 → gRPC 下发给硬件
        if event.Action != nil && event.Action.Interrupted != nil {
            for _, ic := range event.Action.Interrupted.InterruptContexts {
                req := parseInterrupt(ic.Info)
                sendToClient(DownMsg{
                    Type: "device_tool",
                    InterruptID:  ic.ID,
                    ToolName:     req.ToolName,
                    Arguments:    req.Arguments,
                    Deadline:     req.Deadline,
                })
            }
        }
    }
    return nil
}
```

**中间文本的实际效果：**

```
Agent 推理过程                          推给客户端的内容
─────────────────                      ────────────────
LLM 推理 → "好的，我先帮您查天气"  →   "好的，我先帮您查天气"
调用 query_weather("北京")             (内部)
得到 32°C                              (内部)
LLM 推理 → "北京今天 32 度，帮您..."  →   "北京今天 32 度，帮您打开空调"
调用 control_aircon(26°C)              →   端侧工具下发
                                        ├─ "正在打开空调..."
                                        └─ 等待硬件回报...
得到回报 {"status":"ok"}               (内部)
LLM 推理 → "已为您调到 26 度"          →   "已为您调到 26 度"
结束                                    →   最终回复
```

### 3.3 端侧工具调用 + 等待回报

```go
// ===== 端侧工具定义 =====
type DeviceTool struct {
    name    string
    timeout time.Duration
}

func (t *DeviceTool) InvokableRun(ctx context.Context, args string,
    opts ...tool.Option) (string, error) {

    // 端侧工具：不实际执行，而是触发 interrupt
    // 框架暂停 RunLoop，等待 resume
    return "", compose.Interrupt(ctx, DeviceToolRequest{
        ToolName:  t.name,
        Arguments: args,
        Deadline:  time.Now().Add(t.timeout),
    })
}

// 当 LLM 同时调用 3 个工具（1 个云端 + 2 个端侧）：
// ToolsNode 内部：
//   ├─ query_weather    → 云端工具，直接执行 ✓
//   ├─ read_temperature → compose.Interrupt() → RunLoop 挂起 ⏸
//   └─ control_aircon   → compose.Interrupt() → RunLoop 挂起 ⏸
//
// CompositeInterrupt 自动打包两个端侧工具：
// ┌─ InterruptContext{ID:"...read_temperature:0", Info:{tool, args, deadline}}
// └─ InterruptContext{ID:"...control_aircon:1",   Info:{tool, args, deadline}}
```

**端侧工具恢复：**

```go
// ===== GenResume: 从 checkpoint 恢复 + 注入工具结果 =====
GenResume: func(ctx context.Context,
    loop *adk.TurnLoop[VoiceItem, M],
    interruptedItems, unhandledItems, newItems []VoiceItem,
) (*adk.GenResumeResult[VoiceItem, M], error) {

    // newItems[0] 是刚 Push 的 resume item
    resumeItem := newItems[0]
    return &adk.GenResumeResult[VoiceItem, M]{
        ResumeParams: &adk.ResumeParams{
            // Targets: map[interruptID]result
            // 框架根据 Address 自动路由到对应工具节点恢复
            Targets: resumeItem.ResumeData.Targets,
        },
        Consumed: newItems[:1],
    }, nil
}
```

### 3.4 超时三层兜底

| 层级 | 机制 | 说明 |
|------|------|------|
| 工具级 | `ClientToolRequest.Deadline` 下发 | 硬件端 `context.WithTimeout` 执行，超时返回 `{"error":"timeout"}` |
| Preempt 超时 | `WithPreemptTimeout(AnySafePoint, 10s)` | 如果当前 RunLoop 在安全点卡住超过 10s，自动升级为 CancelImmediate |
| TurnLoop 级 | context deadline | gRPC stream 级别超时，兜底所有场景 |

### 3.5 断网重连

Eino 的 `CheckPointStore` 声明式恢复：

```go
// RunLoop 在 Interrupt 时自动保存 checkpoint 到 Redis
// 设备断开 → gRPC stream 断开 → TurnLoop.Stop()

// 设备重连 → 创建新 TurnLoop → 相同 CheckpointID
// Run() 检测到 checkpoint 存在 → 调用 GenResume 恢复
// → 从中断点继续推理
```

---

## 四、技术路线

```
Phase 1: 基础链路
  ├─ ChatModelAgent + 全部工具注册
  ├─ 端侧工具 → compose.Interrupt 挂起
  └─ gRPC 双向流: 文本上下行

Phase 2: 抢占 + 多阶段 RunLoop
  ├─ TurnLoop.Push(WithPreempt) → 抢占式打断
  ├─ OnAgentEvents 分发: 中间文本流 / 端侧工具调用 / 最终回复
  └─ CompositeInterrupt 批量并行工具打包

Phase 3: 生产加固
  ├─ CheckPointStore(Redis) 断网恢复
  ├─ WithPreemptTimeout 卡死防护
  ├─ Middleware: toolsearch, skills
  └─ Callbacks: tracing + metrics

Phase 4: 多设备 + 灰度
  ├─ TurnLoop 按 deviceID 分片
  └─ GenInput 策略调优（取最新 vs 合并上下文）
```

---

## 五、成熟度评估

| 维度 | 评分 | 说明 |
|:---|:---:|:---|
| 抢占式打断 | ⭐⭐⭐⭐⭐ | TurnLoop `WithPreempt` 一行代码，引擎级支持 |
| 多阶段 RunLoop | ⭐⭐⭐⭐⭐ | ToolsNode 自动 ReAct 循环 + Interrupt 暂停/恢复 |
| 中间文本流 | ⭐⭐⭐⭐ | OnAgentEvents 逐事件分发，中间态 vs 最终态可区分 |
| 端侧工具批量 | ⭐⭐⭐⭐⭐ | CompositeInterrupt 自动打包 + BatchResume 批量恢复 |
| 超时处理 | ⭐⭐⭐⭐ | 三层兜底 + PreemptTimeout 自动升级 |
| 断网恢复 | ⭐⭐⭐⭐⭐ | CheckPointStore 声明式恢复 |
| gRPC 适配 | ⭐⭐⭐⭐ | 框架不绑定协议，需手动映射 OnAgentEvents → gRPC |
