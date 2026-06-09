# Session 与 Memory 详解

Session 和 Memory 是 tRPC-Agent-Go 的两层状态管理机制。Session 管理单个对话的上下文，Memory 管理跨对话的长期用户信息。

---

## 一、Session 会话管理

### 1. 定位

Session 管理当前对话的上下文，隔离维度为 `<appName, userID, sessionID>`。存储用户消息、Agent 回复、工具调用结果及会话摘要。

### 2. Session 结构

```go
type Session struct {
    ID        string                   // 会话 ID
    AppName   string                   // 应用名
    UserID    string                   // 用户 ID
    State     StateMap                 // 会话状态（键值对）
    Events    []event.Event            // 事件列表
    Summaries map[string]*Summary      // 摘要映射
    UpdatedAt time.Time
    CreatedAt time.Time
}

type Key struct {
    AppName   string
    UserID    string
    SessionID string
}
```

### 3. Session Service 接口

```go
type Service interface {
    CreateSession(ctx, key, state, opts...) (*Session, error)
    GetSession(ctx, key, opts...) (*Session, error)
    ListSessions(ctx, userKey, opts...) ([]*Session, error)
    DeleteSession(ctx, key, opts...) error

    // 状态管理
    UpdateAppState(ctx, appName, state) error
    UpdateUserState(ctx, userKey, state) error
    UpdateSessionState(ctx, key, state) error

    // 事件管理
    AppendEvent(ctx, session, event, opts...) error

    // 摘要
    CreateSessionSummary(ctx, sess, filterKey, force) error
    EnqueueSummaryJob(ctx, sess, filterKey, force) error
    GetSessionSummaryText(ctx, sess, opts...) (string, bool)

    Close() error
}
```

### 4. 存储后端对比

| 存储 | 场景 | 持久化 | 分布式 | 复杂查询 | 语义召回 |
|------|------|:---:|:---:|:---:|:---:|
| **Memory** | 开发/测试 | ❌ | ❌ | ❌ | ❌ |
| **SQLite** | 本地持久化 | ✅ | ❌ | ✅ | ❌ |
| **Redis** | 生产分布式 | ✅ | ✅ | ❌ | ❌ |
| **PostgreSQL** | 生产复杂查询 | ✅ | ✅ | ✅ | ❌ |
| **PGVector** | 语义召回 | ✅ | ✅ | ✅ | ✅ |
| **MySQL** | 生产复杂查询 | ✅ | ✅ | ✅ | ❌ |
| **ClickHouse** | 海量数据 | ✅ | ✅ | ✅ | ❌ |

### 5. 集成示例

```go
import "trpc.group/trpc-go/trpc-agent-go/session/inmemory"

sessionService := inmemory.NewSessionService(
    inmemory.WithSessionEventLimit(500),
    inmemory.WithSessionTTL(30*time.Minute),
    inmemory.WithAppStateTTL(24*time.Hour),
    inmemory.WithUserStateTTL(7*24*time.Hour),
)

r := runner.NewRunner("my-app", agent,
    runner.WithSessionService(sessionService),
)
```

### 6. 会话摘要

自动压缩长对话历史，减少 Token 消耗：

```go
import "trpc.group/trpc-go/trpc-agent-go/session/summary"

summarizer := summary.NewSummarizer(llm,
    summary.WithChecksAny(
        summary.CheckEventThreshold(20),       // 超过 20 个事件
        summary.CheckTokenThreshold(4000),     // 超过 4000 token
        summary.CheckTimeThreshold(5*time.Minute),
    ),
    summary.WithMaxSummaryWords(200),
)

sessionService := inmemory.NewSessionService(
    inmemory.WithSummarizer(summarizer),
    inmemory.WithAsyncSummaryNum(2),
    inmemory.WithSummaryQueueSize(100),
)
```

摘要通过 `WithAddSessionSummary(true)` 在 LLMAgent 中启用。

### 7. TTL 管理

| TTL 类型 | 说明 | 示例 |
|----------|------|------|
| `SessionTTL` | 会话级过期 | `30*time.Minute` |
| `AppStateTTL` | 应用状态过期 | `24*time.Hour` |
| `UserStateTTL` | 用户状态过期 | `7*24*time.Hour` |

TTL 仅在**写操作**时刷新，读操作不刷新。

### 8. Hook 机制

```go
sessionService := inmemory.NewSessionService(
    // 写入前拦截
    inmemory.WithAppendEventHook(func(ctx *session.AppendEventContext, next func() error) error {
        if containsSensitiveContent(ctx.Event) {
            return fmt.Errorf("sensitive content detected")
        }
        return next()
    }),
    // 读取后过滤
    inmemory.WithGetSessionHook(func(ctx *session.GetSessionContext, next func() (*session.Session, error)) (*session.Session, error) {
        sess, _ := next()
        sess.Events = filterEvents(sess.Events)
        return sess, nil
    }),
)
```

所有存储后端统一支持 Hook，通过 `next()` 形成责任链。

### 9. 高级操作

```go
// 列出会话
sessions, _ := sessionService.ListSessions(ctx, session.UserKey{...})

// 仅元数据（不加载 Events）
sessions, _ := sessionService.ListSessions(ctx, userKey, session.WithListSessionOnlyMeta())

// 分页（offset >= 0，limit == 0 表示不限）
sessions, _ := sessionService.ListSessions(ctx, userKey, session.WithListSessionPage(20, 20))

// 按最近 N 个事件获取
sess, _ := sessionService.GetSession(ctx, key, session.WithEventNum(10))

// 按时间过滤事件
sess, _ := sessionService.GetSession(ctx, key, session.WithEventTime(time.Now().Add(-1*time.Hour)))
```

### 10. 语义召回（PGVector）

```go
searchSvc, ok := sessionService.(session.SearchableService)
if ok {
    hits, _ := searchSvc.SearchEvents(ctx, session.EventSearchRequest{
        Query:      "travel plan",
        UserKey:    session.UserKey{AppName: "my-agent", UserID: "user123"},
        SearchMode: session.SearchModeHybrid,
        MaxResults: 5,
    })
}

// LLMAgent 中预加载跨会话召回
agent := llmagent.New("assistant",
    llmagent.WithPreloadSessionRecall(...),
)
```

---

## 二、Memory 长期记忆

### 1. 定位

Memory 管理跨对话的用户信息，隔离维度为 `<appName, userID>`。可理解为围绕单一用户逐步积累的"个人档案"。适合记录"用户名是 John"、"偏好简洁回答"等稳定的、可复用的事实。

### 2. 两种模式对比

| 维度 | Agentic 模式（Tools） | Auto 模式（Extractor，推荐） |
|------|---------------------|---------------------------|
| **工作方式** | Agent 决定何时调用 memory 工具 | 系统自动从对话中提取记忆 |
| **用户体验** | 可见 — 用户看到工具调用 | 透明 — 后台静默创建 |
| **控制权** | Agent 完全控制 | Extractor 基于对话分析决定 |
| **默认工具** | add/update/search/load | search 暴露；load 启用后暴露 |
| **处理方式** | 同步 — 响应生成期间 | 异步 — 后台 Worker 处理 |
| **适用场景** | 精确控制记忆内容 | 自然对话、无感记忆构建 |

### 3. Agentic 模式配置

```go
import memoryinmemory "trpc.group/trpc-go/trpc-agent-go/memory/inmemory"

memoryService := memoryinmemory.NewMemoryService()

agent := llmagent.New("memory-assistant",
    llmagent.WithTools(memoryService.Tools()), // 暴露 add/update/search/load
)

r := runner.NewRunner("app", agent,
    runner.WithMemoryService(memoryService),
)
```

### 4. Auto 模式配置（推荐）

```go
import (
    "trpc.group/trpc-go/trpc-agent-go/memory/extractor"
    memoryinmemory "trpc.group/trpc-go/trpc-agent-go/memory/inmemory"
)

extractorModel := openai.New("deepseek-v4-flash")
memExtractor := extractor.NewExtractor(extractorModel)

memoryService := memoryinmemory.NewMemoryService(
    memoryinmemory.WithExtractor(memExtractor),              // 关键：启用 Extract
    memoryinmemory.WithAsyncMemoryNum(1),                    // 异步 Worker 数
    memoryinmemory.WithMemoryQueueSize(10),                  // 队列大小
    memoryinmemory.WithMemoryJobTimeout(30*time.Second),     // 提取任务超时
    // 暴露部分写工具给 Agent（混合模式）
    memoryinmemory.WithAutoMemoryExposedTools(memory.AddToolName),
)
defer memoryService.Close()
```

### 5. 6 种记忆工具

| 工具 | Agentic 默认 | Auto 默认 | 说明 |
|------|:---:|:---:|------|
| `memory_add` | ✅ 暴露 | ✅ 启用（Extractor），❌ 不暴露 | 新增记忆 |
| `memory_update` | ✅ 暴露 | ✅ 启用，❌ 不暴露 | 更新记忆 |
| `memory_search` | ✅ 暴露 | ✅ 启用 + 暴露 | 搜索记忆 |
| `memory_load` | ✅ 暴露 | ❌ 默认禁用 | 加载最近记忆 |
| `memory_delete` | ❌ 可配置 | ✅ 启用，❌ 不暴露 | 删除单条 |
| `memory_clear` | ❌ 可配置 | ❌ 禁用 | 清空全部 |

**工具控制 API**：

```go
// 启用/禁用工具操作
memoryService := memoryinmemory.NewMemoryService(
    memoryinmemory.WithToolEnabled(memory.DeleteToolName, true),
)

// Auto 模式暴露写工具给 Agent
memoryService := memoryinmemory.NewMemoryService(
    memoryinmemory.WithExtractor(memExtractor),
    memoryinmemory.WithAutoMemoryExposedTools(memory.AddToolName),
)
```

### 6. 提取检查器

```go
import "trpc.group/trpc-go/trpc-agent-go/memory/extractor"

ext := extractor.NewExtractor(model,
    extractor.WithChecks(
        extractor.CheckUserMessageOnly(),         // 仅在 user 消息时提取
        extractor.CheckTurnCount(3),              // 每 3 轮提取一次
        extractor.CheckNoToolCallInProgress(),    // 无工具调用时提取
    ),
)
```

### 7. 存储后端

| 后端 | 说明 | 向量搜索 |
|------|------|:---:|
| `inmemory` | 开发测试 | ❌ |
| `redis` | 生产环境 | ❌ |
| `mysql` | 关系型 | ❌ |
| `postgres` | 关系型 | ❌ |
| `pgvector` | PostgreSQL + 向量 | ✅ |
| `sqlitevec` | SQLite + 向量 | ✅ |
| `mysqlvec` | MySQL + 向量 | ✅ |
| `mem0` | 外部长期记忆集成 | ✅ |
| `tencentdb` | 腾讯云 Agent Memory | ✅ |

### 8. 记忆预加载

```go
agent := llmagent.New("memory-assistant",
    llmagent.WithModel(modelInstance),
    llmagent.WithTools(memoryService.Tools()),
    llmagent.WithMemoryPreload(true),             // 启用预加载
    llmagent.WithMemoryPreloadLimit(10),          // 最多 10 条
    llmagent.WithMemoryPreloadQuery("preferences"), // 查询关键字
)
```

### 9. 自定义工具

```go
func customClearMemoryTool() tool.Tool {
    clearFunc := func(ctx context.Context, _ *toolmemory.ClearMemoryRequest) (*toolmemory.ClearMemoryResponse, error) {
        memSvc, _ := toolmemory.GetMemoryServiceFromContext(ctx)
        appName, userID, _ := toolmemory.GetAppAndUserFromContext(ctx)
        memSvc.ClearMemories(ctx, memory.UserKey{AppName: appName, UserID: userID})
        return &toolmemory.ClearMemoryResponse{Message: "All memories cleared!"}, nil
    }
    return function.NewFunctionTool(clearFunc,
        function.WithName(memory.ClearToolName),
        function.WithDescription("Clear all memories for the user."),
    )
}

memoryService := memoryinmemory.NewMemoryService(
    memoryinmemory.WithCustomTool(memory.ClearToolName, customClearMemoryTool),
)
```

### 10. Memory vs Session

| | Memory | Session |
|----|----|----|
| **维度** | `<appName, userID>` | `<appName, userID, sessionID>` |
| **时效** | 长期持久 | 单次对话 |
| **内容** | 用户画像、偏好、事实 | 消息历史、工具调用记录 |
| **典型数据** | "John 是后端工程师"、"喜欢简洁回答" | "用户问了天气，Agent 调用了 API" |
| **搜索** | 关键词 + 向量（可选） | 语义召回（PGVector） |
