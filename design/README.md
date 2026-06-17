# AIoT 语音 Agent 技术方案

## 背景

本文档描述 AIoT 语音场景下，基于 Agent 框架构建"云端 Agent + 硬件客户端"交互系统的技术需求与方案对比。

## 场景定义

```
硬件终端 (Android/Linux)                      云端服务 (gRPC 双向流)
─────────────────────                        ───────────────────────
麦克风 ──► ASR(本地或云端) ──文本──►  进入 Agent RunLoop
                                       │
                                       ├─ 推理 → 中间文本下行
                                       ├─ 调用云端工具 → 立即执行
                                       ├─ 推理 → 中间文本下行
                                       ├─ 调用端侧工具 → 下发硬件 → 等待回报
                                       ├─ 收到回报 → 恢复推理 → 中间文本下行
                                       └─ 最终回复
```

ASR 识别结果以文本形式送入 Agent，Agent 推理产出的文本通过 gRPC 下行流推送给客户端（可用于 TTS 播报）。Agent 在 RunLoop 执行期间可调用两类工具：云端工具立即执行，端侧工具下发到硬件端异步执行后回报。

## 核心需求

### 需求 1：多阶段 RunLoop

Agent 在单次会话中执行多轮"推理 → 调用工具 → 获得结果 → 再推理"循环。每一阶段都可能产出中间文本（如"正在查询..."、"已找到 3 条记录..."），通过 gRPC 下行流推给客户端，用于缓解用户等待焦虑。

### 需求 2：抢占式打断（非排队）

新的 ASR 识别文本到达时，立刻取消当前 RunLoop 的全部执行（不论正在 LLM 推理、调用云端工具、等待端侧工具回报），并启动新的 RunLoop。旧的中间结果全部丢弃，不做排队。

### 需求 3：端侧工具异步回报

工具分为两类：

| 类型 | 执行位置 | 行为 |
|------|----------|------|
| 云端工具 | 服务端 | LLM 调用时立即执行，结果同步返回 |
| 端侧工具 | 硬件端 | RunLoop 暂停等待，工具请求通过 gRPC 下发硬件，硬件并行执行后批量回报结果，RunLoop 恢复继续推理 |

端侧工具需支持超时兜底（硬件端未在 deadline 前回报则返回超时错误，Agent 自行处理）。

### 需求 4：中间文本缓解焦虑

Agent 执行过程中，在以下时机产出中间文本并推送客户端：
- 开始执行时："好的，我先帮您查询..."
- 调用端侧工具前："正在打开空调..."
- 端侧工具执行完："空调已设置为 26 度"
- 长时间推理/等待时：进度提示

中间文本与最终回复通过事件类型区分，客户端可分别处理。

### 需求 5：gRPC 双向流 + 断网恢复

- 传输协议：gRPC bidirectional streaming
- 上行：ASR 识别文本、端侧工具执行结果
- 下行：中间文本、端侧工具调用请求、最终回复
- 断网重连后从 checkpoint 恢复，继续未完成的 RunLoop

## 方案文档

| 文档 | 框架 | 路径 |
|------|------|------|
| 方案一 | Eino (CloudWeGo) | [a-eino-voice-aiot.md](./a-eino-voice-aiot.md) |
| 方案二 | trpc-agent-go (Tencent) | [b-trpc-agent-go-voice-aiot.md](./b-trpc-agent-go-voice-aiot.md) |

## 核心差异对比

| 维度 | Eino | trpc-agent-go |
|------|------|---------------|
| **抢占式打断** | TurnLoop `Push(WithPreempt)` 框架原生 | 自建 VoiceSession + ctx cancel |
| **端侧工具挂起** | `compose.Interrupt` 工具层触发 | `graph.Interrupt` 图节点级 |
| **批量工具打包** | `CompositeInterrupt` 自动合并 | 手动 state 维护 pending 列表 |
| **批量结果恢复** | `ResumeWithParams{Targets}` | `graph.Command{ResumeMap}` |
| **断网恢复** | CheckPointStore 声明式 | CheckPointStore + **Time Travel** |
| **中间文本粒度** | Agent 回复级 | LLM token 级流式 |
| **独有优势** | 抢占是第一公民，代码量最少 | Time Travel 可回退任意历史点重试 |

## 技术路线（通用）

```
Phase 1: 基础链路
  ├─ Agent 创建 + 全部工具注册（云端 + 端侧）
  ├─ 端侧工具挂起机制
  ├─ 中间文本流式下播
  └─ gRPC 双向流: 文本上下行

Phase 2: 抢占 + 端侧工具批量
  ├─ 抢占式打断机制
  ├─ 端侧/云端工具分流
  ├─ 批量工具下发 + 并行执行 + 批量回报
  └─ 超时三层兜底

Phase 3: 生产加固
  ├─ Checkpoint 断网恢复
  ├─ 多实例部署 + 取消信号同步
  ├─ 可观测性: tracing + metrics + logging
  └─ 安全审核: guardrail

Phase 4: 多设备 + 优化
  ├─ Session/Checkpoint 按设备隔离
  ├─ Model warmup + prompt cache 降低首字延迟
  └─ 降级策略: ASR 不可用/模型超时
```

## 待决策项

1. **框架选型**：Eino vs trpc-agent-go，需结合团队技术栈、生态集成、社区活跃度综合评估
2. **ASR 部署位置**：本地端侧 vs 云端 ASR 服务
3. **CheckPointStore 选型**：Redis（适合分布式）vs SQLite（适合单机开发）
4. **超时策略**：端侧工具默认超时值、全局 RunLoop 超时值
5. **中间文本策略**：哪些阶段产出中间文本、文本长度限制、是否合并连续短文本
