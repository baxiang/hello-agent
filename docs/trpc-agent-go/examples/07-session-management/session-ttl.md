# Session TTL 过期机制 - 会话自动失效与重建

> **源码路径**：[`trpc-agent-go/examples/session/ttl/`](../../../../trpc-agent-go/examples/session/ttl)
> **示例类型**：自动化脚本（非交互） · **难度**：入门

## 概述

`ttl/` 是一个**非交互**的自动化示例，验证 Session 的 TTL（Time-To-Live）机制：会话在配置的存活时长内未被访问就自动过期，`GetSession` 此后返回 `nil`，下一次写入会创建一个全新会话。这是实现"会话自然衰减""隐私自动清理""临时上下文"等需求的基石。

与 [`eventlimit`](./session-eventlimit.md) 的关系：eventlimit 按**数量**滑动窗口保留近期事件；ttl 按**时间**整体过期。两者正交，可同时配置。

## 核心概念

### TTL 配置

通过 `util.SessionServiceConfig.TTL` 传入一个 `time.Duration`：

```go
ttl := time.Duration(*ttlSeconds) * time.Second

sessionService, err := util.NewSessionServiceByType(
    util.SessionType(*sessionType),
    util.SessionServiceConfig{
        EventLimit: 100,   // 本示例硬编码 100，留足空间观察 TTL 行为
        TTL:        ttl,
    },
)
```

所有支持 TTL 的后端（inmemory/sqlite/redis/mysql/postgres/pgvector/clickhouse）行为一致：超过 TTL 未活动的会话被视为过期。

### 过期的三个可观测信号

1. `GetSession(ctx, key)` 返回 `(nil, nil)`——会话不存在且无错误
2. 用相同 `(appName, userID, sessionID)` 再次 `Run` 时，会创建一个全新会话
3. 新会话事件数远少于过期前（因为是从零开始）

### 与 EventLimit 的本质区别

| 机制 | 触发维度 | 作用对象 | 结果 |
|------|---------|---------|------|
| `EventLimit` | 事件条数 | 单条事件 | 旧的被滑动挤出，会话仍在 |
| `TTL` | 时间间隔 | 整个会话 | 会话整体失效、后续重建 |

## 代码解析

### 三阶段自动化脚本（`main.go`）

示例不读 stdin，按 Phase 1 → 2 → 3 一路跑完：

**Phase 1：建立可被记住的历史**

```go
messages := []string{
    "My name is Alice and I'm a software engineer.",
    "I work at TechCorp on distributed systems.",
    "What's my name and where do I work?",
}
for _, msg := range messages {
    util.RunAgent(ctx, r, userID, sessionID, msg, true)
}
```

随后断言：会话存在、事件数 ≥ 6（3 轮 × 2 事件），并通过 `util.PrintSessionEvents` 打印档案。此时 Agent 能准确回答"Alice，在 TechCorp 做分布式系统"。

**Phase 2：真实等待过期**

```go
waitTime := ttl + 2*time.Second
for remaining := int(waitTime.Seconds()); remaining > 0; remaining-- {
    fmt.Printf("\rWaiting... %2d seconds remaining", remaining)
    time.Sleep(1 * time.Second)
}
```

> 默认 `-ttl=10`，所以脚本会**真的阻塞 ~12 秒**。这是为了用最小成本观察过期行为，生产环境 TTL 通常设几十分钟到几天。

等待结束后断言会话已被清理：

```go
sess, err = sessionService.GetSession(ctx, key)
if sess != nil {
    log.Fatalf("VERIFY FAILED: expected expired session to be nil, got %d events",
        len(sess.Events))
}
```

**Phase 3：过期后重建**

用**同一个 sessionID** 再发一条消息：

```go
util.RunAgent(ctx, r, userID, sessionID, "What's my name?", true)
```

此时框架发现会话不存在，自动创建新会话。Agent 回答"I don't have access to personal information..."——完全忘记了 Alice。断言新会话事件数 < 过期前，证明这是"从零开始"。

### 复用 util 公共工具

与 [`eventlimit`](./session-eventlimit.md) 一样，本示例不自建 Runner，全靠 `session/util.go`：

| 助手 | 作用 |
|------|------|
| `util.NewSessionServiceByType` | 按 `SessionType` + `SessionServiceConfig`（含 TTL）创建服务 |
| `util.DefaultRunnerConfig()` | 默认 Runner 配置（model 默认 `deepseek-v4-flash`，instruction 可改写） |
| `util.NewRunner` | 创建带会话服务的 Runner |
| `util.RunAgent` | 单轮运行 + 打印 |
| `util.PrintSessionEvents` | debug 打印事件列表 |

示例把 `cfg.Instruction` 改成 `"You are a helpful assistant. Keep responses brief."` 以加快响应、降低 token 消耗。

## 运行方式

### 环境变量

| 变量 | 必需 | 说明 | 默认值 |
|------|------|------|--------|
| `OPENAI_API_KEY` | 是 | 模型 API Key | — |
| `OPENAI_BASE_URL` | 否 | 模型端点 | `https://api.openai.com/v1` |

按所选后端补充：`SQLITE_SESSION_DSN` / `REDIS_ADDR` / `PG_*` / `PGVECTOR_*` / `MYSQL_*` / `CLICKHOUSE_*`。

### 命令行参数

| 参数 | 说明 | 默认值 |
|------|------|--------|
| `-model` | 模型名 | `MODEL_NAME` 环境变量 |
| `-session` | 后端：`inmemory`/`sqlite`/`redis`/`mysql`/`postgres`/`pgvector`/`clickhouse` | `inmemory` |
| `-ttl` | 会话存活秒数（需大于总对话耗时） | `10` |

### 运行命令

```bash
cd examples/session/ttl
export OPENAI_API_KEY="your-api-key"

go run main.go                       # 默认 inmemory, ttl=10s（约 22 秒跑完）
go run main.go -session=redis -ttl=30
go run main.go -session=sqlite -ttl=5   # 最快验证
```

> `-ttl` 必须**大于 Phase 1 总对话耗时**，否则会在建立历史前就过期，导致断言失败。慢模型建议 `-ttl=60` 以上。

### 预期输出

```
==================================================
Session TTL (Time-To-Live) Demo
==================================================
Backend: inmemory | TTL: 10s

Phase 1: building conversation history
│  User: My name is Alice and I'm a software engineer.
│  Assistant: Nice to meet you, Alice! ...
│  User: I work at TechCorp on distributed systems.
│  Assistant: Cool! Distributed systems can be tricky...
│  User: What's my name and where do I work?
│  Assistant: Your name is Alice, and you work at TechCorp ...
│  [DEBUG] Session Events: 6
Phase 1 complete: 6 events stored

Phase 2: waiting for session to expire
Waiting... 12 seconds remaining
...
TTL expired. Session should be cleaned up.
Phase 2 complete: session cleaned up

Phase 3: fresh conversation after expiry
(The assistant should NOT remember Alice.)
│  User: What's my name?
│  Assistant: I don't have access to personal information unless you share it.
│  [DEBUG] Session Events: 2
Phase 3 complete: 2 events (fresh start)

Demo complete.
Verified: storage, TTL expiration, fresh start.
```

## 适用场景与对比

**选 ttl 当：**
- 合规要求"会话 N 小时后自动销毁"（GDPR、隐私政策）
- 临时访客模式：游客上下文用完即弃
- 防止陈旧上下文污染新对话（如隔天返回的用户）
- 控制存储成本：长期不活跃的会话自动回收

**对比生命周期控制：**

| 维度 | ttl | [`eventlimit`](./session-eventlimit.md) | [`hook`](./session-hook.md) |
|------|-----|------------------------------------------|------------------------------|
| 控制对象 | 整个会话的存活时长 | 单会话事件条数 | 事件内容合规性 |
| 触发结果 | 整体过期、重建 | 滑动窗口保留近期 | 标记/过滤违规 |
| 典型场景 | 隐私合规、临时上下文 | 控 token 长度 | 内容审核 |

> **生产组合拳**：`TTL` + `EventLimit` + `MarkViolationHook` 三件套——TTL 管寿命、EventLimit 管长度、Hook 管合规。

## 关键要点

1. **时间维度过期**：TTL 按"最后活动 + 时长"判定，到期 `GetSession` 返回 `nil`。
2. **会重建**：过期后用同一 sessionID 再写入，会创建全新会话，旧数据彻底不可见。
3. **后端一致**：所有支持 TTL 的后端语义统一，切换无需改业务代码。
4. **与 EventLimit 正交**：两者可同时配置，分别管"寿命"和"宽度"。
5. **默认 10 秒**：演示用值，生产环境通常设几十分钟到数天。

## 总结

ttl 用一个会真实等待 12 秒的脚本，把"会话过期→清空→重建"三件事一次讲透。它和 [`eventlimit`](./session-eventlimit.md) 共同构成 Session 的生命周期双轴：一个管"活多久"，一个管"记多少"。再叠加 [`hook`](./session-hook.md) 的内容过滤，就能搭建出满足合规、性能、审核三重诉求的生产级会话管理。
