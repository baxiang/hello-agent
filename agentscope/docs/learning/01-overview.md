# 01 - AgentScope 概览

## 简介

AgentScope 2.0 是阿里巴巴开源的 Python 多 Agent 框架，专为构建生产级智能应用设计。

**核心特性**：
- **ReAct Agent** — 推理+行动循环，支持工具调用
- **工具生态** — 内置 Bash、Grep、Read、Write、Edit 等工具
- **多模型支持** — DashScope、OpenAI、Anthropic、Gemini、Ollama
- **MCP/A2A** — Model Context Protocol、Agent-to-Agent 协议
- **生产级服务** — FastAPI 多租户、Session 管理、权限控制
- **Web UI** — 实时事件渲染前端

## 架构图

```
┌─────────────────────────────────────────────────────────────┐
│                     AgentScope 2.0                          │
├─────────────────────────────────────────────────────────────┤
│  Agent                                                       │
│  ├── reply() / reply_stream()                                │
│  ├── ReAct Loop (Reasoning → Acting)                        │
│  ├── Toolkit (Tools + MCPs + Skills)                        │
│  └── State (Context + Memory)                                │
├─────────────────────────────────────────────────────────────┤
│  Model                                                       │
│  ├── DashScopeChatModel                                      │
│  ├── OpenAIChatModel                                         │
│  ├── AnthropicChatModel                                      │
│  └── ...                                                     │
├─────────────────────────────────────────────────────────────┤
│  Message & Event                                             │
│  ├── UserMsg / AssistantMsg / SystemMsg                     │
│  ├── TextBlock / ToolCallBlock / ToolResultBlock            │
│  └── EventType (REPLY_START, TEXT_BLOCK_DELTA, ...)         │
├─────────────────────────────────────────────────────────────┤
│  Infrastructure                                              │
│  ├── Credential (API Key 管理)                               │
│  ├── Permission (权限控制)                                   │
│  ├── Workspace (记忆存储)                                    │
│  └── MCP Client (外部工具)                                   │
└─────────────────────────────────────────────────────────────┘
```

## 安装

### 从 PyPI 安装

```bash
pip install agentscope
```

### 从源码安装

```bash
git clone https://github.com/modelscope/agentscope.git
cd agentscope
pip install -e .
```

### 前置要求

- **Python 3.11+**
- API Key（DashScope 或 OpenAI）

## 5 分钟 Hello World

```python
import asyncio
from agentscope.agent import Agent
from agentscope.model import DashScopeChatModel
from agentscope.credential import DashScopeCredential
from agentscope.message import UserMsg
import os

async def main():
    agent = Agent(
        name="Friday",
        system_prompt="You're a helpful assistant named Friday.",
        model=DashScopeChatModel(
            credential=DashScopeCredential(
                api_key=os.environ["DASHSCOPE_API_KEY"]
            ),
            model="qwen3.6-plus",
        ),
    )
    
    result = await agent.reply(UserMsg("Tony", "Hi, Friday!"))
    print(result.content)

asyncio.run(main())
```

## 核心模块列表

| 模块 | 职责 | 关键类 |
|---|---|---|
| `agent` | Agent 核心实现 | `Agent`, `ReActConfig` |
| `tool` | 工具管理 | `Toolkit`, `ToolBase`, `Bash`, `Read` |
| `model` | 模型接口 | `ChatModelBase`, `DashScopeChatModel` |
| `message` | 消息定义 | `Msg`, `UserMsg`, `AssistantMsg` |
| `event` | 事件流 | `EventType`, `TextBlockDeltaEvent` |
| `credential` | 凭证管理 | `DashScopeCredential`, `OpenAICredential` |
| `mcp` | MCP 协议 | `MCPClient` |
| `workspace` | 工作区 | `Offloader`, `AgentState` |
| `permission` | 权限控制 | `PermissionEngine` |

## 与其他框架对比

| 特性 | AgentScope | LangChain | AutoGen |
|---|---|---|---|
| ReAct Agent | ✅ 内置 | ✅ 需配置 | ✅ 需配置 |
| 工具调用 | ✅ 流式 | ✅ 非流式 | ✅ 非流式 |
| MCP 支持 | ✅ 内置 | ❌ 无 | ❌ 无 |
| 多租户服务 | ✅ 内置 | ❌ 无 | ❌ 无 |
| Web UI | ✅ 内置 | ❌ 无 | ❌ 无 |
| 中文支持 | ✅ 完整 | ⚠️ 部分 | ⚠️ 部分 |

## 下一步

- [02-agent.md](02-agent.md) — Agent 核心概念
- [03-tool.md](03-tool.md) — Tool & Toolkit
- [04-model.md](04-model.md) — Model 配置

## 参考资源

- 官方文档：https://docs.agentscope.io/
- GitHub：https://github.com/modelscope/agentscope
- 论文：arXiv:2402.14034 (v1), arXiv:2508.16279 (v2)