from typing import TypedDict

from langgraph.checkpoint.memory import MemorySaver
from langgraph.graph import END, START, StateGraph
from langgraph.types import Command, interrupt


class State(TypedDict):
    action: str
    status: str
    approved: bool


def request_node(state: State) -> dict:
    return {"status": "pending"}


def approval_node(state: State) -> Command:
    answer = interrupt(
        {
            "question": "是否批准此操作？",
            "action": state["action"],
        }
    )

    if answer:
        return Command(goto="execute", update={"approved": True})
    return Command(goto="cancel", update={"approved": False})


def execute_node(state: State) -> dict:
    return {"status": "completed"}


def cancel_node(state: State) -> dict:
    return {"status": "cancelled"}


def create_approval_graph():
    builder = StateGraph(State)
    builder.add_node("request", request_node)
    builder.add_node("approval", approval_node)
    builder.add_node("execute", execute_node)
    builder.add_node("cancel", cancel_node)

    builder.add_edge(START, "request")
    builder.add_edge("request", "approval")
    builder.add_edge("execute", END)
    builder.add_edge("cancel", END)

    checkpointer = MemorySaver()
    return builder.compile(checkpointer=checkpointer)


def run_approval(action: str, approve: bool) -> str:
    graph = create_approval_graph()
    config = {"configurable": {"thread_id": "test-session"}}

    result = graph.invoke({"action": action, "status": "", "approved": False}, config)

    if "__interrupt__" in result:
        result = graph.invoke(Command(resume=approve), config)

    return result["status"]


def main():
    print("=== 审批流程示例 ===")

    result1 = run_approval("转账100元", True)
    print(f"转账100元 (批准): {result1}")

    result2 = run_approval("删除数据", False)
    print(f"删除数据 (拒绝): {result2}")


if __name__ == "__main__":
    main()
