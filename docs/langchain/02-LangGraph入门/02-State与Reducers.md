# 02-State与Reducers

> State 定义图的数据结构，Reducers 控制状态的合并规则

## State 的核心角色

```
┌──────────────────────────────────────────────┐
│              State 的作用                      │
│                                              │
│  1. 节点的输入 — 每个节点接收完整 State       │
│  2. 节点的输出 — 节点返回要更新的字段          │
│  3. 数据流转 — 跨节点传递信息                 │
│  4. 持久化 — 支持检查点和恢复                 │
└──────────────────────────────────────────────┘
```

State 是 LangGraph 的"记忆"。所有节点共享同一个 State 实例，但每个节点只能看到自己超步开始时的快照。

## 定义 State — TypedDict

最基本的方式是使用 Python 的 `TypedDict`：

```python
from typing import TypedDict

class AgentState(TypedDict):
    messages: list
    topic: str
    step_count: int
    is_complete: bool
```

### 使用时的初始值

```python
from langgraph.graph import StateGraph, START, END

class AgentState(TypedDict):
    messages: list
    topic: str
    step_count: int

builder = StateGraph(AgentState)
builder.add_node("process", process_node)
builder.add_edge(START, "process")
builder.add_edge("process", END)

graph = builder.compile()

# invoke 时必须提供完整的初始 State
result = graph.invoke({
    "messages": [],
    "topic": "",
    "step_count": 0,
})
```

## 输入/输出类型分离

LangGraph 1.x 支持分离对外暴露的接口和内部 State：

```python
from typing import TypedDict

class InputState(TypedDict):
    """外部输入 — 用户只需提供这些"""
    query: str
    max_steps: int

class InternalState(InputState):
    """内部状态 — 包含中间数据"""
    messages: list
    current_step: int
    result: str

class OutputState(TypedDict):
    """外部输出 — 只返回这些给用户"""
    result: str
    messages: list

builder = StateGraph(
    state_schema=InternalState,
    input_schema=InputState,
    output_schema=OutputState,
)
```

这样做的好处：
- 用户不需要知道内部实现的细节
- 可以隐藏中间状态（如 `current_step`）
- 输出时可以过滤掉不需要返回的字段

## Reducers — 状态合并规则

当节点返回更新时，LangGraph 需要知道如何合并到现有 State。这就是 **Reducer** 的作用。

### 默认行为：覆盖

```python
from typing import TypedDict

class State(TypedDict):
    name: str
    age: int

def update_node(state: State) -> dict:
    return {"name": "Alice"}  # name 被覆盖
```

对于简单类型（str, int, float, bool），默认行为是**覆盖**旧值。

### 列表的默认行为：覆盖（陷阱！）

```python
class State(TypedDict):
    messages: list

def add_message(state: State) -> dict:
    return {"messages": ["hello"]}  # 危险！旧消息被覆盖
```

这不是我们想要的。在对话场景中，我们希望**追加**而不是覆盖。

### 使用 Annotated 定义 Reducer

```python
from typing import Annotated
from typing import TypedDict
from langgraph.graph.message import add_messages

class State(TypedDict):
    messages: Annotated[list, add_messages]
```

`Annotated[type, reducer]` 告诉 LangGraph 如何合并该字段的更新。

```
┌────────────────────────────────────────────────┐
│              Reducer 工作方式                    │
│                                                │
│  当前 State:                                    │
│    messages: ["hello"]                          │
│                                                │
│  节点返回:                                      │
│    {"messages": [HumanMessage("how are you")]}  │
│                                                │
│  add_messages Reducer:                          │
│    messages: ["hello", HumanMessage(...)]  ← 追加│
└────────────────────────────────────────────────┘
```

## add_messages — 消息专用 Reducer

`add_messages` 是 LangGraph 提供的专门用于消息列表的 Reducer：

```python
from langgraph.graph.message import add_messages

class State(TypedDict):
    messages: Annotated[list, add_messages]
```

### add_messages 的特性

| 特性 | 说明 |
|------|------|
| 追加新消息 | 新消息追加到列表末尾 |
| ID 去重 | 相同 ID 的消息会覆盖而不是追加 |
| 删除消息 | 传入 `RemoveMessage(id=...)` 可删除指定消息 |

```python
from langgraph.messages import RemoveMessage, HumanMessage, AIMessage

# 追加消息
def chat_node(state: State) -> dict:
    return {"messages": [HumanMessage("你好")]}

# 更新已有消息（相同 ID）
def update_node(state: State) -> dict:
    msg = AIMessage(id="msg-1", content="新回复")
    return {"messages": [msg]}  # ID 为 msg-1 的消息会被更新

# 删除消息
def delete_node(state: State) -> dict:
    return {"messages": [RemoveMessage(id="msg-1")]}
```

### add_messages 的实际使用

```python
from typing import Annotated, TypedDict
from langgraph.graph import StateGraph, START, END
from langgraph.graph.message import add_messages
from langchain.messages import HumanMessage, AIMessage, SystemMessage
from langchain.chat_models import init_chat_model

class ChatState(TypedDict):
    messages: Annotated[list, add_messages]

def chatbot_node(state: ChatState) -> dict:
    model = init_chat_model("moonshot:moonshot-v1-8k")
    response = model.invoke(state["messages"])
    return {"messages": [response]}

builder = StateGraph(ChatState)
builder.add_node("chatbot", chatbot_node)
builder.add_edge(START, "chatbot")
builder.add_edge("chatbot", END)

graph = builder.compile()

result = graph.invoke({
    "messages": [HumanMessage("你好")]
})
print(result["messages"])
# [HumanMessage('你好'), AIMessage('你好！有什么我可以帮你的吗？')]
```

## 自定义 Reducer

你可以创建自己的 Reducer 函数：

```python
from typing import Annotated, TypedDict

def merge_dicts(old: dict, new: dict) -> dict:
    """深度合并字典"""
    result = old.copy()
    for key, value in new.items():
        if key in result and isinstance(result[key], dict) and isinstance(value, dict):
            result[key] = merge_dicts(result[key], value)
        else:
            result[key] = value
    return result

class State(TypedDict):
    config: Annotated[dict, merge_dicts]
    count: int  # 简单类型，默认覆盖

def node_a(state: State) -> dict:
    return {
        "config": {"temperature": 0.7, "model": "moonshot-v1-8k"},
        "count": 1,
    }

def node_b(state: State) -> dict:
    return {
        "config": {"max_tokens": 4000},  # 只会更新 max_tokens
        "count": 2,
    }

# 执行 node_a 后: config = {"temperature": 0.7, "model": "moonshot-v1-8k"}
# 执行 node_b 后: config = {"temperature": 0.7, "model": "moonshot-v1-8k", "max_tokens": 4000}
#               count = 2 (覆盖)
```

## 内置的 Reducer 操作符

```python
from operator import add

class State(TypedDict):
    numbers: Annotated[list, add]     # 列表拼接
    counter: Annotated[int, add]      # 数值累加
    log: Annotated[list, add]         # 日志追加

def increment(state: State) -> dict:
    return {"counter": 1, "log": ["increment called"]}

def double(state: State) -> dict:
    return {"counter": 1, "log": ["double called"]}

# 执行 increment 后: counter = 0 + 1 = 1, log = ["increment called"]
# 执行 double 后:    counter = 1 + 1 = 2, log = ["increment called", "double called"]
```

## MessagesState — 预定义的消息状态

LangGraph 提供了开箱即用的 `MessagesState`：

```python
from langgraph.prebuilt import MessagesState

# 等价于:
# class MessagesState(TypedDict):
#     messages: Annotated[list, add_messages]

builder = StateGraph(MessagesState)
```

使用 `MessagesState` 简化代码：

```python
from langgraph.prebuilt import MessagesState
from langgraph.graph import StateGraph, START, END
from langchain.chat_models import init_chat_model

def chatbot(state: MessagesState) -> dict:
    model = init_chat_model("moonshot:moonshot-v1-8k")
    response = model.invoke(state["messages"])
    return {"messages": [response]}

builder = StateGraph(MessagesState)
builder.add_node("chatbot", chatbot)
builder.add_edge(START, "chatbot")
builder.add_edge("chatbot", END)

graph = builder.compile()
result = graph.invoke({"messages": [("human", "介绍下 Python")]})
```

## Reducer 优先级

当多个 Reducer 同时存在时，优先级如下：

```
1. Annotated[type, custom_reducer]  ← 自定义 Reducer（最高）
2. add_messages                      ← 消息专用 Reducer
3. operator.add                      ← 累加操作符
4. 默认覆盖                          ← 无 Reducer（最低）
```

## State 设计最佳实践

### 1. 区分可变和不可变字段

```python
from typing import Annotated, TypedDict
from langgraph.graph.message import add_messages

class AgentState(TypedDict):
    # 可变字段 — 使用 Reducer 累积
    messages: Annotated[list, add_messages]
    tool_calls: Annotated[list, operator.add]
    
    # 不可变字段 — 覆盖更新
    current_step: str
    status: str
    error: str | None
```

### 2. 使用可选类型处理初始值

```python
from typing import TypedDict

class State(TypedDict, total=False):
    """total=False 使所有字段可选"""
    messages: list
    result: str
    error: str | None

# invoke 时可以不提供所有字段
result = graph.invoke({"messages": [HumanMessage("hi")]})
```

### 3. 避免过大的 State

```python
# ❌ 不好的设计 — State 过于臃肿
class BadState(TypedDict):
    user_info: dict
    conversation: list
    tool_results: list
    intermediate_data_1: str
    intermediate_data_2: str
    intermediate_data_3: dict
    cache: dict
    metadata: dict

# ✅ 好的设计 — 只保留必要的字段
class GoodState(TypedDict):
    messages: Annotated[list, add_messages]
    current_tool: str | None
    result: str | None
```

### 4. 使用嵌套结构组织数据

```python
class AnalysisResult(TypedDict):
    summary: str
    confidence: float
    tags: list

class State(TypedDict):
    messages: Annotated[list, add_messages]
    analysis: AnalysisResult | None
    retry_count: int
```

## 常见错误

### 错误 1：忘记使用 add_messages

```python
# ❌ 消息会被覆盖
class State(TypedDict):
    messages: list

# ✅ 消息会累积
class State(TypedDict):
    messages: Annotated[list, add_messages]
```

### 错误 2：Reducer 返回值类型不匹配

```python
# ❌ Reducer 期望 dict，但返回了 list
class State(TypedDict):
    data: Annotated[dict, merge_dicts]

def bad_node(state: State) -> dict:
    return {"data": ["not", "a", "dict"]}  # 类型错误
```

### 错误 3：在节点中直接修改 State

```python
# ❌ 直接修改 — 不会被 LangGraph 追踪
def bad_node(state: State) -> dict:
    state["messages"].append(HumanMessage("hi"))
    return {}

# ✅ 返回更新 — LangGraph 会处理
def good_node(state: State) -> dict:
    return {"messages": [HumanMessage("hi")]}
```

### 错误 4：State 字段与节点返回值不一致

```python
class State(TypedDict):
    messages: Annotated[list, add_messages]

# ❌ 返回了 State 中不存在的字段
def bad_node(state: State) -> dict:
    return {"nonexistent_field": "value"}  # 运行时报错

# ✅ 只返回 State 中定义的字段
def good_node(state: State) -> dict:
    return {"messages": [AIMessage("hello")]}
```

## 实战：带计数器和日志的状态管理

```python
from typing import Annotated, TypedDict
from operator import add
from langgraph.graph import StateGraph, START, END
from langchain.chat_models import init_chat_model
from langchain.messages import HumanMessage, AIMessage

class State(TypedDict):
    messages: Annotated[list, add_messages]
    step_count: Annotated[int, add]
    log: Annotated[list, add]

def analyze(state: State) -> dict:
    return {
        "messages": [AIMessage("分析完成")],
        "step_count": 1,
        "log": ["analyze step executed"],
    }

def summarize(state: State) -> dict:
    return {
        "messages": [AIMessage("总结完成")],
        "step_count": 1,
        "log": ["summarize step executed"],
    }

builder = StateGraph(State)
builder.add_node("analyze", analyze)
builder.add_node("summarize", summarize)
builder.add_edge(START, "analyze")
builder.add_edge("analyze", "summarize")
builder.add_edge("summarize", END)

graph = builder.compile()

result = graph.invoke({
    "messages": [HumanMessage("分析这段文本")],
    "step_count": 0,
    "log": [],
})

print(f"消息数: {len(result['messages'])}")     # 3 (1 input + 2 responses)
print(f"步骤数: {result['step_count']}")           # 2
print(f"日志: {result['log']}")                    # ['analyze step executed', 'summarize step executed']
```

## 小结

| 概念 | 说明 |
|------|------|
| `TypedDict` | 定义 State 结构的标准方式 |
| 默认合并 | 简单类型覆盖，列表也覆盖 |
| `Annotated[type, reducer]` | 自定义合并行为 |
| `add_messages` | 消息列表专用 Reducer（追加+去重+删除） |
| `MessagesState` | 预定义的消息状态，开箱即用 |
| `operator.add` | 列表拼接 / 数值累加 |
| `RemoveMessage` | 配合 `add_messages` 删除指定消息 |
| `total=False` | 使 TypedDict 字段可选 |

## 练习题

1. 创建一个使用 `MessagesState` 的三节点对话图：问候 → 回答 → 告别
2. 创建一个自定义 Reducer：当两个字典有相同 key 时，将值拼接而不是覆盖
3. 创建一个 State 使用 `operator.add` 累积多个节点的输出结果
4. 使用 `RemoveMessage` 实现一个"清除对话历史"的节点
