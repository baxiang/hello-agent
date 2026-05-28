from app.main import create_graph, run_workflow


def test_create_graph():
    graph = create_graph()
    assert graph is not None


def test_run_workflow_uppercase():
    result = run_workflow("UPPERCASE test")
    assert "UPPERCASE TEST" in result


def test_run_workflow_lowercase():
    result = run_workflow("normal text")
    assert "normal text" in result
