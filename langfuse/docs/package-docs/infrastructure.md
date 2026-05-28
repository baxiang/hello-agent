# 基础设施详解

Langfuse 的基础设施由六大核心服务构成，采用经典的微服务协作模式：Web 层接收请求、Worker 层异步处理、PostgreSQL 管理事务性数据、ClickHouse 存储观测事件、Redis 作为消息队列与缓存、MinIO/S3 负责事件持久化与媒体存储。

---

## 1. Docker Compose 架构

生产环境的 Docker Compose 文件定义了 6 个服务（`docker-compose.yml:6`）：

```yaml
# docker-compose.yml:6-167
services:
  langfuse-worker:   # 后台任务处理器
  langfuse-web:      # Next.js Web 应用
  clickhouse:        # 列式分析数据库
  minio:             # S3 兼容对象存储
  redis:             # 消息队列与缓存
  postgres:          # 关系型数据库
```

### 服务依赖关系

所有应用服务均依赖基础设施服务的健康检查（`docker-compose.yml:10-18`）：

```yaml
depends_on: &langfuse-depends-on
  postgres:
    condition: service_healthy
  minio:
    condition: service_healthy
  redis:
    condition: service_healthy
  clickhouse:
    condition: service_healthy
```

### langfuse-web 服务

Web 服务暴露端口 3000，是唯一对外公开的应用端口（`docker-compose.yml:71-88`）。它继承 Worker 的全部环境变量，并额外包含 NextAuth 和初始化配置：

```yaml
# docker-compose.yml:71-88
langfuse-web:
  image: docker.io/langfuse/langfuse:3
  restart: always
  depends_on: *langfuse-depends-on
  ports:
    - 3000:3000
  environment:
    <<: *langfuse-worker-env
    NEXTAUTH_SECRET: ${NEXTAUTH_SECRET:-mysecret}       # CHANGEME
    LANGFUSE_INIT_ORG_ID: ${LANGFUSE_INIT_ORG_ID:-}
    LANGFUSE_INIT_PROJECT_NAME: ${LANGFUSE_INIT_PROJECT_NAME:-}
    LANGFUSE_INIT_USER_EMAIL: ${LANGFUSE_INIT_USER_EMAIL:-}
    LANGFUSE_INIT_USER_PASSWORD: ${LANGFUSE_INIT_USER_PASSWORD:-}
```

### langfuse-worker 服务

Worker 服务端口绑定至 `127.0.0.1:3030`，仅限本地访问（`docker-compose.yml:7-69`）。它通过 BullMQ 消费 Redis 队列中的后台任务，包括事件摄取、评分执行、批量导出等。

### 开发环境变体

开发环境 `docker-compose.dev.yml` 使用更灵活的端口映射和容器命名（`docker-compose.dev.yml:1-125`），支持通过环境变量自定义端口与容器名，并使用命名网络 `langfuse-network`：

```yaml
# docker-compose.dev.yml:122-125
networks:
  default:
    name: ${DOCKER_NETWORK_NAME:-langfuse-network}
    driver: bridge
```

---

## 2. PostgreSQL

### Prisma Schema 管理

Langfuse 使用 Prisma ORM 管理 PostgreSQL schema，配置位于 `packages/shared/prisma/schema.prisma:9-14`：

```prisma
datasource db {
  provider          = "postgresql"
  url               = env("DATABASE_URL")
  directUrl         = env("DIRECT_URL")
  shadowDatabaseUrl = env("SHADOW_DATABASE_URL")
}
```

- `DATABASE_URL`：连接池 URL，用于应用运行时查询
- `DIRECT_URL`：直连 URL，用于 Prisma 迁移（需绕过连接池）
- `SHADOW_DATABASE_URL`：影子数据库 URL，用于迁移前的 schema 对比

### 连接池配置

生产环境建议通过 `DATABASE_URL` 使用 PgBouncer 等连接池代理，同时设置 `DIRECT_URL` 直连数据库以支持迁移（`.env.prod.example:8-10`）：

```bash
# .env.prod.example:8-10
DATABASE_URL="postgresql://postgres:postgres@db:5432/postgres"
# DIRECT_URL="postgresql://postgres:postgres@db:5432/postgres"
# SHADOW_DATABASE_URL=
```

### Prisma 客户端单例

数据库客户端通过单例模式创建（`packages/shared/src/db.ts:8-60`），开发环境下使用 `globalThis` 防止热重载时创建多个连接：

```typescript
// packages/shared/src/db.ts:8-20
export class PrismaClientSingleton {
  private static instance: PrismaClient;

  public static getInstance(): PrismaClient {
    if (PrismaClientSingleton.instance) {
      return PrismaClientSingleton.instance;
    }
    PrismaClientSingleton.instance = createPrismaInstance();
    return PrismaClientSingleton.instance;
  }
}

// packages/shared/src/db.ts:59-60
export const prisma =
  globalThis.prismaGlobal ?? PrismaClientSingleton.getInstance();
```

### 核心 Prisma 模型

Schema 定义了约 50+ 模型，核心模型包括（`packages/shared/prisma/schema.prisma`）：

- `User`（第 48 行）：用户账户，关联组织/项目成员关系
- `Organization`（第 93 行）：组织实体，支持 Cloud 配置
- `Project`：项目，观测数据的顶层隔离单元
- `Observation`：观测记录（span/generation/event/tool）
- `Trace`：追踪链路
- `Score`：评分
- `Prompt`：Prompt 版本管理

### PostgreSQL 服务配置

Docker Compose 中的 PostgreSQL 服务默认使用 PostgreSQL 17（`docker-compose.yml:149-166`）：

```yaml
# docker-compose.yml:149-166
postgres:
  image: docker.io/postgres:${POSTGRES_VERSION:-17}
  restart: always
  healthcheck:
    test: ["CMD-SHELL", "pg_isready -U postgres"]
    interval: 3s
    timeout: 3s
    retries: 10
  environment:
    POSTGRES_USER: ${POSTGRES_USER:-postgres}
    POSTGRES_PASSWORD: ${POSTGRES_PASSWORD:-postgres}   # CHANGEME
    POSTGRES_DB: ${POSTGRES_DB:-postgres}
    TZ: UTC
    PGTZ: UTC
  volumes:
    - langfuse_postgres_data:/var/lib/postgresql/data
```

开发环境额外启用全量 SQL 日志（`docker-compose.dev.yml:94`）：

```yaml
command: ["postgres", "-c", "log_statement=all"]
```

---

## 3. ClickHouse

### 表结构与分区策略

ClickHouse 是 Langfuse 的观测事件存储引擎，核心表均采用 **按月分区**（`toYYYYMM`）策略：

#### traces 表

```sql
-- packages/shared/clickhouse/migrations/unclustered/0001_traces.up.sql:1-32
CREATE TABLE traces (
    `id` String,
    `timestamp` DateTime64(3),
    `name` String,
    `user_id` Nullable(String),
    `metadata` Map(LowCardinality(String), String),
    `release` Nullable(String),
    `version` Nullable(String),
    `project_id` String,
    `public` Bool,
    `bookmarked` Bool,
    `tags` Array(String),
    `input` Nullable(String) CODEC(ZSTD(3)),       -- 大文本字段 ZSTD 压缩
    `output` Nullable(String) CODEC(ZSTD(3)),
    `session_id` Nullable(String),
    `created_at` DateTime64(3) DEFAULT now(),
    updated_at DateTime64(3) DEFAULT now(),
    `event_ts` DateTime64(3),                       -- 版本去重依据
    `is_deleted` UInt8,                             -- 软删除标记
    INDEX idx_id id TYPE bloom_filter(0.001) GRANULARITY 1,
    INDEX idx_res_metadata_key mapKeys(metadata) TYPE bloom_filter(0.01) GRANULARITY 1,
    INDEX idx_res_metadata_value mapValues(metadata) TYPE bloom_filter(0.01) GRANULARITY 1
) ENGINE = ReplacingMergeTree(event_ts, is_deleted)
  Partition by toYYYYMM(timestamp)                  -- 按月分区
  PRIMARY KEY (project_id, toDate(timestamp))
  ORDER BY (project_id, toDate(timestamp), id);
```

#### observations 表

```sql
-- packages/shared/clickhouse/migrations/unclustered/0002_observations.up.sql:1-47
CREATE TABLE observations (
    `id` String,
    `trace_id` String,
    `project_id` String,
    `type` LowCardinality(String),                  -- span/generation/event/tool
    `parent_observation_id` Nullable(String),
    `start_time` DateTime64(3),
    `end_time` Nullable(DateTime64(3)),
    `input` Nullable(String) CODEC(ZSTD(3)),
    `output` Nullable(String) CODEC(ZSTD(3)),
    `provided_model_name` Nullable(String),
    -- ... 用量、费用等更多字段
) ENGINE = ReplacingMergeTree(event_ts, is_deleted)
  Partition by toYYYYMM(start_time)                 -- 按月分区
  PRIMARY KEY (project_id, `type`, toDate(start_time))
  ORDER BY (project_id, `type`, toDate(start_time), id);
```

#### scores 表

```sql
-- packages/shared/clickhouse/migrations/unclustered/0003_scores.up.sql:1-33
CREATE TABLE scores (
    `id` String,
    `timestamp` DateTime64(3),
    `project_id` String,
    `trace_id` String,
    `observation_id` Nullable(String),
    `name` String,
    `value` Float64,
    `source` String,
    `comment` Nullable(String) CODEC(ZSTD(1)),     -- 压缩级别 1
    `data_type` String,
    -- ...
) ENGINE = ReplacingMergeTree(event_ts, is_deleted)
  Partition by toYYYYMM(timestamp)
  PRIMARY KEY (project_id, toDate(timestamp), name)
  ORDER BY (project_id, toDate(timestamp), name, id);
```

### ReplacingMergeTree 引擎

所有核心表使用 `ReplacingMergeTree` 引擎，支持基于 `event_ts` 的版本去重与 `is_deleted` 的软删除标记：

```sql
ENGINE = ReplacingMergeTree(event_ts, is_deleted)
```

- `event_ts`：事件时间戳，用于确定最新版本
- `is_deleted`：UInt8 类型，标记为 1 表示已删除

后台合并时，同一排序键的多条记录仅保留 `event_ts` 最大且 `is_deleted=0` 的版本。查询时如需确保读到最新数据，须使用 `FINAL` 修饰符。

### ZSTD 压缩

大文本字段使用 ZSTD 压缩（`0001_traces.up.sql:13-14`、`0003_scores.up.sql:10`）：

| 表 | 字段 | 压缩级别 |
|---|---|---|
| traces | input, output | ZSTD(3) |
| observations | input, output | ZSTD(3) |
| scores | comment | ZSTD(1) |

ZSTD 压缩级别越高压缩率越好但 CPU 开销越大，Langfuse 对不同字段选择了不同级别以平衡性能与存储。

### Bloom Filter 索引

为加速 ad-hoc 查询，表上建有 Bloom Filter 跳数索引（`0001_traces.up.sql:20-22`、`0002_observations.up.sql:32-34`）：

```sql
INDEX idx_id id TYPE bloom_filter(0.001) GRANULARITY 1,                    -- 0.1% 误报率
INDEX idx_trace_id trace_id TYPE bloom_filter() GRANULARITY 1,             -- 默认误报率
INDEX idx_res_metadata_key mapKeys(metadata) TYPE bloom_filter(0.01) GRANULARITY 1,
```

### ClickHouse Writer

Worker 通过 `ClickhouseWriter` 单例批量写入数据（`worker/src/services/ClickhouseWriter/index.ts:32-62`），支持：

- 可配置的批量大小与写入间隔
- 指数退避重试（最多 `LANGFUSE_INGESTION_CLICKHOUSE_MAX_ATTEMPTS` 次）
- 自动截断超大字段（1MB 安全阈值）
- Decimal64(12) 溢出保护

```typescript
// worker/src/services/ClickhouseWriter/index.ts:43-61
private constructor() {
  this.batchSize = env.LANGFUSE_INGESTION_CLICKHOUSE_WRITE_BATCH_SIZE;
  this.writeInterval = env.LANGFUSE_INGESTION_CLICKHOUSE_WRITE_INTERVAL_MS;
  this.maxAttempts = env.LANGFUSE_INGESTION_CLICKHOUSE_MAX_ATTEMPTS;
  this.queue = {
    [TableName.Traces]: [],
    [TableName.Scores]: [],
    [TableName.Observations]: [],
    [TableName.EventsFull]: [],
    // ...
  };
  this.start();
}
```

### ClickHouse 服务配置

```yaml
# docker-compose.yml:90-109
clickhouse:
  image: docker.io/clickhouse/clickhouse-server
  restart: always
  user: "101:101"
  environment:
    CLICKHOUSE_DB: default
    CLICKHOUSE_USER: ${CLICKHOUSE_USER:-clickhouse}
    CLICKHOUSE_PASSWORD: ${CLICKHOUSE_PASSWORD:-clickhouse}  # CHANGEME
  volumes:
    - langfuse_clickhouse_data:/var/lib/clickhouse
    - langfuse_clickhouse_logs:/var/log/clickhouse-server
  healthcheck:
    test: wget --no-verbose --tries=1 --spider http://localhost:8123/ping || exit 1
    interval: 5s
```


---

## 4. Redis

### BullMQ 队列系统

Langfuse 使用 Redis + BullMQ 实现异步任务处理，队列定义集中在 `packages/shared/src/server/queues.ts:324-361`：

```typescript
// packages/shared/src/server/queues.ts:324-361
export enum QueueName {
  TraceUpsert = "trace-upsert",                              // 追踪更新事件
  IngestionQueue = "ingestion-queue",                        // SDK 事件摄取
  IngestionSecondaryQueue = "secondary-ingestion-queue",     // 低优先级摄取
  OtelIngestionQueue = "otel-ingestion-queue",               // OTel 事件摄取
  EvaluationExecution = "evaluation-execution-queue",        // 评估执行
  LLMAsJudgeExecution = "llm-as-a-judge-execution-queue",   // LLM 评审
  CodeEvalExecution = "code-eval-execution-queue",           // 代码评估
  BatchExport = "batch-export-queue",                         // 批量导出
  BatchActionQueue = "batch-action-queue",                    // 批量操作
  DataRetentionQueue = "data-retention-queue",                // 数据保留清理
  WebhookQueue = "webhook-queue",                             // Webhook 推送
  DeadLetterRetryQueue = "dead-letter-retry-queue",           // 死信重试
  // ... 更多队列
}
```

### 队列分片

高吞吐队列支持分片，通过 SHA-256 一致性哈希分配到不同分片（`packages/shared/src/server/redis/sharding.ts:9-19`）：

```typescript
// packages/shared/src/server/redis/sharding.ts:9-19
export function getShardIndex(key: string, shardCount: number): number {
  if (shardCount <= 1) return 0;
  const hash = createHash("sha256").update(key).digest("hex");
  const hashInt = parseInt(hash.substring(0, 8), 16);
  return hashInt % shardCount;
}
```

分片数量通过环境变量控制（`packages/shared/src/env.ts:129-158`）：

```typescript
// packages/shared/src/env.ts:129-158
LANGFUSE_INGESTION_QUEUE_SHARD_COUNT: z.coerce.number().positive().default(1),
LANGFUSE_OTEL_INGESTION_QUEUE_SHARD_COUNT: z.coerce.number().positive().default(1),
LANGFUSE_EVAL_EXECUTION_QUEUE_SHARD_COUNT: z.coerce.number().positive().default(1),
LANGFUSE_LLM_AS_JUDGE_EXECUTION_QUEUE_SHARD_COUNT: z.coerce.number().positive().default(1),
```

### Redis 连接配置

Redis 连接支持单节点、集群和哨兵三种模式（`packages/shared/src/server/redis/redis.ts:183-229`）：

```typescript
// packages/shared/src/server/redis/redis.ts:183-229
export const createNewRedisInstance = (
  additionalOptions: Partial<RedisOptions> = {},
): Redis | Cluster | null => {
  if (env.REDIS_CLUSTER_ENABLED === "true") {
    return createRedisClusterInstance(additionalOptions);
  }
  if (env.REDIS_SENTINEL_ENABLED === "true") {
    return createRedisSentinelInstance(additionalOptions);
  }
  // 单节点模式
  const instance = env.REDIS_CONNECTION_STRING
    ? new Redis(env.REDIS_CONNECTION_STRING, { ... })
    : env.REDIS_HOST
      ? new Redis({ host: String(env.REDIS_HOST), port: Number(env.REDIS_PORT), ... })
      : null;
  return instance;
};
```

集群模式使用 Hash Tag 确保同一队列的所有键位于同一节点（`packages/shared/src/server/redis/redis.ts:236-250`）：

```typescript
// packages/shared/src/server/redis/redis.ts:236-250
export const getQueuePrefix = (queueName: string): string | undefined => {
  const redisKeyPrefix = env.REDIS_KEY_PREFIX;
  if (env.REDIS_CLUSTER_ENABLED === "true") {
    // 使用 hash tag 确保同一队列键在同一 slot
    return redisKeyPrefix
      ? `{${redisKeyPrefix}:${queueName}}`
      : `{${queueName}}`;
  }
  return redisKeyPrefix ?? undefined;
};
```

### 缓存层

除 BullMQ 队列外，Redis 还用于 API Key 缓存（TTL 300 秒）和 Prompt 缓存（TTL 3600 秒），配置见 `packages/shared/src/env.ts:79-80`：

```typescript
LANGFUSE_CACHE_PROMPT_ENABLED: z.enum(["true", "false"]).default("true"),
LANGFUSE_CACHE_PROMPT_TTL_SECONDS: z.coerce.number().default(3600), // 1 小时
```

同时存在基于 `lru-cache` 的进程内本地缓存（`packages/shared/src/server/cache/localCache.ts:18-49`），用于模型匹配等高频查询的二级加速。

### Redis 服务配置

```yaml
# docker-compose.yml:132-147
redis:
  image: docker.io/redis:7
  restart: always
  command: >
    --requirepass ${REDIS_AUTH:-myredissecret}
    --maxmemory-policy noeviction
  healthcheck:
    test: ["CMD", "redis-cli", "ping"]
    interval: 3s
    timeout: 10s
    retries: 10
```

`maxmemory-policy noeviction` 确保队列消息不会被 Redis 淘汰。

---

## 5. S3/MinIO

### 事件持久化

所有摄取的事件先写入 S3/MinIO，再由 Worker 从 S3 读取处理。事件上传配置（`docker-compose.yml:36-42`）：

```yaml
# docker-compose.yml:36-42
LANGFUSE_S3_EVENT_UPLOAD_BUCKET: ${LANGFUSE_S3_EVENT_UPLOAD_BUCKET:-langfuse}
LANGFUSE_S3_EVENT_UPLOAD_REGION: ${LANGFUSE_S3_EVENT_UPLOAD_REGION:-auto}
LANGFUSE_S3_EVENT_UPLOAD_ACCESS_KEY_ID: ${LANGFUSE_S3_EVENT_UPLOAD_ACCESS_KEY_ID:-minio}
LANGFUSE_S3_EVENT_UPLOAD_SECRET_ACCESS_KEY: ${LANGFUSE_S3_EVENT_UPLOAD_SECRET_ACCESS_KEY:-miniosecret}
LANGFUSE_S3_EVENT_UPLOAD_ENDPOINT: ${LANGFUSE_S3_EVENT_UPLOAD_ENDPOINT:-http://minio:9000}
LANGFUSE_S3_EVENT_UPLOAD_FORCE_PATH_STYLE: ${LANGFUSE_S3_EVENT_UPLOAD_FORCE_PATH_STYLE:-true}
LANGFUSE_S3_EVENT_UPLOAD_PREFIX: ${LANGFUSE_S3_EVENT_UPLOAD_PREFIX:-events/}
```

事件文件通过 ClickHouse `blob_storage_file_log` 表追踪（`packages/shared/clickhouse/migrations/unclustered/0011_add_blob_storage_file_log.up.sql:1-22`）：

```sql
-- 0011_add_blob_storage_file_log.up.sql:1-22
CREATE TABLE blob_storage_file_log (
    `id`          String,
    `project_id`  String,
    `entity_type` String,
    `entity_id`   String,
    `event_id`    String,
    `bucket_name` String,
    `bucket_path` String,
    `created_at`  DateTime64(3) DEFAULT now(),
    `updated_at`  DateTime64(3) DEFAULT now(),
    event_ts DateTime64(3),
    is_deleted UInt8,
) ENGINE = ReplacingMergeTree(event_ts, is_deleted)
  ORDER BY (project_id, entity_type, entity_id, event_id);
```

### 媒体存储

多模态媒体文件（图片、文件等）存储于独立的 S3 路径（`docker-compose.yml:43-49`）：

```yaml
LANGFUSE_S3_MEDIA_UPLOAD_BUCKET: ${LANGFUSE_S3_MEDIA_UPLOAD_BUCKET:-langfuse}
LANGFUSE_S3_MEDIA_UPLOAD_REGION: ${LANGFUSE_S3_MEDIA_UPLOAD_REGION:-auto}
LANGFUSE_S3_MEDIA_UPLOAD_ACCESS_KEY_ID: ${LANGFUSE_S3_MEDIA_UPLOAD_ACCESS_KEY_ID:-minio}
LANGFUSE_S3_MEDIA_UPLOAD_SECRET_ACCESS_KEY: ${LANGFUSE_S3_MEDIA_UPLOAD_SECRET_ACCESS_KEY:-miniosecret}
LANGFUSE_S3_MEDIA_UPLOAD_ENDPOINT: ${LANGFUSE_S3_MEDIA_UPLOAD_ENDPOINT:-http://localhost:9090}
LANGFUSE_S3_MEDIA_UPLOAD_FORCE_PATH_STYLE: ${LANGFUSE_S3_MEDIA_UPLOAD_FORCE_PATH_STYLE:-true}
LANGFUSE_S3_MEDIA_UPLOAD_PREFIX: ${LANGFUSE_S3_MEDIA_UPLOAD_PREFIX:-media/}
```

注意媒体上传的 Endpoint 使用 `localhost:9090`（外部访问），而事件上传使用 `minio:9000`（内部访问）。

### 批量导出

支持将数据导出至 S3（`docker-compose.yml:50-58`）：

```yaml
LANGFUSE_S3_BATCH_EXPORT_ENABLED: ${LANGFUSE_S3_BATCH_EXPORT_ENABLED:-false}
LANGFUSE_S3_BATCH_EXPORT_BUCKET: ${LANGFUSE_S3_BATCH_EXPORT_BUCKET:-langfuse}
LANGFUSE_S3_BATCH_EXPORT_PREFIX: ${LANGFUSE_S3_BATCH_EXPORT_PREFIX:-exports/}
LANGFUSE_S3_BATCH_EXPORT_REGION: ${LANGFUSE_S3_BATCH_EXPORT_REGION:-auto}
LANGFUSE_S3_BATCH_EXPORT_ENDPOINT: ${LANGFUSE_S3_BATCH_EXPORT_ENDPOINT:-http://minio:9000}
LANGFUSE_S3_BATCH_EXPORT_ACCESS_KEY_ID: ${LANGFUSE_S3_BATCH_EXPORT_ACCESS_KEY_ID:-minio}
LANGFUSE_S3_BATCH_EXPORT_SECRET_ACCESS_KEY: ${LANGFUSE_S3_BATCH_EXPORT_SECRET_ACCESS_KEY:-miniosecret}
```

### MinIO 服务配置

```yaml
# docker-compose.yml:111-130
minio:
  image: cgr.dev/chainguard/minio
  restart: always
  entrypoint: sh
  command: -c 'mkdir -p /data/langfuse && minio server --address :9000 --console-address :9001 /data'
  environment:
    MINIO_ROOT_USER: ${MINIO_ROOT_USER:-minio}
    MINIO_ROOT_PASSWORD: ${MINIO_ROOT_PASSWORD:-miniosecret}  # CHANGEME
  ports:
    - 9090:9000       # S3 API（外部访问）
    - 127.0.0.1:9091:9001  # 管理控制台（仅本地）
  volumes:
    - langfuse_minio_data:/data
  healthcheck:
    test: ["CMD", "mc", "ready", "local"]
    interval: 1s
```

启动时自动创建 `langfuse` 桶。除 MinIO 外，还支持 AWS S3、Azure Blob、GCS 和 OCI 对象存储，通过环境变量切换（`packages/shared/src/env.ts:237-256`）。

---

## 6. 关键环境变量

### 必需配置

| 变量 | 说明 | 默认值 |
|---|---|---|
| `DATABASE_URL` | PostgreSQL 连接 URL | - |
| `CLICKHOUSE_URL` | ClickHouse HTTP 接口 | - |
| `CLICKHOUSE_USER` | ClickHouse 用户名 | - |
| `CLICKHOUSE_PASSWORD` | ClickHouse 密码 | - |
| `REDIS_HOST` | Redis 主机 | - |
| `REDIS_AUTH` | Redis 密码 | - |
| `NEXTAUTH_SECRET` | NextAuth 密钥 | - |
| `SALT` | API Key 哈希盐值 | - |
| `ENCRYPTION_KEY` | 数据加密密钥（64 位 hex） | - |
| `LANGFUSE_S3_EVENT_UPLOAD_BUCKET` | S3 事件桶 | - |

### 摄取调优

| 变量 | 说明 | 默认值 |
|---|---|---|
| `LANGFUSE_INGESTION_QUEUE_DELAY_MS` | 摄取队列延迟 | 15000 |
| `LANGFUSE_INGESTION_CLICKHOUSE_WRITE_BATCH_SIZE` | CH 批量写入大小 | - |
| `LANGFUSE_INGESTION_CLICKHOUSE_WRITE_INTERVAL_MS` | CH 写入间隔 | - |
| `LANGFUSE_INGESTION_CLICKHOUSE_MAX_ATTEMPTS` | CH 写入最大重试 | - |
| `LANGFUSE_INGESTION_QUEUE_SHARD_COUNT` | 摄取队列分片数 | 1 |

### ClickHouse 调优

| 变量 | 说明 | 默认值 |
|---|---|---|
| `CLICKHOUSE_CLUSTER_ENABLED` | 集群模式 | false |
| `CLICKHOUSE_USE_LIGHTWEIGHT_UPDATE` | 轻量更新 | false |
| `CLICKHOUSE_MAX_OPEN_CONNECTIONS` | 最大连接数 | 25 |

---

## 7. 部署模式

### Docker Compose（推荐自托管）

```bash
# 1. 克隆仓库并进入目录
git clone https://github.com/langfuse/langfuse.git
cd langfuse

# 2. 配置环境变量
cp .env.prod.example .env
# 编辑 .env 设置密码和密钥

# 3. 启动所有服务
docker compose up -d

# 4. 访问 http://localhost:3000
```

从源码构建使用 `docker-compose.build.yml`（`docker-compose.build.yml:1-60`），它从本地 Dockerfile 构建镜像而非拉取预构建镜像。

### Kubernetes

生产级 Kubernetes 部署需要：

1. **PostgreSQL**：使用云托管 RDS 或自建 HA 集群，配置 `DATABASE_URL` 与 `DIRECT_URL`
2. **ClickHouse**：建议使用 ClickHouse Cloud 或自建集群，通过 `CLICKHOUSE_CLUSTER_ENABLED=true` 启用集群模式
3. **Redis**：使用 ElastiCache/Redis Cloud 等，支持集群模式（`REDIS_CLUSTER_ENABLED=true`）和哨兵模式（`REDIS_SENTINEL_ENABLED=true`）
4. **S3**：使用 AWS S3 / GCS / Azure Blob，配置对应的 Endpoint 和凭证
5. **Web 与 Worker**：分别部署为独立 Deployment，Worker 水平扩展以增加摄取吞吐量

Worker 各队列的启停通过环境变量独立控制（`worker/src/app.ts:128-634`），如：

```bash
QUEUE_CONSUMER_INGESTION_QUEUE_IS_ENABLED=true
QUEUE_CONSUMER_TRACE_UPSERT_QUEUE_IS_ENABLED=true
QUEUE_CONSUMER_EVAL_EXECUTION_QUEUE_IS_ENABLED=true
QUEUE_CONSUMER_BATCH_EXPORT_QUEUE_IS_ENABLED=true
```

这使得 Worker 可以按功能拆分为多个 Deployment，每个专注于特定队列，实现独立扩缩容。
