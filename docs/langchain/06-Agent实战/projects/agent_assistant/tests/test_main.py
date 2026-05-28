from app.main import create_assistant


def test_create_assistant():
    agent = create_assistant()
    assert agent is not None


def test_tools_defined():
    from app.main import calculate, get_time, search

    time_result = get_time.invoke({})
    assert len(time_result) > 0

    calc_result = calculate.invoke({"expression": "1+1"})
    assert calc_result == "2"

    search_result = search.invoke({"query": "test"})
    assert "test" in search_result
