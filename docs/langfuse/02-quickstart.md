# Langfuse 快速入门

## 1. 环境搭建

### 1.1 Docker Compose 一键启动

Langfuse 提供 Docker Compose 配置，包含所有依赖服务（`docker-compose.yml`）：

```bash
# 克隆仓库
git clone https://github.com/langfuse/langfuse.git
cd langfuse

# 使用生产配置启动
docker compose up -d
```

启动后包含 6 个服务（`docker-compose.yml:6-167`）：

| 服务 | 镜像 | 端口 | 说明 |
|------|------|------|------|
| `langfuse-web` | `langfuse:3` | `3000` | Web UI + API |
| `langfuse-worker` | `langfuse-worker:3` | `3030` | 后台任务处理 |
| `postgres` | `postgres:17` | `5432` | 事务数据库 |
| `clickhouse` | `clickhouse-server` | `8123/9000` | 分析数据库 |
| `redis` | `redis:7` | `6379` | 消息队列 |
| `minio` | `chainguard/minio` | `9090` | S3 兼容对象存储 |

所有服务依赖 `service_healthy` 条件（`docker-compose.yml:11-18`），确保启动顺序正确。

### 1.2 关键环境变量

以下环境变量必须修改（标记 `# CHANGEME`）：

```bash
# 数据库（docker-compose.yml:23）
DATABASE_URL=postgresql://postgres:postgres@postgres:5432/postgres

# 加密密钥（docker-compose.yml:25）
ENCRYPTION_KEY=<openssl rand -hex 32>

# S3 存储（docker-compose.yml:37-39）
LANGFUSE_S3_EVENT_UPLOAD_BUCKET=langfuse
LANGFUSE_S3_EVENT_UPLOAD_ACCESS_KEY_ID=minio
LANGFUSE_S3_EVENT_UPLOAD_SECRET_ACCESS_KEY=miniosecret

# Redis（docker-compose.yml:63）
REDIS_AUTH=myredissecret

# NextAuth（docker-compose.yml:79）
NEXTAUTH_SECRET=mysecret
```

### 1.3 开发模式

如需本地开发调试：

```bash
# 安装依赖
pnpm install

# 生成 Prisma 客户端
pnpm --filter @langfuse/shared run db:generate

# 启动开发服务器（web + worker）
pnpm run dev
```

开发模式配置参见 `docker-compose.dev.yml`，支持热重载。

### 1.4 初始化项目

首次启动后，通过环境变量自动创建初始组织、项目和用户（`docker-compose.yml:80-88`）：

```bash
LANGFUSE_INIT_ORG_ID=my-org
LANGFUSE_INIT_ORG_NAME="My Organization"
LANGFUSE_INIT_PROJECT_ID=my-project
LANGFUSE_INIT_PROJECT_NAME="My Project"
LANGFUSE_INIT_USER_EMAIL=admin@example.com
LANGFUSE_INIT_USER_NAME=Admin
LANGFUSE_INIT_USER_PASSWORD=changeme
```

## 2. 最简 Tracing

### 2.1 安装 SDK

```bash
pip install langfuse
```

### 2.2 初始化与基本用法

```python
from langfuse import Langfuse

# 初始化客户端，连接本地 Langfuse 实例
langfuse = Langfuse(
    public_key="pk-...",   # 在 Settings > API Keys 中获取
    secret_key="sk-...",
    host="http://localhost:3000"
)

# 创建 Trace（一次完整调用追踪）
trace = langfuse.trace(
    name="my-trace",
    user_id="user-123",
    metadata={"environment": "development"}
)

# 创建 Span（追踪中的耗时操作）
span = trace.span(
    name="retrieval",
    input={"query": "什么是 Langfuse?"}
)

# 创建 Generation（LLM 调用，含 token 与成本信息）
generation = span.generation(
    name="llm-call",
    model="gpt-4o",
    model_parameters={"temperature": 0.7},
    input={"prompt": "请解释什么是可观测性"},
    usage={"input": 15, "output": 42, "unit": "TOKENS"}
)

# 结束 Generation，记录输出
generation.end(
    output={"text": "可观测性是指..."}
)

# 结束 Span
span.end()

# 更新 Trace 的输出
trace.update(output={"answer": "可观测性是指..."})
```

### 2.3 上下文管理器写法

```python
# 使用 with 语句自动管理 Span 生命周期
with langfuse.trace(name="qa-pipeline") as trace:
    # 检索阶段
    with trace.span(name="retrieval") as retrieval:
        docs = retrieve_documents("什么是 Langfuse?")
        retrieval.update(output={"docs": docs})

    # 生成阶段
    with retrieval.generation(
        name="llm-call",
        model="gpt-4o",
        input={"context": docs, "question": "什么是 Langfuse?"}
    ) as generation:
        answer = call_llm(docs, "什么是 Langfuse?")
        generation.end(output={"answer": answer}, usage={"input": 20, "output": 50})

    trace.update(output={"answer": answer})
```

### 2.4 装饰器写法

```python
@langfuse.observe(name="translate")
def translate(text: str, target_lang: str) -> str:
    # 函数自动被包装为 Trace + Generation
    result = call_translation_api(text, target_lang)
    return result

# 调用时自动追踪
result = translate("Hello", "zh-CN")
```

### 2.5 数据模型映射

SDK 发送的事件类型与域模型的对应关系（`packages/shared/src/server/ingestion/types.ts`）：

| SDK 方法 | 事件类型 | 域模型 | ObservationType |
|----------|----------|--------|-----------------|
| `trace()` | `trace-create` | `TraceDomain` | - |
| `span()` | `span-create` | `ObservationDomain` | `SPAN` |
| `generation()` | `generation-create` | `ObservationSchema` | `GENERATION` |
| `event()` | `event-create` | `ObservationDomain` | `EVENT` |
| `score()` | `score-create` | `ScoreSchema` | - |

事件通过 `POST /api/public/ingestion`（`web/src/pages/api/public/ingestion.ts:50`）提交，验证后上传至 S3 并入队异步处理。
## 3. LangChain 集成

### 3.1 基本集成

```python
from langfuse.callback import CallbackHandler

# 创建回调处理器
langfuse_handler = CallbackHandler(
    public_key="pk-...",
    secret_key="sk-...",
    host="http://localhost:3000"
)

# 传入 LangChain 链
from langchain_openai import ChatOpenAI
from langchain_core.prompts import ChatPromptTemplate

llm = ChatOpenAI(model="gpt-4o")
prompt = ChatPromptTemplate.from_messages([
    ("system", "你是一个有用的助手"),
    ("human", "{input}")
])
chain = prompt | llm

# 通过 callbacks 参数传入
result = chain.invoke(
    {"input": "什么是 Langfuse?"},
    config={"callbacks": [langfuse_handler]}
)

# 获取 Langfuse Trace URL
print(langfuse_handler.get_trace_url())
```

### 3.2 自动追踪映射

CallbackHandler 自动将 LangChain 组件映射为 Langfuse 观测类型：

```mermaid
graph TB
    LC_CHAIN["LangChain Chain"] --> LF_TRACE["Langfuse Trace"]
    LC_LLM["LangChain LLM"] --> LF_GEN["Langfuse Generation"]
    LC_TOOL["LangChain Tool"] --> LF_SPAN["Langfuse Span"]
    LC_RETRIEVER["LangChain Retriever"] --> LF_RET["Langfuse Retriever"]
    LC_AGENT["LangChain Agent"] --> LF_AGENT["Langfuse Agent"]
```

### 3.3 多轮对话追踪

```python
# 每次调用使用相同的 session_id 关联多轮对话
handler1 = CallbackHandler(
    public_key="pk-...", secret_key="sk-...",
    host="http://localhost:3000",
    session_id="session-abc123"
)

# 第一轮
chain.invoke({"input": "你好"}, config={"callbacks": [handler1]})

# 第二轮（同一会话）
handler2 = CallbackHandler(
    public_key="pk-...", secret_key="sk-...",
    host="http://localhost:3000",
    session_id="session-abc123"
)
chain.invoke({"input": "继续"}, config={"callbacks": [handler2]})
```

## 4. OpenTelemetry 集成

### 4.1 OTLP 导出

Langfuse Worker 提供 `otelIngestionQueue`（`queues.ts:334`）处理 OTLP 格式数据，支持任何兼容 OpenTelemetry 的框架：

```python
from opentelemetry.sdk.trace import TracerProvider
from opentelemetry.sdk.trace.export import BatchSpanProcessor
from opentelemetry.exporter.otlp.proto.grpc.trace_exporter import OTLPSpanExporter

# 配置 OTLP 导出到 Langfuse
otlp_exporter = OTLPSpanExporter(
    endpoint="http://localhost:3000/api/public/otel",
    headers={
        "Authorization": "Bearer pk-...:sk-..."
    }
)

provider = TracerProvider()
provider.add_span_processor(BatchSpanProcessor(otlp_exporter))
```

### 4.2 OTLP Span 到 Langfuse 模型映射

| OTLP Span 属性 | Langfuse 映射 |
|----------------|---------------|
| `trace_id` | `Trace.id` |
| `span_id` | `Observation.id` |
| `parent_span_id` | `Observation.parentObservationId` |
| `name` | `Observation.name` |
| `kind` (SERVER/CLIENT) | `Observation.type` 映射 |
| `start_time` / `end_time` | `Observation.startTime` / `endTime` |
| `attributes` | `Observation.metadata` + 专用字段 |

### 4.3 Vercel AI SDK 集成

```typescript
// Next.js + Vercel AI SDK 配置
import { generateText } from 'ai';

const result = await generateText({
  model: openai('gpt-4o'),
  prompt: 'Hello',
  experimental_telemetry: {
    isEnabled: true,
    functionId: 'my-function',
    metadata: { langfusePrompt: 'my-prompt' }
  }
});
```

## 5. 评分

### 5.1 手动评分（ANNOTATION）

通过 UI 或 API 手动添加评分，ANNOTATION 来源的 Score 必须关联 Score Config（`scores.ts:30-31`）：

```python
# 通过 SDK 添加评分
trace.score(
    name="quality",
    value=0.85,
    data_type="NUMERIC",
    comment="输出质量良好"
)
```

Score 数据类型（`packages/shared/src/domain/scores.ts:46-61`）：

| 类型 | 说明 | 值域 |
|------|------|------|
| `NUMERIC` | 数值型 | 任意数值（可配 min/max） |
| `CATEGORICAL` | 分类型 | 预定义分类值 |
| `BOOLEAN` | 布尔型 | 0 (False) / 1 (True) |
| `TEXT` | 文本型 | 最多 500 字符（`TEXT_SCORE_MAX_LENGTH`，`scores.ts:44`） |
| `CORRECTION` | 纠正型 | 无 stringValue，提供修正输出 |

### 5.2 API 评分

通过 REST API 程序化添加评分：

```bash
curl -X POST http://localhost:3000/api/public/scores \
  -H "Authorization: Bearer pk-...:sk-..." \
  -H "Content-Type: application/json" \
  -d '{
    "traceId": "trace-123",
    "name": "relevance",
    "value": 0.9,
    "source": "API",
    "dataType": "NUMERIC",
    "comment": "高度相关"
  }'
```

注意：`EVAL` 来源仅供内部评估器使用，外部 API 调用只能使用 `API` 或 `ANNOTATION`（`scores.ts:18-21`）。

### 5.3 LLM-as-Judge

Langfuse 内置 LLM-as-Judge 评估能力，评估执行流程：

```mermaid
graph TB
    TRIGGER["触发条件<br/>Trace Upsert / Dataset Run"] --> CREATE["CreateEvalQueue<br/>创建评估任务"]
    CREATE --> EXEC["LLMAsJudgeExecutionQueue<br/>执行 LLM 评估"]
    EXEC --> LLM_CALL["调用 LLM<br/>如 GPT-4o/Claude"]
    LLM_CALL --> SCORE["写入 Score<br/>source=EVAL"]
    SCORE --> DASHBOARD["仪表盘展示<br/>聚合分析"]
```

配置 LLM-as-Judge 评估器：

1. 在 UI 中创建 Eval Template，选择 `LLM-as-Judge` 类型
2. 编写评估 Prompt（如"判断输出是否准确"）
3. 配置触发条件（每次 Trace 创建时 / 特定过滤条件）
4. 选择执行模型（GPT-4o / Claude 等）

评估执行时，`evalJobExecutorQueueProcessorBuilder`（`evalQueue.ts`）创建评估任务，`llmAsJudgeExecutionQueueProcessorBuilder` 执行 LLM 推理，结果以 `EVAL` 来源的 Score 写入。

### 5.4 Code Eval

除 LLM-as-Judge 外，还支持自定义代码评估（`CodeEvalExecutionQueue`，`queues.ts:331`），在沙箱中执行用户定义的 Python/TypeScript 评估逻辑。
## 6. Prompt Management

### 6.1 版本化提示管理

Langfuse 提供 Prompt 的版本化管理，支持多版本共存与标签路由：

```python
from langfuse import Langfuse

langfuse = Langfuse(
    public_key="pk-...",
    secret_key="sk-...",
    host="http://localhost:3000"
)

# 获取特定版本的 Prompt
prompt = langfuse.get_prompt("my-prompt", version=3)

# 获取带有特定标签的 Prompt（如 production 标签）
prompt = langfuse.get_prompt("my-prompt", label="production")

# 编译 Prompt（替换变量）
compiled = prompt.compile(variable_name="value")

# 直接用于 LLM 调用并自动追踪
generation = trace.generation(
    name="llm-call",
    prompt=prompt,  # 自动关联 Prompt 版本
    model=prompt.config.get("model", "gpt-4o"),
    input={"prompt": compiled}
)
```

### 6.2 Prompt 域模型

```typescript
// packages/shared/src/domain/prompts.ts:4-19
export const PromptDomainSchema = z.object({
  id: z.string(),
  name: z.string(),                    // 项目内唯一键
  version: z.number(),                 // 自增版本号
  isActive: z.boolean().nullable(),    // 是否为活跃版本
  type: z.string().default("text"),   // text / chat
  tags: z.array(z.string()).default([]),     // 搜索标签
  labels: z.array(z.string()).default([]),   // 环境标签
  prompt: jsonSchemaNullable,          // 提示内容
  config: jsonSchemaNullable,          // 模型配置
  commitMessage: z.string().nullable(), // 版本说明
});
```

### 6.3 标签路由

Prompt 通过 `labels` 实现环境级路由：

```mermaid
graph LR
    SDK_GET["SDK: get_prompt<br/>label=production"] --> V2["Prompt v2<br/>labels=[production]"]
    SDK_DEV["SDK: get_prompt<br/>label=staging"] --> V3["Prompt v3<br/>labels=[staging]"]
    SDK_VER["SDK: get_prompt<br/>version=1"] --> V1["Prompt v1<br/>无标签"]
```

### 6.4 Prompt 变更自动化

Prompt 版本变更可触发 Webhook 自动化（`packages/shared/src/domain/automations.ts:5-8`）：

- `TriggerEventSource.Prompt`：Prompt 创建/更新时触发
- 动作类型：`WEBHOOK` / `SLACK` / `GITHUB_DISPATCH`（`automations.ts:43`）

变更事件通过 `EntityChangeQueue`（`queues.ts:258-272`）和 `WebhookQueue`（`queues.ts:235-253`）处理，Payload 使用 `WebhookOutboundEnvelopeSchema`。

## 7. 常见问题

### Q1: Docker Compose 启动后 Web 页面无法访问？

检查所有服务是否健康：

```bash
docker compose ps
# 确认所有服务 Status 为 healthy
```

常见原因：
- PostgreSQL 未就绪：`pg_isready` 健康检查（`docker-compose.yml:153`）
- ClickHouse 未就绪：`wget` 健康检查（`docker-compose.yml:105`）
- Redis 未就绪：`redis-cli ping` 检查（`docker-compose.yml:144`）

### Q2: SDK 事件提交后 UI 看不到数据？

Langfuse 采用异步摄入流程（`processEventBatch.ts:99`），数据延迟取决于：

1. **队列延迟**：默认 5 秒（`processEventBatch.ts:81`），日期边界附近更长
2. **ClickHouse 刷写间隔**：由 `LANGFUSE_INGESTION_CLICKHOUSE_WRITE_INTERVAL_MS` 控制
3. **ClickHouseReadSkipCache**：可能跳过未同步的读取（`app.ts:122`）

排查步骤：

```bash
# 检查 Redis 队列积压
docker compose exec redis redis-cli -a myredissecret llen "bull:ingestion-queue:0:wait"

# 检查 Worker 日志
docker compose logs langfuse-worker --tail 100
```

### Q3: 如何处理 S3 上传失败？

当 S3 上传失败时，系统自动回退到同步处理模式（`ingestion.ts:46`）。常见原因：

- MinIO 未就绪或认证失败
- `LANGFUSE_S3_EVENT_UPLOAD_*` 配置错误
- 网络连接问题

检查 S3 连通性：

```bash
# 测试 MinIO 连接
curl http://localhost:9090/minio/health/live
```

### Q4: ClickHouse 查询报错怎么办？

ClickHouse 资源限制错误会被 tRPC 中间件捕获（`trpc.ts:171-185`），返回 422 状态码和建议信息。常见解决方案：

- 增大 ClickHouse 内存配额
- 缩小查询时间范围
- 检查 ClickHouse 集群配置（`CLICKHOUSE_CLUSTER_ENABLED`，`docker-compose.yml:32`）

### Q5: 如何切换到外部 S3？

修改 `docker-compose.yml` 中的 S3 配置（`docker-compose.yml:36-42`）：

```bash
LANGFUSE_S3_EVENT_UPLOAD_BUCKET=my-bucket
LANGFUSE_S3_EVENT_UPLOAD_REGION=us-east-1
LANGFUSE_S3_EVENT_UPLOAD_ACCESS_KEY_ID=AKIAIOSFODNN7EXAMPLE
LANGFUSE_S3_EVENT_UPLOAD_SECRET_ACCESS_KEY=wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY
LANGFUSE_S3_EVENT_UPLOAD_ENDPOINT=https://s3.amazonaws.com
LANGFUSE_S3_EVENT_UPLOAD_FORCE_PATH_STYLE=false
LANGFUSE_S3_EVENT_UPLOAD_PREFIX=events/
```

如使用 Azure Blob，设置 `LANGFUSE_USE_AZURE_BLOB=true`（`docker-compose.yml:33`）。

### Q6: 如何自定义数据保留策略？

通过 `DataRetentionQueue`（`queues.ts:350`）自动清理过期数据：

1. 在项目设置中配置保留天数
2. `DataRetentionQueue` 定时触发清理任务
3. `BatchDataRetentionCleaner`（`app.ts:654`）批量删除 ClickHouse 过期数据
4. `MediaRetentionCleaner`（`app.ts:671`）清理过期的 S3 媒体文件

启用数据保留清理：设置 `LANGFUSE_BATCH_DATA_RETENTION_CLEANER_ENABLED=true`。

### Q7: 如何监控队列健康状况？

访问 Web UI 中的 Admin > Queue Management 页面，或通过 Redis CLI 检查：

```bash
# 查看所有队列
docker compose exec redis redis-cli -a myredissecret keys "bull:*"

# 查看特定队列等待数
docker compose exec redis redis-cli -a myredissecret llen "bull:ingestion-queue:0:wait"

# 查看失败任务数
docker compose exec redis redis-cli -a myredissecret llen "bull:ingestion-queue:0:failed"
```

`WorkerManager`（`workerManager.ts:41`）自动采集队列指标，可通过 OpenTelemetry 导出至 Datadog/Prometheus。
