from app.main import create_multi_agent


def test_create_multi_agent():
    graph = create_multi_agent()
    assert graph is not None
