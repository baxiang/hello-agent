# 05-Send与Command

> Send 实现 map-reduce 并行分发，Command 实现状态更新与路由的统一

## 为什么需要 Send 和 Command

之前学的路由方式有一个限制：

```
条件边路由：
  node_a ──→ 路由函数 ──→ node_b 或 node_c（只能选一个）
```

但有时我们需要：
1. **并行发送给多个节点**（map-reduce 模式）
2. **同时更新状态 + 决定路由**
3. **返回到调用者**（子图场景）

这就是 `Send` 和 `Command` 的用途。

## Send — 动态并行分发

`Send` 允许节点在运行时动态指定要并行执行的目标节点，并为每个目标传递自定义状态。

```python
from langgraph.types import Send

def fan_out_node(state: State) -> list:
    """并行发送给多个处理节点"""
    return [
        Send("process", {"item": item})
        for item in state["items"]
    ]
```

### Send 的工作原理

```
┌──────────────────────────────────────────────────────┐
│                  Send 工作流程                        │
│                                                      │
│  fan_out_node 返回 [Send("process", {"item": 1}),    │
│                     Send("process", {"item": 2}),    │
│                     Send("process", {"item": 3})]    │
│                                                      │
│       ┌──────────────────────────────────┐           │
│       │  process(item=1)  ──→ 结果1      │           │
│       │  process(item=2)  ──→ 结果2      │  并行执行  │
│       │  process(item=3)  ──→ 结果3      │           │
│       └──────────────────────────────────┘           │
│                      │                               │
│                      ▼  结果合并到 State              │
│              fan_in_node（聚合结果）                   │
└──────────────────────────────────────────────────────┘
```

### Send 完整示例：并行文本处理

```python
from typing import Annotated, TypedDict
from operator import add
from langgraph.graph import StateGraph, START, END
from langgraph.types import Send

class MapReduceState(TypedDict):
    texts: list
    individual_results: Annotated[list, add]
    final_summary: str

def split_node(state: MapReduceState) -> list:
    """将文本列表分发给处理节点"""
    return [Send("process_text", {"text": text}) for text in state["texts"]]

def process_text(state: MapReduceState) -> dict:
    """处理单个文本"""
    text = state["text"]
    result = {
        "length": len(text),
        "words": len(text.split()),
        "text": text,
    }
    return {
        "individual_results": [result],
    }

def summarize_node(state: MapReduceState) -> dict:
    """聚合所有处理结果"""
    total_words = sum(r["words"] for r in state["individual_results"])
    return {
        "final_summary": f"共处理 {len(state['individual_results'])} 个文本，总词数 {total_words}",
    }

builder = StateGraph(MapReduceState)
builder.add_node("split", split_node)
builder.add_node("process_text", process_text)
builder.add_node("summarize", summarize_node)

builder.add_edge(START, "split")
# split 返回 Send 列表，自动并行执行 process_text
# process_text 完成后自动执行下一个有入边的节点：summarize
builder.add_edge("process_text", "summarize")
builder.add_edge("summarize", END)

graph = builder.compile()

result = graph.invoke({
    "texts": ["hello world", "python is great", "langgraph is powerful"],
    "individual_results": [],
    "final_summary": "",
})
print(result["final_summary"])
# 共处理 3 个文本，总词数 8
```

### Send 的两种模式

```python
# 模式1：发送到不同节点
def distribute(state: State) -> list:
    return [
        Send("node_a", {"data": state["input"]}),
        Send("node_b", {"data": state["input"]}),
    ]

# 模式2：发送到同一节点多次（不同参数）
def fan_out(state: State) -> list:
    return [
        Send("process", {"item": item})
        for item in state["items"]
    ]
```

### Send 传递的状态

`Send` 传递的状态会与当前 State **合并**，而不是替换：

```python
# 当前 State: {"items": [1, 2, 3], "counter": 0}

def fan_out(state: State) -> list:
    return [Send("process", {"item": 1})]

# process 节点收到的 State:
# {"items": [1, 2, 3], "counter": 0, "item": 1}
#              ↑ 原有字段        ↑ Send 新增
```

## Command — 状态更新 + 路由二合一

`Command` 是 LangGraph 1.x 中最强大的路由工具。它**同时**做两件事：

1. **更新 State**（像节点返回值一样）
2. **决定路由**（像条件边一样）

```python
from langgraph.types import Command

def agent_node(state: State) -> Command:
    return Command(
        update={"status": "processing"},  # 更新 State
        goto="tool_node",                  # 路由到 tool_node
    )
```

### Command 的基本结构

```python
Command(
    update={"key": "value"},   # 要更新的 State 字段
    goto="next_node",          # 下一个节点
    graph=Command.PARENT,      # 可选：返回父图
)
```

### Command 的参数

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `update` | `dict` | 否 | 要合并到 State 的字段 |
| `goto` | `str` / `Send` / `list` | 否 | 下一个目标节点 |
| `graph` | `Command.PARENT` | 否 | 返回到父级图 |

### Command vs 传统方式

```python
# 传统方式：节点返回 + 条件边
def agent_node(state: State) -> dict:
    # 只能返回状态更新
    return {"status": "processing"}

# 条件边需要单独定义
def route(state: State) -> str:
    if state["has_tool_calls"]:
        return "tool_node"
    return "respond"

# Command 方式：一举两得
def agent_node(state: State) -> Command:
    return Command(
        update={"status": "processing"},
        goto="tool_node" if state["has_tool_calls"] else "respond",
    )
# 不需要额外的条件边！
```

### 使用 Command 简化 Agent 循环

```python
from typing import Annotated, TypedDict
from langgraph.graph import StateGraph, START, END
from langgraph.types import Command
from langgraph.graph.message import add_messages
from langchain.chat_models import init_chat_model
from langchain.messages import HumanMessage, AIMessage
from langchain.tools import tool

@tool
def search(query: str) -> str:
    """搜索信息"""
    return f"搜索到关于 '{query}' 的信息"

tools = [search]
tools_by_name = {t.name: t for t in tools}

model = init_chat_model("moonshot:moonshot-v1-8k")
model_with_tools = model.bind_tools(tools)

class AgentState(TypedDict):
    messages: Annotated[list, add_messages]

def agent(state: AgentState) -> Command:
    """Agent 节点 — 决定是否调用工具"""
    response = model_with_tools.invoke(state["messages"])
    
    if response.tool_calls:
        return Command(
            update={"messages": [response]},
            goto="tools",
        )
    return Command(
        update={"messages": [response]},
        goto=END,
    )

def tools(state: AgentState) -> dict:
    """执行工具调用"""
    outputs = []
    for tool_call in state["messages"][-1].tool_calls:
        result = tools_by_name[tool_call["name"]].invoke(tool_call["args"])
        outputs.append(
            ToolMessage(
                content=str(result),
                tool_call_id=tool_call["id"],
            )
        )
    return Command(
        update={"messages": outputs},
        goto="agent",  # 返回 agent 继续循环
    )

builder = StateGraph(AgentState)
builder.add_node("agent", agent)
builder.add_node("tools", tools)
builder.add_edge(START, "agent")

# 注意：不需要 add_conditional_edges！
# agent 和 tools 各自用 Command 决定路由

graph = builder.compile()
```

```
Agent 循环：

START → agent ──→ 有 tool_calls? ──→ tools ──→ agent (循环)
                │
                └──→ 无 tool_calls? ──→ END
```

### Command + Send：并行分发

`Command` 的 `goto` 可以是 `Send` 列表：

```python
def parallel_agent(state: State) -> Command:
    """并行处理多个任务"""
    return Command(
        update={"status": "processing"},
        goto=[
            Send("task_handler", {"task": task})
            for task in state["pending_tasks"]
        ],
    )
```

## Command.PARENT — 从子图返回父图

这是 `Command` 最强大的特性之一：子图可以主动返回父图。

```python
from langgraph.types import Command

def child_node(state: State) -> Command:
    return Command(
        update={"child_result": "done"},
        goto=Command.PARENT,  # 返回父图
    )
```

### 子图示例

```python
from typing import TypedDict
from langgraph.graph import StateGraph, START, END
from langgraph.types import Command

# ---- 子图 ----
class SubState(TypedDict):
    data: str
    processed: str

def process_in_subgraph(state: SubState) -> dict:
    return {"processed": f"子图处理: {state['data']}"}

def end_subgraph(state: SubState) -> Command:
    return Command(
        update={"sub_result": state["processed"]},
        goto=Command.PARENT,
    )

sub_builder = StateGraph(SubState)
sub_builder.add_node("process", process_in_subgraph)
sub_builder.add_node("end", end_subgraph)
sub_builder.add_edge(START, "process")
sub_builder.add_edge("process", "end")
sub_graph = sub_builder.compile()

# ---- 父图 ----
class ParentState(TypedDict):
    input: str
    sub_result: str
    final: str

def call_subgraph(state: ParentState) -> dict:
    # 调用子图
    result = sub_graph.invoke({"data": state["input"], "processed": ""})
    return {"sub_result": result.get("sub_result", "")}

def finalize(state: ParentState) -> dict:
    return {"final": f"最终结果: {state['sub_result']}"}

parent_builder = StateGraph(ParentState)
parent_builder.add_node("call_subgraph", call_subgraph)
parent_builder.add_node("finalize", finalize)
parent_builder.add_node("subgraph", sub_graph)  # 子图作为节点

parent_builder.add_edge(START, "subgraph")
parent_builder.add_edge("subgraph", "finalize")
parent_builder.add_edge("finalize", END)

parent_graph = parent_builder.compile()
```

## 条件边 vs Command 的选择

| 场景 | 推荐方式 | 原因 |
|------|---------|------|
| 简单路由 | 条件边 | 逻辑分离，更清晰 |
| 路由 + 状态更新 | `Command` | 二合一，减少样板代码 |
| Agent 循环 | `Command` | 自包含路由逻辑 |
| 子图返回 | `Command.PARENT` | 唯一的方式 |
| 复杂多分支 | 条件边 + 路由映射 | 更易维护 |

## 实战：带 Command 的智能客服

```python
from typing import Annotated, Literal, TypedDict
from langgraph.graph import StateGraph, START, END
from langgraph.types import Command
from langgraph.graph.message import add_messages
from langchain.chat_models import init_chat_model
from langchain.messages import HumanMessage, AIMessage, SystemMessage
from langchain.tools import tool

@tool
def check_order(order_id: str) -> str:
    """查询订单状态"""
    return f"订单 {order_id}: 已发货"

@tool
def check_balance() -> str:
    """查询账户余额"""
    return "当前余额: 1000 元"

tools = [check_order, check_balance]
tools_by_name = {t.name: t for t in tools}

model = init_chat_model("moonshot:moonshot-v1-8k")
model_with_tools = model.bind_tools(tools)

class CustomerServiceState(TypedDict):
    messages: Annotated[list, add_messages]
    turn_count: Annotated[int, add]

def chatbot(state: CustomerServiceState) -> Command:
    """主聊天节点"""
    response = model_with_tools.invoke(state["messages"])
    
    # 如果有工具调用，转到工具节点
    if response.tool_calls:
        return Command(
            update={
                "messages": [response],
                "turn_count": 1,
            },
            goto="tools",
        )
    
    # 否则结束对话（等待用户下一条消息）
    return Command(
        update={
            "messages": [response],
            "turn_count": 1,
        },
        goto=END,
    )

def tools_node(state: CustomerServiceState) -> dict:
    """执行工具调用后返回 chatbot"""
    outputs = []
    for tool_call in state["messages"][-1].tool_calls:
        result = tools_by_name[tool_call["name"]].invoke(tool_call["args"])
        outputs.append(
            ToolMessage(
                content=str(result),
                tool_call_id=tool_call["id"],
            )
        )
    return Command(
        update={"messages": outputs},
        goto="chatbot",  # 返回聊天节点
    )

builder = StateGraph(CustomerServiceState)
builder.add_node("chatbot", chatbot)
builder.add_node("tools", tools_node)
builder.add_edge(START, "chatbot")

graph = builder.compile()

# 运行
result = graph.invoke({
    "messages": [HumanMessage("查询订单 ORD-12345 的状态")],
    "turn_count": 0,
})
for msg in result["messages"]:
    print(f"{msg.type}: {msg.content}")
```

```
客服 Agent 流程：

START → chatbot ──→ 有工具调用? ──→ tools ──→ chatbot (循环)
                  │
                  └──→ 纯聊天回复 ──→ END
```

## 小结

| 概念 | 说明 |
|------|------|
| `Send(target, state)` | 动态并行分发到目标节点 |
| Map-Reduce | Send 扇出 → 并行处理 → 汇聚结果 |
| `Command(update, goto)` | 同时更新状态和决定路由 |
| `Command` vs 条件边 | Command 更紧凑，条件边更清晰 |
| `Command.PARENT` | 从子图返回父图 |
| `goto` 类型 | 字符串 / Send / Send 列表 / END |
| 自动循环 | Command 指回之前节点形成循环 |

## 练习题

1. 使用 Send 实现一个并行翻译系统：同时翻译为英文、日文、韩文
2. 使用 Command 改写之前学过的意图分类示例，去掉条件边
3. 创建一个包含子图的 Agent：子图处理工具调用，主图管理对话
4. 使用 Command + Send 实现一个"主节点分发 → 并行处理 → 主节点汇总"的完整 map-reduce 流程
