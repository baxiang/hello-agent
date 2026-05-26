# HiClaw 完整技术架构 Review

## 项目统计

| 指标 | 数量 |
|---|---|
| **Go 源码** | 167 文件 / 43,724 行 |
| **Shell 脚本** | 97 文件 / 27,085 行 |
| **Python 源码** | 50 文件 |
| **Skills 文档** | 16 文件 / 5,296 行 |
| **Helm Templates** | 15 YAML 文件 |
| **总 Markdown** | 151 文件 |

---

## 核心架构

### 1. 控制平面 (hiclaw-controller)

**Go Operator，43,724 行代码**

```
hiclaw-controller/
├── api/v1beta1/                 # CRD 类型定义 (562 行)
│   └── types.go                 # Worker/Manager/Team/Human 结构体
├── internal/
│   ├── controller/              # Reconciler (5,315 行)
│   │   ├── worker_controller.go # Worker 生命周期
│   │   ├── manager_controller.go # Manager 生命周期
│   │   ├── team_controller.go   # Team 生命周期
│   │   ├── human_controller.go  # Human 生命周期
│   │   └── member_reconcile.go  # 共享成员调和逻辑
│   ├── backend/                 # 执行器 (3,668 行)
│   │   ├── interface.go         # WorkerBackend 接口定义
│   │   ├── docker.go            # Docker 执行器 (17,716 行)
│   │   ├── kubernetes.go        # K8s 执行器 (17,822 行)
│   │   └── registry.go          # 执行器注册
│   ├── service/                 # 业务逻辑 (5,145 行)
│   │   ├── interfaces.go        # Provisioner/Deployer 接口
│   │   ├── provisioner.go       # 资源供应 (58,733 行)
│   │   ├── deployer.go          # 配置部署 (35,325 行)
│   │   ├── credentials.go       # 凭证管理
│   │   └── legacy.go            # 兼容逻辑
│   ├── gateway/                 # Higress 管理 (2,753 行)
│   │   ├── client.go            # Gateway 客户端
│   │   ├── higress.go           # Higress 操作
│   │   └── aigateway.go         # AI Gateway 操作
│   └── matrix/                  # Tuwunel 管理 (2,724 行)
│       ├── client.go            # Matrix 客户端 (26,687 行)
│       └── types.go             # Matrix 类型定义
└── cmd/                         # 入口点
```

### 2. CRD 设计 (api/v1beta1/types.go)

**四种 CRD，562 行**

| CRD | 核心字段 | 关键设计 |
|---|---|---|
| **Worker** | model, runtime, skills, mcpServers, soul, state | ContainerManaged 控制容器生命周期 |
| **Manager** | model, runtime, config, state | WelcomeSent 防止重复欢迎 |
| **Team** | leader, workers, admin, channelPolicy | Members[] 统一成员状态 |
| **Human** | displayName, permissionLevel, accessibleTeams | InitialPassword 仅显示一次 |

**共享类型**:
```go
type AccessEntry struct {
    Service     string                // object-storage | ai-gateway
    Permissions []string
    Scope       *apiextensionsv1.JSON // 权限范围
}

type MCPServer struct {
    Name      string // mcporter-servers.json 中的 key
    URL       string // MCP endpoint
    Transport string // http | sse
}

type ChannelPolicySpec struct {
    GroupAllowExtra []string // 允许额外 @mention
    GroupDenyExtra  []string // 禁止额外 @mention
    DmAllowExtra    []string
    DmDenyExtra     []string
}
```

### 3. Reconcile 循环 (controller/)

**调和阶段流程**:

```
Reconcile(ctx, req)
  │
  ├─► 1. 获取 CR 资源
  │       r.Get(ctx, req.NamespacedName, &worker)
  │
  ├─► 2. 检查删除标记
  │       if !worker.DeletionTimestamp.IsZero()
  │           return reconcileDelete()
  │
  ├─► 3. 添加 Finalizer
  │       controllerutil.AddFinalizer(&worker, "hiclaw.io/cleanup")
  │
  ├─► 4. 调和基础设施 (ReconcileMemberInfra)
  │       ├── Gateway Consumer 创建
  │       ├── Matrix User 注册
  │       ├── Matrix Room 创建
  │       └── MinIO 路径准备
  │
  ├─► 5. 调和 ServiceAccount
  │       EnsureMemberServiceAccount()
  │
  ├─► 6. 调和配置 (ReconcileMemberConfig)
  │       ├── Worker 模板渲染
  │       ├── Skills 推送
  │       └── MCP Server 配置
  │
  ├─► 7. 调和容器 (ReconcileMemberContainer)
  │       Backend.Create() / Backend.Start()
  │
  ├─► 8. 调和端口发布
  │       ReconcileMemberExpose()
  │
  ├─► 9. 更新状态
  │       worker.Status.Phase = computeWorkerPhase()
  │       worker.Status.ObservedGeneration = worker.Generation
  │
  └─► 10. 返回调和结果
          return reconcile.Result{RequeueAfter: 5 * time.Minute}
```

### 4. Backend 接口 (backend/interface.go)

**WorkerBackend 接口**:
```go
type WorkerBackend interface {
    Name() string                    // "docker" | "k8s"
    DeploymentMode() string          // "local" | "cloud"
    Available(ctx) bool              // 是否可用
    NeedsCredentialInjection() bool  // 是否需要凭证注入
    
    Create(ctx, CreateRequest) (*WorkerResult, error)
    Delete(ctx, name string) error
    Start(ctx, name string) error
    Stop(ctx, name string) error
    Status(ctx, name string) (*WorkerResult, error)
}
```

**CreateRequest 关键字段**:
```go
type CreateRequest struct {
    Name            string
    Image           string
    Runtime         string            // openclaw | copaw | hermes
    RuntimeFallback string            // 环境变量 fallback
    Env             map[string]string
    ControllerURL   string            // Controller API 地址
    ServiceAccountName string         // K8s SA 名称
    AuthToken       string            // Docker SA token
    Labels          map[string]string // Pod labels
    Volumes         []VolumeMount     // Docker bind mount
    Ports           []PortMapping     // Docker port binding
    Owner           metav1.Object     // K8s OwnerReference
}
```

**运行时解析**:
```go
func ResolveRuntime(reqRuntime, fallback string) string {
    if reqRuntime != "" {
        return reqRuntime          // 优先级 1
    }
    if fallback != "" {
        return fallback            // 优先级 2
    }
    return RuntimeOpenClaw          // 优先级 3 (默认)
}
```

### 5. Service 层接口 (service/interfaces.go)

**WorkerProvisioner 接口**:
```go
type WorkerProvisioner interface {
    ProvisionWorker(ctx, WorkerProvisionRequest) (*WorkerProvisionResult, error)
    DeprovisionWorker(ctx, WorkerDeprovisionRequest) error
    RefreshCredentials(ctx, workerName) (*RefreshResult, error)
    EnsureWorkerGatewayAuth(ctx, workerName, gatewayKey) error
    ReconcileExpose(ctx, workerName, desired, current) ([]ExposedPortStatus, error)
    EnsureServiceAccount(ctx, workerName) error
    DeleteServiceAccount(ctx, workerName) error
    RequestSAToken(ctx, workerName) (string, error)
    LeaveAllWorkerRooms(ctx, workerName) error
    DeleteWorkerRoom(ctx, roomID) error
}
```

**WorkerDeployer 接口**:
```go
type WorkerDeployer interface {
    DeployPackage(ctx, name, uri, isUpdate) error
    WriteInlineConfigs(name, WorkerSpec) error
    DeployWorkerConfig(ctx, WorkerDeployRequest) error
    PushOnDemandSkills(ctx, workerName, skills, remoteSkills) error
    CleanupOSSData(ctx, workerName) error
    EnsureTeamStorage(ctx, teamName) error
}
```

**ManagerProvisioner 特有方法**:
```go
type ManagerProvisioner interface {
    // ...
    IsManagerJoinedDM(ctx, roomID) (bool, error)       // DM 房间加入检查
    IsManagerLLMAuthReady(ctx, gatewayKey) (bool, error) // Gateway auth 同步检查
    SendManagerWelcomeMessage(ctx, ManagerWelcomeRequest) error
}
```

---

## 基础设施组件

### 1. Higress Gateway (gateway/)

**关键功能**:
- Consumer 创建/删除 (key-auth)
- LLM 路由配置
- MCP Server 托管
- 端口发布管理

**关键代码**:
```go
// higress.go
func (h *HigressClient) CreateConsumer(name, key string) error {
    // POST /api/v1/consumers
}

func (h *HigressClient) CreateMcpServer(name, url, transport string) error {
    // PUT /api/v1/mcp-servers/{name}
}

func (h *HigressClient) CreateRoute(name, path, target string) error {
    // PUT /api/v1/routes/{name}
}
```

### 2. Tuwunel Matrix (matrix/)

**关键功能**:
- Matrix User 注册
- Room 创建/删除
- 用户邀请/踢出
- Admin Bot 命令执行

**关键代码**:
```go
// client.go
func (m *MatrixClient) EnsureUser(ctx, username, password) (*UserCredentials, error) {
    // POST /_synapse/admin/v2/users/{username}
}

func (m *MatrixClient) CreateRoom(ctx, name, preset string) (string, error) {
    // POST /_matrix/client/v3/createRoom
}

func (m *MatrixClient) InviteUser(ctx, roomID, userID string) error {
    // POST /_matrix/client/v3/rooms/{roomID}/invite
}

func (m *MatrixClient) ForceLeaveRoom(ctx, userID, roomID string) error {
    // "!admin users force-leave-room" Admin Bot 命令
}
```

---

## Manager Agent (manager/agent/)

### AGENTS.md 核心指令

**启动流程**:
```
1. Read SOUL.md              — 身份和规则
2. Read memory/YYYY-MM-DD.md — 最近上下文
3. If DM with admin          — Read MEMORY.md
4. YOLO mode check           — 自动决策模式
```

**Gotchas 关键点**:
- @mention 必须使用完整 Matrix ID (带 domain)
- Worker 创建使用 `--no-wait` 并轮询 phase
- 任务必须在 state.json 注册
- MinIO 文件推送后才 @mention Worker
- Push to MinIO BEFORE notifying Worker

**Controller API Rules**:
- ✅ 使用 `hiclaw` CLI
- ❌ 不直接 curl Controller API

### Skills 系统

**16 个 Skills**:
| Skill | 核心职责 |
|---|---|
| `worker-management` | Worker 创建/删除/切换运行时 |
| `task-management` | 任务分配/进度跟踪 |
| `team-management` | Team 创建/协调 |
| `human-management` | Human 用户管理 |
| `mcp-server-management` | MCP Server 配置 |
| `channel-management` | Matrix 房间管理 |
| `file-sync-management` | MinIO 文件同步 |
| `project-management` | 项目进度管理 |
| `task-coordination` | 任务协调 |
| `model-switch` | 模型切换 |
| `service-publishing` | 服务发布 |
| `matrix-server-management` | Matrix 服务器管理 |
| `git-delegation-management` | Git 委派 |
| `mcporter` | MCP 工具调用 |
| `hiclaw-find-worker` | Worker 发现 |
| `worker-model-switch` | Worker 模型切换 |

---

## Helm Chart (helm/hiclaw/)

### values.yaml 核心配置

```yaml
credentials:
  llmApiKey: ""              # LLM API 密钥 (必须)
  adminPassword: ""          # Matrix 管理员密码
  llmProvider: "openai-compat"
  defaultModel: "gpt-5.4"
  llmBaseUrl: ""             # OpenAI 兼容 URL

matrix:
  provider: tuwunel          # tuwunel | synapse
  mode: managed              # managed | existing
  tuwunel:
    persistence:
      size: 10Gi

gateway:
  provider: higress          # higress | ai-gateway
  mode: managed
  publicURL: ""              # Element Web 公开 URL

storage:
  provider: minio            # minio | oss
  mode: managed
  bucket: "hiclaw"
  minio:
    persistence:
      size: 10Gi

manager:
  runtime: openclaw          # openclaw | copaw
  model: ""

worker:
  defaultRuntime: openclaw   # openclaw | copaw | hermes
```

### Templates 结构

```
templates/
├── _helpers.tpl              # 模板函数
├── _helpers.infra.tpl        # 基础设施函数
├── 00-validate.yaml          # 验证
├── controller/               # Controller Deployment
├── element-web/              # Element Web Deployment
├── gateway/                  # Higress 配置
├── matrix/                   # Tuwunel StatefulSet
├── secrets/                  # Secrets
├── storage/                  # MinIO StatefulSet
└── NOTES.txt                 # 安装后提示
```

---

## 安全设计

### 凭证层级

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

### ServiceAccount 认证

**Kubernetes 模式**:
- Pod 使用 ServiceAccount
- Token 通过 projected volume 注入
- Controller 验证 token audience

**Docker 模式**:
- Controller 生成 SA token
- Token 注入容器环境变量

---

## 代码质量分析

### 代码分布

| 模块 | 行数 | 占比 |
|---|---|---|
| backend/ | 3,668 | 8.4% |
| controller/ | 5,315 | 12.2% |
| service/ | 5,145 | 11.8% |
| gateway/ | 2,753 | 6.3% |
| matrix/ | 2,724 | 6.2% |
| manager/agent/ | 5,296 | 12.1% |
| Shell 脚本 | 27,085 | — |

### 设计模式

| 模式 | 应用位置 |
|---|---|
| **接口分离** | service/interfaces.go — 7 个接口 |
| **策略模式** | backend/interface.go — WorkerBackend |
| **模板方法** | Reconcile 循环固定流程 |
| **工厂模式** | Backend Registry |
| **Finalizer** | 资源删除清理 |
| **声明式资源** | CRD + Operator |

### 测试覆盖

| 模块 | 测试文件 |
|---|---|
| backend/ | docker_test.go, kubernetes_test.go |
| gateway/ | client_test.go |
| matrix/ | client_test.go |
| service/ | provisioner_test.go, deployer_test.go |
| controller/ | *_controller_test.go |

---

## 关键技术决策

### 1. CRD 无 Schema 默认值

```go
// types.go 注释解释
// Resolution order:
//  1. The explicit runtime on the request (req.Runtime).
//  2. The caller-provided fallback (req.RuntimeFallback)
//  3. RuntimeOpenClaw — the historical default.

// 原因：API server 会自动填充默认值，导致 env fallback 失效
```

### 2. Members[] 统一状态

```go
// TeamStatus.Members[] 替代三个分散字段：
// - ObservedMembers
// - MemberSpecHashes
// - WorkerExposedPorts
// 原因：减少 patch churn，集中清理逻辑
```

### 3. IsManagerLLMAuthReady 等待

```go
// Gateway WASM auth 同步需要 40-45s
// Joining DM room 只需 10s
// 必须等待 auth 同步完成再发送 welcome
// 否则 Manager 收到 welcome 但无法回复 (401)
```

### 4. SKILL.md 第二人称

```markdown
# Worker Management

## Quick Create
hiclaw create worker --name <NAME> ...

## Gotchas
- Worker name must be lowercase
- Use --no-wait and poll phase
```

---

## 源码阅读路径

### 入门路径

```
1. types.go (562 行) → CRD 定义
2. interface.go (209 行) → Backend 接口
3. interfaces.go (194 行) → Provisioner/Deployer 接口
4. worker_controller.go (413 行) → Reconcile 核心
5. AGENTS.md (272 行) → Manager 指令
```

### 进阶路径

```
1. provisioner.go (58,733 行) → 资源供应逻辑
2. deployer.go (35,325 行) → 配置部署逻辑
3. docker.go (17,716 行) → Docker 执行器
4. kubernetes.go (17,822 行) → K8s 执行器
5. matrix/client.go (26,687 行) → Matrix 客户端
6. gateway/higress.go (21,658 行) → Higress 操作
```

### Helm Chart

```
1. values.yaml (278 行) → 配置选项
2. _helpers.tpl → 模板函数
3. controller/ → Controller Deployment
4. NOTES.txt → 安装提示
```

---

## 技术亮点总结

1. **Kubernetes-native 架构**: CRD + Operator + Helm 完整声明式
2. **接口分离设计**: 7 个服务接口，职责清晰
3. **Backend 策略模式**: Docker/K8s 双执行器
4. **安全零凭证**: Worker 只持有 consumer token
5. **Skills 作为代码**: Markdown 技能文档，Agent 直接理解
6. **Finalizer 清理**: 资源删除级联清理
7. **状态统一**: Members[] 集中管理
8. **Auth 同步等待**: 40-45s Gateway auth propagation