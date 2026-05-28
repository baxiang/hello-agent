from app.main import chat, create_chatbot


def test_create_chatbot():
    graph = create_chatbot()
    assert graph is not None


def test_chat_returns_response():
    response = chat("测试问题", thread_id="test")
    assert len(response) > 0
