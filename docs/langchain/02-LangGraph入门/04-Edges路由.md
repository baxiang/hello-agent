# 04-Edges路由

> 边决定图中节点的执行流程，是图的"神经网络"

## 边的两种类型

```
┌─────────────────────────────────────────────────┐
│                  Edges 分类                       │
│                                                 │
│  1. 普通边 (add_edge)                            │
│     A ──────────────→ B                          │
│     总是从 A 到 B，没有选择                       │
│                                                 │
│  2. 条件边 (add_conditional_edges)                │
│     A ───→ 条件函数 ───→ B 或 C 或 D             │
│     根据函数返回值决定去向                        │
└─────────────────────────────────────────────────┘
```

## START 和 END 特殊节点

```
┌──────────────────────────────────────────────────┐
│                                                  │
│    START  →  图的入口点，没有入边                  │
│                                                  │
│    END    →  图的出口点，没有出边                  │
│                                                  │
└──────────────────────────────────────────────────┘
```

```python
from langgraph.graph import START, END

# START 边 — 定义从哪里开始
builder.add_edge(START, "first_node")

# END 边 — 定义在哪里结束
builder.add_edge("last_node", END)
```

**关键规则：**
- 至少需要一个从 `START` 出发的边
- 没有 `END` 边的节点会进入循环（除非有条件边引导到 END）
- `START` 和 `END` 是字符串常量，不是真正的节点

## 普通边 — 固定流程

```python
builder.add_edge("node_a", "node_b")
```

### 使用场景

| 场景 | 示例 |
|------|------|
| 线性流程 | fetch → process → format → output |
| 并行汇合 | A → merge, B → merge |
| 必经之路 | 无论前面做什么，最后都要经过验证 |

### 示例：线性数据处理

```python
from typing import TypedDict
from langgraph.graph import StateGraph, START, END

class DataState(TypedDict):
    raw: str
    cleaned: str
    analyzed: str
    result: str

def fetch(state: DataState) -> dict:
    return {"raw": "原始数据"}

def clean(state: DataState) -> dict:
    return {"cleaned": state["raw"].strip()}

def analyze(state: DataState) -> dict:
    return {"analyzed": f"分析: {state['cleaned']}"}

def output(state: DataState) -> dict:
    return {"result": state["analyzed"]}

builder = StateGraph(DataState)
builder.add_node("fetch", fetch)
builder.add_node("clean", clean)
builder.add_node("analyze", analyze)
builder.add_node("output", output)

# 线性流程
builder.add_edge(START, "fetch")
builder.add_edge("fetch", "clean")
builder.add_edge("clean", "analyze")
builder.add_edge("analyze", "output")
builder.add_edge("output", END)

graph = builder.compile()
```

### 示例：并行执行后汇合

```python
class ParallelState(TypedDict):
    input: str
    result_a: str
    result_b: str
    combined: str

def process_a(state: ParallelState) -> dict:
    return {"result_a": f"A处理了: {state['input']}"}

def process_b(state: ParallelState) -> dict:
    return {"result_b": f"B处理了: {state['input']}"}

def merge(state: ParallelState) -> dict:
    return {"combined": f"{state['result_a']} | {state['result_b']}"}

builder = StateGraph(ParallelState)
builder.add_node("process_a", process_a)
builder.add_node("process_b", process_b)
builder.add_node("merge", merge)

# 两个分支同时执行
builder.add_edge(START, "process_a")
builder.add_edge(START, "process_b")
# 汇合
builder.add_edge("process_a", "merge")
builder.add_edge("process_b", "merge")
builder.add_edge("merge", END)
```

```
执行流程：

        ┌─── process_a ──┐
START ──┤                ├──→ merge ──→ END
        └─── process_b ──┘
```

## 条件边 — 动态路由

```python
def route_function(state: State) -> str:
    """返回下一个节点的名称"""
    if condition:
        return "node_a"
    else:
        return "node_b"

builder.add_conditional_edges("current_node", route_function)
```

### 带路由映射的条件边

```python
def classify(state: State) -> str:
    if len(state["messages"][-1].content) > 100:
        return "long_text"
    else:
        return "short_text"

builder.add_conditional_edges(
    "classify",           # 从哪个节点出发
    classify,             # 路由函数
    {                     # 路由映射（可选）
        "long_text": "long_handler",
        "short_text": "short_handler",
    }
)
```

**路由映射的作用：**
- 验证返回值是否合法（不在映射中的返回值会报错）
- 允许路由函数返回别名，映射到实际节点名

### 示例：意图分类路由

```python
from typing import Annotated, Literal, TypedDict
from langgraph.graph import StateGraph, START, END
from langgraph.graph.message import add_messages
from langgraph.graph import MessagesState
from langchain.chat_models import init_chat_model
from langchain.messages import AIMessage

class RouterState(MessagesState):
    intent: str

def classify_intent(state: RouterState) -> dict:
    """使用 LLM 分类意图"""
    model = init_chat_model("moonshot:moonshot-v1-8k")
    last_msg = state["messages"][-1].content
    
    response = model.invoke([
        ("system", """你是意图分类器。返回以下之一：
- question: 用户提问
- command: 用户下指令
- chat: 普通聊天
只返回关键词，不要解释。"""),
        ("human", last_msg),
    ])
    intent = response.content.strip().lower()
    return {"intent": intent}

def handle_question(state: RouterState) -> dict:
    return {"messages": [AIMessage("这是一个问题，我来回答...")]}

def handle_command(state: RouterState) -> dict:
    return {"messages": [AIMessage("收到指令，正在执行...")]}

def handle_chat(state: RouterState) -> dict:
    return {"messages": [AIMessage("好的，我们随便聊聊...")]}

def route_by_intent(state: RouterState) -> Literal["question", "command", "chat"]:
    return state["intent"]

builder = StateGraph(RouterState)
builder.add_node("classify", classify_intent)
builder.add_node("question", handle_question)
builder.add_node("command", handle_command)
builder.add_node("chat", handle_chat)

builder.add_edge(START, "classify")
builder.add_conditional_edges(
    "classify",
    route_by_intent,
    {
        "question": "question",
        "command": "command",
        "chat": "chat",
    }
)
builder.add_edge("question", END)
builder.add_edge("command", END)
builder.add_edge("chat", END)

graph = builder.compile()
```

### 示例：带重试逻辑的条件路由

```python
class RetryState(TypedDict):
    query: str
    result: str
    attempt: int
    max_attempts: int
    success: bool

def attempt_node(state: RetryState) -> dict:
    """尝试执行任务"""
    try:
        # 模拟可能失败的操作
        result = f"处理结果: {state['query']}"
        return {"result": result, "attempt": 1, "success": True}
    except Exception:
        return {"attempt": 1, "success": False}

def check_result(state: RetryState) -> dict:
    """检查是否需要重试"""
    if state["success"]:
        return {"status": "done"}
    elif state["attempt"] >= state["max_attempts"]:
        return {"status": "failed"}
    return {"status": "retry"}

def route_after_check(state: RetryState) -> str:
    if state["status"] == "done":
        return "success_node"
    elif state["status"] == "failed":
        return "failure_node"
    return "retry_node"

def retry_node(state: RetryState) -> dict:
    return {"attempt": state["attempt"] + 1}

builder = StateGraph(RetryState)
builder.add_node("attempt", attempt_node)
builder.add_node("check", check_result)
builder.add_node("retry", retry_node)
builder.add_node("success", lambda s: {})
builder.add_node("failure", lambda s: {})

builder.add_edge(START, "attempt")
builder.add_edge("attempt", "check")
builder.add_conditional_edges("check", route_after_check, {
    "success_node": "success",
    "failed": "failure",
    "retry_node": "retry",
})
builder.add_edge("retry", "attempt")
builder.add_edge("success", END)
builder.add_edge("failure", END)
```

```
循环流程：

START → attempt → check ──→ success ──→ END
                        │
                        ├──→ failure ──→ END
                        │
                        └──→ retry ──→ attempt (循环)
```

## 条件边的返回值类型

### Literal 类型（推荐）

```python
from typing import Literal

def route(state: State) -> Literal["node_a", "node_b", "node_c"]:
    if condition_a:
        return "node_a"
    elif condition_b:
        return "node_b"
    return "node_c"
```

使用 `Literal` 的好处：
- IDE 可以提供自动补全
- 类型检查器可以发现错误
- 文档自动生成更准确

### str 类型

```python
def route(state: State) -> str:
    return "node_name"
```

简单但缺少类型安全。

## 多个条件边

一个节点可以有多个条件边（指向不同方向）：

```python
# 不推荐 — 一个节点多个条件边会导致混淆
builder.add_conditional_edges("node_a", route_1)
builder.add_conditional_edges("node_a", route_2)  # 危险！
```

正确的做法是使用一个条件函数处理所有路由逻辑：

```python
def combined_route(state: State) -> str:
    if condition_1:
        return "path_1"
    elif condition_2:
        return "path_2"
    return "default"

builder.add_conditional_edges("node_a", combined_route, {
    "path_1": "node_b",
    "path_2": "node_c",
    "default": "node_d",
})
```

## 入口点可以有多个

```python
# 可以有多个 START 边
builder.add_edge(START, "node_a")
builder.add_edge(START, "node_b")  # node_a 和 node_b 并行开始
```

## 实战：文章审核工作流

```python
from typing import Annotated, Literal, TypedDict
from operator import add
from langgraph.graph import StateGraph, START, END
from langgraph.graph.message import add_messages
from langchain.chat_models import init_chat_model
from langchain.messages import HumanMessage, AIMessage, SystemMessage

class ReviewState(TypedDict):
    messages: Annotated[list, add_messages]
    content: str
    spam_score: float
    quality_score: float
    sentiment: str
    action: str
    log: Annotated[list, add]

def spam_check(state: ReviewState) -> dict:
    """垃圾内容检测"""
    model = init_chat_model("moonshot:moonshot-v1-8k")
    response = model.invoke([
        ("system", "判断以下内容是否为垃圾内容。返回 0-1 之间的分数，1 表示肯定是垃圾。"),
        ("human", state["content"]),
    ])
    try:
        score = float(response.content.strip())
    except ValueError:
        score = 0.5
    return {
        "spam_score": score,
        "log": [f"[spam_check] 垃圾分数: {score}"],
    }

def quality_check(state: ReviewState) -> dict:
    """质量评估"""
    model = init_chat_model("moonshot:moonshot-v1-8k")
    response = model.invoke([
        ("system", "评估以下内容的质量。返回 0-1 之间的分数。"),
        ("human", state["content"]),
    ])
    try:
        score = float(response.content.strip())
    except ValueError:
        score = 0.5
    return {
        "quality_score": score,
        "log": [f"[quality_check] 质量分数: {score}"],
    }

def sentiment_check(state: ReviewState) -> dict:
    """情感分析"""
    model = init_chat_model("moonshot:moonshot-v1-8k")
    response = model.invoke([
        ("system", "分析以下内容的情感。返回 positive/negative/neutral。"),
        ("human", state["content"]),
    ])
    return {
        "sentiment": response.content.strip(),
        "log": [f"[sentiment_check] 情感: {response.content.strip()}"],
    }

def decide_action(state: ReviewState) -> dict:
    """根据检查结果决定动作"""
    if state["spam_score"] > 0.8:
        action = "reject"
    elif state["quality_score"] < 0.3:
        action = "review"
    else:
        action = "approve"
    return {
        "action": action,
        "log": [f"[decide] 动作: {action}"],
    }

def route_after_checks(state: ReviewState) -> Literal["decide", "reject"]:
    if state["spam_score"] > 0.9:
        return "reject"
    return "decide"

def reject_node(state: ReviewState) -> dict:
    return {
        "messages": [AIMessage(f"内容被拒绝（垃圾分数: {state['spam_score']})")],
        "log": ["[reject] 内容已拒绝"],
    }

def approve_node(state: ReviewState) -> dict:
    return {
        "messages": [AIMessage("内容已通过审核")],
        "log": ["[approve] 内容已通过审核"],
    }

def review_node(state: ReviewState) -> dict:
    return {
        "messages": [AIMessage("内容需要人工审核")],
        "log": ["[review] 需要人工审核"],
    }

def route_final(state: ReviewState) -> Literal["approve", "review"]:
    if state["action"] == "approve":
        return "approve"
    return "review"

# 构建图
builder = StateGraph(ReviewState)
builder.add_node("spam_check", spam_check)
builder.add_node("quality_check", quality_check)
builder.add_node("sentiment_check", sentiment_check)
builder.add_node("decide", decide_action)
builder.add_node("reject", reject_node)
builder.add_node("approve", approve_node)
builder.add_node("review", review_node)

# 三个检查并行执行
builder.add_edge(START, "spam_check")
builder.add_edge(START, "quality_check")
builder.add_edge(START, "sentiment_check")

# spam 分数超高直接拒绝
builder.add_conditional_edges("spam_check", route_after_checks, {
    "reject": "reject",
    "decide": "decide",
})
builder.add_edge("quality_check", "decide")
builder.add_edge("sentiment_check", "decide")

# 最终决定
builder.add_conditional_edges("decide", route_final, {
    "approve": "approve",
    "review": "review",
})
builder.add_edge("reject", END)
builder.add_edge("approve", END)
builder.add_edge("review", END)

graph = builder.compile()
```

```
审核流程：

                 ┌──→ spam_check ──→ (score>0.9?) ──→ reject ──→ END
                │                                     │
START ──────────┤                                     ↓ decide
                │──→ quality_check ─────────────────→ route ──→ approve/review → END
                │
                 └──→ sentiment_check ───────────────→
```

## 小结

| 概念 | 说明 |
|------|------|
| `START` | 图的入口点，可以有多条出边 |
| `END` | 图的出口点，只有入边 |
| `add_edge(a, b)` | 固定从 a 到 b |
| `add_conditional_edges(node, func)` | 根据函数返回值动态路由 |
| 路由映射 | 可选的第三个参数，验证和映射返回值 |
| `Literal` | 推荐的路由函数返回类型 |
| 并行执行 | 多个节点从同一点出发 |
| 循环 | 边指回之前的节点形成循环 |

## 练习题

1. 创建一个带条件的数字处理管道：如果数字 > 100 则"缩小"，否则"放大"
2. 创建一个循环图：计数器从 0 开始，每次 +1，到 5 时停止
3. 创建一个多分支并行图：输入文本后同时进行分词、词性标注、实体识别，最后合并结果
4. 创建一个状态机风格的图：idle → waiting → processing → done，中间支持取消和重试
