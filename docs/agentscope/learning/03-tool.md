# 03 - Tool & Toolkit

## Toolkit 类

Toolkit 是 AgentScope 的工具管理核心，支持：
- Python 函数工具
- MCP 工具
- Agent Skills

### 类定义

```python
class Toolkit:
    def __init__(
        self,
        tools: list[ToolBase] | None = None,
        skills_or_loaders: Sequence[str | Skill] | None = None,
        mcps: list[MCPClient] | None = None,
        tool_groups: list[ToolGroup] | None = None,
    ) -> None:
```

### 参数说明

| 参数 | 类型 | 说明 |
|---|---|---|
| `tools` | list[ToolBase] | Python 工具列表 |
| `skills_or_loaders` | Sequence | Skills 目录或加载器 |
| `mcps` | list[MCPClient] | MCP 客户端列表 |
| `tool_groups` | list[ToolGroup] | 工具分组 |

## 内置工具

| 工具 | 说明 | 示例 |
|---|---|---|
| `Bash` | 执行 shell 命令 | `Bash()` |
| `Read` | 读取文件 | `Read()` |
| `Write` | 写入文件 | `Write()` |
| `Edit` | 编辑文件 | `Edit()` |
| `Grep` | 搜索文件内容 | `Grep()` |
| `Glob` | 搜索文件名 | `Glob()` |

### 基本用法

```python
from agentscope.tool import Toolkit, Bash, Read, Write, Edit, Grep, Glob

toolkit = Toolkit(
    tools=[
        Bash(),
        Read(),
        Write(),
        Edit(),
        Grep(),
        Glob(),
    ]
)

agent = Agent(
    name="Coder",
    model=model,
    toolkit=toolkit,
)
```

## ToolBase 基类

所有工具继承自 `ToolBase`：

```python
class ToolBase:
    name: str              # 工具名称
    description: str       # 工具描述
    input_schema: dict     # 输入 JSON Schema
    
    is_concurrency_safe: bool  # 是否可并发执行
    is_read_only: bool         # 是否只读
    is_state_injected: bool    # 是否注入 AgentState
    is_external_tool: bool     # 是否外部执行
```

## 自定义工具

### 简单函数工具

```python
from agentscope.tool import FunctionTool

def search_web(query: str) -> str:
    """Search the web for information.
    
    Args:
        query: The search query string.
    
    Returns:
        Search results as text.
    """
    # 实现搜索逻辑
    return "Search results..."

tool = FunctionTool(search_web)
```

### 类工具

```python
from agentscope.tool import ToolBase

class WeatherTool(ToolBase):
    name = "get_weather"
    description = "Get current weather for a location"
    input_schema = {
        "type": "object",
        "properties": {
            "location": {
                "type": "string",
                "description": "City name"
            }
        },
        "required": ["location"]
    }
    
    def __call__(self, location: str) -> str:
        # 实现天气查询
        return f"Weather in {location}: Sunny, 25°C"
```

## MCP 工具

### MCP Client 配置

```python
from agentscope.mcp import MCPClient

mcp_client = MCPClient(
    name="filesystem",
    config={
        "command": "mcp-server-filesystem",
        "args": ["--root", "/workspace"],
    }
)

toolkit = Toolkit(
    mcps=[mcp_client],
)
```

### MCP 工具自动发现

MCP Client 自动发现并注册 MCP Server 提供的工具：

```python
tools = await mcp_client.list_tools()
for tool in tools:
    print(f"Tool: {tool.name}")
```

## Tool Groups

工具分组支持激活/停态管理：

```python
from agentscope.tool import ToolGroup, Toolkit

toolkit = Toolkit(
    tool_groups=[
        ToolGroup(
            name="analysis",
            tools=[Grep(), Glob()],
            description="File analysis tools",
        ),
        ToolGroup(
            name="editing",
            tools=[Edit(), Write()],
            description="File editing tools",
        ),
    ]
)
```

### 激活工具组

Agent 通过 `ResetTools` 内置工具激活工具组：

```python
# Agent 调用 ResetTools 激活 "analysis" 组
# 然后可使用该组中的 Grep、Glob 工具
```

## 工具调用流程

```
Agent                    Toolkit                  Tool
  │                         │                       │
  │  ToolCallBlock          │                       │
  │ ──────────────────────> │                       │
  │                         │  check_tool_available │
  │                         │ ────────────────────> │
  │                         │                       │
  │                         │  call_tool            │
  │                         │ ────────────────────> │
  │                         │                       │
  │  ToolChunk/ToolResponse │                       │
  │ <────────────────────── │ <──────────────────── │
```

## 工具权限

### Permission Engine

```python
from agentscope.permission import PermissionEngine, PermissionRule

# 添加权限规则
engine.add_rule(
    PermissionRule(
        tool_name="Bash",
        behavior=PermissionBehavior.ASK,  # 询问用户
        conditions={"command": "rm *"},
    )
)
```

### 权限行为

| Behavior | 说明 |
|---|---|
| `ALLOW` | 自动允许 |
| `DENY` | 自动拒绝 |
| `ASK` | 询问用户确认 |
| `PASSTHROUGH` | 传递给外部执行 |

## 完整示例

```python
import asyncio
from agentscope.agent import Agent
from agentscope.model import OpenAIChatModel
from agentscope.tool import Toolkit, Bash, Read, Write
from agentscope.message import UserMsg
import os

async def main():
    toolkit = Toolkit(
        tools=[
            Bash(),
            Read(),
            Write(),
        ]
    )
    
    agent = Agent(
        name="Developer",
        system_prompt="You're a developer assistant.",
        model=OpenAIChatModel(
            model="gpt-4",
            api_key=os.environ["OPENAI_API_KEY"],
        ),
        toolkit=toolkit,
    )
    
    async for evt in agent.reply_stream(
        UserMsg("user", "Create a hello.py file")
    ):
        print(f"Event: {evt.type}")

asyncio.run(main())
```

## 下一步

- [04-model.md](04-model.md) — Model 配置
- [07-mcp-a2a.md](07-mcp-a2a.md) — MCP 详细