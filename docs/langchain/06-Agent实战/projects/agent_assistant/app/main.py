import datetime

from langchain.agents import create_agent
from langchain.tools import tool


@tool
def get_time() -> str:
    """获取当前时间"""
    return datetime.datetime.now().strftime("%H:%M:%S")


@tool
def calculate(expression: str) -> str:
    """计算数学表达式"""
    try:
        result = eval(expression)
        return str(result)
    except Exception as e:
        return f"计算错误: {e}"


@tool
def search(query: str) -> str:
    """搜索信息（模拟）"""
    return f"关于 '{query}' 的搜索结果"


def create_assistant():
    return create_agent(
        model="moonshot:moonshot-v1-8k",
        tools=[get_time, calculate, search],
        system_prompt="你是一个智能助手，可以使用工具来帮助用户。",
    )


def run_assistant(question: str) -> str:
    agent = create_assistant()
    result = agent.invoke({"messages": [{"role": "user", "content": question}]})
    return result["messages"][-1].content


def main():
    print("=== Agent 助手 ===")

    questions = [
        "现在几点？",
        "计算 25 * 4",
        "搜索 Python",
    ]

    for q in questions:
        print(f"用户: {q}")
        answer = run_assistant(q)
        print(f"助手: {answer}\n")


if __name__ == "__main__":
    main()
