# Langfuse 项目总览

## 1. 项目简介

Langfuse 是一个开源的 LLM（大语言模型）工程平台，为 AI 应用提供全生命周期的可观测性与治理能力。其核心功能涵盖四大支柱：

- **Tracing（追踪）**：端到端记录 LLM 应用的每一次调用链路，支持嵌套 Span 和 Generation 结构
- **Evaluation（评估）**：通过手动评分、API 评分、LLM-as-Judge 等方式对输出质量进行量化评估
- **Prompt Management（提示管理）**：版本化的提示词管理，支持标签、AB 测试与回滚
- **Observability（可观测性）**：实时仪表盘、成本分析、延迟监控、Token 用量追踪

> 核心域模型定义于 `packages/shared/src/domain/`，如 Trace 域 (`traces.ts:12`)、Observation 域 (`observations.ts:46`)、Score 域 (`scores.ts:124`)、Prompt 域 (`prompts.ts:4`)。

## 2. 设计哲学

Langfuse 的架构围绕以下核心原则展开：

### 2.1 事件驱动架构

所有数据摄入均以事件（Event）为基本单元。SDK 将事件推送至 API，API 上传至 S3 后入队，Worker 异步消费并持久化。这种解耦设计确保：

- **写入路径低延迟**：API 仅负责验证 + S3 上传 + 入队，不做重计算
- **天然背压控制**：队列深度可监控，Worker 可水平扩展
- **容错与重试**：S3 保留原始事件，队列支持死信重试（`DeadLetterRetryQueue`，`queues.ts:356`）

### 2.2 双容器分离

```
web 容器   →  请求接入、认证鉴权、UI 渲染
worker 容器 →  异步处理、批量写入、定时任务
```

Web 容器只做轻量同步操作（验证、S3 上传、入队），所有重计算均在 Worker 中异步执行。两个容器共享 `@langfuse/shared` 包的域模型和队列契约。

### 2.3 读写分离

| 存储 | 角色 | 适用场景 |
|------|------|----------|
| **PostgreSQL** | 事务型写入 | 用户/项目/权限/Prompt/Dataset 等结构化数据 |
| **ClickHouse** | 分析型读取 | Trace/Observation/Score/Event 的大规模聚合查询 |

PostgreSQL 负责 ACID 事务（如用户注册、权限变更），ClickHouse 负责海量时序数据的列式存储与快速聚合。域模型中 Trace (`traces.ts:12`) 和 Observation (`observations.ts:55`) 同时定义了双库映射的 Schema。

### 2.4 对象存储优先

原始事件数据优先写入 S3（兼容 MinIO/Azure Blob/OCI），ClickHouse 仅存储聚合后的列式数据。S3 作为事件的真实来源（Source of Truth），支持：

- 事件回放与重处理
- 合规数据导出
- 数据保留策略下的冷存储

S3 配置通过 `LANGFUSE_S3_EVENT_UPLOAD_*` 系列环境变量控制，参见 `docker-compose.yml:36-42`。

## 3. 核心概念

### 3.1 Trace（追踪）

一次完整调用的追踪单元，代表一个独立的业务请求。Trace 是观测数据的顶层容器。

```typescript
// packages/shared/src/domain/traces.ts:12
export const TraceDomain = z.object({
  id: z.string(),
  name: z.string().nullable(),
  timestamp: z.date(),
  environment: z.string(),
  tags: z.array(z.string()),
  bookmarked: z.boolean(),
  public: z.boolean(),
  release: z.string().nullable(),
  version: z.string().nullable(),
  input: jsonSchema.nullable(),
  output: jsonSchema.nullable(),
  metadata: MetadataDomain,
  sessionId: z.string().nullable(),  // 关联会话
  userId: z.string().nullable(),     // 关联用户
  projectId: z.string(),             // 所属项目
});
```

关键属性：
- `sessionId`：将多次 Trace 归属同一会话（如多轮对话）
- `userId`：追踪特定用户的调用链
- `environment`：区分 `production`/`staging`/`development` 环境
- `tags`：自由标签，用于过滤和分类

### 3.2 Span（跨度）

追踪中的一个耗时操作，可嵌套形成调用树。Span 是构建调用链的基本节点。

```typescript
// packages/shared/src/domain/observations.ts:5-16
export const ObservationType = {
  SPAN: "SPAN",         // 通用耗时操作
  EVENT: "EVENT",       // 瞬时事件
  GENERATION: "GENERATION", // LLM 调用
  AGENT: "AGENT",       // Agent 执行
  TOOL: "TOOL",         // 工具调用
  CHAIN: "CHAIN",       // 链式调用
  RETRIEVER: "RETRIEVER",   // 检索操作
  EVALUATOR: "EVALUATOR",   // 评估器
  EMBEDDING: "EMBEDDING",   // 向量嵌入
  GUARDRAIL: "GUARDRAIL",   // 安全护栏
} as const;
```

每种 Observation 类型共享统一 Schema（`observations.ts:55-101`），但语义不同：
- **SPAN**：表示一个耗时子过程（如数据预处理）
- **EVENT**：瞬时事件，无持续时间
- **GENERATION**：特指 LLM 推理调用（含 token 统计与成本）

Observation 的层级关系通过 `parentObservationId`（`observations.ts:65`）构建树形结构。

### 3.3 Generation（生成）

LLM 调用的专有类型，包含 token 用量与成本信息：

```typescript
// packages/shared/src/domain/observations.ts:71-93
// 模型与定价相关字段
model: z.string().nullable(),              // 模型名称
modelParameters: jsonSchema.nullable(),    // 模型参数（temperature 等）
input: jsonSchema.nullable(),              // 输入（prompt）
output: jsonSchema.nullable(),             // 输出（completion）
// 用量统计
usageDetails: z.record(z.string(), z.number()),   // 细粒度用量
inputUsage: z.number(),                    // 输入 token 数
outputUsage: z.number(),                   // 输出 token 数
// 成本统计
costDetails: z.record(z.string(), z.number()),    // 细粒度成本
inputCost: z.number().nullable(),          // 输入成本
outputCost: z.number().nullable(),         // 输出成本
totalCost: z.number().nullable(),          // 总成本
// 延迟指标
latency: z.number().nullable(),            // 总延迟
timeToFirstToken: z.number().nullable(),   // 首 token 延迟（TTFT）
```

`isGenerationLike()` 辅助函数（`observations.ts:148`）判断一个类型是否具有类似 Generation 的输入/输出字段，用于过滤和查询。

### 3.4 Score（评分）

对 Trace 或 Observation 的质量评估，支持多种数据类型和来源：

```typescript
// packages/shared/src/domain/scores.ts:4-11
// 评分来源
export const ScoreSourceEnum = {
  API: "API",             // 通过 SDK/API 提交
  EVAL: "EVAL",           // 自动评估器产出
  ANNOTATION: "ANNOTATION", // 人工标注
};

// 评分数据类型 (scores.ts:46-61)
export const ScoreDataTypeArray = [
  "NUMERIC",      // 数值型（0-1, 1-5 等）
  "CATEGORICAL",  // 分类型（好/中/差）
  "BOOLEAN",      // 布尔型（通过/失败）
  "CORRECTION",   // 纠正型（输出修正）
  "TEXT",         // 文本型（自由文本反馈）
];
```

Score Schema 使用 `discriminatedUnion` 按数据类型区分（`scores.ts:124-132`），聚合查询仅使用可聚合类型（`AGGREGATABLE_SCORE_TYPES`，`scores.ts:148`），CORRECTION 类型不参与聚合。

### 3.5 Prompt（提示）

版本化的提示管理，支持多版本共存与 AB 测试：

```typescript
// packages/shared/src/domain/prompts.ts:4-19
export const PromptDomainSchema = z.object({
  id: z.string(),
  name: z.string(),                    // 提示名称（项目内唯一键）
  version: z.number(),                 // 版本号（自增）
  isActive: z.boolean().nullable(),    // 是否为活跃版本
  type: z.string().default("text"),   // 类型：text / chat
  tags: z.array(z.string()).default([]),     // 标签
  labels: z.array(z.string()).default([]),   // 标签（如 production/staging）
  prompt: jsonSchemaNullable,          // 提示内容
  config: jsonSchemaNullable,          // 模型配置
  commitMessage: z.string().nullable(), // 版本提交说明
});
```

Prompt 通过 `labels` 机制实现环境标签（如 `production`、`staging`），SDK 可按标签获取特定版本。Prompt 变更可触发 Webhook 自动化（`automations.ts:5-8`，`TriggerEventSource.Prompt`）。

### 3.6 Dataset（数据集）

评估用的结构化数据集，包含多条 DatasetItem：

```typescript
// packages/shared/src/domain/dataset-items.ts:3-18
export type DatasetItemDomain = Pick<
  DatasetItem,
  | "id" | "projectId" | "datasetId"
  | "input"              // 测试输入
  | "expectedOutput"     // 期望输出
  | "metadata"           // 元数据
  | "sourceTraceId"      // 来源 Trace
  | "sourceObservationId" // 来源 Observation
  | "createdAt" | "updatedAt" | "validFrom"
>;
```

Dataset 用于：
- 构建 LLM-as-Judge 评估任务
- 执行 Prompt 实验（AB 对比）
- 存储基准测试用例

## 4. 技术栈

| 层级 | 技术 | 用途 |
|------|------|------|
| **前端框架** | Next.js (App Router + Pages Router) | UI 渲染与路由 |
| **全栈 RPC** | tRPC | 类型安全的前后端通信 |
| **ORM** | Prisma | PostgreSQL 数据建模与查询 |
| **分析存储** | ClickHouse | 时序数据的列式存储与聚合 |
| **消息队列** | BullMQ (Redis) | 异步任务调度与处理 |
| **对象存储** | S3 (MinIO/Azure/OCI) | 原始事件持久化与媒体文件 |
| **认证** | NextAuth.js | 用户认证与 SSO |
| **验证** | Zod | 运行时类型验证 |
| **可观测** | OpenTelemetry | 分布式追踪与指标采集 |
| **包管理** | pnpm (monorepo) | 多包依赖管理 |
| **构建** | Turborepo | 增量构建与任务编排 |

tRPC 上下文与中间件定义于 `web/src/server/api/trpc.ts:103-124`，初始化时集成 SuperJSON 序列化与 Zod 错误格式化。

## 5. SDK 集成

Langfuse 通过多语言 SDK 接入，以下是主要集成方式：

### 5.1 Python SDK

最核心的 SDK，支持装饰器、上下文管理器等 Pythonic 用法：

```python
from langfuse import Langfuse

# 初始化客户端
langfuse = Langfuse(
    public_key="pk-...",
    secret_key="sk-...",
    host="http://localhost:3000"
)

# 最简 Tracing
trace = langfuse.trace(name="my-trace")
span = trace.span(name="retrieval")
generation = span.generation(
    name="llm-call",
    model="gpt-4o",
    input={"prompt": "Hello"},
    usage={"input": 10, "output": 5}
)
generation.end(output={"text": "Hi!"})
```

### 5.2 LangChain 集成

通过 `CallbackHandler` 无侵入接入 LangChain 链路：

```python
from langfuse.callback import CallbackHandler

langfuse_handler = CallbackHandler(
    public_key="pk-...",
    secret_key="sk-...",
    host="http://localhost:3000"
)

# 传入 LangChain 链
chain.invoke({"input": "Hello"}, config={"callbacks": [langfuse_handler]})
```

### 5.3 OpenTelemetry 集成

通过 OTLP 导出器将 OpenTelemetry Span 映射为 Langfuse Trace，Langfuse Worker 提供 `otelIngestionQueue` 处理 OTLP 数据（`worker/src/queues/otelIngestionQueue.ts`）。

### 5.4 其他框架集成

| 框架 | 集成方式 | 说明 |
|------|----------|------|
| **LangChain.js** | `CallbackHandler` | JavaScript 版回调处理器 |
| **ADK-Go** | OTLP Exporter | Go Agent 开发框架，通过 OTLP 协议对接 |
| **Eino** | OTLP Exporter | 字节跳动 Go AI 框架，同上 |
| **LlamaIndex** | `LlamaIndexCallbackHandler` | Python 回调集成 |
| **Vercel AI SDK** | `telemetry` 配置 | 通过 OTLP 导出 |

## 6. 包总览表

| 包 | 路径 | 职责 |
|----|------|------|
| **web** | `web/` | Next.js 应用：UI + tRPC 后端 + 公共 REST API |
| **worker** | `worker/` | BullMQ 队列消费者与后台任务处理 |
| **@langfuse/shared** | `packages/shared/` | 共享域模型、数据库/队列契约、Repository 层 |
| **@langfuse/ee** | `ee/` | 企业版功能（SSO、RBAC 增强、计费等） |
| **config-typescript** | `packages/config-typescript/` | 共享 TypeScript 编译配置 |
| **config-eslint** | `packages/config-eslint/` | 共享 ESLint 配置 |
| **eslint-plugin** | `packages/eslint-plugin/` | 自定义 ESLint 规则 |

依赖方向（严格单向）：

```
web  → @langfuse/shared, @langfuse/ee
worker → @langfuse/shared
@langfuse/ee → @langfuse/shared
@langfuse/shared → 不依赖 web/worker/ee
```

> 依赖方向定义于 `AGENTS.md` 项目结构部分，违反此规则的导入会导致循环依赖。

### 关键入口文件

| 入口 | 文件 | 说明 |
|------|------|------|
| tRPC 路由注册 | `web/src/server/api/root.ts:65` | 所有 tRPC Router 的注册中心 |
| 队列名称枚举 | `packages/shared/src/server/queues.ts:324` | `QueueName` 枚举，定义全部队列名 |
| 域模型导出 | `packages/shared/src/domain/index.ts` | 统一导出所有域模型 |
| Worker 启动 | `worker/src/app.ts:98` | Express 应用，注册所有 Queue Worker |
| Prisma Schema | `packages/shared/prisma/schema.prisma` | PostgreSQL 表结构定义 |
| ClickHouse 迁移 | `packages/shared/clickhouse/migrations/` | ClickHouse 表结构迁移脚本 |
