# 工具系统

OpenAI Agents SDK 的工具系统简洁而强大：通过装饰器将 Python 函数转化为 LLM 可调用的工具，同时支持 MCP 协议和托管工具。

## 1. FunctionTool：@function_tool

```python
from agents import function_tool, RunContextWrapper

@function_tool
def get_weather(city: str) -> str:
    """Get the current weather for a city.

    Args:
        city: The city name to get weather for.
    """
    return f"The weather in {city} is sunny and 22°C."
```

核心规则：
- **docstring 自动转为工具描述**：LLM 通过 docstring 理解何时调用
- **类型注解自动生成 Schema**：`str` → `{"type": "string"}`
- **Args 自动转为参数描述**：Google-style docstring 解析

### 带上下文的工具

```python
from agents import function_tool, RunContextWrapper
from typing import Any

@function_tool
async def search_database(
    ctx: RunContextWrapper[Any],
    query: str,
) -> str:
    """Search the internal database."""
    # ctx.context 可携带自定义依赖
    db = ctx.context.get("db_client")
    results = await db.search(query)
    return str(results)
```

### 可选参数

```python
@function_tool
def search(
    query: str,
    limit: int = 10,          # 有默认值 = 可选参数
    category: str | None = None,  # Optional
) -> list[dict]:
    """Search with filters."""
    return [{"id": 1, "title": query}]
```

### 强制字符串输出

```python
@function_tool(force_string_output=True)
def get_complex_data(query: str) -> dict:
    """Returns complex data that gets serialized as string."""
    return {"nested": {"data": [1, 2, 3]}}
```

## 2. 工具 Schema 自定义

```python
from pydantic import BaseModel, Field
from agents import function_tool

class SearchParams(BaseModel):
    query: str = Field(description="The search query")
    limit: int = Field(default=10, description="Max results", ge=1, le=100)
    source: str = Field(default="web", description="Search source")

@function_tool
def advanced_search(params: SearchParams) -> str:
    """Advanced search with structured params."""
    return f"Found {params.limit} results for {params.query}"
```

## 3. MCP 工具

```python
from agents import Agent
from agents.mcp import MCPServerStdio

async def main():
    async with MCPServerStdio(
        name="filesystem-server",
        params={
            "command": "npx",
            "args": ["-y", "@modelcontextprotocol/server-filesystem", "/tmp"],
        },
    ) as server:
        agent = Agent(
            name="file-agent",
            model="gpt-4o",
            mcp_servers=[server],
        )
        result = await Runner.run(agent, "List files in /tmp")
```

MCP 服务器类型：
- `MCPServerStdio`：本地进程 STIO 通信
- `MCPServerSse`：HTTP SSE 通信
- `MCPServerStreamableHttp`：Streamable HTTP

## 4. 托管工具（Hosted Tools）

无需本地部署，直接调用 OpenAI 托管工具：

```python
from agents import Agent, WebSearchTool, FileSearchTool, CodeInterpreterTool

agent = Agent(
    name="researcher",
    model="gpt-4o",
    tools=[
        WebSearchTool(),            # OpenAI 托管搜索
        FileSearchTool(
            vector_store_ids=["vs_xxx"],  # 向量存储
            max_num_results=5,
        ),
        CodeInterpreterTool(),      # 代码解释器
    ],
)
```

### 计算机操作工具

```python
from agents import ComputerTool

computer_agent = Agent(
    name="computer_user",
    model="computer-use-preview",
    tools=[ComputerTool(environment="browser")],
)
```

## 5. Agent-as-Tool

```python
translator = Agent(name="translator", instructions="Translate to French.")
summarizer = Agent(name="summarizer", instructions="Summarize the text.")

orchestrator = Agent(
    name="orchestrator",
    tools=[
        translator.as_tool(tool_name="translate", tool_description="Translate text"),
        summarizer.as_tool(tool_name="summarize", tool_description="Summarize text"),
    ],
)
```

`as_tool()` 与 `handoff()` 区别：`as_tool()` 调用后控制权返回父 Agent；`handoff()` 转移后不再返回。

## 6. 工具执行上下文

每个工具调用都可以获得丰富的上下文：

```python
from agents import function_tool, RunContextWrapper

@function_tool
async def contextual_tool(ctx: RunContextWrapper[MyContext], arg: str) -> str:
    # 获取当前 Agent
    agent_name = ctx.agent.name

    # 获取对话历史
    history = ctx.run_state.input

    # 获取自定义上下文
    db = ctx.context.database

    return f"Agent {agent_name} executed with arg={arg}"
```

## 7. 工具错误处理

```python
from agents import function_tool, ToolError

@function_tool
def risky_operation(param: str) -> str:
    try:
        result = do_something(param)
        return result
    except ValueError as e:
        raise ToolError(f"Invalid parameter: {e}")
    except ConnectionError:
        raise ToolError("Service unavailable, please retry later")
```

`ToolError` 会被 LLM 看到并尝试修正调用参数。

## 8. 性能：并行工具调用

SDK 自动支持 LLM 的 parallel tool calls（一次 LLM 调用发送多个工具请求，并发执行）：

```python
@function_tool
def search_web(query: str) -> str: ...
@function_tool
def search_docs(query: str) -> str: ...
@function_tool
def search_code(query: str) -> str: ...

agent = Agent(
    name="researcher",
    tools=[search_web, search_docs, search_code],
)
# LLM 收到 "search for X in all sources" 时，
# 会一次发送 3 个并行 tool call，SDK 并发执行
```

## 9. 常见问题

**Q：工具函数必须是 async 吗？**

A：不必须。同步函数和异步函数都支持。SDK 内部用 `inspect.iscoroutinefunction()` 自动区分。

**Q：工具参数支持哪些类型？**

A：`str`、`int`、`float`、`bool`、`list`、`dict`、Pydantic `BaseModel`、`Optional[T]`、`Literal["a", "b"]`。

**Q：工具调用有超时吗？**

A：默认无超时。可在外层用 `asyncio.wait_for()` 包装，或在工具函数内部自行实现超时。
