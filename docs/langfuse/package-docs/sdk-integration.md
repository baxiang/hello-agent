# SDK 集成详解

Langfuse 提供了 Python 和 JS/TS 两种官方 SDK，以及与 LangChain、OpenTelemetry 等框架的集成方案。SDK 负责在应用端创建 Trace、Span、Generation 等实体，并通过摄取 API 发送到 Langfuse 后端。

---

## 1. Python SDK

**包名**: `langfuse`

### 1.1 核心概念

Python SDK 围绕以下核心实体构建，与后端事件类型一一对应：

| SDK 方法 | 事件类型 | 说明 |
|---------|---------|------|
| `langfuse.trace()` | TRACE_CREATE | 创建 Trace |
| `trace.span()` | SPAN_CREATE | 创建 Span |
| `trace.generation()` | GENERATION_CREATE | 创建 Generation |
| `trace.event()` | EVENT_CREATE | 创建 Event |
| `trace.score()` | SCORE_CREATE | 创建 Score |

### 1.2 基本用法

```python
from langfuse import Langfuse

langfuse = Langfuse(
    public_key="pk-...",
    secret_key="sk-...",
    host="https://cloud.langfuse.com",
)

# 创建 Trace
trace = langfuse.trace(
    name="my-trace",
    user_id="user-123",
    metadata={"env": "production"},
    tags=["production", "v2"],
)

# 创建 Span
span = trace.span(
    name="retrieval",
    input={"query": "What is Langfuse?"},
)

# 创建 Generation
generation = trace.generation(
    name="llm-call",
    model="gpt-4",
    input={"messages": [{"role": "user", "content": "Hello"}]},
)

# 更新 Generation（设置输出和用量）
generation.end(
    output={"content": "Hi there!"},
    usage={"input": 10, "output": 5, "total": 15},
)

# 创建 Score
trace.score(
    name="accuracy",
    value=0.95,
    data_type="NUMERIC",
)

# 刷新待发送事件
langfuse.flush()
```

### 1.3 嵌套结构

SDK 支持灵活的嵌套结构：

```python
# Trace -> Span -> Generation
trace = langfuse.trace(name="pipeline")
span = trace.span(name="step-1")
generation = span.generation(name="llm", model="gpt-4")

# Span 内嵌套 Span
outer = trace.span(name="outer")
inner = outer.span(name="inner")
```

---

## 2. JS/TS SDK

**包名**: `langfuse`

### 2.1 核心用法

```typescript
import { Langfuse } from "langfuse";

const langfuse = new Langfuse({
  publicKey: "pk-...",
  secretKey: "sk-...",
  baseUrl: "https://cloud.langfuse.com",
});

// 创建 Trace
const trace = langfuse.trace({
  name: "my-trace",
  userId: "user-123",
  metadata: { env: "production" },
});

// 创建 Generation
const generation = trace.generation({
  name: "llm-call",
  model: "gpt-4",
  input: { messages: [{ role: "user", content: "Hello" }] },
});

// 更新 Generation
generation.end({
  output: { content: "Hi there!" },
  usage: { input: 10, output: 5, total: 15 },
});

// 刷新
await langfuse.flushAsync();
```

---

## 3. LangChain 集成

### 3.1 CallbackHandler

LangChain 集成通过 CallbackHandler 自动追踪 LLM 调用：

```python
from langfuse.langchain import CallbackHandler
from langchain_openai import ChatOpenAI

langfuse_handler = CallbackHandler(
    public_key="pk-...",
    secret_key="sk-...",
    host="https://cloud.langfuse.com",
)

llm = ChatOpenAI(model="gpt-4")

# 自动追踪 LLM 调用
response = llm.invoke(
    "What is Langfuse?",
    config={"callbacks": [langfuse_handler]},
)

langfuse_handler.flush()
```

### 3.2 自动追踪的内容

CallbackHandler 会自动创建：

- **Trace**: 每次 chain/agent 调用创建一个 Trace
- **Span**: 每个 tool 调用和 chain 步骤创建 Span
- **Generation**: 每次 LLM 调用创建 Generation，记录 input、output、usage
- **Score**: 支持通过回调添加评分

---

## 4. OpenTelemetry 集成

Langfuse 支持通过 OTLP（OpenTelemetry Protocol）导出追踪数据：

### 4.1 OTLP 导出

```python
from opentelemetry.exporter.otlp.proto.grpc.trace_exporter import OTLPSpanExporter
from opentelemetry.sdk.trace import TracerProvider
from opentelemetry.sdk.trace.export import BatchSpanProcessor

# 配置 OTLP 导出器指向 Langfuse
exporter = OTLPSpanExporter(
    endpoint="https://cloud.langfuse.com/api/public/otel",
    headers={"Authorization": "Basic ..."},
)

provider = TracerProvider()
provider.add_span_processor(BatchSpanProcessor(exporter))
```

### 4.2 事件映射

OTel Span 会被映射为 Langfuse 实体：

| OTel 概念 | Langfuse 实体 | 说明 |
|----------|-------------|------|
| Trace | Trace | 顶级追踪 |
| Span | Span/Observation | 子操作 |
| Span 属性 | metadata | 键值对属性 |

OTel 来源的事件在 Worker 中使用 `skipS3List=true` 快速路径处理（`processEventBatch.ts:292-298`），直接下载已知文件而不需要列出 S3 目录。

---

## 5. Decorator 模式

Python SDK 提供 `@observe` 装饰器，自动将函数调用转为 Trace/Span/Generation：

```python
from langfuse.decorators import observe
from langfuse import Langfuse

langfuse = Langfuse()

@observe(name="my-function")
def my_function(input_text: str) -> str:
    # 自动创建 Span
    result = llm_call(input_text)
    return result

@observe(name="pipeline", as_type="trace")
def pipeline(query: str):
    # 自动创建 Trace
    return my_function(query)
```

装饰器参数：

| 参数 | 说明 |
|------|------|
| `name` | 实体名称 |
| `as_type` | 实体类型：trace、span、generation |
| `capture_input` | 是否捕获函数输入 |
| `capture_output` | 是否捕获函数输出 |

---

## 6. Streaming 支持

SDK 支持流式 Generation，用于追踪流式 LLM 响应：

```python
# Python SDK 流式追踪
generation = trace.generation(
    name="streaming-llm",
    model="gpt-4",
    input={"prompt": "Tell me a story"},
)

# 流式输出时逐步更新
for chunk in stream_response:
    generation.end(output=accumulated_output)
```

流式 Generation 的关键：

- 首次创建时发送 `GENERATION_CREATE` 事件
- 后续更新发送 `GENERATION_UPDATE` 事件
- `completionStartTime` 字段记录首个 token 到达时间
- IngestionService 会按时间顺序合并 CREATE 和 UPDATE 事件

---

## 7. 评分 API

### 7.1 通过 SDK 创建 Score

```python
# 数值评分
trace.score(name="relevance", value=0.8, data_type="NUMERIC")

# 分类评分
trace.score(name="sentiment", value="positive", data_type="CATEGORICAL")

# 布尔评分
trace.score(name="is_correct", value=1, data_type="BOOLEAN")

# 关联到 Observation
generation.score(name="helpfulness", value=4, data_type="NUMERIC")
```

### 7.2 通过 REST API 创建 Score

Score 也可以通过 `POST /api/public/scores` 端点独立创建，不依赖 SDK。该端点内部同样使用 `processEventBatch` 处理（复用 S3 上传和队列逻辑）。

Score 的 source 字段标识来源（`types.ts:521-523`）：

| 值 | 说明 |
|----|------|
| `API` | 通过 API/SDK 创建 |
| `EVAL` | 自动化评估创建 |
| `ANNOTATION` | 人工标注创建 |

---

## 8. Prompt Management API

### 8.1 在代码中获取 Prompt

```python
# Python SDK
prompt = langfuse.get_prompt("my-prompt", label="production")

# 编译变量
compiled = prompt.compile(user_name="Alice", context="...")

# 获取配置
model = prompt.config.get("model", "gpt-4")
temperature = prompt.config.get("temperature", 0.7)
```

### 8.2 与 Generation 关联

```python
prompt = langfuse.get_prompt("my-prompt", label="production")

generation = trace.generation(
    name="llm-call",
    prompt=prompt,  # 自动关联 Prompt
    input=prompt.compile(user_input="Hello"),
)
```

SDK 在发送 Generation 事件时，会附加 `promptName` 和 `promptVersion` 字段。IngestionService 在处理观察事件时，通过 `PromptService` 查找对应的 Prompt 并将 `prompt_id`、`prompt_name`、`prompt_version` 写入 ClickHouse 观察记录（`index.ts:1021-1041`）。

### 8.3 Prompt 缓存

SDK 端会缓存 Prompt 以减少 API 调用：

- Python SDK: 默认每 60 秒刷新一次缓存
- JS/TS SDK: 默认每 60 秒刷新一次缓存
- 可通过 `langfuse.get_prompt(..., cache_ttl_seconds=300)` 自定义缓存时间
- 当 Label 指向新版本时，SDK 会在下次缓存刷新后获取到新版本

