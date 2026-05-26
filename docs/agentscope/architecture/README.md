# AgentScope 架构总览

## 源码统计

| 类别 | 数量 |
|---|---|
| Python 源码 | 198 文件 |
| Tests | 54 文件 |
| Examples | agent_service + web_ui |

## 模块结构

```
src/agentscope/
├── agent/              # Agent 核心 (6 文件)
│   ├── _agent.py       # Agent 类 (1386 行)
│   ├── _config.py      # 配置类
│   └── _utils.py       # 工具函数
├── tool/               # 工具管理 (13 文件)
│   ├── _toolkit.py     # Toolkit 类 (601 行)
│   ├── _base.py        # Tool 基类
│   ├── _builtin/       # 内置工具
│   └── _task/          # 任务工具
├── model/              # 模型接口 (16 文件)
│   ├── _base.py        # Model 基类
│   ├── _dashscope.py   # DashScope 实现
│   ├── _openai_chat.py # OpenAI 实现
│   └── ...
├── message/            # 消息定义 (5 文件)
│   ├── _base.py        # Msg 类
│   ├── _block.py       # ContentBlock 类型
├── event/              # 事件系统 (4 文件)
│   ├── _event.py       # Event 类定义
├── credential/         # 凭证管理 (14 文件)
│   ├── _base.py        # Credential 基类
│   ├── _dashscope.py   # DashScope Credential
├── mcp/                # MCP 协议 (5 文件)
│   ├── _mcp_client.py  # MCP Client
│   ├── _config.py      # MCP 配置
├── workspace/          # 工作区 (11 文件)
│   ├── Offloader       # 外部存储
├── state/              # 状态管理 (5 文件)
│   ├── _state.py       # AgentState
│   ├── _task.py        # Task 状态
├── permission/         # 权限控制 (6 文件)
│   ├── _engine.py      # Permission Engine
│   ├── _rule.py        # Permission Rule
├── skill/              # Skills (4 文件)
│   ├── _base.py        # Skill 基类
│   ├── _local_loader.py# 本地加载
├── formatter/          # 格式化 (13 文件)
│   ├── _formatter_base.py
│   ├── _openai_formatter.py
│   └── ...
├── embedding/          # Embedding (13 文件)
│   ├── _embedding_base.py
│   └── ...
├── middleware/         # 中间件 (4 文件)
│   ├── MiddlewareBase  # 中间件基类
├── types/              # 类型定义 (5 文件)
│   ├── _object.py
│   ├── _json.py
├── exception/          # 异常 (4 文件)
│   ├── _base.py
│   ├── _tool.py
└── _utils/             # 工具函数 (4 文件)
```

## 核心依赖关系

```
┌─────────────────────────────────────────────────────────────┐
│                        Agent                                 │
│  ┌───────────┐  ┌───────────┐  ┌───────────┐  ┌───────────┐│
│  │   Model   │  │  Toolkit  │  │   State   │  │Middleware ││
│  └───────────┘  └───────────┘  └───────────┘  └───────────┘│
│        │              │              │              │       │
│        ▼              ▼              ▼              ▼       │
│  ┌───────────┐  ┌───────────┐  ┌───────────┐              │
│  │Credential │  │Tool/MCP   │  │Workspace  │              │
│  └───────────┘  └───────────┘  └───────────┘              │
│                       │                                     │
│                       ▼                                     │
│               ┌───────────┐                                │
│               │Permission │                                │
│               └───────────┘                                │
└─────────────────────────────────────────────────────────────┘
```

## 设计模式

| 模式 | 应用位置 |
|---|---|
| **策略模式** | Model 实现（DashScope/OpenAI/Anthropic 等） |
| **工厂模式** | Credential Factory |
| **观察者模式** | Event 流（reply_stream） |
| **中间件模式** | Agent 中间件钩子 |
| **状态模式** | AgentState、ToolCallState |

## 模块详细分析

| 模块 | 文档 |
|---|---|
| agent | [modules/agent.md](modules/agent.md) |
| tool | [modules/tool.md](modules/tool.md) |
| model | [modules/model.md](modules/model.md) |
| message | [modules/message.md](modules/message.md) |
| memory | [modules/memory.md](modules/memory.md) |
| mcp | [modules/mcp.md](modules/mcp.md) |
| credential | [modules/credential.md](modules/credential.md) |
| service | [modules/service.md](modules/service.md) |
| webui | [modules/webui.md](modules/webui.md) |

## 阅读路径推荐

### 入门路径

```
1. __init__.py → 包入口
2. agent/_agent.py → Agent 核心实现
3. tool/_toolkit.py → 工具管理
4. message/_base.py → 消息定义
5. event/_event.py → 事件类型
```

### 进阶路径

```
1. model/_base.py → Model 抽象
2. credential/_factory.py → Credential 工厂
3. permission/_engine.py → 权限引擎
4. workspace/ → 工作区管理
5. formatter/ → 各模型格式化
```