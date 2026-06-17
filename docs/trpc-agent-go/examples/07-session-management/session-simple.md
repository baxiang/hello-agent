# Session 基础多轮对话 - 多后端会话管理入门

> **源码路径**：[`trpc-agent-go/examples/session/simple/`](../../../../trpc-agent-go/examples/session/simple)
> **示例类型**：交互式 Chat · **难度**：入门

## 概述

`simple/` 是 Session 系列的主干示例，演示如何把 `runner.Runner` 接上 `session.Service`，实现**跨轮次、跨会话**的上下文管理。它把多会话切换、会话列出、历史回顾、（可选）语义召回等能力整合进一个交互式命令行，是理解整个 Session 模块的最佳起点。

与其它子示例的关系：[`appendevent`](./session-appendevent.md) 教你绕过模型直接写事件；[`eventlimit`](./session-eventlimit.md) / [`ttl`](./session-ttl.md) 聚焦生命周期控制；[`hook`](./session-hook.md) 演示拦截器；[`persona`](./session-persona.md) 用 Session State 存人格；[`graph`](./session-graph.md) 把 LLM Agent 换成图编排。simple 则把"会话基础设施"一次讲透。

## 核心概念

### Runner + SessionService 两行接线

simple 的核心只有两步——创建 Session Service，再把它绑给 Runner：

```go
sessionService, err := util.NewSessionServiceByType(
    sessionType,
    util.SessionServiceConfig{
        EventLimit:    *eventLimit,    // 每会话事件上限
        TTL:           *sessionTTL,    // 会话过期时间
        EnableTracing: *enableTrace,   // 链路追踪（仅 redis 生效）
    },
)

c.runner = runner.NewRunner(
    appName,
    llmAgent,
    runner.WithSessionService(sessionService),  // 关键：绑定会话服务
)
```

Runner 在每次 `Run()` 时自动按 `(appName, userID, sessionID)` 加载历史事件、拼成上下文，再把本轮用户消息和模型响应写回 Session——开发者无需手写"读历史/写新事件"的胶水代码。

### 会话三元组隔离

```go
eventChan, err := c.runner.Run(
    ctx,
    c.userID,      // 用户标识
    c.sessionID,   // 会话标识
    message,
    agent.WithRequestID(requestID),  // 请求追踪 ID
)
```

不同 `sessionID` 各自独立、互不干扰；切换会话只需改 `c.sessionID` 即可，这就是 `/use`、`/new` 命令的本质。

### 9 种后端通过统一工厂切换

`util.NewSessionServiceByType`（见 `session/util.go`）把 9 种后端收敛成一个枚举参数：

| 后端 | 检索增强 | 备注 |
|------|---------|------|
| `inmemory` | — | 开发测试，进程重启丢失 |
| `noop` | — | 空实现，Runner 走流程但不持久化 |
| `sqlite` | — | 本地文件 |
| `redis` | — | **simple 的默认后端**，支持 Langfuse Tracing |
| `postgres` | — | 关系型持久化 |
| `pgvector` | 语义搜索 | 唯一实现 `SearchableService` |
| `mysql` / `tdsql` | — | TDSQL 支持分布式分片 |
| `clickhouse` | — | 列式存储 |

## 代码解析

### 主流程（`simple/main.go`）

示例用 `multiTurnChat` 结构体持有状态，整体流程：`setup()` → `startChat()` → 每行输入走 `processMessage()`。

```go
type multiTurnChat struct {
    modelName      string
    streaming      bool
    runner         runner.Runner
    sessionService session.Service
    searchable     session.SearchableService  // 仅 pgvector 后端非 nil
    userID         string
    sessionID      string
    debugPersisted bool                       // noop 后端为 false
}
```

### 命令分发（`startChat`）

交互命令的语义都落在 `sessionID` 的切换与读取上：

| 命令 | 行为 |
|------|------|
| `/new [id]` | 生成（或指定）新 `sessionID`，相当于"清空上下文" |
| `/use <id>` | 切到已存在/全新会话 |
| `/sessions` | 调 `sessionService.ListSessions` 列出该用户所有会话 |
| `/history` | 把"复述对话"作为普通消息发给 Agent |
| `/search <query>` | 仅当 `c.searchable != nil`（pgvector）可用 |
| `/exit` | 退出 |

### 语义召回（pgvector 专属）

simple 在启动时尝试把 Service 断言为 `session.SearchableService`：

```go
if searchable, ok := sessionService.(session.SearchableService); ok {
    c.searchable = searchable
}
```

`/search` 命令调 `SearchEvents`，按 `MaxResults`（`-search-topk`）返回带相似度分数的事件：

```go
results, err := c.searchable.SearchEvents(ctx, session.EventSearchRequest{
    Query:      query,
    UserKey:    session.UserKey{AppName: appName, UserID: c.userID},
    SessionIDs: []string{c.sessionID},
    MaxResults: *searchTopK,
})
```

### Debug 视图

`-debug`（默认开）会在每轮后调 `util.PrintSessionEvents` 打印当前会话的全部事件，是观察"Agent 到底记住了什么"的关键调试手段。

## 运行方式

### 环境变量

| 变量 | 必需 | 说明 | 默认值 |
|------|------|------|--------|
| `OPENAI_API_KEY` | 是 | 模型 API Key | — |
| `OPENAI_BASE_URL` | 否 | 模型端点 | `https://api.openai.com/v1` |

切换其它后端时还需对应变量：`SQLITE_SESSION_DSN` / `REDIS_ADDR` / `PG_*` / `PGVECTOR_*`（含 `PGVECTOR_EMBEDDER_MODEL`、`OPENAI_EMBEDDING_API_KEY`）/ `MYSQL_*` / `CLICKHOUSE_*`。

### 命令行参数

| 参数 | 说明 | 默认值 |
|------|------|--------|
| `-model` | 模型名 | `MODEL_NAME` 环境变量 |
| `-session` | 后端：`noop`/`inmemory`/`sqlite`/`redis`/`postgres`/`pgvector`/`mysql`/`tdsql`/`clickhouse` | **`redis`** |
| `-streaming` | 流式输出 | `true` |
| `-event-limit` | 每会话事件上限 | `1000` |
| `-session-ttl` | 会话过期时间 | **`300s`（5 分钟）** |
| `-search-topk` | `/search` 返回条数 | `5` |
| `-debug` | 每轮后打印会话事件 | `true` |
| `-enable-trace` | 启用 Langfuse Tracing（仅 redis） | `false` |

> **注意**：源码默认 `-session=redis`，开箱即用需先起 Redis；本地无依赖请显式 `-session inmemory` 或 `-session noop`。

### 运行命令

```bash
cd examples/session/simple
export OPENAI_API_KEY="your-api-key"

go run main.go -session inmemory              # 零依赖本地跑
go run main.go -session sqlite                 # 本地文件持久化
go run main.go -session pgvector               # 解锁 /search 语义召回
go run main.go -session redis -enable-trace    # 启用 Langfuse 观测
```

### 预期输出

```
Session Management Demo
Model: deepseek-v4-flash
Streaming: true
Event Limit: 1000
Session TTL: 5m0s
Session Backend: inmemory
Debug Mode: true
==================================================
Chat ready! Session: session-1718600000

You: Hello! I'm planning a trip to Japan
Assistant: That's exciting! Japan is a wonderful destination...

You: /new
Started new session!
   Previous: session-1718600000
   Current:  session-1718600030
   (Conversation history has been reset)

You: /use session-1718600000
Switched to session session-1718600000

You: What were we talking about?
Assistant: We were discussing your trip to Japan...
```

## 适用场景与对比

**选 simple 当：**
- 想快速验证多会话管理、上下文保留
- 需要在多种存储后端间做对比选型
- 希望有交互式调试视图观察每轮事件

**选其它子示例当：**
- 想绕过模型直接灌历史 → [`appendevent`](./session-appendevent.md)
- 想精确控制上下文长度 → [`eventlimit`](./session-eventlimit.md)
- 想让会话自动过期 → [`ttl`](./session-ttl.md)
- 想做内容审核/消息修复 → [`hook`](./session-hook.md)
- 想每会话独立人格 → [`persona`](./session-persona.md)
- 想用图编排 Agent → [`graph`](./session-graph.md)

| 维度 | simple | eventlimit | ttl | hook |
|------|--------|------------|-----|------|
| 形态 | 交互式 | 自动脚本 | 自动脚本 | 自动脚本 |
| 默认后端 | redis | inmemory | inmemory | inmemory |
| 核心能力 | 多会话切换 | 滑动窗口 | 过期清理 | 拦截过滤 |

## 关键要点

1. **两行接线**：`NewSessionServiceByType` + `runner.WithSessionService` 就能让 Agent 拥有跨轮上下文。
2. **三元组隔离**：`(appName, userID, sessionID)` 是会话的唯一钥匙，切换会话只需换 ID。
3. **后端无关**：9 种后端共用同一接口，pgvector 额外实现 `SearchableService` 提供语义召回。
4. **默认是 redis**：开箱跑需 Redis，本地无依赖请用 `-session inmemory`。
5. **Debug 视图**：`-debug` 让每轮事件可见，是排查"Agent 为什么忘了"的第一工具。

## 总结

simple 是 Session 系列的"地图"：它把会话创建、切换、列出、历史回顾、语义召回一次性铺开。理解了 simple 的 `Runner + SessionService` 接线和三元组隔离，再看 [`appendevent`](./session-appendevent.md) 的事件直写、[`hook`](./session-hook.md) 的拦截链、[`persona`](./session-persona.md) 的状态存储，都会发现它们只是在这同一套基础设施上换了一种用法。
