from typing import Literal, TypedDict

from langgraph.graph import END, START, StateGraph


class State(TypedDict):
    input: str
    processed: str
    output: str


def uppercase_node(state: State) -> dict:
    return {"processed": state["input"].upper()}


def lowercase_node(state: State) -> dict:
    return {"processed": state["input"].lower()}


def route_input(state: State) -> Literal["uppercase", "lowercase"]:
    if state["input"].startswith("UP"):
        return "uppercase"
    return "lowercase"


def format_node(state: State) -> dict:
    return {"output": f"结果: {state['processed']}"}


def create_graph():
    builder = StateGraph(State)
    builder.add_node("uppercase", uppercase_node)
    builder.add_node("lowercase", lowercase_node)
    builder.add_node("format", format_node)

    builder.add_edge(START, "uppercase")
    builder.add_conditional_edges("uppercase", route_input)
    builder.add_edge("lowercase", "format")
    builder.add_edge("format", END)

    return builder.compile()


def run_workflow(input_text: str) -> str:
    graph = create_graph()
    result = graph.invoke({"input": input_text, "processed": "", "output": ""})
    return result["output"]


def main():
    print("=== LangGraph 工作流示例 ===")

    result1 = run_workflow("UPPERCASE test")
    print(f"输入 'UPPERCASE test': {result1}")

    result2 = run_workflow("normal text")
    print(f"输入 'normal text': {result2}")


if __name__ == "__main__":
    main()
