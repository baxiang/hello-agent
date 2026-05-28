import datetime

from langchain.agents import create_agent
from langchain.tools import tool


@tool
def get_current_time() -> str:
    """获取当前时间"""
    return datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S")


@tool
def calculate(expression: str) -> str:
    """计算数学表达式，如 '2+3' 或 '10*5'"""
    try:
        result = eval(expression)
        return str(result)
    except Exception as e:
        return f"计算错误: {e}"


def create_calculator_agent():
    return create_agent(
        model="moonshot:moonshot-v1-8k",
        tools=[get_current_time, calculate],
        system_prompt="你是一个智能助手，可以使用工具来回答问题。",
    )


def run_agent(question: str) -> str:
    agent = create_calculator_agent()
    result = agent.invoke({"messages": [{"role": "user", "content": question}]})
    return result["messages"][-1].content


def main():
    print("=== Agent 计算助手 ===")
    print("可以问时间或计算数学表达式\n")

    questions = [
        "现在几点？",
        "计算 25 + 17",
        "3小时后是几点？",
    ]

    for q in questions:
        print(f"问题: {q}")
        answer = run_agent(q)
        print(f"回答: {answer}\n")


if __name__ == "__main__":
    main()
