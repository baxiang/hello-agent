# MCP Client 多平台接入实战

> Claude Desktop、VS Code、tRPC-Agent-Go、Python Agent、Node.js — 全平台 MCP Client 接入指南。

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
