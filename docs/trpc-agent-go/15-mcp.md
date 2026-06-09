# MCP 协议 — tRPC-Agent-Go 实现深度

> **前置阅读**：[MCP 协议课程集](/mcp/)（7 篇文章，从零理解 MCP 协议规范）

MCP（Model Context Protocol）让 LLM 通过标准化协议调用外部工具。tRPC-Agent-Go 基于 tRPC-MCP-Go 实现了完整的 Client 端，支持 STDIO、SSE、Streamable HTTP 三种传输方式。本文聚焦 tRPC-Agent-Go 的 MCP 实现架构和进阶用法。

## 1. 架构回顾

```
Agent（LLMAgent / GraphAgent）
    │
    ├─ WithToolSets([]tool.ToolSet{...})
    │       │
    │       ▼
    │   MCPToolSet
    │       │
    │       ├─ Transport: STDIO / SSE / Streamable HTTP
    │       │
    │       ▼
    │   MCP Server（任何语言实现）
    │       ├─ tools/list → Tool Declarations
    │       ├─ tools/call → Tool Execution
    │       └─ resources/*, prompts/*, ...
    │
    ▼
LLM 看到 MCP 工具 → 调用 → MCPToolSet 转发 → MCP Server 执行 → 返回结果
```

## 2. 三种传输方式全解

### 2.1 STDIO：本地子进程

```go
ts := mcp.NewMCPToolSet(
    mcp.ConnectionConfig{
        Transport: "stdio",
        Command:   "python",
        Args:      []string{"-m", "my_mcp_server"},
        Env:       []string{"API_KEY=xxx"},
        Timeout:   30 * time.Second,
    },
)
```

**内部机制**：

```
tRPC-Agent-Go                     MCP Server（子进程）
    │                                    │
    ├─ os/exec 启动子进程                 │
    │   cmd.StdinPipe() ────────────────→ stdin
    │   cmd.StdoutPipe() ←────────────── stdout
    │                                    │
    ├─ JSON-RPC Request ───────────────→ │
    │   {"method":"tools/list", ...}      │
    │                                    ├─ 处理请求
    │  ←──────────────── JSON-RPC Response
    │   {"result":{"tools":[...]}}        │
    │                                    │
    ├─ ts.Close() → cmd.Process.Kill() ─→ 进程终止
```

**特点**：
- 零网络开销（进程内管道通信）
- 子进程生命周期与 ToolSet 绑定
- 串行执行（stdin/stdout 单工通道）
- 需要本地安装依赖（Python、Node 等运行时）

### 2.2 SSE：远程工具服务

```go
ts := mcp.NewMCPToolSet(
    mcp.ConnectionConfig{
        Transport: "sse",
        ServerURL: "http://mcp-server:8080/sse",
        Timeout:   10 * time.Second,
    },
)
```

**内部机制**：

```
tRPC-Agent-Go                     MCP Server
    │                                    │
    ├─ GET /sse ──────────────────────→  │
    │  ←────────── SSE 连接建立 ────────  │
    │     event: endpoint                 │
    │     data: /message?sessionId=xxx    │
    │                                    │
    ├─ POST /message?sessionId=xxx ────→ │
    │     {"method":"tools/list", ...}     │
    │  ←────────── SSE event ──────────── │
    │     event: message                   │
    │     data: {"result":{...}}           │
```

**特点**：
- 远程部署，解耦 Agent 和工具
- 并发调用（HTTP 连接池）
- 需要网络可达性
- 支持 HTTP 标准认证（Header/Bearer Token）

### 2.3 Streamable HTTP：现代替代方案

```go
ts := mcp.NewMCPToolSet(
    mcp.ConnectionConfig{
        Transport:     "streamable_http",
        ServerURL:     "https://mcp.example.com",
        HTTPHeaders:   map[string]string{
            "Authorization": "Bearer " + token,
        },
        Timeout: 10 * time.Second,
    },
)
```

相比 SSE 的优势：
- 单一 HTTP 端点（无需先 GET /sse 再 POST /message）
- 原生支持流式响应（Server → Client 和 Client → Server）
- 更容易通过负载均衡器和服务网格

### 2.4 传输方式选择指南

| 场景 | 推荐传输 | 原因 |
|------|---------|------|
| 开发/测试 | STDIO | 最简单，零配置 |
| 同一台机器 | STDIO | 零网络开销 |
| 微服务架构 | SSE 或 Streamable HTTP | 独立部署和扩缩 |
| 需要认证 | Streamable HTTP | 标准 HTTP Auth |
| 高并发 | SSE / Streamable HTTP | 连接池并发 |

---

## 3. MCP 工具过滤器

### 3.1 ToolSet 级别

```go
ts := mcp.NewMCPToolSet(
    config,
    mcp.WithToolFilterFunc(func(name string) bool {
        // 过滤内部工具
        return !strings.HasPrefix(name, "_")
    }),
)
```

### 3.2 Agent 级别

```go
agent := llmagent.New("assistant",
    llmagent.WithToolSets([]tool.ToolSet{ts}),
    llmagent.WithToolFilter(func(t tool.Tool) bool {
        // 只暴露读操作
        return t.Declaration().Name != "delete_user"
    }),
)
```

### 3.3 Per-Run 级别

```go
events, _ := r.Run(ctx, userID, sessionID, msg,
    agent.WithToolFilter(func(t tool.Tool) bool {
        return isAdmin(userID) || !toolMetadata.Destructive
    }),
)
```

**过滤层级效果**：ToolSet 级别最早生效（减少 Tools() 调用开销），Agent 级别在构建 messages 时生效，Per-Run 级别最灵活。

---

## 4. MCP Broker：按需发现

当有大量 MCP 服务器时，直接将所有工具暴露给 LLM 会超出 token 限制。Broker 实现渐进式发现：

```
第 1 步：mcp_list_servers → 列出可用服务器（含描述）
第 2 步：mcp_describe_server(server) → 查看该服务器有哪些工具
第 3 步：mcp_connect_server(server) → 建立连接，工具可用
第 4 步：mcp_disconnect_server(server) → 释放连接
```

```go
broker := mcp.NewBroker(
    mcp.WithBrokerServers([]string{
        "https://mcp-finance.example.com",
        "https://mcp-hr.example.com",
        "https://mcp-weather.example.com",
    }),
    // Per-Run 认证钩子
    mcp.WithBrokerAuthHook(func(ctx context.Context, url string) map[string]string {
        return map[string]string{
            "Authorization": "Bearer " + getTokenForService(ctx, url),
        }
    }),
)

agent := llmagent.New("broker-agent",
    llmagent.WithModel(model),
    llmagent.WithToolSets([]tool.ToolSet{broker}),
)
```

**Broker 的设计优势**：
- LLM 只看到 4 个 broker 工具（而非所有服务器的全部工具）
- 按需连接节省连接资源
- 支持动态 URL（Skill 场景：用户安装新 MCP 服务器，连接 URL 动态变化）

---

## 5. 动态 Tool Discovery

让 Agent 在运行时动态获取 MCP 工具，无需预先配置：

```go
agent := llmagent.New("dynamic-agent",
    llmagent.WithModel(model),
    llmagent.WithDynamicMCPToolDiscovery(true),
)
```

启用后，Agent 处理流程变为：

```
用户消息
    ↓
LLM 分析 → 需要工具？
    ↓ 是
发起 MCP tools/list → 获取最新工具列表
    ↓
LLM 选择工具 → 调用
    ↓
MCP tools/call → 执行
```

---

## 6. 自建 MCP Server 供 tRPC-Agent-Go 调用

任何实现了 MCP 协议的服务都可以被 tRPC-Agent-Go 调用。以下是一个 Python MCP Server 示例：

```python
# my_mcp_server.py
from mcp.server import Server, stdio_server
from mcp.types import Tool, TextContent

server = Server("my-tools")

@server.list_tools()
async def list_tools():
    return [
        Tool(
            name="get_weather",
            description="Get current weather for a city",
            inputSchema={
                "type": "object",
                "properties": {
                    "city": {"type": "string", "description": "City name"}
                },
                "required": ["city"]
            }
        )
    ]

@server.call_tool()
async def call_tool(name: str, arguments: dict):
    if name == "get_weather":
        city = arguments["city"]
        return [TextContent(type="text", text=f"Weather in {city}: Sunny, 22°C")]

if __name__ == "__main__":
    import asyncio
    asyncio.run(stdio_server(server))
```

Go 侧接入：

```go
ts := mcp.NewMCPToolSet(
    mcp.ConnectionConfig{
        Transport: "stdio",
        Command:   "python",
        Args:      []string{"my_mcp_server.py"},
    },
)

agent := llmagent.New("assistant",
    llmagent.WithModel(model),
    llmagent.WithToolSets([]tool.ToolSet{ts}),
)
```

---

## 7. MCP 工具元数据映射

MCP 协议的 `annotations` 会自动映射到 tRPC-Agent-Go 的 `ToolMetadata`：

| MCP Annotation | ToolMetadata 字段 | 用途 |
|----------------|-------------------|------|
| `readOnlyHint` | `ReadOnly` | 权限策略判断 |
| `destructiveHint` | `Destructive` | 审批流程触发 |
| `openWorldHint` | `OpenWorld` | 结果范围预估 |

```go
// MCP Server 返回的 Tool 定义：
{
    "name": "delete_user",
    "annotations": {
        "destructiveHint": true,
        "readOnlyHint": false
    }
}

// tRPC-Agent-Go 中对应的 ToolMetadata：
// {ReadOnly: false, Destructive: true, OpenWorld: false}
```

---

## 8. 连接生命周期管理

```
ToolSet 创建 ──→ 未连接（懒连接）
                    │
    首次 Tools() 调用 │
                    ▼
              MCP Initialize 握手
                    │
                    ▼
              tools/list 获取工具
                    │
                    ▼
              连接就绪（缓存工具列表）
                    │
     后续 Tools() 调用 → 返回缓存（不重新连接）
                    │
              Close() │
                    ▼
              断开连接 + 清理资源
```

**懒连接优化**：如果 Agent 在整个会话中从未调用该 ToolSet 的工具，连接永远不会建立——节省资源。

**重连机制**：连接意外断开时，下次 `Tools()` 调用自动重连。SSE 和 Streamable HTTP 支持 session reconnection。
