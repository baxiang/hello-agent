# 08-Agent实战

> 综合实战项目：构建一个实用的研究助手 Agent

## 项目概述

构建一个研究助手 Agent，具备以下能力：

```
研究助手功能：
┌────────────────────────────────────────────┐
│  1. 信息搜索                               │
│  2. 数学计算                               │
│  3. 笔记管理                               │
│  4. 用户偏好记忆                            │
│  5. 对话摘要                               │
│  6. 结构化输出                             │
└────────────────────────────────────────────┘
```

## 项目结构

```
research_assistant/
├── pyproject.toml
├── app/
│   ├── __init__.py
│   ├── main.py          # Agent 主程序
│   ├── tools.py         # 工具定义
│   ├── prompts.py       # 提示词
│   └── models.py        # Pydantic 模型
└── tests/
    └── test_main.py     # 测试
```

## 安装

```bash
mkdir research_assistant && cd research_assistant
uv init
uv add "langchain[openai]" langgraph pydantic
```

## 完整代码

### 工具定义 (app/tools.py)

```python
"""研究助手工具定义"""

from langchain.tools import tool, ToolRuntime
from langchain.messages import ToolMessage
from typing import Optional
import json
from datetime import datetime


@tool
def search_information(query: str, runtime: ToolRuntime) -> str:
    """搜索互联网获取信息。适用于查找新闻、事实、资料等。"""
    writer = runtime.stream_writer
    writer(f"正在搜索: {query}")
    
    # 模拟搜索
    results = _simulate_search(query)
    
    writer(f"找到 {len(results)} 条结果")
    
    # 更新状态
    runtime.state.setdefault("search_history", []).append({
        "query": query,
        "count": len(results),
        "timestamp": datetime.now().isoformat(),
    })
    
    return json.dumps(results, ensure_ascii=False, indent=2)


def _simulate_search(query: str) -> list[dict]:
    """模拟搜索（实际应调用真实 API）"""
    return [
        {
            "title": f"关于 {query} 的文章",
            "snippet": f"这是关于 {query} 的相关信息...",
            "url": f"https://example.com/{query}",
        }
    ]


@tool
def calculate(expression: str) -> str:
    """计算数学表达式。用于任何数学运算。"""
    try:
        # 安全的计算（仅允许数学运算）
        allowed = set("0123456789+-*/.() ")
        if not all(c in allowed for c in expression):
            return "错误: 表达式包含无效字符"
        result = eval(expression)
        return str(result)
    except Exception as e:
        return f"计算错误: {e}"


@tool
def add_note(note: str, runtime: ToolRuntime) -> str:
    """添加笔记。用于记录重要信息。"""
    notes = runtime.state.get("notes", [])
    notes.append({
        "content": note,
        "timestamp": datetime.now().isoformat(),
    })
    runtime.state["notes"] = notes
    
    return f"笔记已添加。当前共 {len(notes)} 条笔记"


@tool
def list_notes(runtime: ToolRuntime) -> str:
    """列出所有笔记"""
    notes = runtime.state.get("notes", [])
    
    if not notes:
        return "暂无笔记"
    
    output = []
    for i, note in enumerate(notes, 1):
        output.append(f"{i}. {note['content']}")
    
    return "\n".join(output)


@tool
def summarize_conversation(runtime: ToolRuntime) -> str:
    """总结当前对话。获取对话要点。"""
    messages = runtime.state.get("messages", [])
    
    user_count = 0
    tool_calls_count = 0
    
    for msg in messages:
        if msg.type == "human":
            user_count += 1
        if hasattr(msg, "tool_calls") and msg.tool_calls:
            tool_calls_count += len(msg.tool_calls)
    
    search_history = runtime.state.get("search_history", [])
    notes = runtime.state.get("notes", [])
    
    summary = [
        f"对话轮数: {user_count}",
        f"工具调用: {tool_calls_count} 次",
        f"搜索次数: {len(search_history)}",
        f"笔记数量: {len(notes)}",
    ]
    
    if search_history:
        summary.append("\n搜索历史:")
        for s in search_history[-3:]:  # 最近 3 次
            summary.append(f"  - {s['query']} ({s['count']} 条结果)")
    
    return "\n".join(summary)


@tool
def set_user_name(name: str, runtime: ToolRuntime) -> str:
    """设置用户名。用于个性化称呼。"""
    runtime.state["user_name"] = name
    return f"你好，{name}！用户名已设置"


@tool
def get_time_info(runtime: ToolRuntime) -> str:
    """获取当前时间和日期"""
    now = datetime.now()
    return now.strftime("%Y年%m月%d日 %H:%M:%S")
```

---

### Pydantic 模型 (app/models.py)

```python
"""结构化输出模型定义"""

from pydantic import BaseModel, Field
from typing import Optional, Literal


class SearchResult(BaseModel):
    """搜索结果"""
    topic: str = Field(description="搜索主题")
    summary: str = Field(description="摘要")
    key_points: list[str] = Field(description="要点列表")


class ContactInfo(BaseModel):
    """联系方式"""
    name: str = Field(description="姓名")
    email: Optional[str] = Field(default=None, description="邮箱")
    phone: Optional[str] = Field(default=None, description="电话")


class Report(BaseModel):
    """研究报告"""
    title: str = Field(description="报告标题")
    sections: list[str] = Field(description="章节列表")
    conclusion: str = Field(description="结论")
    confidence: Literal["low", "medium", "high"] = Field(
        description="置信度"
    )
```

---

### 提示词 (app/prompts.py)

```python
"""Agent 提示词"""

SYSTEM_PROMPT = """
你是一个专业的研究助手，帮助用户完成研究任务。

## 可用工具
- search_information: 搜索互联网信息
- calculate: 数学计算
- add_note / list_notes: 笔记管理
- summarize_conversation: 对话摘要
- set_user_name: 设置用户名
- get_time_info: 获取当前时间

## 行为准则
1. 主动使用工具获取信息
2. 重要信息自动记录为笔记
3. 回答要准确、有条理
4. 对于不确定的信息要标注"可能"

## 输出格式
- 使用 Markdown 格式
- 列表项使用 - 符号
- 关键信息用粗体标记
"""
```

---

### 主程序 (app/main.py)

```python
"""研究助手主程序"""

from langchain.agents import create_agent
from langchain.agents.structured_output import ToolStrategy
from langchain.messages import HumanMessage

from app.tools import (
    search_information,
    calculate,
    add_note,
    list_notes,
    summarize_conversation,
    set_user_name,
    get_time_info,
)
from app.prompts import SYSTEM_PROMPT
from app.models import Report


def create_research_agent():
    """创建研究助手 Agent"""
    return create_agent(
        model="moonshot:moonshot-v1-8k",
        tools=[
            search_information,
            calculate,
            add_note,
            list_notes,
            summarize_conversation,
            set_user_name,
            get_time_info,
        ],
        system_prompt=SYSTEM_PROMPT,
    )


def run_research_session():
    """运行研究会话"""
    agent = create_research_agent()
    
    print("=" * 50)
    print("研究助手已启动！输入 'quit' 退出。")
    print("=" * 50)
    
    messages = []
    
    while True:
        user_input = input("\n你: ").strip()
        
        if user_input.lower() in ("quit", "exit", "q"):
            print("再见！")
            break
        
        if not user_input:
            continue
        
        messages.append(HumanMessage(content=user_input))
        
        print("\nAgent 正在思考...")
        
        result = agent.invoke({"messages": messages})
        
        response = result["messages"][-1]
        print(f"\n助手: {response.content}")
        
        messages.append(response)


def run_structured_output():
    """运行结构化输出示例"""
    agent = create_agent(
        model="moonshot:moonshot-v1-8k",
        tools=[search_information],
        response_format=ToolStrategy(Report),
    )
    
    result = agent.invoke({
        "messages": [{
            "role": "user",
            "content": "研究 Python 编程语言的优点和缺点，生成一份报告"
        }]
    })
    
    report = result["structured_response"]
    print("\n=== 研究报告 ===")
    print(f"标题: {report.title}")
    print(f"章节: {report.sections}")
    print(f"结论: {report.conclusion}")
    print(f"置信度: {report.confidence}")


if __name__ == "__main__":
    import sys
    
    if len(sys.argv) > 1 and sys.argv[1] == "--structured":
        run_structured_output()
    else:
        run_research_session()
```

## 运行

```bash
# 交互式研究会话
uv run python -m app.main

# 结构化输出示例
uv run python -m app.main --structured
```

## 示例对话

```
==================================================
研究助手已启动！输入 'quit' 退出。
==================================================

你: 我叫张三

助手: 你好，张三！很高兴为你服务。有什么我可以帮你的吗？

你: 搜索 Python 的最新版本

助手: 正在搜索...
找到 3 条结果

Python 最新版本是 Python 3.12，主要新特性包括：
- 更快的执行速度
- 改进的错误消息
- 新的类型推断功能

你: 计算 3.12 * 100

助手: 312.0

你: 记住这个结果

助手: 笔记已添加。当前共 1 条笔记

你: 总结我们的对话

助手: 对话轮数: 4
工具调用: 3 次
搜索次数: 1
笔记数量: 1

搜索历史:
  - Python 的最新版本 (3 条结果)
```

## 测试

### 测试文件 (tests/test_main.py)

```python
"""研究助手测试"""

import pytest
from app.tools import calculate, add_note, list_notes


def test_calculate():
    """测试计算工具"""
    result = calculate.invoke({"expression": "2 + 3"})
    assert "5" in result
    
    result = calculate.invoke({"expression": "10 * 5"})
    assert "50" in result


def test_calculate_error():
    """测试计算错误处理"""
    result = calculate.invoke({"expression": "invalid"})
    assert "错误" in result or "error" in result.lower()


def test_notes_empty():
    """测试空笔记"""
    from langchain.tools import ToolRuntime
    
    class MockState:
        def __init__(self):
            self._state = {}
        
        def get(self, key, default=None):
            return self._state.get(key, default)
        
        def __setitem__(self, key, value):
            self._state[key] = value
    
    class MockRuntime:
        def __init__(self):
            self.state = MockState()
    
    runtime = MockRuntime()
    
    result = list_notes.invoke({"runtime": runtime})
    assert "暂无笔记" in result


def test_notes_add():
    """测试添加笔记"""
    class MockState:
        def __init__(self):
            self._state = {}
        
        def get(self, key, default=None):
            return self._state.get(key, default)
        
        def __setitem__(self, key, value):
            self._state[key] = value
    
    class MockRuntime:
        def __init__(self):
            self.state = MockState()
    
    runtime = MockRuntime()
    
    result = add_note.invoke({"note": "测试笔记", "runtime": runtime})
    assert "笔记已添加" in result
    assert "1 条笔记" in result
```

---

### 运行测试

```bash
cd research_assistant
uv run pytest
```

## 扩展方向

### 1. 真实搜索 API

```python
@tool
def search_information(query: str) -> str:
    """搜索信息"""
    import httpx
    
    response = httpx.get(
        "https://api.example.com/search",
        params={"q": query},
    )
    return response.text
```

---

### 2. 数据库集成

```python
@tool
def save_research(topic: str, content: str, runtime: ToolRuntime) -> str:
    """保存研究结果到数据库"""
    store = runtime.store
    user_id = runtime.context.user_id
    
    store.put(
        ("research", user_id),
        topic,
        {"content": content, "timestamp": datetime.now().isoformat()},
    )
    return f"研究 '{topic}' 已保存"
```

---

### 3. 多 Agent 协作

```python
# 研究 Agent
research_agent = create_agent(
    model="moonshot:moonshot-v1-8k",
    tools=[search_information, add_note],
    name="researcher",
)

# 写作 Agent
writer_agent = create_agent(
    model="moonshot:moonshot-v1-8k",
    tools=[],
    name="writer",
    system_prompt="你是一个专业的写作助手。",
)
```

---

### 4. 中间件增强

```python
@wrap_model_call
def auto_note(request, handler):
    """自动将重要信息记为笔记"""
    result = handler(request)
    
    # 检查回复是否包含重要信息
    messages = result.state.get("messages", [])
    last_msg = messages[-1] if messages else None
    
    if last_msg and last_msg.content:
        if "重要" in last_msg.content or "关键" in last_msg.content:
            # 自动记笔记
            pass
    
    return result
```

## 小结

| 要点 | 说明 |
|------|------|
| 工具设计 | 每个工具职责单一，描述清晰 |
| 状态管理 | 使用 runtime.state 管理短期记忆 |
| 结构化输出 | ToolStrategy 实现固定格式输出 |
| 提示词设计 | 明确角色、能力、行为准则 |
| 测试 | 工具可独立测试 |
| 扩展性 | 通过中间件和 Store 扩展能力 |
