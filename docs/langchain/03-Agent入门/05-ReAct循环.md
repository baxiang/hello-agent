# 05-ReAct循环

> Reasoning + Acting：Agent 的核心执行机制

## 什么是 ReAct

ReAct 是 Agent 的核心执行模式：

```
ReAct = Reasoning + Acting

┌────────────────────────────────────────────────┐
│  ReAct 循环                                     │
│                                                 │
│  1. Thought（思考）                             │
│     分析用户问题，决定需要什么信息              │
│                                                 │
│  2. Action（行动）                              │
│     选择合适的工具并执行                        │
│                                                 │
│  3. Observation（观察）                         │
│     查看工具返回结果                            │
│                                                 │
│  4. 判断                                        │
│     是否有足够信息？                            │
│     ├── 是 → Final Answer（最终回答）           │
│     └── 否 → 回到步骤 1                        │
└────────────────────────────────────────────────┘
```

## ReAct vs 直接调用

| 方式 | 流程 | 适用场景 |
|------|------|----------|
| 直接调用 LLM | 输入 → 输出 | 单次问答，无需外部信息 |
| ReAct Agent | 输入 → 思考 → 行动 → 观察 → 循环 → 输出 | 需要多步推理或工具调用 |

```python
# 直接调用 - 无工具
model.invoke("Python 是什么？")

# ReAct Agent - 循环调用工具
agent.invoke({
    "messages": [{"role": "user", "content": "查找最新 Python 版本"}]
})
```

## LangGraph 中的 ReAct 实现

### 图结构

```
LangGraph 实现 ReAct：
┌────────────────────────────────────────────┐
│  START                                     │
│    ↓                                       │
│  agent_node                                │
│  (LLM 决定是否调用工具)                     │
│    ↓                                       │
│  should_continue?                          │
│    ↓                                       │
│  ┌─────── yes ───────┐                     │
│  ↓                   │                     │
│  tools_node          │                     │
│  (执行工具)          │                     │
│    ↓                 │                     │
│  agent_node ←────────┘                     │
│    ↓                                       │
│  └─────── no ────────┐                     │
│    ↓                 │                     │
│  END                                     │
└────────────────────────────────────────────┘
```

---

### 节点说明

| 节点 | 功能 |
|------|------|
| `agent_node` | LLM 接收消息，生成响应或工具调用 |
| `tools_node` | 执行所有工具调用，返回 ToolMessage |
| `should_continue` | 条件边，检查是否有 tool_calls |

---

### 边的逻辑

```python
def should_continue(state) -> str:
    """决定是否继续执行工具"""
    messages = state["messages"]
    last_message = messages[-1]
    
    if last_message.tool_calls:
        return "tools"    # 有工具调用 → 执行工具
    return END             # 无工具调用 → 结束
```

## 追踪 ReAct 执行

### stream_mode="updates"

查看每一步的更新：

```python
from langchain.agents import create_agent
from langchain.tools import tool

@tool
def add(a: int, b: int) -> int:
    """加法运算"""
    return a + b

@tool
def multiply(a: int, b: int) -> int:
    """乘法运算"""
    return a * b

agent = create_agent(
    model="moonshot:moonshot-v1-8k",
    tools=[add, multiply],
)

for chunk in agent.stream(
    {"messages": [{"role": "user", "content": "计算 (3 + 5) * 2"}]},
    stream_mode="updates",
):
    for step, data in chunk.items():
        print(f"步骤: {step}")
        if "messages" in data:
            msg = data["messages"][-1]
            if hasattr(msg, "tool_calls") and msg.tool_calls:
                print(f"  工具调用: {msg.tool_calls}")
            elif msg.content:
                print(f"  内容: {msg.content[:50]}...")
```

---

### stream_mode="values"

查看完整状态值：

```python
from langchain.messages import AIMessage, HumanMessage

for chunk in agent.stream({
    "messages": [{"role": "user", "content": "计算 2 + 3"}]
}, stream_mode="values"):
    latest = chunk["messages"][-1]
    
    if isinstance(latest, HumanMessage):
        print(f"用户: {latest.content}")
    elif isinstance(latest, AIMessage):
        if latest.content:
            print(f"Agent: {latest.content}")
        elif latest.tool_calls:
            print(f"调用工具: {[tc['name'] for tc in latest.tool_calls]}")
```

---

### 完整执行历史

```python
result = agent.invoke({
    "messages": [{"role": "user", "content": "北京天气？"}]
})

print("=== 执行历史 ===")
for msg in result["messages"]:
    role = msg.__class__.__name__.replace("Message", "")
    if msg.content:
        content = msg.content[:50]
        print(f"{role}: {content}...")
    if hasattr(msg, "tool_calls") and msg.tool_calls:
        print(f"  工具调用: {msg.tool_calls}")
```

---

## ReAct 执行示例

### 单工具调用

```
用户: 北京天气怎么样？

┌─ agent_node ─────────────────────────────┐
│  LLM 决定: 需要调用 get_weather 工具      │
│  Tool Call: get_weather(city="北京")     │
└──────────────────────────────────────────┘
              ↓
┌─ tools_node ─────────────────────────────┐
│  执行: get_weather("北京")                │
│  返回: "北京 天气晴朗，25°C"             │
└──────────────────────────────────────────┘
              ↓
┌─ agent_node ─────────────────────────────┐
│  LLM 接收结果，生成最终回答               │
│  Final Answer: "北京天气晴朗，25°C"      │
└──────────────────────────────────────────┘
```

---

### 多工具调用（串行）

```
用户: 北京和上海哪个更热？

┌─ agent_node ─────────────────────────────┐
│  LLM 决定: 需要获取两地天气               │
│  Tool Call: get_weather(city="北京")     │
└──────────────────────────────────────────┘
              ↓
┌─ tools_node ─────────────────────────────┐
│  返回: "北京 天气晴朗，25°C"             │
└──────────────────────────────────────────┘
              ↓
┌─ agent_node ─────────────────────────────┐
│  LLM 决定: 还需要上海天气                 │
│  Tool Call: get_weather(city="上海")     │
└──────────────────────────────────────────┘
              ↓
┌─ tools_node ─────────────────────────────┐
│  返回: "上海 多云，28°C"                 │
└──────────────────────────────────────────┘
              ↓
┌─ agent_node ─────────────────────────────┐
│  LLM 比较两地温度，生成回答               │
│  Final Answer: "上海更热，28°C vs 25°C"  │
└──────────────────────────────────────────┘
```

---

### 并行工具调用

```
用户: 北京和上海的天气？

┌─ agent_node ─────────────────────────────┐
│  LLM 决定: 同时获取两地天气               │
│  Tool Call 1: get_weather(city="北京")   │
│  Tool Call 2: get_weather(city="上海")   │
└──────────────────────────────────────────┘
              ↓ (并行执行)
┌─ tools_node ─────────────────────────────┐
│  执行两个工具（同时）                     │
│  返回 1: "北京 天气晴朗，25°C"           │
│  返回 2: "上海 多云，28°C"               │
└──────────────────────────────────────────┘
              ↓
┌─ agent_node ─────────────────────────────┐
│  LLM 接收两个结果，生成回答               │
└──────────────────────────────────────────┘
```

## 控制循环

### Recursion Limit

防止 Agent 无限循环：

```python
result = agent.invoke(
    {"messages": [{"role": "user", "content": "复杂问题"}]},
    config={"recursion_limit": 5},
)
```

**限制说明：**

| 值 | 说明 |
|----|------|
| 默认 | 1000 步 |
| 5 | 最多 5 步（工具调用 + LLM 响应） |
| 1 | 只允许一次 LLM 调用，不能调用工具 |

---

### 超出限制的错误

```python
from langgraph.errors import GraphRecursionError

try:
    result = agent.invoke(
        {"messages": [{"role": "user", "content": "很复杂的问题"}]},
        config={"recursion_limit": 2},
    )
except GraphRecursionError:
    print("Agent 超过了最大步数限制")
```

---

### 动态调整限制

```python
# 简单问题：限制步数少
result = agent.invoke(
    {"messages": [{"role": "user", "content": "天气？"}]},
    config={"recursion_limit": 3},
)

# 复杂问题：允许更多步数
result = agent.invoke(
    {"messages": [{"role": "user", "content": "研究并报告..."}]},
    config={"recursion_limit": 20},
)
```

## 错误处理

### 工具执行错误

```python
from langchain.tools import tool

@tool
def divide(a: float, b: float) -> float:
    """除法运算"""
    return a / b  # b=0 时会抛出 ZeroDivisionError

agent = create_agent(
    model="moonshot:moonshot-v1-8k",
    tools=[divide],
)

# 默认：捕获调用错误，返回错误消息给 LLM
result = agent.invoke({
    "messages": [{"role": "user", "content": "计算 10 / 0"}]
})
# LLM 会看到错误消息，可能尝试修复或告知用户
```

---

### 自定义错误处理中间件

```python
from langchain.agents.middleware import wrap_tool_call
from langchain.messages import ToolMessage

@wrap_tool_call
def handle_tool_errors(request, handler):
    """捕获工具错误，返回友好消息"""
    try:
        return handler(request)
    except ZeroDivisionError:
        return ToolMessage(
            content="错误: 除数不能为零",
            tool_call_id=request.tool_call["id"],
        )
    except Exception as e:
        return ToolMessage(
            content=f"工具执行错误: {str(e)}",
            tool_call_id=request.tool_call["id"],
        )

agent = create_agent(
    model="moonshot:moonshot-v1-8k",
    tools=[divide],
    middleware=[handle_tool_errors],
)
```

---

### 错误处理策略

| 策略 | 说明 | 适用场景 |
|------|------|----------|
| 默认处理 | 捕获调用错误，重抛执行错误 | 大多数场景 |
| 自定义消息 | 返回固定错误消息 | 面向用户的应用 |
| 重试逻辑 | 在中间件中重试 | 网络不稳定场景 |
| 降级处理 | 返回默认值 | 关键业务场景 |

---

### 重试示例

```python
@wrap_tool_call
def retry_on_failure(request, handler):
    """失败时重试"""
    max_retries = 3
    
    for attempt in range(max_retries):
        try:
            return handler(request)
        except Exception as e:
            if attempt == max_retries - 1:
                return ToolMessage(
                    content=f"失败（已重试 {max_retries} 次）: {e}",
                    tool_call_id=request.tool_call["id"],
                )
            # 否则继续重试
```

## 中断与人工审核

### 何时中断

| 条件 | 说明 |
|------|------|
| 无 tool_calls | LLM 认为已足够信息，生成最终回答 |
| recursion_limit | 达到最大步数限制 |
| interrupt | 人工审核中断 |

---

### 查看中断点

```python
# 人工中断需要在图中配置 interrupt_before 或 interrupt_after
# create_agent 默认不包含中断点

# 使用自定义图时可以添加：
graph = builder.compile(
    interrupt_before=["tools"],  # 在执行工具前中断
)
```

## 调试 ReAct

### 打印完整消息历史

```python
def print_execution_trace(result):
    """打印 Agent 执行的完整轨迹"""
    for msg in result["messages"]:
        msg_type = msg.__class__.__name__
        
        if msg_type == "HumanMessage":
            print(f"👤 用户: {msg.content}")
        elif msg_type == "AIMessage":
            if msg.content:
                print(f"🤖 Agent: {msg.content}")
            if msg.tool_calls:
                for tc in msg.tool_calls:
                    print(f"🔧 调用: {tc['name']}({tc['args']})")
        elif msg_type == "ToolMessage":
            print(f"📋 结果: {msg.content[:50]}...")
        print("-" * 40)

result = agent.invoke({
    "messages": [{"role": "user", "content": "计算 (3+5)*2"}]
})
print_execution_trace(result)
```

---

### 分析工具使用

```python
def analyze_tool_usage(result):
    """分析工具使用情况"""
    messages = result["messages"]
    
    tool_calls = []
    for msg in messages:
        if hasattr(msg, "tool_calls") and msg.tool_calls:
            tool_calls.extend(msg.tool_calls)
    
    print(f"总工具调用次数: {len(tool_calls)}")
    
    # 按工具名统计
    from collections import Counter
    counts = Counter(tc["name"] for tc in tool_calls)
    for name, count in counts.items():
        print(f"  {name}: {count} 次")

analyze_tool_usage(result)
```

## 优化 ReAct 循环

### 减少循环次数

```python
# ❌ 差的工具设计：每次只能获取一条信息
@tool
def get_weather(city: str) -> str:
    """获取一个城市天气"""
    return f"{city} 晴天"

# 用户问 5 个城市 → 5 次循环

# ✅ 好的工具设计：支持批量
@tool
def get_weather(cities: list[str]) -> str:
    """获取多个城市天气"""
    results = []
    for city in cities:
        results.append(f"{city} 晴天")
    return "\n".join(results)

# 用户问 5 个城市 → 1 次循环
```

---

### 提供足够信息

```python
# ❌ 差：返回信息不足
@tool
def search(query: str) -> str:
    return "找到结果"

# LLM 可能需要多次调用获取更多信息

# ✅ 好：返回完整信息
@tool
def search(query: str) -> str:
    results = _do_search(query)
    return json.dumps(results, ensure_ascii=False, indent=2)

# LLM 一次性获得足够信息
```

## 小结

| 要点 | 说明 |
|------|------|
| ReAct 循环 | Thought → Action → Observation → 循环 |
| LangGraph 实现 | agent_node → tools_node → 条件边 |
| 流式追踪 | stream() 实时监控执行步骤 |
| 循环控制 | recursion_limit 防止无限循环 |
| 并行执行 | 多个工具可同时调用 |
| 错误处理 | middleware 自定义错误响应 |
| 调试 | 打印消息历史分析执行轨迹 |
| 优化 | 批量操作、返回完整信息减少循环 |
