# HiClaw 技术架构解析

## 项目概览

**HiClaw** 是一个开源的协作多 Agent 操作系统，用于透明的、人机协同的任务协调。基于 **Manager-Workers 架构**，Manager 作为协调者管理多个 Worker Agent，通过 Matrix 协议进行通信。

### 核心特性

| 特性 | 说明 |
|---|---|
| **Manager-Workers 架构** | Manager 管理 Workers，消除人工监控每个 Worker 的需求 |
| **多运行时协作** | OpenClaw、QwenPaw、Hermes 三种运行时共存于同一 IM 房间 |
| **MinIO 共享文件系统** | Agent 间信息交换，显著减少 token 消耗 |
| **Higress AI Gateway** | 统一流量管理和凭证管理 |
| **Matrix 协议 (IM)** | 基于 Tuwunel 服务器 + Element Web 客户端 |

### 技术栈

| 层次 | 技术 | 用途 |
|---|---|---|
| **控制平面** | hiclaw-controller (Go) | Kubernetes Operator，调和 Worker/Manager/Team/Human CRDs |
| **AI Gateway** | Higress | LLM 代理、MCP Server 托管、凭证管理 |
| **IM 服务器** | Tuwunel (conduwuit fork) | Agent 与 Human 通信 |
| **IM 客户端** | Element Web | 浏览器端 IM 界面 |
| **文件系统** | MinIO / OSS | 集中式对象存储，Agent 无状态 |
| **Agent 运行时** | OpenClaw / QwenPaw / Hermes | Manager/Worker 执行框架 |

---

## 架构总览

```
┌─────────────────────────────────────────────────────────────┐
│                    hiclaw-controller                        │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐       │
│  │ Higress  │ │ Tuwunel  │ │  MinIO   │ │ Element  │       │
│  │ Gateway  │ │ Matrix   │ │ Storage  │ │   Web    │       │
│  └──────────┘ └──────────┘ └──────────┘ └──────────┘       │
│                      Controller API (:8090)                 │
└────────────────────────────┬────────────────────────────────┘
                             │
              ┌──────────────┴──────────────┐
              │      hiclaw-manager         │
              │   (Manager Agent)           │
              │   OpenClaw / QwenPaw        │
              └──────────────┬──────────────┘
                             │ Matrix Rooms
        ┌────────────────────┼────────────────────┐
        │                    │                    │
        ▼                    ▼                    ▼
  ┌───────────┐       ┌───────────┐       ┌───────────┐
  │ Worker A  │       │ Worker B  │       │ Worker C  │
  │ (OpenClaw)│       │ (QwenPaw) │       │ (Hermes)  │
  └───────────┘       └───────────┘       └───────────┘
        │                    │                    │
        └────────────────────┴────────────────────┘
                             │
                    Human (in Matrix Room)
```

---

## 核心组件详解

### 1. hiclaw-controller (Kubernetes Operator)

**位置**: `hiclaw-controller/`

**核心职责**:
- 调和 (Reconcile) 四种 CRD：Worker、Manager、Team、Human
- REST API 服务 (:8090)
- Worker/Manager 生命周期管理
- Gateway Consumer 设置
- 云提供商凭证流程

**目录结构**:
```
hiclaw-controller/
├── api/v1beta1/           # CRD 类型定义
│   ├── types.go           # Worker, Manager, Team, Human 结构体
│   └── register.go        # CRD 注册
├── internal/
│   ├── controller/        # Reconciler 实现
│   │   ├── worker_controller.go
│   │   ├── manager_controller.go
│   │   ├── team_controller.go
│   │   └── human_controller.go
│   ├── gateway/           # Higress Gateway 管理
│   ├── matrix/            # Tuwunel Matrix 操作
│   ├── oss/               # MinIO/OSS 存储
│   ├── executor/          # 容器执行器 (Docker/K8s)
│   └── service/           # REST API 实现
├── cmd/                   # 入口点
├── bin/                   # hiclaw CLI
└── Dockerfile.embedded    # 嵌入式控制器镜像
```

**CRD 定义** (api/v1beta1/types.go):
```go
// Worker — 执行单元
type Worker struct {
    Spec   WorkerSpec   // model, runtime, skills, mcpServers, soul, expose
    Status WorkerStatus // state, roomID, containerName, conditions
}

// Manager — 协调者
type Manager struct {
    Spec   ManagerSpec   // model, runtime, skills, config
    Status ManagerStatus // state, roomID, workers, conditions
}

// Team — 团队结构
type Team struct {
    Spec   TeamSpec   // leader, workers, admin, channelPolicy
    Status TeamStatus // rooms, memberStatus
}

// Human — 人类用户
type Human struct {
    Spec   HumanSpec   // displayName, email, permissionLevel
    Status HumanStatus // matrixUser, rooms
}
```

### 2. Manager Agent

**位置**: `manager/`

**核心职责**:
- 协调任务分配给 Workers
- 管理 Worker 生命周期
- 配置 Higress 路由和 MCP Servers
- 通过 Matrix 和 Controller API 通信

**目录结构**:
```
manager/
├── agent/                     # Agent 配置和技能
│   ├── AGENTS.md              # Manager 启动指令
│   ├── SOUL.md                # 人格定义
│   ├── HEARTBEAT.md           # 定期检查流程
│   ├── skills/                # 16 个内置技能
│   │   ├── worker-management/
│   │   ├── task-management/
│   │   ├── team-management/
│   │   ├── mcp-server-management/
│   │   └── ... (其他 12 个)
│   ├── worker-agent/          # Worker 模板 (OpenClaw)
│   ├── copaw-worker-agent/    # Worker 模板 (QwenPaw)
│   ├── hermes-worker-agent/   # Worker 模板 (Hermes)
│   ├── team-leader-agent/     # Team Leader 模板
│   └── worker-skills/         # 按需分发技能
├── scripts/
│   ├── init/                  # 启动脚本
│   │   ├── start-manager-agent.sh
│   │   ├── setup-higress.sh
│   │   └── upgrade-builtins.sh
│   └── lib/                   # 共享库
├── configs/                   # 配置模板
├── Dockerfile                 # OpenClaw Manager 镜像
├── Dockerfile.copaw           # QwenPaw Manager 镜像
└── supervisord.conf           # 进程管理
```

**Manager Skills (16 个)**:
| 技能 | 用途 |
|---|---|
| `worker-management` | 创建/删除/管理 Worker |
| `task-management` | 任务分配和跟踪 |
| `team-management` | 团队创建和协调 |
| `human-management` | 人类用户管理 |
| `mcp-server-management` | MCP Server 配置 |
| `channel-management` | Matrix 房间管理 |
| `file-sync-management` | MinIO 文件同步 |
| `project-management` | 项目进度管理 |
| `model-switch` | 模型切换 |
| `service-publishing` | 服务发布 |
| `task-coordination` | 任务协调 |
| `matrix-server-management` | Matrix 服务器管理 |
| `git-delegation-management` | Git 委派管理 |
| `mcporter` | MCP 工具调用 |
| `hiclaw-find-worker` | 查找 Worker |
| `worker-model-switch` | Worker 模型切换 |

### 3. Worker Agent

**位置**: `worker/`, `copaw/`, `hermes/`

**三种运行时**:

| 运行时 | 技术栈 | 特点 |
|---|---|---|
| **OpenClaw** (默认) | Node.js | 主要 Worker 运行时，mcporter MCP 调用 |
| **QwenPaw** (copaw) | Python / AgentScope | 轻量级，浏览器自动化 |
| **Hermes** | Python | 自主编码，终端沙箱，持久记忆 |

**Worker 目录结构**:
```
worker/
├── Dockerfile               # OpenClaw Worker 镜像
├── scripts/
│   └── worker-entrypoint.sh # 启动脚本

copaw/
├── Dockerfile               # QwenPaw Worker 镜像
├── scripts/
│   └── copaw-worker-entrypoint.sh
├── src/
│   └── copaw_worker/        # Python 包

hermes/
├── Dockerfile               # Hermes Worker 镜像
├── src/
│   └── hermes_worker/       # Python 包
│   └── hermes_matrix/       # Matrix 桥接
```

### 4. 基础设施组件

**Higress AI Gateway**:
- LLM 流量代理 (OpenAI 兼容路由)
- MCP Server 托管
- Consumer 密钥认证
- Console 会话管理

**Tuwunel (Matrix Homeserver)**:
- 基于 conduwuit fork
- 环境变量前缀: `CONDUWUIT_*`
- Human ↔ Manager ↔ Worker 通信

**MinIO (对象存储)**:
- Worker 工作空间: `agents/<name>/`
- 共享任务: `shared/tasks/`
- Manager 路径: `manager/`
- Worker 可替换，状态在 MinIO

**Element Web**:
- 浏览器端 Matrix 客户端
- 无需配置即可使用

---

## 部署模式

### 模式 1: 本地单机部署 (install/)

**嵌入式控制器**: 一个容器包含 Higress + Tuwunel + MinIO + Element Web + Controller

```
+--------------------------- hiclaw-controller (embedded) --------------------------+
|  Higress (:8080)   Tuwunel (:6167)   MinIO (:9000)   Element+nginx   controller |
+-------------------------------+--------------+-------------------------------------+
                                | API / Docker |
              +-----------------+----------------+------------------+
              |                                  |
       hiclaw-manager                     hiclaw-worker-*
       (lightweight)                      (lightweight)
```

**安装脚本**: `install/hiclaw-install.sh`

### 模式 2: Kubernetes 部署 (helm/hiclaw)

**Helm Chart**: 每个组件独立 Pod

```
helm install hiclaw higress.io/hiclaw \
  -n hiclaw-system --create-namespace \
  --set credentials.llmApiKey=<your-api-key> \
  --set credentials.adminPassword=<password> \
  --set gateway.publicURL=http://localhost:18080
```

**Helm Values 关键配置**:
```yaml
credentials:
  llmApiKey: ""           # LLM API 密钥
  llmBaseUrl: ""          # OpenAI 兼容 URL
  defaultModel: "gpt-5.4" # 默认模型
  adminPassword: ""       # Matrix 管理员密码

manager:
  runtime: openclaw       # openclaw | copaw

worker:
  defaultRuntime: openclaw # openclaw | copaw | hermes
```

---

## 通信机制

### Matrix 通信

**房间结构**:
```
Room: Worker: Alice
├── Human (you)
├── Manager
└── Worker Alice

Room: Team: Development
├── Human (team admin)
├── Manager
├── Team Leader
├── Worker A1
├── Worker A2
└── Worker B1
```

**通信特点**:
- Human 可见所有消息
- 可随时干预
- 无隐藏 Agent-to-Agent 调用

### MinIO 共享存储

**路径结构**:
```
minio://hiclaw/
├── agents/
│   ├── alice/           # Worker Alice 工作空间
│   ├── bob/             # Worker Bob 工作空间
│   └── manager/         # Manager 工作空间
├── shared/
│   └── tasks/           # 共享任务树
└── teams/
    └── dev-team/        # 团队共享空间
```

### Higress Gateway 路由

**安全模型**:
```
Worker (consumer token only)
    → Higress AI Gateway (holds real API keys, GitHub PAT)
        → LLM API / GitHub API / MCP Servers
```

**Worker 只持有 consumer token，真实凭证在 Gateway。**

---

## Skills 系统

### Skills 结构

每个 Skill 是一个目录，包含:
```
skill-name/
├── SKILL.md           # Agent 可读的指令文档
├── scripts/           # 可选：执行脚本
└── references/        # 可选：参考文档
```

### Skill 加载机制

1. **启动时**: Manager 从 `/opt/hiclaw/agent/skills/` 加载内置技能
2. **Worker 创建**: Manager 推送指定技能到 Worker 工作空间
3. **运行时**: Agent 通过 `SKILL.md` 理解如何使用工具/API

### Worker 内置技能 (核心集)

| 技能 | 用途 |
|---|---|
| `file-sync` | MinIO 文件同步 |
| `mcporter` | MCP 工具调用 |
| `find-skills` | 技能发现 |
| `project-participation` | 项目参与 |
| `task-progress` | 任务进度上报 |

### 按需分发技能 (manager/agent/worker-skills/)

| 技能 | 用途 |
|---|---|
| `github-operations` | GitHub 操作 |
| `git-delegation` | Git 委派 |

---

## 安全设计

### 凭证管理

| 层次 | 持有内容 |
|---|---|
| **Worker** | 仅 consumer token (Higress 认证) |
| **Manager** | consumer token + Gateway 路由配置 |
| **Gateway** | 真实 API 密钥、GitHub PAT、MCP Server 凭证 |
| **Controller** | Gateway Console 会话、Matrix 管理员密码 |

### 零凭证暴露

Worker 无法看到真实凭证:
- API 密钥 → Higress 管理
- GitHub PAT → Higress 管理
- MCP Server 凭证 → Higress 管理

---

## 源码学习路径

### 推荐阅读顺序

```
1. docs/architecture.md      ← 系统架构概览
2. docs/k8s-native-agent-orch.md ← Kubernetes 声明式设计
3. AGENTS.md                 ← 项目结构导航
4. hiclaw-controller/api/v1beta1/types.go ← CRD 定义
5. hiclaw-controller/internal/controller/worker_controller.go ← Worker Reconciler
6. manager/agent/AGENTS.md   ← Manager 启动指令
7. manager/agent/skills/     ← Manager 技能系统
```

### 关键源码文件

| 文件 | 用途 |
|---|---|
| `hiclaw-controller/api/v1beta1/types.go` | CRD 类型定义 |
| `hiclaw-controller/internal/controller/worker_controller.go` | Worker 生命周期管理 |
| `hiclaw-controller/internal/controller/manager_controller.go` | Manager 生命周期管理 |
| `manager/scripts/init/start-manager-agent.sh` | Manager 启动脚本 |
| `manager/agent/AGENTS.md` | Manager Agent 指令 |
| `manager/agent/skills/worker-management/SKILL.md` | Worker 管理技能 |
| `worker/scripts/worker-entrypoint.sh` | Worker 启动脚本 |

---

## 与 agentscope-java 的对比

| 方面 | agentscope-java | HiClaw |
|---|---|---|
| **定位** | 单 Agent 运行时框架 | 多 Agent 协作操作系统 |
| **架构** | ReActAgent + Toolkit + Memory | Manager + Workers + Teams |
| **通信** | 内部 Mono/Flux | Matrix 协议 (外部 IM) |
| **状态** | Memory 接口 | MinIO 对象存储 |
| **扩展** | Hook + Extension 模块 | Skills 系统 |
| **部署** | Maven + Java 17 | Kubernetes Operator + Helm |
| **安全** | Agent 持有 API Key | Gateway 集中凭证管理 |

---

**下一步**: 阅读 [learning/README.md](../learning/README.md) 开始深入学习