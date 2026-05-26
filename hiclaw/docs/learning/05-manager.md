# HiClaw Manager Agent

**位置**: `src/manager/`

## Manager 概述

Manager Agent 是 HiClaw 的协调者，负责：
- 创建和管理 Workers
- 分配任务给 Workers
- 配置 Higress 路由和 MCP Servers
- 与 Human 和 Workers 通过 Matrix 通信

---

## 目录结构

```
manager/
├── agent/                     # Agent 配置和技能 (核心)
│   ├── AGENTS.md              # Manager 启动指令
│   ├── SOUL.md                # 人格定义
│   ├── HEARTBEAT.md           # 定期检查流程
│   ├── TOOLS.md               # 工具描述 (可选)
│   ├── skills/                # 16 个内置技能
│   │   ├── worker-management/
│   │   ├── task-management/
│   │   ├── team-management/
│   │   ├── mcp-server-management/
│   │   ├── channel-management/
│   │   └── ... (其他 11 个)
│   ├── skills-alpha/          # 实验性技能
│   ├── worker-agent/          # OpenClaw Worker 模板
│   ├── copaw-worker-agent/    # QwenPaw Worker 模板
│   ├── hermes-worker-agent/   # Hermes Worker 模板
│   ├── team-leader-agent/     # Team Leader 模板
│   ├── copaw-manager-agent/   # QwenPaw Manager 覆盖
│   └── worker-skills/         # 按需分发技能
├── scripts/
│   ├── init/                  # 启动脚本
│   │   ├── start-manager-agent.sh # 主入口
│   │   ├── setup-higress.sh       # Higress 配置
│   │   ├── upgrade-builtins.sh    # 内置技能同步
│   │   └── start-copaw-manager.sh # QwenPaw Manager
│   │   └── start-openclaw-manager.sh # OpenClaw Manager
│   └── lib/                   # 共享库
│   │   ├── base.sh            # 基础函数
│   │   ├── container-api.sh   # Docker/Podman API
│   │   ├── hiclaw-env.sh      # 环境变量
│   │   └── render-skills.sh   # 技能渲染
├── configs/                   # 配置模板
│   └── manager-openclaw.json.tmpl
├── Dockerfile                 # OpenClaw Manager 镜像
├── Dockerfile.copaw           # QwenPaw Manager 镜像
├── supervisord.conf           # 进程管理
└── tests/                     # 测试
```

---

## Agent 配置文件

### AGENTS.md (启动指令)

Manager 启动时读取的指令文档，定义：
- Manager 的角色和职责
- 如何与 Human 交互
- 如何管理 Workers
- 启动时的初始化流程

### SOUL.md (人格定义)

定义 Manager 的"性格"：
- 语气风格
- 回复模式
- 人格设定

### HEARTBEAT.md (定期检查)

定义 Manager 的定期任务：
- Worker 健康检查
- 任务进度跟踪
- 状态汇报

---

## Skills 系统

### Skill 结构

每个 Skill 是一个目录：

```
skill-name/
├── SKILL.md           # Agent 可读指令 (核心)
├── scripts/           # 可选：执行脚本
│   └── *.sh
└── references/        # 可选：参考文档
    └── *.md
```

### Manager Skills (16 个)

| Skill | 用途 | 关键文件 |
|---|---|---|
| `worker-management` | Worker 创建/删除/管理 | SKILL.md, create-worker.sh |
| `task-management` | 任务分配和跟踪 | SKILL.md |
| `team-management` | Team 创建和协调 | SKILL.md |
| `human-management` | Human 用户管理 | SKILL.md |
| `mcp-server-management` | MCP Server 配置 | SKILL.md |
| `channel-management` | Matrix 房间管理 | SKILL.md |
| `file-sync-management` | MinIO 文件同步 | SKILL.md |
| `project-management` | 项目进度管理 | SKILL.md |
| `task-coordination` | 任务协调 | SKILL.md |
| `model-switch` | 模型切换 | SKILL.md |
| `service-publishing` | 服务发布 | SKILL.md |
| `matrix-server-management` | Matrix 服务器管理 | SKILL.md |
| `git-delegation-management` | Git 委派管理 | SKILL.md |
| `mcporter` | MCP 工具调用 | SKILL.md |
| `hiclaw-find-worker` | 查找 Worker | SKILL.md |
| `worker-model-switch` | Worker 模型切换 | SKILL.md |

### SKILL.md 写法

Skills 是 Agent 可读的文档，使用第二人称：

```markdown
# Worker Management Skill

## Purpose
You use this skill to create, update, and delete Workers.

## Commands

### Create a Worker
1. Ask the Human for Worker name and purpose
2. Run `hiclaw create worker --name <name> --runtime <runtime> --model <model>`
3. Wait for Worker to be ready
4. Invite Human to Worker's room

### Delete a Worker
1. Confirm with Human
2. Run `hiclaw delete worker <name>`
3. Clean up resources

## Tools
- `hiclaw` CLI for worker CRUD
- Matrix API for room management
```

---

## Manager 运行时

### OpenClaw Manager (默认)

**技术栈**: Node.js + OpenClaw gateway

**特点**:
- Matrix 通过 "message" tool 模式集成
- 丰富的 Skills 生态
- mcporter MCP 调用

**启动脚本**: `scripts/init/start-openclaw-manager.sh`

### QwenPaw Manager (copaw)

**技术栈**: Python + AgentScope + CoPaw

**特点**:
- Matrix 通过 `copaw channels send` CLI
- 轻量级
- 浏览器自动化友好

**启动脚本**: `scripts/init/start-copaw-manager.sh`

**覆盖文件**: `agent/copaw-manager-agent/AGENTS.md` + `HEARTBEAT.md`

---

## 启动流程

### start-manager-agent.sh

```bash
#!/bin/bash
# 1. 设置环境变量
source /opt/hiclaw/scripts/lib/hiclaw-env.sh

# 2. 根据运行时选择启动方式
if [ "$HICLAW_MANAGER_RUNTIME" = "copaw" ]; then
    source /opt/hiclaw/scripts/init/start-copaw-manager.sh
else
    source /opt/hiclaw/scripts/init/start-openclaw-manager.sh
fi

# 3. 同步内置技能
/opt/hiclaw/scripts/init/upgrade-builtins.sh

# 4. 渲染技能模板
/opt/hiclaw/scripts/lib/render-skills.sh

# 5. 配置 Higress (如果需要)
if [ "$HICLAW_RUNTIME" = "local" ]; then
    /opt/hiclaw/scripts/init/setup-higress.sh
fi

# 6. 启动 Agent 进程
exec supervisord -c /etc/supervisor/conf.d/supervisord.conf
```

### upgrade-builtins.sh

将镜像中的内置技能同步到工作空间：

```bash
#!/bin/bash
# 从 /opt/hiclaw/agent/ 复制到 ~/workspace/
cp -r /opt/hiclaw/agent/skills ~/workspace/skills/
cp /opt/hiclaw/agent/AGENTS.md ~/workspace/AGENTS.md
cp /opt/hiclaw/agent/SOUL.md ~/workspace/SOUL.md
cp /opt/hiclaw/agent/HEARTBEAT.md ~/workspace/HEARTBEAT.md

# QwenPaw 覆盖 (如果运行时是 copaw)
if [ "$MANAGER_RUNTIME" = "copaw" ]; then
    cp /opt/hiclaw/agent/copaw-manager-agent/AGENTS.md ~/workspace/AGENTS.md
    cp /opt/hiclaw/agent/copaw-manager-agent/HEARTBEAT.md ~/workspace/HEARTBEAT.md
fi
```

---

## Worker 模板

Manager 在创建 Worker 时使用模板：

| 模板 | 用途 |
|---|---|
| `worker-agent/` | OpenClaw Worker 默认配置 |
| `copaw-worker-agent/` | QwenPaw Worker 默认配置 |
| `hermes-worker-agent/` | Hermes Worker 默认配置 |

### 模板结构

```
worker-agent/
├── AGENTS.md           # Worker 启动指令
├── SOUL.md             # Worker 人格
├── HEARTBEAT.md        # Worker 定期任务
├── skills/             # 内置技能
│   ├── file-sync/
│   ├── mcporter/
│   ├── find-skills/
│   ├── project-participation/
│   └── task-progress/
└── TOOLS.md            # 工具描述
```

---

## Worker Skills (按需分发)

`manager/agent/worker-skills/` 包含可推送到 Worker 的技能：

| Skill | 用途 |
|---|---|
| `github-operations` | GitHub PR/Issue 操作 |
| `git-delegation` | Git 委派操作 |

### 推送流程

1. Manager 收到 Worker 创建请求
2. Manager 根据 `spec.skills` 选择技能
3. Manager 将技能推送到 Worker 的 MinIO 工作空间
4. Worker 启动时加载技能

---

## 环境变量

Manager 使用的关键环境变量：

| 变量 | 说明 |
|---|---|
| `HICLAW_MANAGER_RUNTIME` | Manager 运行时 (openclaw/copaw) |
| `HICLAW_RUNTIME` | 部署运行时 (local/k8s/aliyun) |
| `HICLAW_CONTROLLER_URL` | Controller REST API 地址 |
| `HICLAW_GATEWAY_URL` | Higress Gateway 地址 |
| `HICLAW_MATRIX_URL` | Tuwunel Matrix 地址 |
| `HICLAW_MINIO_URL` | MinIO 地址 |
| `HICLAW_ADMIN_PASSWORD` | Matrix 管理员密码 |
| `HICLAW_MANAGER_MODEL` | Manager LLM 模型 |

---

## 自检问题

1. Manager 的核心职责是什么？
2. AGENTS.md、SOUL.md、HEARTBEAT.md 分别是什么？
3. Manager Skills 有哪些关键技能？
4. Worker 模板的用途是什么？

---

**下一步**：阅读 [06-worker.md](06-worker.md)