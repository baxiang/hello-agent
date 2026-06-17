# Session 管理 - 多轮对话与会话生命周期控制

## 概述

Session 管理是 AI Agent 实现多轮对话的基础设施。trpc-agent-go 的 Session 系统提供了完整的会话生命周期管理能力，包括会话创建与切换、事件数量限制（滑动窗口）、TTL 过期机制、Hook 拦截器、状态存储（Persona 等场景）、直接事件追加，以及与 Graph Agent 的集成。框架支持 9 种存储后端，覆盖从开发到分布式生产环境的全场景。

## 核心概念

### Session 的结构

一个 Session 由以下核心要素组成：

- **Key**：由 `AppName + UserID + SessionID` 三元组唯一标识
- **Events**：有序的事件列表，每个事件包含用户消息或 Agent 响应
- **State**：键值对状态存储，可保存自定义业务数据（如 Persona）
- **TTL**：可选的生存时间，过期后会话自动清除

### 存储后端

通过 `-session` 参数切换后端：

| 后端 | 特点 | 适用场景 |
|------|------|---------|
| `inmemory` | 内存存储，进程重启丢失 | 开发测试 |
| `noop` | 空实现，不持久化 | 无状态场景 |
| `sqlite` | 本地文件存储 | 单机部署 |
| `redis` | 支持 Tracing | 高并发生产环境 |
| `postgres` / `pgvector` | pgvector 支持语义搜索 | 需要事件召回的场景 |
| `mysql` / `tdsql` | TDSQL 支持分布式分片 | 腾讯云生态 |
| `clickhouse` | 列式存储 | 分析型场景 |

### Hook 机制

Session 系统提供两类 Hook，可在事件写入和会话读取时注入自定义逻辑：

- **AppendEventHook**：事件写入时触发，可修改、标记或拦截事件
- **GetSessionHook**：会话读取时触发，可过滤、变换事件列表

## 代码解析

### 基础多轮对话（simple/main.go）

simple 示例展示了 Session 管理的核心用法：创建 Runner、运行多轮对话、切换和列出会话。

**创建 Session Service 和 Runner**

```go
sessionService, err := util.NewSessionServiceByType(
    sessionType,
    util.SessionServiceConfig{
        EventLimit:    *eventLimit,    // 事件数量上限
        TTL:           *sessionTTL,    // 会话过期时间
        EnableTracing: *enableTrace,   // 启用链路追踪
    },
)

c.runner = runner.NewRunner(
    appName,
    llmAgent,
    runner.WithSessionService(sessionService),  // 绑定 Session 服务
)
```

**执行对话**

Runner 自动管理会话上下文，通过 `userID` 和 `sessionID` 隔离不同用户和会话：

```go
eventChan, err := c.runner.Run(
    ctx,
    c.userID,      // 用户标识
    c.sessionID,   // 会话标识
    message,
    agent.WithRequestID(requestID),  // 请求追踪 ID
)
```

**语义搜索（pgvector 后端）**

pgvector 后端实现了 `SearchableService` 接口，支持语义事件召回：

```go
if searchable, ok := sessionService.(session.SearchableService); ok {
    results, err := searchable.SearchEvents(ctx, session.EventSearchRequest{
        Query:      query,
        UserKey:    session.UserKey{AppName: appName, UserID: c.userID},
        SessionIDs: []string{c.sessionID},
        MaxResults: *searchTopK,
    })
}
```

### 事件数量限制（eventlimit/main.go）

EventLimit 实现滑动窗口机制，当事件数量超过上限时，自动丢弃最早的事件。

```go
sessionService, err := util.NewSessionServiceByType(
    util.SessionType(*sessionType),
    util.SessionServiceConfig{EventLimit: *eventLimit},  // 如设置为 4
)
```

一次对话产生 2 个事件（用户消息 + Agent 响应），`EventLimit=4` 意味着只保留最近 2 轮对话。示例通过发送 4 条消息后验证滑动窗口行为：

```go
// 发送 4 条消息后，只有最近 2 轮被保留
sess, err := sessionService.GetSession(ctx, key)
// len(sess.Events) <= eventLimit
```

Agent 能记住最近的消息（如"最喜欢的颜色是蓝色"），但更早的消息（如"我叫 Alice"）会被遗忘。

### TTL 过期机制（ttl/main.go）

TTL 控制会话的生存时间，过期后会话数据被自动清除。

```go
sessionService, err := util.NewSessionServiceByType(
    util.SessionType(*sessionType),
    util.SessionServiceConfig{
        EventLimit: 100,
        TTL:        ttl,    // 如 10 秒
    },
)
```

示例分三阶段验证：

1. **建立对话**：发送多条消息，验证会话和事件存在
2. **等待过期**：等待 TTL + 2 秒，验证 `GetSession` 返回 `nil`
3. **重新对话**：过期后发送消息，创建全新会话，Agent 不再记得之前的信息

### Hook 系统（hook/main.go + hooks.go）

Hook 示例展示了两个实用场景：内容过滤和连续用户消息处理。

**内容违规标记（AppendEventHook）**

在事件写入时检测违禁词并打标签：

```go
func MarkViolationHook() session.AppendEventHook {
    return func(ctx *session.AppendEventContext, next func() error) error {
        content := getEventContent(ctx.Event)
        if word := containsProhibitedWord(content); word != "" {
            ctx.Event.Tag = appendTags(ctx.Event.Tag, ViolationTagPrefix+word)
        }
        return next()  // 调用 next() 继续写入链
    }
}
```

**违规内容过滤（GetSessionHook）**

在会话读取时，将被标记的事件及其配对问答一起过滤掉，防止违规内容进入 LLM 上下文：

```go
func FilterViolationHook() session.GetSessionHook {
    return func(ctx *session.GetSessionContext, next func() (*session.Session, error)) (*session.Session, error) {
        sess, err := next()
        filterViolationEvents(sess)  // 移除违规事件和配对的问答
        return sess, nil
    }
}
```

**连续用户消息处理**

提供三种策略处理用户连续发送多条消息（无 Assistant 响应间隔）的情况：

- `merge` - 合并连续消息为一条
- `placeholder` - 插入占位 Assistant 响应
- `skip` - 只保留最后一条用户消息

### Session 状态与 Persona（persona/main.go）

Persona 示例展示如何利用 Session State 实现每会话独立人格：

**存储 Persona 到 Session State**

```go
err := d.sessionService.UpdateSessionState(ctx, key, session.StateMap{
    personaStateKey: []byte(persona),
})
```

**每次请求动态注入 Persona**

```go
persona, _ := d.currentPersona(ctx)
eventChan, err := d.runner.Run(
    ctx, d.userID, d.sessionID,
    model.NewUserMessage(userInput),
    agent.WithGlobalInstruction(buildPersonaInstruction(persona)),
)
```

通过 `agent.WithGlobalInstruction` 在运行时覆盖系统提示词，每个会话可以拥有不同的 AI 人格（如"严格的代码审查员"、"友善的 Go 导师"等）。

### 直接追加事件（appendevent/main.go）

AppendEvent 示例展示如何不经过模型调用，直接向 Session 写入事件：

```go
invocationID := uuid.New().String()
evt := event.NewResponseEvent(
    invocationID,   // 唯一调用标识
    author,         // 事件作者："user"/"system"/agent 名
    &model.Response{
        Done: false,
        Choices: []model.Choice{
            {Index: 0, Message: message},
        },
    },
)
err := c.sessionSvc.AppendEvent(ctx, sess, evt)
```

典型应用场景包括：预加载历史对话、注入系统上下文、记录用户操作元数据等。

### Graph Agent 集成（graph/main.go）

graph 示例展示了 Graph Agent 如何与 Session 协作。Graph Agent 通过 StateGraph 定义多步处理流程，最终状态快照存储在 Session State 中：

```go
sg := graph.NewStateGraph(schema)
sg.AddNode("normalize", normalizeInput)    // 输入规范化
sg.AddNode("answer", draftAnswer)          // 生成草稿
sg.AddAgentNode("assistant", ...)          // LLM 子 Agent
sg.AddNode("collect", collectAnswer)       // 收集最终结果
```

Graph 的执行状态（如 `business_result`、`agent_reply` 等）通过 `session.State` 跨轮次持久化。

## 运行方式

### 环境准备

```bash
export OPENAI_API_KEY="your-api-key"
```

### 运行各示例

```bash
# 基础多轮对话
cd examples/session/simple
go run main.go -session=inmemory

# 事件数量限制
cd examples/session/eventlimit
go run main.go -limit=4 -session=redis

# TTL 过期
cd examples/session/ttl
go run main.go -ttl=10 -session=inmemory

# Hook 系统
cd examples/session/hook
go run . -session=redis -consecutive=merge

# Persona 人格
cd examples/session/persona
go run main.go -session=inmemory

# 直接追加事件
cd examples/session/appendevent
go run main.go

# Graph Agent 集成
cd examples/session/graph
go run ./graph -debug
```

### 预期输出示例（eventlimit）

```
Phase 1: build conversation (will exceed limit)
Event limit: 4 (= 2 conversation turns)

[Turn 1] User: My name is Alice.
         Assistant: Nice to meet you, Alice!
         Events in session: 2

[Turn 3] ...
         Events in session: 4   <- 达到上限

Phase 2: verify sliding window
[OK] Event count (4) <= limit (4)

Phase 3: test what the assistant remembers
Testing: recent - should remember
   User: What's my favorite color?
   Assistant: Your favorite color is blue.
Testing: early - may be forgotten
   User: What's my name?
   Assistant: I don't have that information.  <- 早期消息已被丢弃
```

## 总结

Session 管理系统的核心设计要点：

1. **生命周期完整**：覆盖创建、读写、切换、过期、清理的全生命周期
2. **滑动窗口**：EventLimit 机制防止会话无限膨胀，自动保留最近事件
3. **Hook 拦截器**：AppendEventHook 和 GetSessionHook 提供写入时标记和读取时过滤的双重拦截能力，适用于内容审核、消息修复等场景
4. **状态存储**：Session State 支持任意键值对，可实现 Persona、业务状态等自定义数据持久化
5. **多后端统一**：9 种后端通过统一接口切换，pgvector 额外支持语义搜索

Session 系统是 Memory 系统（`memory/` 示例）的底层依赖：每次 Runner 运行时，都通过 Session Service 加载历史事件构建上下文。两者结合使用时，Session 管理短期对话上下文，Memory 管理长期用户信息。
