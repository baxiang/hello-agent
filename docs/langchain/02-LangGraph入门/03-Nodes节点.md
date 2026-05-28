# 03-Nodes节点

> 节点是图中执行实际工作的基本单元

## 节点的本质

```
┌────────────────────────────────────────────────┐
│              Node（节点）                        │
│                                                │
│  输入:  当前 State                              │
│  处理:  业务逻辑（调用模型、工具、计算等）        │
│  输出:  dict — 要更新的 State 字段              │
│                                                │
│  def my_node(state: State) -> dict:             │
│      result = do_something(state)               │
│      return {"result_key": result}              │
└────────────────────────────────────────────────┘
```

每个节点都是一个纯函数（或异步函数），接收当前状态，返回要更新的字段。

## 节点函数的基本形式

### 同步节点

```python
from typing import TypedDict

class State(TypedDict):
    input: str
    output: str

def process_node(state: State) -> dict:
    result = state["input"].upper()
    return {"output": result}
```

### 异步节点

```python
async def async_process_node(state: State) -> dict:
    # 可以执行异步操作，如 API 调用
    result = await some_async_function(state["input"])
    return {"output": result}
```

### 带类型标注的节点

```python
def analyze_node(state: State) -> dict[str, str]:
    return {"output": "analyzed"}
```

## 节点注册

节点必须注册到图中才能被使用：

```python
from langgraph.graph import StateGraph

builder = StateGraph(State)

# 方式1：直接注册函数
builder.add_node("process", process_node)

# 方式2：注册 async 函数
builder.add_node("async_process", async_process_node)

# 方式3：先定义再注册
def another_node(state: State) -> dict:
    return {}

builder.add_node("another", another_node)
```

## 节点的输入与输出

### 输入：完整的当前 State

节点接收的是**完整的**当前 State：

```python
class State(TypedDict):
    user_input: str
    analysis_result: str
    confidence: float
    needs_review: bool

def review_node(state: State) -> dict:
    # 可以读取 State 中的任意字段
    print(f"输入: {state['user_input']}")
    print(f"分析: {state['analysis_result']}")
    print(f"置信度: {state['confidence']}")
    
    # 只返回需要更新的字段
    if state["confidence"] < 0.5:
        return {"needs_review": True}
    return {"needs_review": False}
```

### 输出：只返回要更新的字段

```python
def process_node(state: State) -> dict:
    # ❌ 返回完整 State — 不必要且低效
    return {
        "user_input": state["user_input"],
        "analysis_result": "done",
        "confidence": 0.9,
        "needs_review": False,
    }
    
    # ✅ 只返回更新的字段
    return {
        "analysis_result": "done",
        "confidence": 0.9,
    }
```

## 节点调用 LLM

### 基础调用

```python
from langchain.chat_models import init_chat_model
from langchain.messages import HumanMessage, AIMessage
from langgraph.graph.message import add_messages
from typing import Annotated, TypedDict

class State(TypedDict):
    messages: Annotated[list, add_messages]

def chat_node(state: State) -> dict:
    model = init_chat_model("moonshot:moonshot-v1-8k")
    response = model.invoke(state["messages"])
    return {"messages": [response]}
```

### 带 System Prompt 的节点

```python
def translator_node(state: State) -> dict:
    model = init_chat_model("moonshot:moonshot-v1-8k")
    
    messages = [
        ("system", "你是一个专业的翻译，将中文翻译为英文。"),
    ] + state["messages"]
    
    response = model.invoke(messages)
    return {"messages": [response]}
```

### 带配置的调用

```python
def creative_node(state: State) -> dict:
    model = init_chat_model(
        "moonshot:moonshot-v1-8k",
        temperature=0.9,
        max_tokens=2000,
    )
    response = model.invoke(state["messages"])
    return {"messages": [response]}
```

## 节点调用工具

### 使用 create_react_agent 自动处理工具

```python
from langgraph.prebuilt import create_react_agent
from langchain.chat_models import init_chat_model
from langchain.tools import tool

@tool
def calculator(expression: str) -> str:
    """计算数学表达式"""
    return str(eval(expression))

@tool
def weather_lookup(city: str) -> str:
    """查询天气"""
    return f"{city}: 晴天，25°C"

model = init_chat_model("moonshot:moonshot-v1-8k")

# create_react_agent 自动创建包含工具的节点
agent = create_react_agent(model, [calculator, weather_lookup])
```

### 手动实现工具调用节点

```python
from typing import Annotated, TypedDict
from langgraph.graph import StateGraph, START, END
from langgraph.graph.message import add_messages
from langchain.chat_models import init_chat_model
from langchain.messages import HumanMessage, AIMessage, ToolMessage
from langchain.tools import tool
import json

@tool
def search(query: str) -> str:
    """搜索信息"""
    return f"搜索结果: {query}"

tools = [search]
tools_by_name = {t.name: t for t in tools}

model = init_chat_model("moonshot:moonshot-v1-8k")
model_with_tools = model.bind_tools(tools)

class State(TypedDict):
    messages: Annotated[list, add_messages]

def agent_node(state: State) -> dict:
    response = model_with_tools.invoke(state["messages"])
    return {"messages": [response]}

def tool_node(state: State) -> dict:
    outputs = []
    for tool_call in state["messages"][-1].tool_calls:
        tool_result = tools_by_name[tool_call["name"]].invoke(
            tool_call["args"]
        )
        outputs.append(
            ToolMessage(
                content=json.dumps(tool_result),
                tool_call_id=tool_call["id"],
            )
        )
    return {"messages": outputs}
```

## 节点中的错误处理

### try/except 模式

```python
def robust_node(state: State) -> dict:
    try:
        model = init_chat_model("moonshot:moonshot-v1-8k")
        response = model.invoke(state["messages"])
        return {"messages": [response], "error": None}
    except Exception as e:
        return {"error": str(e)}
```

### 重试模式

```python
import time

def retry_node(state: State) -> dict:
    max_retries = 3
    last_error = None
    
    for attempt in range(max_retries):
        try:
            model = init_chat_model("moonshot:moonshot-v1-8k")
            response = model.invoke(state["messages"])
            return {"messages": [response], "error": None}
        except Exception as e:
            last_error = str(e)
            time.sleep(2 ** attempt)  # 指数退避
    
    return {"error": f"失败 {max_retries} 次: {last_error}"}
```

## 节点组合

### 多节点顺序执行

```
START → [fetch] → [process] → [format] → END
```

```python
def fetch_node(state: State) -> dict:
    return {"raw_data": fetch_from_api()}

def process_node(state: State) -> dict:
    return {"processed": process(state["raw_data"])}

def format_node(state: State) -> dict:
    return {"output": format_output(state["processed"])}

builder = StateGraph(State)
builder.add_node("fetch", fetch_node)
builder.add_node("process", process_node)
builder.add_node("format", format_node)
builder.add_edge(START, "fetch")
builder.add_edge("fetch", "process")
builder.add_edge("process", "format")
builder.add_edge("format", END)
```

### 多节点并行执行

```
         ┌──→ [process_a] ──┐
START → ─┤                  ├──→ [merge] → END
         └──→ [process_b] ──┘
```

```python
def process_a(state: State) -> dict:
    return {"result_a": do_a(state["input"])}

def process_b(state: State) -> dict:
    return {"result_b": do_b(state["input"])}

def merge_node(state: State) -> dict:
    return {"combined": state["result_a"] + state["result_b"]}

builder.add_node("process_a", process_a)
builder.add_node("process_b", process_b)
builder.add_node("merge", merge_node)

builder.add_edge(START, "process_a")
builder.add_edge(START, "process_b")
builder.add_edge("process_a", "merge")
builder.add_edge("process_b", "merge")
builder.add_edge("merge", END)
```

## 节点的返回值规范

### 返回值类型

| 返回类型 | 行为 | 示例 |
|---------|------|------|
| `dict` | 合并到 State | `{"key": "value"}` |
| `dict` (空) | 不更新 State | `{}` |
| 非 dict | **报错** | `"string"` ❌ |

### 返回不存在的字段

```python
class State(TypedDict):
    messages: list

def bad_node(state: State) -> dict:
    return {"nonexistent": "value"}  # 运行时异常
```

在严格模式下，返回 State 中不存在的字段会报错。开发时建议先关闭严格模式测试，上线时开启。

## 节点中访问元数据

```python
from langgraph.config import get_config

def node_with_config(state: State) -> dict:
    config = get_config()
    
    # 访问 configurable 中的自定义值
    user_id = config.get("configurable", {}).get("user_id", "unknown")
    
    return {"user_id": user_id}

# 调用时传入
result = graph.invoke(
    {"messages": []},
    config={"configurable": {"user_id": "user-123"}},
)
```

## 实战：多步骤文本处理管道

```python
from typing import Annotated, TypedDict
from operator import add
from langgraph.graph import StateGraph, START, END
from langchain.chat_models import init_chat_model
from langchain.messages import HumanMessage, AIMessage

class TextState(TypedDict):
    original: str
    cleaned: str
    summary: str
    translation: str
    final_result: str
    log: Annotated[list, add]

def clean_node(state: TextState) -> dict:
    """清理文本：去除多余空白、标准化"""
    import re
    text = state["original"]
    text = re.sub(r"\s+", " ", text).strip()
    return {
        "cleaned": text,
        "log": ["[clean] 文本已清理"],
    }

def summarize_node(state: TextState) -> dict:
    """使用 LLM 生成摘要"""
    model = init_chat_model("moonshot:moonshot-v1-8k")
    response = model.invoke([
        ("system", "请用一句话总结以下文本："),
        ("human", state["cleaned"]),
    ])
    return {
        "summary": response.content,
        "log": ["[summarize] 摘要已生成"],
    }

def translate_node(state: TextState) -> dict:
    """将摘要翻译为英文"""
    model = init_chat_model("moonshot:moonshot-v1-8k")
    response = model.invoke([
        ("system", "请将以下中文翻译为英文："),
        ("human", state["summary"]),
    ])
    return {
        "translation": response.content,
        "log": ["[translate] 翻译已完成"],
    }

def format_node(state: TextState) -> dict:
    """格式化最终结果"""
    result = (
        f"原文: {state['cleaned']}\n"
        f"摘要: {state['summary']}\n"
        f"翻译: {state['translation']}"
    )
    return {
        "final_result": result,
        "log": ["[format] 结果已格式化"],
    }

# 构建图
builder = StateGraph(TextState)
builder.add_node("clean", clean_node)
builder.add_node("summarize", summarize_node)
builder.add_node("translate", translate_node)
builder.add_node("format", format_node)

builder.add_edge(START, "clean")
builder.add_edge("clean", "summarize")
builder.add_edge("summarize", "translate")
builder.add_edge("translate", "format")
builder.add_edge("format", END)

graph = builder.compile()

# 执行
result = graph.invoke({
    "original": "  Python   是一门  非常   流行的   编程语言。  ",
    "cleaned": "",
    "summary": "",
    "translation": "",
    "final_result": "",
    "log": [],
})

print(result["log"])
# ['[clean] 文本已清理', '[summarize] 摘要已生成',
#  '[translate] 翻译已完成', '[format] 结果已格式化']
```

## 小结

| 要点 | 说明 |
|------|------|
| 节点本质 | 接收 State，返回更新 dict 的函数 |
| 输入 | 完整的当前 State 快照 |
| 输出 | 只返回需要更新的字段（合并而非覆盖） |
| LLM 调用 | 使用 `init_chat_model` + `invoke` |
| 工具调用 | 手动绑定工具或使用 `create_react_agent` |
| 错误处理 | try/except + 重试模式 |
| 并行执行 | 多个节点从同一节点出发即可并行 |
| 元数据 | `get_config()` 访问运行时配置 |

## 练习题

1. 创建一个包含 3 个节点的文本处理管道：分词 → 词频统计 → 生成报告
2. 创建一个带重试机制的 LLM 调用节点，最多重试 3 次
3. 创建一个并行处理节点：同时调用两个不同温度的模型，然后合并结果
4. 创建一个工具调用节点：实现一个简单的计算器（加、减、乘、除）
