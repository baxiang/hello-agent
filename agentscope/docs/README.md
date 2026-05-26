# AgentScope 学习文档

## 简介

AgentScope 2.0 是阿里巴巴开源的 Python 多 Agent 框架，提供：

- **内置 ReAct Agent** — 推理+行动循环，工具调用
- **工具生态** — Bash、Grep、Read、Write、Edit 等内置工具
- **模型集成** — DashScope、OpenAI、LiteLLM 多模型支持
- **MCP/A2A** — Model Context Protocol、Agent-to-Agent 协议
- **生产级服务** — FastAPI 多租户、Session 管理
- **Web UI** — 实时事件渲染前端

## 文档结构

```
docs/
├── learning/          # 学习路径（渐进式）
│   ├── 01-overview.md
│   ├── 02-agent.md
│   ├── ...
│   └── 10-knowledge.md
├── architecture/      # 源码分析
│   ├── README.md
│   └── modules/
│       ├── agent.md
│       ├── tool.md
│       └── ...
└── specs/             # 设计规格
```

## 学习路径推荐顺序

| 文档 | 内容 | 预计时间 |
|---|---|---|
| [01-overview](learning/01-overview.md) | 概览与安装 | 10 分钟 |
| [02-agent](learning/02-agent.md) | Agent 核心概念 | 20 分钟 |
| [03-tool](learning/03-tool.md) | Tool & Toolkit | 15 分钟 |
| [04-model](learning/04-model.md) | Model 配置 | 15 分钟 |
| [05-message](learning/05-message.md) | Message & Event | 15 分钟 |
| [06-memory](learning/06-memory.md) | Memory 系统 | 20 分钟 |
| [07-mcp-a2a](learning/07-mcp-a2a.md) | MCP/A2A 集成 | 25 分钟 |
| [08-service](learning/08-service.md) | Agent Service | 20 分钟 |
| [09-webui](learning/09-webui.md) | Web UI | 15 分钟 |
| [10-knowledge](learning/10-knowledge.md) | 前置知识清单 | 10 分钟 |

## Demo 示例

| 示例 | 对应章节 | 说明 |
|---|---|---|
| `demo/01-hello-agent` | 02-agent | 最简 Agent |
| `demo/02-tool-agent` | 03-tool | 工具调用 |
| `demo/03-stream-agent` | 05-message | 流式响应 |
| `demo/04-memory-agent` | 06-memory | 记忆系统 |
| `demo/05-mcp-agent` | 07-mcp-a2a | MCP 集成 |
| `demo/06-multi-agent` | 02-agent | 多 Agent 协作 |
| `demo/07-service` | 08-service | Agent Service |

## 快速开始

```bash
# 安装
pip install agentscope

# Hello World
from agentscope.agent import Agent
from agentscope.model import OpenAIChatModel
from agentscope.message import UserMsg

agent = Agent(
    name="Demo",
    model=OpenAIChatModel(model="gpt-4"),
)
result = agent.reply(UserMsg("Hello!"))
print(result.content)
```

## 参考资源

- 官方文档：https://docs.agentscope.io/
- GitHub：https://github.com/modelscope/agentscope
- 论文：arXiv:2402.14034 (v1), arXiv:2508.16279 (v2)