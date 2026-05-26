# HiClaw 项目概览

## 什么是 HiClaw？

**HiClaw** 是一个开源的协作多 Agent 操作系统 (Agent Teams Platform)，专注于解决多 Agent 协作的编排问题。

### 核心定位

| 问题 | HiClaw 的解答 |
|---|---|
| **单 Agent 的局限** | 上下文和工具边界 → 要分工 |
| **多 Agent 运行 ≠ 协作** | 生命周期管理 vs 组织结构、通信协议、共享状态 |
| **如何形成团队** | Manager 协调 Workers + Teams + Human-in-the-loop |

### 与单 Agent 框架的对比

| 对比维度 | 单 Agent (如 agentscope-java) | HiClaw |
|---|---|---|
| **架构** | 单体 ReActAgent | Manager + Workers + Teams |
| **通信** | 内部 Mono/Flux | 外部 Matrix 协议 |
| **可见性** | 可选 | 强制 Human-in-the-loop |
| **状态** | Memory 接口 | MinIO 对象存储 |
| **凭证** | Agent 持有 API Key | Gateway 零凭证暴露 |
| **部署** | 应用程序 | Kubernetes Operator |

## 核心特性

### 1. Manager-Workers 架构

```
┌─────────────────────────────────────┐
│           Manager Agent             │
│   (协调者：任务分配、Worker 管理)    │
└──────────────────┬──────────────────┘
                   │
    ┌──────────────┼──────────────┐
    │              │              │
    ▼              ▼              ▼
┌────────┐    ┌────────┐    ┌────────┐
│Worker A│    │Worker B│    │Worker C│
│(前端)  │    │(后端)  │    │(测试)  │
└────────┘    └────────┘    └────────┘
```

**特点**:
- Manager 不需要人工监控每个 Worker
- Manager 通过 Matrix 房间与 Workers 通信
- Human 在同一房间可见所有交互

### 2. 多运行时协作

| 运行时 | 技术栈 | 适用场景 |
|---|---|---|
| **OpenClaw** | Node.js | 任务编排、工具调用、丰富技能生态 |
| **QwenPaw** | Python / AgentScope | 浏览器自动化、快速任务 |
| **Hermes** | Python | 自主编码、终端沙箱、自我改进 |

**协作模式**: 确定性 Agent (OpenClaw/QwenPaw) 作为 Leader 分解任务，Hermes Workers 执行代码。

### 3. MinIO 共享文件系统

**问题**: Agent 间通过消息传递大量 token 消耗

**解决方案**:
- MinIO 作为集中式对象存储
- Worker 无状态，可随时替换
- 工作空间: `agents/<name>/`
- 共享任务: `shared/tasks/`

### 4. Higress AI Gateway

**安全模型**:
```
Worker (consumer token only)
    → Higress Gateway (真实凭证)
        → LLM API / GitHub API / MCP Servers
```

**好处**:
- Worker 看不到真实凭证
- Gateway 集中管理 API 密钥、GitHub PAT
- 安全漏洞风险显著降低

### 5. Matrix 协议 IM

**特点**:
- 完全私有：自托管 Matrix 服务器
- 无厂商锁定：开放协议
- Human-in-the-loop：每个房间包含 Human + Manager + Workers
- 随时干预：无隐藏 Agent-to-Agent 调用

## 快速开始

### 本地安装 (Docker)

```bash
# macOS / Linux
bash <(curl -sSL https://higress.ai/hiclaw/install.sh)

# Windows (PowerShell)
Set-ExecutionPolicy Bypass -Scope Process -Force
iex (New-Object Net.WebClient).DownloadString('https://higress.ai/hiclaw/install.ps1')
```

**资源要求**: 2 CPU + 4GB RAM (最小), 4 CPU + 8GB (推荐多 Worker)

### Kubernetes 安装 (Helm)

```bash
helm repo add higress.io https://higress.io/helm-charts
helm install hiclaw higress.io/hiclaw \
  -n hiclaw-system --create-namespace \
  --set credentials.llmApiKey=<your-api-key> \
  --set credentials.adminPassword=<password> \
  --set gateway.publicURL=http://localhost:18080
```

### 使用流程

```
1. 打开 http://127.0.0.1:18088 (Element Web)
2. Manager 向你问候
3. 在聊天中创建 Worker:
   "创建一个名为 alice 的前端开发 Worker"
4. Manager 创建 Worker 并邀请你到房间
5. 直接与 alice 交互:
   "@alice 实现一个 React 登录页面"
```

## 项目结构

```
HiClaw/
├── hiclaw-controller/   # Go Operator：调和 CRDs
├── helm/hiclaw/         # Helm Chart：K8s 部署
├── manager/             # Manager Agent：OpenClaw/QwenPaw
├── worker/              # OpenClaw Worker
├── copaw/               # QwenPaw Worker (Python)
├── hermes/              # Hermes Worker (Python)
├── openclaw-base/       # 基础镜像
├── install/             # 本地安装脚本
├── docs/                # 用户文档
└── manager/agent/       # Agent 配置和 Skills
```

## 适用场景

| 场景 | 使用 HiClaw |
|---|---|
| **复杂软件项目** | 前端 + 后端 + 测试 多 Agent 协作 |
| **企业级任务** | Human 审批 + Agent 执行 |
| **安全敏感操作** | Gateway 零凭证暴露 |
| **多技能协作** | 不同 Worker 不同技能组合 |
| **跨运行时任务** | OpenClaw 编排 + Hermes 编码 |

## 自检问题

1. HiClaw 解决的核心问题是什么？
2. Manager-Workers 架构与传统单 Agent 有什么区别？
3. Worker 的三种运行时各有什么特点？
4. Higress Gateway 如何实现安全？

---

**下一步**：阅读 [02-architecture.md](02-architecture.md)