# HiClaw 架构设计

## 三层组织结构

HiClaw 采用企业级组织结构：

```
Admin (人类管理员)
  │
  ├── Manager (AI 协调者；可选部署模式)
  │     ├── Team Leader A (特殊 Worker；团队内调度)
  │     │     ├── Worker A1
  │     │     └── Worker A2
  │     ├── Team Leader B
  │     │     └── Worker B1
  │     └── Worker C (独立 Worker，不在 Team 中)
  │
  └── Human users (真实人类，权限层级)
        ├── Level 1: Admin 等价，可与所有角色对话
        ├── Level 2: 与配置的 Teams' Leaders + Workers 对话
        └── Level 3: 仅与配置的独立 Workers 对话
```

### 设计原则

| 原则 | 说明 |
|---|---|
| **Team Leader 是 Worker** | 相同容器/运行时类，不同 SOUL 和 Skills |
| **Manager 不穿透 Teams** | Manager 只与 Team Leader 对话，不直接对话 Worker |
| **声明式通信策略** | `channelPolicy` 控制 @mentions 权限 |

## 组件关系图

```
┌─────────────────────────────────────────────────────────────┐
│                    hiclaw-controller                        │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐       │
│  │ Higress  │ │ Tuwunel  │ │  MinIO   │ │ Element  │       │
│  │ Gateway  │ │ Matrix   │ │ Storage  │ │   Web    │       │
│  └──────────┘ └──────────┘ └──────────┘ └──────────┘       │
│                      Controller REST API (:8090)            │
└────────────────────────────┬────────────────────────────────┘
                             │
              ┌──────────────┴──────────────┐
              │      hiclaw-manager         │
              │      (Manager Agent)        │
              └──────────────┬──────────────┘
                             │ Matrix Rooms
        ┌────────────────────┼────────────────────┐
        │                    │                    │
        ▼                    ▼                    ▼
  ┌───────────┐       ┌───────────┐       ┌───────────┐
  │ Worker A  │       │ Worker B  │       │ Worker C  │
  │ (OpenClaw)│       │ (QwenPaw) │       │ (Hermes)  │
  └───────────┘       └───────────┘       └───────────┘
```

### 组件职责

| 组件 | 职责 | 技术 |
|---|---|---|
| **hiclaw-controller** | 调和 CRDs、REST API、Worker/Manager 生命周期 | Go Operator |
| **Higress Gateway** | LLM 代理、MCP Server 托管、Consumer 认证 | 网关 |
| **Tuwunel** | Matrix Homeserver，Agent + Human 通信 | Conduwuit fork |
| **MinIO** | 集中式对象存储，Worker 无状态 | S3 兼容 |
| **Element Web** | 浏览器端 Matrix 客户端 | 无配置 |
| **Manager Agent** | 协调任务、管理 Workers、配置 Gateway | OpenClaw/QwenPaw |
| **Worker Agent** | 执行任务，报告进度 | OpenClaw/QwenPaw/Hermes |

## 通信机制

### Matrix (Tuwunel)

**用途**: Human ↔ Manager ↔ Worker 通信

**特点**:
- Human-in-the-loop 可见性：任务分配、进度、干预共享时间线
- 环境变量前缀: `CONDUWUIT_*`
- Matrix Client-Server API

### MinIO (对象存储)

**用途**: 共享文件系统

**路径结构**:
```
minio://hiclaw/
├── agents/<name>/       # Worker 工作空间
├── shared/tasks/        # 共享任务树
├── manager/             # Manager 工作空间
└── teams/<team>/        # 团队共享空间
```

**特点**:
- Worker 无状态，可替换
- Manager 和 Worker 通过 `mc` 客户端同步

### Higress Gateway

**用途**: LLM 流量、MCP Server、API 发布

**路由模型**:
- OpenAI 兼容路由
- per-identity consumer key 认证
- MCP Server 管理

**安全模型**:
```
Worker → Higress (consumer token) → LLM API / MCP Servers
         Higress 持有真实凭证
         Worker 只看到 consumer token
```

## 运行时模型

### Worker 运行时

| Runtime | Stack | Role |
|---|---|---|
| **openclaw** | Node.js / OpenClaw | 主要 Worker，mcporter MCP 调用 |
| **copaw** | Python / AgentScope | 轻量级，浏览器自动化 |
| **hermes** | Python / Hermes Worker | 自主编码，终端沙箱 |

**镜像选择**:
- `hiclaw-worker` — OpenClaw
- `hiclaw-copaw-worker` — QwenPaw
- `hiclaw-hermes-worker` — Hermes

### Manager 运行时

| Runtime | Behavior |
|---|---|
| **openclaw** (默认) | Node/OpenClaw gateway，Matrix "message" tool 模式 |
| **copaw** | Python/QwenPaw，Matrix 通过 `copaw channels send` |

**部署运行时** (`HICLAW_RUNTIME`):
- `local` — 本地嵌入式栈
- `aliyun` — 阿里云部署
- `k8s` — Kubernetes 部署

## 声明式资源 (CRDs)

### Worker CR

```yaml
apiVersion: hiclaw.io/v1beta1
kind: Worker
metadata:
  name: alice
spec:
  model: claude-sonnet-4-6        # LLM 模型
  runtime: openclaw               # 运行时类型
  skills: [github-operations]     # 技能列表
  mcpServers:                     # MCP Servers
    - name: github
      url: https://gateway/mcp/github
      transport: http
  soul: |                         # 人格定义
    You are a frontend engineer...
  expose:                         # 端口发布
    - port: 3000
      protocol: http
  state: Running                  # Running | Sleeping | Stopped
```

### Manager CR

```yaml
apiVersion: hiclaw.io/v1beta1
kind: Manager
metadata:
  name: default
spec:
  model: qwen-plus
  runtime: openclaw
  skills: [...]
  config:
    heartbeatInterval: 60s
    workerIdleTimeout: 5m
```

### Team CR

```yaml
apiVersion: hiclaw.io/v1beta1
kind: Team
metadata:
  name: dev-team
spec:
  leader:
    model: qwen-plus
    runtime: openclaw
  workers:
    - name: alice
    - name: bob
  admin: admin-user
  channelPolicy:
    groupAllowExtra: []
    groupDenyExtra: []
```

### Human CR

```yaml
apiVersion: hiclaw.io/v1beta1
kind: Human
metadata:
  name: john
spec:
  displayName: John Doe
  email: john@example.com
  permissionLevel: 2
```

## Skills 系统

### Skills 结构

```
skill-name/
├── SKILL.md           # Agent 可读指令
├── scripts/           # 可选脚本
└── references/        # 可选参考文档
```

### Manager Skills (16个)

| 分类 | Skills |
|---|---|
| **Worker 管理** | worker-management, worker-model-switch, hiclaw-find-worker |
| **任务管理** | task-management, task-coordination, project-management |
| **团队管理** | team-management, human-management |
| **基础设施** | mcp-server-management, channel-management, matrix-server-management, file-sync-management |
| **工具** | mcporter, model-switch, service-publishing, git-delegation-management |

### Worker 内置 Skills

| Skill | 用途 |
|---|---|
| `file-sync` | MinIO 同步 |
| `mcporter` | MCP 调用 |
| `find-skills` | 技能发现 |
| `project-participation` | 项目参与 |
| `task-progress` | 进度上报 |

## 安全设计

### 凭证层级

| 层级 | 持有内容 |
|---|---|
| **Worker** | Consumer token (Higress 认证) |
| **Manager** | Consumer token + Gateway 配置 |
| **Gateway** | 真实 API 密钥、GitHub PAT、MCP 凭证 |
| **Controller** | Gateway Console 会话、Matrix 管理员密码 |

### 安全模型

```
┌─────────────────────────────────────────────────────────────┐
│                      Higress Gateway                         │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐         │
│  │ LLM API Key │  │ GitHub PAT  │  │ MCP Secrets │         │
│  └─────────────┘  └─────────────┘  └─────────────┘         │
│                     (真实凭证存储)                          │
└────────────────────────────┬────────────────────────────────┘
                             │ Consumer Token 认证
        ┌────────────────────┼────────────────────┐
        │                    │                    │
        ▼                    ▼                    ▼
  ┌───────────┐       ┌───────────┐       ┌───────────┐
  │ Worker A  │       │ Worker B  │       │ Worker C  │
  │ (仅持有   │       │ (仅持有   │       │ (仅持有   │
  │ consumer  │       │ consumer  │       │ consumer  │
  │  token)   │       │  token)   │       │  token)   │
  └───────────┘       └───────────┘       └───────────┘
```

**关键点**:
- Worker 看不到真实凭证
- 攻击者即使攻破 Worker 也无法获取凭证
- Manager 知道 Workers 在做什么，但从不接触真实密钥

## 自检问题

1. Manager-Workers 架构的三层组织结构是什么？
2. Matrix、MinIO、Higress 三者的通信职责分别是什么？
3. Worker 的三种运行时有什么区别？
4. 安全模型如何实现零凭证暴露？

---

**下一步**：阅读 [03-deployment.md](03-deployment.md)