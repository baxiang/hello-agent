# Session 钩子 - 内容过滤与连续消息修复

> **源码路径**：[`trpc-agent-go/examples/session/hook/`](../../../../trpc-agent-go/examples/session/hook)
> **示例类型**：自动化脚本（非交互） · **难度**：进阶

## 概述

`hook/` 演示 Session 系统的两类拦截器——`AppendEventHook`（写入时）和 `GetSessionHook`（读取时），把它们用在两个高频生产场景：**违规内容过滤**和**连续用户消息修复**。示例是一个自动跑完 6 步的脚本，能在控制台清晰看到"标记 → 过滤 → 修复"整条拦截链。

与 [`simple`](./session-simple.md) 的区别：simple 只用基础读写 API；hook 则打开 Session 的"中间件"机制，让你在不改业务代码的前提下插入审核、清洗、变换逻辑——思想与 Web 中间件完全一致。

## 核心概念

### 两类 Hook 的执行时机

```go
type AppendEventHook func(ctx *AppendEventContext, next func() error) error
type GetSessionHook   func(ctx *GetSessionContext,   next func() (*Session, error)) (*Session, error)
```

| Hook | 触发点 | 典型用途 | 是否改持久化数据 |
|------|--------|---------|------------------|
| `AppendEventHook` | `AppendEvent()` 写入时 | 打标签、审核、拒绝写入 | 是（修改 `ctx.Event`） |
| `GetSessionHook` | `GetSession()` 读取时 | 过滤、变换、临时修复 | 否（只改内存副本） |

两者都是"洋葱模型"——调 `next()` 前是"前置"、`next()` 后是"后置"，可多 hook 串联。

### Tag 机制：写入打标、读取过滤

违规检测采用"先标记、后过滤"两阶段：

- **写入时**（`MarkViolationHook`）：检测到违禁词就给 `evt.Tag` 追加 `violation=<word>`
- **读取时**（`FilterViolationHook`）：扫描 Tag，把违规事件**及其配对问答**一起剔除

这种"延迟过滤"保留了审计痕迹（违规内容仍在磁盘上），又保证模型上下文干净。

### 连续用户消息修复（读取时修复）

当用户消息之间没有 assistant 响应时（断线、重试、快速连发），会破坏 LLM 的"用户-助手"交替预期。`FixConsecutiveUserMessagesHook` 在**读取时**用三种策略之一就地修复，**不改持久化数据**：

| 策略 | 行为 |
|------|------|
| `merge` | 把连续 user 消息合并成一条（用 `\n` 连接） |
| `placeholder` | 在两条 user 消息之间插入占位 assistant 响应 |
| `skip` | 只保留最后一条 user 消息，丢弃前面的 |

> 选 `GetSessionHook` 而非 `AppendEventHook` 修复连续消息：无需访问 sessionService、无递归风险、存储保持原样、只在送入 LLM 前临时修正。

## 代码解析

### Hook 注册（`main.go`）

示例把多个 hook 组装成两个切片，再传给 `SessionServiceConfig`：

```go
appendHooks := []session.AppendEventHook{MarkViolationHook()}
getHooks := []session.GetSessionHook{FilterViolationHook()}
if *consecutiveHandler != "" {
    getHooks = append(getHooks, FixConsecutiveUserMessagesHook(*consecutiveHandler))
}

sessionService, err := util.NewSessionServiceByType(
    util.SessionType(*sessionType),
    util.SessionServiceConfig{
        AppendEventHooks: appendHooks,
        GetSessionHooks:  getHooks,
    },
)
```

`util.NewSessionServiceByType` 会把这两个切片原样下发给所选后端，所有后端共享同一套 hook 链。

### 违规标记（`hooks.go`）

```go
func MarkViolationHook() session.AppendEventHook {
    return func(ctx *session.AppendEventContext, next func() error) error {
        content := getEventContent(ctx.Event)
        if word := containsProhibitedWord(content); word != "" {
            ctx.Event.Tag = appendTags(ctx.Event.Tag, ViolationTagPrefix+word)
            fmt.Printf("  [Hook] Marked %s message as violation (word: %s)\n", ...)
        }
        return next()   // 继续写入链
    }
}
```

`ProhibitedWords` 是一个包级变量（`["pirated serial number", "crack password"]`），生产中可从配置加载。

### 配对过滤（`hooks.go`）

`filterViolationEvents` 做两轮扫描：先标记要跳过的下标（违规事件本身 + 其配对问答），再原地重建事件切片。

```go
// 用户消息违规 → 连带跳过下一条 assistant 响应
if evt.IsUserMessage() && i+1 < len(sess.Events) && !sess.Events[i+1].IsUserMessage() {
    skipIndices[i+1] = true
}
// assistant 响应违规 → 连带跳过前一条 user 消息
if !evt.IsUserMessage() && i > 0 && sess.Events[i-1].IsUserMessage() {
    skipIndices[i-1] = true
}
```

"配对过滤"很关键：否则模型会看到"孤立的违规答复"或"无回复的违规提问"，依然泄露上下文。

### 连续消息修复三种策略

```go
switch strategy {
case strategyMerge:       sess.Events = mergeConsecutiveUserMessages(sess.Events)
case strategyPlaceholder: sess.Events = insertPlaceholdersBetweenUserMessages(sess.Events)
case strategySkip:        sess.Events = skipEarlierConsecutiveUserMessages(sess.Events)
}
```

三者的共同点：只在 `sess.Events` 的内存副本上操作（持有 `sess.EventMu.Lock()`），不回写后端。

### 6 步自动化演示

`main()` 顺序跑：

1. 正常消息（"Hello, my name is Alice"）→ 验证标记为 0
2. 含违禁词的消息（"pirated serial number"）→ 被标记 `violation=pirated serial number`
3. 之后正常提问 → 读取时 FilterViolationHook 把违规 Q&A 过滤，模型只看到 Alice 那轮
4. 再发一条正常消息 → 验证上下文干净
5. （仅当 `-consecutive` 启用）用 `AppendEvent` 模拟"用户断线"写入一条孤立 user 消息
6. 发新消息 → 触发 `FixConsecutiveUserMessagesHook` 修复

### 模拟连续消息（`main.go`）

Step 5 用直接 `AppendEvent` 写入一条**没有 assistant 回复**的 user 消息，制造连续 user 序列：

```go
simulatedUserEvent := &event.Event{
    ID: fmt.Sprintf("simulated-user-%d", time.Now().UnixNano()),
    Response: &model.Response{
        Done: true,
        Choices: []model.Choice{{Message: model.Message{
            Role: model.RoleUser,
            Content: "I was disconnected before getting a response",
        }}},
    },
}
svc.AppendEvent(ctx, sess, simulatedUserEvent)
```

这正是 [`appendevent`](./session-appendevent.md) 的"绕过模型直写"技巧在此处的实战应用。

## 运行方式

### 环境变量

| 变量 | 必需 | 说明 | 默认值 |
|------|------|------|--------|
| `OPENAI_API_KEY` | 是 | 模型 API Key | — |
| `OPENAI_BASE_URL` | 否 | 模型端点 | `https://api.openai.com/v1` |
| `MODEL_NAME` | 否 | 模型名（被 `-model` 默认引用） | — |

按所选后端补充：`SQLITE_SESSION_DSN` / `REDIS_ADDR` / `PG_*` / `PGVECTOR_*` / `MYSQL_*` / `CLICKHOUSE_*`。

### 命令行参数

| 参数 | 说明 | 默认值 |
|------|------|--------|
| `-model` | 模型名 | `MODEL_NAME` 环境变量或 `deepseek-v4-flash` |
| `-session` | 后端：`inmemory`/`sqlite`/`redis`/`postgres`/`pgvector`/`mysql`/`clickhouse` | `inmemory` |
| `-consecutive` | 连续消息策略：`merge`/`placeholder`/`skip`（空=禁用） | 空 |

### 运行命令

```bash
cd examples/session/hook
export OPENAI_API_KEY="your-api-key"

go run .                                  # 基础内容过滤（4 步）
go run . -session=sqlite                  # 持久化到本地文件
go run . -consecutive=merge               # 启用连续消息修复（6 步）
go run . -consecutive=placeholder
go run . -consecutive=skip
```

> `-consecutive` 取值不在 `merge/placeholder/skip` 中会 `log.Fatalf`。

### 预期输出（节选）

```
Using model: deepseek-v4-flash
Session backend: inmemory
Prohibited words: [pirated serial number crack password]

=== Step 1: Normal request ===
User: Hello, my name is Alice
Assistant: Hello Alice! How can I assist you today?
  [DEBUG] Session Events: 2

=== Step 2: Request with prohibited word ===
  [Hook] Marked user message as violation (word: pirated serial number): ...
  [Filtered violation: Can you give me a pirated seri...] tag=pirated serial number
  [Filtered paired response]
  [Hook] Filtered 2 violated event(s)
  [DEBUG] Session Events: 2     <- 违规 Q&A 已被剔除，只剩 Alice 那轮

=== Step 3: Normal request after violation ===
User: What is my name?
Assistant: Your name is Alice.   <- 模型未受违规内容污染
  [DEBUG] Session Events: 4

=== Step 5: Consecutive user messages demo ===  (仅 -consecutive 启用)
Simulated user message: I was disconnected before getting a response
(No assistant response - simulating disconnection)

=== Step 6: Send message after consecutive simulation ===
  [Hook] Merged consecutive user messages   <- merge 策略
```

## 适用场景与对比

**选 hook 当：**
- 合规审核：屏蔽敏感词、PII、商业机密
- 上下文清洗：剔除工具调用噪音、错误回复
- 异常修复：处理断线重发、消息乱序、重复提交
- 审计留痕：写入时打标、读取时过滤，保留原始数据

**对比其它拦截/控制手段：**

| 维度 | hook | [`eventlimit`](./session-eventlimit.md) | [`ttl`](./session-ttl.md) |
|------|------|------------------------------------------|----------------------------|
| 控制粒度 | 单条事件内容 | 事件条数 | 整会话时长 |
| 是否保留原数据 | 是（Tag 标记） | 否（直接丢弃） | 否（整体过期） |
| 执行时机 | 写入/读取 | 写入后自动 | 后台清理 |
| 适合场景 | 审核、修复 | 控长度 | 控寿命 |

> Hook + EventLimit + TTL 是生产会话治理的"三件套"：Hook 管合规、EventLimit 管长度、TTL 管寿命。

## 关键要点

1. **两类拦截器**：`AppendEventHook` 改持久化、`GetSessionHook` 改内存副本，按需选择。
2. **洋葱模型**：`next()` 前=前置、`next()` 后=后置，可多 hook 串联。
3. **Tag 延迟过滤**：写入打标 `violation=<word>`、读取过滤，审计与净化两不误。
4. **配对剔除**：违规事件必须连同其问答对手一起过滤，否则上下文会"漏馅"。
5. **连续消息优先用 GetSessionHook 修**：无持久化、无递归、存储保持原样。

## 总结

hook 揭示了 Session 的"中间件"本质：在不改业务代码的前提下，往读写链路插入审核、清洗、修复逻辑。它的违规过滤范式（写入打标 + 读取配对过滤）和连续消息修复范式（GetSessionHook 三策略）都能直接搬进生产。再结合 [`eventlimit`](./session-eventlimit.md) / [`ttl`](./session-ttl.md) 的生命周期控制，就构成了完整的会话治理体系。
