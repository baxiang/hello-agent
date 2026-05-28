# 07-Map-Reduce模式

> Send API、并行扇出、扇入聚合、动态图构建

## Map-Reduce 概述

Map-Reduce 模式用于并行处理多个任务，然后聚合结果：

```
Map-Reduce 流程：
┌──────────────────────────────────────┐
│  输入: [task1, task2, task3]         │
│    ↓                                 │
│  Map (扇出):                          │
│  ├─ process(task1) → result1         │
│  ├─ process(task2) → result2         │
│  └─ process(task3) → result3         │
│    ↓                                 │
│  Reduce (扇入):                       │
│  aggregate([result1, result2, result3])│
│    ↓                                 │
│  输出: final_result                  │
└──────────────────────────────────────┘
```

### 适用场景

| 场景 | Map 操作 | Reduce 操作 |
|------|---------|------------|
| 批量翻译 | 翻译每段文本 | 合并译文 |
| 数据分析 | 分析每个数据集 | 汇总统计 |
| 文档处理 | 处理每个文档 | 合并结果 |
| 并行搜索 | 搜索每个关键词 | 合并搜索结果 |

---

## Send API

### 基本扇出

```python
from typing import TypedDict
from langgraph.graph import StateGraph, START, END
from langgraph.types import Send

class State(TypedDict):
    topics: list[str]
    results: list[str]

# 扇出：为每个 topic 创建任务
def map_topics(state: State):
    """Map 步骤：扇出"""
    return [
        Send("process_topic", {"topic": topic})
        for topic in state["topics"]
    ]

# 处理单个任务
def process_topic(state: dict):
    """处理单个 topic"""
    topic = state["topic"]
    # 模拟处理
    result = f"分析了 {topic}"
    return {"result": result}

# 扇入：聚合结果
def reduce_results(state: State):
    """Reduce 步骤：聚合"""
    return {"results": [f"结果: {r}" for r in state.get("results", [])]}

# 构建图
builder = StateGraph(State)
builder.add_node("map_topics", map_topics)
builder.add_node("process_topic", process_topic)
builder.add_node("reduce_results", reduce_results)

builder.add_edge(START, "map_topics")
# map_topics 返回 Send 列表，自动扇出到 process_topic
builder.add_edge("process_topic", "reduce_results")
builder.add_edge("reduce_results", END)

graph = builder.compile()

# 调用
result = graph.invoke({
    "topics": ["Python", "JavaScript", "Rust"],
    "results": [],
})
print(result["results"])
```

---

## 并行扇出

### 并行处理

```python
from typing import TypedDict, Annotated
from operator import add
from langgraph.graph import StateGraph, START, END
from langgraph.types import Send

class State(TypedDict):
    tasks: list[str]
    results: Annotated[list[str], add]

def fan_out(state: State):
    """扇出：为每个任务创建处理节点"""
    return [
        Send("process_task", {"task": task})
        for task in state["tasks"]
    ]

def process_task(state: dict):
    """处理单个任务"""
    task = state["task"]
    result = f"完成: {task}"
    return {"results": [result]}

def fan_in(state: State):
    """扇入：所有结果已收集"""
    return {"status": f"完成 {len(state['results'])} 个任务"}

# 构建图
builder = StateGraph(State)
builder.add_node("fan_out", fan_out)
builder.add_node("process_task", process_task)
builder.add_node("fan_in", fan_in)

builder.add_edge(START, "fan_out")
builder.add_edge("process_task", "fan_in")
builder.add_edge("fan_in", END)

graph = builder.compile()

result = graph.invoke({
    "tasks": ["任务1", "任务2", "任务3"],
    "results": [],
})
print(result["results"])  # ['完成: 任务1', '完成: 任务2', '完成: 任务3']
```

---

## 扇入聚合

### 聚合策略

```python
from typing import TypedDict
from langgraph.graph import StateGraph, START, END
from langgraph.types import Send

class State(TypedDict):
    queries: list[str]
    search_results: list[dict]
    summary: str

def search_fan_out(state: State):
    """扇出搜索"""
    return [
        Send("search_node", {"query": q})
        for q in state["queries"]
    ]

def search_node(state: dict):
    """搜索节点"""
    query = state["query"]
    # 模拟搜索
    results = [f"结果1 for {query}", f"结果2 for {query}"]
    return {"search_results": [{"query": query, "results": results}]}

def aggregate_results(state: State):
    """聚合搜索结果"""
    all_results = state["search_results"]
    
    # 合并所有结果
    combined = []
    for item in all_results:
        combined.extend(item["results"])
    
    # 生成摘要
    summary = f"共找到 {len(combined)} 条结果"
    
    return {
        "search_results": all_results,
        "summary": summary,
    }

# 构建图
builder = StateGraph(State)
builder.add_node("fan_out", search_fan_out)
builder.add_node("search_node", search_node)
builder.add_node("aggregate", aggregate_results)

builder.add_edge(START, "fan_out")
builder.add_edge("search_node", "aggregate")
builder.add_edge("aggregate", END)

graph = builder.compile()

result = graph.invoke({
    "queries": ["Python 教程", "Python 面试", "Python 最佳实践"],
    "search_results": [],
})
print(result["summary"])
```

---

## 动态图构建

### 条件扇出

```python
from typing import TypedDict
from langgraph.graph import StateGraph, START, END
from langgraph.types import Send

class State(TypedDict):
    items: list[dict]
    processed: list[str]

def dynamic_fan_out(state: State):
    """动态扇出：根据内容决定任务"""
    sends = []
    
    for item in state["items"]:
        if item["type"] == "text":
            sends.append(Send("process_text", {"content": item["content"]}))
        elif item["type"] == "image":
            sends.append(Send("process_image", {"url": item["url"]}))
        elif item["type"] == "code":
            sends.append(Send("process_code", {"code": item["code"]}))
    
    return sends

def process_text(state: dict):
    return {"processed": [f"文本: {state['content'][:50]}"]}

def process_image(state: dict):
    return {"processed": [f"图片: {state['url']}"]}

def process_code(state: dict):
    return {"processed": [f"代码: {state['code'][:50]}"]}

def collect_results(state: State):
    return {"status": f"处理完成 {len(state['processed'])} 项"}

# 构建图
builder = StateGraph(State)
builder.add_node("fan_out", dynamic_fan_out)
builder.add_node("process_text", process_text)
builder.add_node("process_image", process_image)
builder.add_node("process_code", process_code)
builder.add_node("collect", collect_results)

builder.add_edge(START, "fan_out")
builder.add_edge("process_text", "collect")
builder.add_edge("process_image", "collect")
builder.add_edge("process_code", "collect")
builder.add_edge("collect", END)

graph = builder.compile()

result = graph.invoke({
    "items": [
        {"type": "text", "content": "这是一段文本"},
        {"type": "image", "url": "https://example.com/img.png"},
        {"type": "code", "code": "def hello(): pass"},
    ],
    "processed": [],
})
print(result["processed"])
```

---

## 嵌套 Map-Reduce

### 多层 Map-Reduce

```python
from typing import TypedDict, Annotated
from operator import add

class State(TypedDict):
    documents: list[str]
    chunks: list[str]
    analyses: Annotated[list[dict], add]
    summary: str

# 第一层 Map：文档分块
def split_documents(state: State):
    """分块"""
    chunks = []
    for doc in state["documents"]:
        # 简单分块
        chunks.extend(doc.split("\n\n"))
    return {"chunks": chunks}

# 第二层 Map：分析每块
def analyze_fan_out(state: State):
    """扇出分析"""
    return [
        Send("analyze_chunk", {"chunk": chunk, "index": i})
        for i, chunk in enumerate(state["chunks"])
    ]

def analyze_chunk(state: dict):
    """分析单块"""
    chunk = state["chunk"]
    analysis = {
        "index": state["index"],
        "summary": chunk[:50] + "...",
        "keywords": ["key1", "key2"],
    }
    return {"analyses": [analysis]}

# Reduce：汇总
def summarize(state: State):
    """汇总分析结果"""
    analyses = state["analyses"]
    summary = f"分析了 {len(analyses)} 个块"
    return {"summary": summary}

# 构建图
builder = StateGraph(State)
builder.add_node("split", split_documents)
builder.add_node("fan_out", analyze_fan_out)
builder.add_node("analyze_chunk", analyze_chunk)
builder.add_node("summarize", summarize)

builder.add_edge(START, "split")
builder.add_edge("split", "fan_out")
builder.add_edge("analyze_chunk", "summarize")
builder.add_edge("summarize", END)

graph = builder.compile()

result = graph.invoke({
    "documents": ["文档1内容\n\n段落2\n\n段落3", "文档2内容"],
    "chunks": [],
    "analyses": [],
})
print(result["summary"])
```

---

## 错误处理

### 容错 Map-Reduce

```python
from typing import TypedDict, Annotated
from operator import add

class State(TypedDict):
    tasks: list[str]
    results: Annotated[list[dict], add]
    errors: Annotated[list[dict], add]

def fan_out_with_retry(state: State):
    """扇出"""
    return [
        Send("process_with_error_handling", {"task": task})
        for task in state["tasks"]
    ]

def process_with_error_handling(state: dict):
    """带错误处理的任务"""
    task = state["task"]
    try:
        # 模拟可能失败的任务
        if "失败" in task:
            raise ValueError("任务失败")
        
        result = {"task": task, "status": "success"}
        return {"results": [result]}
    except Exception as e:
        error = {"task": task, "error": str(e)}
        return {"errors": [error]}

def final_aggregate(state: State):
    """最终聚合"""
    success_count = len(state["results"])
    error_count = len(state["errors"])
    
    return {
        "summary": f"成功: {success_count}, 失败: {error_count}",
    }

# 构建图
builder = StateGraph(State)
builder.add_node("fan_out", fan_out_with_retry)
builder.add_node("process_with_error_handling", process_with_error_handling)
builder.add_node("final_aggregate", final_aggregate)

builder.add_edge(START, "fan_out")
builder.add_edge("process_with_error_handling", "final_aggregate")
builder.add_edge("final_aggregate", END)

graph = builder.compile()

result = graph.invoke({
    "tasks": ["任务1", "失败任务", "任务3"],
    "results": [],
    "errors": [],
})
print(result["summary"])  # "成功: 2, 失败: 1"
```

---

## 最佳实践

### 1. 合理并行度

```python
# 根据系统资源调整并行度
MAX_PARALLEL = 10

def controlled_fan_out(state: State):
    """控制并行度"""
    tasks = state["tasks"][:MAX_PARALLEL]  # 限制数量
    return [
        Send("process", {"task": t})
        for t in tasks
    ]
```

### 2. 结果排序

```python
def ordered_reduce(state: State):
    """有序聚合"""
    # 按原始顺序排序结果
    results = sorted(
        state["results"],
        key=lambda r: r.get("index", 0),
    )
    return {"ordered_results": results}
```

### 3. 进度追踪

```python
class State(TypedDict):
    total_tasks: int
    completed_tasks: Annotated[int, lambda a, b: a + b]
    results: list[dict]

def track_progress(state: State):
    """追踪进度"""
    progress = state["completed_tasks"] / state["total_tasks"] * 100
    print(f"进度: {progress:.1f}%")
    return state
```

---

## 小结

| 要点 | 说明 |
|------|------|
| Send API | 为每个输入创建并行任务 |
| 扇出 | Map 步骤，并行处理 |
| 扇入 | Reduce 步骤，聚合结果 |
| 动态图 | 根据内容决定任务类型 |
| 嵌套 | 多层 Map-Reduce |
| 错误处理 | 容错聚合，区分成功/失败 |
| 最佳实践 | 控制并行度、结果排序、进度追踪 |
