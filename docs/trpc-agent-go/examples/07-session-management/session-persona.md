# Session 会话人格 - 每会话独立的系统提示词

> **源码路径**：[`trpc-agent-go/examples/session/persona/`](../../../../trpc-agent-go/examples/session/persona)
> **示例类型**：交互式 Chat · **难度**：进阶

## 概述

`persona/` 演示如何用一个共享 Agent 实例，为**每个会话**提供独立的人格（系统提示词）。人格文本存在 `session.State` 里，每次 `runner.Run` 前读出来，通过 `agent.WithGlobalInstruction(...)` 作为**运行时**覆盖注入——Agent 实例本身永不被修改，切换会话即切换人格。

与 [`simple`](./session-simple.md) 的对比：simple 的所有会话共享同一个 instruction；persona 则让"严格代码审查员""友善 Go 导师""严谨法务顾问"等角色在同一进程里和平共处，每会话一份。

## 核心概念

### State：会话级的键值存储

每个 Session 除了 `Events`（对话历史），还有一个 `State`（`session.StateMap`，即 `map[string][]byte`），可存任意自定义业务数据。persona 把人格文本存在固定的 key 下：

```go
const personaStateKey = "assistant_persona"

sessionService.UpdateSessionState(ctx, key, session.StateMap{
    personaStateKey: []byte(persona),
})
```

`State` 随会话一起持久化、一起过期，是"会话级变量"的自然载体。

### 运行时覆盖：`agent.WithGlobalInstruction`

关键技巧——人格不在创建 Agent 时写死，而是**每次 Run 时动态注入**：

```go
persona, _ := d.currentPersona(ctx)
eventChan, err := d.runner.Run(
    ctx,
    d.userID,
    d.sessionID,
    model.NewUserMessage(userInput),
    agent.WithGlobalInstruction(buildPersonaInstruction(persona)),  // 运行时覆盖
)
```

`WithGlobalInstruction` 是**单次运行**的 option，不会污染 Agent 实例，因此同一个 `d.runner` 可以在不同会话里表现不同人格。

### 人格模板

`buildPersonaInstruction` 把存下的 persona 文本包进一个"权威指令"模板：

```go
func buildPersonaInstruction(persona string) string {
    if persona == "" {
        persona = defaultPersona  // "You are a practical Go mentor for this session..."
    }
    return "You are the assistant for the current session. The session " +
        "persona below is authoritative. Adapt tone, expertise, and answer " +
        "style to it.\nSession persona:\n" + persona
}
```

## 代码解析

### 创建会话即写入默认人格（`ensureSession`）

首次进入一个新 sessionID 时，示例把它当作"新建会话"，写入默认人格：

```go
func (d *personaDemo) ensureSession(ctx context.Context, targetSessionID string) error {
    sess, err := d.loadSession(ctx, targetSessionID)
    if sess != nil {
        if _, ok := sess.State[personaStateKey]; ok {
            return nil  // 已有人格
        }
        return d.updatePersona(ctx, targetSessionID, defaultPersona)  // 旧会话补默认值
    }
    _, err = d.sessionService.CreateSession(ctx, key, session.StateMap{
        personaStateKey: []byte(defaultPersona),
    })
    return err
}
```

这保证任意会话被读出来时 `personaFromSession` 都能拿到非空人格。

### `/persona` 修改人格（`setPersona`）

```go
func (d *personaDemo) setPersona(ctx context.Context, persona string) error {
    if err := d.ensureSession(ctx, d.sessionID); err != nil { return err }
    return d.sessionService.UpdateSessionState(ctx, key, session.StateMap{
        personaStateKey: []byte(persona),
    })
}
```

`UpdateSessionState` 只改 State、不动 Events，已发生的对话历史完整保留——换人格不会"失忆"。

### 多行人格：`\n` 转义

`/persona` 命令接受字面量 `\n`，由 `normalizeInput` 转成真实换行：

```go
func normalizeInput(value string) string {
    value = strings.TrimSpace(value)
    value = strings.ReplaceAll(value, escapedNewline, actualNewline)  // `\n` → 换行
    return strings.TrimSpace(value)
}
```

使用方式：

```
/persona You are a strict reviewer.\nGive short feedback.\nHighlight risks first.
```

### `/sessions` 带人格预览

`listSessions` 列出会话时，每条附带单行化的人格预览（`singleLinePersona` 把换行压成空格并截断到 96 字符），方便快速辨识每个会话的角色：

```go
fmt.Printf("  %s %s\n", marker, sess.ID)
fmt.Printf("    Persona: %s\n", preview)
```

### 后端校验

与 [`simple`](./session-simple.md) 的 9 后端不同，persona **显式校验**只支持 6 种：

```go
supportedTypes := map[string]util.SessionType{
    "inmemory": ..., "sqlite": ..., "redis": ...,
    "postgres": ..., "mysql": ..., "clickhouse": ...,
}
```

即 **不支持 `noop` / `pgvector` / `tdsql`**——传错会直接报错列出可选值。

## 运行方式

### 环境变量

| 变量 | 必需 | 说明 | 默认值 |
|------|------|------|--------|
| `OPENAI_API_KEY` | 是 | 模型 API Key | — |
| `OPENAI_BASE_URL` | 否 | 模型端点 | `https://api.openai.com/v1` |
| `MODEL_NAME` | 否 | 模型名（被 `-model` 默认引用） | — |

按所选后端补充：`SQLITE_SESSION_DSN` / `REDIS_ADDR` / `PG_*` / `MYSQL_*` / `CLICKHOUSE_*`。

### 命令行参数

| 参数 | 说明 | 默认值 |
|------|------|--------|
| `-model` | 模型名 | `MODEL_NAME` 环境变量或 `deepseek-v4-flash` |
| `-session` | 后端：`inmemory`/`sqlite`/`redis`/`postgres`/`mysql`/`clickhouse` | `inmemory` |
| `-event-limit` | 每会话事件上限 | `1000` |
| `-session-ttl` | 会话过期时间 | `24h` |
| `-streaming` | 流式输出 | `true` |

### 运行命令

```bash
cd examples/session/persona
export OPENAI_API_KEY="your-api-key"

go run .                                # 默认 inmemory
go run . -session=sqlite                # 持久化人格到本地
go run . -session=redis -session-ttl=7d # Redis + 7 天 TTL
```

### 交互命令

| 命令 | 作用 |
|------|------|
| `/persona <text>` | 设置当前会话人格（支持 `\n` 多行） |
| `/show-persona` | 显示当前会话人格 |
| `/new [id]` | 新建会话（写入默认人格） |
| `/use <id>` | 切到**已存在**会话（不存在则报错） |
| `/sessions` | 列出会话 + 人格预览 |
| `/exit` | 退出 |

### 预期输出

```
Session Persona Demo
Model: deepseek-v4-flash
Active session: persona-session-1718600000
========================================================================
Active session: persona-session-1718600000
Persona:
You are a practical Go mentor for this session. Prefer concise answers, ...

You: How do I read a file?
Assistant: Use os.ReadFile for small files: `b, err := os.ReadFile("p.txt")`...

You: /persona You are a strict code reviewer. Point out risks first.
Updated persona for session persona-session-1718600000.

You: var x = readFile()
Assistant: Risk: readFile's error is unchecked. Add `if err != nil`...

You: /new
Started session persona-session-1718600099.

You: /use persona-session-1718600000
Switched from persona-session-1718600099 to persona-session-1718600000.
Persona:
You are a strict code reviewer. Point out risks first.
```

## 适用场景与对比

**选 persona 当：**
- 同一产品有多类用户角色（新手/专家、个人/企业），需不同语气
- 多租户：每租户独立的品牌口吻、专业领域
- A/B 测试不同系统提示词的效果
- 游戏/RPG 场景：每个角色对话独立人格

**对比"硬编码 instruction"与"会话级 persona"：**

| 维度 | 硬编码 instruction | persona（本示例） |
|------|--------------------|-------------------|
| 切换粒度 | 进程级 | 会话级 |
| 是否改 Agent 实例 | 是 | 否（运行时覆盖） |
| 是否可热更新 | 否 | 是（`/persona`） |
| 持久化 | 否 | 是（随 `session.State`） |
| 适合场景 | 单一角色产品 | 多角色、多租户 |

> 进阶：需要 State 占位符插值（如 <code v-pre>{{user.name}}</code>）时，可在 `buildPersonaInstruction` 里加模板渲染；本示例刻意保持极简。

## 关键要点

1. **State 是会话级变量**：`session.StateMap` 随会话持久化/过期，是存放 persona、业务上下文的自然位置。
2. **运行时覆盖**：`agent.WithGlobalInstruction` 是单次 Run 的 option，不污染 Agent 实例。
3. **一 Agent 多人格**：共享 Agent + 每会话 State = 进程内多角色，零额外实例开销。
4. **换人格不失忆**：`UpdateSessionState` 只改 State、不动 Events，对话历史完整。
5. **后端受限**：仅支持 6 种后端，无 `noop`/`pgvector`/`tdsql`。

## 总结

persona 把 `session.State` 和 `agent.WithGlobalInstruction` 两个能力组合起来，演示了"一个共享 Agent + 每会话人格"的轻量多角色模式。它不引入模板引擎、不修改 Agent 实例，仅靠 State 读写和运行时注入就实现了热切换。理解了这个范式，就能轻松扩展到"会话级业务上下文""会话级用户偏好"等任意 State 驱动的运行时行为。
