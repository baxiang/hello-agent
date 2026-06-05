# SuperMemory 源码深度学习笔记

> [supermemoryai/supermemory](https://github.com/supermemoryai/supermemory) — 25.6k stars
> "Memory engine and app that is extremely fast, scalable. The Memory API for the AI era."

---

## 1. 定位与核心理念

SuperMemory 是一个**记忆 API 即服务**。与 Mem0 的 "库" 模式不同，SuperMemory 以 **Cloudflare 边缘计算** 为基础设施，
提供的是生产级、高可用的记忆 API。开源仓库主要是 SDK、集成层和 Web UI，核心记忆引擎运行在服务端。

### 独特卖点

- **多模态摄入**：不是只处理文本，而是图片/PDF/视频/网页/Tweet/Notion/Google 文档通吃
- **记忆图谱 (Memory Graph)**：记忆之间有版本关系 (updates/extends/derives)，形成 DAG
- **自动遗忘**：`forgetAfter` 时间戳 + `isForgotten` 软删除
- **用户画像 (Profile)**：自动构建用户的静态画像和动态画像，~50ms 响应
- **全方位 Agent 集成**：Vercel AI SDK、OpenAI SDK、Mastra、Claude Memory 协议

---

## 2. 整体架构

```
┌─────────────────────────────────────────────────────────────┐
│                    SuperMemory Cloud API                     │
│              api.supermemory.ai (边缘计算)                   │
│                                                              │
│  ┌──────────┐  ┌────────────┐  ┌──────────┐  ┌──────────┐  │
│  │ Document │  │  Memory     │  │ Search   │  │ Profile  │  │
│  │ Ingestion│  │  Extraction │  │ Engine   │  │ Builder  │  │
│  └──────────┘  └────────────┘  └──────────┘  └──────────┘  │
│                                                              │
│  ┌──────────────────────────────────────────────────────┐   │
│  │ PostgreSQL (via Cloudflare Hyperdrive)                │   │
│  │  + Cloudflare KV + Durable Objects + Workflows        │   │
│  └──────────────────────────────────────────────────────┘   │
├─────────────────────────────────────────────────────────────┤
│                      开源集成层                              │
│  ┌──────────┐  ┌────────────┐  ┌──────────┐  ┌──────────┐  │
│  │ MCP      │  │ Vercel AI  │  │ OpenAI   │  │ Mastra   │  │
│  │ Server   │  │ SDK 中间件 │  │ SDK 工具 │  │ 集成     │  │
│  └──────────┘  └────────────┘  └──────────┘  └──────────┘  │
│                                                              │
│  ┌──────────┐  ┌────────────┐  ┌──────────┐               │
│  │ Web UI   │  │ Browser    │  │ Raycast  │               │
│  │ Next.js  │  │ Extension  │  │ Extension│               │
│  └──────────┘  └────────────┘  └──────────┘               │
└─────────────────────────────────────────────────────────────┘
```

### 技术栈

| 层 | 技术 |
|----|------|
| 语言 | TypeScript 63.5%, MDX 29.4%, Python 6.2% |
| 运行时 | Node.js 20+, Cloudflare Workers |
| API 框架 | Hono |
| Web UI | Next.js 16 |
| ORM | Drizzle ORM |
| 数据库 | PostgreSQL (Cloudflare Hyperdrive) |
| 缓存 | Cloudflare KV, Durable Objects (SQLite) |
| 异步处理 | Cloudflare Workflows |
| 构建 | Turborepo monorepo + Bun |
| 校验 | Zod |
| AI SDK | Vercel AI SDK v5/v6 |

---

## 3. 数据模型

### 3.1 Document — 顶层内容容器

```typescript
// 支持的模态类型
type DocumentType = "text" | "pdf" | "tweet" | "google_doc" |
  "google_slide" | "google_sheet" | "image" | "video" |
  "notion_doc" | "webpage" | "onedrive";

// 处理管道状态
type ProcessingStatus = "unknown" | "queued" | "extracting" |
  "chunking" | "embedding" | "indexing" | "done" | "failed";

// 核心字段
interface Document {
  id: string;
  content: string;       // 原始内容
  summary: string;       // AI 生成的摘要
  url: string;           // 来源 URL
  metadata: unknown;
  tokenCount: number;
  chunkCount: number;
  // 双版本嵌入向量 (legacy + new)
  summaryEmbedding: vector;
  embedding: vector;
  summaryEmbeddingNew: vector;
  embeddingNew: vector;
}
```

### 3.2 MemoryEntry — 版本化记忆

这是 SuperMemory 最独特的设计：**记忆版本控制**。

```typescript
interface MemoryEntry {
  id: string;
  content: string;
  // 版本控制 (类似 Git)
  version: number;           // 当前版本号
  isLatest: boolean;         // 是否最新版本
  parentMemoryId: string;    // 父版本 ID (形成 DAG)
  rootMemoryId: string;      // 根版本 ID (追溯完整历史)
  // 关系类型
  relationshipType: "updates" | "extends" | "derives";
  // 时效性
  forgetAfter: datetime;     // 过期时间
  isForgotten: boolean;      // 是否已遗忘
  forgetReason: string;      // 遗忘原因
  // 分类
  isStatic: boolean;         // 静态(永久) vs 动态(近期)
  // 溯源
  sourceCount: number;
  documentSources: MemoryDocumentSource[];  // 来源文档链
  // 嵌入
  embedding: vector;
}
```

> **记忆图谱 (Memory Graph)**：当一条记忆被更新时，不是覆盖而是创建新版本，
> 通过 `parentMemoryId` / `rootMemoryId` 形成 DAG。关系类型：
> - `updates` — 修正/更新旧记忆
> - `extends` — 在旧记忆基础上扩展
> - `derives` — 从旧记忆推理得出

### 3.3 Chunk — 文档块

```typescript
interface Chunk {
  id: string;
  documentId: string;
  position: number;          // 在原文档中的位置
  content: string;           // 分块内容
  embeddedContent: string;   // 用于嵌入的预处理文本
  embedding: vector;
  embeddingNew: vector;
}
```

### 3.4 Space — 组织范围

```typescript
interface Space {
  id: string;
  containerTag: string;     // 多租户标识
  contentTextIndex: string; // 全文索引
}
```

---

## 4. 接入 Pipeline

```
用户内容 → 类型检测 → 提取 (PDF→text, 图片→OCR, 视频→字幕, 网页→正文)
    → AI 摘要 → 分块 → 嵌入 → 索引 → 记忆提取 → 用户画像更新

关键阶段:
1. Ingestion:   POST /v3/documents (内容哈希去重)
2. Processing:  Cloudflare Workflows 异步处理
3. Extraction:  LLM 从对话/文档中提取事实
4. Profiling:   区分静态画像 (isStatic=true) 和动态画像
```

---

## 5. API 设计

### 5.1 V3 API (当前生产)

| 端点 | 方法 | 说明 |
|------|------|------|
| `/v3/documents` | POST | 添加内容 (文本/URL) |
| `/v3/documents/list` | POST | 分页列出记忆 |
| `/v3/documents/:id` | DELETE | 删除文档 |
| `/v3/documents/bulk` | DELETE | 批量删除 |
| `/v3/search` | POST | 语义/混合搜索 |
| `/v3/container-tags/:tag/profile` | GET | ~50ms 获取用户画像 |
| `/v3/connections/:provider` | POST | 连接外部服务 (Notion/Google Drive) |
| `/v3/connections/list` | POST | 列出已连接服务 |

### 5.2 V4 API (新版)

| 端点 | 方法 | 说明 |
|------|------|------|
| `/v4/profile` | POST | 画像 + 搜索 一体化调用 |
| `/v4/conversations` | POST | 结构化对话接入 |

### 5.3 搜索

```typescript
// 混合搜索: RAG (文档块) + Memory (提取事实) 双路
POST /v3/search {
  query: "用户偏好",
  containerTags: ["user-123"],
  topK: 10,
  // 阈值调整 (控制 chunk/doc 灵敏度)
  chunkScoreThreshold: 0.5,
  documentScoreThreshold: 0.3,
}
```

---

## 6. Agent 集成层

### 6.1 MCP Server (`apps/mcp/`)

运行在 Cloudflare Workers + Durable Objects 上。

**Tools:**
- `memory` — 保存或遗忘信息 (action: "save" | "forget")
- `recall` — 搜索记忆并返回用户画像
- `whoAmI` — 当前认证用户信息
- `listProjects` — 项目列表
- `memory-graph` — 交互式记忆图谱可视化 (MCP Apps)

**Resources:**
- `supermemory://profile` — 用户画像 (Static + Recent)
- `supermemory://projects` — 可用项目列表

**Prompts:**
- `context` — 注入用户上下文的系统提示词

### 6.2 Vercel AI SDK 中间件 (`@supermemory/tools`)

```typescript
import { withSupermemory } from '@supermemory/tools/vercel';

const modelWithMemory = withSupermemory(model, {
  apiKey: 'sm_xxx',
  mode: 'profile',           // 'profile' | 'query' | 'full'
  addMemory: 'always',       // 自动保存对话
  retrievalTimeout: 5000,    // 5s 超时
});

// 每次 LLM 调用自动注入记忆
const result = await generateText({
  model: modelWithMemory,
  prompt: "我喜欢什么颜色？",
});
```

**记忆注入流程:**
```
用户消息 → 提取查询文本 → POST /v4/profile (带超时)
  → 去重 (静态画像 > 动态画像 > 搜索结果)
  → 格式化模板 → 注入 System Prompt → LLM 调用
  → 保存对话到 /v4/conversations
```

### 6.3 OpenAI SDK 集成

```typescript
import { withSupermemory } from '@supermemory/tools/openai';

const client = new OpenAI();
const wrapped = withSupermemory(client, { apiKey: 'sm_xxx' });
// 自动拦截 chat.completions.create()
```

### 6.4 Claude Memory 协议

实现了 Claude 的 memory protocol (view/create/str_replace/insert/delete/rename)，
用文件系统隐喻操作记忆。

---

## 7. 与 Mem0 的关键差异

| 维度 | SuperMemory | Mem0 |
|------|-------------|------|
| **部署模式** | Cloud API (边缘计算) | Python 库 / Docker / Cloud |
| **记忆模型** | 版本化 DAG (updates/extends/derives) | 扁平 ADD-only |
| **过期机制** | 内置自动遗忘 + 软删除 | 无 |
| **多模态** | 文本/图片/PDF/视频/网页/Tweet/Notion | 视觉支持 |
| **用户画像** | 静态画像 + 动态画像，50ms | 无画像概念 |
| **外部连接** | OAuth 连接 Google/Notion/OneDrive | 无 |
| **Agent 集成** | MCP + Vercel AI SDK + OpenAI SDK + Mastra + Claude Memory | API 手动调用 |
| **记忆图谱** | 可视化图谱 | 无 |
| **浏览器扩展** | Chrome + Raycast | Chrome |
| **技术栈** | TypeScript/Cloudflare/PostgreSQL | Python/Qdrant/SQLite |

### 各自优势场景

**选 SuperMemory 如果**:
- 需要云端零运维
- 内容来源多样 (Notion, Google Docs, 网页, 视频)
- 需要记忆版本追踪和历史回溯
- 已有 Vercel AI SDK / OpenAI SDK 项目
- 需要 MCP 协议集成

**选 Mem0 如果**:
- 需要自托管 / 离线运行
- 需要精细控制 LLM 和 Embedding 提供商
- 需要实体链接和反幻觉化
- 需要 Python 原生集成
