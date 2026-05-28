from app.main import create_calculator_agent


def test_create_agent():
    agent = create_calculator_agent()
    assert agent is not None


def test_tools_defined():
    from app.main import calculate, get_current_time

    time_result = get_current_time.invoke({})
    assert len(time_result) > 0

    calc_result = calculate.invoke({"expression": "2+3"})
    assert calc_result == "5"
