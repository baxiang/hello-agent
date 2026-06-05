# Mem0 源码深度学习笔记 v2

> 基于 [mem0ai/mem0](https://github.com/mem0ai/mem0) 完整源码深度阅读整理，覆盖所有核心模块的实现细节

---

## 1. 整体架构

```
┌──────────────────────────────────────────────────────────────────────┐
│  Memory / AsyncMemory / MemoryClient  (3 种使用入口)                  │
├──────────────────────────────────────────────────────────────────────┤
│  ┌──────────┐  ┌───────────┐  ┌────────────┐  ┌─────────────┐       │
│  │  LLM     │  │ Embedder  │  │ Vector     │  │ Reranker    │       │
│  │ Base     │  │ Base      │  │ Store      │  │ Base        │       │
│  │  ├OpenAI │  │  ├OpenAI  │  │ Base       │  │ (可选)      │       │
│  │  ├Anthropic  │  ├Ollama  │  │  ├Qdrant  │  └─────────────┘       │
│  │  ├Ollama │  │  ├HF      │  │  ├Chroma  │                         │
│  │  └...10+ │  │  └...12+  │  │  └...14+  │                         │
│  └──────────┘  └───────────┘  └─────┬──────┘                        │
│                                     │                                │
│                           ┌─────────┴─────────┐                     │
│                           │ Entity Store       │                     │
│                           │ (同一向量库独立     │                     │
│                           │  collection)       │                     │
│                           └───────────────────┘                     │
├──────────────────────────────────────────────────────────────────────┤
│  SQLiteManager: history 表 + messages 表                             │
└──────────────────────────────────────────────────────────────────────┘
```

---

## 2. 三层抽象体系

### 2.1 MemoryBase — 接口抽象 (`memory/base.py`)

```python
class MemoryBase(ABC):
    @abstractmethod
    def get(self, memory_id): pass
    @abstractmethod
    def get_all(self): pass
    @abstractmethod
    def update(self, memory_id, data): pass
    @abstractmethod
    def delete(self, memory_id): pass
    @abstractmethod
    def history(self, memory_id): pass
```

极简的抽象基类，只定义 5 个核心操作。`add`、`search` 不在抽象中，说明它们
在不同实现中差异较大。

### 2.2 LLMBase — LLM 层抽象 (`llms/base.py`)

```python
class LLMBase(ABC):
    def __init__(self, config):
        self.config = config
        self._validate_config()

    def _is_reasoning_model(self, model: str) -> bool:
        """检测 o1/o3/gpt-5 推理模型，这些模型不支持 temperature/top_p"""
        reasoning_models = {
            "o1", "o1-preview", "o3-mini", "o3",
            "gpt-5", "gpt-5o", "gpt-5o-mini", "gpt-5o-micro",
        }
        base_model = model.lower().rsplit("/", 1)[-1]
        return base_model in reasoning_models or any(
            base_model.startswith(p) for p in ["o1-", "o1.", "o3-", "o3."]
        )

    def _get_supported_params(self, **kwargs) -> Dict:
        """推理模型只保留 messages/response_format/tools/reasoning_effort，
        过滤掉 temperature/top_p/max_tokens 等不支持的参数"""
        if self._is_reasoning_model(self.config.model):
            # 仅保留推理模型支持的参数
            supported = {}
            for key in ["messages", "response_format", "tools", "tool_choice"]:
                if key in kwargs: supported[key] = kwargs[key]
            if getattr(self.config, 'reasoning_effort', None):
                supported["reasoning_effort"] = self.config.reasoning_effort
            return supported
        return self._get_common_params(**kwargs)

    def _get_common_params(self, **kwargs) -> Dict:
        return {
            "temperature": self.config.temperature,
            "max_tokens": self.config.max_tokens,
            "top_p": self.config.top_p,
            **kwargs
        }

    @abstractmethod
    def generate_response(self, messages, tools=None, tool_choice="auto", **kwargs):
        pass
```

> **关键设计**: `_is_reasoning_model()` + `_get_supported_params()` 确保调用不同
> 模型的 API 时不会传入不支持的参数导致报错。这是多 LLM 支持的核心兼容层。

### 2.3 EmbeddingBase — 嵌入层抽象 (`embeddings/base.py`)

```python
class EmbeddingBase(ABC):
    def __init__(self, config):
        self.config = config

    @abstractmethod
    def embed(self, text, memory_action: Optional[Literal["add","search","update"]]):
        pass

    def embed_batch(self, texts, memory_action="add"):
        """默认逐个嵌入，子类可覆写为原生批量 API"""
        return [self.embed(text, memory_action) for text in texts]
```

> `memory_action` 参数暗示不同场景可能需要不同嵌入策略（如 search 时用不同模型）。

### 2.4 VectorStoreBase — 向量存储抽象 (`vector_stores/base.py`)

```python
class VectorStoreBase(ABC):
    # 11 个必选抽象方法
    @abstractmethod def create_col(self, name, vector_size, distance): pass
    @abstractmethod def insert(self, vectors, payloads=None, ids=None): pass
    @abstractmethod def search(self, query, vectors, top_k=5, filters=None): pass
    @abstractmethod def delete(self, vector_id): pass
    @abstractmethod def update(self, vector_id, vector=None, payload=None): pass
    @abstractmethod def get(self, vector_id): pass
    @abstractmethod def list_cols(self): pass
    @abstractmethod def delete_col(self): pass
    @abstractmethod def col_info(self): pass
    @abstractmethod def list(self, filters=None, top_k=None): pass
    @abstractmethod def reset(self): pass

    # 2 个可选方法 (不是 abstractmethod)
    def keyword_search(self, query, top_k=5, filters=None):
        """BM25 关键词搜索，不支持时返回 None"""
        return None

    def search_batch(self, queries, vectors_list, top_k=1, filters=None):
        """批量搜索，默认循环调用 search()"""
        return [self.search(q, v, top_k=top_k, filters=filters) for q, v in zip(queries, vectors_list)]
```

---

## 3. OpenAILLM 完整实现 (`llms/openai.py`)

```python
class OpenAILLM(LLMBase):
    def __init__(self, config=None):
        # 支持 4 种输入: None / dict / BaseLlmConfig / OpenAIConfig
        # 自动转换并设置默认模型 gpt-5-mini
        ...

        # 双路由: OpenRouter 或 标准 OpenAI
        if os.environ.get("OPENROUTER_API_KEY"):
            self.client = OpenAI(
                api_key=os.environ["OPENROUTER_API_KEY"],
                base_url=os.getenv("OPENROUTER_API_BASE") or "https://openrouter.ai/api/v1",
            )
        else:
            self.client = OpenAI(
                api_key=self.config.api_key or os.getenv("OPENAI_API_KEY"),
                base_url=os.getenv("OPENAI_BASE_URL") or "https://api.openai.com/v1",
            )

    def generate_response(self, messages, response_format=None, tools=None, tool_choice="auto", **kwargs):
        params = self._get_supported_params(messages=messages, **kwargs)
        params.update({"model": self.config.model, "messages": messages})

        if os.getenv("OPENROUTER_API_KEY"):
            # OpenRouter 专有: models, route, HTTP-Referer, X-Title
            openrouter_params = {}
            if self.config.models:
                openrouter_params["models"] = self.config.models
                openrouter_params["route"] = self.config.route
                params.pop("model")
            if self.config.site_url and self.config.app_name:
                openrouter_params["extra_headers"] = {
                    "HTTP-Referer": self.config.site_url,
                    "X-Title": self.config.app_name,
                }
            params.update(**openrouter_params)
        else:
            # OpenAI store 参数仅当显式设置时传递（避免 vLLM/Groq 等兼容后端报错）
            if self.config.store is not None:
                params["store"] = self.config.store

        if response_format: params["response_format"] = response_format
        if tools: params["tools"] = tools; params["tool_choice"] = tool_choice

        response = self.client.chat.completions.create(**params)
        return self._parse_response(response, tools)

    def _parse_response(self, response, tools):
        """解析响应: 有 tools → 结构化结果; 无 tools → 纯文本"""
        if tools:
            return {
                "content": response.choices[0].message.content,
                "tool_calls": [
                    {"name": tc.function.name,
                     "arguments": json.loads(extract_json(tc.function.arguments))}
                    for tc in (response.choices[0].message.tool_calls or [])
                ],
            }
        return response.choices[0].message.content
```

### 关键设计

| 设计点 | 说明 |
|--------|------|
| OpenRouter 自动检测 | 通过 `OPENROUTER_API_KEY` 环境变量判断路由 |
| store 参数 opt-in | 只显式设置时才传递 `store`，避免 vLLM/Groq 等后端因未知参数报错 |
| response_callback 钩子 | 支持配置回调函数记录请求/响应日志 |
| 多格式配置 | `__init__` 支持 None / dict / BaseLlmConfig / OpenAIConfig 四种输入 |

---

## 4. OpenAIEmbedding 实现 (`embeddings/openai.py`)

```python
class OpenAIEmbedding(EmbeddingBase):
    def __init__(self, config=None):
        self.config.model = self.config.model or "text-embedding-3-small"
        # 只当用户设置了 embedding_dims 时才传入 API（避免非 matryoshka 后端报错）
        self._pass_dimensions_to_api = self.config.embedding_dims is not None
        self.config.embedding_dims = self.config.embedding_dims or 1536
        ...

    def embed(self, text, memory_action=None):
        text = text.replace("\n", " ")
        kwargs = {"input": [text], "model": self.config.model, "encoding_format": "float"}
        if self._pass_dimensions_to_api:
            kwargs["dimensions"] = self.config.embedding_dims
        return self.client.embeddings.create(**kwargs).data[0].embedding

    def embed_batch(self, texts, memory_action="add"):
        """批量嵌入: 每批 100 条，按 index 排序保证顺序"""
        MAX_BATCH = 100
        texts = [t.replace("\n", " ") for t in texts]
        all_embeddings = []
        for i in range(0, len(texts), MAX_BATCH):
            chunk = texts[i : i + MAX_BATCH]
            kwargs = {"input": chunk, "model": self.config.model, "encoding_format": "float"}
            if self._pass_dimensions_to_api:
                kwargs["dimensions"] = self.config.embedding_dims
            response = self.client.embeddings.create(**kwargs)
            # 按 index 排序确保输出顺序与输入一致
            all_embeddings.extend(
                item.embedding for item in sorted(response.data, key=lambda x: x.index)
            )
        return all_embeddings
```

> **`_pass_dimensions_to_api`** 是一个精巧的开关：text-embedding-3-small
> 支持 matryoshka（俄套娃）降维，但当用户使用 vLLM、Voyage 等
> 非 OpenAI 兼容后端时，`dimensions` 参数会导致 400 错误。

---

## 5. Qdrant 向量存储 (`vector_stores/qdrant.py`)

这是最关键的向量存储实现，共 ~300 行，包含完整的过滤体系和 BM25 支持。

### 5.1 初始化与 collection 创建

```python
class Qdrant(VectorStoreBase):
    def __init__(self, collection_name, embedding_model_dims,
                 client=None, host=None, port=None, path=None, url=None,
                 api_key=None, on_disk=False):

        # 构建 QdrantClient: 支持三种模式
        # 1. 传入已有 client      → 共享连接
        # 2. host+port 或 url     → 远程 Qdrant 服务
        # 3. path                  → 本地嵌入式 Qdrant (SQLite + 内存)

        # BM25 懒加载 + 版本兼容标记
        self._bm25_encoder = None
        self._has_bm25_slot = False  # 预 v3 collection 无 bm25 槽位

        self.create_col(embedding_model_dims, on_disk)

    def create_col(self, vector_size, on_disk, distance=Distance.COSINE):
        """创建包含 dense + BM25 sparse 双向量的 collection"""
        existing = self.list_cols()
        for c in existing.collections:
            if c.name == self.collection_name:
                # 检测是否有 bm25 槽位 (v3 兼容)
                info = self.client.get_collection(self.collection_name)
                sparse_cfg = info.config.params.sparse_vectors
                self._has_bm25_slot = bool(sparse_cfg and "bm25" in sparse_cfg)
                if not self._has_bm25_slot:
                    logger.warning("Collection 创建于 v3 之前，BM25 已禁用")
                self._create_filter_indexes()
                return

        # 新 collection: 创建 dense + sparse (BM25)
        self.client.create_collection(
            collection_name=self.collection_name,
            vectors_config=VectorParams(size=vector_size, distance=distance, on_disk=on_disk),
            sparse_vectors_config={
                "bm25": SparseVectorParams(modifier=models.Modifier.IDF),
            },
        )
        self._has_bm25_slot = True
        self._create_filter_indexes()
```

### 5.2 BM25 编码 (fastembed)

```python
def _get_bm25_encoder(self):
    """懒加载 Qdrant/bm25 稀疏文本编码器"""
    if self._bm25_encoder is None:
        try:
            from fastembed import SparseTextEmbedding
            self._bm25_encoder = SparseTextEmbedding(model_name="Qdrant/bm25")
        except ImportError:
            self._bm25_encoder = False  # 哨兵: 尝试过但失败了
    return self._bm25_encoder if self._bm25_encoder is not False else None

def _encode_bm25(self, text: str) -> SparseVector | None:
    encoder = self._get_bm25_encoder()
    if encoder is None: return None
    results = list(encoder.embed([text]))
    if results:
        sparse = results[0]
        return SparseVector(
            indices=sparse.indices.tolist(),
            values=sparse.values.tolist(),
        )
```

### 5.3 插入时同时生成 BM25 向量

```python
def insert(self, vectors, payloads=None, ids=None):
    points = []
    for idx, vector in enumerate(vectors):
        named_vectors = {"": vector}  # "" = 默认 dense 向量

        if self._has_bm25_slot:
            text_for_bm25 = payload.get("text_lemmatized") or payload.get("data", "")
            if text_for_bm25:
                sparse = self._encode_bm25(text_for_bm25)
                if sparse: named_vectors["bm25"] = sparse

        points.append(PointStruct(id=point_id, vector=named_vectors, payload=payload))
    self.client.upsert(collection_name=self.collection_name, points=points)
```

> **双向量存储**: Qdrant 4.x 支持 named vectors，每条记忆同时存储
> dense (语义) 和 sparse (BM25) 两个向量。BM25 用的文本是 `text_lemmatized`
> 字段（经过 spaCy 词形还原），保证关键词匹配的一致性。

### 5.4 过滤器构建 (支持 10 种操作符)

```python
def _build_field_condition(self, key, value) -> FieldCondition | None:
    # 简值: {"key": "value"} → MatchValue
    # 列表: {"key": ["a","b"]} → MatchAny
    # 通配: {"key": "*"} → None (跳过, 匹配所有)

    if not isinstance(value, dict):
        if value == "*": return None
        if isinstance(value, list): return FieldCondition(key=key, match=MatchAny(any=value))
        return FieldCondition(key=key, match=MatchValue(value=value))

    # 范围操作符: gt, gte, lt, lte
    #   → 自动检测 ISO datetime 字符串, 用 DateTimeRange
    if {"gt","gte","lt","lte"} & set(value.keys()):
        range_kwargs = {op: value[op] for op in ... if op in value}
        if self._is_datetime_range(range_kwargs):
            return FieldCondition(key=key, range=DatetimeRange(**range_kwargs))
        return FieldCondition(key=key, range=Range(**range_kwargs))

    # 比较操作符
    if "eq" in value:   return FieldCondition(key=key, match=MatchValue(value=value["eq"]))
    if "ne" in value:   return FieldCondition(..., match=MatchExcept(except=[value["ne"]]))
    if "in" in value:   return FieldCondition(..., match=MatchAny(any=value["in"]))
    if "nin" in value:  return FieldCondition(..., match=MatchExcept(except=value["nin"]))

    # 文本操作符 (MatchText: 全词匹配)
    if "contains" in value or "icontains" in value:
        return FieldCondition(key=key, match=MatchText(text=text))
```

**逻辑运算符支持**:

```python
def _create_filter(self, filters: dict) -> Filter | None:
    # 归一化: $or→OR, $not→NOT, $and→AND (去重合并)
    # AND: 所有子条件加入 must
    # OR:  所有子条件加入 should
    # NOT: 所有子条件加入 must_not
    # 普通字段: 放入 must
    return Filter(must=must or None, should=should or None, must_not=must_not or None)
```

### 5.5 搜索方法

```python
def search(self, query, vectors, top_k=5, filters=None):
    query_filter = self._create_filter(filters)
    hits = self.client.query_points(
        collection_name=self.collection_name,
        query=vectors,        # dense 向量搜索
        query_filter=query_filter,
        limit=top_k,
    )
    return hits.points

def keyword_search(self, query, top_k=5, filters=None):
    """BM25 稀疏向量搜索"""
    if not self._has_bm25_slot: return None
    sparse_query = self._encode_bm25(query)
    if sparse_query is None: return None
    query_filter = self._create_filter(filters)
    hits = self.client.query_points(
        collection_name=self.collection_name,
        query=sparse_query,
        using="bm25",         # 使用 BM25 稀疏向量
        query_filter=query_filter,
        limit=top_k,
    )
    return hits.points

def search_batch(self, queries, vectors_list, top_k=1, filters=None):
    """批量搜索: 使用 Qdrant 原生 query_batch_points"""
    query_filter = self._create_filter(filters)
    requests = [
        models.QueryRequest(query=vec, filter=query_filter, limit=top_k, with_payload=True)
        for vec in vectors_list
    ]
    results = self.client.query_batch_points(
        collection_name=self.collection_name, requests=requests,
    )
    return [r.points for r in results]
```

---

## 6. 多信号检索算法 (`utils/scoring.py`)

这是 mem0 检索质量的精髓，来自源码的精确算法：

```python
ENTITY_BOOST_WEIGHT = 0.5

def get_bm25_params(query, *, lemmatized=None):
    """根据查询长度自适应 sigmoid 参数

    查询越短 → 中点越低 (对低分更敏感) + 更陡峭 (快速过渡)
    查询越长 → 中点越高 (避免过度提升)
    """
    num_terms = len(lemmatized.split()) if lemmatized else len(query.split())

    if num_terms <= 3:    return 5.0, 0.7   # 短查询: BM25 分数低, 需要更多提升
    elif num_terms <= 6:  return 7.0, 0.6
    elif num_terms <= 9:  return 9.0, 0.5
    elif num_terms <= 15: return 10.0, 0.5
    else:                 return 12.0, 0.5  # 长查询: BM25 本来就高, 减少提升

def normalize_bm25(raw_score, midpoint, steepness):
    """Logistic sigmoid 归一化 [0, 1]"""
    return 1.0 / (1.0 + math.exp(-steepness * (raw_score - midpoint)))

def score_and_rank(semantic_results, bm25_scores, entity_boosts, threshold, top_k):
    """加性混合打分: combined = (semantic + bm25 + entity) / max_possible

    关键设计:
    - threshold 作用在 semantic_score 上（先过滤，再融合）
    - max_possible 根据活跃信号自适应:
        semantic only: 1.0
        semantic + BM25: 2.0
        semantic + entity: 1.5
        semantic + BM25 + entity: 2.5
    - 除以 max_possible 确保最终分数在 [0,1] 范围
    """
    has_bm25 = bool(bm25_scores)
    has_entity = bool(entity_boosts)

    max_possible = 1.0
    if has_bm25: max_possible += 1.0
    if has_entity: max_possible += ENTITY_BOOST_WEIGHT  # 0.5

    scored = []
    for result in semantic_results:
        semantic_score = result.get("score", 0.0)

        # 语义分数未达阈值 → 直接排除
        if semantic_score < threshold: continue

        mem_id_str = str(result["id"])
        bm25_score = bm25_scores.get(mem_id_str, 0.0)
        entity_boost = entity_boosts.get(mem_id_str, 0.0)

        raw_combined = semantic_score + bm25_score + entity_boost
        combined = min(raw_combined / max_possible, 1.0)

        scored.append({"id": mem_id_str, "score": combined, "payload": result.get("payload")})

    scored.sort(key=lambda x: x["score"], reverse=True)
    return scored[:top_k]
```

### 检索流程图解

```
用户查询: "Alice 的暗色模式偏好"

Step 1: 预处理
├── lemmatize_for_bm25("Alice 的暗色模式偏好") → "alice 暗色 模式 偏好"
└── extract_entities("Alice 的暗色模式偏好") → [("PROPER", "Alice"), ("COMPOUND", "暗色模式")]

Step 2: 嵌入
└── embed("Alice 的暗色模式偏好", "search") → [0.012, -0.034, ...]  (1536维)

Step 3: 语义搜索 (dense)
└── vector_store.search(vectors=[...], top_k=80)
    返回: [{id:"mem_a", score:0.82}, {id:"mem_b", score:0.75}, ...]

Step 4: BM25 搜索 (sparse)
└── vector_store.keyword_search("alice 暗色 模式 偏好", top_k=80)
    返回: [{id:"mem_a", score:8.5}, {id:"mem_c", score:6.2}, ...]

Step 5: BM25 归一化
├── get_bm25_params → (5.0, 0.7)  # 4个词 → 短查询
├── normalize_bm25(8.5, 5.0, 0.7) → 1/(1+exp(-0.7*(8.5-5.0))) ≈ 0.92
└── normalize_bm25(6.2, 5.0, 0.7) → 1/(1+exp(-0.7*(6.2-5.0))) ≈ 0.70

Step 6: 实体增强
├── embed("Alice", "search") → search entity_store → 匹配到 entity_A (score:0.9)
│   └── entity_A.linked_memory_ids = ["mem_a", "mem_d", "mem_e"]
│   └── weight = 1/(1+0.001*(3-1)^2) = 1/(1+0.004) ≈ 0.996
│   └── boost = 0.9 * 0.5 * 0.996 ≈ 0.448
├── embed("暗色模式", "search") → search entity_store → 匹配到 entity_B (score:0.85)
│   └── entity_B.linked_memory_ids = ["mem_a", "mem_f"]
│   └── weight = 1/(1+0.001*(2-1)^2) = 1/(1+0.001) ≈ 0.999
│   └── boost = 0.85 * 0.5 * 0.999 ≈ 0.425

Step 7: 融合 (所有三个信号都活跃 → max_possible = 2.5)

mem_a: (0.82 + 0.92 + 0.448) / 2.5 = 0.875  ← 最高分
mem_b: (0.75 + 0.00 + 0.000) / 2.5 = 0.300  ← 仅有语义
mem_c: (0.40 + 0.70 + 0.000) / 2.5 = 0.440  ← 语义+BM25
mem_d: (0.30 + 0.00 + 0.448) / 2.5 = 0.299  ← 语义+实体
```

---

## 7. BM25 词形还原 (`utils/lemmatization.py`)

```python
def lemmatize_for_bm25(text: str) -> str:
    """spaCy 词形还原 → 用于 BM25 匹配

    为什么用 lemmatize 而不是 stem:
    - 动词: attending/attends/attended → attend
    - 比较级: older/oldest → old
    - 复数: memories → memory
    - 避免过度词干化: organization ≠ organize
    """
    nlp = get_nlp_lemma()
    if nlp is None: return text  # spaCy 不可用时直接返回原文

    doc = nlp(text.lower())
    tokens = []
    for token in doc:
        if token.is_punct or token.is_stop: continue

        lemma = token.lemma_
        if lemma.isalnum(): tokens.append(lemma)

        # 特殊处理 -ing: 保留原词和 lemma（解决名动词歧义）
        # 例如: "meeting" 作为名词 (会议) 和动词 (见面) 词形还原不同
        if token.text.endswith("ing") and token.text != lemma and token.text.isalnum():
            tokens.append(token.text)

    return " ".join(tokens)
```

---

## 8. 实体提取 (`utils/entity_extraction.py`)

```python
def extract_entities(text: str):
    """4 级实体提取，优先级递减:
    1. PROPER (专有名词): 通过 spaCy NER 识别 PERSON, ORG, GPE, PRODUCT, LOC, FAC, EVENT...
    2. QUOTED (引号文本): 正则匹配 "..." 或 '...' 或 「...」
    3. COMPOUND (复合名词): spaCy noun_chunks, 连续的 NOUN/PROPN/ADJ
    4. NOUN (名词降级): 单个名词 (长度 > 2)
    """

    # 预处理: 移除所有格 ('s/' ), 括号内容
    text = re.sub(r"(\w+)'s\b", r"\1", text)
    text = re.sub(r'\s*\([^)]*\)', '', text)

    # 后处理: 过滤
    seen = set()
    for entity_type, entity_text in all_entities:
        # 去重 + 去除停用词 + 过滤过短词 + 去除纯数字
        normalized = entity_text.strip().lower()
        if normalized not in seen and not _is_stopword_only(entity_text):
            seen.add(normalized)
            yield (entity_type, entity_text)

def extract_entities_batch(texts: List[str]):
    """批量提取：共享 spaCy NLP pipeline，比逐个调用快 ~30%"""
    nlp = get_nlp_entity()
    docs = list(nlp.pipe(texts))
    return [_extract_entities_from_doc(doc) for doc in docs]
```

### 实体清理策略

| 清理规则 | 示例 |
|---------|------|
| 所有格 | Alice's → Alice |
| 括号去除 | 张三(CEO) → 张三 |
| 停用词 | "the morning" → None |
| 过短词 | "AI" (2 字符) → None |
| 纯数字 | "42" → None |
| 列表逗号分隔 | "apple, banana, cherry" → apple, banana, cherry (分开) |
| 单/复数去重 | "programmer" / "programmers" → 只保留一个 |

---

## 9. Prompt 工程 (`configs/prompts.py`, 1062 行)

### 9.1 ADDITIVE_EXTRACTION_PROMPT (V3 核心)

这是一个约 900 行的 system prompt，包含 12 个精心设计的示例。核心指令：

```
1. ADD-only: 只新增记忆，不修改或删除已有记忆
2. 原子事实: 每条记忆只描述一个独立事实
3. 不重复: 检查已有记忆中是否已存在相同事实
4. 每个 entity 在每个新记忆中仅作为值提及一次
5. attributed_to: 标明事实来源 (user/agent)
```

**输出格式**:
```json
{
  "memory": [
    {"text": "用户偏好暗色模式", "attributed_to": "user"},
    {"text": "用户使用 vim 键位", "attributed_to": "user"}
  ]
}
```

### 9.2 AGENT_CONTEXT_SUFFIX

当 `agent_id` 存在且消息中有 assistant 角色时追加：

```
You are also processing agent-produced messages.
When the agent confirms an action was completed, extract that as a fact.
Agent actions are as important as user facts.
```

### 9.3 Prompt 构建流程

```python
def generate_additive_extraction_prompt(
    existing_memories, new_messages, last_k_messages, custom_instructions
):
    """构建 user prompt:
    1. 已有记忆摘要 (带 ID 映射 "0", "1", "2")
    2. 最近 K 条消息 (上下文)
    3. 新消息内容
    4. 自定义指令 (如有)
    5. 当前日期 (用于时间推理)
    """
```

### 9.4 PROCEDURAL_MEMORY_SYSTEM_PROMPT

用于创建 "过程记忆" (需要 `agent_id` + `memory_type="procedural_memory"`):

```
You are a memory summarizer. Summarize the conversation above into
a concise procedural memory describing what was accomplished,
what steps were taken, and any important decisions made.
```

---

## 10. SQLiteManager 详解 (`memory/storage.py`)

```sql
-- 历史记录表: 完整审计日志
CREATE TABLE history (
    id         TEXT PRIMARY KEY,   -- UUID
    memory_id  TEXT,               -- 关联的记忆 UUID
    old_memory TEXT,               -- 变更前文本
    new_memory TEXT,               -- 变更后文本
    event      TEXT,               -- ADD / UPDATE / DELETE
    created_at DATETIME,
    updated_at DATETIME,
    is_deleted INTEGER,            -- 0=否 1=是
    actor_id   TEXT,               -- 操作者标识
    role       TEXT                -- 消息角色
);

-- 消息表: 保留最近 10 条, 自动淘汰
CREATE TABLE messages (
    id            TEXT PRIMARY KEY,
    session_scope TEXT,            -- "user_id=xxx&agent_id=yyy"
    role          TEXT,
    content       TEXT,
    name          TEXT,            -- 可选 name 字段
    created_at    DATETIME
);
```

### 关键实现

```python
def save_messages(self, messages, session_scope):
    """保存消息 + 自动淘汰超出 10 条的旧消息"""
    with self._lock:
        self.connection.execute("BEGIN")
        for msg in messages:
            self.connection.execute(
                "INSERT INTO messages (...) VALUES (?, ?, ?, ?, ?, ?)",
                (uuid4(), session_scope, msg["role"], msg["content"], msg.get("name"), now),
            )
        # 淘汰: 用子查询绕过 SQLite 的 ORDER BY + DELETE 限制
        self.connection.execute(
            """DELETE FROM messages WHERE session_scope = ? AND id NOT IN (
                SELECT id FROM (
                    SELECT id FROM messages
                    WHERE session_scope = ? ORDER BY created_at DESC LIMIT 10
                )
            )""",
            (session_scope, session_scope),
        )
        self.connection.execute("COMMIT")

def _migrate_history_table(self):
    """自动迁移旧 schema → 新 schema (无 convo 列)"""
    # 1. 检查是否需要迁移 (比对列名)
    # 2. RENAME → CREATE new → COPY data → DROP old
    # 3. 事务保护, 失败回滚
```

> **线程安全**: 所有写入通过 `threading.Lock()` 保护，`check_same_thread=False` 允许多线程读取。

---

## 11. MemoryClient — 云端 API 客户端 (`client/main.py`, 1797 行)

```python
class MemoryClient:
    def __init__(self, api_key=None, host="https://api.mem0.ai", client=None):
        # 1. 支持传入自定义 httpx.Client (复用连接)
        # 2. 自动从环境变量获取 MEM0_API_KEY
        # 3. 默认 host: api.mem0.ai
        # 4. 验证 API key → 获取 org_id, project_id, user_email
        ...

    # 入口使用 v3 端点 (与 OSS 版不同)
    def add(self, messages, options=None, **kwargs):
        # POST /v3/memories/add/
        ...

    def search(self, query, options=None, **kwargs):
        # POST /v3/memories/search/
        ...

    def get_all(self, options=None, **kwargs):
        # POST /v3/memories/
        ...

    # 额外功能 (平台专用)
    def create_memory_export(self, ...): ...
    def get_memory_export(self, ...): ...
    def get_summary(self, ...): ...
    def feedback(self, ...): ...
    def create_webhook(self, ...): ...
```

---

## 12. 完整数据流串讲

### 12.1 add 数据流

```
用户输入: "我叫张三, 喜欢打篮球"
     │
     ▼
Memory.add(messages=[{"role":"user","content":"我叫张三..."}], user_id="alice")
     │
     ├─► _build_filters_and_metadata() → metadata={user_id:"alice"}, filters={user_id:"alice"}
     │
     ├─► parse_messages() → "user: 我叫张三, 喜欢打篮球"
     │
     ├─► embed(parsed_messages, "search") → query_vec [1536d]
     │
     ├─► vector_store.search(query_vec, top_k=10, filters)
     │     └─► existing_memories = [{"id":"0", "text":"...之前的事实"}, ...]
     │
     ├─► llm.generate_response(system_prompt=ADDITIVE_EXTRACTION, user_prompt=...)
     │     └─► {"memory": [{"text":"用户叫张三","attributed_to":"user"},
     │                      {"text":"用户喜欢打篮球","attributed_to":"user"}]}
     │
     ├─► embed_batch(["用户叫张三", "用户喜欢打篮球"], "add")
     │     └─► [[0.01,...], [0.23,...]]  (2 × 1536d)
     │
     ├─► 每条独立处理: UUID, hash=md5(text), lemmatize, metadata 构建
     │
     ├─► vector_store.insert(vectors=[...], ids=[uuid1, uuid2], payloads=[meta1, meta2])
     │     └─► Qdrant: 同时生成 dense + BM25 sparse 双向量
     │
     ├─► db.batch_add_history([{memory_id:uuid1, event:"ADD"}, ...])
     │
     ├─► extract_entities_batch(["用户叫张三", "用户喜欢打篮球"])
     │     ├─► "张三" (PROPER), "篮球" (NOUN)
     │     └─► entity_store: 搜索→更新或新增→linked_memory_ids
     │
     └─► return {"results": [{"id":uuid1,"memory":"用户叫张三","event":"ADD"}, ...]}
```

### 12.2 search 数据流

```
用户查询: "张三喜欢什么运动"
     │
     ▼
Memory.search("张三喜欢什么运动", filters={"user_id":"alice"})
     │
     ├─► lemmatize_for_bm25("张三喜欢什么运动") → "张三 喜欢 什么 运动"
     ├─► extract_entities("张三喜欢什么运动") → [("PROPER","张三"), ("NOUN","运动")]
     │
     ├─► embed(query, "search") → query_vec [1536d]
     │
     ├─► vector_store.search(query_vec, top_k=80) → semantic_results
     ├─► vector_store.keyword_search("张三 喜欢 什么 运动", top_k=80) → bm25_results
     │
     ├─► normalize_bm25(bm25_results, midpoint, steepness) → {mem_id: score}
     │
     ├─► _compute_entity_boosts(["张三","运动"], filters)
     │     ├─► embed("张三","search") → search entity_store → 匹配 entity_张三
     │     │     └─► linked: [uuid1, uuid5] → boost += 相似度 * 0.5 * 衰减
     │     ├─► embed("运动","search") → search entity_store → 匹配 entity_篮球
     │     │     └─► linked: [uuid2] → boost += 相似度 * 0.5 * 衰减
     │     └─► return {uuid1: 0.45, uuid2: 0.42, uuid5: 0.30}
     │
     ├─► score_and_rank(semantic, bm25, entity, threshold=0.1)
     │     └─► top 5: [{"id":uuid2, "score":0.87}, {"id":uuid1, "score":0.82}, ...]
     │
     └─► return {"results": [{"id":uuid2, "memory":"用户喜欢打篮球", "score":0.87}, ...]}
```

---

## 13. 安全性设计

### 13.1 配置序列化安全

```python
_RUNTIME_FIELDS = frozenset({"http_auth", "auth", "connection_class", ...})
_SENSITIVE_FIELDS_EXACT = frozenset({"api_key", "secret_key", "private_key", ...})
_SENSITIVE_SUFFIXES = ("_password", "_secret", "_token", "_credential", ...)

def _is_sensitive_field(field_name: str) -> bool:
    """分层检测:
    1. Runtime fields (allowlist) → 总是保留
    2. 精确匹配 deny list → 已知敏感字段
    3. 后缀 deny list → 模式匹配 (db_password, auth_secret...)
    """
```

### 13.2 输入校验

```python
def _validate_and_trim_entity_id(value, name):
    """校验 entity ID:
    - 去除首尾空白
    - 拒绝空字符串
    - 拒绝含内部空格的字符串 (防止 SQL 注入)
    """
    trimmed = value.strip()
    if trimmed == "": raise ValueError("cannot be empty")
    if any(c.isspace() for c in trimmed): raise ValueError("cannot contain whitespace")
    return trimmed

def _validate_search_params(threshold, top_k):
    """threshold: [0, 1], top_k: 非负整数"""
```

---

## 14. 错误处理模式

```python
# 批量操作 + 降级: 所有批量操作都是 "先试着批量, 失败则逐个 fallback"

# 嵌入降级
try:
    embeddings = self.embedding_model.embed_batch(texts, "add")
except Exception:
    embeddings = [self.embedding_model.embed(t, "add") for t in texts]

# 存储降级
try:
    self.vector_store.insert(vectors=all_vectors, ids=all_ids, payloads=all_payloads)
except Exception:
    for mid, vec, pay in zip(all_ids, all_vectors, all_payloads):
        try: self.vector_store.insert(vectors=[vec], ids=[mid], payloads=[pay])
        except Exception as e: logger.error(...)

# 实体链接总是非致命的
try: self._link_entities_for_memory(...)
except Exception as e: logger.warning(...)
```

---

## 15. 总结: mem0 设计哲学

| 原则 | 具体体现 |
|------|----------|
| **ADD-only 记忆积累** | V3 不再修改/删除记忆，让检索来排序决策 |
| **多信号互补** | 语义 (理解含义) + 关键词 (精准命中) + 实体 (跨记忆关联) |
| **批量优先降级安全** | 最优路径走批量 API，失败自动降级逐个执行 |
| **反幻觉化** | UUID→整数映射，LLM 编造不了的 ID |
| **懒加载一切** | 实体存储、BM25 编码器、spaCy 模型均在首次使用时加载 |
| **向后兼容** | `_has_bm25_slot` 标记让预 v3 collection 仍能正常工作 |
| **provider 透明** | 工厂模式 + 抽象基类，切换 LLM/Embedding/VectorStore 只需改配置 |
| **线程安全** | SQLite 用 threading.Lock，Qdrant 共享客户端连接 |
