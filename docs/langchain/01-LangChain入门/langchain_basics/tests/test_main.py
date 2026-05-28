from langchain.messages import AIMessage, HumanMessage, SystemMessage

from app.main import chat, create_chat


def test_create_chat():
    model, messages = create_chat()
    assert len(messages) == 1
    assert isinstance(messages[0], SystemMessage)


def test_chat_adds_messages():
    model, messages = create_chat()
    initial_len = len(messages)

    response = chat(model, messages, "测试问题")
    assert len(messages) == initial_len + 2
    assert isinstance(messages[-2], HumanMessage)
    assert isinstance(messages[-1], AIMessage)
    assert response == messages[-1].content
