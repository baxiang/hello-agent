# 02-LangGraph入门

本章介绍 LangGraph 的基础概念：状态图架构、节点、边、路由、运行时上下文和调试。

## 学习目标

- 理解 StateGraph 架构和三要素（State、Nodes、Edges）
- 掌握 TypedDict State 和 Reducers 的使用
- 学会节点函数的编写和调用 LLM/工具
- 理解普通边和条件边的路由机制
- 掌握 Send 和 Command 的高级路由方式
- 学会使用运行时上下文配置和递归限制
- 掌握可视化和调试技巧
- 独立完成一个多步骤数据处理管道

## 章节内容

| 序号 | 标题 | 内容 |
|------|------|------|
| 01 | 图基础概念 | StateGraph、三要素、Pregel、Super Step、compile、invoke/stream |
| 02 | State与Reducers | TypedDict、Annotated、add_messages、MessagesState、自定义 Reducer |
| 03 | Nodes节点 | 节点函数、LLM 调用、工具调用、错误处理、并行执行 |
| 04 | Edges路由 | START/END、普通边、条件边、路由映射、循环、并行汇合 |
| 05 | Send与Command | Send 并行分发、Command 状态+路由、Command.PARENT 子图返回 |
| 06 | 运行时上下文 | context_schema、recursion_limit、config metadata、checkpointer |
| 07 | 可视化与调试 | Mermaid 可视化、stream_mode、LangSmith 追踪、断点调试 |
| 08 | 入门实战 | 多步骤文章分析管道：清理 → 语言检测 → 关键词 → 情感 → 摘要 → 报告 |

## 核心概念速查

```
┌─────────────────────────────────────────────────────────────────┐
│                        LangGraph 架构                            │
│                                                                 │
│  StateGraph(State) ──→ 构建器                                    │
│      ├── add_node("name", func)                                  │
│      ├── add_edge(START, "name")                                 │
│      ├── add_edge("a", "b")                                      │
│      ├── add_conditional_edges("a", route_func, mapping)         │
│      └── compile() ──→ CompiledGraph                             │
│              ├── invoke({"key": "value"})                        │
│              └── stream({"key": "value"})                        │
│                                                                 │
│  State (TypedDict)                                              │
│      ├── messages: Annotated[list, add_messages]                 │
│      ├── count: Annotated[int, add]                              │
│      └── name: str  (默认覆盖)                                   │
│                                                                 │
│  Node (函数)                                                    │
│      def my_node(state: State) -> dict:                          │
│          return {"key": "value"}                                 │
│                                                                 │
│  Edge                                                           │
│      普通边:  add_edge("a", "b")                                 │
│      条件边:  add_conditional_edges("a", route_func, {...})      │
│                                                                 │
│  Command                                                        │
│      Command(update={"k": "v"}, goto="next_node")               │
│      Command(goto=Command.PARENT)  # 子图返回                    │
│      Command(goto=[Send("node", {"item": x})])                   │
└─────────────────────────────────────────────────────────────────┘
```

## 示例项目

`langgraph_basics/` - 简单工作流图示例

## 快速开始

```python
from typing import TypedDict
from langgraph.graph import StateGraph, START, END

class State(TypedDict):
    input: str
    output: str

def process(state: State) -> dict:
    return {"output": state["input"].upper()}

builder = StateGraph(State)
builder.add_node("process", process)
builder.add_edge(START, "process")
builder.add_edge("process", END)

graph = builder.compile()
result = graph.invoke({"input": "hello", "output": ""})
print(result["output"])  # HELLO
```
