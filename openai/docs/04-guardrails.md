# 护栏（Guardrails）

Guardrails 是 OpenAI Agents SDK 的安全机制——在 Agent 处理输入和输出时进行安全检查，触发条件时可中断执行。

## 1. 两种护栏类型

| 类型 | 触发时机 | 用途 |
|------|---------|------|
| Input Guardrail | 用户输入进入 Agent 之前 | 检查输入安全性、合规性 |
| Output Guardrail | Agent 生成输出之后 | 检查输出质量、内容安全 |

## 2. Input Guardrail

```python
from agents import (
    Agent, Runner, GuardrailFunctionOutput,
    input_guardrail, RunContextWrapper,
)
from pydantic import BaseModel

class SafetyCheck(BaseModel):
    is_safe: bool
    reason: str

@input_guardrail
async def content_filter(
    ctx: RunContextWrapper[None],
    agent: Agent,
    input_data: str | list,
) -> GuardrailFunctionOutput:
    """检查用户输入是否包含不安全内容"""
    text = input_data if isinstance(input_data, str) else str(input_data)
    blocked_terms = ["hack", "exploit", "malware"]

    for term in blocked_terms:
        if term in text.lower():
            return GuardrailFunctionOutput(
                output_info=SafetyCheck(is_safe=False, reason=f"Blocked term: {term}"),
                tripwire_triggered=True,  # 触发中断
            )

    return GuardrailFunctionOutput(
        output_info=SafetyCheck(is_safe=True, reason=""),
        tripwire_triggered=False,
    )

agent = Agent(
    name="safe_agent",
    model="gpt-4o",
    input_guardrails=[content_filter],
)
```

### tripwire_triggered 的行为

- `False`：正常通过，继续执行
- `True`：中断执行，抛出 `InputGuardrailTripwireTriggered` 异常
- 异常中包含 `guardrail_result.output_info` 供上层处理

## 3. Output Guardrail

```python
from agents import output_guardrail

@output_guardrail
async def output_quality(
    ctx: RunContextWrapper[None],
    agent: Agent,
    output: str,
) -> GuardrailFunctionOutput:
    """检查 Agent 输出质量"""
    if len(output) < 10:
        return GuardrailFunctionOutput(
            output_info={"issue": "too_short"},
            tripwire_triggered=True,
        )

    if "I don't know" in output and len(output) < 50:
        return GuardrailFunctionOutput(
            output_info={"issue": "unhelpful_response"},
            tripwire_triggered=True,
        )

    return GuardrailFunctionOutput(
        output_info={"quality": "ok"},
        tripwire_triggered=False,
    )

agent = Agent(
    name="quality_agent",
    output_guardrails=[output_quality],
)
```

## 4. 多个护栏组合

```python
agent = Agent(
    name="secure_agent",
    input_guardrails=[
        content_filter,      # 内容过滤
        prompt_injection,    # 提示注入检测
        rate_limiter,        # 频率限制
    ],
    output_guardrails=[
        output_quality,      # 输出质量
        sensitive_data_check, # 敏感信息检查
        length_check,        # 长度检查
    ],
)
```

护栏按**列表顺序**执行：第一个触发 `tripwire_triggered=True` 的护栏会中断，后续不再执行。

## 5. 工具级护栏

```python
from agents import function_tool, ToolGuardrailFunctionOutput, tool_output_guardrail

@tool_output_guardrail
async def validate_search_result(
    ctx, agent, tool, output: str,
) -> ToolGuardrailFunctionOutput:
    """每个工具调用完成后检查结果"""
    if "error" in output.lower():
        return ToolGuardrailFunctionOutput(
            output_info={"status": "error_detected"},
            tripwire_triggered=False,  # 记录但不中断
            output_override="An error occurred. Please try a different query.",
        )

    return ToolGuardrailFunctionOutput(
        output_info={"status": "ok"},
        tripwire_triggered=False,
    )

@function_tool(output_guardrails=[validate_search_result])
def search(query: str) -> str:
    return f"Results for {query}"
```

## 6. 护栏异常处理

```python
from agents import InputGuardrailTripwireTriggered, OutputGuardrailTripwireTriggered

try:
    result = await Runner.run(agent, user_input)
except InputGuardrailTripwireTriggered as e:
    print(f"Input blocked: {e.guardrail_result.output_info}")
    # 返回安全提示给用户
    return "Your request was blocked for safety reasons."
except OutputGuardrailTripwireTriggered as e:
    print(f"Output blocked: {e.guardrail_result.output_info}")
    return "The response was blocked. Please rephrase your question."
```

## 7. 常见护栏模式

### PII 检测

```python
@input_guardrail
async def detect_pii(ctx, agent, input_data):
    text = str(input_data)
    patterns = {
        "email": r"\b[\w.-]+@[\w.-]+\.\w+\b",
        "phone": r"\b\d{3}[-.]?\d{3}[-.]?\d{4}\b",
        "ssn": r"\b\d{3}-\d{2}-\d{4}\b",
    }
    for name, pattern in patterns.items():
        if re.search(pattern, text):
            return GuardrailFunctionOutput(
                output_info={"type": name, "message": f"PII detected: {name}"},
                tripwire_triggered=True,
            )
    return GuardrailFunctionOutput(output_info={}, tripwire_triggered=False)
```

### 主题限制

```python
ALLOWED_TOPICS = ["weather", "sports", "news", "technology"]

@input_guardrail
async def topic_filter(ctx, agent, input_data):
    text = str(input_data).lower()
    if not any(topic in text for topic in ALLOWED_TOPICS):
        return GuardrailFunctionOutput(
            output_info={"blocked": True},
            tripwire_triggered=True,
        )
    return GuardrailFunctionOutput(output_info={}, tripwire_triggered=False)
```

## 8. 常见问题

**Q：护栏和 LangChain Guardrails 有什么区别？**

A：OpenAI Agents SDK 的护栏是**原生内置**的——不需要额外库。LangChain Guardrails 是独立包，需要单独集成。

**Q：护栏可以异步调用外部服务吗？**

A：可以。护栏函数是 `async` 的，可以调用 HTTP API 做远程安全检查。

**Q：tripwire_triggered=False 时 output_info 有什么用？**

A：会记录在 trace 中，用于后续分析和审计。触发条件时也可用于日志。
