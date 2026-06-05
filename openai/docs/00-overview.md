# OpenAI Agents SDK 项目总览

## 项目简介

OpenAI Agents SDK 是 OpenAI 官方推出的轻量级多 Agent 工作流框架，基于 Python 构建。不同于 LangChain 的"概念爆炸"和 ADK 的"全栈框架"定位，OpenAI Agents SDK 的设计哲学是**最小化抽象、最大化可观测性**——用最少的 API 层实现最完整的 Agent 能力。

核心定位：
> A lightweight yet powerful framework for building multi-agent workflows. Production-ready tracing, guardrails, and session management out of the box.

## 设计哲学

- **Provider-Agnostic（提供商无关）**：底层模型接口支持 OpenAI Responses API、Chat Completions API、以及 100+ 第三方 LLM。
- **最小抽象层**：核心 API 只有 `Agent`、`Tool`、`Handoff`、`Guardrail` 四个概念，比 LangChain 少 1-2 个数量级。
- **内置追踪**：不需要额外集成 OpenTelemetry / Langfuse，SDK 自带完整的 Span/Trace 追踪系统。
- **流式优先**：所有 API 原生支持 `stream_events()`，事件以 `StreamEvent` 类型化的方式输出。
- **沙箱安全**：内置容器化沙箱 Agent，支持代码执行隔离。
- **实时语音**：原生支持 `gpt-realtime-2` WebSocket 协议，无需额外语音管线。

## 核心概念

### Agent（智能体）

Agent 是 LLM + 指令 + 工具 + 护栏 + 转移目标的组合体：

```python
from agents import Agent, Runner

agent = Agent(
    name="assistant",
    model="gpt-4o",
    instructions="You are a helpful assistant.",
    tools=[get_weather, search_knowledge_base],
)
```

关键特性：
- **Model**：支持 OpenAI 模型和 100+ 第三方模型
- **Instructions**：字符串或动态生成函数 `instructions: Callable[[RunContextWrapper, Agent], str]`
- **Tools**：函数工具、MCP 工具、托管工具、Agent-as-Tool
- **Handoffs**：向其他 Agent 转移控制权
- **Output type**：结构化输出（Pydantic 模型）
- **Guardrails**：输入/输出安全检查

### Tool（工具）

```python
from agents import function_tool

@function_tool
def get_weather(city: str) -> str:
    """Get the current weather for a city."""
    return f"The weather in {city} is sunny."

# MCP 工具
from agents.mcp import MCPServerStdio

async with MCPServerStdio(
    name="my-server",
    params={"command": "python", "args": ["server.py"]},
) as server:
    agent = Agent(name="agent", mcp_servers=[server])
```

### Handoff（Agent 转移）

```python
from agents import Agent, handoff

support_agent = Agent(name="support", ...)
billing_agent = Agent(name="billing", ...)

triage_agent = Agent(
    name="triage",
    handoffs=[
        handoff(support_agent, tool_description_override="Transfer support questions"),
        handoff(billing_agent, tool_description_override="Transfer billing questions"),
    ],
)
```

### Guardrail（护栏）

```python
from agents import GuardrailFunctionOutput, input_guardrail, output_guardrail
from pydantic import BaseModel

class SafetyCheck(BaseModel):
    is_safe: bool
    reason: str

@input_guardrail
async def safety_guardrail(context, agent, input) -> GuardrailFunctionOutput:
    # 检查用户输入安全性
    return GuardrailFunctionOutput(
        output_info=SafetyCheck(is_safe=True, reason=""),
        tripwire_triggered=False,
    )

agent = Agent(
    name="safe_agent",
    input_guardrails=[safety_guardrail],
    output_guardrails=[output_safety],
)
```

### Tracing（追踪）

无需额外配置，SDK 自动追踪每次 Agent 运行：

```python
from agents import trace

# 自动追踪 run() 调用
result = await Runner.run(agent, "What is the weather?")
# 所有 trace 自动记录：Span 树、Token 用量、工具调用、延迟

# 自定义 Span
with trace("custom_workflow"):
    # 这里的所有操作会被归入同一个 trace
    result1 = await Runner.run(agent1, input)
    result2 = await Runner.run(agent2, input)
```

### Session（会话）

```python
from agents import Runner

result = await Runner.run(
    agent,
    "Hello",
    session_id="user-123",  # 自动管理会话历史
)
# 后续调用自动带上下文
result2 = await Runner.run(agent, "What did I just ask?", session_id="user-123")
```

## 架构总览

```
Runner.run() / Runner.run_streamed()
    │
    ├── Agent（LLM + instructions + tools + handoffs + guardrails）
    │     ├── Model（OpenAI / 第三方 LLM）
    │     ├── Tools（Function / MCP / Hosted / Agent-as-Tool）
    │     ├── Handoffs（Agent → Agent 转移）
    │     └── Guardrails（Input / Output 安全检查）
    │
    ├── Tracing（自动 Span/ Trace 记录）
    │     ├── Processors（自定义处理器）
    │     └── Export（控制台 / 外部系统）
    │
    ├── Session（对话历史持久化）
    │     ├── InMemory
    │     ├── SQLite
    │     └── OpenAI-Managed
    │
    ├── Sandbox（容器化执行）
    └── Realtime（WebSocket 语音 Agent）
```

## 与 ADK 的对比

| 维度 | OpenAI Agents SDK | ADK-Python | ADK-Go |
|------|-------------------|-----------|--------|
| 维护方 | OpenAI | Google | Google |
| 语言 | Python | Python | Go |
| 抽象层数 | 极简（4 个核心概念） | 中等（~10 个核心概念） | 中等 |
| 多 Agent | Handoff + Agent-as-Tool | sub_agents + transfer + Workflow | SubAgents + Transfer |
| Workflow | ❌ 无 DAG 引擎 | ✅ 图驱动 Workflow | Sequential/Parallel/Loop |
| 追踪 | ✅ 内置（非 OTel） | ✅ OpenTelemetry | ✅ OpenTelemetry |
| 护栏 | ✅ 输入/输出护栏 | ❌ | ❌ |
| 沙箱 | ✅ 容器化沙箱 | ✅ Code Executor | ❌ |
| 语音 | ✅ Realtime Agent | ❌ | ✅ RunLive (双向流式) |
| 模型支持 | 100+（Providers 接口） | 100+（LiteLLM） | Gemini + 自定义 |
| 会话 | InMemory/SQLite/OpenAI | InMemory/SQLite/Vertex | InMemory/Database/Vertex |
| MCP | ✅ | ✅ | ✅ |
| A2A | ❌ | ✅ | ✅ |
| Evaluation | ❌ | ✅ 完整框架 | ❌ |
| 上手难度 | 极低 | 低 | 中 |

## 选型建议

| 场景 | 推荐框架 |
|------|----------|
| **OpenAI 生态 + 需要最短上手时间** | ✅ OpenAI Agents SDK |
| **复杂工作流编排（DAG）** | ADK-Python |
| **Google Cloud 深度集成** | ADK-Go / ADK-Python |
| **跨 Agent 标准协议（A2A）** | ADK |
| **安全敏感场景（内置护栏）** | OpenAI Agents SDK |
| **语音对话 Agent** | OpenAI Agents SDK（Realtime）|
| **高性能 Go 后端** | ADK-Go |
| **代码执行沙箱** | OpenAI Agents SDK / ADK-Python |

## 学习路径

1. [01 Agent 核心](./01-agent.md) → 从最简 Agent 开始
2. [02 工具系统](./02-tools.md) → 理解 Function/MCP/Hosted 三种工具
3. [03 Handoff 转移](./03-handoffs.md) → Agent 间委托与路由
4. [04 护栏](./04-guardrails.md) → 输入/输出安全检查
5. [05 追踪](./05-tracing.md) → 内置可观测性
6. [06 会话与记忆](./06-sessions-memory.md) → 持久化对话历史
7. [07 实时语音](./07-realtime-voice.md) → Realtime Agent
8. [08 沙箱 Agent](./08-sandbox.md) → 容器化安全执行
