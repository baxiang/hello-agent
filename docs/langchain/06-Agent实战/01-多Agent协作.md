# 01-多Agent协作

> LangGraph 支持构建多 Agent 协作系统，实现复杂任务的分工与协同

## 为什么需要多Agent协作

单个 Agent 处理复杂任务时存在局限：

```
单Agent处理复杂问题
┌──────────────────────────────────────┐
│  用户: "调研AI趋势并写一份报告"        │
│                                      │
│  ┌────────────────────────────────┐  │
│  │  Agent (什么都得自己做)          │  │
│  │  1. 搜索最新AI资讯               │  │
│  │  2. 分析技术趋势                 │  │
│  │  3. 整理数据                     │  │
│  │  4. 撰写报告                     │  │
│  │  5. 自我审查                     │  │
│  │  ↓ 容易遗漏、质量不稳定           │  │
│  └────────────────────────────────┘  │
└──────────────────────────────────────┘

多Agent协作 (分工明确、各司其职)
┌──────────────────────────────────────┐
│  用户: "调研AI趋势并写一份报告"        │
│                                      │
│  ┌─────────┐    ┌─────────┐          │
│  │Researcher│───▶│ Writer  │          │
│  │ 专注搜索  │    │ 专注写作 │          │
│  └─────────┘    └─────────┘          │
│       │              │               │
│       ▼              ▼               │
│  ┌─────────┐    ┌─────────┐          │
│  │Analyzer │    │Reviewer │          │
│  │ 专注分析  │    │ 专注审查 │          │
│  └─────────┘    └─────────┘          │
│                                      │
│  每个Agent专精一个领域，质量更高        │
└──────────────────────────────────────┘
```

多 Agent 协作的优势：

- **专业化**：每个 Agent 专精一个领域，提示词更聚焦
- **可维护性**：单个 Agent 的修改不影响其他 Agent
- **可扩展性**：可以动态添加新的 Agent 角色
- **可靠性**：多个 Agent 交叉验证，减少错误

## 多Agent模式对比

| 模式 | 适用场景 | 复杂度 | 通信方式 | 典型用例 |
|------|---------|--------|---------|---------|
| **Handoff** | 任务需要交接给另一个专家 | ★★☆ | 直接传递 | 客服转技术支撑 |
| **Supervisor** | 需要集中决策和路由 | ★★★ | 中心调度 | 项目经理分配任务 |
| **Hierarchical** | 多层级组织结构 | ★★★★ | 层级传递 | 公司部门协作 |
| **Parallel** | 任务可并行处理 | ★★☆ | 结果聚合 | 多源数据收集 |

```
Handoff模式:          Supervisor模式:         Hierarchical模式:
A ──handoff──▶ B     S ──route──▶ A          S ──manage──▶ M1
                                    ├──▶ A        ├──▶ W1
                                 S ──route──▶ B        └──▶ W2
                                    ├──▶ B      M2
                                 S ──route──▶ C        ├──▶ W3
                                    └──▶ C             └──▶ W4

Parallel模式:
    ┌──▶ A ──┐
Input ├──▶ B ──┤──▶ Aggregate
    ├──▶ C ──┤
    └──▶ D ──┘
```

## 模式1：Handoff — Agent间交接

Handoff 是最简单的多 Agent 协作模式：一个 Agent 完成任务后，将控制权交给另一个 Agent。

### 基本原理

```python
from langchain.chat_models import init_chat_model
from langgraph.prebuilt import create_react_agent
from langgraph.graph import StateGraph, START, END
from langgraph.types import Command
from typing import TypedDict, Annotated
import operator

# 定义共享状态
class AgentState(TypedDict):
    messages: Annotated[list, operator.add]
    current_agent: str

# 创建两个 Agent
model = init_chat_model("moonshot:moonshot-v1-8k")

# Agent A: 问题分类器
def classifier_agent(state: AgentState):
    """判断问题类型，决定交给哪个专家"""
    from langchain.messages import HumanMessage, SystemMessage
    
    last_msg = state["messages"][-1].content
    
    # 简单分类逻辑
    if any(kw in last_msg.lower() for kw in ["代码", "python", "编程", "bug"]):
        next_agent = "coding_expert"
    elif any(kw in last_msg.lower() for kw in ["数学", "计算", "公式"]):
        next_agent = "math_expert"
    else:
        next_agent = "general_expert"
    
    return {
        "messages": [SystemMessage(f"接下来由 {next_agent} 回答")],
        "current_agent": next_agent,
    }

# Agent B: 编程专家
def coding_expert(state: AgentState):
    response = model.invoke([
        SystemMessage("你是一个Python编程专家，用简洁的方式回答问题。"),
        *state["messages"],
    ])
    return {"messages": [response]}

# Agent C: 数学专家
def math_expert(state: AgentState):
    response = model.invoke([
        SystemMessage("你是一个数学专家，擅长解释数学概念。"),
        *state["messages"],
    ])
    return {"messages": [response]}

# Agent D: 通用专家
def general_expert(state: AgentState):
    response = model.invoke([
        SystemMessage("你是一个知识渊博的助手。"),
        *state["messages"],
    ])
    return {"messages": [response]}

# 构建图
graph = StateGraph(AgentState)

graph.add_node("classifier", classifier_agent)
graph.add_node("coding_expert", coding_expert)
graph.add_node("math_expert", math_expert)
graph.add_node("general_expert", general_expert)

graph.add_edge(START, "classifier")

def route_to_expert(state: AgentState):
    return state["current_agent"]

graph.add_conditional_edges("classifier", route_to_expert)
graph.add_edge("coding_expert", END)
graph.add_edge("math_expert", END)
graph.add_edge("general_expert", END)

app = graph.compile()

# 使用
result = app.invoke({
    "messages": [HumanMessage("Python中列表和元组有什么区别？")],
    "current_agent": "",
})
print(result["messages"][-1].content)
```

### 使用 Command 进行 Handoff

LangGraph 提供了更优雅的 `Command` 方式实现 handoff：

```python
from langgraph.types import Command

def classifier_agent(state: AgentState):
    last_msg = state["messages"][-1].content
    
    if "代码" in last_msg or "python" in last_msg.lower():
        next_agent = "coding_expert"
    elif "数学" in last_msg:
        next_agent = "math_expert"
    else:
        next_agent = "general_expert"
    
    # 使用 Command 直接跳转到下一个节点
    return Command(
        goto=next_agent,
        update={
            "messages": [SystemMessage(f"转交给 {next_agent}")]
        }
    )

# 图结构相同，但 classifier 使用 Command 实现跳转
```

### Handoff 模式要点

| 要点 | 说明 |
|------|------|
| 控制权转移 | 一个 Agent 完成后，明确指定下一个 Agent |
| 状态传递 | 通过共享 state 传递上下文 |
| 简单直接 | 适合线性流程：A → B → C |
| 局限性 | 不适合需要动态决策的场景 |

## 模式2：create_agent 作为子图

LangGraph 0.2+ 引入了 `create_agent`，可以将预构建的 ReAct Agent 作为子图嵌入。

### 基本概念

```
主图 (Supervisor)
├── Agent 1 (create_react_agent)
│   ├── LLM
│   └── Tools: [search_tool]
├── Agent 2 (create_react_agent)
│   ├── LLM
│   └── Tools: [calculator_tool]
└── Agent 3 (create_react_agent)
    ├── LLM
    └── Tools: [file_tool]
```

### 示例：研究助手

```python
from langchain.chat_models import init_chat_model
from langgraph.prebuilt import create_react_agent
from langgraph.graph import StateGraph, START, END
from langchain.tools import tool
from typing import TypedDict, Annotated
import operator

# 定义工具
@tool
def search_web(query: str) -> str:
    """搜索互联网获取信息"""
    # 实际项目中接入真实搜索API
    return f"搜索 '{query}' 的结果：AI Agent 技术在2024年快速发展..."

@tool
def calculate(expression: str) -> str:
    """计算数学表达式"""
    try:
        return str(eval(expression))
    except Exception as e:
        return f"计算错误: {e}"

# 创建子 Agent
model = init_chat_model("moonshot:moonshot-v1-8k")

researcher = create_react_agent(
    model,
    tools=[search_web],
    name="researcher",
)

calculator = create_react_agent(
    model,
    tools=[calculate],
    name="calculator",
)

# 定义主状态
class MainState(TypedDict):
    messages: Annotated[list, operator.add]
    topic: str
    research_result: str
    final_answer: str

# 主图节点
def research_node(state: MainState):
    """调用研究者子图"""
    result = researcher.invoke({
        "messages": [HumanMessage(f"请调研关于 {state['topic']} 的最新信息")]
    })
    return {"research_result": result["messages"][-1].content}

def analyze_node(state: MainState):
    """基于研究结果进行分析"""
    response = model.invoke([
        SystemMessage("你是一个分析师，请基于以下研究结果提炼关键要点。"),
        HumanMessage(f"研究结果：{state['research_result']}"),
    ])
    return {"final_answer": response.content}

# 构建主图
graph = StateGraph(MainState)

graph.add_node("research", research_node)
graph.add_node("analyze", analyze_node)

graph.add_edge(START, "research")
graph.add_edge("research", "analyze")
graph.add_edge("analyze", END)

app = graph.compile()

# 使用
result = app.invoke({
    "messages": [],
    "topic": "AI Agent 技术趋势",
    "research_result": "",
    "final_answer": "",
})
print(result["final_answer"])
```

### 子图优势

| 优势 | 说明 |
|------|------|
| 工具隔离 | 每个 Agent 有自己的工具集 |
| 独立循环 | 子图内部可以自主循环（ReAct） |
| 可组合 | 子图可以嵌套组合 |
| 状态独立 | 子图有自己的状态空间 |

## 模式3：Supervisor 路由模式

Supervisor 模式通过一个"管理者"Agent 动态决定将任务分配给哪个"工作者"。

### 架构设计

```
                    ┌─────────────────┐
                    │   Supervisor    │
                    │  (决策路由)      │
                    └────────┬────────┘
                             │
              ┌──────────────┼──────────────┐
              │              │              │
              ▼              ▼              ▼
        ┌───────────┐ ┌───────────┐ ┌───────────┐
        │ Researcher│ │  Coder    │ │  Writer   │
        │ (研究工具) │ │ (代码工具) │ │ (写作工具) │
        └───────────┘ └───────────┘ └───────────┘
```

### 实现 Supervisor

```python
from langchain.chat_models import init_chat_model
from langgraph.prebuilt import create_react_agent
from langgraph.graph import StateGraph, START, END
from langchain.messages import HumanMessage, SystemMessage
from langchain.tools import tool
from typing import TypedDict, Annotated, Literal
import operator
import json

# 定义工具
@tool
def search_tech_news(topic: str) -> str:
    """搜索科技新闻"""
    return f"关于 {topic} 的最新科技新闻摘要..."

@tool
def run_code(code: str) -> str:
    """执行Python代码"""
    return f"代码执行结果: 成功"

@tool
def write_document(content: str) -> str:
    """撰写文档"""
    return f"文档已生成，长度: {len(content)} 字"

model = init_chat_model("moonshot:moonshot-v1-8k")

# 创建工作者 Agent
researcher = create_react_agent(
    model,
    tools=[search_tech_news],
    name="researcher",
)

coder = create_react_agent(
    model,
    tools=[run_code],
    name="coder",
)

writer = create_react_agent(
    model,
    tools=[write_document],
    name="writer",
)

# 定义状态
class SupervisorState(TypedDict):
    messages: Annotated[list, operator.add]
    next: str  # 下一个执行的Agent
    task_result: str
    final_output: str

# Supervisor 节点 — 决定路由
def supervisor(state: SupervisorState):
    """分析任务，决定分配给哪个工作者"""
    
    prompt = """你是一个项目经理，负责分配任务。
根据用户请求，选择最合适的工作者：

- researcher: 需要搜索信息、查找资料
- coder: 需要编写或执行代码
- writer: 需要撰写文档、报告

只返回JSON格式：{{"next": "worker_name", "reason": "分配理由"}}

用户请求: {request}
"""
    
    last_msg = state["messages"][-1].content if state["messages"] else ""
    
    response = model.invoke([
        SystemMessage(prompt.format(request=last_msg)),
    ])
    
    try:
        decision = json.loads(response.content)
        return {
            "next": decision.get("next", "researcher"),
            "task_result": "",
        }
    except json.JSONDecodeError:
        return {"next": "researcher", "task_result": ""}

# 路由函数
def route_work(state: SupervisorState) -> Literal["researcher", "coder", "writer"]:
    return state["next"]

# 工作者节点
def researcher_node(state: SupervisorState):
    result = researcher.invoke({
        "messages": state["messages"]
    })
    return {
        "task_result": result["messages"][-1].content,
        "next": "",
    }

def coder_node(state: SupervisorState):
    result = coder.invoke({
        "messages": state["messages"]
    })
    return {
        "task_result": result["messages"][-1].content,
        "next": "",
    }

def writer_node(state: SupervisorState):
    result = writer.invoke({
        "messages": state["messages"]
    })
    return {
        "task_result": result["messages"][-1].content,
        "next": "",
    }

# 汇总节点
def summarize(state: SupervisorState):
    """汇总所有工作者的结果"""
    response = model.invoke([
        SystemMessage("请基于以下结果生成最终回复。"),
        HumanMessage(f"任务结果: {state['task_result']}"),
    ])
    return {"final_output": response.content}

# 构建图
graph = StateGraph(SupervisorState)

graph.add_node("supervisor", supervisor)
graph.add_node("researcher", researcher_node)
graph.add_node("coder", coder_node)
graph.add_node("writer", writer_node)
graph.add_node("summarize", summarize)

graph.add_edge(START, "supervisor")
graph.add_conditional_edges("supervisor", route_work)
graph.add_edge("researcher", "summarize")
graph.add_edge("coder", "summarize")
graph.add_edge("writer", "summarize")
graph.add_edge("summarize", END)

app = graph.compile()

# 使用
result = app.invoke({
    "messages": [HumanMessage("搜索一下AI Agent的最新发展趋势")],
    "next": "",
    "task_result": "",
    "final_output": "",
})
print(result["final_output"])
```

### Supervisor 模式要点

| 要点 | 说明 |
|------|------|
| 动态路由 | Supervisor 根据内容决定分配 |
| 集中控制 | 所有决策通过 Supervisor |
| 可扩展 | 轻松添加新的工作者 |
| 瓶颈风险 | Supervisor 可能成为性能瓶颈 |

## 模式4：层次化团队

层次化模式模拟真实组织架构：Supervisor 管理多个 Manager，每个 Manager 管理多个 Worker。

### 架构设计

```
                    ┌─────────────────┐
                    │   Supervisor    │
                    │  (CEO)          │
                    └────────┬────────┘
                             │
              ┌──────────────┼──────────────┐
              │              │              │
              ▼              ▼              ▼
        ┌───────────┐ ┌───────────┐ ┌───────────┐
        │ Research  │ │  Eng      │ │  Content  │
        │ Manager   │ │ Manager   │ │ Manager   │
        └─────┬─────┘ └─────┬─────┘ └─────┬─────┘
              │              │              │
         ┌────┴────┐    ┌────┴────┐    ┌────┴────┐
         │         │    │         │    │         │
         ▼         ▼    ▼         ▼    ▼         ▼
     Searcher  Analyst Coder  Tester Writer Editor
```

### 实现层次化团队

```python
from langchain.chat_models import init_chat_model
from langgraph.prebuilt import create_react_agent
from langgraph.graph import StateGraph, START, END
from langchain.messages import HumanMessage, SystemMessage
from langchain.tools import tool
from typing import TypedDict, Annotated, Literal
import operator

# 工具定义
@tool
def search_info(query: str) -> str:
    """搜索信息"""
    return f"搜索结果: {query}"

@tool
def analyze_data(data: str) -> str:
    """分析数据"""
    return f"分析结果: {data}"

@tool
def write_code(code: str) -> str:
    """编写代码"""
    return f"代码: {code}"

@tool
def test_code(code: str) -> str:
    """测试代码"""
    return "测试通过"

@tool
def write_report(content: str) -> str:
    """撰写报告"""
    return f"报告完成: {len(content)} 字"

model = init_chat_model("moonshot:moonshot-v1-8k")

# 创建底层 Agent
searcher = create_react_agent(model, tools=[search_info], name="searcher")
analyst = create_react_agent(model, tools=[analyze_data], name="analyst")
coder = create_react_agent(model, tools=[write_code], name="coder")
tester = create_react_agent(model, tools=[test_code], name="tester")
writer = create_react_agent(model, tools=[write_report], name="writer")

# 定义层次状态
class TeamState(TypedDict):
    messages: Annotated[list, operator.add]
    topic: str
    research_data: str
    code_output: str
    report_draft: str
    final_report: str
    next: str

# === 研究部门 ===
def research_manager(state: TeamState):
    """研究经理分配任务给 searcher 或 analyst"""
    if not state["research_data"]:
        return {"next": "searcher"}
    else:
        return {"next": "analyst"}

def route_research(state: TeamState) -> Literal["searcher_node", "analyst_node"]:
    return "searcher_node" if state["next"] == "searcher" else "analyst_node"

def searcher_node(state: TeamState):
    result = searcher.invoke({
        "messages": [HumanMessage(f"搜索关于 {state['topic']} 的信息")]
    })
    return {"research_data": result["messages"][-1].content, "next": ""}

def analyst_node(state: TeamState):
    result = analyst.invoke({
        "messages": [HumanMessage(f"分析以下数据: {state['research_data']}")]
    })
    return {"research_data": result["messages"][-1].content, "next": ""}

# === 工程部门 ===
def eng_manager(state: TeamState):
    """工程经理分配任务"""
    return {"next": "coder"}

def coder_node(state: TeamState):
    result = coder.invoke({
        "messages": [HumanMessage(f"编写关于 {state['topic']} 的示例代码")]
    })
    return {"code_output": result["messages"][-1].content, "next": ""}

# === 内容部门 ===
def content_manager(state: TeamState):
    """内容经理分配任务"""
    return {"next": "writer"}

def writer_node(state: TeamState):
    result = writer.invoke({
        "messages": [HumanMessage(
            f"基于以下资料撰写报告:\n"
            f"研究数据: {state['research_data']}\n"
            f"代码示例: {state['code_output']}"
        )]
    })
    return {"report_draft": result["messages"][-1].content, "next": ""}

# === 最终汇总 ===
def supervisor(state: TeamState):
    """Supervisor 决定下一步"""
    if not state["research_data"]:
        return {"next": "research_dept"}
    elif not state["code_output"]:
        return {"next": "eng_dept"}
    elif not state["report_draft"]:
        return {"next": "content_dept"}
    else:
        return {"next": "finalize"}

def route_dept(state: TeamState) -> Literal["research_dept", "eng_dept", "content_dept", "finalize"]:
    return state["next"]

def finalize(state: TeamState):
    """最终整合"""
    response = model.invoke([
        SystemMessage("整合所有部门成果，生成最终报告。"),
        HumanMessage(
            f"研究: {state['research_data']}\n"
            f"代码: {state['code_output']}\n"
            f"草稿: {state['report_draft']}"
        ),
    ])
    return {"final_report": response.content}

# 构建层次图
graph = StateGraph(TeamState)

# 研究部门
graph.add_node("research_manager", research_manager)
graph.add_node("searcher_node", searcher_node)
graph.add_node("analyst_node", analyst_node)

# 工程部门
graph.add_node("eng_manager", eng_manager)
graph.add_node("coder_node", coder_node)

# 内容部门
graph.add_node("content_manager", content_manager)
graph.add_node("writer_node", writer_node)

# Supervisor 和最终节点
graph.add_node("supervisor", supervisor)
graph.add_node("finalize", finalize)

# 边连接
graph.add_edge(START, "supervisor")
graph.add_conditional_edges("supervisor", route_dept)

graph.add_edge("research_dept", "research_manager")
graph.add_conditional_edges("research_manager", route_research)
graph.add_edge("searcher_node", "analyst_node")
graph.add_edge("analyst_node", "supervisor")

graph.add_edge("eng_dept", "eng_manager")
graph.add_edge("eng_manager", "coder_node")
graph.add_edge("coder_node", "supervisor")

graph.add_edge("content_dept", "content_manager")
graph.add_edge("content_manager", "writer_node")
graph.add_edge("writer_node", "supervisor")

graph.add_edge("finalize", END)

app = graph.compile()

# 使用
result = app.invoke({
    "messages": [HumanMessage("制作一份关于Python AI的完整技术报告")],
    "topic": "Python AI 应用",
    "research_data": "",
    "code_output": "",
    "report_draft": "",
    "final_report": "",
    "next": "",
})
print(result["final_report"])
```

### 层次化模式要点

| 要点 | 说明 |
|------|------|
| 职责分层 | 每层有明确的职责范围 |
| 可扩展 | 可以添加新的部门和角色 |
| 复杂度高 | 需要仔细设计状态流 |
| 适合大型项目 | 模拟真实组织架构 |

## 多Agent状态管理

### 共享状态 vs 隔离状态

```
共享状态:                    隔离状态:
┌──────────────────┐        ┌──────────┐    ┌──────────┐
│   Global State   │        │ Agent A  │    │ Agent B  │
│                  │        │ State A  │    │ State B  │
│ - messages       │        │          │    │          │
│ - task_result    │        └──────────┘    └──────────┘
│ - final_output   │             │               │
└──────────────────┘            ▼               ▼
        │                  局部结果1         局部结果2
        ▼                       \             /
  所有Agent可读可写               \           /
                                  ▼         ▼
                              ┌──────────────────┐
                              │   Aggregator     │
                              │   合并结果        │
                              └──────────────────┘
```

### 共享状态模式

```python
from typing import TypedDict, Annotated
import operator

# 所有 Agent 共享同一个状态
class SharedState(TypedDict):
    # operator.add 使消息自动累加（追加）
    messages: Annotated[list, operator.add]
    # 共享数据字段
    research_findings: str
    code_draft: str
    review_comments: str
    final_output: str

# 每个节点读写同一个 state
def researcher(state: SharedState):
    # 读取 topic
    topic = state["messages"][-1].content
    
    # 写入 findings
    return {"research_findings": f"关于 {topic} 的研究结果..."}

def writer(state: SharedState):
    # 读取 research_findings
    findings = state["research_findings"]
    
    # 写入 final_output
    return {"final_output": f"基于研究的报告: {findings}"}
```

### 隔离状态 + 结果聚合

```python
from typing import TypedDict, Annotated
import operator
import asyncio

# 每个 Agent 有独立的状态
class ResearchState(TypedDict):
    query: str
    findings: str

class CodeState(TypedDict):
    requirement: str
    code: str

class ReviewState(TypedDict):
    content: str
    feedback: str

# 主状态只聚合结果
class AggregatedState(TypedDict):
    messages: Annotated[list, operator.add]
    research_result: str
    code_result: str
    review_result: str
    final_output: str

# 并行执行后聚合
def aggregate_results(state: AggregatedState):
    """合并所有 Agent 的结果"""
    return {
        "final_output": (
            f"研究结果: {state['research_result']}\n"
            f"代码结果: {state['code_result']}\n"
            f"审查结果: {state['review_result']}"
        )
    }
```

### 状态管理最佳实践

| 实践 | 说明 | 适用场景 |
|------|------|---------|
| 共享 state | 所有节点读写同一份数据 | Agent 间需要频繁共享信息 |
| 隔离 state | 每个子图独立状态 | Agent 独立工作，最后聚合 |
| 混合模式 | 主 state + 子 state | 复杂项目，部分共享部分隔离 |
| 不可变更新 | 每次返回新 dict | 需要历史回溯 |

## 并行Agent执行

### asyncio.gather 并行调用

```python
import asyncio
from langchain.chat_models import init_chat_model
from langgraph.graph import StateGraph, START, END
from langchain.messages import HumanMessage, SystemMessage
from typing import TypedDict, Annotated
import operator

model = init_chat_model("moonshot:moonshot-v1-8k")

class ParallelState(TypedDict):
    messages: Annotated[list, operator.add]
    result_a: str
    result_b: str
    result_c: str
    combined: str

# 三个独立的研究方向
async def research_trend_a(state: ParallelState):
    """研究趋势A: 大模型"""
    response = await model.ainvoke([
        SystemMessage("你是一个AI研究员，请分析大模型的最新发展趋势。"),
        HumanMessage("分析GPT-4、Claude等大模型的技术趋势"),
    ])
    return {"result_a": response.content}

async def research_trend_b(state: ParallelState):
    """研究趋势B: 多模态"""
    response = await model.ainvoke([
        SystemMessage("你是一个AI研究员，请分析多模态技术的最新发展。"),
        HumanMessage("分析多模态AI的技术趋势"),
    ])
    return {"result_b": response.content}

async def research_trend_c(state: ParallelState):
    """研究趋势C: Agent"""
    response = await model.ainvoke([
        SystemMessage("你是一个AI研究员，请分析AI Agent技术的最新发展。"),
        HumanMessage("分析AI Agent的技术趋势"),
    ])
    return {"result_c": response.content}

def combine_results(state: ParallelState):
    """汇总三个研究方向的结果"""
    return {
        "combined": (
            f"=== AI技术趋势综合报告 ===\n\n"
            f"一、大模型趋势\n{state['result_a']}\n\n"
            f"二、多模态趋势\n{state['result_b']}\n\n"
            f"三、Agent趋势\n{state['result_c']}"
        )
    }

# 构建图
graph = StateGraph(ParallelState)

graph.add_node("trend_a", research_trend_a)
graph.add_node("trend_b", research_trend_b)
graph.add_node("trend_c", research_trend_c)
graph.add_node("combine", combine_results)

# 三个节点并行启动
graph.add_edge(START, "trend_a")
graph.add_edge(START, "trend_b")
graph.add_edge(START, "trend_c")

# 全部完成后汇总
graph.add_edge("trend_a", "combine")
graph.add_edge("trend_b", "combine")
graph.add_edge("trend_c", "combine")
graph.add_edge("combine", END)

app = graph.compile()

# 并行执行
async def main():
    result = await app.ainvoke({
        "messages": [],
        "result_a": "",
        "result_b": "",
        "result_c": "",
        "combined": "",
    })
    print(result["combined"])

asyncio.run(main())
```

### LangGraph 并行分支

```python
# 使用 LangGraph 内置的并行能力
from langgraph.graph import StateGraph, START, END

graph = StateGraph(ParallelState)

# 添加节点
for name, func in [
    ("branch_a", research_trend_a),
    ("branch_b", research_trend_b),
    ("branch_c", research_trend_c),
]:
    graph.add_node(name, func)

# 所有分支从 START 并行启动
for branch in ["branch_a", "branch_b", "branch_c"]:
    graph.add_edge(START, branch)

# 所有分支完成后进入 combine
for branch in ["branch_a", "branch_b", "branch_c"]:
    graph.add_edge(branch, "combine")

graph.add_node("combine", combine_results)
graph.add_edge("combine", END)

app = graph.compile()
```

### 并行执行要点

| 要点 | 说明 |
|------|------|
| 独立性 | 并行节点之间不能有依赖关系 |
| 资源消耗 | 并行调用会同时消耗 API 配额 |
| 错误隔离 | 一个分支失败不影响其他分支 |
| 汇聚点 | 需要明确的汇聚节点合并结果 |

## Agent间通信

### 消息传递模式

```
Agent A ──[append messages]──▶ Shared State ◀──[append messages]── Agent B
                                      │
                                      ▼
                              Agent C 读取历史
                              看到 A 和 B 的消息
```

### 通过 State 传递数据

```python
from typing import TypedDict, Annotated
import operator

class CommunicationState(TypedDict):
    # 消息历史自动追加
    messages: Annotated[list, operator.add]
    # 显式数据字段
    data_from_a: str
    data_from_b: str
    aggregated: str

# Agent A 产出数据
def agent_a(state: CommunicationState):
    result = {"data_from_a": "这是Agent A的研究结果"}
    return result

# Agent B 产出数据
def agent_b(state: CommunicationState):
    result = {"data_from_b": "这是Agent B的分析结果"}
    return result

# Agent C 消费 A 和 B 的数据
def agent_c(state: CommunicationState):
    a_data = state["data_from_a"]
    b_data = state["data_from_b"]
    
    return {"aggregated": f"A说: {a_data}\nB说: {b_data}"}
```

### 结果聚合策略

```python
# 策略1: 简单拼接
def aggregate_concat(state):
    results = [state["r1"], state["r2"], state["r3"]]
    return {"final": "\n".join(results)}

# 策略2: LLM 综合
def aggregate_llm(state):
    model = init_chat_model("moonshot:moonshot-v1-8k")
    response = model.invoke([
        SystemMessage("综合以下信息，生成一份连贯的报告。"),
        HumanMessage(
            f"来源1: {state['r1']}\n"
            f"来源2: {state['r2']}\n"
            f"来源3: {state['r3']}"
        ),
    ])
    return {"final": response.content}

# 策略3: 投票机制
def aggregate_vote(states):
    """多个 Agent 投票决定结果"""
    votes = {}
    for result in [states["r1"], states["r2"], states["r3"]]:
        # 简单计数投票
        votes[result] = votes.get(result, 0) + 1
    best = max(votes, key=votes.get)
    return {"final": best}
```

### 通信模式对比

| 模式 | 复杂度 | 适用场景 | 示例 |
|------|--------|---------|------|
| 共享消息 | ★☆☆ | 简单线性流程 | A → B → C 依次传递 |
| 共享字段 | ★★☆ | 部分数据共享 | 研究结果供多个Agent使用 |
| 显式传递 | ★★☆ | 控制数据流 | 指定字段在节点间传递 |
| LLM中介 | ★★★ | 需要理解上下文 | Supervisor 路由决策 |

## 完整项目：研究团队

构建一个由 Researcher + Writer + Reviewer 组成的研究团队。

### 项目架构

```
                    ┌─────────────────────┐
                    │      Editor         │
                    │  (主编/Supervisor)   │
                    │  决定下一步做什么     │
                    └──────────┬──────────┘
                               │
            ┌──────────────────┼──────────────────┐
            │                  │                  │
            ▼                  ▼                  ▼
      ┌───────────┐      ┌───────────┐      ┌───────────┐
      │Researcher │      │  Writer   │      │  Reviewer │
      │ (研究员)   │      │  (作家)    │      │  (审查员)  │
      │ 搜索+分析  │      │ 撰写报告   │      │ 质量检查   │
      └─────┬─────┘      └─────┬─────┘      └─────┬─────┘
            │                  │                  │
            │ tools:           │ tools:           │
            │ - search         │ - write_doc      │ - check_quality
            │ - analyze        │ - format         │ - suggest_fix
            ▼                  ▼                  ▼
      研究结果              报告草稿              审查意见
```

### 完整代码

```python
"""
研究团队多Agent协作系统
- Researcher: 负责搜索和整理信息
- Writer: 负责撰写报告
- Reviewer: 负责审查和改进
- Editor: 主编，协调整个流程
"""

from langchain.chat_models import init_chat_model
from langgraph.prebuilt import create_react_agent
from langgraph.graph import StateGraph, START, END
from langchain.messages import HumanMessage, SystemMessage
from langchain.tools import tool
from typing import TypedDict, Annotated, Literal
import operator
import json

# ============================================================
# 工具定义
# ============================================================

@tool
def search_web(query: str) -> str:
    """搜索互联网获取相关信息"""
    # 实际项目中可接入 SerpAPI、Tavily 等搜索服务
    mock_results = {
        "AI": "AI技术在2024年取得重大突破，大模型能力持续提升...",
        "Python": "Python 3.13 发布，性能提升25%，支持自由线程...",
        "LLM": "大语言模型市场规模预计2025年达到500亿美元...",
    }
    for key in mock_results:
        if key.lower() in query.lower():
            return mock_results[key]
    return f"搜索 '{query}' 的相关资料..."

@tool
def analyze_info(info: str) -> str:
    """分析信息的要点和趋势"""
    return f"分析结果: {info[:100]}... 关键趋势: 持续增长"

@tool
def write_document(title: str, content: str) -> str:
    """撰写并保存文档"""
    return f"文档 '{title}' 已创建，长度: {len(content)} 字"

@tool
def format_markdown(content: str) -> str:
    """格式化Markdown文档"""
    return f"# 格式化后的文档\n\n{content}"

@tool
def check_quality(content: str) -> str:
    """检查内容质量并给出建议"""
    issues = []
    if len(content) < 100:
        issues.append("内容过短，建议扩充")
    if "#" not in content:
        issues.append("缺少标题结构")
    if not issues:
        return "质量检查通过，内容良好"
    return f"发现以下问题: {'; '.join(issues)}"

# ============================================================
# 创建模型和子Agent
# ============================================================

model = init_chat_model("moonshot:moonshot-v1-8k")

# Researcher Agent
researcher = create_react_agent(
    model,
    tools=[search_web, analyze_info],
    name="researcher",
    prompt="你是一个资深研究员，负责搜索和分析信息。",
)

# Writer Agent
writer = create_react_agent(
    model,
    tools=[write_document, format_markdown],
    name="writer",
    prompt="你是一个专业作家，擅长撰写技术文档和报告。",
)

# Reviewer Agent
reviewer = create_react_agent(
    model,
    tools=[check_quality],
    name="reviewer",
    prompt="你是一个严格的审查员，负责检查内容质量并提出改进建议。",
)

# ============================================================
# 状态定义
# ============================================================

class ResearchTeamState(TypedDict):
    messages: Annotated[list, operator.add]
    topic: str                    # 研究主题
    research_findings: str        # 研究结果
    draft: str                    # 报告草稿
    review_feedback: str          # 审查意见
    final_report: str             # 最终报告
    next: str                     # 下一步执行的节点
    revision_count: int           # 修改次数

# ============================================================
# 节点实现
# ============================================================

def editor(state: ResearchTeamState):
    """主编：决定下一步由哪个角色执行"""
    
    # 检查当前进度
    has_research = bool(state["research_findings"])
    has_draft = bool(state["draft"])
    has_feedback = bool(state["review_feedback"])
    too_many_revisions = state["revision_count"] >= 3
    
    if not has_research:
        # 还没有研究结果 → 让 Researcher 工作
        decision = "researcher"
    elif not has_draft:
        # 有研究结果但没有草稿 → 让 Writer 工作
        decision = "writer"
    elif not has_feedback or too_many_revisions:
        # 有草稿但没有审查，或修改次数过多 → 完成
        decision = "finalize"
    else:
        # 有审查意见 → 根据意见决定谁修改
        if "研究" in state["review_feedback"] or "数据" in state["review_feedback"]:
            decision = "researcher"
        elif "写作" in state["review_feedback"] or "结构" in state["review_feedback"]:
            decision = "writer"
        else:
            decision = "finalize"
    
    return {"next": decision}

def route_from_editor(state: ResearchTeamState) -> Literal[
    "researcher_node", "writer_node", "reviewer_node", "finalize"
]:
    """根据 Editor 的决策路由"""
    mapping = {
        "researcher": "researcher_node",
        "writer": "writer_node",
        "reviewer": "reviewer_node",
        "finalize": "finalize",
    }
    return mapping.get(state["next"], "finalize")

def researcher_node(state: ResearchTeamState):
    """Researcher 执行研究工作"""
    result = researcher.invoke({
        "messages": [HumanMessage(
            f"请调研关于 '{state['topic']}' 的信息，"
            f"整理关键发现和趋势。"
        )]
    })
    return {
        "research_findings": result["messages"][-1].content,
        "next": "",
    }

def writer_node(state: ResearchTeamState):
    """Writer 撰写报告"""
    context = state["research_findings"]
    if state["review_feedback"]:
        context += f"\n\n审查意见: {state['review_feedback']}"
    
    result = writer.invoke({
        "messages": [HumanMessage(
            f"请基于以下资料撰写一份关于 '{state['topic']}' 的技术报告。\n\n"
            f"参考资料: {context}"
        )]
    })
    return {
        "draft": result["messages"][-1].content,
        "next": "",
        "review_feedback": "",  # 清空旧反馈
    }

def reviewer_node(state: ResearchTeamState):
    """Reviewer 审查报告"""
    result = reviewer.invoke({
        "messages": [HumanMessage(
            f"请审查以下报告草稿，指出问题并给出改进建议。\n\n"
            f"草稿内容: {state['draft']}"
        )]
    })
    return {
        "review_feedback": result["messages"][-1].content,
        "next": "",
        "revision_count": state["revision_count"] + 1,
    }

def finalize(state: ResearchTeamState):
    """主编最终整合"""
    response = model.invoke([
        SystemMessage(
            "你是主编，请基于研究资料和报告草稿，生成最终版本。"
            "如果审查意见有价值，请融入最终版本。"
        ),
        HumanMessage(
            f"主题: {state['topic']}\n\n"
            f"研究资料: {state['research_findings']}\n\n"
            f"报告草稿: {state['draft']}\n\n"
            f"审查意见: {state['review_feedback']}"
        ),
    ])
    return {
        "final_report": response.content,
        "next": "",
    }

# ============================================================
# 构建图
# ============================================================

graph = StateGraph(ResearchTeamState)

# 注册节点
graph.add_node("editor", editor)
graph.add_node("researcher_node", researcher_node)
graph.add_node("writer_node", writer_node)
graph.add_node("reviewer_node", reviewer_node)
graph.add_node("finalize", finalize)

# 边连接
graph.add_edge(START, "editor")
graph.add_conditional_edges("editor", route_from_editor)

# 各角色执行后回到 Editor
graph.add_edge("researcher_node", "editor")
graph.add_edge("writer_node", "editor")
graph.add_edge("reviewer_node", "editor")

# finalize 后结束
graph.add_edge("finalize", END)

# 编译
app = graph.compile()

# ============================================================
# 使用示例
# ============================================================

def run_research_team(topic: str):
    """运行研究团队"""
    result = app.invoke({
        "messages": [HumanMessage(f"请研究主题: {topic}")],
        "topic": topic,
        "research_findings": "",
        "draft": "",
        "review_feedback": "",
        "final_report": "",
        "next": "",
        "revision_count": 0,
    })
    return result["final_report"]

# 执行
if __name__ == "__main__":
    report = run_research_team("Python 在 AI 领域的应用趋势")
    print("=" * 60)
    print(report)
```

### 执行流程可视化

```
START
  │
  ▼
┌─────────┐
│ Editor  │  判断: 需要研究
└────┬────┘
     │
     ▼
┌─────────────┐
│ Researcher  │  搜索 "Python AI 应用"
│  search()   │  整理研究发现
│  analyze()  │
└─────┬───────┘
      │
      ▼
┌─────────┐
│ Editor  │  判断: 有研究了，需要写作
└────┬────┘
     │
     ▼
┌───────────┐
│  Writer   │  基于研究结果撰写报告
│  write()  │  格式化为Markdown
│  format() │
└─────┬─────┘
      │
      ▼
┌─────────┐
│ Editor  │  判断: 有草稿了，需要审查
└────┬────┘
     │
     ▼
┌─────────────┐
│  Reviewer   │  检查质量
│  check()    │  给出修改建议
└─────┬───────┘
      │
      ▼
┌─────────┐     有需要修改的?    ┌─────────────┐
│ Editor  │ ────────Yes──────▶ │ Writer/     │
│         │                     │ Researcher  │
│         │ ◀─────No────────── │ (修改后回到) │
└────┬────┘                     └─────────────┘
     │ No (或修改次数过多)
     ▼
┌───────────┐
│ Finalize  │  生成最终报告
└─────┬─────┘
      │
      ▼
     END
```

### 扩展：添加更多角色

```python
# 可以轻松添加新角色，如：
# - Data Analyst: 数据分析
# - Fact Checker: 事实核查
# - Translator: 翻译

@tool
def fact_check(content: str) -> str:
    """核实内容的准确性"""
    return f"事实核查完成，发现 2 处需要核实的数据"

fact_checker = create_react_agent(
    model,
    tools=[fact_check],
    name="fact_checker",
)

# 在 Editor 的路由逻辑中加入
def editor(state: ResearchTeamState):
    # ... 现有逻辑 ...
    
    # 添加事实检查
    if has_draft and not state.get("fact_checked"):
        return {"next": "fact_checker"}
```

## 常见错误

### 错误1：状态字段未初始化

```python
# ❌ 错误：直接访问未初始化的字段
def node(state):
    result = state["some_field"]  # KeyError!

# ✅ 正确：确保所有字段有初始值
result = app.invoke({
    "messages": [],
    "some_field": "",  # 初始化为空字符串
    "other_field": 0,  # 初始化为默认值
})
```

### 错误2：条件边返回无效节点名

```python
# ❌ 错误：返回的节点名不存在
def route(state):
    return "non_existent_node"  # 运行时报错

# ✅ 正确：使用 Literal 类型确保一致性
def route(state) -> Literal["a", "b", "c"]:
    return state["next"]  # 只返回已注册的节点名
```

### 错误3：并行节点互相依赖

```python
# ❌ 错误：A 需要 B 的结果，但又想并行
graph.add_edge(START, "a")
graph.add_edge(START, "b")
graph.add_edge("b", "a")  # 矛盾！

# ✅ 正确：明确依赖关系
graph.add_edge(START, "b")
graph.add_edge("b", "a")  # 先 B 后 A
```

### 错误4：消息列表无限增长

```python
# ❌ 错误：循环中消息不断累加
# messages: Annotated[list, operator.add]
# 每轮循环都追加消息，可能超出上下文窗口

# ✅ 正确：定期清理或限制消息数量
def trim_messages(state):
    # 只保留最近 N 条消息
    return {"messages": state["messages"][-10:]}
```

## 小结

| 要点 | 说明 |
|------|------|
| 四种模式 | Handoff（交接）、Supervisor（路由）、Hierarchical（层级）、Parallel（并行） |
| create_agent | 将 ReAct Agent 作为子图嵌入，工具隔离、独立循环 |
| Supervisor | 中心决策，动态路由，适合需要灵活调度的场景 |
| 层次化 | 模拟组织架构，适合大型复杂项目 |
| 状态管理 | 共享 vs 隔离，根据协作密度选择 |
| 并行执行 | 独立任务用并行，注意 API 配额 |
| 通信方式 | 消息传递、字段共享、LLM 中介 |
| 完整项目 | Researcher + Writer + Reviewer + Editor 协作流程 |
