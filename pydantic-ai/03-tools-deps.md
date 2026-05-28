# 03 - Tools 与 Dependencies：让 Agent 安全访问外部世界

Agent 只靠模型参数和 prompt 很快会到边界。它需要查数据库、读配置、调 API、检索文档。Pydantic AI 用 function tools 和依赖注入来组织这些能力。

## 1. Function tools

Tool 是模型可以调用的 Python 函数。

```python
from pydantic_ai import Agent

agent = Agent(
    "openai:gpt-5.2",
    system_prompt="Use tools when you need customer data.",
)


@agent.tool_plain
def get_order_status(order_id: str) -> str:
    """Return the shipping status for one order ID."""
    return "shipped"
```

工具定义里的类型提示和 docstring 很重要：

- 类型提示用于生成参数 schema。
- docstring 帮模型理解何时调用。
- 函数名要表达动作。

## 2. tool 和 tool_plain

常见两类工具：

- 不需要运行上下文：`tool_plain`。
- 需要访问依赖、usage、model 等运行上下文：`tool`。

`tool_plain`：

```python
@agent.tool_plain
def normalize_email(email: str) -> str:
    """Normalize an email address."""
    return email.strip().lower()
```

`tool`：

```python
from pydantic_ai import RunContext


@agent.tool
async def get_customer_plan(ctx: RunContext["SupportDeps"]) -> str:
    """Return the current customer's subscription plan."""
    return ctx.deps.plan
```

## 3. Dependencies

依赖是运行时传给 Agent 的外部对象。它可以是 dataclass、Pydantic model、普通对象或协议接口。

```python
from dataclasses import dataclass


@dataclass
class SupportDeps:
    customer_id: str
    plan: str
    orders: dict[str, str]
```

Agent 声明依赖类型：

```python
agent = Agent(
    "openai:gpt-5.2",
    deps_type=SupportDeps,
    output_type=str,
)
```

运行时传入：

```python
deps = SupportDeps(
    customer_id="cus_123",
    plan="pro",
    orders={"ord_1": "shipped"},
)

result = agent.run_sync("Where is order ord_1?", deps=deps)
```

## 4. RunContext

`RunContext` 是工具函数访问当前运行信息的入口。

常用：

- `ctx.deps`：运行时依赖。
- `ctx.model`：当前模型。
- `ctx.usage`：当前用量信息。
- `ctx.agent`：当前 Agent。

示例：

```python
@agent.tool
async def get_order_status(ctx: RunContext[SupportDeps], order_id: str) -> str:
    """Return the status of a customer order."""
    status = ctx.deps.orders.get(order_id)
    if status is None:
        return "order not found"
    return status
```

## 5. 依赖注入的价值

不要在工具里这样写：

```python
@agent.tool_plain
def search_docs(query: str) -> str:
    client = RealSearchClient(api_key=os.environ["SEARCH_API_KEY"])
    return client.search(query)
```

更好的方式：

```python
from typing import Protocol


class SearchClient(Protocol):
    async def search(self, query: str) -> list[str]:
        ...


@dataclass
class DocsDeps:
    search_client: SearchClient


@agent.tool
async def search_docs(ctx: RunContext[DocsDeps], query: str) -> list[str]:
    """Search internal documentation."""
    return await ctx.deps.search_client.search(query)
```

好处：

- 测试可以传 fake client。
- 生产可以传真实 client。
- 工具函数不负责读取环境变量。
- 权限和认证可在依赖层集中处理。

## 6. 工具设计原则

好的工具：

- 只做一件事。
- 参数少而明确。
- 默认只读。
- 输出简洁。
- 错误可理解。
- 不泄露 secret。

差的工具：

```python
@agent.tool_plain
def execute(action: str, payload: dict) -> dict:
    """Execute anything."""
    ...
```

好的工具：

```python
@agent.tool
async def search_customer_orders(
    ctx: RunContext[SupportDeps],
    query: str,
    max_results: int = 5,
) -> list[str]:
    """Search the current customer's order history by short query."""
    ...
```

## 7. 副作用和审批

工具分两类：

| 类型 | 示例 | 策略 |
| --- | --- | --- |
| 只读 | search_docs、get_order_status | 通常可自动调用 |
| 有副作用 | refund_order、send_email、create_ticket | 需要权限和审批 |

有副作用工具要考虑：

- 参数确认。
- 幂等 key。
- 审计日志。
- 用户权限。
- 回滚或补偿。

## 8. 测试工具和依赖

Fake client：

```python
class FakeSearchClient:
    async def search(self, query: str) -> list[str]:
        return [f"fake result for {query}"]
```

测试工具：

```python
def test_search_client_fake():
    deps = DocsDeps(search_client=FakeSearchClient())
    assert deps.search_client is not None
```

完整 Agent 测试可以使用 Pydantic AI 的测试模型或自定义模型替身，避免真实 LLM 调用。

## 9. 工具结果设计

工具返回给模型，不一定直接给用户。要做到：

- 结果短而准。
- 必要时返回结构化对象。
- 大结果分页或摘要。
- 错误说明清楚。
- 不返回完整敏感数据。

示例：

```python
class OrderStatus(BaseModel):
    order_id: str
    status: Literal["pending", "shipped", "delivered", "canceled"]
    expected_delivery: str | None = None
```

## 10. 本章检查点

读完本章，你应该能：

- 定义 plain tool 和 context tool。
- 用 `deps_type` 和 `RunContext` 注入外部服务。
- 解释为什么依赖注入让测试更简单。
- 区分只读工具和有副作用工具。
- 设计一个可测试、权限清晰的工具层。

