# HiClaw 学习路径

本目录包含学习 HiClaw 源码所需的核心知识和技术文档。

## 学习路径图

```
第一阶段：概念理解 (1-2天)
├── 01-hiclaw-overview.md    ← 项目定位、核心特性
├── 02-architecture.md       ← Manager-Workers 架构、组件关系
└── 03-deployment.md         ← 本地部署 vs Kubernetes 部署

第二阶段：核心组件 (3-5天)
├── 04-controller.md         ← Kubernetes Operator、CRD、Reconciler
├── 05-manager.md            ← Manager Agent、Skills 系统
├── 06-worker.md             ← Worker 运行时 (OpenClaw/QwenPaw/Hermes)
└── 07-infrastructure.md     ← Higress、Tuwunel、MinIO

第三阶段：深入源码 (持续)
├── 08-crd-types.md          ← Worker/Manager/Team/Human 类型定义
├── 09-reconciler.md         ← Reconcile 循环实现
├── 10-skills.md             ← Skills 系统设计与实现
└── 11-matrix-protocol.md    ← Matrix 协议集成
```

## 必读顺序

| 顺序 | 文档 | 重要性 | 预计时间 | 源码关联 |
|---|---|---|---|---|
| 1 | [项目概览](01-hiclaw-overview.md) | ⭐⭐⭐⭐⭐ | 1小时 | README.md |
| 2 | [架构设计](02-architecture.md) | ⭐⭐⭐⭐⭐ | 2小时 | docs/architecture.md |
| 3 | [部署模式](03-deployment.md) | ⭐⭐⭐⭐ | 1小时 | install/, helm/ |
| 4 | [Controller](04-controller.md) | ⭐⭐⭐⭐⭐ | 3小时 | hiclaw-controller/ |
| 5 | [Manager](05-manager.md) | ⭐⭐⭐⭐⭐ | 3小时 | manager/ |
| 6 | [Worker](06-worker.md) | ⭐⭐⭐⭐ | 2小时 | worker/, copaw/, hermes/ |
| 7 | [基础设施](07-infrastructure.md) | ⭐⭐⭐⭐ | 2小时 | Gateway、Matrix、MinIO |

## 技术栈对照

| HiClaw 技术 | 对应知识 | 学习建议 |
|---|---|---|
| **Go (Controller)** | Go 语言基础、Kubernetes Operator | 学习 Kubebuilder/Operator SDK |
| **Kubernetes CRD** | 自定义资源定义 | 阅读 K8s CRD 文档 |
| **Helm Chart** | Kubernetes 包管理 | 学习 Helm values/templates |
| **Matrix 协议** | Matrix Client-Server API | 阅读 Matrix 规范 |
| **Agent Skills** | Markdown 文档设计 | 理解 Agent 提示工程 |
| **Docker/Podman** | 容器生命周期管理 | 理解容器 API |

## 源码入口点推荐

| 学习阶段 | 推荐阅读源码 | 说明 |
|---|---|---|
| 入门 | `src/README.md`, `src/AGENTS.md` | 项目导航 |
| 进阶 | `src/docs/architecture.md` | 架构详解 |
| Controller | `src/hiclaw-controller/api/v1beta1/types.go` | CRD 定义 |
| Controller | `src/hiclaw-controller/internal/controller/*.go` | Reconciler |
| Manager | `src/manager/agent/AGENTS.md` | Manager 指令 |
| Manager | `src/manager/scripts/init/start-manager-agent.sh` | 启动脚本 |
| Worker | `src/worker/Dockerfile`, `src/copaw/Dockerfile` | Worker 构建 |
| Skills | `src/manager/agent/skills/*/SKILL.md` | Skills 定义 |

## 相关资源

| 类型 | 资源 | 链接 |
|---|---|---|
| 官方文档 | HiClaw 文档 | https://hiclaw.io |
| GitHub | 源码仓库 | https://github.com/agentscope-ai/HiClaw |
| 协议 | Matrix 规范 | https://matrix.org/docs |
| Gateway | Higress | https://higress.io |
| Agent | OpenClaw | https://openclaw.ai |

## 学习检查点

完成所有文档学习后，应能回答：

1. HiClaw 与单 Agent 运行时 (如 agentscope-java) 的核心区别是什么？
2. Manager-Workers 架构如何实现人机协同？
3. Worker 的三种运行时 (OpenClaw/QwenPaw/Hermes) 各有什么特点？
4. Kubernetes CRD 如何定义 Worker/Manager/Team/Human？
5. Skills 系统如何让 Agent 学习新能力？
6. 安全模型如何实现零凭证暴露？

---

**下一步**：开始阅读 [01-hiclaw-overview.md](01-hiclaw-overview.md)