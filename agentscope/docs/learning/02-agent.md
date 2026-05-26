# 02 - Agent 核心概念

## Agent 类

Agent 是 AgentScope 的核心抽象，实现 ReAct（Reasoning + Acting）循环。

### 类定义

```python
class Agent:
    def __init__(
        self,
        name: str,
        system_prompt: str,
        model: ChatModelBase,
        toolkit: Toolkit | None = None,
        middlewares: list[MiddlewareBase] | None = None,
        state: AgentState | None = None,
        offloader: Offloader | None = None,
        model_config: ModelConfig = ModelConfig(),
        context_config: ContextConfig = ContextConfig(),
        react_config: ReActConfig = ReActConfig(),
    ) -> None:
```

### 参数说明

| 参数 | 类型 | 说明 |
|---|---|---|
| `name` | str | Agent 标识符 |
| `system_prompt` | str | 系统提示词 |
| `model` | ChatModelBase | 模型实例 |
| `toolkit` | Toolkit | 工具集（可选） |
| `middlewares` | list | 中间件（可选） |
| `state` | AgentState | Agent 状态 |
| `react_config` | ReActConfig | ReAct 配置 |

## ReAct 循环

### 工作流程

```
┌─────────────────────────────────────────────────────────────┐
│                    ReAct Loop                               │
│                                                             │
│  1. Receive Input (Msg)                                     │
│     ↓                                                       │
│  2. Reasoning (Model Call)                                  │
│     ├── Generate Text/Thinking                              │
│     ├── Generate Tool Calls                                 │
│     ↓                                                       │
│  3. Acting (Tool Execution)                                 │
│     ├── Sequential Execution                                │
│     ├── Concurrent Execution                                │
│     ↓                                                       │
│  4. Check Result                                            │
│     ├── If tool calls → Back to Step 2                      │
│     ├── If no tool calls → Return final message             │
│     ↓                                                       │
│  5. Return AssistantMsg                                     │
│                                                             │
│  Max Iterations: react_config.max_iters                     │
└─────────────────────────────────────────────────────────────┘
```

### ReActConfig

```python
class ReActConfig:
    max_iters: int = 10  # 最大循环次数
```

## reply() vs reply_stream()

### reply() — 同步返回

```python
async def reply(
    self,
    inputs: Msg | list[Msg] | None = None,
) -> Msg:
    """返回最终回复消息"""
```

**使用场景**：
- 不需要实时进度
- 简单对话场景

```python
result = await agent.reply(UserMsg("user", "Hello!"))
print(result.content)
```

### reply_stream() — 流式事件

```python
async def reply_stream(
    self,
    inputs: Msg | list[Msg] | None = None,
) -> AsyncGenerator[AgentEvent, None]:
    """流式返回事件"""
```

**使用场景**：
- Web UI 实时渲染
- 长任务进度显示
- 工具调用可视化

```python
async for evt in agent.reply_stream(UserMsg("user", "Hello!")):
    match evt.type:
        case EventType.TEXT_BLOCK_DELTA:
            print(evt.text, end="", flush=True)
        case EventType.TOOL_CALL_START:
            print(f"\n[Tool: {evt.tool_name}]")
```

## 系统提示

### 基本用法

```python
agent = Agent(
    name="Friday",
    system_prompt="You're a helpful assistant.",
    model=model,
)
```

### 动态扩展

系统提示可通过 middleware 动态扩展：

```python
class CustomMiddleware(MiddlewareBase):
    def on_system_prompt(self, agent, prompt):
        return prompt + "\nAlways be concise."
```

## 工具绑定

### Toolkit 创建

```python
from agentscope.tool import Toolkit, Bash, Read, Write

toolkit = Toolkit(
    tools=[
        Bash(),
        Read(),
        Write(),
    ]
)

agent = Agent(
    name="Coder",
    system_prompt="You're a coding assistant.",
    model=model,
    toolkit=toolkit,
)
```

## Agent State

AgentState 管理上下文和记忆：

```python
class AgentState:
    session_id: str       # 会话 ID
    reply_id: str         # 回复 ID
    context: list[Msg]    # 上下文消息
    summary: str          # 压缩摘要
    cur_iter: int         # 当前迭代次数
```

## 完整示例

```python
import asyncio
from agentscope.agent import Agent
from agentscope.model import OpenAIChatModel
from agentscope.tool import Toolkit, Bash
from agentscope.message import UserMsg
import os

async def main():
    agent = Agent(
        name="Developer",
        system_prompt="You're a senior developer who helps with coding tasks.",
        model=OpenAIChatModel(
            model="gpt-4",
            api_key=os.environ["OPENAI_API_KEY"],
        ),
        toolkit=Toolkit(
            tools=[Bash()],
        ),
    )
    
    result = await agent.reply(
        UserMsg("user", "List files in current directory")
    )
    print(result.content)

asyncio.run(main())
```

## 下一步

- [03-tool.md](03-tool.md) — Tool & Toolkit 详细
- [05-message.md](05-message.md) — Message & Event 系统