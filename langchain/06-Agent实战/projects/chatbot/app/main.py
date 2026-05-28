from langchain.messages import HumanMessage
from langchain_openai import ChatOpenAI
from langgraph.checkpoint.memory import MemorySaver
from langgraph.graph import END, START, MessagesState, StateGraph


def chat_node(state: MessagesState):
    model = ChatOpenAI(
        model="moonshot-v1-8k",
        openai_api_base="https://api.moonshot.cn/v1",
        openai_api_key="${MOONSHOT_API_KEY}",
    )
    response = model.invoke(state["messages"])
    return {"messages": [response]}


def create_chatbot():
    builder = StateGraph(MessagesState)
    builder.add_node("chat", chat_node)
    builder.add_edge(START, "chat")
    builder.add_edge("chat", END)

    checkpointer = MemorySaver()
    return builder.compile(checkpointer=checkpointer)


def chat(message: str, thread_id: str = "default") -> str:
    graph = create_chatbot()
    config = {"configurable": {"thread_id": thread_id}}

    result = graph.invoke({"messages": [HumanMessage(message)]}, config)
    return result["messages"][-1].content


def stream_chat(message: str, thread_id: str = "default"):
    graph = create_chatbot()
    config = {"configurable": {"thread_id": thread_id}}

    for chunk in graph.stream(
        {"messages": [HumanMessage(message)]}, config, stream_mode="updates"
    ):
        if "chat" in chunk:
            yield chunk["chat"]["messages"][-1].content


def main():
    print("=== 对话机器人 ===")
    print("支持多轮对话和流式输出\n")

    thread_id = "user-session"

    print("用户: 你好")
    print("助手: ", end="")
    for text in stream_chat("你好", thread_id):
        print(text, end="", flush=True)
    print("\n")

    print("用户: 我是谁？")
    print("助手: ", end="")
    for text in stream_chat("我们之前聊过什么？", thread_id):
        print(text, end="", flush=True)
    print("\n")


if __name__ == "__main__":
    main()
