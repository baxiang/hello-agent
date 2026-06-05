# Memori 源码深度学习笔记

> [MemoriLabs/Memori](https://github.com/MemoriLabs/Memori) — 15.2k stars
> "Agent-native memory infrastructure. Memory from what agents DO, not just what they SAY."

---

## 1. 定位与核心理念

Memori 的核心差异在于 **"Agent-native"** — 它不是让开发者手动调用 `add()` 和 `search()`，
而是**透明地拦截 LLM 客户端的每次调用**，在背后自动完成记忆的提取、存储和注入。

### 关键口号
> "Memory from what agents do, not just what they say"

Mem0 只从对话文本中提取事实。Memori 除此之外还捕获 **Agent 执行轨迹** — 工具调用、决策、结果 — 形成更丰富的记忆。

---

## 2. 整体架构

```
┌──────────────────────────────────────────────────────────────┐
│                       Memori Class                           │
│                    入口点，协调所有子系统                       │
├──────────────────────────────────────────────────────────────┤
│  ┌─────────────────┐  ┌──────────────────┐  ┌─────────────┐ │
│  │  LLM 拦截层     │  │  记忆层          │  │  存储层     │ │
│  │  (自动透明)     │  │  (持久化+召回)   │  │             │ │
│  ├─────────────────┤  ├──────────────────┤  ├─────────────┤ │
│  │ 调用管道:       │  │ MemoryManager    │  │ StorageMgr  │ │
│  │  1.Recall       │  │  ├─ Writer       │  │  ├─ Adapter │ │
│  │  2.History      │  │  └─ Augmentation │  │  └─ Driver  │ │
│  │  3.API Call     │  │     ├─ Python    │  │ (PG, MySQL, │ │
│  │  4.Post-Hook    │  │     ├─ Rust Core │  │  SQLite...) │ │
│  └─────────────────┘  └──────────────────┘  └─────────────┘ │
├──────────────────────────────────────────────────────────────┤
│  ┌──────────────────┐  ┌──────────────────┐                 │
│  │  Rust 核心       │  │  Cloud API       │                 │
│  │  (BYODB 模式)    │  │  (托管模式)      │                 │
│  ├──────────────────┤  ├──────────────────┤                 │
│  │ FAISS 搜索       │  │ REST API 调用    │                 │
│  │ 嵌入生成         │  │ 异步 HTTP        │                 │
│  │ 增强编排         │  │ API Key 认证     │                 │
│  └──────────────────┘  └──────────────────┘                 │
└──────────────────────────────────────────────────────────────┘
```

---

## 3. 部署模式

| 模式 | `config.cloud` | `config.byodb` | 说明 |
|------|:---:|:---:|------|
| **Cloud** | true | false | 零配置，使用 Memori 托管 API |
| **BYODB + Rust** | false | true | 用户自有 DB + Rust 高性能引擎 |
| **BYODB + Python** | false | true | 用户自有 DB + 纯 Python 处理 |

---

## 4. 透明 LLM 拦截 — 核心魔法

这是 Memori 最核心的设计：**开发者不需要改一行 LLM 调用代码**。

```python
# 使用前: 正常的 OpenAI 调用
import openai
client = openai.OpenAI()
response = client.chat.completions.create(
    model="gpt-4o",
    messages=[{"role": "user", "content": "我叫张三"}],
)

# 使用后: 仅需 3 行注入 Memori
from memori import Memori
mem = Memori(api_key="...").attribution("user-123", "support_agent")
mem.llm.register(client)  # ← 魔法发生在这里

# 下面的调用和之前完全一样，但 Memori 已经自动:
# 1. 注入相关记忆到 prompt
# 2. 注入对话历史
# 3. 保存本轮对话
# 4. 触发后台记忆提取
response = client.chat.completions.create(
    model="gpt-4o",
    messages=[{"role": "user", "content": "我叫张三"}],
)
```

### 拦截原理 — Registry 模式

```python
# memori/llm/_registry.py
class Registry:
    _clients = {}   # matcher_function → wrapper_class
    _adapters = {}  # matcher_function → adapter_class

    @classmethod
    def register_client(cls, matcher):
        """装饰器: 注册 LLM 客户端包装器"""
        def decorator(wrapper_cls):
            cls._clients[matcher] = wrapper_cls
            return wrapper_cls
        return decorator

# 支持的 LLM 客户端
@Registry.register_client(client_is_openai)      # → OpenAI
@Registry.register_client(client_is_anthropic)    # → Anthropic
@Registry.register_client(client_is_google)       # → Google Gemini
@Registry.register_client(client_is_xai)          # → xAI Grok
@Registry.register_client(client_is_litellm)      # → LiteLLM
@Registry.register_client(client_is_pydantic_ai)  # → PydanticAI
```

---

## 5. 调用管道 — 每次 LLM 调用的 4 个阶段

```
client.chat.completions.create(messages=[...])
                  │
                  ▼
    ┌──────────────────────────────┐
    │  1. inject_recalled_facts()  │  搜索记忆 → 注入 prompt
    │  2. inject_conversation()    │  注入完整对话历史
    │  3. configure_streaming()    │  处理流式选项
    │  4. Call original method     │  实际的 LLM API 调用
    │  5. handle_post_response()   │  持久化 + 触发增强
    └──────────────────────────────┘
```

### 阶段 1: 记忆注入

```
用户消息 → 提取查询 → 搜索记忆 (FAISS混合 或 Cloud API)
  → 格式化为 <memori_context> 块 → 注入到 system prompt

各 LLM 的注入策略:
  OpenAI:     prepend system message
  Anthropic:  append to system field
  Google:     inject system instruction
  Responses API: append to instructions
```

### 阶段 5: 后处理

```
LLM 响应返回:
  1. 结构化整个对话轮次 (attribution, metadata, timestamps)
  2. 通过 MemoryManager 写入数据库
  3. 触发后台 Advanced Augmentation (提取事实/三元组/属性)
```

---

## 6. 关系型记忆模型

```
┌──────────────┐     ┌──────────────┐     ┌────────────────────┐
│   Entity     │────▶│  Session     │────▶│   Conversation     │
│  (用户/实体) │     │              │     │                    │
└──────────────┘     └──────────────┘     └────────────────────┘
       │                                         │
       ▼                                         ▼
┌──────────────┐                         ┌────────────────────┐
│ Entity Fact  │                         │ Conversation       │
│ (内容+向量)  │                         │ Message            │
└──────────────┘                         │ (role, type, text) │
       │                                 └────────────────────┘
       ▼
┌──────────────┐
│ Knowledge    │
│ Graph        │
│ (三元组)     │
└──────────────┘

┌──────────────┐     ┌───────────────────┐
│   Process    │────▶│ Process Attribute │
│ (Agent/App)  │     │ (技能、能力)      │
└──────────────┘     └───────────────────┘
```

| 概念 | 说明 |
|------|------|
| **Entity** | 被记忆的对象 (用户) |
| **Process** | Agent/程序 (如 "support_agent") |
| **Session** | UUID 标识的交互组 |
| **Conversation** | 一次计时交互 |
| **EntityFact** | 提取的事实 + 向量嵌入 (FAISS 索引) |
| **KnowledgeGraph** | 语义三元组 (subject-predicate-object) |
| **ProcessAttribute** | Agent 的属性 |

---

## 7. Advanced Augmentation — 记忆提取引擎

增强 (Augmentation) 是 Memori 的记忆提取层，将对话转换为结构化记忆。

### 提取内容

```
原始对话 → Memori AI 服务 → 结构化记忆:
  ├── facts:          原子性事实陈述
  ├── semantic_triples: (subject, predicate, object) 三元组
  ├── attributes:     Agent/Process 属性
  └── summaries:      对话级别的摘要
```

### 执行流程

```
Post-Invoke → 选择路由:
  ├── Cloud 模式  → POST cloud/augmentation (后台线程)
  ├── BYODB+Rust  → RustEngine.submit_augmentation() (后台线程)
  └── BYODB+Python → AugmentationManager.enqueue() (异步事件循环)

Python 增强 (AdvancedAugmentation):
  1. 选择摘要消息 (user+assistant 配对, 或最后轮次)
  2. 构建结构化 payload
  3. 调用 Memori API augmentation_async()
  4. 解析响应为 Memories 结构体
  5. 调度 DB 写入 (通过 DbWriter 批量异步写入)
```

---

## 8. 混合检索

### 搜索架构

```
search_facts():
  ├── DB 模式: get_embeddings() → FAISS IP → fetch_content → rank
  └── Candidates 模式: 预评分候选 → rank

_rank_candidates():
  ├── 有查询文本: dense_lexical_weights → (w_cos, w_lex)
  │   hybrid_score = w_cos * similarity + w_lex * lexical_score
  └── 无查询文本: 纯相似度排序
```

**FAISS**: 使用 `IndexFlatIP`(内积 = 归一化向量上的余弦相似度)
**词法**: TF-IDF 风格评分
**混合**: 向量 + 词法加权组合

---

## 9. 存储层 — Adapter-Driver 模式

```python
# 适配器 (连接抽象) + 驱动 (方言特化)
adapters = {sqlalchemy, django, mongodb, dbapi}
drivers = {postgresql, mysql, sqlite, tidb, oceanbase, oracle, mongodb}

# 通过装饰器注册
@Registry.register_adapter(matcher)
class SQLAlchemyAdapter: ...

@Registry.register_driver(dialect="postgresql")
class PostgreSQLDriver: ...
```

---

## 10. Agent 模块

专门为 Agent 框架 (OpenClaw, Hermes, Claude Code) 提供的 API：

| 方法 | 说明 |
|------|------|
| `agent_recall(query)` | 带过滤器的 Agent 专用检索 |
| `agent_recall_summary()` | Agent 摘要端点 |
| `agent_compaction(project_id)` | Session 压缩 |
| `capture_agent_turn()` | 显式捕获 Agent 轮次 |
| `agent_feedback()` | 反馈 |

---

## 11. 与 Mem0 的深度对比

| 维度 | Memori | Mem0 |
|------|--------|------|
| **集成哲学** | 透明拦截，零代码入侵 | 显式 API 调用 |
| **记忆来源** | Agent 执行轨迹 (工具调用、决策、结果) | 对话文本 |
| **记忆结构** | 关系型: Entity→Fact, Entity→KG, Process→Attr | 扁平条目 |
| **检索方式** | 自动注入 prompt | 手动 search + inject |
| **对话历史** | 自动注入到每次调用 | 不处理 |
| **Session 管理** | 内置 entity/process/session 模型 | user_id 作用域 |
| **部署** | Cloud (零配置) + BYODB (全控制) | Cloud 为主 |
| **数据库支持** | PostgreSQL, MySQL, SQLite, TiDB, OceanBase, Oracle, MongoDB | Qdrant/Chroma (+ SQLite 历史) |
| **LLM 支持** | 6+ 提供商，透明包装 | OpenAI 为主 |
| **框架支持** | Agno, LangChain, PydanticAI 原生 | API 通用 |
| **高性能引擎** | Rust 核心 (PyO3) | Python 纯 |
| **Agent 专属 API** | agent_recall, agent_compaction | 无 |

### 何时用 Memori

1. 已有 OpenAI/Anthropic/Google 项目，不想改变调用方式
2. 需要捕获 Agent 的工具调用链路
3. 需要关系型记忆 (Entity 中心化)
4. 需要 BYODB — 用自己的数据库完全控制数据
5. 需要支持多种数据库 (PG/MySQL/TiDB/MongoDB)
