# 00 - 从 0 开始学习 Pydantic AI

Pydantic AI 是 Pydantic 团队开发的 Python 生成式 AI Agent 框架。它的核心思路是：用现代 Python 类型提示、Pydantic 校验和清晰的工程边界来构建生产级 Agent，而不是把 LLM 调用写成一堆字符串拼接和脆弱 JSON 解析。

一句话理解：

> Pydantic AI 把 Agent 开发变成类型化、可校验、可测试、可观测的 Python 工程问题。

## 1. 它解决什么问题

直接调用模型 SDK 时，常见问题是：

- 输出通常是字符串，需要自己解析。
- JSON 可能格式不稳定。
- 工具调用和业务代码耦合。
- prompt、依赖、外部 API、模型选择混在一起。
- 很难做单元测试和回归评估。
- 生产环境中难追踪成本、延迟、工具调用和失败原因。

Pydantic AI 的设计重点：

- 使用 `Agent` 封装一次特定类型的 LLM 对话。
- 使用 `output_type` 定义结构化输出。
- 使用 Pydantic 自动校验输出。
- 使用 tool 函数给模型提供外部能力。
- 使用 `RunContext` 和 `deps_type` 做类型安全的依赖注入。
- 使用 Logfire/OpenTelemetry 做可观测性。
- 使用 Pydantic Evals 做系统性评估。

## 2. 最小示例

```python
from pydantic import BaseModel, Field
from pydantic_ai import Agent


class SupportOutput(BaseModel):
    answer: str = Field(description="Answer shown to the user")
    escalate: bool = Field(description="Whether a human should review this")


agent = Agent(
    "openai:gpt-5.2",
    output_type=SupportOutput,
    system_prompt="You are a concise customer support assistant.",
)

result = agent.run_sync("My payment failed twice. What should I do?")

print(result.output.answer)
print(result.output.escalate)
```

这段代码体现了 Pydantic AI 的核心：

- Agent 有默认模型。
- prompt 是开发者定义的指令。
- 输出不是裸字符串，而是 `SupportOutput`。
- 模型输出会经过 Pydantic 校验。
- 调用方拿到的是类型化对象。

## 3. 和直接模型 SDK 的区别

直接 SDK 更像这样：

```python
response = client.responses.create(
    model="gpt-5.2",
    input="Return JSON with answer and escalate."
)
data = json.loads(response.output_text)
```

问题：

- JSON 解析失败要自己处理。
- 字段缺失要自己校验。
- retry 策略要自己写。
- 工具和依赖没有统一组织方式。
- 类型检查对业务输出帮助有限。

Pydantic AI 把这些问题变成框架层能力：

```python
result = agent.run_sync(prompt)
support_output: SupportOutput = result.output
```

## 4. 和 LangChain 类框架的区别

Pydantic AI 不是“越多组件越好”的编排框架。它更接近 FastAPI 的风格：

- 用普通 Python 函数定义工具。
- 用类型提示表达输入输出。
- 用 Pydantic 模型表达业务结果。
- 用依赖注入隔离外部系统。
- 把可观测性和评估纳入生产工程。

如果你的需求是搭一个复杂图工作流，可能会用到 `pydantic-graph` 或其他编排层；如果你的核心问题是“让一个 Agent 稳定地产生结构化结果并调用工具”，Pydantic AI 是更直接的入口。

## 5. 核心概念地图

```text
Agent
  |
  +-- model
  +-- instructions / system prompt
  +-- output_type
  +-- deps_type
  +-- tools
  +-- model settings
  +-- capabilities
  |
  v
Run
  |
  +-- prompt
  +-- deps
  +-- message history
  +-- tool calls
  +-- usage
  +-- output
```

## 6. 什么时候适合用 Pydantic AI

适合：

- Python 项目。
- 需要结构化输出。
- 希望类型检查和 IDE 提示能帮忙。
- 需要工具调用。
- 需要注入数据库、HTTP client、配置等依赖。
- 需要单元测试、evals 和可观测性。
- 需要对接多个模型供应商。

不一定适合：

- 只做一次性 prompt 实验。
- 完全不需要结构化输出。
- 主要工作是图形化低代码编排。
- 团队不使用 Python。

## 7. 包和安装

常用安装：

```bash
pip install pydantic-ai
```

或：

```bash
uv add pydantic-ai
```

如果只需要特定 provider 或更小依赖，可以关注官方文档中的 slim 版本和 extras。

## 8. 学习路线

建议按下面顺序学习：

1. 先写一个无工具、结构化输出的 Agent。
2. 给 Agent 增加 `output_type` 和 Pydantic 字段校验。
3. 增加一个只读工具。
4. 用 `deps_type` 注入配置或 mock 数据源。
5. 写单元测试，不调用真实模型。
6. 增加流式输出。
7. 接入 Logfire 或 OpenTelemetry。
8. 写 evals 做行为回归。
9. 接入 MCP 工具。
10. 设计生产安全和审批流程。

## 9. 官方参考

- Overview：https://pydantic.dev/docs/ai/overview/
- Installation：https://pydantic.dev/docs/ai/overview/install/
- Agents：https://pydantic.dev/docs/ai/core-concepts/agent/
- 官方仓库：https://github.com/pydantic/pydantic-ai

