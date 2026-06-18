# Memory 简单模式（Agentic）- 手动工具调用的记忆系统

> **源码路径**：[`trpc-agent-go/examples/memory/simple/`](../../../../trpc-agent-go/examples/memory/simple)
> **示例类型**：Agentic 模式（手动工具调用） · **难度**：入门

## 概述

`simple/` 是 Memory 系统最基础的示例，演示 **Agentic 模式**：把 Memory 工具显式注册给 LLM Agent，由模型根据对话上下文自主决定何时调用 `memory_add` / `memory_search` 等工具。适合需要精细控制记忆操作、希望看到每次工具调用过程的场景。

与 [`auto/`](./memory-auto.md) 的核心区别：simple 模式下记忆由 LLM **同步、显式**地写入；auto 模式由后台 Extractor **异步、透明**地提取。

## 核心概念

### Agentic 模式的三段式接线

simple 模式的全部精髓在于把 Memory Service 接入 Runner——一共三步：

```go
// 1. 创建 Memory Service（默认 inmemory，可切 sqlite/redis/mysql/postgres 等）
memoryService, err := util.NewMemoryServiceByType(memoryType, util.MemoryServiceConfig{
    SoftDelete: *softDelete,
})

// 2. 把 memoryService.Tools() 显式注册给 Agent
llmAgent := llmagent.New(
    agentName,
    llmagent.WithModel(modelInstance),
    llmagent.WithTools(memoryService.Tools()),  // 关键：注册记忆工具
)

// 3. 把 memoryService 绑定到 Runner
c.runner = runner.NewRunner(
    appName,
    llmAgent,
    runner.WithSessionService(sessioninmemory.NewSessionService()),
    runner.WithMemoryService(memoryService),    // 关键：绑定记忆服务
)
```

> **生命周期注意**：调用方拥有 Memory Service 的生命周期，Runner 不会自动关闭它，需要 `defer memoryService.Close()`（见 `simple/main.go:156`）。

### 默认启用的 4 个工具

`memoryService.Tools()` 默认只暴露 4 个工具，`delete` / `clear` 默认禁用（防误删）：

| 工具 | 默认状态 | 作用 |
|------|---------|------|
| `memory_add` | ✅ 启用 | 新增记忆条目 |
| `memory_update` | ✅ 启用 | 更新已有记忆 |
| `memory_search` | ✅ 启用 | 按查询检索相关记忆 |
| `memory_load` | ✅ 启用 | 加载用户近期记忆概览 |
| `memory_delete` | ⚙️ 可配置 | 删除单条记忆（默认禁用） |
| `memory_clear` | ⚙️ 可配置 | 清空用户所有记忆（默认禁用） |

启用禁用工具：

```go
memoryService := memoryinmemory.NewMemoryService(
    memoryinmemory.WithToolEnabled(memory.DeleteToolName, true),
)
```

## 代码解析

### 主流程（`simple/main.go`）

示例采用 `memoryChat` 结构体封装状态，整体流程：`setup()` → `startChat()` → 每行输入走 `processMessage()`。

```go
type memoryChat struct {
    modelName      string
    memServiceName string
    streaming      bool
    runner         runner.Runner
    memoryService  memory.Service
    userID         string
    sessionID      string
}
```

### 事件分发

simple 模式通过事件通道区分三类事件——**工具调用**、**工具响应**、**文本输出**：

```go
for event := range eventChan {
    if c.hasToolCalls(event) {            // LLM 决定调用 memory_add 等
        c.handleToolCalls(event, assistantStarted)
    } else if c.hasToolResponses(event) { // 工具执行结果返回
        c.handleToolResponses(event)
    } else if content := c.extractContent(event); content != "" {
        fmt.Print(content)                // 普通文本流式输出
    }
}
```

这种分发模式让你能可视化每次记忆操作（参数、结果），是调试 Memory 行为的关键。

### 自定义工具

示例演示了用自定义实现替换默认 `memory_clear`，加入增强日志和 emoji 反馈（见 simple/README.md 的 "Custom Tool Enhancements"）。自定义工具通过 `WithCustomTool` 注入：

```go
memoryService := memoryinmemory.NewMemoryService(
    memoryinmemory.WithCustomTool(memory.ClearToolName, customClearMemoryTool),
)
```

## 运行方式

### 环境变量

| 变量 | 必需 | 说明 | 默认值 |
|------|------|------|--------|
| `OPENAI_API_KEY` | 是 | 模型 API Key | — |
| `OPENAI_BASE_URL` | 否 | 模型端点 | `https://api.openai.com/v1` |

切换 SQL/Redis 等后端时还需对应变量（`SQLITE_MEMORY_DSN` / `REDIS_ADDR` / `MYSQL_*` / `PG_*` / `PGVECTOR_*` 等，详见源码 README）。

### 命令行参数

| 参数 | 说明 | 默认值 |
|------|------|--------|
| `-model` | 模型名 | `deepseek-v4-flash` |
| `-memory` | 后端：`inmemory`/`sqlite`/`sqlitevec`/`redis`/`mysql`/`mysqlvec`/`postgres`/`pgvector` | `inmemory` |
| `-soft-delete` | SQL 类后端启用软删除 | `false` |
| `-streaming` | 流式输出 | `true` |

### 运行命令

```bash
cd examples/memory/simple
export OPENAI_API_KEY="your-api-key"

go run main.go                         # 默认 inmemory + 流式
go run main.go -memory sqlite          # 切换 SQLite 后端
go run main.go -memory pgvector        # 切换 pgvector 向量后端
go run main.go -model gpt-4o -streaming=false
```

### 交互命令

- 直接输入文本对话
- `/memory` — 让 Agent 复述它记住的内容
- `/new` — 开启新会话（会话历史重置，**记忆保留**）
- `/exit` — 退出

### 预期输出

```
🧠 Simple Memory Chat
Model: deepseek-v4-flash
Memory Service: inmemory
Streaming: true
Available tools: memory_add, memory_update, memory_search, memory_load
==================================================
✅ Memory chat ready! Session: memory-session-1703123456

👤 You: Hello! My name is John and I like coffee.
🤖 Assistant: Hello John! I'll remember that you like coffee.
🔧 Memory tool calls initiated:
   • memory_add (ID: call_abc123)
     Args: {"memory":"User's name is John and they like coffee","topics":["name","preferences"]}
✅ Memory tool response (ID: call_abc123): {"success":true,...}

👤 You: /new
🆕 Started new memory session! (Conversation history reset, memories preserved)

👤 You: What do you remember about me?
🔧 memory_search (ID: call_def456) Args: {"query":"John"}
✅ Based on my memory: your name is John, you like coffee.
```

## 适用场景与对比

**选 simple（Agentic）当：**
- 需要对记忆操作做精细、显式控制
- 希望完整访问 6 个工具
- 调试阶段想看清每次工具调用
- 配置简单、易于理解

**选 [`auto`](./memory-auto.md) 当：**
- 想要无感知、自然的对话流（用户看不到工具调用）
- 希望后台被动学习用户信息
- 可接受异步处理

| 维度 | simple（Agentic） | auto |
|------|-------------------|------|
| 工具注册 | 手动 `WithTools` | 自动（Extractor 后台运行） |
| 记忆写入 | LLM 同步显式调用 | 后台异步提取 |
| 可见工具 | 6 个 | 默认仅 `memory_search` |
| 用户感知 | 能看到工具调用 | 完全透明 |
| 配置复杂度 | 简单 | 较复杂（需配 Extractor） |

## 总结

simple 是 Memory 系统的入门钥匙：三行核心代码（`NewMemoryServiceByType` + `WithTools` + `WithMemoryService`）就能让 Agent 拥有跨会话记忆。理解了 simple，再去看 [`auto`](./memory-auto.md) 的 Extractor 机制、[`mem0`](./memory-mem0.md) / [`tencentdb`](./memory-tencentdb.md) 的外部平台集成就会非常自然——它们都沿用同样的 "Service + Tools + Runner" 接线模式，只是把写入侧换成了外部引擎。
