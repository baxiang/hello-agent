# Milvus 向量库示例 - 十亿级专用向量数据库

> **源码路径**：[`trpc-agent-go/examples/knowledge/vectorstores/milvus/`](../../../../trpc-agent-go/examples/knowledge/vectorstores/milvus)
> **示例类型**：向量库后端（大规模） · **难度**：进阶

## 概述

`vectorstores/milvus/` 用 Milvus 做 RAG 后端。Milvus 是专为超大规模向量检索设计的数据库（十亿级向量），支持 dense / sparse / 全文多种检索模式，可选 GPU 加速。当数据规模超过 pgvector 的舒适区（千万级 chunk）时，Milvus 是升级方向。

## 核心概念

### Milvus 的定位

| 维度 | Milvus |
|------|--------|
| 设计目标 | 十亿级向量 ANN |
| 索引类型 | IVF / HNSW / DiskANN 等 |
| 检索模式 | dense + sparse + 全文 |
| GPU 加速 | ✅ 可选 |
| 架构 | 云原生（K8s 友好） |
| 事务 | ❌（纯向量，无 ACID） |

### 与 pgvector 的关键区别

| 维度 | pgvector | Milvus |
|------|----------|--------|
| 起源 | PG 扩展 | 专用向量 DB |
| 事务 | ✅ ACID | ❌ |
| 元数据 UPDATE | ✅ SQL | 受限 |
| 大规模 ANN | 中（千万级舒适） | 强（十亿级） |
| 运维 familiar | 高（标准 PG） | 中（专用组件） |
| 适合 | 通用 RAG | 超大规模向量 |

经验法则：chunk 数 < 1000 万选 pgvector；> 1 亿考虑 Milvus。

### 三种检索模式

Milvus 2.5+ 支持：

| 模式 | 用途 |
|------|------|
| Dense vector | 语义相似（默认） |
| Sparse vector | 关键词加权 |
| Full-text | BM25 风格 |

三者可融合（hybrid search），进一步提升召回。

## 代码解析

### 带 context 的构造

Milvus SDK 需要在构造时建立长连接，所以 `milvus.New` 接受 `context.Context`（其它后端大多不需要）：

```go
vs, err := milvus.New(ctx,
    milvus.WithAddress(address),
    milvus.WithUsername(username),
    milvus.WithPassword(password),
    milvus.WithDBName(dbName),
    milvus.WithCollectionName(collection),
)
if err != nil {
    log.Fatalf("Failed to create vector store: %v", err)
}
defer vs.Close()   // 关键：长连接必须 Close
```

注意 `defer vs.Close()`——Milvus 的 VectorStore 持有 gRPC 连接，不 Close 会泄漏。

### DB + Collection 两级命名

```go
dbName := util.GetEnvOrDefault("MILVUS_DB_NAME", "test")
collection := util.GetEnvOrDefault("MILVUS_COLLECTION", "trpc_example")
```

Milvus 用"数据库 + 集合"两级组织（类似 PG 的 schema + table），可隔离不同租户/项目的数据。

### 索引刷新等待

[`util.WaitForIndexRefresh`](../../../../trpc-agent-go/examples/knowledge/util.go) 对 Milvus 会 sleep 5 秒（比 ES 的 30 秒短）：

```go
if storeType == VectorStoreMilvus {
    time.Sleep(5 * time.Second)
}
```

Milvus 写入后需要 load collection 到内存才能查，5 秒是经验值。

## 运行方式

### 前置：启动 Milvus

```bash
# 下载 docker-compose.yml
wget https://github.com/milvus-io/milvus/releases/download/v2.5.0/milvus-standalone-docker-compose.yml -O docker-compose.yml

# 启动 Milvus standalone
docker-compose up -d
```

默认监听 `localhost:19530`。

### 环境变量

| 变量 | 必需 | 说明 | 默认值 |
|------|------|------|--------|
| `MILVUS_ADDRESS` | 是 | Milvus 地址 | `localhost:19530` |
| `MILVUS_USERNAME` | 否 | 用户名 | 空 |
| `MILVUS_PASSWORD` | 否 | 密码 | 空 |
| `MILVUS_DB_NAME` | 否 | 数据库名 | `test` |
| `MILVUS_COLLECTION` | 否 | 集合名 | `trpc_example` |
| `OPENAI_API_KEY` | 是 | LLM + embedding | — |
| `MODEL_NAME` | 否 | 模型 | `deepseek-v4-flash` |

### 运行命令

```bash
cd examples/knowledge/vectorstores/milvus
export OPENAI_API_KEY="sk-xxxx"
export MILVUS_ADDRESS="localhost:19530"
export MILVUS_USERNAME="root"
export MILVUS_PASSWORD="Milvus"
go run main.go
```

### 预期输出

```
🔷 Milvus Vector Store Demo
===========================
📊 Connecting to Milvus: localhost:19530

📥 Loading knowledge into Milvus...
Vector store: added 23 documents

🔍 Querying knowledge from Milvus...
🤖 Response: Large Language Models are neural networks...

✅ Data persisted in Milvus!
```

## 适用场景与对比

**选 milvus 当：**
- chunk 数 > 1 亿，pgvector 性能吃紧
- 需要 dense + sparse + 全文混合检索
- 有 GPU 想加速索引
- 团队能驾驭 K8s 云原生运维

**对比其它后端：**

| 后端 | 规模上限 | 运维 | 事务 | 适合 |
|------|---------|------|------|------|
| [`pgvector`](./knowledge-vectorstores-postgres.md) | 千万级 | 中 | ✅ | 通用首选 |
| [`elasticsearch`](./knowledge-vectorstores-elasticsearch.md) | 亿级 | 高 | ❌ | 搜索强需求 |
| [`tcvector`](./knowledge-vectorstores-tcvector.md) | 云托管 | 零 | ❌ | 腾讯云用户 |
| **milvus** | 十亿级 | 高 | ❌ | 超大规模 |

## 关键要点

1. **超大规模专用**：Milvus 是十亿级向量的舒适区。
2. **长连接要 Close**：`defer vs.Close()` 避免 gRPC 泄漏。
3. **DB + Collection 两级**：可隔离多租户数据。
4. **三种检索模式**：dense / sparse / full-text 可融合。
5. **5 秒刷新等待**：load collection 到内存需要时间。

## 总结

Milvus 是"向量数据库的天花板"——当数据规模大到 pgvector 扛不住时升级。代价是无 ACID 事务、运维复杂、`UpdateByFilter` 等元数据操作受限。绝大多数 RAG 项目用 [`pgvector`](./knowledge-vectorstores-postgres.md) 足够；只有真的到了亿级以上才需要 Milvus。配合 [`graphrag`](./knowledge-features-graphrag.md) 的图遍历可构建超大规模代码 RAG 系统。
