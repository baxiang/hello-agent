# HiClaw 学习所需技术知识清单

学习 HiClaw 源码需要掌握以下技术知识，按重要性排序。

---

## 必备知识 (必须掌握)

### 1. Go 语言基础

HiClaw Controller 使用 Go 语言编写 Kubernetes Operator。

| 知识点 | HiClaw 应用 | 学习资源 |
|---|---|---|
| **基础语法** | 结构体、接口、方法 | Go 官方教程 |
| **错误处理** | Reconcile 循环中的 `if err != nil` | Go by Example |
| **并发编程** | goroutine、channel、context | 《Go 并发编程实战》 |
| **包管理** | go.mod、import | Go Modules 教程 |
| **接口与结构体** | CRD 类型定义 (`types.go`) | Go 语言圣经 |
| **指针** | Controller 中的引用传递 | Go 基础教程 |
| **JSON 序列化** | CRD 的 JSON tag | encoding/json 包 |

**关键代码示例**:
```go
// types.go - CRD 定义
type Worker struct {
    metav1.TypeMeta   `json:",inline"`
    metav1.ObjectMeta `json:"metadata,omitempty"`
    Spec   WorkerSpec   `json:"spec,omitempty"`   // JSON tag
    Status WorkerStatus `json:"status,omitempty"`
}

// Reconcile 循环 - 错误处理
func (r *WorkerReconciler) Reconcile(ctx context.Context, req ctrl.Request) (ctrl.Result, error) {
    worker := &hiclawv1beta1.Worker{}
    if err := r.Get(ctx, req.NamespacedName, worker); err != nil {
        return ctrl.Result{}, client.IgnoreNotFound(err)
    }
    // ...
}
```

### 2. Kubernetes 基础

HiClaw 是 Kubernetes-native 系统。

| 知识点 | HiClaw 应用 | 学习资源 |
|---|---|---|
| **Pod/Deployment** | Worker/Manager 容器 | K8s 官方文档 |
| **CRD (自定义资源)** | Worker/Manager/Team/Human CRD | K8s CRD 概念 |
| **Controller** | Reconciler 循环 | K8s Operator 概念 |
| **Namespace** | hiclaw-system namespace | K8s 基础 |
| **Service** | Gateway/Matrix 服务 | K8s 网络 |
| **ConfigMap/Secret** | 凭证存储 | K8s 配置 |
| **PVC (持久卷)** | MinIO 存储 | K8s 存储 |
| **Finalizer** | 资源删除清理 | Operator 进阶 |

**关键概念**:
```yaml
# Worker CRD 示例
apiVersion: hiclaw.io/v1beta1
kind: Worker
metadata:
  name: alice
  namespace: hiclaw-system
spec:
  model: claude-sonnet-4-6
  runtime: openclaw
```

### 3. Kubernetes Operator (Kubebuilder/Controller Runtime)

这是 HiClaw Controller 的核心。

| 知识点 | HiClaw 应用 | 学习资源 |
|---|---|---|
| **Reconcile 循环** | Worker/Manager/Team Reconciler | Kubebuilder 书 |
| **CRD 生成** | `api/v1beta1/types.go` | Controller Runtime |
| **Webhook** | CR 验证 (可选) | Kubebuilder 进阶 |
| **Manager** | Controller Manager | Controller Runtime |
| **Cache** | K8s 资源缓存 | Controller Runtime |
| **Event** | 资源变更事件 | Controller Runtime |
| **Predicate** | 事件过滤 | Controller Runtime |

**关键代码**:
```go
// Reconcile 循环
func (r *WorkerReconciler) Reconcile(ctx context.Context, req ctrl.Request) (ctrl.Result, error) {
    // 1. 获取资源
    // 2. 检查删除
    // 3. 添加 Finalizer
    // 4. 调和逻辑
    // 5. 更新状态
    // 6. 决定重新调和间隔
    return ctrl.Result{RequeueAfter: 30 * time.Second}, nil
}

// SetupWithManager - 注册 Reconciler
func (r *WorkerReconciler) SetupWithManager(mgr ctrl.Manager) error {
    return ctrl.NewControllerManagedBy(mgr).
        For(&hiclawv1beta1.Worker{}).
        Complete(r)
}
```

---

## 核心知识 (重点掌握)

### 4. Helm Chart

用于 Kubernetes 部署。

| 知识点 | HiClaw 应用 | 学习资源 |
|---|---|---|
| **Chart 结构** | `helm/hiclaw/` 目录 | Helm 官方文档 |
| **values.yaml** | 部署配置 | Helm Values |
| **templates/** | K8s 资源模板 | Helm Templates |
| **_helpers.tpl** | 模板函数 | Helm 进阶 |
| **条件渲染** | `{{ if }}` | Helm 语法 |
| **循环** | `{{ range }}` | Helm 语法 |
| **子 Chart** | Higress/MinIO 子 Chart | Helm 依赖 |

**关键文件**:
```yaml
# values.yaml
credentials:
  llmApiKey: ""
  defaultModel: "gpt-5.4"
manager:
  runtime: openclaw
worker:
  defaultRuntime: openclaw
```

### 5. Matrix 协议

用于 Agent-Human 通信。

| 知识点 | HiClaw 应用 | 学习资源 |
|---|---|---|
| **Client-Server API** | Agent 发送消息 | Matrix 规范 |
| **Room** | Worker/Manager 房间 | Matrix Rooms |
| **Event** | m.room.message | Matrix Events |
| **@mentions** | m.mentions | Matrix Mentions |
| **用户管理** | Admin API | Synapse Admin API |
| **房间创建** | createRoom API | Matrix API |
| **邀请** | invite API | Matrix API |

**关键 API**:
```
POST /_matrix/client/v3/createRoom
POST /_matrix/client/v3/rooms/{id}/invite
POST /_matrix/client/v3/rooms/{id}/send/m.room.message
POST /_synapse/admin/v2/users/{username}
```

### 6. Docker/Podman API

用于本地 Worker 创建。

| 知识点 | HiClaw 应用 | 学习资源 |
|---|---|---|
| **容器创建** | Worker 容器 | Docker API |
| **镜像管理** | Worker 镜像拉取 | Docker API |
| **网络配置** | 容器网络 | Docker 网络 |
| **Volume** | 数据挂载 | Docker 存储 |
| **环境变量** | 容器配置 | Docker run |
| **REST API** | 容器操作 API | Docker Engine API |

**关键 API**:
```
POST /containers/create
POST /containers/{id}/start
DELETE /containers/{id}
GET /containers/{id}/json
```

### 7. AI Gateway (Higress)

用于 LLM 和 MCP 管理。

| 知识点 | HiClaw 应用 | 学习资源 |
|---|---|---|
| **路由配置** | LLM/MCP 路由 | Higress 文档 |
| **Consumer** | Worker 认证 | Gateway 认证 |
| **Key Auth** | Bearer Token | Gateway 安全 |
| **MCP Server** | MCP 托管 | Higress MCP |
| **上游配置** | LLM Provider | Gateway 路由 |

**关键概念**:
```
Worker → Gateway (Consumer Token) → LLM API
Worker → Gateway (Consumer Token) → MCP Server
Gateway 持有真实凭证，Worker 只持有 consumer token
```

---

## 进阶知识 (推荐掌握)

### 8. MinIO/S3 API

用于 Worker 文件存储。

| 知识点 | HiClaw 应用 | 学习资源 |
|---|---|---|
| **mc 命令行** | 文件同步 | MinIO Client |
| **Bucket** | hiclaw bucket | S3 概念 |
| **Object** | Worker 工作空间文件 | S3 Object |
| **Copy/Mirror** | 文件复制/同步 | mc 命令 |
| **Presigned URL** | 文件分享 | S3 URL |

**关键命令**:
```bash
mc alias set hiclaw $URL $KEY $SECRET
mc mirror hiclaw/agents/alice ~/workspace/
mc cp ~/output.json hiclaw/agents/alice/
mc ls hiclaw/agents/alice/
```

### 9. Shell 脚本

用于 Manager/Worker 启动脚本。

| 知识点 | HiClaw 应用 | 学习资源 |
|---|---|---|
| **变量与环境变量** | HICLAW_* 环境变量 | Bash 基础 |
| **条件判断** | `if [ ]` | Bash 脚本 |
| **函数** | 共享库函数 | Bash 函数 |
| **curl/http 请求** | REST API 调用 | Bash HTTP |
| **进程管理** | supervisord | Supervisor |
| **文本处理** | jq/sed | Bash 文本 |

**关键脚本**:
```bash
# start-manager-agent.sh
source /opt/hiclaw/scripts/lib/hiclaw-env.sh

if [ "$HICLAW_MANAGER_RUNTIME" = "copaw" ]; then
    source /opt/hiclaw/scripts/init/start-copaw-manager.sh
else
    source /opt/hiclaw/scripts/init/start-openclaw-manager.sh
fi
```

### 10. Agent 运行时 (OpenClaw/QwenPaw/Hermes)

用于理解 Worker 执行逻辑。

| 运行时 | 技术栈 | 学习重点 |
|---|---|---|
| **OpenClaw** | Node.js | Gateway、Matrix plugin、Skills |
| **QwenPaw** | Python/AgentScope | copaw CLI、channels send |
| **Hermes** | Python | 终端沙箱、持久记忆、自我改进 |

**Skills 系统**:
- SKILL.md 是 Agent 可读的指令文档
- 使用第二人称 ("you") 编写
- 包含命令、工具、示例

---

## 可选知识 (加分项)

### 11. Python (QwenPaw/Hermes)

| 知识点 | HiClaw 应用 |
|---|---|---|
| **Python 3.11+** | Hermes/QwenPaw 运行时 |
| **venv** | Python 环境管理 |
| **AgentScope** | QwenPaw 底层框架 |
| **异步编程** | async/await |

### 12. Node.js (OpenClaw)

| 知识点 | HiClaw 应用 |
|---|---|---|
| **Node.js 22** | OpenClaw 运行时 |
| **Gateway 模式** | OpenClaw gateway |
| **Plugin** | Matrix/mcporter 插件 |

### 13. MCP (Model Context Protocol)

| 知识点 | HiClaw 应用 |
|---|---|---|
| **MCP 概念** | 工具协议 |
| **HTTP Transport** | MCP Server 连接 |
| **mcporter CLI** | Worker MCP 调用 |

### 14. 监控/日志

| 知识点 | HiClaw 应用 |
|---|---|---|
| **Prometheus** | Controller metrics |
| **Grafana** | 监控仪表板 |
| **结构化日志** | Controller 日志 |

---

## 学习路径建议

### 第一阶段：Go + Kubernetes (2-3周)

```
Week 1: Go 语言基础
├── 语法、错误处理、并发
└── 阅读 Go by Example

Week 2: Kubernetes 基础
├── Pod、Deployment、Service、Namespace
└── 阅读 K8s 官方文档 Concepts

Week 3: Operator 开发
├── CRD、Reconciler、Controller Runtime
└── 阅读 Kubebuilder 书
```

### 第二阶段：基础设施 (1-2周)

```
Week 4: Helm + Matrix
├── Helm Chart 结构、values、templates
└── Matrix API (房间、用户、消息)

Week 5: Gateway + Storage
├── Higress 路由、Consumer、MCP
└── MinIO mc 命令
```

### 第三阶段：源码阅读 (持续)

```
按顺序阅读源码:
1. types.go → CRD 定义
2. worker_controller.go → Reconcile 循环
3. manager_controller.go → Manager 生命周期
4. setup-higress.sh → Gateway 配置
5. AGENTS.md → Manager 指令
6. SKILL.md → Skills 示例
```

---

## 自检清单

完成学习后，应能理解以下代码：

### Go Operator

```go
// 能理解这段代码的含义
func (r *WorkerReconciler) Reconcile(ctx context.Context, req ctrl.Request) (ctrl.Result, error) {
    worker := &hiclawv1beta1.Worker{}
    if err := r.Get(ctx, req.NamespacedName, worker); err != nil {
        return ctrl.Result{}, client.IgnoreNotFound(err)
    }
    
    if !worker.DeletionTimestamp.IsZero() {
        return r.reconcileDelete(ctx, worker)
    }
    
    if !controllerutil.ContainsFinalizer(worker, finalizer) {
        controllerutil.AddFinalizer(worker, finalizer)
        if err := r.Update(ctx, worker); err != nil {
            return ctrl.Result{}, err
        }
    }
    
    return ctrl.Result{RequeueAfter: 30 * time.Second}, nil
}
```

### Helm Values

```yaml
# 能理解这段配置的含义
helm install hiclaw higress.io/hiclaw \
  -n hiclaw-system --create-namespace \
  --set credentials.llmApiKey=$API_KEY \
  --set manager.runtime=copaw \
  --set worker.defaultRuntime=hermes
```

### Matrix API

```bash
# 能理解这段 API 调用的含义
curl -X POST $MATRIX_URL/_matrix/client/v3/createRoom \
    -H "Authorization: Bearer $ACCESS_TOKEN" \
    -d '{"name":"Worker: Alice","preset":"private_chat"}'
```

### Shell 脚本

```bash
# 能理解这段脚本的含义
if [ "$HICLAW_RUNTIME" = "local" ]; then
    /opt/hiclaw/scripts/init/setup-higress.sh
elif [ "$HICLAW_RUNTIME" = "k8s" ]; then
    # K8s 模式跳过本地配置
    echo "Running in Kubernetes mode"
fi
```

---

## 推荐学习资源

| 类型 | 资源 | 链接 |
|---|---|---|
| **Go 语言** | Go 官方教程 | https://go.dev/learn |
| **Go 语言** | Go by Example | https://gobyexample.com |
| **Go 语言** | 《Go 语言圣经》 | 书籍 |
| **Kubernetes** | K8s 官方文档 | https://kubernetes.io/docs |
| **Operator** | Kubebuilder 书 | https://book.kubebuilder.io |
| **Operator** | Controller Runtime | https://github.com/kubernetes-sigs/controller-runtime |
| **Helm** | Helm 官方文档 | https://helm.sh/docs |
| **Matrix** | Matrix 规范 | https://matrix.org/docs |
| **Higress** | Higress 文档 | https://higress.io/docs |
| **MinIO** | MinIO Client | https://min.io/docs/minio-client |

---

**下一步**: 根据你的技术背景，选择从 Go + K8s 开始，或从 Helm + Matrix 开始。