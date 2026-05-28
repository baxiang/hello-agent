from typing import Literal, TypedDict

from langchain_openai import ChatOpenAI
from langgraph.graph import END, START, StateGraph
from langgraph.types import Command


class State(TypedDict):
    task: str
    result: str
    agent: str


def supervisor(state: State) -> Command[Literal["search_agent", "calc_agent", END]]:
    if "搜索" in state["task"]:
        return Command(goto="search_agent", update={"agent": "search"})
    elif "计算" in state["task"]:
        return Command(goto="calc_agent", update={"agent": "calc"})
    return Command(goto=END)


def search_agent(state: State) -> dict:
    model = ChatOpenAI(
        model="moonshot-v1-8k",
        openai_api_base="https://api.moonshot.cn/v1",
        openai_api_key="${MOONSHOT_API_KEY}",
    )
    response = model.invoke(f"搜索: {state['task']}")
    return {"result": response.content}


def calc_agent(state: State) -> dict:
    model = ChatOpenAI(
        model="moonshot-v1-8k",
        openai_api_base="https://api.moonshot.cn/v1",
        openai_api_key="${MOONSHOT_API_KEY}",
    )
    response = model.invoke(f"计算: {state['task']}")
    return {"result": response.content}


def create_multi_agent():
    builder = StateGraph(State)
    builder.add_node("supervisor", supervisor)
    builder.add_node("search_agent", search_agent)
    builder.add_node("calc_agent", calc_agent)

    builder.add_edge(START, "supervisor")
    builder.add_edge("search_agent", END)
    builder.add_edge("calc_agent", END)

    return builder.compile()


def run_multi_agent(task: str) -> str:
    graph = create_multi_agent()
    result = graph.invoke({"task": task, "result": "", "agent": ""})
    return result["result"]


def main():
    print("=== 多 Agent 系统 ===")

    tasks = [
        "搜索 Python 教程",
        "计算 100 + 200",
        "普通问题",
    ]

    for task in tasks:
        print(f"任务: {task}")
        result = run_multi_agent(task)
        print(f"结果: {result}\n")


if __name__ == "__main__":
    main()
