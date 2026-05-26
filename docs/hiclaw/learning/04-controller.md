# HiClaw Controller

**位置**: `src/hiclaw-controller/`

## Controller 概述

hiclaw-controller 是一个 Kubernetes Operator，使用 Go 语言编写，负责调和四种 CRD：Worker、Manager、Team、Human。

### 核心职责

| 职责 | 说明 |
|---|---|
| **CRD 调和** | 监控 Worker/Manager/Team/Human 状态，确保符合期望 |
| **REST API** | 提供 :8090 端口的 API 服务 |
| **Worker 生命周期** | 创建/删除/更新 Worker 容器 |
| **Manager 生命周期** | 创建/删除/更新 Manager 容器 |
| **Gateway 配置** | 配置 Higress Consumer、路由、MCP Server |
| **Matrix 配置** | 创建 Matrix 用户、房间 |

---

## 目录结构

```
hiclaw-controller/
├── api/v1beta1/           # CRD 类型定义
│   ├── types.go           # Worker, Manager, Team, Human 结构体
│   ├── register.go        # CRD 注册
│   └── zz_generated.deepcopy.go # 自动生成的深拷贝代码
├── internal/
│   ├── controller/        # Reconciler 实现
│   │   ├── worker_controller.go      # Worker Reconciler
│   │   ├── manager_controller.go     # Manager Reconciler
│   │   ├── team_controller.go        # Team Reconciler
│   │   ├── human_controller.go       # Human Reconciler
│   │   ├── worker_reconcile_*.go     # Worker 各阶段处理
│   │   ├── manager_reconcile_*.go    # Manager 各阶段处理
│   │   └── *_scope.go                # Scope 定义
│   ├── gateway/           # Higress Gateway 管理
│   ├── matrix/            # Tuwunel Matrix 操作
│   ├── oss/               # MinIO/OSS 存储
│   ├── executor/          # 容器执行器 (Docker/K8s)
│   ├── service/           # REST API 实现
│   ├── auth/              # 认证
│   ├── credentials/       # 凭证管理
│   └── backend/           # 后端服务
├── cmd/                   # 入口点
├── bin/                   # hiclaw CLI
├── config/                # 配置
├── test/                  # 测试
├── Dockerfile             # Controller 镜像
├── Dockerfile.embedded    # 嵌入式 Controller 镜像
├── go.mod                 # Go 模块定义
└── supervisord.embedded.conf # 嵌入式进程管理
```

---

## CRD 类型定义

### Worker CRD (api/v1beta1/types.go)

```go
type Worker struct {
    metav1.TypeMeta   `json:",inline"`
    metav1.ObjectMeta `json:"metadata,omitempty"`
    
    Spec   WorkerSpec   `json:"spec,omitempty"`
    Status WorkerStatus `json:"status,omitempty"`
}

type WorkerSpec struct {
    Model         string          `json:"model"`          // LLM 模型
    Runtime       string          `json:"runtime"`        // openclaw | copaw | hermes
    Image         string          `json:"image"`          // 镜像名
    Skills        []string        `json:"skills"`         // 技能列表
    McpServers    []McpServerSpec `json:"mcpServers"`     // MCP Servers
    Soul          string          `json:"soul"`           // 人格定义
    Expose        []ExposeSpec    `json:"expose"`         // 端口发布
    Package       string          `json:"package"`        // 技能包 URL
    State         WorkerState     `json:"state"`          // Running | Sleeping | Stopped
    ChannelPolicy ChannelPolicy   `json:"channelPolicy"`  // 通信策略
}

type WorkerStatus struct {
    State          WorkerState `json:"state"`
    RoomID         string      `json:"roomID"`
    ContainerName  string      `json:"containerName"`
    Conditions     []Condition `json:"conditions"`
}
```

### Manager CRD

```go
type Manager struct {
    metav1.TypeMeta   `json:",inline"`
    metav1.ObjectMeta `json:"metadata,omitempty"`
    
    Spec   ManagerSpec   `json:"spec,omitempty"`
    Status ManagerStatus `json:"status,omitempty"`
}

type ManagerSpec struct {
    Model         string          `json:"model"`
    Runtime       string          `json:"runtime"` // openclaw | copaw
    Image         string          `json:"image"`
    Skills        []string        `json:"skills"`
    McpServers    []McpServerSpec `json:"mcpServers"`
    Soul          string          `json:"soul"`
    Config        ManagerConfig   `json:"config"`
    State         ManagerState    `json:"state"`
}

type ManagerConfig struct {
    HeartbeatInterval   string `json:"heartbeatInterval"`
    WorkerIdleTimeout   string `json:"workerIdleTimeout"`
    NotifyChannel       string `json:"notifyChannel"`
}
```

### Team CRD

```go
type Team struct {
    Spec   TeamSpec   `json:"spec,omitempty"`
    Status TeamStatus `json:"status,omitempty"`
}

type TeamSpec struct {
    Leader        WorkerSpec     `json:"leader"`
    Workers       []WorkerSpec   `json:"workers"`
    Admin         string         `json:"admin"`
    ChannelPolicy ChannelPolicy  `json:"channelPolicy"`
}
```

### Human CRD

```go
type Human struct {
    Spec   HumanSpec   `json:"spec,omitempty"`
    Status HumanStatus `json:"status,omitempty"`
}

type HumanSpec struct {
    DisplayName     string `json:"displayName"`
    Email           string `json:"email"`
    PermissionLevel int    `json:"permissionLevel"` // 1, 2, 3
}
```

---

## Reconciler 机制

### Reconcile 循环

```go
func (r *WorkerReconciler) Reconcile(ctx context.Context, req ctrl.Request) (ctrl.Result, error) {
    // 1. 获取 Worker CR
    worker := &hiclawv1beta1.Worker{}
    if err := r.Get(ctx, req.NamespacedName, worker); err != nil {
        return ctrl.Result{}, client.IgnoreNotFound(err)
    }
    
    // 2. 检查删除标记
    if !worker.DeletionTimestamp.IsZero() {
        return r.reconcileDelete(ctx, worker)
    }
    
    // 3. 添加 Finalizer
    if !controllerutil.ContainsFinalizer(worker, "hiclaw.io/worker-finalizer") {
        controllerutil.AddFinalizer(worker, "hiclaw.io/worker-finalizer")
        if err := r.Update(ctx, worker); err != nil {
            return ctrl.Result{}, err
        }
    }
    
    // 4. 调和基础设施
    result, err := r.reconcileInfra(ctx, worker)
    
    // 5. 调和容器
    result, err = r.reconcileContainer(ctx, worker)
    
    // 6. 调和房间
    result, err = r.reconcileRooms(ctx, worker)
    
    // 7. 更新状态
    if err := r.Status().Update(ctx, worker); err != nil {
        return ctrl.Result{}, err
    }
    
    return ctrl.Result{RequeueAfter: 30 * time.Second}, nil
}
```

### Worker Reconciler (internal/controller/worker_controller.go)

**调和阶段**:
1. `reconcileInfra` — 配置 Gateway Consumer、Matrix 用户
2. `reconcileContainer` — 创建/更新 Worker 容器
3. `reconcileRooms` — 创建 Matrix 房间、邀请 Manager
4. `reconcileDelete` — 清理资源、删除容器

### Manager Reconciler

**调和阶段**:
1. `reconcileConfig` — 配置 Manager 参数
2. `reconcileContainer` — 创建/更新 Manager 容器
3. `reconcileWelcome` — 发送欢迎消息
4. `reconcileDelete` — 清理资源

---

## Gateway 管理 (internal/gateway/)

### Higress 操作

```go
// 创建 Consumer
func (g *GatewayManager) CreateConsumer(name, key string) error {
    // POST /api/v1/consumers
}

// 创建路由
func (g *GatewayManager) CreateRoute(name, path, target string) error {
    // PUT /api/v1/routes/{name}
}

// 创建 MCP Server
func (g *GatewayManager) CreateMcpServer(name, url, transport string) error {
    // PUT /api/v1/mcp-servers/{name}
}
```

---

## Matrix 管理 (internal/matrix/)

### Tuwunel 操作

```go
// 创建 Matrix 用户
func (m *MatrixManager) CreateUser(username, password string) error {
    // POST /_synapse/admin/v2/users/{username}
}

// 创建房间
func (m *MatrixManager) CreateRoom(name string) (string, error) {
    // POST /_matrix/client/v3/createRoom
}

// 邀请用户
func (m *MatrixManager) InviteUser(roomID, userID string) error {
    // POST /_matrix/client/v3/rooms/{roomID}/invite
}
```

---

## Executor (容器执行器) (internal/executor/)

### Docker 执行器

```go
// 创建容器
func (e *DockerExecutor) CreateContainer(spec ContainerSpec) (string, error) {
    // Docker API: POST /containers/create
}

// 启动容器
func (e *DockerExecutor) StartContainer(containerID string) error {
    // Docker API: POST /containers/{id}/start
}

// 删除容器
func (e *DockerExecutor) DeleteContainer(containerID string) error {
    // Docker API: DELETE /containers/{id}
}
```

### Kubernetes 执行器

```go
// 创建 Pod
func (e *K8sExecutor) CreatePod(spec PodSpec) error {
    // Kubernetes API: POST /api/v1/namespaces/{ns}/pods
}

// 删除 Pod
func (e *K8sExecutor) DeletePod(name string) error {
    // Kubernetes API: DELETE /api/v1/namespaces/{ns}/pods/{name}
}
```

---

## REST API (internal/apiserver/ + internal/service/)

### API 端点

| 端点 | 方法 | 说明 |
|---|---|---|
| `/api/v1/workers` | GET, POST | Worker CRUD |
| `/api/v1/workers/{name}` | GET, PUT, DELETE | Worker 操作 |
| `/api/v1/managers` | GET, POST | Manager CRUD |
| `/api/v1/managers/{name}` | GET, PUT, DELETE | Manager 操作 |
| `/api/v1/teams` | GET, POST | Team CRUD |
| `/api/v1/teams/{name}` | GET, PUT, DELETE | Team 操作 |
| `/api/v1/humans` | GET, POST | Human CRUD |
| `/api/v1/humans/{name}` | GET, PUT, DELETE | Human 操作 |

---

## hiclaw CLI (bin/hiclaw)

### 常用命令

```bash
# Worker 操作
hiclaw get workers
hiclaw create worker --name alice --runtime openclaw --model claude-sonnet-4-6
hiclaw update worker alice --state Sleeping
hiclaw delete worker alice

# Manager 操作
hiclaw get managers
hiclaw get managers default

# Team 操作
hiclaw get teams
hiclaw create team --name dev-team --leader-model qwen-plus

# Human 操作
hiclaw get humans
hiclaw create human --name john --email john@example.com
```

---

## 自检问题

1. Controller 调和哪四种 CRD？
2. Worker Reconciler 的调和阶段是什么？
3. Gateway Manager 如何管理 Consumer 和 MCP Server？
4. hiclaw CLI 的常用命令有哪些？

---

**下一步**：阅读 [05-manager.md](05-manager.md)