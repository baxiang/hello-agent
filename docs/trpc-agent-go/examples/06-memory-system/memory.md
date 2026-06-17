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

## 学习路径建议

1. **先读 [`simple`](./memory-simple.md)**：理解 Service + Tools + Runner 三段式接线，这是所有模式的基础
2. **再读 [`auto`](./memory-auto.md)**：看 Extractor 如何让记忆变透明，理解前后端工具分离
3. **按需读 [`mem0`](./memory-mem0.md) / [`tencentdb`](./memory-tencentdb.md)**：当需要外部平台时，对比两种集成范式
4. **随时跑 [`compare`](./memory-compare.md)**：决定该用关键词还是向量后端

## 总结

Memory 系统的设计精髓在于**解耦**：同一套 `memory.Service` 接口，写入侧可以换成 Agent、本地 Extractor、mem0、TencentDB；存储侧可以换成 8 种后端；读取侧可以是工具调用、预加载、或 recall 插件。理解了 simple 的三段式接线，其它模式都是在这个骨架上替换组件。

Memory 与 [`session/`](../07-session-management/session.md) 紧密配合：Session 负责单次会话上下文，Memory 负责跨会话长期信息。生产环境建议组合使用，并根据数据规模和合规要求选择合适的后端与模式。
