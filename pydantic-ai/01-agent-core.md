# 01 - Agent 核心：模型、指令、运行方式和消息历史

`Agent` 是 Pydantic AI 的主入口。它不是简单的 prompt 字符串，而是一个可复用的类型化容器：里面放模型、指令、输出类型、依赖类型、工具、模型设置和可组合能力。

## 1. Agent 是什么

概念上可以把 `Agent` 看成：

```text
Agent[DepsT, OutputT]
  |
  +-- default model
  +-- developer instructions
  +-- output type
  +-- dependency type
  +-- tools
  +-- model settings
  +-- capabilities
```

类型参数的意义：

- `DepsT`：运行时依赖类型。
- `OutputT`：最终输出类型。

例如：

```python
from dataclasses import dataclass

from pydantic import BaseModel
from pydantic_ai import Agent


@dataclass
class SupportDeps:
    customer_id: str
    plan: str


class SupportOutput(BaseModel):
    answer: str
    escalate: bool


support_agent = Agent(
    "openai:gpt-5.2",
    deps_type=SupportDeps,
    output_type=SupportOutput,
    system_prompt="Answer support questions using the provided customer context.",
)
```

## 2. 模型选择

Pydantic AI 使用字符串或模型对象配置模型。常见字符串形态：

```python
Agent("openai:gpt-5.2")
Agent("anthropic:claude-sonnet-4-5")
Agent("google-gla:gemini-2.5-pro")
```

设计建议：

- 简单项目可以在 Agent 构造时指定默认模型。
- 生产项目建议把模型名放配置里。
- 测试时不要依赖真实模型。
- 不要在工具函数里偷偷调用另一个模型，除非这是明确设计。

## 3. Instructions / system prompt

指令描述 Agent 的角色和行为边界。

差的指令：

```python
system_prompt="You are helpful."
```

更好的指令：

```python
system_prompt=(
    "You are a customer support assistant. "
    "Answer using the available tools and return SupportOutput. "
    "Set escalate=true when the user asks about billing disputes, refunds, "
    "legal complaints, or account security."
)
```

原则：

- 写清楚角色。
- 写清楚何时使用工具。
- 写清楚何时升级或拒绝。
- 不要把大量业务数据硬编码进 prompt。
- 动态数据通过 deps 或 tools 提供。

## 4. 运行方式

常见运行方式：

```python
result = agent.run_sync("用户问题")
```

异步运行：

```python
result = await agent.run("用户问题")
```

流式或迭代运行通常用于更细粒度控制，例如展示模型输出、工具调用进度或调试 Agent run 节点。

## 5. RunResult

一次运行通常会得到 result 对象。你最常用的是：

```python
result.output
```

同时还要关注：

- 消息历史。
- token 或用量。
- 工具调用轨迹。
- 运行错误。

生产系统不要只存最终文本。至少记录：

- request id。
- user id。
- agent name。
- model。
- usage。
- tool calls。
- output schema version。

## 6. Agent 复用

Agent 设计上适合复用，类似 FastAPI app 或 router。

推荐：

```python
# agents/support.py
support_agent = Agent(...)
```

然后在 API 层调用：

```python
result = await support_agent.run(prompt, deps=deps)
```

不要每个请求都临时拼一个完全不同的 Agent，除非确实需要动态能力。频繁动态创建会让行为难测试、难观测。

## 7. 消息历史

多轮对话需要处理历史。工程上要注意：

- 历史不是越多越好。
- 外部工具结果要标注来源。
- 敏感信息不要长期保留。
- 历史结构要跨 provider 可复用时，避免依赖某个模型私有格式。

常见策略：

```text
User message
  -> Agent run
  -> Store new messages
  -> Next run receives selected history
```

## 8. 模型设置

模型设置通常包括：

- temperature。
- max tokens。
- timeout。
- top_p。
- provider-specific options。

建议：

- 把默认设置放 Agent。
- 把实验性设置放配置。
- evals 中固定关键设置，减少波动。
- 对高风险输出降低随机性。

## 9. Agent 设计清单

创建 Agent 前先回答：

1. 这个 Agent 的单一职责是什么？
2. 它的输出类型是什么？
3. 它需要哪些依赖？
4. 它有哪些工具？
5. 哪些工具只读，哪些有副作用？
6. 是否需要流式？
7. 是否需要 human approval？
8. 如何测试？
9. 如何记录和评估？

## 10. 本章检查点

读完本章，你应该能：

- 解释 `Agent[DepsT, OutputT]` 的含义。
- 判断 Agent 应该全局复用还是动态创建。
- 区分指令、依赖、工具和消息历史。
- 设计一个职责清晰的 Agent。
- 知道运行结果里除了 `output` 还应关注哪些信息。

