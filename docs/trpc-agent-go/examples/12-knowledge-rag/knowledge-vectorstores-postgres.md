# PostgreSQL (pgvector) 向量库示例 - 关系型 + 向量 + 全文检索

> **源码路径**：[`trpc-agent-go/examples/knowledge/vectorstores/postgres/`](../../../../trpc-agent-go/examples/knowledge/vectorstores/postgres)
> **示例类型**：向量库后端 · **难度**：进阶

## 概述

`vectorstores/postgres/` 用 PostgreSQL + pgvector 扩展做向量存储——生产 RAG 的"标准答案"。它在标准 SQL 数据库之上叠加向量索引，既有 ACID 事务又有 ANN 检索，还支持 [`features/management`](./knowledge-features-management.md) 的 `UpdateByFilter` 元数据更新。是其它三个后端（[`elasticsearch`](./knowledge-vectorstores-elasticsearch.md) / [`tcvector`](./knowledge-vectorstores-tcvector.md) / [`milvus`](./knowledge-vectorstores-milvus.md)）的主要对比对象。

## 核心概念

### pgvector 的定位

| 维度 | pgvector |
|------|----------|
| 基础 | PostgreSQL 扩展 |
| 索引 | HNSW / IVFFlat |
| 事务 | ✅ ACID |
| 元数据更新 | ✅（UPDATE SQL） |
| 全文检索 | ✅ TSVector |
| 持久化 | ✅ |
| 运维 familiarity | 高（标准 PG） |

### 三大独特能力

1. **`WithEnableTSVector(true)`**：开启全文检索列，让向量检索 + 关键词检索混合
2. **`UpdateByFilter`**：直接 SQL UPDATE 批量改元数据（[`management`](./knowledge-features-management.md) 第 7 步）
3. **复用 embedding**：向量表持久化，重启不重算

## 代码解析

### 显式 DSN 构造（不依赖 util.go）

与其它示例通过 `util.NewVectorStoreByType` 不同，本示例**直接**构造 DSN 和 pgvector 实例，展示更底层的接线：

```go
host := util.GetEnvOrDefault("PGVECTOR_HOST", "127.0.0.1")
portStr := util.GetEnvOrDefault("PGVECTOR_PORT", "5432")
user := util.GetEnvOrDefault("PGVECTOR_USER", "root")
password := util.GetEnvOrDefault("PGVECTOR_PASSWORD", "123")
database := util.GetEnvOrDefault("PGVECTOR_DATABASE", "vectordb")
table := util.GetEnvOrDefault("PGVECTOR_TABLE", "trpc_example")

encodedUser := url.QueryEscape(user)
encodedPassword := url.QueryEscape(password)
dsn := fmt.Sprintf("postgres://%s:%s@%s:%d/%s?sslmode=disable",
    encodedUser, encodedPassword, host, port, database)

vs, err := pgvector.New(
    pgvector.WithPGVectorClientDSN(dsn),
    pgvector.WithTable(table),
    pgvector.WithEnableTSVector(true),  // 开启全文检索
)
```

注意 `url.QueryEscape`——密码含特殊字符（`@`、`/` 等）必须转义，否则 DSN 解析失败。

### 全文检索开关

```go
pgvector.WithEnableTSVector(true)
```

开启后表里多一列 TSVector，支持 `SearchMode` 里的关键词检索模式。生产环境文档量大时混合检索（向量 + 关键词）能显著提升召回。

### 数据持久化与复用

```go
fmt.Println("\n✅ Data persisted in PostgreSQL! Run again to reuse stored embeddings.")
```

pgvector 把 embedding 存在表里，下次启动时 `kb.Load(ctx)` 会跳过已存在的文档（按 URI 去重），直接复用——省 API 调用、加速冷启动。

## 运行方式

### 前置：启动 PostgreSQL + pgvector

```bash
docker run -d \
  --name postgres-pgvector \
  -e POSTGRES_PASSWORD=yourpassword \
  -e POSTGRES_DB=vectordb \
  -p 5432:5432 \
  pgvector/pgvector:pg16
```

`pgvector/pgvector:pg16` 镜像预装 pgvector 扩展，无需手动 `CREATE EXTENSION`。

### 环境变量

| 变量 | 必需 | 说明 | 默认值 |
|------|------|------|--------|
| `PGVECTOR_HOST` | 否 | 主机 | `127.0.0.1` |
| `PGVECTOR_PORT` | 否 | 端口 | `5432` |
| `PGVECTOR_USER` | 否 | 用户 | `root` |
| `PGVECTOR_PASSWORD` | 是 | 密码 | `123`（示例默认，生产必改） |
| `PGVECTOR_DATABASE` | 否 | 库名 | `vectordb` |
| `PGVECTOR_TABLE` | 否 | 表名 | `trpc_example` |
| `OPENAI_API_KEY` | 是 | LLM + embedding | — |
| `MODEL_NAME` | 否 | 模型 | `deepseek-v4-flash` |

### 运行命令

```bash
cd examples/knowledge/vectorstores/postgres
export OPENAI_API_KEY="sk-xxxx"
export PGVECTOR_PASSWORD="yourpassword"
go run main.go
# 再次运行会复用已存 embedding
go run main.go
```

### 预期输出

```
🐘 PostgreSQL (PGVector) Demo
==============================
📊 Connecting to PostgreSQL: 127.0.0.1:5432/vectordb table: trpc_example

📥 Loading knowledge into PostgreSQL...
Vector store: added 23 documents

🔍 Querying knowledge from PostgreSQL...
🤖 Response: Large Language Models are neural networks...

✅ Data persisted in PostgreSQL! Run again to reuse stored embeddings.
```

## 适用场景与对比

**选 pgvector 当：**
- 团队已熟悉 PostgreSQL 运维
- 需要 ACID 事务保证
- 需要元数据 UPDATE（[`management`](./knowledge-features-management.md)）
- 需要向量 + 全文混合检索
- 中等数据规模（千万级 chunk 以内）

**对比其它后端：**

| 后端 | 强项 | 弱项 | 适合场景 |
|------|------|------|---------|
| **pgvector** | ACID + 全文 + UPDATE | 大规模 ANN 略弱 | 通用生产首选 |
| [`elasticsearch`](./knowledge-vectorstores-elasticsearch.md) | 分布式 + 聚合 | 重运维 | 已有 ES 栈 |
| [`tcvector`](./knowledge-vectorstores-tcvector.md) | 云托管 | 锁定腾讯云 | 腾讯云用户 |
| [`milvus`](./knowledge-vectorstores-milvus.md) | 超大规模 ANN | 仅向量（无事务） | 十亿级向量 |
| `inmemory` | 零依赖 | 不持久 | 开发测试 |

## 关键要点

1. **生产首选**：pgvector 是大多数 RAG 项目的默认后端。
2. **TSVector**：`WithEnableTSVector(true)` 开启混合检索。
3. **密码转义**：DSN 里 password 必须 `url.QueryEscape`。
4. **embedding 复用**：持久化后二次启动跳过已存文档。
5. **支持 UPDATE**：唯一支持 `UpdateByFilter` 改元数据的后端。

## 总结

pgvector 是 Knowledge RAG 的"默认生产后端"——ACID 事务、向量索引、全文检索、元数据更新一应俱全，运维 familiar 度高。除非有特殊需求（超大规模选 milvus，已有 ES 选 elasticsearch，腾讯云选 tcvector），否则 pgvector 是最稳的选择。配合 [`management`](./knowledge-features-management.md) 可构建完整的可变知识库服务。
