# DeerFlow 项目概览

## 1. 项目简介

DeerFlow (Deep Exploration and Efficient Research Flow) 是字节跳动开源的超级智能体框架（Super Agent Harness），能够研究、编码和创作。

- **GitHub**: https://github.com/bytedance/deer-flow
- **官网**: https://deerflow.tech
- **Star**: 69.6k+ (2026-05)
- **License**: MIT

## 2. 核心定位

DeerFlow 不是简单的 AI Agent，而是一个 **Super Agent Harness** - 一个智能体运行时基础设施，提供：

- **Skills & Tools**: 可扩展的技能和工具系统
- **Sub-Agents**: 动态生成子智能体处理复杂任务
- **Sandbox**: 安全的执行环境和文件系统
- **Memory**: 长期记忆和上下文管理
- **Integration**: IM 渠道、MCP Server 等扩展能力

解决的问题：
- 如何让 AI Agent 执行长时间复杂任务（从分钟到小时）
- 如何安全地执行文件操作和 Shell 命令
- 如何管理多智能体协作和上下文
- 如何扩展 Agent 的能力边界

## 3. 与其他框架对比

| 特性 | DeerFlow | AutoGPT | CrewAI | LangChain Agent |
|------|----------|---------|--------|-----------------|
| 类型 | Super Agent Harness | Autonomous Agent | Multi-Agent Framework | Agent Framework |
| 执行环境 | Sandbox (Docker/K8s) | 本地执行 | 本地执行 | 本地执行 |
| 子代理 | 动态生成 + 隔离 | 固定角色 | 预定义团队 | 单 Agent |
| 技能系统 | Markdown Skills | 内置能力 | 任务分配 | Tools |
| 记忆系统 | 长期记忆 + 上下文压缩 | 本地存储 | 共享记忆 | 可选记忆 |
| 生产部署 | Docker/K8s | 本地 | 本地 | 可选 |
| 开发难度 | 中等 | 低 | 低 | 低 |

核心优势：
- **完整基础设施**: 提供执行环境、记忆系统、工具扩展
- **生产级部署**: 支持 Docker/K8s 部署
- **可扩展性**: Skills、MCP、IM 渠道
- **安全性**: Sandbox 隔离执行

## 4. 技术栈

### 后端
- **语言**: Python 3.12+
- **框架**: FastAPI
- **Agent 框架**: LangGraph (状态机), LangChain (工具链)
- **部署**: Docker, Kubernetes
- **存储**: 文件系统, 向量数据库（可选）

### 前端
- **语言**: Node.js 22+
- **框架**: React
- **包管理**: pnpm

### AI 模型
- **推荐**: DeepSeek v3.2, Kimi 2.5, Doubao-Seed-2.0-Code
- **支持**: OpenAI, Anthropic, OpenRouter, vLLM 等

### 外部集成
- **搜索**: Tavily, InfoQuest
- **即时通讯**: Telegram, Slack, 飞书, 企业微信, 钉钉
- **工具扩展**: MCP (Model Context Protocol)

## 5. 整体架构

```
┌─────────────────────────────────────────────────────────┐
│                     DeerFlow 整体架构                      │
└─────────────────────────────────────────────────────────┘

┌──────────┐      ┌──────────┐      ┌──────────┐
│  前端 UI  │─────▶│ Gateway  │─────▶│ Agent    │
│  (React) │      │ (FastAPI)│      │ Runtime  │
└──────────┘      └──────────┘      └──────────┘
                       │                 │
                       │                 ├─▶ Lead Agent
                       │                 │   ├─▶ Sub-Agent 1
                       │                 │   ├─▶ Sub-Agent 2
                       │                 │   └─▶ Sub-Agent N
                       │                 │
                       │                 ├─▶ Skills
                       │                 │   ├─▶ Research
                       │                 │   ├─▶ Report Gen
                       │                 │   ├─▶ Slide Creation
                       │                 │   └─▶ Custom Skills
                       │                 │
                       │                 ├─▶ Tools
                       │                 │   ├─▶ Web Search
                       │                 │   ├─▶ Web Fetch
                       │                 │   ├─▶ Bash
                       │                 │   └─▶ File Ops
                       │                 │
                       ├─▶ Memory System  │
                       │   ├─▶ Short-term │
                       │   ├─▶ Long-term  │
                       │   └─▶ Context    │
                       │       Compression│
                       │                 │
                       ├─▶ Sandbox       │
                       │   ├─▶ Local     │
                       │   ├─▶ Docker    │
                       │   └─▶ K8s       │
                       │                 │
                       └─▶ Channels      │
                           ├─▶ Telegram  │
                           ├─▶ Slack     │
                           ├─▶ Feishu    │
                           ├─▶ WeCom     │
                           └─▶ DingTalk  │

数据流向：
1. 用户通过前端 UI 或 IM 渠道提交任务
2. Gateway 接收请求并转发到 Agent Runtime
3. Lead Agent 分析任务，可能生成 Sub-Agents
4. Agents 调用 Skills 和 Tools 执行具体工作
5. Sandbox 提供安全的执行环境和文件系统
6. Memory 系统管理上下文和长期记忆
7. 结果返回给用户
```

## 6. 核心模块

### 6.1 Agent 编排架构
- **Lead Agent**: 主代理，负责任务规划和调度
- **Sub-Agents**: 子代理，执行具体子任务
- **LangGraph**: 状态机驱动的 Agent 执行
- **Execution Modes**: Flash/Standard/Pro/Ultra

### 6.2 技能与工具系统
- **Skills**: Markdown 定义的工作流
- **Tools**: Web Search, Web Fetch, Bash, File Ops
- **MCP**: Model Context Protocol 工具扩展

### 6.3 沙箱与执行环境
- **Local Sandbox**: 主机直接执行
- **Docker Sandbox**: 容器隔离执行
- **K8s Sandbox**: Kubernetes Pod 执行
- **文件系统**: /mnt/user-data 结构

### 6.4 记忆与上下文管理
- **短期记忆**: 会话内上下文
- **长期记忆**: 跨会话持久化
- **上下文压缩**: Token 管理和摘要
- **子代理隔离**: 独立上下文环境

## 7. 适用场景

- **深度研究**: 多角度研究并生成报告
- **内容创作**: 自动生成文章、幻灯片、网页
- **代码生成**: 分析需求并编写代码
- **数据处理**: 复杂的数据管道和处理流程
- **自动化工作流**: 长时间的自动化任务执行

## 8. 学习路径

按照渐进式学习路径，本目录包含：

```
deer-flow/
├── 00-项目概览.md          ← 当前文档
├── 01-快速部署.md          ← 下一步
├── 02-Agent编排架构/
│   ├── 部署体验.md
│   ├── 架构理解.md
│   └── 源码分析.md
├── 03-技能与工具系统/
│   ├── 部署体验.md
│   ├── 架构理解.md
│   └── 源码分析.md
├── 04-沙箱与执行环境/
│   ├── 部署体验.md
│   ├── 架构理解.md
│   └── 源码分析.md
├── 05-记忆与上下文管理/
│   ├── 部署体验.md
│   ├── 架构理解.md
│   └── 源码分析.md
├── 06-集成与扩展.md
└── 笔记/
    └── 学习日志.md
```

每个模块的学习流程：
1. **部署体验**: 实际运行，观察现象
2. **架构理解**: 理论分析，绘制架构图
3. **源码分析**: 阅读关键源码，理解实现

---

## 参考资料

- [DeerFlow GitHub](https://github.com/bytedance/deer-flow)
- [DeerFlow 官网](https://deerflow.tech)
- [LangGraph 文档](https://langchain-ai.github.io/langgraph/)
- [LangChain 文档](https://python.langchain.com/)