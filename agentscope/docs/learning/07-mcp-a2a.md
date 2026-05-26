# 07 - MCP/A2A 集成

## MCP (Model Context Protocol)

MCP 是 Anthropic 提出的工具协议，允许 LLM 与外部工具交互。

### MCP Client

```python
from agentscope.mcp import MCPClient

mcp_client = MCPClient(
    name="filesystem",
    config={
        "command": "mcp-server-filesystem",
        "args": ["--root", "/workspace"],
    }
)
```

### MCP 配置结构

```python
class MCPClientConfig:
    command: str       # MCP Server 启动命令
    args: list[str]    # 命令参数
    env: dict          # 环境变量
    timeout: int       # 超时时间
```

## MCP 工具发现

### 列出工具

```python
tools = await mcp_client.list_tools()
for tool in tools:
    print(f"Tool: {tool.name}")
    print(f"  Description: {tool.description}")
    print(f"  Schema: {tool.input_schema}")
```

### 调用 MCP 工具

```python
result = await mcp_client.call_tool(
    name="read_file",
    arguments={"path": "/workspace/hello.py"},
)
print(result.content)
```

## 集成到 Toolkit

### 基本用法

```python
from agentscope.tool import Toolkit
from agentscope.mcp import MCPClient

filesystem_mcp = MCPClient(
    name="filesystem",
    config={
        "command": "mcp-server-filesystem",
        "args": ["--root", "/workspace"],
    }
)

toolkit = Toolkit(
    mcps=[filesystem_mcp],
)

agent = Agent(
    model=model,
    toolkit=toolkit,
)
```

### 多 MCP Client

```python
toolkit = Toolkit(
    mcps=[
        filesystem_mcp,
        websearch_mcp,
        database_mcp,
    ],
)
```

## MCP Server 类型

### 文件系统 MCP

```bash
pip install mcp-server-filesystem
mcp-server-filesystem --root /workspace
```

### Web Search MCP

```python
websearch_mcp = MCPClient(
    name="websearch",
    config={
        "command": "mcp-server-websearch",
        "args": [],
        "env": {"SEARCH_API_KEY": "..."},
    }
)
```

### 自定义 MCP Server

```python
from mcp.server import Server

server = Server("custom-mcp")

@server.list_tools()
async def list_tools():
    return [
        Tool(
            name="custom_action",
            description="Do something custom",
            inputSchema={
                "type": "object",
                "properties": {
                    "param": {"type": "string"}
                }
            }
        )
    ]

@server.call_tool()
async def call_tool(name: str, arguments: dict):
    if name == "custom_action":
        return f"Result: {arguments['param']}"
```

## A2A (Agent-to-Agent)

A2A 协议允许 Agent 之间通信协作。

### Agent 间消息传递

```python
# Agent A 发送消息给 Agent B
agent_a = Agent(name="Coordinator", model=model_a)
agent_b = Agent(name="Worker", model=model_b)

# Agent A 协调任务
result_a = await agent_a.reply(
    UserMsg("user", "Coordinate with Worker to solve this problem")
)

# Agent A 决定传递给 Agent B
if need_worker:
    # 构造消息传给 Agent B
    result_b = await agent_b.reply(
        UserMsg("coordinator", result_a.content)
    )
```

### 多 Agent 协作模式

```
┌─────────────────────────────────────────────────────────────┐
│                   Multi-Agent Workflow                       │
│                                                             │
│  Coordinator Agent                                          │
│  ├── 分析任务                                                │
│  ├── 分配给 Worker Agents                                   │
│  └── 整合结果                                                │
│                                                             │
│  Worker Agent A          Worker Agent B          Worker Agent C│
│  ├── 执行子任务 A          ├── 执行子任务 B          ├── 执行子任务 C│
│  └── 返回结果              └── 返回结果              └── 返回结果  │
│                                                             │
│  Coordinator 整合最终结果                                    │
└─────────────────────────────────────────────────────────────┘
```

## Stateful MCP

### 状态管理

```python
class MCPClient:
    is_stateful: bool     # 是否有状态
    is_connected: bool    # 是否已连接
    
    async def connect(self) -> None:
        """连接 MCP Server"""
    
    async def disconnect(self) -> None:
        """断开连接"""
```

### Stateful MCP 配置

```python
mcp_client = MCPClient(
    name="stateful_db",
    config={...},
    is_stateful=True,
)

# 必须先连接
await mcp_client.connect()

# 然后注册到 Toolkit
toolkit = Toolkit(mcps=[mcp_client])
```

## 完整示例

```python
import asyncio
from agentscope.agent import Agent
from agentscope.model import OpenAIChatModel
from agentscope.tool import Toolkit
from agentscope.mcp import MCPClient
from agentscope.message import UserMsg
import os

async def main():
    # 配置 MCP Client
    filesystem_mcp = MCPClient(
        name="filesystem",
        config={
            "command": "mcp-server-filesystem",
            "args": ["--root", "/workspace"],
        }
    )
    
    toolkit = Toolkit(
        mcps=[filesystem_mcp],
    )
    
    agent = Agent(
        name="FileManager",
        system_prompt="You're a file management assistant.",
        model=OpenAIChatModel(
            model="gpt-4",
            api_key=os.environ["OPENAI_API_KEY"],
        ),
        toolkit=toolkit,
    )
    
    async for evt in agent.reply_stream(
        UserMsg("user", "List all Python files in /workspace")
    ):
        print(f"Event: {evt.type}")

asyncio.run(main())
```

## 下一步

- [08-service.md](08-service.md) — Agent Service 多租户
- [09-webui.md](09-webui.md) — Web UI 集成