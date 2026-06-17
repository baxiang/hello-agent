# Memory TencentDB 集成 - Sidecar 记忆引擎（Ingest + Recall 插件）

> **源码路径**：[`trpc-agent-go/examples/memory/tencentdb/`](../../../../trpc-agent-go/examples/memory/tencentdb)
> **示例类型**：外部平台集成（ingest + recall plugin） · **难度**：进阶

## 概述

`tencentdb/` 演示如何接入 [TencentDB Agent Memory](https://github.com/Tencent/TencentDB-Agent-Memory) 作为 sidecar 长期记忆引擎。与 [`mem0`](./memory-mem0.md) 的 ingest-first 模式相比，本示例多了一招——**BeforeModel recall 插件**：在每次调用模型前，自动从 TencentDB 召回相关上下文注入请求，让 Agent 不用主动 search 也能"想起"历史。

三段式集成：
1. **Session ingestion**：每轮结束后 Runner 把会话原文发给 gateway 的 `/capture`
2. **Automatic recall**：调用模型前，`runner.WithPlugins(memSvc.Plugin())` 自动请求 recall 端点，把召回结果注入模型请求（opt-in）
3. **Read-only tools**：Agent 可显式调 `tdai_memory_search` / `tdai_conversation_search`

## 核心概念

### Ingest + Recall 双向闭环

```text
User message
      │
      ▼
   Runner ──► BeforeModel plugin ──► TencentDB Agent Memory gateway
      │              │                         │
      │              ▼                         ▼
      │        召回的相关上下文           SDK 记忆引擎（L0-L3）
      │
      ▼
    Agent ──► LLM ──► Response
      │        │
      │   (可能调用 tdai_memory_search
      │    或 tdai_conversation_search)
      │
      ▼  (每轮对话结束后)
  session.Ingestor ──► /capture
```

与 mem0 单向（只 ingest）相比，tencentdb 是**双向**：写入侧（capture）+ 读取侧（recall + search tools），构成完整的 RAG 闭环。

### 三种记忆读取面

| 读取面 | 默认 | 触发方式 | 作用域 |
|--------|------|---------|--------|
| **Automatic recall**（插件） | ❌ opt-in | BeforeModel 钩子自动 | 共享长期库 |
| `tdai_memory_search`（工具） | ❌ opt-in | Agent 显式调用 | 共享长期库 |
| `tdai_conversation_search`（工具） | ✅ 默认 | Agent 显式调用 | 当前 session |

> **多租户安全提示**：recall 和 `tdai_memory_search` 读的是 gateway 共享长期库，**当前不强制 user/session 隔离**，所以默认关闭。只有当你确认 gateway 端做了隔离（如可信本地 sidecar）才启用。本示例是单租户本地环境，所以显式开启了 recall 和 memory_search。

## 代码解析

### 三步接线（含 recall 插件）

```go
import (
    memorytencentdb "trpc.group/trpc-go/trpc-agent-go/memory/tencentdb"
    "trpc.group/trpc-go/trpc-agent-go/runner"
)

// 1. 创建 service，开启 recall + memory_search 工具（单租户可信环境）
memSvc, err := memorytencentdb.NewService(
    memorytencentdb.WithGatewayURL("http://127.0.0.1:8420"),
    memorytencentdb.WithRecallEnabled(true),         // 启用自动召回插件
    memorytencentdb.WithMemorySearchTool(true),      // 暴露 tdai_memory_search
    // memorytencentdb.WithAPIKey(os.Getenv("TDAI_GATEWAY_API_KEY")),  // gateway 需鉴权时
)
if err != nil {
    log.Fatalf("create memory service: %v", err)
}
defer memSvc.Close()

// 2. 创建 Agent，挂载 TencentDB 原生工具
agent := llmagent.New(
    "assistant",
    llmagent.WithModel(openai.New("deepseek-v4-flash")),
    llmagent.WithTools(memSvc.Tools()),
)

// 3. 创建 Runner，挂载 ingestor + recall 插件
r := runner.NewRunner(
    "my-app",
    agent,
    runner.WithSessionService(sessionSvc),
    runner.WithSessionIngestor(memSvc),       // 每轮后 capture
    runner.WithPlugins(memSvc.Plugin()),      // 模型调用前 recall
)
defer r.Close()
```

### 工具命名前缀

TencentDB 工具默认带 `tdai_` 前缀，避免与内置 `memory_*` 工具冲突：

- `tdai_conversation_search`（默认开）— 在当前 session 历史里搜索
- `tdai_memory_search`（opt-in）— 在长期记忆库里搜索
- 可用 `WithStandardAliases(true)` 同时暴露标准 `memory_search` 别名
- 可用 `WithToolPrefix(prefix)` 改前缀

### Session Key 映射

框架 session → gateway `session_key` 默认映射：`base64url(app):base64url(user):base64url(session)`。需要自定义时：

```go
memSvc, _ := memorytencentdb.NewService(
    memorytencentdb.WithSessionKeyFunc(func(app, user, sess string) string {
        return fmt.Sprintf("%s/%s/%s", app, user, sess)
    }),
)
```

## 配置选项

| Option | 说明 | 默认值 |
|--------|------|--------|
| `WithGatewayURL(url)` | gateway URL | `http://127.0.0.1:8420` |
| `WithTimeout(d)` | gateway HTTP 超时 | `5s` |
| `WithIngestWorkers(n)` | 异步 capture worker 数 | `1` |
| `WithIngestQueueSize(n)` | capture 队列容量 | `10` |
| `WithIngestJobTimeout(d)` | capture 任务超时 | `30s` |
| `WithSessionKeyFunc(fn)` | 自定义 session_key 映射 | base64url 三段式 |
| `WithAPIKey(key)` | gateway 鉴权（`Authorization: Bearer`） | 无 |
| `WithRecallEnabled(bool)` | 启用 recall 插件（**opt-in**） | `false` |
| `WithMemorySearchTool(bool)` | 暴露 `tdai_memory_search`（**opt-in**） | `false` |
| `WithConversationSearchTool(bool)` | 暴露 `tdai_conversation_search` | `true` |
| `WithStandardAliases(bool)` | 同时暴露标准 `memory_search` 别名 | `false` |
| `WithToolPrefix(prefix)` | 改工具前缀 | `tdai` |

## 运行方式

### 前置：启动 gateway sidecar

TencentDB Agent Memory gateway 是本地 HTTP facade，负责 L0-L3 记忆引擎（capture / extraction / storage / recall / search）。

```bash
git clone https://github.com/Tencent/TencentDB-Agent-Memory.git
cd TencentDB-Agent-Memory
npm install

export TDAI_LLM_API_KEY="your-openai-compatible-api-key"
export TDAI_LLM_BASE_URL="https://api.openai.com/v1"
export TDAI_LLM_MODEL="deepseek-v4-flash"

node --import tsx src/gateway/server.ts
```

默认监听 `http://127.0.0.1:8420`。

### 环境变量

| 变量 | 必需 | 说明 | 默认值 |
|------|------|------|--------|
| `OPENAI_API_KEY` | 是 | 对话模型 API Key | — |
| `OPENAI_BASE_URL` | 否 | 模型端点 | `https://api.openai.com/v1` |
| `TENCENTDB_AGENT_MEMORY_GATEWAY` | 否 | gateway URL | `http://127.0.0.1:8420` |
| `TDAI_GATEWAY_API_KEY` | 否 | gateway 鉴权 key | — |

### 命令行参数

| 参数 | 说明 | 默认值 |
|------|------|--------|
| `-model` | 对话模型 | `deepseek-v4-flash` |
| `-app` / `-user` / `-session` | ownership 标识 | `tencentdb-memory-demo` / `demo-user` / 自动生成 |
| `-gateway` | gateway URL | env 或 `http://127.0.0.1:8420` |
| `-gateway-timeout` | gateway 调用超时（含 session flush） | `60s` |
| `-gateway-api-key` | gateway 鉴权 key | env `TDAI_GATEWAY_API_KEY` |
| `-turn-wait` | 每轮后等待 capture/extract 的延时 | `0s` |
| `-end-session` | 退出前调用 `/session/end` | `false` |

### 运行命令

```bash
export OPENAI_API_KEY="your-openai-api-key"
export TENCENTDB_AGENT_MEMORY_GATEWAY="http://127.0.0.1:8420"

cd examples/memory/tencentdb
go run .
```

### 交互示例

```text
You: Remember this profile: my project code name is Apollo Lake,
     my deployment window is Friday night, and I prefer concise answers.
You: /new                              # 切新会话，触发 session flush
You: What is my project code name, deployment window, and answer preference?
You: /exit
```

预期：在新会话里，recall 插件自动注入或 Agent 调 `tdai_memory_search` 能取回这些信息。

```
Model: deepseek-v4-flash
Gateway: http://127.0.0.1:8420 (status=ok version=...)
============================================================
You: My project code name is Apollo Lake. I prefer concise answers.
Tool calls: tdai_memory_search, tdai_conversation_search
Assistant: Noted.

You: /new
Started new session.

You: What is my project code name?
Tool calls: tdai_memory_search
Assistant: Your project code name is Apollo Lake.
```

## 与 mem0 的对比

| 维度 | mem0 | tencentdb |
|------|------|-----------|
| 写入 | ingest（每轮上报） | ingest（每轮 `/capture`） |
| **自动召回** | ❌ 无（Agent 需主动 search） | ✅ BeforeModel recall 插件 |
| 工具 | `memory_search` 等 | `tdai_memory_search` / `tdai_conversation_search` |
| 提取引擎 | mem0 云端 | TencentDB SDK（gateway 内） |
| 部署形态 | SaaS / 自托管 | 本地 sidecar（Node.js gateway） |
| 默认读取面 | search 工具 | 仅 conversation_search（同 session） |
| 多租户隔离 | org/project | gateway 端负责（默认不隔离） |

## 适用场景

**选 tencentdb 当：**
- 想要"Agent 不主动 search 也能自动想起历史"——recall 插件是这个示例最大的差异化能力
- 已有 TencentDB Agent Memory 部署或愿意跑 sidecar
- 需要 session 级 + 长期级双层记忆（conversation_search vs memory_search）
- 在腾讯云生态内，希望与 VectorDB 等服务联动

**选 [`mem0`](./memory-mem0.md) 当：**
- 想要更轻量的纯 ingest-first，不需要自动 recall
- 已有 mem0 账号

**选 [`simple`](./memory-simple.md) / [`auto`](./memory-auto.md) 当：**
- 不想要任何外部依赖，记忆全本地

## 关键要点

1. **recall 插件是杀手锏**：`runner.WithPlugins(memSvc.Plugin())` 在 BeforeModel 钩子里自动注入召回结果，Agent 完全无感
2. **opt-in 设计是安全考虑**：recall 和 memory_search 读共享库，默认关；确认隔离后再开
3. **三段式接线**：`WithSessionIngestor` + `WithPlugins` + `Tools()`，分别管 capture / recall / explicit search
4. **session_key 自定义**：默认 base64url 三段式，复杂租户场景可重写
5. **gateway 是必须的**：即使 SDK 用本地 SQLite，也需要 gateway 跑完整记忆 pipeline，不能直连 VectorDB

## 总结

tencentdb 示例展示了记忆集成最完整的一种形态——写入（ingest）+ 自动召回（recall plugin）+ 显式搜索（tools）三位一体。它和 [`mem0`](./memory-mem0.md) 共享 ingest-first 的理念，但多了 recall 插件这一层"主动记忆"。如果你在做一个"应该懂用户"的长期助理，且能接受 sidecar 部署，tencentdb 是功能最全的选择。
