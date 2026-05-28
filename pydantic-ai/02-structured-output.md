# 02 - 结构化输出：从字符串到业务对象

Pydantic AI 最重要的价值之一是结构化输出。LLM 不再只是返回一段文本，而是返回一个经过 Pydantic 校验的 Python 对象。

## 1. 为什么结构化输出重要

如果模型返回字符串：

```text
The customer is upset. Escalate: yes. Risk: high.
```

业务代码要自己解析：

```python
escalate = "Escalate: yes" in text
```

这很脆弱。模型可能改格式、漏字段、输出 markdown、混入解释。

结构化输出让你直接定义：

```python
from pydantic import BaseModel, Field


class TicketDecision(BaseModel):
    summary: str
    risk: str = Field(pattern="^(low|medium|high)$")
    escalate: bool
```

然后 Agent 返回：

```python
decision: TicketDecision = result.output
```

## 2. output_type

基本用法：

```python
from pydantic import BaseModel, Field
from pydantic_ai import Agent


class IncidentSummary(BaseModel):
    title: str = Field(max_length=120)
    severity: str = Field(pattern="^(sev1|sev2|sev3|sev4)$")
    likely_cause: str
    recommended_actions: list[str] = Field(min_length=1, max_length=5)


agent = Agent(
    "openai:gpt-5.2",
    output_type=IncidentSummary,
    system_prompt="Summarize incidents as structured operational reports.",
)
```

## 3. 字段设计

字段设计会直接影响模型稳定性。

好的字段：

```python
class ReviewFinding(BaseModel):
    severity: Literal["low", "medium", "high", "critical"]
    file_path: str
    line: int | None = None
    title: str
    explanation: str
    suggested_fix: str | None = None
```

差的字段：

```python
class ReviewFinding(BaseModel):
    data: dict
    info: str
```

原则：

- 字段名表达业务含义。
- enum 用 `Literal` 或约束字段。
- 列表设置合理长度。
- 可选字段要明确何时为空。
- 避免无限嵌套。
- 不要把大段 markdown 和结构化字段混在一个字段里。

## 4. 输出模式选择

常见输出类型：

```python
output_type=str
output_type=bool
output_type=list[str]
output_type=MyBaseModel
output_type=MyBaseModel | str
```

建议：

- 原型阶段可以用 `str`。
- 业务集成阶段用 `BaseModel`。
- 简单分类可用 `Literal` 或 bool。
- 多种可能结果可以用 union，但不要滥用。

## 5. 校验失败和重试

结构化输出不是要求模型永远一次成功，而是让失败可检测、可重试、可定位。

常见失败：

- 缺字段。
- 字段类型错。
- enum 值不合法。
- JSON 结构不匹配。
- 输出的是解释文本而不是结构化对象。

设计建议：

- schema 不要过于复杂。
- 错误提示要能帮助模型修正。
- 对关键字段加 Pydantic 约束。
- 对不可恢复错误返回给用户或进入人工流程。

## 6. 输出 schema 版本

生产系统要考虑输出 schema 演进。

```python
class SupportOutputV1(BaseModel):
    schema_version: Literal["1.0"] = "1.0"
    answer: str
    escalate: bool
```

当下游服务依赖输出字段时，建议：

- 输出对象带 schema version。
- 变更字段时写迁移逻辑。
- evals 覆盖旧 case。
- 日志记录输出 schema version。

## 7. Output 和 Tool 的区别

不要把结构化输出和工具调用混淆。

| 概念 | 作用 |
| --- | --- |
| Tool | 模型运行过程中请求外部信息或动作 |
| Output | 模型最终返回给调用方的业务结果 |

例如：

```text
Tool: get_customer_orders(customer_id)
Output: SupportAnswer(answer, risk, escalate)
```

工具结果是 Agent 思考和生成输出的材料；最终 output 是业务接口返回值。

## 8. 示例：代码审查输出

```python
from typing import Literal

from pydantic import BaseModel, Field


class Finding(BaseModel):
    severity: Literal["low", "medium", "high", "critical"]
    category: Literal["bug", "security", "performance", "maintainability"]
    file_path: str
    line: int | None = Field(default=None, ge=1)
    title: str = Field(max_length=120)
    explanation: str
    suggested_fix: str | None = None


class CodeReviewOutput(BaseModel):
    summary: str
    findings: list[Finding] = Field(max_length=20)
    safe_to_merge: bool
```

这个模型比“返回 markdown 报告”更适合：

- CI 阻断。
- PR 评论。
- 风险统计。
- 回归评估。
- 前端结构化展示。

## 9. 测试结构化输出

测试要覆盖：

- 正常输出能通过模型校验。
- 缺字段会失败。
- enum 错误会失败。
- 下游代码只依赖类型化字段。
- evals 检查输出质量，而不是只检查 JSON 格式。

示例：

```python
def test_review_output_schema_accepts_valid_data():
    output = CodeReviewOutput(
        summary="One issue found.",
        findings=[
            Finding(
                severity="high",
                category="security",
                file_path="src/auth.py",
                line=42,
                title="Missing token validation",
                explanation="The token signature is not verified.",
            )
        ],
        safe_to_merge=False,
    )

    assert output.findings[0].severity == "high"
```

## 10. 本章检查点

读完本章，你应该能：

- 用 Pydantic 模型定义 Agent 输出。
- 判断何时使用 `str`、`BaseModel`、list 或 union。
- 设计可维护的输出 schema。
- 区分 Tool 调用和最终 Output。
- 为结构化输出写基本测试。

