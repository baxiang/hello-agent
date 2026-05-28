from app.main import create_approval_graph, run_approval


def test_create_graph():
    graph = create_approval_graph()
    assert graph is not None


def test_approval_approved():
    result = run_approval("测试操作", True)
    assert result == "completed"


def test_approval_rejected():
    result = run_approval("测试操作", False)
    assert result == "cancelled"
