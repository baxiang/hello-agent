# MCP Client 多平台接入实战

> **实践模块第三节。** [前两节](./10-mcp-server-python.md) 写好了 Server，但 Server 只有被 Client 接进 Host 才能真正发挥作用。本节是全平台 MCP Client 接入指南——Claude Desktop、Cursor/Windsurf、tRPC-Agent-Go、Python Agent、Node.js 一网打尽。
>
> **本节你将学到**：Claude Desktop / Cursor 的 JSON 配置、tRPC-Agent-Go 的 STDIO 与 Streamable HTTP 双连接、ADK / LangChain / OpenAI Agents SDK 三种 Python 接入、Node.js 原生 Client、MCP Broker 按需发现机制。
>
> **一句话比喻**：如果前两节是「**造插座**」，本节是「**配各种插头**」——同一个 Server 要被不同 Host 和 Agent 框架使用，每种接入姿势都演示一遍。

## 1. Claude Desktop

```json
// ~/Library/Application Support/Claude/claude_desktop_config.json
{
    "mcpServers": {
        "developer-toolkit": {
            "command": "python",
            "args": ["/path/to/advanced_server.py"],
            "env": {
                "WORK_DIR": "/Users/username/projects",
                "GITHUB_TOKEN": "ghp_xxx"
            }
        },
        "filesystem": {
            "command": "npx",
            "args": ["-y", "@anthropic-ai/mcp-server-filesystem", "/Users/username/Documents"]
        }
    }
}
```

重启 Claude Desktop，输入框出现 🔌 图标表示连接成功。

## 2. Cursor / Windsurf

```json
// .cursor/mcp.json
{
    "mcpServers": {
        "developer-toolkit": {
            "command": "python",
            "args": ["/path/to/advanced_server.py"],
            "env": { "WORK_DIR": "${workspaceFolder}" }
        }
    }
}
```

## 3. tRPC-Agent-Go

```go
// ── STDIO 连接 ──
localTools := mcp.NewMCPToolSet(mcp.ConnectionConfig{
    Transport: "stdio",
    Command:   "python", Args: []string{"advanced_server.py"},
    Env:       []string{"WORK_DIR=./workspace"},
})
defer localTools.Close()

// ── Streamable HTTP 连接 ──
remoteTools := mcp.NewMCPToolSet(mcp.ConnectionConfig{
    Transport:   "streamable_http",
    ServerURL:   "https://mcp.example.com/tools",
    HTTPHeaders: map[string]string{"Authorization": "Bearer " + token},
})
defer remoteTools.Close()

// 同时使用多个 ToolSet
agent := llmagent.New("agent",
    llmagent.WithModel(openai.New("deepseek-chat")),
    llmagent.WithToolSets([]tool.ToolSet{localTools, remoteTools}),
)
```

## 4. Python Agent

```python
# ADK Python
from google.adk.tools.mcp_tool import McpToolset
mcp_tools = McpToolset(connection_params={
    "command": "python", "args": ["advanced_server.py"]
})

# LangChain
from langchain_mcp_adapters.client import MultiServerMCPClient
client = MultiServerMCPClient({
    "toolkit": {"command": "python", "args": ["advanced_server.py"]}
})
tools = client.get_tools()

# OpenAI Agents SDK
from agents.mcp import MCPServerStdio
async with MCPServerStdio(params={
    "command": "python", "args": ["advanced_server.py"]
}) as server:
    agent = Agent(name="Assistant", mcp_servers=[server])
```

## 5. Node.js

```typescript
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const transport = new StdioClientTransport({
    command: "python", args: ["advanced_server.py"]
});

const client = new Client({ name: "web-app", version: "1.0.0" });
await client.connect(transport);

const { tools } = await client.listTools();
const result = await client.callTool({
    name: "read_file", arguments: { path: "README.md" }
});
```

## 6. MCP Broker 按需发现

多个 MCP Server 时使用 Broker 减少 LLM 上下文消耗：

```go
broker := mcp.NewBroker(
    mcp.WithBrokerServers([]string{
        "https://mcp-finance.example.com",
        "https://mcp-hr.example.com",
    }),
    mcp.WithBrokerAuthHook(func(ctx context.Context, url string) map[string]string {
        return map[string]string{"Authorization": "Bearer " + getToken(ctx, url)}
    }),
)
```

Broker 4 个工具：`list_servers → describe_server → connect_server → disconnect_server`。LLM 按需发现，只看到 4 个工具而非所有 Server 的全部工具。

## 7. 多平台接入对比

| 平台 | 接入方式 | 复杂度 | 传输支持 |
|------|---------|:---:|------|
| **Claude Desktop** | JSON 配置 | 低 | STDIO |
| **Cursor/Windsurf** | mcp.json | 低 | STDIO |
| **tRPC-Agent-Go** | `NewMCPToolSet()` | 低 | STDIO/SSE/HTTP |
| **ADK Python** | `McpToolset()` | 低 | STDIO |
| **LangChain** | `MultiServerMCPClient` | 中 | STDIO/SSE |
| **OpenAI Agents SDK** | `MCPServerStdio` | 低 | STDIO |
| **Node.js** | `@modelcontextprotocol/sdk` | 中 | STDIO/SSE/HTTP |

## 动手实验

1. **接进 Claude Desktop**：按 §1 的配置文件，把 [Python 篇](./10-mcp-server-python.md) 写好的 `advanced_server.py` 加进 `claude_desktop_config.json`，重启后确认输入框出现 🔌 图标，再让它调用 `search_github`。
2. **接进 Cursor**：按 §2 在工作区建 `.cursor/mcp.json`，用 `${workspaceFolder}` 注入工作目录，在 Cursor 里用对话触发工具调用，对比与 Claude Desktop 的体验差异。
3. **Agent 框架二选一**：选 §3 的 tRPC-Agent-Go 或 §4 的 Python Agent（ADK / LangChain / OpenAI Agents SDK 任一），把同一个 Server 接进去跑通一次「用户提问 → LLM 自动调工具 → 返回结果」的完整链路。
4. **体验 Broker 按需发现**：按 §6 配置两个 Server，观察不使用 Broker 时 LLM 上下文里塞了多少工具、使用 Broker 后是否只剩 `list_servers → describe_server → connect_server → disconnect_server` 这 4 个入口工具。

## 接下来

- [MCP 进阶架构](./13-mcp-advanced.md) —— Session 生命周期、传输方式选型、Docker/K8s 生产部署、四层安全架构
- [传输与安全](./04-transports-security.md) —— 回到协议详解篇，深入 stdio / SSE / Streamable HTTP 的对比与安全细节
- [Python MCP Server 实战](./10-mcp-server-python.md) —— 还没写过 Server 的话，先回来从零搭一个再接 Client
