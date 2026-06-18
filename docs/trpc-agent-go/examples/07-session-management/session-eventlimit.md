# Session 事件数量限制 - 滑动窗口控制上下文长度

> **源码路径**：[`trpc-agent-go/examples/session/eventlimit/`](../../../../trpc-agent-go/examples/session/eventlimit)
> **示例类型**：自动化脚本（非交互） · **难度**：入门

## 概述

`eventlimit/` 是一个**非交互**的自动化示例，用三阶段脚本验证 Session 的滑动窗口机制：当会话事件数超过 `EventLimit` 时，最早的事件被自动丢弃，只保留最近的 N 条。这是控制内存占用和 LLM 上下文长度最直接的手段。

与 [`ttl`](./session-ttl.md) 的区别：eventlimit 限制**数量**（按事件条数滑动窗口），ttl 限制**时间**（按存活时长整体过期）。两者正交，可叠加使用。

## 核心概念

### 一轮对话 = 2 个事件

每次 `Runner.Run()` 至少产生 2 个事件：一条 user 消息 + 一条 assistant 响应。所以 `EventLimit=4` 意味着只保留**最近 2 轮对话**。

```go
eventLimit = flag.Int(
    "limit",
    4,
    "Max events per session (1 turn = 2 events: user + assistant)",
)
```

### 配置只需一行

通过 `util.SessionServiceConfig.EventLimit` 把上限传给后端工厂：

```go
sessionService, err := util.NewSessionServiceByType(
    util.SessionType(*sessionType),
    util.SessionServiceConfig{EventLimit: *eventLimit},
)
```

所有后端（inmemory/sqlite/redis/mysql/postgres/pgvector/clickhouse）都接受同一个配置项，滑动窗口行为一致。

### 滑动窗口语义

窗口是**保留最近**而不是"满了拒绝写入"——新事件照常追加，超过上限时旧的从头部丢弃。模型在下一轮只能看到窗口内的事件，因此会"忘记"早期信息。

## 代码解析

### 三阶段自动化流程（`main.go`）

示例不读 stdin，而是一条龙跑完三个阶段：

```go
// Phase 1：连续发 4 条消息，观察事件数从 2 → 4 → 4 → 4
messages := []string{
    "My name is Alice.",
    "I live on Mars.",
    "I work as a software engineer.",
    "My favorite color is blue.",
}
for i, msg := range messages {
    util.RunAgent(ctx, r, userID, sessionID, msg, true)
    sess, _ := sessionService.GetSession(ctx, key)
    fmt.Printf("Events in session: %d\n\n", len(sess.Events))
}
```

Phase 1 输出会清晰展示窗口触发：第 1 轮后 2 条事件、第 2 轮后 4 条（到顶）、第 3、4 轮稳定在 4 条（旧的被挤出）。

### Phase 2：断言窗口生效

```go
sess, err := sessionService.GetSession(ctx, key)
if len(sess.Events) > *eventLimit {
    log.Fatalf("VERIFY FAILED: expected <= %d events, got %d",
        *eventLimit, len(sess.Events))
}
fmt.Printf("[OK] Event count (%d) <= limit (%d)\n", len(sess.Events), *eventLimit)
```

随后调 `util.PrintSessionEvents` 打印幸存事件——此时应只剩"软件工程师"和"喜欢蓝色"两轮，"Alice"和"Mars"已被丢弃。

### Phase 3：验证记忆遗忘

```go
testQuestions := []struct{ question, note string }{
    {"What's my favorite color?", "recent - should remember"},
    {"What's my name?",           "early - may be forgotten"},
}
```

Agent 能答出"蓝色"（窗口内），但对"名字"会一脸茫然（已被挤出窗口）。这正是滑动窗口的直观副作用——它保护了上下文长度，却牺牲了长期一致性。需要长期记忆请配合 Memory 系统。

### 复用 util 公共工具

本示例没有自己造 Runner，全靠 `session/util.go` 提供的四个助手，代码因此非常紧凑：

| 助手 | 作用 |
|------|------|
| `util.NewSessionServiceByType` | 按类型创建会话服务 |
| `util.DefaultRunnerConfig()` | 生成默认 Runner 配置（model 默认 `deepseek-v4-flash`） |
| `util.NewRunner` | 创建带会话服务的 Runner |
| `util.RunAgent` | 跑一轮并打印对话 |
| `util.PrintSessionEvents` | 打印会话全部事件（debug 视图） |

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
| `-limit` | 每会话事件上限（1 轮 = 2 事件） | `4` |

### 运行命令

```bash
cd examples/session/eventlimit
export OPENAI_API_KEY="your-api-key"

go run main.go                                 # 默认 inmemory, limit=4
go run main.go -session=redis -limit=6         # 保留最近 3 轮
go run main.go -session=pgvector -limit=10     # pgvector + 大窗口
```

> 脚本会**真实调用模型** 6 次（4 轮建档案 + 2 轮测试），请确保 API Key 有余额。

### 预期输出

```
==================================================
Session Event Limit Demo
==================================================
Backend: inmemory | Event limit: 4

Phase 1: build conversation (will exceed limit)
Event limit: 4 (= 2 conversation turns)

[Turn 1]
│  User: My name is Alice.
│  Assistant: Nice to meet you, Alice!
Events in session: 2

[Turn 2] ... Events in session: 4
[Turn 3] ... Events in session: 4   <- 窗口触发，"Alice"被挤出
[Turn 4] ... Events in session: 4

Phase 2: verify sliding window
│  [DEBUG] Session Events: 4
│    1. user     : I work as a software engineer.
│    2. assistant: That's a cool job! ...
│    3. user     : My favorite color is blue.
│    4. assistant: Nice choice! Blue is calming...
[OK] Event count (4) <= limit (4)

Phase 3: test what the assistant remembers
(Early messages should be forgotten.)

Testing: recent - should remember
│  User: What's my favorite color?
│  Assistant: Your favorite color is blue!

Testing: early - may be forgotten
│  User: What's my name?
│  Assistant: I don't know your name—you haven't told me yet.
```

## 适用场景与对比

**选 eventlimit 当：**
- 单轮上下文很长，担心超出模型 token 上限
- 高并发场景下想控制每会话内存占用
- 需要可预测的、确定性的上下文长度

**对比其它生命周期控制：**

| 维度 | eventlimit | [`ttl`](./session-ttl.md) | [`simple`](./session-simple.md) 的 EventLimit |
|------|------------|---------------------------|------------------------------------------------|
| 控制对象 | 事件条数 | 存活时长 | 事件条数（同样机制） |
| 触发效果 | 滑动窗口，保留最近 | 整体过期清空 | 滑动窗口，保留最近 |
| 形态 | 自动化脚本 | 自动化脚本 | 交互式 |
| 与 ttl | 可叠加 | 可叠加 | 可叠加 |

> 生产建议：`EventLimit` + `TTL` 组合使用——前者控上下文长度，后者控生命周期，互不冲突。

## 关键要点

1. **2 事件 = 1 轮**：`EventLimit` 是事件数而非轮数，配置时记得除以 2。
2. **滑动窗口**：超限后旧事件从头部丢弃，新事件照常追加，并非"拒绝写入"。
3. **后端无关**：所有后端共享同一 `EventLimit` 语义，切换无需改代码。
4. **会遗忘**：被挤出窗口的信息模型再也看不到；长期信息请走 Memory 系统。
5. **可叠加 TTL**：`EventLimit` 管长度、`TTL` 管寿命，两者正交。

## 总结

eventlimit 用一个紧凑的三阶段脚本把"滑动窗口"这件事讲得清清楚楚：上限到了就丢最早的，模型因此会"记近忘远"。它和 [`ttl`](./session-ttl.md) 构成生命周期的双轴控制，再配合 [`hook`](./session-hook.md) 做内容过滤，就能搭建出一个既有上下文约束、又能自动清理、还能审核合规的生产级会话管线。
