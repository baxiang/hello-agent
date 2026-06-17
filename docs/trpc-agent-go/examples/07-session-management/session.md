# Session 管理 - 多轮对话与会话生命周期控制

> **源码路径**：[`trpc-agent-go/examples/session/`](../../../../trpc-agent-go/examples/session)
> **子示例数**：7 个 · 本页为分类索引，每个子示例有独立详解

## 概述

Session 管理是 AI Agent 实现多轮对话的基础设施。trpc-agent-go 的 `session/` 示例目录用 **7 个独立子示例**展示了会话生命周期的完整光谱：从最基础的多后端多会话切换，到事件直写、滑动窗口、TTL 过期、Hook 拦截、会话人格、再到 Graph Agent 集成。框架支持 9 种存储后端，覆盖从开发到分布式生产环境的全场景。

## 子示例导航

| 子示例 | 形态 | 难度 | 一句话说明 |
|--------|------|------|-----------|
| [`simple/`](./session-simple.md) | 交互式 | 入门 | 多后端多会话切换 + 语义召回（pgvector） |
| [`appendevent/`](./session-appendevent.md) | 交互式 | 入门 | 绕过模型直接把任意角色事件写入会话 |
| [`eventlimit/`](./session-eventlimit.md) | 自动脚本 | 入门 | 滑动窗口：限制每会话事件条数 |
| [`ttl/`](./session-ttl.md) | 自动脚本 | 入门 | 时间维度：会话 TTL 过期与重建 |
| [`hook/`](./session-hook.md) | 自动脚本 | 进阶 | AppendEventHook + GetSessionHook：内容过滤、连续消息修复 |
| [`persona/`](./session-persona.md) | 交互式 | 进阶 | 用 session.State 存每会话独立人格 |
| [`graph/`](./session-graph.md) | 交互式 | 进阶 | Graph Agent 与 Session 协作，验证快照不污染 State |

## 选型建议

```
需要多轮对话上下文？
├── 想快速上手、对比多种后端          → simple
├── 想预灌历史/系统上下文/元数据       → appendevent
├── 担心上下文超长、想控 token 长度     → eventlimit
├── 想让会话自动过期（合规/隐私）       → ttl
├── 要做内容审核、违规过滤、消息修复    → hook
├── 每会话需要独立人格/角色            → persona
└── 一轮对话要走多步流水线/图编排       → graph

生产组合拳：eventlimit + ttl + hook（控长度 + 控寿命 + 控合规）
```

## 核心概念

### Session 的结构

一个 Session 由以下核心要素组成：

- **Key**：由 `AppName + UserID + SessionID` 三元组唯一标识
- **Events**：有序的事件列表，每个事件包含用户消息或 Agent 响应（1 轮对话 = 2 事件）
- **State**：键值对状态存储（`session.StateMap` = `map[string][]byte`），可保存自定义业务数据（如 Persona、图业务字段）
- **TTL**：可选的生存时间，过期后会话自动清除

### 会话模式对比

| 特性 | simple | appendevent | eventlimit | ttl | hook | persona | graph |
|------|--------|-------------|------------|-----|------|---------|-------|
| 形态 | 交互 | 交互 | 自动脚本 | 自动脚本 | 自动脚本 | 交互 | 交互 |
| 默认后端 | redis | 仅 inmemory | inmemory | inmemory | inmemory | inmemory | 仅 inmemory |
| 写入方式 | 模型产生 | 手工直写 | 模型产生 | 模型产生 | 模型产生 | 模型产生 | 图编排 |
| 用 State | 否 | 否 | 否 | 否 | 否 | 是（persona） | 是（业务字段） |
| 生命周期控制 | EventLimit+TTL | — | EventLimit | TTL | — | EventLimit+TTL | — |
| 拦截器 | — | — | — | — | Append+Get Hook | — | — |

### Session Service 接线模式

所有子示例都遵循同一种"Service + Runner"接线，只是 Service 配置和 Agent 类型不同：

```go
sessionService, err := util.NewSessionServiceByType(
    sessionType,
    util.SessionServiceConfig{
        EventLimit:       ...,  // 滑动窗口（eventlimit / simple / persona）
        TTL:              ...,  // 过期时间（ttl / simple / persona）
        AppendEventHooks: ...,  // 写入拦截器（hook）
        GetSessionHooks:  ...,  // 读取拦截器（hook）
        EnableTracing:    ...,  // 链路追踪（simple，仅 redis）
    },
)

runner := runner.NewRunner(
    appName,
    agent,                              // llmagent / graphagent
    runner.WithSessionService(sessionService),
)
```

### 存储后端

通过 `util.NewSessionServiceByType` 切换，共 9 种（由 `session/util.go` 统一管理）：

| 后端 | 检索增强 | 适用场景 | 环境变量 |
|------|---------|---------|---------|
| `inmemory` | — | 开发测试（多数子示例默认） | — |
| `noop` | — | 无状态场景，Runner 走流程不持久化 | — |
| `sqlite` | — | 本地单机 | `SQLITE_SESSION_DSN` |
| `redis` | — | 高并发生产，支持 Langfuse Tracing | `REDIS_ADDR` |
| `postgres` | — | 关系型持久化 | `PG_*` |
| `pgvector` | 语义搜索 | 唯一实现 `SearchableService` | `PGVECTOR_*` + embedding |
| `mysql` | — | 关系型持久化 | `MYSQL_*` |
| `tdsql` | — | 分布式分片（腾讯云） | `TDSQL_*` |
| `clickhouse` | — | 列式分析型 | `CLICKHOUSE_*` |

> 仅 simple / eventlimit / ttl / hook 支持全部 9 后端；persona 支持 6 种（无 noop/pgvector/tdsql）；appendevent / graph 硬编码 inmemory。

### 生命周期双轴 + 拦截器三件套

生产级会话治理通常叠加三种机制：

| 机制 | 控制维度 | 配置项 | 触发效果 |
|------|---------|--------|---------|
| EventLimit | 事件条数 | `SessionServiceConfig.EventLimit` | 滑动窗口，保留最近 N 事件 |
| TTL | 存活时长 | `SessionServiceConfig.TTL` | 整体过期，`GetSession` 返回 nil |
| Hook | 事件内容 | `AppendEventHooks` / `GetSessionHooks` | 写入打标、读取过滤 |

三者正交，可同时启用——详见 [`eventlimit`](./session-eventlimit.md) / [`ttl`](./session-ttl.md) / [`hook`](./session-hook.md)。

## 共通的运行命令

```bash
# 通用前置
export OPENAI_API_KEY="your-api-key"
export OPENAI_BASE_URL="https://api.openai.com/v1"

# 各子示例入口
cd examples/session/simple      && go run main.go                 # 默认 redis
cd examples/session/appendevent && go run main.go helper.go       # 两文件必同编
cd examples/session/eventlimit  && go run main.go                 # 自动脚本
cd examples/session/ttl         && go run main.go                 # 自动脚本（会等待）
cd examples/session/hook        && go run .                       # 自动脚本
cd examples/session/persona     && go run .                       # 交互
cd examples/session/graph       && go run .                       # 交互
```

## 共同的环境变量

最关键的两个（详见各子示例文档）：

| 变量 | 说明 |
|------|------|
| `OPENAI_API_KEY` | 对话/embedding 模型的 API Key |
| `OPENAI_BASE_URL` | 模型端点（默认 `https://api.openai.com/v1`） |

切换后端时还需 `SQLITE_SESSION_DSN` / `REDIS_ADDR` / `PG_*` / `PGVECTOR_*`（含 `PGVECTOR_EMBEDDER_MODEL`、`OPENAI_EMBEDDING_API_KEY`）/ `MYSQL_*` / `CLICKHOUSE_*` 等，详见各子示例。

## 学习路径建议

1. **先读 [`simple`](./session-simple.md)**：理解 `Runner + SessionService` 接线和三元组隔离，这是所有子示例的基础
2. **再读 [`appendevent`](./session-appendevent.md)**：看 Event 的结构，理解"绕过模型直写"在后续示例（如 hook 的断线模拟）中的应用
3. **按生命周期需求读 [`eventlimit`](./session-eventlimit.md) / [`ttl`](./session-ttl.md)**：理解数量轴与时间轴的双轨控制
4. **进阶读 [`hook`](./session-hook.md)**：掌握 AppendEventHook / GetSessionHook 的洋葱模型
5. **按业务形态读 [`persona`](./session-persona.md) / [`graph`](./session-graph.md)**：理解 `session.State` 的两种典型用法（人格存储 / 业务字段）

## 总结

Session 系统的设计精髓在于**解耦与正交**：

- **Agent 类型解耦**：`llmagent`（simple/persona/hook）、`graphagent`（graph）共用同一套 Runner + SessionService
- **生命周期正交**：EventLimit（数量轴）、TTL（时间轴）、Hook（内容轴）可任意叠加
- **后端无关**：9 种后端共享同一 `session.Service` 接口，pgvector 额外实现 `SearchableService`
- **State 通用**：`session.StateMap` 既能存 persona（业务角色），也能存图编排的业务字段

理解了 simple 的两行接线（`NewSessionServiceByType` + `WithSessionService`）和三元组隔离，其它子示例都是在同一骨架上替换组件、叠加配置。

Session 与 [`06-memory-system`](../06-memory-system/memory.md) 紧密配合：Session 负责单次会话的短期上下文（事件历史），Memory 负责跨会话的长期信息（用户画像）。生产环境建议组合使用，并根据数据规模、合规要求、检索需求选择合适的后端与机制。
