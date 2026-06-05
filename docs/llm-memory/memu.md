# memU 源码深度学习笔记

> [NevaMind-AI/memU](https://github.com/NevaMind-AI/memU) — 13.8k stars
> "Memory for 24/7 proactive agents. Even without a command, the agent can tell what you are about to do."

---

## 1. 定位与核心理念

memU 是四大项目中**唯一专注于 "主动 (Proactive)" 场景**的记忆系统。
其他项目都是 "你问我答" 的被动模式 — memU 的设计目标是一个在后台持续运行、
预测用户意图、主‎动行动的 Agent。

### 核心创新

1. **文件系统隐喻** — 记忆按 Category(文件夹)/Item(文件)/Resource(挂载点) 三层组织
2. **双系统架构** — Main Agent 处理用户请求 + memU Bot 在后台持续监控/记忆/预测
3. **强化+衰退评分** — 记忆有 `reinforcement_count` 和 `salience` 得分，频繁使用=更相关
4. **双模检索** — RAG 向量模式 + LLM 语义推理模式，可切换

---

## 2. 整体架构

```
┌──────────────────────────────────────────────────────────────┐
│                     MemoryService                            │
│      MemorizeMixin + RetrieveMixin + CRUDMixin              │
├──────────────────────────────────────────────────────────────┤
│  ┌─────────────────┐  ┌──────────────────┐  ┌─────────────┐ │
│  │ Memorize 管道   │  │ Retrieve 管道    │  │ 存储层      │ │
│  │ (7 步工作流)    │  │ (RAG/LLM 双模)   │  │             │ │
│  ├─────────────────┤  ├──────────────────┤  ├─────────────┤ │
│  │ 1.ingest        │  │ 1.route_intent   │  │ InMemory    │ │
│  │ 2.preprocess    │  │ 2.route_category │  │ SQLite      │ │
│  │ 3.extract       │  │ 3.sufficiency    │  │ PostgreSQL  │ │
│  │ 4.dedupe        │  │ 4.recall_items   │  │ (+pgvector) │ │
│  │ 5.categorize    │  │ 5.sufficiency    │  └─────────────┘ │
│  │ 6.persist_index │  │ 6.recall_resrc   │                 │
│  │ 7.build_response│  │ 7.build_context  │                 │
│  └─────────────────┘  └──────────────────┘                 │
├──────────────────────────────────────────────────────────────┤
│  ┌─────────────────┐  ┌──────────────────┐  ┌─────────────┐ │
│  │ LLM 拦截层      │  │ 工作流引擎       │  │ blob 存储   │ │
│  │ (多提供商)      │  │ (版本化 DAG)     │  │ (LocalFS)   │ │
│  └─────────────────┘  └──────────────────┘  └─────────────┘ │
└──────────────────────────────────────────────────────────────┘
```

---

## 3. 文件系统隐喻 — 三层记忆模型

memU 用文件系统来类比记忆组织，这是它最独特的设计：

```
memory/                          ← MemoryService 根
├── preferences/                 ← Category (自动组织的主题)
│   ├── communication_style.md   ← MemoryItem (提取的事实)
│   └── topic_interests.md
├── relationships/
│   ├── contacts/
│   └── interaction_history/
├── knowledge/
│   ├── domain_expertise/
│   └── learned_skills/
└── context/
    ├── recent_conversations/    ← Resource (挂载的原始数据)
    └── pending_tasks/
```

### 三层映射

| 文件系统 | memU | 说明 | 被动使用 | 主动使用 |
|---------|------|------|----------|----------|
| 文件夹 | Category | 自动组织的主题 | 摘要级概览 | 自动上下文组装 |
| 文件 | MemoryItem | 提取的事实/偏好/技能 | 定向事实检索 | 实时从交互中提取 |
| 挂载点 | Resource | 原始数据 (对话/文档/图片) | 直接访问 | 后台监控新模式 |

### Category 引用系统

Category 的 summary 中可以包含 `[ref:ITEM_ID]` 引用，
这使得 Category 摘要不仅是一段文本，还能精确定位到具体的记忆条目。

---

## 4. 数据模型

```python
# 记忆类型
MemoryType = Literal["profile", "event", "knowledge", "behavior", "skill", "tool"]

class Resource(BaseRecord):
    url: str
    modality: str          # conversation | document | image | video | audio
    local_path: str
    caption: str | None
    embedding: list[float] | None  # caption 的向量嵌入

class MemoryItem(BaseRecord):
    resource_id: str | None
    memory_type: str       # profile | event | knowledge | behavior | skill | tool
    summary: str           # 实际记忆内容
    embedding: list[float] | None
    happened_at: datetime | None
    extra: dict            # content_hash, reinforcement_count,
                           # last_reinforced_at, ref_id, tool_calls

class MemoryCategory(BaseRecord):
    name: str
    description: str
    embedding: list[float] | None
    summary: str | None    # LLM 自动生成的类别摘要

class CategoryItem(BaseRecord):
    item_id: str           # N:M 关系
    category_id: str
```

### Scope 合并 — 多租户支持

```python
# build_scoped_models() 将用户自定义模型与基础模型合并
# 例如: user 提供 {"user_id": str} → 所有 Record 自动加上 user_id 字段
class ScopedResource(Resource, UserModel):
    user_id: str  # 继承来的
```

---

## 5. Memorize 管道 — 7 步记忆工作流

```
输入: 资源 URL + modality + user scope
  │
  ├─ Step 1: ingest_resource (IO)
  │    下载文件/读取本地路径 → local_path + raw_text
  │
  ├─ Step 2: preprocess_multimodal (LLM)
  │    按 modality 分发:
  │    - conversation: 分段 + 索引 + caption
  │    - document: 压缩 + caption
  │    - video: 取中间帧 → Vision API
  │    - image: Vision API
  │    - audio: Whisper 转文字 → 文本处理
  │    → [{"text": ..., "caption": ...}, ...]
  │
  ├─ Step 3: extract_items (LLM) ★ 核心
  │    并行调用: 每种记忆类型一个 LLM 请求
  │    提取 XML 格式记忆:
  │    <memory>
  │      <content>用户偏好暗色模式</content>
  │      <categories>preferences, ui</categories>
  │    </memory>
  │    → resource_plans with entries
  │
  ├─ Step 4: dedupe_merge (预留)
  │    当前为占位符，直接传递
  │
  ├─ Step 5: categorize_items (DB + Vector)
  │    创建 Resource (含 caption embedding)
  │    创建 MemoryItem (含 summary embedding)
  │    链接到 Category (CategoryItem 关系)
  │    可选: 强化重复记忆 (reinforcement_count++)
  │
  ├─ Step 6: persist_index (DB + LLM)
  │    用 LLM 重新生成受影响的 Category 摘要
  │    可选: 在摘要中加入 [ref:MEMORY_ID] 引用
  │
  └─ Step 7: build_response
       → {resources, items, categories, relations}
```

### 并行提取的核心实现

```python
async def _generate_entries_from_text(self, text, memory_types, ...):
    # 每种 memory_type 独立调用 LLM, 并行执行
    tasks = [
        self._extract_for_type(text, mem_type, ...)
        for mem_type in memory_types  # [profile, event, knowledge, ...]
    ]
    results = await asyncio.gather(*tasks)
    return results
```

---

## 6. Retrieve 管道 — RAG/LLM 双模

### RAG 模式 (默认)

```
query → Step 1: route_intention (LLM)
          ├── 是否需要检索? → needs_retrieval
          └── 重写查询 → rewritten_query
      → Step 2: route_category (Vector)
          └── 类别摘要向量相似度排序
      → Step 3: sufficiency_after_category (LLM)
          └── 不够? → proceed_to_items + next_step_query
      → Step 4: recall_items (Vector)
          ├── 相似度模式: cosine similarity
          └── 显著性模式: similarity * log(reinforcement+1) * recency_decay
      → Step 5: sufficiency_after_items (LLM)
          └── 不够? → proceed_to_resources
      → Step 6: recall_resources (Vector)
          └── Resource caption 余弦相似度
      → Step 7: build_context
          → {categories, items, resources, next_step_query, rewritten_query}
```

### LLM 模式

与 RAG 模式相同的 7 步结构，但用 LLM 替代向量排序：

```
_llm_rank_categories()   — LLM 从格式化文本中排序类别
_llm_rank_items()        — LLM 在相关类别中排序条目
_llm_rank_resources()    — LLM 排序资源
```

支持 `use_category_references=True`，先从 Category 摘要中的 `[ref:ITEM_ID]` 查找。

### 显著性评分 (Salience Score)

```python
def salience_score(similarity, reinforcement_count, days_ago, half_life):
    """记忆的 "重要性" 得分"""
    return (
        similarity                      # 基础语义相似度
        * math.log(reinforcement_count + 1)  # 使用次数越多越重要
        * math.exp(-0.693 * days_ago / half_life)  # 时间衰减 (半衰期)
    )
```

---

## 7. 主动 Agent — 双系统架构

```
┌─────────────────────┐         ┌──────────────────────────┐
│   MAIN AGENT        │  ◄───►  │   MEMU BOT (后台)        │
│                     │         │                          │
│ 处理用户查询        │         │ 持续监控对话             │
│ 执行任务            │         │ 自动记忆化               │
│                     │         │ 预测用户意图             │
└─────────────────────┘         └──────────────────────────┘
         │                                   │
         └───────────┬───────────────────────┘
                     ▼
         ┌──────────────────────────┐
         │  循环同步                 │
         │  Agent ◄──► MemU ◄──► DB │
         └──────────────────────────┘
```

### 主动循环

```
1. memU Bot 监控 Agent 输入/输出 (观察交互, 追踪对话流)
2. 记忆化 & 提取: 从监控的交互中提取见解/事实/偏好/技能
3. 预测意图: 预判下一步, 识别即将到来的需求
4. 主动任务: 预取相关上下文, 准备推荐, 自主更新 todolist
5. 将记忆上下文注入回主 Agent 的规划/执行中
```

### 实现细节

- 使用 Claude Agent SDK
- 可配置阈值: `N_MESSAGES_MEMORIZE` (默认 2 条消息后触发记忆化)
- 后台记忆化运行在 `asyncio.Task` (非阻塞)
- 触发前检查是否已有运行的记忆化任务
- Session 结束时等待所有待处理任务完成
- MCP Server (`memu_server`) 暴露 `memu_todos` 等工具

---

## 8. 工作流管道引擎

memU 内置了一个**版本化 DAG 执行引擎**：

```python
# 注册一个管道
PipelineManager.register(
    name="memorize",
    steps=[
        WorkflowStep(step_id="ingest", requires=[], produces=["raw_text"]),
        WorkflowStep(step_id="preprocess", requires=["raw_text"], produces=["segments"]),
        WorkflowStep(step_id="extract", requires=["segments"], produces=["entries"]),
        # ...
    ],
    initial_state_keys=["resource_url", "modality", "user"],
)

# 运行时修改 (版本化)
PipelineManager.insert_after("memorize", "extract", new_step)   # Revision 2
PipelineManager.replace_step("memorize", "dedupe", better_step)  # Revision 3

# 构建执行
steps = PipelineManager.build("memorize")  # 深拷贝最新版本
```

### 验证机制

- 检查 `requires` 在可用状态中
- 验证 `capabilities` 与 `available_capabilities`
- 验证 LLM profiles 已注册
- 检测重复 step_id

---

## 9. LLM 客户端层

### 三种后端

```
SDK 后端 (client_backend="sdk"):
  → OpenAI Python SDK, 功能最全

HTTP 后端 (client_backend="httpx"):
  → 直接 HTTP 调用, 多提供商: openai/doubao/grok/openrouter
  → 独立的 embedding 后端

LazyLLM 后端 (client_backend="lazyllm_backend"):
  → 多源路由, llm/vlm/embed/stt 各自配置
```

### Profile 路由

```python
config = {
    "llm_profiles": {
        "default": {"chat_model": "gpt-4o-mini", "api_key": "..."},
        "embedding": {"embed_model": "text-embedding-3-small"},
        "reasoning": {"chat_model": "deepseek-reasoner", "client_backend": "httpx"},
    }
}
# 工作流步骤通过 chat_llm_profile / embed_llm_profile 选择 profile
```

---

## 10. 与 Mem0 的关键差异

| 维度 | memU | Mem0 |
|------|------|------|
| **架构** | 工作流管道引擎 + 版本化步骤 | 函数式流程 |
| **记忆模型** | 文件系统隐喻 (Category/Item/Resource) | 扁平条目 |
| **主动性** | 内置双 Agent 架构 (Main + Bot) | 纯被动检索 |
| **检索模式** | RAG 向量 + LLM 语义 双模 | 语义 + BM25 + 实体 |
| **多模态** | 原生支持 (Vision/Whisper API) | 文本为主 + 视觉 |
| **LLM 后端** | SDK/HTTP/LazyLLM + 多提供商 | OpenAI 为主 |
| **拦截器系统** | before/after/on_error + 过滤 | 无 |
| **强化+衰退** | 内置 (reinforcement_count, decay scoring) | 无 |
| **分类引用** | Category 摘要中 `[ref:ITEM_ID]` 引用 | 无 |
| **并行提取** | asyncio.gather 并行 LLM 调用 | 单次 LLM 调用 |
| **Pipeline 版本** | 版本化 + 可运行时重配置 | 不适用 |

### 何时用 memU

1. 需要一个 **24/7 后台运行** 的 Agent
2. 需要主动预测用户需求的场景
3. 需要多模态输入 (图片/视频/音频)
4. 需要记忆重要性动态变化 (强化/衰退)
5. 需要可定制的工作流管道
6. 需要通过 MCP 暴露记忆工具
