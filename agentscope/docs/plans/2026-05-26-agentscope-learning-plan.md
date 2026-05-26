# AgentScope 学习文档实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 创建 AgentScope 2.0 中文学习文档（learning + architecture）和可运行 demo 示例

**Architecture:** 
- learning 文档按渐进顺序编写，每个文档内嵌代码片段
- architecture 文档分析源码模块，提取类图和关键代码
- demo 示例单文件可运行，对应 learning 章节

**Tech Stack:** Python 3.11+、Markdown、AgentScope 2.0

---

## Task 1: 创建目录结构

**Files:**
- Create: `docs/README.md`
- Create: `docs/learning/README.md`
- Create: `docs/architecture/README.md`
- Create: `demo/README.md`

- [ ] **Step 1: 创建目录**

```bash
mkdir -p /Users/baxiang/Documents/hello-agent/agentscope/docs/learning
mkdir -p /Users/baxiang/Documents/hello-agent/agentscope/docs/architecture/modules
mkdir -p /Users/baxiang/Documents/hello-agent/agentscope/demo/01-hello-agent
mkdir -p /Users/baxiang/Documents/hello-agent/agentscope/demo/02-tool-agent
mkdir -p /Users/baxiang/Documents/hello-agent/agentscope/demo/03-stream-agent
mkdir -p /Users/baxiang/Documents/hello-agent/agentscope/demo/04-memory-agent
mkdir -p /Users/baxiang/Documents/hello-agent/agentscope/demo/05-mcp-agent
mkdir -p /Users/baxiang/Documents/hello-agent/agentscope/demo/06-multi-agent
mkdir -p /Users/baxiang/Documents/hello-agent/agentscope/demo/07-service
```

- [ ] **Step 2: 验证目录结构**

Run: `ls -la /Users/baxiang/Documents/hello-agent/agentscope/docs/`
Expected: learning、architecture、specs、plans 目录存在

---

## Task 2: 编写总索引 README

**Files:**
- Create: `docs/README.md`

- [ ] **Step 1: 创建总索引**

内容包含：
- AgentScope 介绍
- 文档结构说明（learning vs architecture）
- 学习路径推荐顺序
- Demo 示例说明
- 快速开始链接

---

## Task 3: 编写 learning/01-overview.md

**Files:**
- Create: `docs/learning/01-overview.md`

- [ ] **Step 1: 分析源码 README 和 pyproject.toml**

Read: `src/README.md`、`src/README_zh.md`、`src/pyproject.toml`

- [ ] **Step 2: 编写概览文档**

内容包含：
- AgentScope 2.0 定位和特性
- 安装方式（PyPI 和源码）
- 5 分钟 Hello World 示例（从 README 提取）
- 核心模块列表（agent、tool、model、message、memory）
- 与其他框架对比（可选）

---

## Task 4: 编写 learning/02-agent.md

**Files:**
- Create: `docs/learning/02-agent.md`

- [ ] **Step 1: 分析 agent 模块源码**

Read: `src/src/agentscope/agent/__init__.py`、`src/src/agentscope/agent/*.py`

- [ ] **Step 2: 编写 Agent 文档**

内容包含：
- Agent 基类结构
- ReActAgent 工作流程
- reply() vs reply_stream() 区别
- 系统提示和工具绑定
- 代码示例：创建 Agent 并调用

---

## Task 5: 编写 learning/03-tool.md

**Files:**
- Create: `docs/learning/03-tool.md`

- [ ] **Step 1: 分析 tool 模块源码**

Read: `src/src/agentscope/tool/__init__.py`、`src/src/agentscope/tool/*.py`

- [ ] **Step 2: 编写 Tool 文档**

内容包含：
- Toolkit 类结构
- 内置工具列表（Bash、Grep、Glob、Read、Write、Edit）
- 自定义工具定义方式
- 工具调用流程（Agent → Toolkit → Tool）
- 代码示例：注册自定义工具

---

## Task 6: 编写 learning/04-model.md

**Files:**
- Create: `docs/learning/04-model.md`

- [ ] **Step 1: 分析 model 和 credential 模块源码**

Read: `src/src/agentscope/model/__init__.py`、`src/src/agentscope/credential/__init__.py`

- [ ] **Step 2: 编写 Model 文档**

内容包含：
- Model 抽象类
- DashScopeChatModel、OpenAIChatModel 配置
- Credential 管理（API Key 安全）
- 流式调用处理
- 代码示例：配置不同模型服务

---

## Task 7: 编写 learning/05-message.md

**Files:**
- Create: `docs/learning/05-message.md`

- [ ] **Step 1: 分析 message 和 event 模块源码**

Read: `src/src/agentscope/message/__init__.py`、`src/src/agentscope/event/__init__.py`

- [ ] **Step 2: 编写 Message 文档**

内容包含：
- Message 类型（UserMsg、AgentMsg、SystemMsg）
- Event 流机制
- EventType 枚举（REPLY_START、MODEL_CALL_START、TEXT_BLOCK_DELTA 等）
- 流式事件处理模式
- 代码示例：处理 reply_stream 事件

---

## Task 8: 编写 learning/06-memory.md

**Files:**
- Create: `docs/learning/06-memory.md`

- [ ] **Step 1: 分析 workspace 和 state 模块源码**

Read: `src/src/agentscope/workspace/__init__.py`、`src/src/agentscope/state/__init__.py`

- [ ] **Step 2: 编写 Memory 文档**

内容包含：
- Memory 接口定义
- 存储后端类型
- 工作区（Workspace）概念
- 检索策略配置
- 代码示例：配置和使用 Memory

---

## Task 9: 编写 learning/07-mcp-a2a.md

**Files:**
- Create: `docs/learning/07-mcp-a2a.md`

- [ ] **Step 1: 分析 mcp 模块源码**

Read: `src/src/agentscope/mcp/__init__.py`、`src/src/agentscope/mcp/*.py`

- [ ] **Step 2: 编写 MCP/A2A 文档**

内容包含：
- MCP（Model Context Protocol）介绍
- MCP Server 和 Client 配置
- A2A（Agent-to-Agent）协议
- 集成示例代码

---

## Task 10: 编写 learning/08-service.md

**Files:**
- Create: `docs/learning/08-service.md`

- [ ] **Step 1: 分析 agent_service 示例源码**

Read: `src/examples/agent_service/*.py`

- [ ] **Step 2: 编写 Service 文档**

内容包含：
- FastAPI 服务架构
- 多租户设计
- Session 管理
- 权限控制（permission 模块）
- 启动和部署方式

---

## Task 11: 编写 learning/09-webui.md

**Files:**
- Create: `docs/learning/09-webui.md`

- [ ] **Step 1: 分析 web_ui 示例结构**

Run: `ls -la /Users/baxiang/Documents/hello-agent/agentscope/src/examples/web_ui/`

- [ ] **Step 2: 编写 WebUI 文档**

内容包含：
- 前端技术栈（React/Vue 等）
- 目录结构说明
- Agent 交互流程
- 实时事件渲染
- 启动方式（pnpm dev）

---

## Task 12: 编写 learning/10-knowledge.md

**Files:**
- Create: `docs/learning/10-knowledge.md`

- [ ] **Step 1: 编写前置知识清单**

内容包含：
- Python 3.11+ 特性（match-case、类型注解改进）
- asyncio 异步编程基础
- FastAPI 框架核心概念
- Pydantic 数据验证
- MCP/A2A 协议基础

---

## Task 13: 编写 learning/README.md

**Files:**
- Create: `docs/learning/README.md`

- [ ] **Step 1: 创建学习路径索引**

内容包含：
- 学习顺序推荐（01 → 10）
- 每个文档核心内容概述
- Demo 示例对应关系
- 预计学习时间

---

## Task 14: 编写 architecture/README.md

**Files:**
- Create: `docs/architecture/README.md`

- [ ] **Step 1: 分析整体源码结构**

Run: `find /Users/baxiang/Documents/hello-agent/agentscope/src/src/agentscope -type f -name "*.py" | wc -l`

- [ ] **Step 2: 编写架构总览**

内容包含：
- 源码统计（198 文件）
- 模块依赖关系图
- 核心设计模式
- 阅读路径推荐

---

## Task 15: 编写 architecture/modules/agent.md

**Files:**
- Create: `docs/architecture/modules/agent.md`

- [ ] **Step 1: 详细分析 agent 模块**

Read: `src/src/agentscope/agent/` 下所有 Python 文件

- [ ] **Step 2: 编写模块分析**

内容包含：
- 类图/继承关系
- Agent 基类关键方法签名
- ReActAgent 实现细节
- 工具调用流程代码片段
- 设计模式分析

---

## Task 16: 编写 architecture/modules/tool.md

**Files:**
- Create: `docs/architecture/modules/tool.md`

- [ ] **Step 1: 详细分析 tool 模块**

Read: `src/src/agentscope/tool/` 下所有 Python 文件

- [ ] **Step 2: 编写模块分析**

内容包含：
- Toolkit 类结构图
- Tool 基类接口
- 内置工具实现细节
- 工具注册机制代码片段

---

## Task 17: 编写 architecture/modules/model.md

**Files:**
- Create: `docs/architecture/modules/model.md`

- [ ] **Step 1: 详细分析 model 模块**

Read: `src/src/agentscope/model/` 下所有 Python 文件

- [ ] **Step 2: 编写模块分析**

内容包含：
- Model 抽象类图
- 各 Model 实现类对比
- 流式处理机制代码片段
- Credential 关联关系

---

## Task 18: 编写 architecture/modules/message.md

**Files:**
- Create: `docs/architecture/modules/message.md`

- [ ] **Step 1: 详细分析 message 和 event 模块**

Read: `src/src/agentscope/message/` 和 `src/src/agentscope/event/` 下所有文件

- [ ] **Step 2: 编写模块分析**

内容包含：
- Message 类型继承图
- Event 流实现机制
- EventType 完整枚举
- 序列化方式代码片段

---

## Task 19: 编写 architecture/modules/memory.md

**Files:**
- Create: `docs/architecture/modules/memory.md`

- [ ] **Step 1: 详细分析 workspace 和 state 模块**

Read: `src/src/agentscope/workspace/` 和 `src/src/agentscope/state/` 下所有文件

- [ ] **Step 2: 编写模块分析**

内容包含：
- Memory 接口定义
- Workspace 管理机制
- 状态持久化方式

---

## Task 20: 编写 architecture/modules/mcp.md

**Files:**
- Create: `docs/architecture/modules/mcp.md`

- [ ] **Step 1: 详细分析 mcp 模块**

Read: `src/src/agentscope/mcp/` 下所有 Python 文件

- [ ] **Step 2: 编写模块分析**

内容包含：
- MCP Client/Server 结构
- 协议实现细节
- 与 Agent 集成方式

---

## Task 21: 编写 architecture/modules/credential.md

**Files:**
- Create: `docs/architecture/modules/credential.md`

- [ ] **Step 1: 详细分析 credential 模块**

Read: `src/src/agentscope/credential/` 下所有 Python 文件

- [ ] **Step 2: 编写模块分析**

内容包含：
- Credential 类型层次
- API Key 安全存储
- 多服务 Credential 管理

---

## Task 22: 编写 architecture/modules/service.md

**Files:**
- Create: `docs/architecture/modules/service.md`

- [ ] **Step 1: 详细分析 agent_service 示例**

Read: `src/examples/agent_service/` 下所有文件

- [ ] **Step 2: 编写模块分析**

内容包含：
- FastAPI 路由结构
- Session 管理实现
- 权限控制代码片段

---

## Task 23: 编写 architecture/modules/webui.md

**Files:**
- Create: `docs/architecture/modules/webui.md`

- [ ] **Step 1: 详细分析 web_ui 示例**

Read: `src/examples/web_ui/` 目录结构和关键文件

- [ ] **Step 2: 编写模块分析**

内容包含：
- 前端组件结构
- Agent 通信机制
- 事件流渲染实现

---

## Task 24: 创建 demo/README.md

**Files:**
- Create: `demo/README.md`

- [ ] **Step 1: 编写 demo 索引**

内容包含：
- 示例列表和说明
- 运行前置条件（Python 3.11+、API Key）
- 每个示例对应的 learning 章节

---

## Task 25: 创建 demo/01-hello-agent/main.py

**Files:**
- Create: `demo/01-hello-agent/main.py`

- [ ] **Step 1: 编写最简 Agent 示例**

代码内容：
- 导入 Agent、Model、Credential
- 创建 DashScope/OpenAI 模型配置
- 创建 Agent 并发送简单消息
- 打印回复结果
- 关键步骤注释

---

## Task 26: 创建 demo/02-tool-agent/main.py

**Files:**
- Create: `demo/02-tool-agent/main.py`

- [ ] **Step 1: 编写工具调用示例**

代码内容：
- 导入 Toolkit、Bash、Read 等工具
- 创建带 Toolkit 的 Agent
- 发送需要工具调用的消息
- 展示工具调用结果
- 关键步骤注释

---

## Task 27: 创建 demo/03-stream-agent/main.py

**Files:**
- Create: `demo/03-stream-agent/main.py`

- [ ] **Step 1: 编写流式响应示例**

代码内容：
- 使用 reply_stream() 方法
- 处理不同 EventType
- 打印 TEXT_BLOCK_DELTA 实时输出
- 展示完整事件流处理
- 关键步骤注释

---

## Task 28: 创建 demo/04-memory-agent/main.py

**Files:**
- Create: `demo/04-memory-agent/main.py`

- [ ] **Step 1: 编写记忆系统示例**

代码内容：
- 配置 Memory 存储
- 创建带 Memory 的 Agent
- 多轮对话展示记忆持久化
- 关键步骤注释

---

## Task 29: 创建 demo/05-mcp-agent/main.py

**Files:**
- Create: `demo/05-mcp-agent/main.py`

- [ ] **Step 1: 编写 MCP 集成示例**

代码内容：
- 配置 MCP Server/Client
- 创建支持 MCP 的 Agent
- 通过 MCP 调用外部工具
- 关键步骤注释

---

## Task 30: 创建 demo/06-multi-agent/main.py

**Files:**
- Create: `demo/06-multi-agent/main.py`

- [ ] **Step 1: 编写多 Agent 协作示例**

代码内容：
- 创建多个不同角色的 Agent
- 展示 Agent 间消息传递
- 协作完成复杂任务
- 关键步骤注释

---

## Task 31: 创建 demo/07-service/main.py

**Files:**
- Create: `demo/07-service/main.py`

- [ ] **Step 1: 编写 Agent Service 启动示例**

代码内容：
- 基于 agent_service 示例简化
- FastAPI 路由定义
- Session 和权限配置
- 启动服务代码
- 关键步骤注释

---

## 验收检查

- [ ] 所有文档为中文
- [ ] learning 文档包含可运行代码片段
- [ ] architecture 文档包含类图/代码片段
- [ ] demo 示例可独立运行
- [ ] 与 hiclaw 文档风格一致