from langchain.chat_models import init_chat_model
from langchain.messages import HumanMessage, SystemMessage


def create_chat(system_prompt: str = "你是一个友好的助手"):
    model = init_chat_model("moonshot:moonshot-v1-8k")
    messages = [SystemMessage(system_prompt)]
    return model, messages


def chat(model, messages, user_input: str) -> str:
    messages.append(HumanMessage(user_input))
    response = model.invoke(messages)
    messages.append(response)
    return response.content


def main():
    model, messages = create_chat(
        system_prompt="你是一个 Python 学习助手。回答简洁易懂，适合初学者。"
    )

    print("=== Python 学习助手 ===")
    print("输入问题开始对话，输入 'quit' 退出\n")

    while True:
        user_input = input("你: ").strip()
        if user_input.lower() == "quit":
            break

        response = chat(model, messages, user_input)
        print(f"\n助手: {response}\n")

    print("\n=== 对话结束 ===")
    for m in messages:
        role = m.__class__.__name__.replace("Message", "")
        print(f"{role}: {m.content[:80]}...")


if __name__ == "__main__":
    main()
