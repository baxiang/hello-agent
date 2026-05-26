# MCP 模块分析

## 源码位置

`src/agentscope/mcp/` (5 文件)

## MCPClient 类

```python
class MCPClient:
    name: str                    # Client 名称
    config: MCPClientConfig      # 配置
    is_stateful: bool            # 是否有状态
    is_connected: bool           # 是否已连接
    
    async def connect() -> None  # 连接 Server
    async def disconnect() -> None  # 断开连接
    async def list_tools() -> list[Tool]  # 获取工具列表
    async def call_tool(name, arguments) -> ToolResult  # 调用工具
```

## MCPClientConfig

```python
class MCPClientConfig:
    command: str       # MCP Server 启动命令
    args: list[str]    # 命令参数
    env: dict          # 环境变量
    timeout: int       # 超时时间（秒）
```

## 工具发现

### list_tools()

```python
async def list_tools(self) -> list[Tool]:
    """从 MCP Server 获取工具列表"""
    
    # MCP 协议请求
    response = await self.session.send_request(
        "tools/list",
        {},
    )
    
    # 解析工具
    tools = []
    for tool_def in response.get("tools", []):
        tools.append(Tool(
            name=tool_def["name"],
            description=tool_def["description"],
            input_schema=tool_def["inputSchema"],
        ))
    
    return tools
```

## 工具调用

### call_tool()

```python
async def call_tool(
    self,
    name: str,
    arguments: dict,
) -> ToolResult:
    """调用 MCP 工具"""
    
    # MCP 协议请求
    response = await self.session.send_request(
        "tools/call",
        {
            "name": name,
            "arguments": arguments,
        },
    )
    
    # 解析结果
    return ToolResult(
        content=response.get("content", []),
        is_error=response.get("isError", False),
    )
```

## Toolkit 集成

### MCP 工具注册

```python
# Toolkit 构造时注册 MCP Client
toolkit = Toolkit(
    mcps=[mcp_client],
)

# 获取 MCP 工具
for client in group.mcps:
    tools = await client.list_tools()
    cache_tools.extend(tools)

# 注册到可用工具
for tool in cache_tools:
    available_tools[tool.name] = RegisteredTool(
        tool=tool,
        group=group.name,
    )
```

### MCP 工具执行

```python
async def call_tool(self, tool_call: ToolCallBlock, state: AgentState):
    tool_func = available_tools[tool_call.name].tool
    
    # MCP 工具调用
    if tool_func.is_mcp:
        kwargs = _json_loads_with_repair(tool_call.input)
        res = await tool_func(**kwargs)
```

## Stateful MCP

### 状态管理

```python
# Stateful MCP 必须先连接
mcp_client = MCPClient(
    name="stateful_db",
    config={...},
    is_stateful=True,
)

# 初始化时检查
if client.is_stateful and not client.is_connected:
    raise ValueError("Stateful MCP not connected")

# 使用前连接
await mcp_client.connect()
```

### 连接管理

```python
async def connect(self):
    """启动 MCP Server 进程并建立连接"""
    
    # 启动子进程
    self.process = await asyncio.create_subprocess_exec(
        self.config.command,
        *self.config.args,
        env=self.config.env,
        stdin=asyncio.subprocess.PIPE,
        stdout=asyncio.subprocess.PIPE,
    )
    
    # 建立 stdio 会话
    self.session = MCPSession(
        reader=self.process.stdout,
        writer=self.process.stdin,
    )
    
    # 初始化
    await self.session.initialize()
    self.is_connected = True
```

## MCP Server 实现

### 基本 Server

```python
from mcp.server import Server

server = Server("my-mcp-server")

@server.list_tools()
async def list_tools():
    return [
        Tool(
            name="my_tool",
            description="Do something",
            inputSchema={
                "type": "object",
                "properties": {
                    "param": {"type": "string"},
                },
            },
        )
    ]

@server.call_tool()
async def call_tool(name: str, arguments: dict):
    if name == "my_tool":
        return {"content": [{"type": "text", "text": f"Result: {arguments['param']}"}]}
```

## 设计模式

| 模式 | 应用 |
|---|---|
| **代理模式** | MCPClient 代理 MCP Server |
| **策略模式** | 不同 MCP Server 实现 |
| **状态模式** | is_connected 状态管理 |