# Memory Mem0 集成 - 外部长期记忆平台（Ingest-First 模式）

> **源码路径**：[`trpc-agent-go/examples/memory/mem0/`](../../../../trpc-agent-go/examples/memory/mem0)
> **示例类型**：外部平台集成（ingest-first） · **难度**：进阶

## 概述

`mem0/` 演示如何把 [mem0.ai](https://mem0.ai) 作为外部长期记忆平台接入 trpc-agent-go。与内置的 [`simple`](./memory-simple.md) / [`auto`](./memory-auto.md) 不同，本示例采用 **ingest-first** 模式：把记忆的**提取与存储完全交给 mem0**，Go 侧只暴露**只读工具**给 Agent。

核心理念：mem0 自己用 LLM 分析对话决定记什么，Go 框架不需要本地 Extractor，也不暴露写工具——避免双写冲突。

## 核心概念

### Ingest-First 双部件架构

```text
User message
      │
      ▼
    Runner  ──►  Agent  ──►  LLM  ──►  Response
      │                        │
      │                  (may call memory_search
      │                   or memory_load tools)
      │
      ▼  (每轮对话结束后触发)
   session.Ingestor
      │
      ▼
   mem0 API  ──►  自行提取并存储记忆
```

两个关键接合点：

1. **Session Ingestion**：每轮对话结束后，Runner 通过 `runner.WithSessionIngestor(mem0Svc)` 把会话原文发给 mem0，由 mem0 自行（`infer: true`）决定记什么
2. **Read-only Tools**：Agent 通过 `memory_search` / 可选的 `memory_load` 查询记忆；写工具（`add` / `update` / `delete`）**故意不暴露**，因为 mem0 已经接管写入

### 为什么不让 Agent 写记忆？

- mem0 用专门的 LLM 做提取，质量通常优于让对话 Agent 兼顾记忆
- 避免双写（Agent 写一次 + mem0 提取一次）造成记忆冗余/冲突
- 简化 Agent 的工具表，让它专注业务对话

## 代码解析

### 三步接线

```go
import (
    memorymem0 "trpc.group/trpc-go/trpc-agent-go/memory/mem0"
    "trpc.group/trpc-go/trpc-agent-go/runner"
)

// 1. 创建 mem0 service
mem0Svc, err := memorymem0.NewService(
    memorymem0.WithAPIKey(os.Getenv("MEM0_API_KEY")),
)
if err != nil {
    log.Fatalf("create mem0 service: %v", err)
}
defer mem0Svc.Close()

// 2. 创建 Agent，只挂载只读工具
agent := llmagent.New(
    "assistant",
    llmagent.WithModel(openai.New("deepseek-v4-flash")),
    llmagent.WithTools(mem0Svc.Tools()),
)

// 3. 创建 Runner，启用 session ingestion
r := runner.NewRunner(
    "my-app",
    agent,
    runner.WithSessionService(sessionSvc),
    runner.WithSessionIngestor(mem0Svc),  // 关键：每轮后发送给 mem0
)
defer r.Close()
```

### `session.Ingestor` 接口

mem0 service 实现了 `session.Ingestor` 接口，Runner 在每轮对话完成后调用 `IngestSession`。接口接受 `session.IngestOption`，框架自动透传两个默认值：

- `session.WithIngestRunID(sess.ID)` → mem0 的 `run_id`
- `session.WithIngestAgentID(invocation.AgentName)` → mem0 的 `agent_id`

需要附加业务元数据时，自定义调用：

```go
err := mem0Svc.IngestSession(ctx, sess,
    session.WithIngestMetadata(map[string]any{"channel": "support"}),
    session.WithIngestAgentID("billing-bot"),
    session.WithIngestRunID("ticket-42"),
)
```

mem0 会把这些值存为记忆的 `metadata` / `agent_id` / `run_id`，便于下游过滤和分组。

### 示例验证逻辑

`mem0/main.go` 不是交互式 chat，而是一个**端到端验证脚本**：发送一条包含唯一标记（如虚构的狗名）的消息，然后轮询 mem0 直到这条记忆变得可搜索，从而验证"Agent 响应 → Session Ingest → mem0 提取 → 记忆检索"的完整闭环。

## 配置选项

| Option | 说明 | 默认值 |
|--------|------|--------|
| `WithAPIKey(key)` | mem0 API Key（必填） | — |
| `WithHost(url)` | mem0 API base URL | `https://api.mem0.ai` |
| `WithOrgProject(o, p)` | 组织 ID 和项目 ID | — |
| `WithAsyncMode(bool)` | 异步发送 ingest 请求 | `true` |
| `WithVersion(v)` | mem0 ingest API 版本 | `v2` |
| `WithTimeout(d)` | mem0 HTTP 请求超时 | `10s` |
| `WithLoadToolEnabled(b)` | 在 `Tools()` 中暴露 `memory_load` | `false` |
| `WithAsyncMemoryNum(n)` | 后台 ingest worker 数 | `1` |
| `WithMemoryQueueSize(n)` | 异步 ingest 队列大小 | `10` |
| `WithMemoryJobTimeout(d)` | 同步降级时的超时 | `30s` |

## 运行方式

### 环境变量

| 变量 | 必需 | 说明 | 默认值 |
|------|------|------|--------|
| `MEM0_API_KEY` | 是 | mem0 API Key（[申请](https://app.mem0.ai/)） | — |
| `OPENAI_API_KEY` | 是 | 对话模型 API Key | — |
| `MEM0_HOST` | 否 | mem0 base URL | `https://api.mem0.ai` |
| `MEM0_BASE_URL` | 否 | `MEM0_HOST` 别名 | — |
| `MEM0_ORG_ID` / `MEM0_PROJECT_ID` | 否 | mem0 组织/项目隔离 | — |

### 命令行参数

| 参数 | 说明 | 默认值 |
|------|------|--------|
| `-model` | 对话模型 | `deepseek-v4-flash` |
| `-app` | mem0 ownership 用的 app 名 | `mem0-integration-demo` |
| `-user` | mem0 ownership 用的 user ID | `demo-user` |
| `-session` | session ID（空则自动生成） | `mem0-<unix-ts>` |
| `-wait-timeout` | 等待记忆可读的超时 | `90s` |

### 运行命令

```bash
export MEM0_API_KEY="your-mem0-api-key"
export OPENAI_API_KEY="your-openai-api-key"

cd examples/memory/mem0
go run .                              # 默认
go run . -model gpt-4o-mini           # 换模型
go run . -wait-timeout 120s           # 拉长等待（mem0 提取慢时）

# 自托管 mem0
export MEM0_HOST="https://your-mem0-instance.example.com"
go run .
```

### 预期输出

```
Model: deepseek-v4-flash
App: mem0-integration-demo
User: demo-user
Session: mem0-1713012345
Token: Mem0IntegrationDemo-1713012345678901234
Message: For future reference, my dog is named Mem0IntegrationDemo-...
============================================================
Tool calls: memory_search
Assistant: Got it! I'll remember your dog's name...

Stored memories (1):
  1. User's dog is named Mem0IntegrationDemo-...
```

## 与内置 Memory 的对比

| 维度 | simple / auto（内置） | mem0（外部） |
|------|---------------------|-------------|
| 提取引擎 | 本地 Extractor（Go 进程内调 LLM） | mem0 云端服务 |
| 写工具 | 暴露给 Agent / Extractor | **完全不暴露** |
| 读工具 | `memory_search` 等 | `memory_search` + 可选 `memory_load` |
| 部署 | 自托管，全本地 | 依赖外部 SaaS / 自托管 mem0 |
| 多租户 | 由存储后端决定 | mem0 原生支持 org/project 隔离 |
| 适用场景 | 数据不出本地的合规场景 | 想用 mem0 的成熟提取能力 + 多端共享 |

## 适用场景

**选 mem0 集成当：**
- 已有 mem0 账号或自托管 mem0 实例
- 想让记忆跨多个应用/设备共享（mem0 是中心化记忆层）
- 不想在 Go 侧维护提取 LLM，把记忆这件事彻底外包
- 需要 mem0 提供的 org / project 级多租户隔离

**选 [`simple`](./memory-simple.md) / [`auto`](./memory-auto.md) 当：**
- 数据合规要求所有记忆留在本地
- 想完全控制提取逻辑和成本
- 不希望增加外部服务依赖

## 关键要点

1. **Ingest-First 是核心模式**：把 `session.Ingestor` 接进 Runner，每轮自动上报，无需手动触发
2. **只读工具是设计选择**：避免双写、简化 Agent，让 mem0 专注做它擅长的事
3. **元数据透传**：`run_id` / `agent_id` / `metadata` 让记忆可按业务维度过滤
4. **异步 + 降级**：默认 `WithAsyncMode(true)`；队列满或超时会降级为同步调用，保证不丢
5. **与 [`tencentdb`](./memory-tencentdb.md) 对比**：两者都是 ingest-first，但 tencentdb 额外提供 **BeforeModel recall 插件**（请求模型前自动注入相关记忆），mem0 则只在 Agent 主动 search 时才检索

## 总结

mem0 示例展示了 trpc-agent-go 与外部记忆平台的标准集成范式：`WithSessionIngestor` + 只读 `Tools()`。这套模式非常轻量——核心代码不到 20 行，却把"对话→提取→存储→检索"的完整闭环跑通。如果想要更强的"自动上下文召回"（不用 Agent 主动 search），可以接着看 [`tencentdb`](./memory-tencentdb.md) 的 recall 插件模式。
