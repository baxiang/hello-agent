# Session 会话管理 — 源码·实战·原理

Session 管理单个对话的上下文。本文深入 7 种存储后端设计、Hook 链执行、TTL 刷新策略、会话摘要的触发与生成。

## 1. 概念概述

### 1.1 Session 结构

```go
// session/session.go
type Session struct {
    ID        string                 // 会话 ID
    AppName   string                 // 应用名（多租户隔离）
    UserID    string                 // 用户 ID
    State     StateMap               // 键值状态
    Events    []event.Event          // 消息历史
    Tracks    map[Track]*TrackEvents // AG-UI track 事件
    Summaries map[string]*Summary    // 按 filterKey 的摘要
    UpdatedAt time.Time
    CreatedAt time.Time
}

type Key struct {
    AppName   string
    UserID    string
    SessionID string
}

type StateMap map[string][]byte // 状态值统一用 []byte，避免类型耦合
```

**为什么 StateMap 是 `map[string][]byte` 而非 `map[string]any`？**
- `[]byte` 可序列化到任何后端，不受 Go 具体类型限制
- 避免 JSON 反序列化时的类型丢失（如 int vs float64）
- Serializable + 跨语言兼容

### 1.2 Service 接口

```go
type Service interface {
    CreateSession(ctx, key, state, opts...) (*Session, error)
    GetSession(ctx, key, opts...) (*Session, error)
    ListSessions(ctx, userKey, opts...) ([]*Session, error)
    DeleteSession(ctx, key, opts...) error
    UpdateAppState(ctx, appName, state) error
    UpdateUserState(ctx, userKey, state) error
    UpdateSessionState(ctx, key, state) error
    AppendEvent(ctx, session, event, opts...) error
    CreateSessionSummary(ctx, sess, filterKey, force) error
    EnqueueSummaryJob(ctx, sess, filterKey, force) error
    GetSessionSummaryText(ctx, sess, opts...) (string, bool)
    Close() error
}
```

---

## 2. 存储后端深度对比

### 2.1 后端特性矩阵

| 特性 | Memory | SQLite | Redis | PostgreSQL | MySQL | ClickHouse |
|------|:---:|:---:|:---:|:---:|:---:|:---:|
| **持久化** | ❌ | ✅ | ✅ | ✅ | ✅ | ✅ |
| **分布式** | ❌ | ❌ | ✅ | ✅ | ✅ | ✅ |
| **TTL 原生** | ❌ | ❌ | ✅ (key expiry) | ❌ | ❌ | ✅ (TTL engine) |
| **复杂查询** | ❌ | ✅ | ❌ | ✅ | ✅ | ✅ |
| **语义召回** | ❌ | ❌ | ❌ | ✅(PGVector) | ❌ | ❌ |
| **软删除** | ❌ | ✅ | ❌ | ✅ | ✅ | ❌ |
| **事件分页** | ❌ | ❌ | ❌ | ✅ | ✅ | ❌ |
| **TrackService** | ✅ | ✅ | ✅ | ✅ | ✅ | ❌ |
| **单表部署** | — | ✅ | ✅ | ✅ | ✅ | 集群 |

### 2.2 TTL 实现差异

| 后端 | 实现机制 | 刷新时机 | 清理 |
|------|---------|---------|------|
| Memory | goroutine 定时扫描 | 写操作 | 扫描+访问时检查 |
| SQLite | goroutine 定时扫描 | 写操作 | 定时 DELETE |
| Redis | `EXPIRE` 命令 | 写操作 | Redis 原生惰性+定期 |
| PostgreSQL | goroutine 定时扫描 | 写操作 | 定时 DELETE（支持软删除） |
| MySQL | goroutine 定时扫描 | 写操作 | 定时 DELETE（支持软删除） |
| ClickHouse | 应用层 TTL 标记 | 写操作 | 原生 TTL + 合并引擎 |

**关键规则**：TTL 仅在**写操作**时刷新（CreateSession/AppendEvent/UpdateSessionState）。读操作不刷新——防止频繁读取导致永不清理。

### 2.3 后端选择决策树

```
需要持久化？
├── 否 → Memory（开发/测试）
└── 是
    ├── 单机部署？
    │   └── 是 → SQLite（最简单的持久化方案）
    └── 分布式部署？
        ├── 已有 Redis → Redis（最简单，无复杂查询）
        ├── 需要语义召回 → PGVector
        ├── 海量日志分析 → ClickHouse
        └── 通用生产 → PostgreSQL / MySQL
```

---

## 3. 源码走读：Hook 链执行

### 3.1 AppendEventHook 链

```go
// session/hook.go
type AppendEventContext struct {
    Context context.Context
    Session *Session
    Event   *event.Event
    Key     Key
}

type AppendEventHook func(ctx *AppendEventContext, next func() error) error
```

执行流程：

```go
func (s *sessionService) AppendEvent(ctx context.Context, sess *Session, evt *event.Event, opts ...Option) error {
    // Hook 链执行（洋葱模型）
    hookCtx := &AppendEventContext{Context: ctx, Session: sess, Event: evt, Key: key}
    return s.executeAppendHooks(hookCtx, 0)
}

func (s *sessionService) executeAppendHooks(ctx *AppendEventContext, index int) error {
    if index >= len(s.appendHooks) {
        return s.doAppendEvent(ctx) // 最后一个 hook 之后执行实际写入
    }
    return s.appendHooks[index](ctx, func() error {
        return s.executeAppendHooks(ctx, index+1)
    })
}
```

**洋葱模型**：每个 Hook 通过 `next()` 调用下一个 Hook 或实际写入。可以在调用前修改 Event，在调用后检查结果。

### 3.2 GetSessionHook 链

```go
type GetSessionContext struct {
    Context context.Context
    Key     Key
    Options *Options
}

type GetSessionHook func(ctx *GetSessionContext, next func() (*Session, error)) (*Session, error)

// 使用示例：过滤敏感事件
sessionService := inmemory.NewSessionService(
    inmemory.WithGetSessionHook(func(ctx *session.GetSessionContext, next func() (*session.Session, error)) (*session.Session, error) {
        sess, err := next()
        if err != nil { return nil, err }
        // 过滤标记为 internal 的事件
        sess.Events = lo.Filter(sess.Events, func(e event.Event, _ int) bool {
            return e.Tag != "internal"
        })
        return sess, nil
    }),
)
```

---

## 4. 会话摘要机制

### 4.1 触发条件

```go
summarizer := summary.NewSummarizer(llm,
    summary.WithChecksAny(           // 任一条件满足即触发
        summary.CheckEventThreshold(20),       // 事件数超 20
        summary.CheckTokenThreshold(4000),     // Token 数超 4000
        summary.CheckTimeThreshold(5*time.Minute), // 最新未摘要事件超过 5 分钟
    ),
    summary.WithMaxSummaryWords(200),
)
```

**为什么要多种 Check**：
- EventThreshold：控制存储压力
- TokenThreshold：控制上下文窗口占用
- TimeThreshold：确保摘要不过于陈旧

### 4.2 异步摘要流程

```
Runner.Run 完成
  │
  ├─ 检查是否需要摘要（通过 Check 条件）
  ├─ 是 → EnqueueSummaryJob(session, filterKey, force=false)
  │         │
  │         ▼
  │      SummaryQueue (channel)
  │         │
  │         ▼
  │      Worker goroutine
  │         ├─ 提取未摘要的 Events
  │         ├─ 调用 LLM：总结 events → 文本摘要
  │         ├─ 存储到 Session.Summaries[filterKey]
  │         └─ 标记已摘要 event 的 boundary
  │
  └─ 否 → 跳过
```

### 4.3 摘要文本的使用

在下次 LLM 调用时，摘要会自动插入 system message：

```
System: You are a helpful assistant.
System: [Previous conversation summary]: User asked about travel plans to Paris...
User: What's the weather there?
```

通过在 LLMAgent 中启用：
```go
agent := llmagent.New("assistant",
    llmagent.WithAddSessionSummary(true),
)
```

---

## 5. 实战

### 5.1 PostgreSQL 生产配置

```go
import "trpc.group/trpc-go/trpc-agent-go/session/postgres"

sessionService, _ := postgres.NewService(
    postgres.WithPostgresClientDSN(
        "postgres://user:pass@localhost:5432/agents?sslmode=disable",
    ),
    postgres.WithTablePrefix("agent_"),          // 表名前缀
    postgres.WithSessionEventLimit(1000),
    postgres.WithSessionTTL(24*time.Hour),
    postgres.WithSoftDelete(true),               // 软删除便于恢复
)
```

### 5.2 PGVector 语义召回

```go
import "trpc.group/trpc-go/trpc-agent-go/session/pgvector"

sessionService, _ := pgvector.NewService(
    pgvector.WithPostgresClientDSN("postgres://..."),
    pgvector.WithEmbedder(embedder),
)

// 跨会话搜索
searchSvc := sessionService.(session.SearchableService)
hits, _ := searchSvc.SearchEvents(ctx, session.EventSearchRequest{
    Query:      "travel plan to Paris next summer",
    UserKey:    session.UserKey{AppName: "travel-app", UserID: "user-1"},
    SessionIDs: []string{"session-1", "session-2"}, // nil = 所有会话
    SearchMode: session.SearchModeHybrid,            // 语义 + 关键词
    MaxResults: 10,
    MinScore:   0.6,
})

// 预加载跨会话信息到 LLM prompt
agent := llmagent.New("assistant",
    llmagent.WithPreloadSessionRecall(true),
    llmagent.WithPreloadSessionRecallLimit(5),
)
```

### 5.3 直接操作 Session API

```go
// 预先注入消息
sess, _ := sessionService.CreateSession(ctx, key, nil)
evt := event.NewResponseEvent(invID, "system", &model.Response{
    Choices: []model.Choice{{Message: model.NewSystemMessage("Context: user is premium.")}},
})
sessionService.AppendEvent(ctx, sess, evt)

// 之后用 Runner.Run — 自动加载历史
events, _ := r.Run(ctx, userID, sessionID, userMsg)
```

---

## 6. 设计原理

### 6.1 为什么 EventList 不使用 Append-Only 日志？

传统 session 管理可能选择 append-only 日志（如 Kafka 分区），但 Agent 场景有特殊需求：

1. **频繁读取完整历史**：每次 LLM 调用都需要加载全部消息
2. **TTL 淘汰**：需要删除旧事件而非标记
3. **摘要压缩**：需要将旧事件替换为摘要

因此选择了"事件数组 + 写入时裁剪"模式，用 SQL/Redis/ClickHouse 的不同方式实现持久化。

### 6.2 Track 事件与普通 Event 的分离

Track 事件（`TrackService`）独立于主事件流，专用于 AG-UI 场景——它记录了用户交互事件（点击、滚动），不应出现在 LLM 上下文中。

### 6.3 StateMap 的 `[]byte` 设计

使用 `[]byte` 而非结构化对象的原因：
- 跨后端兼容（Redis 存储 bytes，SQL 存储 TEXT/BLOB）
- 避免 JSON 反序列化时的类型失真
- 调用方自行序列化/反序列化，框架不假设数据格式
