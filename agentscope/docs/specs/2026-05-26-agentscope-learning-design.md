# AgentScope 学习文档设计规格

日期：2026-05-26
状态：待审核

## 背景

AgentScope 2.0 是阿里巴巴开源的 Python 多 Agent 框架，提供：
- 内置 ReAct Agent、工具、技能
- MCP/A2A 协议支持
- 生产级 FastAPI 服务
- Web UI 前端

用户目标：学习 AgentScope，构建自定义 agents。

## 设计决策

| 需求 | 决策 |
|---|---|
| 目的 | 构建 agents |
| 文档深度 | 学习路径 |
| 覆盖范围 | 全栈（Core + Service + Web UI） |
| 源码获取 | 克隆 + 官方文档 |
| 语言 | 中文 |
| 结构方案 | C（learning + architecture 分离） |
| 实践示例 | 文档嵌入片段 + demo 目录 |

## 目录结构

```
agentscope/
├── src/                          # 官方源码（已克隆）
│   ├── src/agentscope/           # 198 Python 文件
│   ├── examples/                 # agent_service + web_ui
│   └── tests/                    # 54 测试文件
├── demo/                         # 实践示例
│   ├── README.md
│   ├── 01-hello-agent/
│   ├── 02-tool-agent/
│   ├── 03-stream-agent/
│   ├── 04-memory-agent/
│   ├── 05-mcp-agent/
│   ├── 06-multi-agent/
│   └── 07-service/
└── docs/                         # 学习文档
    ├── README.md                 # 总索引
    ├── learning/                 # 学习路径
    │   ├── 01-overview.md
    │   ├── 02-agent.md
    │   ├── 03-tool.md
    │   ├── 04-model.md
    │   ├── 05-message.md
    │   ├── 06-memory.md
    │   ├── 07-mcp-a2a.md
    │   ├── 08-service.md
    │   ├── 09-webui.md
    │   ├── 10-knowledge.md
    │   └── README.md
    └── architecture/             # 源码分析
        ├── README.md
        └── modules/
            ├── agent.md
            ├── tool.md
            ├── model.md
            ├── message.md
            ├── memory.md
            ├── mcp.md
            ├── credential.md
            ├── service.md
            └── webui.md
```

## 学习路径内容

| 文档 | 核心内容 | 学习目标 |
|---|---|
| 01-overview | AgentScope 2.0 定位、特性、安装 | 5 分钟快速上手 |
| 02-agent | Agent 类、ReAct 模式、reply/reply_stream | 理解 Agent 核心抽象 |
| 03-tool | Toolkit、内置工具、自定义工具 | 掌握工具集成 |
| 04-model | DashScope/OpenAI/LiteLLM、Credential、流式调用 | 配置模型服务 |
| 05-message | UserMsg/AgentMsg、Event 流、EventType | 理解消息与事件系统 |
| 06-memory | Memory 类型、存储后端、检索策略 | 实现记忆能力 |
| 07-mcp-a2a | MCP Server/Client、A2A 协议、集成示例 | 外部协议对接 |
| 08-service | FastAPI 多租户、Session 管理、权限控制 | 生产级部署 |
| 09-webui | 前端结构、Agent 交互、实时事件渲染 | Web 界面开发 |
| 10-knowledge | Python 3.11+、asyncio、FastAPI、Pydantic | 前置技术清单 |

## 架构分析内容

每个模块分析包含：
- 类图/接口定义
- 关键方法签名
- 代码片段（从源码提取）
- 设计模式分析

| 模块 | 源码路径 | 文件数 |
|---|---|---|
| agent | `src/agentscope/agent/` | 6 |
| tool | `src/agentscope/tool/` | 13 |
| model | `src/agentscope/model/` | 16 |
| message | `src/agentscope/message/` | 5 |
| memory | `src/agentscope/workspace/` | 11 |
| mcp | `src/agentscope/mcp/` | 5 |
| credential | `src/agentscope/credential/` | 14 |
| service | `examples/agent_service/` | - |
| webui | `examples/web_ui/` | - |

## Demo 示例内容

每个示例：
- 单文件可运行（main.py）
- 关键步骤注释
- 对应 learning 文档章节

| 示例 | 内容 |
|---|---|
| 01-hello-agent | 最简 Agent 创建和回复 |
| 02-tool-agent | Toolkit 工具调用 |
| 03-stream-agent | reply_stream 流式响应处理 |
| 04-memory-agent | Memory 配置和使用 |
| 05-mcp-agent | MCP Server/Client 集成 |
| 06-multi-agent | 多 Agent 协作流程 |
| 07-service | FastAPI Agent Service 启动 |

## 源码统计

| 类别 | 数量 |
|---|---|
| Python 源码 | 198 文件 |
| Tests | 54 文件 |
| Examples | agent_service + web_ui |

## 参考资源

- 官方文档：https://docs.agentscope.io/
- GitHub：https://github.com/modelscope/agentscope
- 论文：arXiv:2402.14034 (AgentScope 1.0), arXiv:2508.16279 (AgentScope 2.0)

## 实施计划

1. 创建目录结构
2. 编写 learning 文档（10 个）
3. 编写 architecture 文档（9 个模块 + README）
4. 创建 demo 示例（7 个）
5. 编写总索引 README

## 验收标准

- 所有文档中文撰写
- learning 文档包含可运行代码片段
- architecture 文档包含类图和关键代码
- demo 示例可独立运行
- 与 hiclaw 文档风格一致