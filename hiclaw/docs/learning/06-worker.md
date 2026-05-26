# HiClaw Worker Agent

**位置**: `src/worker/`, `src/copaw/`, `src/hermes/`

## Worker 概述

Worker Agent 是 HiClaw 的执行单元，负责：
- 接收 Manager 分配的任务
- 执行具体工作 (编码、测试、部署等)
- 报告任务进度
- 通过 Matrix 与 Manager 和 Human 通信

---

## 三种运行时

| Runtime | 技术栈 | 特点 | 镜像 |
|---|---|---|---|
| **OpenClaw** (默认) | Node.js | 任务编排、工具调用、丰富技能 | `hiclaw-worker` |
| **QwenPaw** (copaw) | Python / AgentScope | 轻量级、浏览器自动化 | `hiclaw-copaw-worker` |
| **Hermes** | Python | 自主编码、终端沙箱、自我改进 | `hiclaw-hermes-worker` |

---

## OpenClaw Worker

**位置**: `src/worker/`

### 目录结构

```
worker/
├── Dockerfile               # Worker 镜像构建
├── scripts/
│   └── worker-entrypoint.sh # 启动脚本
└── README.md
```

### Dockerfile

```dockerfile
# 基于 openclaw-base 镜像
FROM openclaw-base:latest

# 复制启动脚本
COPY scripts/worker-entrypoint.sh /opt/hiclaw/

# 设置入口点
ENTRYPOINT ["/opt/hiclaw/worker-entrypoint.sh"]
```

### worker-entrypoint.sh

```bash
#!/bin/bash
# 1. 设置环境变量
source /opt/hiclaw/scripts/lib/hiclaw-env.sh

# 2. 从 MinIO 同步工作空间
mc mirror $HICLAW_MINIO_URL/agents/$WORKER_NAME ~/workspace/

# 3. 加载技能
source /opt/hiclaw/scripts/lib/render-skills.sh

# 4. 启动 OpenClaw Agent
exec openclaw gateway \
    --config ~/workspace/config/openclaw.json \
    --plugins matrix,mcporter
```

### 内置技能

| Skill | 用途 |
|---|---|
| `file-sync` | MinIO 文件同步 |
| `mcporter` | MCP 工具调用 |
| `find-skills` | 技能发现 |
| `project-participation` | 项目参与 |
| `task-progress` | 任务进度上报 |

---

## QwenPaw Worker (copaw)

**位置**: `src/copaw/`

### 目录结构

```
copaw/
├── Dockerfile               # QwenPaw Worker 镜像
├── scripts/
│   └── copaw-worker-entrypoint.sh # 启动脚本
├── src/
│   └── copaw_worker/        # Python 包
│       ├── __init__.py
│       ├── agent.py         # Agent 实现
│       ├── matrix.py        # Matrix 桥接
│       └── cli.py           # CLI 入口
├── pyproject.toml           # Python 项目配置
└── README.md
```

### 技术栈

- **Python 3.11+**
- **AgentScope** (阿里云 Agent 框架)
- **CoPaw CLI**: `copaw channels send`

### 特点

| 特点 | 说明 |
|---|---|
| **轻量级** | 比 OpenClaw 内存占用少 80% |
| **浏览器自动化** | 支持 Playwright/Selenium |
| **快速启动** | Python venv 快速加载 |

### 启动脚本

```bash
#!/bin/bash
# 1. 激活 Python venv
source /opt/copaw/venv/bin/activate

# 2. 同步工作空间
mc mirror $HICLAW_MINIO_URL/agents/$WORKER_NAME ~/workspace/

# 3. 启动 QwenPaw Agent
exec copaw worker start \
    --config ~/workspace/config/copaw.json \
    --matrix-url $HICLAW_MATRIX_URL
```

---

## Hermes Worker

**位置**: `src/hermes/`

### 目录结构

```
hermes/
├── Dockerfile               # Hermes Worker 镜像
├── src/
│   ├── hermes_worker/       # Hermes Worker 包
│   │   ├── __init__.py
│   │   ├── agent.py         # Agent 实现
│   │   ├── terminal.py      # 终端沙箱
│   │   ├── memory.py        # 持久记忆
│   │   └── skills.py        # 自我改进技能
│   └── hermes_matrix/       # Matrix 桥接
│       ├── __init__.py
│       ├── client.py        # Matrix 客户端
│       └── handler.py       # 消息处理
├── config/                  # 配置模板
│   └── hermes.toml.tmpl
└── README.md
```

### 技术栈

- **Python 3.11+**
- **Terminal Sandbox**: 受限终端环境
- **Persistent Memory**: 跨会话记忆
- **Self-improving Skills**: 自我改进能力

### 特点

| 特点 | 说明 |
|---|---|
| **自主编码** | LLM 直接生成和执行代码 |
| **终端沙箱** | 安全的命令执行环境 |
| **持久记忆** | 学习经验跨会话保持 |
| **自我改进** | 技能自动优化 |

### 配置结构 (hermes-worker-agent/)

```
hermes-worker-agent/
├── AGENTS.md           # Hermes 启动指令
├── SOUL.md             # Hermes 人格
├── HEARTBEAT.md        # Hermes 定期任务
├── skills/             # 内置技能
│   ├── terminal/
│   ├── memory/
│   └── self-improve/
└── config/
    └── hermes.toml.tmpl
```

---

## Worker 生命周期

### 创建流程

```
1. Manager 收到 Human 创建 Worker 的请求
2. Manager 调用 Controller API: POST /api/v1/workers
3. Controller 创建 Worker CR
4. Worker Reconciler 开始调和:
   ├── 创建 Gateway Consumer
   ├── 创建 Matrix 用户
   ├── 创建 Matrix 房间
   ├── 推送 Worker 模板到 MinIO
   ├── 创建 Worker 容器/Pod
   └── 邀请 Manager 和 Human 到房间
5. Worker 容器启动:
   ├── 同步 MinIO 工作空间
   ├── 加载技能
   └── 连接 Matrix
6. Worker 发送就绪消息到房间
```

### 状态管理

| State | 说明 |
|---|---|
| `Running` | 正常运行 |
| `Sleeping` | 休眠 (节省资源) |
| `Stopped` | 停止 (容器删除，数据保留) |

### 删除流程

```
1. Manager 收到 Human 删除 Worker 的请求
2. Manager 调用 Controller API: DELETE /api/v1/workers/{name}
3. Controller 标记 Worker CR 为删除
4. Worker Reconciler 执行 Finalizer:
   ├── 删除 Gateway Consumer
   ├── 删除 Matrix 用户
   ├── 删除 Matrix 房间
   ├── 删除 Worker 容器/Pod
   └── 清理 MinIO 数据 (可选)
```

---

## Worker 与 Matrix

### 房间结构

每个 Worker 有一个专属 Matrix 房间：

```
Room: Worker: Alice
├── Human (you)
├── Manager
└── Worker Alice
```

### 通信模式

| 方向 | 方式 |
|---|---|
| **Human → Worker** | 直接 @mention Worker |
| **Manager → Worker** | 分配任务，监控进度 |
| **Worker → Human/Manager** | 任务进度、结果汇报 |

### 示例交互

```
Human: @alice 实现一个 React 登录页面

Alice: 收到任务，开始执行...
       [10 分钟后]
       完成！PR 已提交: https://github.com/xxx/pull/1

Manager: Alice 完成了前端任务，进度更新到 100%

Human: @alice 等一下，把密码规则改成最小 8 位

Alice: 收到，正在修改...
       [5 分钟后]
       已更新，PR 已修改
```

---

## Worker 与 MinIO

### 工作空间结构

```
minio://hiclaw/agents/alice/
├── workspace/
│   ├── AGENTS.md        # Agent 指令
│   ├── SOUL.md          # 人格
│   ├── skills/          # 技能
│   ├── config/          # 配置
│   └── projects/        # 项目代码
├── state/
│   ├── memory.json      # 记忆
│   └── tasks.json       # 任务状态
└── artifacts/
    └── outputs/         # 输出文件
```

### 文件同步

```bash
# 启动时从 MinIO 同步
mc mirror $MINIO_URL/agents/alice ~/workspace/

# 运行时推送更新
mc cp ~/workspace/projects/app/src/Login.jsx $MINIO_URL/agents/alice/workspace/projects/app/src/
```

---

## Worker 与 Gateway

### Consumer Token

Worker 使用 Consumer Token 访问 Gateway：

```
Worker Container
    │
    │ HICLAW_CONSUMER_KEY=xxx
    │
    ▼
Higress Gateway
    │
    │ 验证 Consumer Key
    │
    ▼
LLM API / MCP Servers
```

### MCP 调用

Worker 通过 mcporter 调用 MCP Server：

```bash
# 列出可用 MCP 工具
mcporter --config ~/mcporter-servers.json list

# 调用 MCP 工具
mcporter --config ~/mcporter-servers.json call github create_issue \
    --input '{"title":"Bug report","body":"..."}'
```

---

## 自检问题

1. Worker 的三种运行时有什么区别？
2. Worker 生命周期包含哪些状态？
3. Worker 如何通过 Matrix 与 Human/Manager 通信？
4. Worker 如何使用 MinIO 共享存储？

---

**下一步**：阅读 [07-infrastructure.md](07-infrastructure.md)