# Tencent VectorDB 向量库示例 - 腾讯云托管向量服务

> **源码路径**：[`trpc-agent-go/examples/knowledge/vectorstores/tcvector/`](../../../../trpc-agent-go/examples/knowledge/vectorstores/tcvector)
> **示例类型**：向量库后端（云托管） · **难度**：进阶

## 概述

`vectorstores/tcvector/` 用腾讯云 VectorDB 做 RAG 后端。VectorDB 是腾讯云的托管向量数据库服务，免运维、自动扩缩容、原生支持向量 + 文本混合检索。本示例适合腾讯云生态用户——把 RAG 后端完全托管，无需自己跑 PG/ES/Milvus。

## 核心概念

### 云托管 vs 自建

| 维度 | tcvector（云托管） | [`pgvector`](./knowledge-vectorstores-postgres.md)/[`milvus`](./knowledge-vectorstores-milvus.md)（自建） |
|------|--------------------|----------------------------------------|
| 运维 | 全托管 | 自己管 |
| 扩容 | 自动 | 手动 |
| 高可用 | 内置 | 自己配 |
| 成本 | 按量付费 | 固定机器 |
| 数据主权 | 腾讯云 | 自己机房 |
| 接入速度 | 拿到 URL 即用 | 部署 Docker |

### VectorDB 的混合检索

`tcvector.WithFilterAll(true)` 开启"全部条件过滤"模式，让向量检索时可叠加文本过滤——这是 VectorDB 的原生能力（不像 pgvector 要靠 TSVector）。

## 代码解析

### 显式凭据构造

```go
url := util.GetEnvOrDefault("TCVECTOR_URL", "")
username := util.GetEnvOrDefault("TCVECTOR_USERNAME", "")
password := util.GetEnvOrDefault("TCVECTOR_PASSWORD", "")
collection := util.GetEnvOrDefault("TCVECTOR_COLLECTION", "trpc_example")

if url == "" || username == "" || password == "" {
    log.Fatal("TCVECTOR_URL, TCVECTOR_USERNAME, and TCVECTOR_PASSWORD are required")
}

vs, err := tcvector.New(
    tcvector.WithURL(url),
    tcvector.WithUsername(username),
    tcvector.WithPassword(password),
    tcvector.WithCollection(collection),
    tcvector.WithFilterAll(true),
)
```

注意强制校验三个必填字段——VectorDB 必须有完整凭据才能连。

### Collection 管理

VectorDB 用 collection 组织数据（类似 Milvus 的 collection 或 pgvector 的 table）。多次运行同一示例时：

- **相同 collection 名**：复用已存 embedding，加速冷启动
- **不同 collection 名**：隔离不同实验/租户的数据
- **删除 collection**：通过腾讯云控制台或 SDK 清空

[`run_examples.sh`](../../../../trpc-agent-go/examples/knowledge/run_examples.sh) 的 `-r` flag 会给每次运行生成随机 collection 名（`generate_random_name "kb"`），避免不同示例的数据互相污染——这对批量测试很有用。

### 与 util.go 的差异

[`util.go`](../../../../trpc-agent-go/examples/knowledge/util.go) 的 `newTCVectorStore` 用同样的选项，但 collection 名默认空（让服务端生成）；本示例显式传入 `trpc_example` 集合名，便于多次运行复用数据。生产环境推荐显式命名以便管理。

## 运行方式

### 前置：开通腾讯云 VectorDB

在腾讯云控制台开通 VectorDB 实例，拿到 URL、用户名、密码。

### 环境变量

| 变量 | 必需 | 说明 | 默认值 |
|------|------|------|--------|
| `TCVECTOR_URL` | 是 | VectorDB 实例 URL | — |
| `TCVECTOR_USERNAME` | 是 | 用户名 | — |
| `TCVECTOR_PASSWORD` | 是 | 密码 | — |
| `TCVECTOR_COLLECTION` | 否 | 集合名 | `trpc_example` |
| `OPENAI_API_KEY` | 是 | LLM + embedding | — |
| `MODEL_NAME` | 否 | 模型 | `deepseek-v4-flash` |

### 运行命令

```bash
cd examples/knowledge/vectorstores/tcvector
export OPENAI_API_KEY="sk-xxxx"
export TCVECTOR_URL="http://your-vectordb.tencentcloudapi.com"
export TCVECTOR_USERNAME="your-username"
export TCVECTOR_PASSWORD="your-password"
go run main.go
```

### 预期输出

```
🔮 Tencent VectorDB Demo
========================
📊 Connecting to Tencent VectorDB: http://your-vectordb.tencentcloudapi.com

📥 Loading knowledge into Tencent VectorDB...
Vector store: added 23 documents

🔍 Querying knowledge from Tencent VectorDB...
🤖 Response: Large Language Models are neural networks...

✅ Data persisted in Tencent VectorDB!
```

## 适用场景与对比

**选 tcvector 当：**
- 已在腾讯云生态，想零运维 RAG 后端
- 数据可放腾讯云（合规允许）
- 团队不想管 PG/ES/Milvus 集群
- 需要自动扩缩容

**对比其它后端：**

| 后端 | 部署 | 运维 | 数据主权 | 适合 |
|------|------|------|---------|------|
| **tcvector** | 云托管 | 零 | 腾讯云 | 腾讯云用户 |
| [`pgvector`](./knowledge-vectorstores-postgres.md) | 自建 | 中 | 自有 | 通用 |
| [`milvus`](./knowledge-vectorstores-milvus.md) | 自建 | 高 | 自有 | 超大规模 |
| [`elasticsearch`](./knowledge-vectorstores-elasticsearch.md) | 自建 | 高 | 自有 | 搜索强需求 |

## 关键要点

1. **全托管**：开通实例即用，零运维。
2. **强制凭据**：URL + username + password 三项必填，缺一即 fatal。
3. **混合检索原生**：`WithFilterAll(true)` 叠加文本过滤。
4. **集合名复用**：通过 `TCVECTOR_COLLECTION` 控制集合，多次运行复用数据。
5. **腾讯云锁定**：数据在腾讯云，合规场景需评估。

## 总结

tcvector 是"腾讯云用户的最省心选择"——拿 URL 即用，无需部署。代价是数据主权交给腾讯云，且锁定腾讯生态。非腾讯云用户回到 [`pgvector`](./knowledge-vectorstores-postgres.md)（通用首选）或 [`milvus`](./knowledge-vectorstores-milvus.md)（超大规模）。
