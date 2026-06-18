# Elasticsearch 向量库示例 - 分布式全文 + 向量混合检索

> **源码路径**：[`trpc-agent-go/examples/knowledge/vectorstores/elasticsearch/`](../../../../trpc-agent-go/examples/knowledge/vectorstores/elasticsearch)
> **示例类型**：向量库后端 · **难度**：进阶

## 概述

`vectorstores/elasticsearch/` 用 Elasticsearch 做 RAG 后端。Elasticsearch 本身就是搜索领域的标杆，加上 8.x 引入的 `dense_vector` 类型，让它能同时承担关键词检索和向量检索。本示例展示**自定义文档映射**（`WithDocBuilder`）和**多版本兼容**（v7/v8/v9），适合已有 ES 投入的团队。

## 核心概念

### ES 的混合检索优势

| 能力 | ES 表现 |
|------|---------|
| 向量检索（dense_vector） | ✅ |
| 关键词检索（BM25） | ✅ 原生强项 |
| 混合检索 | ✅ RRF 融合 |
| 元数据过滤 | ✅ 丰富的 query DSL |
| 聚合分析 | ✅aggregations |
| 分布式扩展 | ✅ 分片 + 副本 |

### 多版本兼容

```go
version := util.GetEnvOrDefault("ELASTICSEARCH_VERSION", "v9")
```

| 版本 | 对应 ES | 说明 |
|------|---------|------|
| `v7` | 7.x | 老集群 |
| `v8` | 8.0–8.7 | 过渡期 |
| `v9` | 8.8+ | 推荐（API 稳定） |

## 代码解析

### 自定义文档映射（DocBuilder）

本示例最独特的部分：自定义如何把 ES `_source` 反序列化成 `document.Document`：

```go
docBuilder := func(hitSource json.RawMessage) (*document.Document, []float64, error) {
    var source struct {
        ID        string         `json:"id"`
        Name      string         `json:"name"`
        Content   string         `json:"content"`
        CreatedAt time.Time      `json:"created_at"`
        UpdatedAt time.Time      `json:"updated_at"`
        Embedding []float64      `json:"embedding"`
        Metadata  map[string]any `json:"metadata"`
    }
    if err := json.Unmarshal(hitSource, &source); err != nil {
        return nil, nil, err
    }
    doc := &document.Document{
        ID:        source.ID,
        Name:      source.Name,
        Content:   source.Content,
        CreatedAt: source.CreatedAt,
        UpdatedAt: source.UpdatedAt,
        Metadata:  source.Metadata,
    }
    return doc, source.Embedding, nil
}

vs, err := elasticsearch.New(
    elasticsearch.WithAddresses(hostList),
    elasticsearch.WithUsername(username),
    elasticsearch.WithPassword(password),
    elasticsearch.WithIndexName(indexName),
    elasticsearch.WithVersion(version),
    elasticsearch.WithMaxRetries(3),
    elasticsearch.WithDocBuilder(docBuilder),   // 关键：自定义反序列化
)
```

这让 trpc-agent-go 能适配**已有索引结构**——不强制你按框架默认 schema 建索引，可复用线上 ES 已有的字段命名和映射。

### 多 host 配置

```go
hosts := util.GetEnvOrDefault("ELASTICSEARCH_HOSTS", "http://localhost:9200")
hostList := strings.Split(hosts, ",")   // 支持逗号分隔多 host
```

生产 ES 通常是集群，`ELASTICSEARCH_HOSTS` 支持多个协调节点。

### 索引刷新等待

Elasticsearch 写入后需要等刷新才能查到，[`util.WaitForIndexRefresh`](../../../../trpc-agent-go/examples/knowledge/util.go) 会 sleep 30 秒：

```go
if storeType == VectorStoreElasticsearch {
    time.Sleep(30 * time.Second)
}
```

这是 ES 的近实时特性决定的——写入到可检索有延迟（默认 1 秒 refresh interval，但大批量写入后建议显式等）。

## 运行方式

### 前置：启动 Elasticsearch

```bash
docker run -d \
  --name elasticsearch \
  -p 9200:9200 \
  -p 9300:9300 \
  -e "discovery.type=single-node" \
  -e "xpack.security.enabled=false" \
  docker.elastic.co/elasticsearch/elasticsearch:8.11.0
```

### 环境变量

| 变量 | 必需 | 说明 | 默认值 |
|------|------|------|--------|
| `ELASTICSEARCH_HOSTS` | 否 | 逗号分隔多 host | `http://localhost:9200` |
| `ELASTICSEARCH_USERNAME` | 否 | 用户名 | 空 |
| `ELASTICSEARCH_PASSWORD` | 否 | 密码 | 空 |
| `ELASTICSEARCH_API_KEY` | 否 | 替代用户名密码 | 空 |
| `ELASTICSEARCH_INDEX_NAME` | 否 | 索引名 | `trpc_agent_go` |
| `ELASTICSEARCH_VERSION` | 否 | v7/v8/v9 | `v9` |
| `OPENAI_API_KEY` | 是 | LLM + embedding | — |
| `MODEL_NAME` | 否 | 模型 | `deepseek-v4-flash` |

### 运行命令

```bash
cd examples/knowledge/vectorstores/elasticsearch
export OPENAI_API_KEY="sk-xxxx"
export ELASTICSEARCH_HOSTS="http://localhost:9200"
export ELASTICSEARCH_INDEX_NAME="trpc_agent_go"
export ELASTICSEARCH_VERSION="v9"
go run main.go
```

### 预期输出

```
🔍 Elasticsearch Vector Store Demo
===================================
📊 Elasticsearch: http://localhost:9200 (Index: trpc_agent_go, Version: v9)

📥 Indexing knowledge into Elasticsearch...
Vector store: added 23 documents

🔍 Searching Elasticsearch index...
🤖 Response: Transformers revolutionized NLP through the attention mechanism...

✅ Data indexed in Elasticsearch!
```

## 适用场景与对比

**选 elasticsearch 当：**
- 已有 ES 集群，不想引入新组件
- 需要强关键词检索 + 向量检索混合
- 需要复杂聚合分析
- 已有自定义索引映射要复用

**对比其它后端：**

| 维度 | ES | [`pgvector`](./knowledge-vectorstores-postgres.md) |
|------|-----|-----|
| 检索强项 | 关键词 + 向量 | 向量 + 全文（TSVector） |
| 事务 | ❌ | ✅ ACID |
| 元数据 UPDATE | 通过脚本 | ✅ SQL UPDATE |
| 索引映射 | 自由（DocBuilder） | 固定 |
| 运维 | 重（JVM 集群） | 中（单 PG 实例） |
| 写入延迟 | 30s 刷新 | 同步可见 |

## 关键要点

1. **混合检索强项**：ES 同时擅长关键词和向量，适合"既搜文档又搜语义"场景。
2. **多版本兼容**：v7/v8/v9 三档适配不同集群。
3. **自定义 DocBuilder**：`WithDocBuilder` 适配已有索引映射。
4. **多 host 集群**：`ELASTICSEARCH_HOSTS` 支持逗号分隔。
5. **30s 刷新等待**：ES 近实时特性要求加载后 sleep。

## 总结

Elasticsearch 是"搜索专家"的 RAG 后端——关键词 + 向量 + 聚合一应俱全。已有 ES 投入的团队选它能最大化复用基础设施。需要 ACID 事务或元数据 UPDATE 时回到 [`pgvector`](./knowledge-vectorstores-postgres.md)；需要超大规模纯向量检索时考虑 [`milvus`](./knowledge-vectorstores-milvus.md)。
