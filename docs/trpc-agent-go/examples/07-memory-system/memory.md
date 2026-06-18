# Memory 系统 - 为 AI Agent 赋予长期记忆能力

> **源码路径**：[`trpc-agent-go/examples/memory/`](../../../../trpc-agent-go/examples/memory)
> **子示例数**：5 个 · 本页为分类索引，每个子示例有独立详解

## 概述

Memory 系统让 AI Agent 跨会话记住用户信息，实现个性化和上下文感知的交互。trpc-agent-go 的 `memory/` 示例目录用 **5 个独立子示例**展示了从最简单的手动工具调用，到自动后台提取，再到 mem0 / TencentDB 外部平台集成的完整光谱。

## 子示例导航

| 子示例 | 模式 | 难度 | 一句话说明 |
|--------|------|------|-----------|
| [`simple/`](./memory-simple.md) | Agentic（手动工具） | 入门 | LLM 显式调用 `memory_add`/`memory_search` 等工具 |
| [`auto/`](./memory-auto.md) | Auto（后台 Extractor） | 进阶 | LLM Extractor 后台透明提取，用户无感 |
| [`mem0/`](./memory-mem0.md) | 外部平台（ingest-first） | 进阶 | 把提取完全交给 mem0，Go 侧只暴露只读工具 |
| [`tencentdb/`](./memory-tencentdb.md) | 外部平台（ingest + recall） | 进阶 | Sidecar 记忆引擎，含自动 recall 插件 |
| [`compare/`](./memory-compare.md) | 基准对比 | 入门 | SQLite 关键词 vs SQLiteVec 向量检索 hit@k 对比 |

## 选型决策树

```
需要长期记忆？
├── 数据必须全本地（合规/性能）
│   ├── 想精细控制每次记忆操作、看到工具调用 → simple（Agentic）
│   ├── 想无感知对话流、后台自动学习         → auto（Extractor）
│   └── 不确定该用关键词还是向量检索          → 先跑 compare 做选型
│
└── 可接受外部记忆平台
    ├── 只要 ingest，Agent 主动 search 即可    → mem0
    └── 想要"模型调用前自动注入相关上下文"     → tencentdb（recall 插件）
```

## 核心概念

### 记忆模式对比

| 特性 | Agentic（simple） | Auto（auto） | mem0 | tencentdb |
|------|-------------------|--------------|------|-----------|
| 提取主体 | Agent 调工具 | 本地 Extractor | mem0 云端 | TencentDB SDK |
| 提取时机 | 同步、显式 | 异步、后台 | 每轮 ingest | 每轮 capture |
| 写工具 | 6 个（4 默认开） | 后台用 | 不暴露 | 不暴露 |
| 自动 recall | ❌ | ❌ | ❌ | ✅ BeforeModel 插件 |
| 外部依赖 | 无 | 无 | mem0 SaaS | sidecar gateway |

### Memory Service 三层架构

```
Memory Service（记忆服务）
    ├── Memory Tools（工具层：add/update/search/load/delete/clear）
    ├── Memory Extractor（提取层：Auto 模式专用，LLM 驱动）
    └── Storage Backend（存储层：inmemory/sqlite/sqlitevec/redis/mysql/mysqlvec/postgres/pgvector）
```

所有模式共用同一套 `memory.Service` 接口和同样的 "Service + Tools + Runner" 接线模式，只是**写入侧**换成了不同引擎（Agent / 本地 Extractor / mem0 / TencentDB）。

### 存储后端

内置 8 种存储后端，通过 `-memory` 参数切换（适用于 simple / auto）：

| 后端 | 检索方式 | 适用场景 |
|------|---------|---------|
| `inmemory` | 内存 | 开发测试（默认） |
| `sqlite` | 关键词 | 本地单机、精确匹配 |
| `sqlitevec` | 向量 | 本地单机、语义检索 |
| `redis` | 关键词 | 高并发 |
| `mysql` / `mysqlvec` | 关键词 / 向量 | 关系型持久化 |
| `postgres` / `pgvector` | 关键词 / 向量 | 关系型持久化 + 向量 |

> 选 sqlite 还是 sqlitevec？先用 [`compare/`](./memory-compare.md) 跑自己的查询样本看命中率。

### Memory 工具总览

| 工具 | simple | auto（前端） | auto（后端） | 说明 |
|------|--------|-------------|-------------|------|
| `memory_add` | ✅ | ⚙️ 可暴露 | ✅ Extractor 用 | 新增记忆 |
| `memory_update` | ✅ | ⚙️ 可暴露 | ✅ | 更新记忆 |
| `memory_search` | ✅ | ✅ | — | 按查询检索 |
| `memory_load` | ✅ | ⚙️ 可启用 | — | 加载近期记忆 |
| `memory_delete` | ⚙️ | ⚙️ | ✅ | 删除单条 |
| `memory_clear` | ⚙️ | ❌ | ⚙️ | 清空（危险） |

## 共通的运行命令

所有 chat 类示例（simple / auto / tencentdb）都支持统一的交互命令：

- 直接输入文本对话
- `/memory` — 查看 Agent 记住的内容
- `/new` — 开启新会话（会话历史重置，**记忆保留**）
- `/exit` — 退出

```bash
# 通用前置
export OPENAI_API_KEY="your-api-key"

# 各子示例入口
cd examples/memory/simple     && go run main.go     # Agentic
cd examples/memory/auto       && go run .           # Auto
cd examples/memory/mem0       && go run .           # 需额外 MEM0_API_KEY
cd examples/memory/tencentdb  && go run .           # 需先启动 gateway
cd examples/memory/compare    && go run .           # 一次性基准脚本
```

## 共同的环境变量

最关键的两个（详见各子示例文档）：

| 变量 | 说明 |
|------|------|
| `OPENAI_API_KEY` | 对话/提取/embedding 模型的 API Key |
| `OPENAI_BASE_URL` | 模型端点（默认 `https://api.openai.com/v1`） |

切换后端时还需 `SQLITE_MEMORY_DSN` / `REDIS_ADDR` / `MYSQL_*` / `PG_*` / `PGVECTOR_*` 等，详见各子示例。

## 深度原理

> 本节源自原「核心组件」深度文（08-memory.md），整合接口源码、设计哲学与配置速查。

### Memory Service 核心接口

所有存储后端、所有模式都实现同一个接口，这是整个 Memory 系统解耦的根基：

```go
// memory/memory.go
type Service interface {
    AddMemory(ctx, userKey, memory, topics) error
    UpdateMemory(ctx, memoryKey, memory, topics) error
    DeleteMemory(ctx, memoryKey) error
    ClearMemories(ctx, userKey) error
    SearchMemories(ctx, userKey, query) ([]*Memory, error)
    ReadMemories(ctx, userKey, limit) ([]*Memory, error)
    Tools() []tool.Tool       // 返回 Agent 可见的工具
    Close() error
}
```

记忆实体的结构体（注意 `ID` 是内容 hash 的语义，决定了记忆的覆盖/幂等行为）：

```go
type Memory struct {
    ID        string    // 内容 hash（同内容同 ID）
    AppName   string
    UserID    string
    Memory    string    // 记忆内容
    Topics    []string  // 话题标签
    CreatedAt time.Time
    UpdatedAt time.Time
}
```

**UserKey 的语义**：所有读写方法都以 `userKey` 作为隔离维度。Memory 的隔离边界是 `{appName, userID}`（不含 `sessionID`），这正是它与 Session 的本质区别——Memory 跨会话持久，Session 单次会话。

**`Tools()` 方法的设计**：把"哪些 memory 操作暴露给 Agent"的决定权交给 Service 实现。同一份接口，Agentic 模式返回 4-6 个工具，Auto 模式只返回 `memory_search`——这是模式差异落地的关键钩子。

### Extractor 设计机制

Extractor 是 Auto 模式的核心引擎——一个独立的、可配置的"对话分析器"：

```go
// memory/extractor/extractor.go
type Extractor struct {
    model    model.Model           // 用于分析的 LLM（可独立于 Agent 的模型）
    checks   []ExtractCheck        // 提取检查器链
    prompt   string                // 提取 prompt 模板
}

// ExtractCheck：判断是否应该提取记忆
type ExtractCheck func(ctx context.Context, ec *ExtractionContext) bool

type ExtractionContext struct {
    Session  *session.Session
    Messages []model.Message       // 最近几轮对话
    Existing []*memory.Memory      // 已有记忆（避免重复）
}
```

**Checker 机制的设计考量**：提取一次记忆要调用一次 LLM（成本高、延迟高），因此 `ExtractCheck` 链式短路——只要任一 check 返回 false，立即跳过本次提取。内置三个 check 各自解决一类浪费：

| Check | 解决的问题 |
|------|---------|
| `CheckUserMessageOnly` | 没有 user 输入的回合无需分析 |
| `CheckTurnCount(N)` | 每 N 轮才提取一次，避免每轮都烧 token |
| `CheckNoToolCallInProgress` | 工具调用中途不打断 |

**异步 Worker 池的设计**：Extractor 的执行被丢进队列、由后台 worker 消费，主对话流不等它返回。这个设计的三个权衡：

- **不阻塞用户响应**——提取 LLM 调用可能耗时 2-5s，串行会让对话卡顿
- **失败不影响主流程**——提取失败，下一轮会重新评估
- **队列满时丢弃**——记忆是非关键路径，宁可丢一次提取也不堆积请求

### Agentic vs Auto 的深层设计

框架同时提供两种模式，并不是冗余——它们解决的是**对 LLM 判断的不同信任度**：

- **Agentic 模式**：信任主 Agent 的判断——"LLM 在对话中知道什么该记住"，于是让它主动调用 `memory_add`
- **Auto 模式**：不信任主 Agent 的判断——"主 Agent 的注意力应该在对话本身，记忆提取交给专职 LLM"

为什么不合成一种？因为 Extractor 作为独立组件，可以做出主 Agent 做不到的三件事：

1. **用更精确的 prompt**——主 Agent 的 system prompt 要兼顾对话质量，Extractor 的 prompt 可以专注记忆提取这一件事
2. **用不同的模型**——主 Agent 可能需要 GPT-4 级别的能力来对话，但提取记忆这种结构化任务可以用 `gpt-4o-mini` 等更便宜的模型
3. **做更严格的验证**——Extractor 的输出是结构化的 `MemoryOp`（add/update/delete + OldID），可以被框架校验；而 Agent 直接调工具则是即兴的

两者的边界：当你希望对话流程**可见可控**、每条记忆的写入都能在工具调用日志里追踪，选 Agentic；当你希望用户**无感知**、对话体验纯粹，选 Auto。两者也能混合——通过 `WithAutoMemoryExposedTools` 把写工具同时交给 Extractor 和 Agent（双写）。

### 存储后端架构

8 种后端共享同一份 `Service` 接口，差异只在检索引擎。架构上分两条主线：

**关键词 vs 向量的设计分野**：

- 关键词后端（`sqlite` / `redis` / `mysql` / `postgres`）做精确匹配——记忆内容必须出现查询词
- 向量后端（`sqlitevec` / `mysqlvec` / `pgvector`）做语义召回——"用户喜欢什么类型的音乐" 能找到 "喜欢古典乐和爵士" 的记忆，即使零共同关键词

`pgvector` 的配置揭示了向量后端的三个关键参数：

```go
memoryService, _ := pgvector.NewService(
    pgvector.WithPostgresClientDSN("postgres://..."),
    pgvector.WithEmbedder(openaiembedder.New()),  // 用什么模型生成向量
    pgvector.WithVectorDimensions(1536),          // 向量维度必须匹配 embedder
    pgvector.WithTopK(10),                        // 召回条数
)
```

**选型考量**：

- **开发测试** → `inmemory`（默认，零依赖）
- **本地单机** → `sqlite`（关键词）或 `sqlitevec`（向量），先用 [`compare`](./memory-compare.md) 跑自己的查询样本看命中率
- **高并发** → `redis`（关键词）
- **关系型持久化** → `mysql` / `postgres`，按是否需要语义检索选 vec 变种
- **不要先选向量后端**——关键词后端对结构化事实（姓名、偏好）命中率反而更高且零 embedding 成本

### 配置速查

#### Service 层（`memoryinmemory.*`）

| Option | 作用 | 默认/说明 |
|------|------|---------|
| `WithExtractor(extractor)` | 启用 Auto 模式，注入提取器 | 不设则无后台提取 |
| `WithAsyncMemoryNum(n)` | 后台 worker 数 | 控制并发提取能力 |
| `WithMemoryQueueSize(n)` | 提取队列容量 | 满则丢弃（非关键路径） |
| `WithMemoryJobTimeout(d)` | 单次提取超时 | 防 LLM 卡死 |
| `WithAutoMemoryExposedTools(...)` | 把写工具同时暴露给 Agent | 实现双写（Extractor + Agent） |

#### Extractor 层（`extractor.*`）

| Option / Check | 作用 |
|------|------|
| `extractor.NewExtractor(model, opts...)` | 构造器，model 可独立于 Agent 模型 |
| `WithChecks(checks...)` | 设置检查器链（短路求值） |
| `WithPrompt(tpl)` | 自定义提取 prompt 模板 |
| `CheckUserMessageOnly()` | 仅 user 消息回合才提取 |
| `CheckTurnCount(n)` | 每 n 轮提取一次 |
| `CheckNoToolCallInProgress()` | 工具调用中不提取 |

#### Agent 层（`llmagent.*`）

| Option | 作用 |
|------|------|
| `WithMemoryPreload(true)` | 预加载最近记忆到 system prompt |
| `WithMemoryPreloadLimit(n)` | 预加载条数上限（防 prompt 膨胀） |

#### PGVector 后端（`pgvector.*`）

| Option | 作用 |
|------|------|
| `WithPostgresClientDSN(dsn)` | 数据库连接串 |
| `WithEmbedder(e)` | embedding 模型 |
| `WithVectorDimensions(d)` | 向量维度（需匹配 embedder） |
| `WithTopK(k)` | 召回条数 |

---

## 学习路径建议

1. **先读 [`simple`](./memory-simple.md)**：理解 Service + Tools + Runner 三段式接线，这是所有模式的基础
2. **再读 [`auto`](./memory-auto.md)**：看 Extractor 如何让记忆变透明，理解前后端工具分离
3. **按需读 [`mem0`](./memory-mem0.md) / [`tencentdb`](./memory-tencentdb.md)**：当需要外部平台时，对比两种集成范式
4. **随时跑 [`compare`](./memory-compare.md)**：决定该用关键词还是向量后端

## 总结

Memory 系统的设计精髓在于**解耦**：同一套 `memory.Service` 接口，写入侧可以换成 Agent、本地 Extractor、mem0、TencentDB；存储侧可以换成 8 种后端；读取侧可以是工具调用、预加载、或 recall 插件。理解了 simple 的三段式接线，其它模式都是在这个骨架上替换组件。

Memory 与 [`session/`](../08-session-management/session.md) 紧密配合：Session 负责单次会话上下文，Memory 负责跨会话长期信息。生产环境建议组合使用，并根据数据规模和合规要求选择合适的后端与模式。
