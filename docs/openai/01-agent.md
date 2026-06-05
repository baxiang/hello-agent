# Agent 核心

Agent 是 OpenAI Agents SDK 的核心抽象——一个 LLM + 指令 + 工具 + 护栏 + 转移目标的组合体。

## 1. 创建 Agent

```python
from agents import Agent

agent = Agent(
    name="assistant",
    model="gpt-4o",
    instructions="You are a helpful assistant.",
)
```

## 2. Agent 配置全览

| 参数 | 类型 | 说明 |
|------|------|------|
| `name` | `str` | Agent 唯一标识 |
| `model` | `str \| Model` | 模型名称或 Model 实例 |
| `instructions` | `str \| Callable` | 静态指令或动态生成函数 |
| `tools` | `list[Tool]` | 可用工具列表 |
| `handoffs` | `list[Handoff\|Agent]` | 可转移到的目标 Agent |
| `handoff_description` | `str` | 提供给父 Agent 的 handoff 描述 |
| `output_type` | `type[BaseModel]` | 结构化输出 Pydantic 类型 |
| `input_guardrails` | `list[InputGuardrail]` | 输入安全检查器 |
| `output_guardrails` | `list[OutputGuardrail]` | 输出安全检查器 |
| `mcp_servers` | `list[MCPServer]` | MCP 工具服务器 |
| `tool_use_behavior` | `str` | 工具调用策略 |
| `model_settings` | `ModelSettings` | 温度、top_p、max_tokens 等 |

## 3. 动态指令

```python
from agents import Agent, RunContextWrapper

def dynamic_instructions(ctx: RunContextWrapper[None], agent: Agent[None]) -> str:
    """根据运行时上下文生成指令"""
    return f"You are a helpful assistant. Current date: {datetime.now().date()}"

agent = Agent(
    name="assistant",
    instructions=dynamic_instructions,
)
```

## 4. 运行 Agent

```python
from agents import Agent, Runner
import asyncio

async def main():
    agent = Agent(name="assistant", model="gpt-4o")
    result = await Runner.run(agent, "Hello, who are you?")
    print(result.final_output)
    # "Hello! I'm an AI assistant..."

asyncio.run(main())
```

### 带会话的运行

```python
# 同一会话中多次对话，自动管理历史
result1 = await Runner.run(agent, "My name is Alice", session_id="s1")
result2 = await Runner.run(agent, "What is my name?", session_id="s1")
print(result2.final_output)  # "Your name is Alice."
```

## 5. 流式运行

```python
from agents import Runner

async def stream_example():
    agent = Agent(name="streamer", model="gpt-4o")
    result = Runner.run_streamed(agent, "Tell me a story")

    async for event in result.stream_events():
        if event.type == "raw_response_event":
            # 逐 token 的原始响应
            print(event.data.delta, end="", flush=True)
        elif event.type == "agent_updated":
            # Agent 发生 handoff 切换
            print(f"\n[Switched to {event.data.agent.name}]")
        elif event.type == "run_item_stream_event":
            # 工具调用 / handoff / guardrail 结果
            item = event.item
            if item.type == "tool_call_item":
                print(f"\n[Calling tool: {item.raw_item.name}]")
```

### StreamEvent 类型速查

| 类型 | 含义 |
|------|------|
| `raw_response_event` | LLM 原始响应的 delta |
| `run_item_stream_event` | 工具调用、handoff、输出等 |
| `agent_updated` | Agent 发生 handoff 切换 |
| `run_completed` | 运行完成 |

## 6. 结构化输出

```python
from pydantic import BaseModel
from agents import Agent, Runner

class WeatherReport(BaseModel):
    city: str
    temperature: float
    condition: str
    advice: str

agent = Agent(
    name="weather_bot",
    model="gpt-4o",
    output_type=WeatherReport,
)

result = await Runner.run(agent, "What's the weather in Tokyo?")
report = result.final_output_as(WeatherReport)
print(f"{report.city}: {report.temperature}°C, {report.condition}")
```

## 7. 子 Agent（Agent-as-Tool）

```python
from agents import Agent

# 子 Agent 可被父 Agent 作为工具调用
translator = Agent(
    name="translator",
    model="gpt-4o-mini",
    instructions="Translate the text to French.",
)

# 父 Agent 把 translator 当作工具
orchestrator = Agent(
    name="orchestrator",
    model="gpt-4o",
    tools=[translator.as_tool(
        tool_name="translate_to_french",
        tool_description="Translate text to French",
    )],
)
```

## 8. 常见问题

**Q：Agent 和 Handoff 有什么区别？**

A：`tools=[agent.as_tool()]` 是"父 Agent 像调用工具一样调用子 Agent"；`handoffs=[agent]` 是"父 Agent 将整个对话控制权转移给子 Agent，不再回来"。

**Q：如何控制工具调用行为？**

A：通过 `tool_use_behavior` 参数：`"auto"`（默认，LLM 决定）、`"required"`（强制调用工具）、`"none"`（禁止调用工具）。

**Q：支持哪些模型？**

A：默认支持 OpenAI 所有模型（gpt-4o、gpt-4.1、o3、o4-mini 等），通过 `OpenAIChatCompletionsModel` 可接入 100+ 第三方模型。
