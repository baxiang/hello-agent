# AgentScope Demo 示例

## 示例列表

| 示例 | 说明 | 对应章节 |
|---|---|---|
| [01-hello-agent](01-hello-agent) | 最简 Agent | [02-agent](../docs/learning/02-agent.md) |
| [02-tool-agent](02-tool-agent) | 工具调用 | [03-tool](../docs/learning/03-tool.md) |
| [03-stream-agent](03-stream-agent) | 流式响应 | [05-message](../docs/learning/05-message.md) |
| [04-memory-agent](04-memory-agent) | 记忆系统 | [06-memory](../docs/learning/06-memory.md) |
| [05-mcp-agent](05-mcp-agent) | MCP 集成 | [07-mcp-a2a](../docs/learning/07-mcp-a2a.md) |
| [06-multi-agent](06-multi-agent) | 多 Agent 协作 | [02-agent](../docs/learning/02-agent.md) |
| [07-service](07-service) | Agent Service | [08-service](../docs/learning/08-service.md) |

## 运行前置条件

- **Python 3.11+**
- API Key（DashScope 或 OpenAI）

```bash
# 安装 AgentScope
pip install agentscope

# 设置 API Key
export DASHSCOPE_API_KEY="your-api-key"
export OPENAI_API_KEY="your-api-key"
```

## 快速开始

```bash
cd demo/01-hello-agent
python main.py
```

## 示例说明

### 01-hello-agent

最简 Agent 示例，展示 Agent 创建和基本回复。

### 02-tool-agent

工具调用示例，展示 Toolkit 和内置工具使用。

### 03-stream-agent

流式响应示例，展示 reply_stream 事件处理。

### 04-memory-agent

记忆系统示例，展示 Context 和 Session 管理。

### 05-mcp-agent

MCP 集成示例，展示 MCP Client 配置和工具发现。

### 06-multi-agent

多 Agent 协作示例，展示 Agent 间消息传递。

### 07-service

Agent Service 示例，展示 FastAPI 服务启动。