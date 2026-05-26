# AgentScope 学习路径

## 学习顺序

推荐按以下顺序学习：

| 序号 | 文档 | 核心内容 | 预计时间 |
|---|---|---|---|
| 1 | [01-overview](01-overview.md) | 概览与安装 | 10 分钟 |
| 2 | [02-agent](02-agent.md) | Agent 核心概念 | 20 分钟 |
| 3 | [03-tool](03-tool.md) | Tool & Toolkit | 15 分钟 |
| 4 | [04-model](04-model.md) | Model 配置 | 15 分钟 |
| 5 | [05-message](05-message.md) | Message & Event | 15 分钟 |
| 6 | [06-memory](06-memory.md) | Memory 系统 | 20 分钟 |
| 7 | [07-mcp-a2a](07-mcp-a2a.md) | MCP/A2A 集成 | 25 分钟 |
| 8 | [08-service](08-service.md) | Agent Service | 20 分钟 |
| 9 | [09-webui](09-webui.md) | Web UI | 15 分钟 |
| 10 | [10-knowledge](10-knowledge.md) | 前置知识清单 | 10 分钟 |

**总计：约 2.5 小时**

## Demo 示例对应

| Demo | 对应章节 | 说明 |
|---|---|---|
| [01-hello-agent](../../demo/01-hello-agent) | 02-agent | 最简 Agent |
| [02-tool-agent](../../demo/02-tool-agent) | 03-tool | 工具调用 |
| [03-stream-agent](../../demo/03-stream-agent) | 05-message | 流式响应 |
| [04-memory-agent](../../demo/04-memory-agent) | 06-memory | 记忆系统 |
| [05-mcp-agent](../../demo/05-mcp-agent) | 07-mcp-a2a | MCP 集成 |
| [06-multi-agent](../../demo/06-multi-agent) | 02-agent | 多 Agent 协作 |
| [07-service](../../demo/07-service) | 08-service | Agent Service |

## 核心概念速览

### Agent

Agent 是 AgentScope 的核心，实现 ReAct 循环：
- `reply()` — 同步返回最终消息
- `reply_stream()` — 流式返回事件

### Toolkit

Toolkit 管理工具、MCP 和 Skills：
- 内置工具：Bash、Read、Write、Edit、Grep、Glob
- MCP Client：外部工具协议
- Skills：Agent 扩展能力

### Model

支持多种模型服务：
- DashScope（阿里云）
- OpenAI
- Anthropic
- Gemini
- Ollama（本地）

### Event

事件流支持实时渲染：
- TEXT_BLOCK_DELTA — 文本增量
- TOOL_CALL_START — 工具调用开始
- REPLY_END — 回复结束

## 快速开始

```bash
pip install agentscope
```

```python
import asyncio
from agentscope.agent import Agent
from agentscope.model import OpenAIChatModel
from agentscope.message import UserMsg

async def main():
    agent = Agent(
        name="Assistant",
        model=OpenAIChatModel(model="gpt-4"),
    )
    result = await agent.reply(UserMsg("user", "Hello!"))
    print(result.content)

asyncio.run(main())
```

## 参考资源

- 官方文档：https://docs.agentscope.io/
- GitHub：https://github.com/modelscope/agentscope
- 架构分析：[../architecture/README.md](../architecture/README.md)