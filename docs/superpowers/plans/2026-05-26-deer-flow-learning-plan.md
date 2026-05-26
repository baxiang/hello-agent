# DeerFlow 技术学习实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 创建 deer-flow 学习目录结构并编写阶段0学习文档

**Architecture:** 先创建目录结构，然后从阶段0开始，逐步编写每个学习阶段的文档

**Tech Stack:** Markdown 文档、DeerFlow 源码分析

---

## 文件结构

**创建文件:**
- `deer-flow/` - 学习目录
- `deer-flow/00-项目概览.md` - 项目介绍文档
- `deer-flow/01-快速部署.md` - 部署指南文档
- `deer-flow/笔记/学习日志.md` - 学习笔记

**暂不创建:**
- 各模块的详细文档（将在后续阶段创建）

---

### Task 1: 创建 deer-flow 目录结构

**Files:**
- Create: `deer-flow/`
- Create: `deer-flow/02-Agent编排架构/`
- Create: `deer-flow/03-技能与工具系统/`
- Create: `deer-flow/04-沙箱与执行环境/`
- Create: `deer-flow/05-记忆与上下文管理/`
- Create: `deer-flow/笔记/`

- [ ] **Step 1: 创建主目录和子目录**

```bash
mkdir -p deer-flow/02-Agent编排架构
mkdir -p deer-flow/03-技能与工具系统
mkdir -p deer-flow/04-沙箱与执行环境
mkdir -p deer-flow/05-记忆与上下文管理
mkdir -p deer-flow/笔记
```

- [ ] **Step 2: 验证目录结构**

```bash
ls -la deer-flow/
```

Expected: 看到所有创建的子目录

---

### Task 2: 编写项目概览文档

**Files:**
- Create: `deer-flow/00-项目概览.md`

- [ ] **Step 1: 编写文档内容**

创建文件内容包含：
1. DeerFlow 项目简介
2. 核心定位和解决的问题
3. 与其他 Agent 框架对比
4. 技术栈概览
5. 整体架构图

```markdown
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
```

- [ ] **Step 2: 创建文件**

```bash
touch deer-flow/00-项目概览.md
```

- [ ] **Step 3: 写入内容**

将上述 Markdown 内容写入文件

- [ ] **Step 4: 验证文件**

```bash
cat deer-flow/00-项目概览.md | head -20
```

Expected: 看到 Markdown 内容前 20 行

---

### Task 3: 编写快速部署指南

**Files:**
- Create: `deer-flow/01-快速部署.md`

- [ ] **Step 1: 编写部署指南内容**

包含：
1. 前置要求
2. Docker 部署（推荐）
3. 本地开发部署
4. 基础配置
5. 第一个任务执行

```markdown
# DeerFlow 快速部署指南

## 1. 前置要求

### 1.1 系统要求

| 部署方式 | 最低配置 | 推荐配置 |
|---------|---------|---------|
| 本地开发 | 4 vCPU, 8 GB RAM | 8 vCPU, 16 GB RAM |
| Docker Dev | 4 vCPU, 8 GB RAM | 8 vCPU, 16 GB RAM |
| 生产部署 | 8 vCPU, 16 GB RAM | 16 vCPU, 32 GB RAM |

### 1.2 必备工具

- **Git**: 用于克隆仓库
- **Docker**: 用于容器化部署（推荐）
- **Node.js 22+**: 前端依赖（本地开发需要）
- **Python 3.12+**: 后端依赖（本地开发需要）
- **uv**: Python 包管理器（本地开发需要）
- **pnpm**: Node 包管理器（本地开发需要）

检查命令：
```bash
# 检查 Git
git --version

# 检查 Docker
docker --version

# 检查 Node.js（本地开发）
node --version  # 需要 >= 22

# 检查 Python（本地开发）
python3 --version  # 需要 >= 3.12

# 检查 uv（本地开发）
uv --version

# 检查 pnpm（本地开发）
pnpm --version
```

### 1.3 LLM API Key

推荐模型：
- **DeepSeek v3.2**: 性价比高，适合中文
- **Kimi 2.5**: Moonshot AI，中文效果好
- **Doubao-Seed-2.0-Code**: 字节跳动，代码能力强

获取 API Key：
- DeepSeek: https://platform.deepseek.com/
- Kimi: https://platform.moonshot.cn/
- OpenAI: https://platform.openai.com/

## 2. Docker 部署（推荐）

### 2.1 克隆仓库

```bash
git clone https://github.com/bytedance/deer-flow.git
cd deer-flow
```

### 2.2 运行配置向导

```bash
make setup
```

向导会引导你：
1. 选择 LLM Provider
2. 输入 API Key
3. 配置 Web Search（可选）
4. 选择 Sandbox 模式

生成的配置文件：
- `config.yaml`: 主配置文件
- `.env`: 环境变量（包含 API Key）

### 2.3 启动服务

```bash
# 拉取沙箱镜像（首次或镜像更新时）
make docker-init

# 启动开发服务（热重载）
make docker-start
```

启动后访问: http://localhost:2026

### 2.4 验证部署

```bash
# 检查服务状态
make doctor

# 查看日志
docker logs deer-flow-gateway
```

### 2.5 停止服务

```bash
make docker-stop
```

## 3. 本地开发部署

### 3.1 安装依赖

```bash
# 克隆仓库
git clone https://github.com/bytedance/deer-flow.git
cd deer-flow

# 运行配置向导
make setup

# 安装所有依赖
make install
```

### 3.2 启动开发服务

```bash
# 前台启动
make dev

# 或后台启动
make dev-daemon
```

启动后访问: http://localhost:2026

### 3.3 停止服务

```bash
make stop
```

### 3.4 检查服务

```bash
# 检查配置
make doctor

# 检查依赖
make check
```

## 4. 基础配置

### 4.1 config.yaml 结构

```yaml
# LLM 配置
models:
  - name: deepseek-v3
    display_name: DeepSeek V3
    use: langchain_openai:ChatOpenAI
    model: deepseek-chat
    api_key: $DEEPSEEK_API_KEY
    base_url: https://api.deepseek.com/v1

# Sandbox 配置
sandbox:
  use: deerflow.community.aio_sandbox:AioSandboxProvider
  mode: docker  # local 或 docker

# Web Search（可选）
web_search:
  provider: tavily
  api_key: $TAVILY_API_KEY
```

### 4.2 .env 文件

```bash
# LLM API Keys
DEEPSEEK_API_KEY=your-deepseek-api-key
OPENAI_API_KEY=your-openai-api-key
KIMI_API_KEY=your-kimi-api-key

# Web Search（可选）
TAVILY_API_KEY=your-tavily-api-key

# Tracing（可选）
LANGSMITH_TRACING=true
LANGSMITH_API_KEY=your-langsmith-key
```

### 4.3 手动配置

如果不想使用向导：

```bash
# 复制配置模板
make config

# 编辑 config.yaml
vim config.yaml

# 编辑 .env
vim .env
```

## 5. 执行第一个任务

### 5.1 通过 Web UI

1. 打开浏览器访问 http://localhost:2026
2. 在聊天框输入任务，例如：
   ```
   研究 2026 年 AI Agent 发展趋势，生成一份简要报告
   ```
3. 观察任务执行过程：
   - Lead Agent 分析任务
   - 可能生成 Sub-Agents
   - 使用 Research Skill
   - 生成 Report
4. 查看结果和输出文件

### 5.2 通过 API

```bash
# 创建 thread
curl -X POST http://localhost:2026/api/langgraph/threads \
  -H "Content-Type: application/json" \
  -d '{}'

# 返回: {"thread_id": "xxx"}

# 创建 run
curl -X POST http://localhost:2026/api/langgraph/threads/{thread_id}/runs \
  -H "Content-Type: application/json" \
  -d '{
    "assistant_id": "lead_agent",
    "input": {
      "messages": [{"role": "user", "content": "研究 AI Agent 发展趋势"}]
    }
  }'

# 流式获取结果
curl -X GET http://localhost:2026/api/langgraph/threads/{thread_id}/runs/{run_id}/stream
```

### 5.3 观察执行过程

查看日志：
```bash
# Docker 部署
docker logs -f deer-flow-gateway

# 本地部署
tail -f .deer-flow/logs/gateway.log
```

观察关键信息：
- Agent 状态转换
- Sub-Agent 创建和执行
- Tool 调用记录
- Token 使用情况

## 6. 常见问题

### 6.1 Docker 权限问题

```bash
# Linux 上需要加入 docker 组
sudo usermod -aG docker $USER
newgrp docker

# 重新登录后重试
```

### 6.2 API Key 配置错误

```bash
# 检查 .env 文件
cat .env | grep API_KEY

# 确保没有多余空格或引号
DEEPSEEK_API_KEY=sk-xxxx  # 正确
DEEPSEEK_API_KEY="sk-xxxx"  # 错误（某些情况下）
```

### 6.3 端口占用

```bash
# 检查端口占用
lsof -i :2026

# 修改端口（config.yaml）
gateway:
  port: 3000
```

### 6.4 依赖安装失败

```bash
# 清理并重新安装
make clean
make install
```

## 7. 下一步

完成部署后：
- 阅读 `02-Agent编排架构/部署体验.md` 学习 Agent 编排
- 尝试不同执行模式（Flash/Standard/Pro/Ultra）
- 查看生成的文件和输出结果
- 开始源码分析阶段

---

## 部署记录

部署日期：____________
部署方式：____________
LLM Provider：____________
遇到的问题：____________
解决方案：____________

---

## 参考资料

- [Install.md](https://github.com/bytedance/deer-flow/blob/main/Install.md)
- [CONTRIBUTING.md](https://github.com/bytedance/deer-flow/blob/main/CONTRIBUTING.md)
- [config.example.yaml](https://github.com/bytedance/deer-flow/blob/main/config.example.yaml)
```

- [ ] **Step 2: 创建文件**

```bash
touch deer-flow/01-快速部署.md
```

- [ ] **Step 3: 写入内容**

将上述 Markdown 内容写入文件

- [ ] **Step 4: 验证文件**

```bash
cat deer-flow/01-快速部署.md | head -20
```

Expected: 看到 Markdown 内容前 20 行

---

### Task 4: 创建学习日志模板

**Files:**
- Create: `deer-flow/笔记/学习日志.md`

- [ ] **Step 1: 编写学习日志模板**

```markdown
# DeerFlow 学习日志

## 学习进度跟踪

| 阶段 | 状态 | 完成日期 | 主要收获 |
|------|------|----------|----------|
| 0. 项目概览与部署 | ⬜ 未开始 | - | - |
| 1. Agent 编排架构 | ⬜ 未开始 | - | - |
| 2. 技能与工具系统 | ⬜ 未开始 | - | - |
| 3. 沙箱与执行环境 | ⬜ 未开始 | - | - |
| 4. 记忆与上下文管理 | ⬜ 未开始 | - | - |
| 5. 集成与扩展 | ⬜ 未开始 | - | - |

状态标记：
- ⬜ 未开始
- 🔄 进行中
- ✅ 已完成
- ⏸️ 暂停

---

## 阶段 0: 项目概览与部署

**开始时间**: ____________

### 学习内容
- [ ] 阅读 README 和项目概览
- [ ] 理解 DeerFlow 定位和核心特性
- [ ] 完成环境搭建
- [ ] 运行第一个任务
- [ ] 观察执行流程

### 实践记录

#### 部署过程
部署方式: ____________
遇到的问题:
1. ____________
2. ____________

解决方案:
1. ____________
2. ____________

#### 第一个任务
任务内容: ____________
执行模式: ____________
执行时间: ____________
结果评价: ____________

### 关键收获

1. DeerFlow 核心定位理解:
   - Super Agent Harness vs Agent Framework
   - 提供完整基础设施
   - 生产级部署能力

2. 技术栈概览:
   - LangGraph 状态机
   - LangChain 工具链
   - Docker/K8s 部署

3. 整体架构理解:
   - Gateway + Agent Runtime
   - Lead Agent + Sub-Agents
   - Skills + Tools + Sandbox + Memory

### 问题与思考

Q1: DeerFlow 与 AutoGPT/CrewAI 的本质区别？
A1: ____________

Q2: 为什么选择 LangGraph 作为 Agent 框架？
A2: ____________

Q3: Sandbox 的安全隔离机制是如何实现的？
A3: ____________

### 下一步计划

优先级排序:
1. ____________
2. ____________
3. ____________

---

## 阶段 1: Agent 编排架构

**开始时间**: ____________

### 部署体验
- [ ] 创建复杂任务
- [ ] 观察任务分解
- [ ] 测试不同执行模式
- [ ] 观察子代理协作

### 架构理解
- [ ] 学习 LangGraph 状态机
- [ ] 理解 Lead Agent 设计
- [ ] 分析子代理调度策略
- [ ] 绘制架构图

### 源码分析
- [ ] 阅读 lead_agent.py
- [ ] 阅读 sub_agent.py
- [ ] 阅读 graph.py
- [ ] 记录关键函数

### 关键发现

#### LangGraph 状态机
状态定义: ____________
转换规则: ____________

#### 子代理调度
创建时机: ____________
调度策略: ____________
结果合并: ____________

### 代码片段记录

```python
# 关键代码片段 1

# 关键代码片段 2
```

---

## 阶段 2: 技能与工具系统

（待阶段 1 完成后填写）

---

## 阶段 3: 沙箱与执行环境

（待阶段 2 完成后填写）

---

## 阶段 4: 记忆与上下文管理

（待阶段 3 完成后填写）

---

## 阶段 5: 集成与扩展

（待阶段 4 完成后填写）

---

## 总体收获与反思

### 技术层面
1. ____________
2. ____________
3. ____________

### 实践层面
1. ____________
2. ____________
3. ____________

### 可改进之处
1. ____________
2. ____________

### 后续计划
1. ____________
2. ____________
3. ____________

---

## 参考资料

- [官方文档](https://deerflow.tech)
- [GitHub 仓库](https://github.com/bytedance/deer-flow)
- [LangGraph 文档](https://langchain-ai.github.io/langgraph/)
- [LangChain 文档](https://python.langchain.com/)
```

- [ ] **Step 2: 创建文件并写入内容**

```bash
touch deer-flow/笔记/学习日志.md
```

写入上述内容

- [ ] **Step 3: 验证**

```bash
ls -la deer-flow/笔记/
```

Expected: 看到学习日志.md 文件

---

### Task 5: 创建模块子目录的占位文件

**Files:**
- Create: `deer-flow/02-Agent编排架构/部署体验.md`
- Create: `deer-flow/02-Agent编排架构/架构理解.md`
- Create: `deer-flow/02-Agent编排架构/源码分析.md`
- （其他模块类似）

- [ ] **Step 1: 创建占位文件**

为每个模块创建占位文件，提示后续填写：

```bash
# Agent 编排架构模块
touch deer-flow/02-Agent编排架构/部署体验.md
touch deer-flow/02-Agent编排架构/架构理解.md
touch deer-flow/02-Agent编排架构/源码分析.md

# 技能与工具系统模块
touch deer-flow/03-技能与工具系统/部署体验.md
touch deer-flow/03-技能与工具系统/架构理解.md
touch deer-flow/03-技能与工具系统/源码分析.md

# 沙箱与执行环境模块
touch deer-flow/04-沙箱与执行环境/部署体验.md
touch deer-flow/04-沙箱与执行环境/架构理解.md
touch deer-flow/04-沙箱与执行环境/源码分析.md

# 记忆与上下文管理模块
touch deer-flow/05-记忆与上下文管理/部署体验.md
touch deer-flow/05-记忆与上下文管理/架构理解.md
touch deer-flow/05-记忆与上下文管理/源码分析.md
```

- [ ] **Step 2: 写入占位内容**

每个文件写入占位内容：

```markdown
# [模块名称] - [文档类型]

**状态**: ⬜ 未开始

**计划开始时间**: 完成前一阶段后

---

## 内容大纲

（待填写）

---

## 学习记录

（待填写）
```

- [ ] **Step 3: 验证文件结构**

```bash
tree deer-flow/ -L 2
```

Expected: 看到完整的目录树结构

---

### Task 6: 验证整体完成度

**Files:**
- Verify: 所有创建的文件

- [ ] **Step 1: 检查目录结构**

```bash
ls -R deer-flow/
```

Expected: 看到所有文件和目录

- [ ] **Step 2: 统计文件数量**

```bash
find deer-flow -type f | wc -l
```

Expected: 至少 15+ 个文件

- [ ] **Step 3: 查看主要文档**

```bash
wc -l deer-flow/00-项目概览.md
wc -l deer-flow/01-快速部署.md
```

Expected: 每个文档至少 100+ 行

---

## 自审检查清单

### 1. 规格覆盖检查

对照学习设计文档，检查以下内容是否在计划中有对应任务：

- [x] 创建 deer-flow 目录结构
- [x] 编写项目概览文档（00-项目概览.md）
- [x] 编写快速部署文档（01-快速部署.md）
- [x] 创建学习日志模板
- [x] 创建各模块子目录和占位文件
- [x] 验证整体完成度

无遗漏内容。

### 2. 占位符扫描

检查计划中是否有以下问题：
- [x] 没有 "TBD", "TODO", "implement later" 等
- [x] 没有 "Add appropriate error handling" 等模糊描述
- [x] 所有代码步骤都有实际代码
- [x] 所有命令都有具体执行内容
- [x] 没有未定义的类型或函数引用

无占位符问题。

### 3. 类型一致性检查

- [x] 文件路径在所有任务中一致
- [x] 目录名称一致
- [x] 命令语法正确

无类型不一致问题。

---

## 执行说明

本计划已完成自审，可以开始执行。

执行方式选择：
1. **Subagent-Driven (推荐)**: 使用 superpowers:subagent-driven-development，每个任务独立子代理执行，任务间可审查
2. **Inline Execution**: 使用 superpowers:executing-plans，批量执行，设置检查点审查

建议选择 Subagent-Driven 方式，因为：
- 学习文档编写适合独立任务
- 可在任务间调整内容
- 更灵活的迭代