# HiClaw 基础设施

HiClaw 的基础设施包含四个核心组件：Higress Gateway、Tuwunel Matrix、MinIO Storage、Element Web。

---

## Higress AI Gateway

### 概述

Higress 是 AI Gateway，负责：
- LLM 流量代理 (OpenAI 兼容路由)
- MCP Server 托管
- Consumer 认证
- 凭证集中管理

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
  │ consumer  │       │ consumer  │       │ consumer  │
  │ token     │       │ token     │       │ token     │
  └───────────┘       └───────────┘       └───────────┘
```

### 路由模型

| 路由类型 | 路径模式 | 目标 |
|---|---|---|
| **LLM 路由** | `/v1/chat/completions` | LLM Provider API |
| **MCP 路由** | `/mcp-servers/{name}/mcp` | MCP Server |
| **Worker 路由** | `/workers/{name}/` | Worker 暴露端口 |

### Consumer 管理

```bash
# 创建 Consumer (Controller 自动执行)
curl -X POST http://gateway-console/api/v1/consumers \
    -H "Content-Type: application/json" \
    -d '{"name":"worker-alice","key":"consumer-key-xxx"}'

# Consumer 使用 Bearer Token 认证
curl http://gateway/v1/chat/completions \
    -H "Authorization: Bearer consumer-key-xxx"
```

### MCP Server 管理

```bash
# 创建 MCP Server
curl -X PUT http://gateway-console/api/v1/mcp-servers/github \
    -H "Content-Type: application/json" \
    -d '{
        "url": "https://github.com/api/mcp",
        "transport": "http",
        "credentials": {"pat": "ghp_xxx"}
    }'
```

---

## Tuwunel Matrix Homeserver

### 概述

Tuwunel 是 Matrix Homeserver (conduwuit fork)，负责：
- Agent + Human 通信
- 房间管理
- 用户管理

### 配置

环境变量前缀: `CONDUWUIT_*`

```bash
CONDUWUIT_SERVER_NAME=hiclaw.local
CONDUWUIT_DATABASE_PATH=/data/conduwuit.db
CONDUWUIT_ADMIN_PASSWORD=$HICLAW_ADMIN_PASSWORD
```

### Matrix API

| API | 用途 |
|---|---|
| `/_matrix/client/v3/createRoom` | 创建房间 |
| `/_matrix/client/v3/rooms/{id}/invite` | 邀请用户 |
| `/_matrix/client/v3/rooms/{id}/send/m.room.message` | 发送消息 |
| `/_synapse/admin/v2/users/{username}` | 创建用户 |

### 房间结构

```
Room Types:
├── Manager Room          # Manager + Human
├── Worker Room           # Worker + Manager + Human
├── Team Room             # Team Leader + Workers + Human
└── Direct Message (DM)   # 两人私聊
```

---

## MinIO Storage

### 概述

MinIO 是 S3 兼容的对象存储，负责：
- Worker 工作空间
- 共享任务树
- Manager 路径
- Team 共享空间

### 路径结构

```
minio://hiclaw/
├── agents/
│   ├── alice/                # Worker Alice
│   │   ├── workspace/        # 工作空间
│   │   ├── state/            # 状态
│   │   └── artifacts/        # 输出
│   ├── bob/                  # Worker Bob
│   └── manager/              # Manager
├── shared/
│   └── tasks/                # 共享任务
├── teams/
│   ├── dev-team/             # Team 共享
│   └── test-team/
└── skills/
    └── github-operations/    # 按需分发技能
```

### 访问方式

```bash
# mc 命令行
mc alias set hiclaw $MINIO_URL $MINIO_ACCESS_KEY $MINIO_SECRET_KEY

# 同步工作空间
mc mirror hiclaw/agents/alice ~/workspace/

# 推送文件
mc cp ~/workspace/output.json hiclaw/agents/alice/artifacts/

# 列出文件
mc ls hiclaw/agents/alice/workspace/
```

### Worker 无状态设计

| 设计 | 说明 |
|---|---|
| **工作空间在 MinIO** | Worker 启动时从 MinIO 同步 |
| **状态在 MinIO** | 记忆、任务状态持久化 |
| **容器可替换** | 删除容器，数据保留 |

---

## Element Web

### 概述

Element Web 是浏览器端 Matrix 客户端，负责：
- Human 与 Agent 交互界面
- 无需配置即可使用

### 访问

打开 `http://gateway-publicURL` → Element Web 登录

### 功能

| 功能 | 说明 |
|---|---|
| **聊天界面** | 与 Manager/Workers 对话 |
| **房间列表** | 查看所有房间 |
| **@mentions** | 直接与特定 Agent 对话 |
| **文件分享** | 上传/下载文件 |
| **历史消息** | 查看任务历史 |

### 移动端

使用任何 Matrix 客户端连接服务器：
- Element X (iOS/Android)
- FluffyChat (跨平台)
- SchildiChat (桌面)

---

## 组件交互

### Worker 启动时的组件交互

```
1. Controller → Higress: 创建 Consumer
2. Controller → Tuwunel: 创建 Matrix 用户
3. Controller → Tuwunel: 创建房间
4. Controller → MinIO: 推送 Worker 模板
5. Controller → Executor: 创建容器
6. Worker Container:
   ├── → MinIO: 同步工作空间
   ├── → Tuwunel: 连接 Matrix
   ├── → Higress: 获取 LLM/MCP 访问
   └── → Element: Human 可见交互
```

### 任务执行时的组件交互

```
Human → Element → Tuwunel → Worker
    │
    │ 1. Human 发送任务
    │
    ▼
Worker:
    │
    │ 2. Worker 处理任务
    │
    ├── → Higress → LLM API (推理)
    │
    ├── → Higress → MCP Server (工具调用)
    │
    ├── → MinIO (存储输出)
    │
    ▼
Tuwunel → Element → Human
    │
    │ 3. Worker 报告进度/结果
    │
    ▼
Human 看到结果
```

---

## 自检问题

1. Higress Gateway 如何实现零凭证暴露？
2. Tuwunel 的房间结构是什么？
3. MinIO 的路径结构如何组织 Worker 工作空间？
4. Worker 启动时与各组件的交互流程是什么？

---

**完成所有文档学习后**，开始阅读源码：
- `src/hiclaw-controller/api/v1beta1/types.go` → CRD 定义
- `src/hiclaw-controller/internal/controller/` → Reconciler
- `src/manager/agent/AGENTS.md` → Manager 指令
- `src/manager/agent/skills/` → Skills 系统