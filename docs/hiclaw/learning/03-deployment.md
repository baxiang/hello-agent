# HiClaw 部署模式

## 两种部署模式

| 模式 | 适用场景 | 特点 |
|---|---|---|
| **本地单机部署** | 开发、测试、个人使用 | 嵌入式容器，一键安装 |
| **Kubernetes 部署** | 生产、共享、企业 | Helm Chart，组件独立 |

---

## 本地单机部署 (install/)

### 架构

**嵌入式控制器**: 一个容器包含所有基础设施

```
+--------------------------- hiclaw-controller (embedded) --------------------------+
|  Higress (:8080)   Tuwunel (:6167)   MinIO (:9000)   Element+nginx   controller |
|                              hiclaw-controller REST API :8090                     |
+-------------------------------+--------------+-------------------------------------+
                                | Docker API |
              +-----------------+----------------+------------------+
              |                                  |
       hiclaw-manager                     hiclaw-worker-*
       (轻量级)                            (轻量级)
```

### 安装脚本

**macOS / Linux**:
```bash
bash <(curl -sSL https://higress.ai/hiclaw/install.sh)
```

**Windows (PowerShell 7+)**:
```powershell
Set-ExecutionPolicy Bypass -Scope Process -Force
iex (New-Object Net.WebClient).DownloadString('https://higress.ai/hiclaw/install.ps1')
```

### 安装流程

1. 选择 LLM 提供商 (OpenAI 兼容 API)
2. 输入 API 密钥
3. 选择网络模式 (本地或外部访问)
4. 等待安装完成

### 资源要求

| 配置 | CPU | RAM | 适用场景 |
|---|---|---|---|
| 最小 | 2 核 | 4 GB | 单 Worker |
| 推荐 | 4 核 | 8 GB | 多 Worker |

### 端口映射

| 端口 | 服务 |
|---|---|
| 18088 | Element Web (浏览器访问) |
| 18080 | Higress Gateway |
| 6167 | Tuwunel Matrix |
| 9000 | MinIO |

### 访问方式

打开 http://127.0.0.1:18088 → Element Web 登录 → Manager 向你问候

**移动端**: 使用任何 Matrix 客户端 (Element, FluffyChat) 连接服务器

### 升级

```bash
# 升级到最新版本 (保留所有数据)
bash <(curl -sSL https://higress.ai/hiclaw/install.sh)

# 升级到特定版本
HICLAW_VERSION=v1.1.0 bash <(curl -sSL https://higress.ai/hiclaw/install.sh)
```

### 卸载

```bash
# macOS / Linux
bash <(curl -fsSL https://raw.githubusercontent.com/higress-group/hiclaw/main/install/hiclaw-install.sh) uninstall

# Windows (PowerShell)
Set-ExecutionPolicy Bypass -Scope Process -Force
$s = (New-Object Net.WebClient).DownloadString('https://raw.githubusercontent.com/higress-group/hiclaw/main/install/hiclaw-install.ps1')
& ([scriptblock]::Create($s)) uninstall
```

---

## Kubernetes 部署 (helm/hiclaw)

### 架构

**Helm Chart**: 每个组件独立 Pod

```
┌─────────────────────────────────────────────────────────────────┐
│                        Kubernetes Cluster                        │
│  ┌─────────────────────────────────────────────────────────────┐│
│  │                    hiclaw-system namespace                   ││
│  │                                                             ││
│  │  ┌────────────────┐  ┌────────────────┐  ┌────────────────┐││
│  │  │ Higress Gateway│  │ Tuwunel        │  │ MinIO          │││
│  │  │ Deployment     │  │ StatefulSet    │  │ Deployment     │││
│  │  └────────────────┘  └────────────────┘  └────────────────┘││
│  │                                                             ││
│  │  ┌────────────────┐  ┌────────────────┐  ┌────────────────┐││
│  │  │ Element Web    │  │ Controller     │  │ Manager Pod    │││
│  │  │ Deployment     │  │ Deployment     │  │ (from CR)      │││
│  │  └────────────────┘  └────────────────┘  └────────────────┘││
│  │                                                             ││
│  │  ┌────────────────┐  ┌────────────────┐                   ││
│  │  │ Worker Pod A   │  │ Worker Pod B   │  ...              ││
│  │  │ (from CR)      │  │ (from CR)      │                   ││
│  │  └────────────────┘  └────────────────┘                   ││
│  └─────────────────────────────────────────────────────────────┘│
└─────────────────────────────────────────────────────────────────┘
```

### 前置条件

| 条件 | 说明 |
|---|---|
| Kubernetes 1.24+ | kind/minikube/k3s/托管 K8s 都支持 |
| Helm 3.7+ | Helm CLI |
| StorageClass | 默认存储类 (用于 Tuwunel + MinIO PVCs) |

### 安装命令

**OpenAI / OpenAI 兼容**:
```bash
helm repo add higress.io https://higress.io/helm-charts
helm repo update

helm install hiclaw higress.io/hiclaw \
  -n hiclaw-system --create-namespace \
  --render-subchart-notes \
  --set credentials.llmApiKey=<your-api-key> \
  --set credentials.adminPassword=<your-admin-password> \
  --set gateway.publicURL=http://localhost:18080
```

**Qwen (通义千问)**:
```bash
helm install hiclaw higress.io/hiclaw \
  -n hiclaw-system --create-namespace \
  --set credentials.llmApiKey=<your-qwen-api-key> \
  --set credentials.llmProvider=qwen \
  --set credentials.defaultModel=qwen3.5-plus \
  --set credentials.adminPassword=<password> \
  --set gateway.publicURL=http://localhost:18080
```

### Helm Values 配置

| Value | Required | Description |
|---|---|---|
| `credentials.llmApiKey` | yes | LLM API 密钥 |
| `gateway.publicURL` | yes | Element Web 公开 URL |
| `credentials.adminPassword` | recommended | Matrix 管理员密码 |
| `credentials.llmProvider` | no | LLM 提供商 (默认 openai-compat) |
| `credentials.defaultModel` | no | 默认模型 (默认 gpt-5.4) |
| `credentials.llmBaseUrl` | no | OpenAI 兼容 URL |
| `manager.runtime` | no | Manager 运行时 (默认 openclaw) |
| `worker.defaultRuntime` | no | Worker 默认运行时 (默认 openclaw) |

### 多区域镜像仓库

| 区域 | Registry |
|---|---|
| 中国 (默认) | `higress-registry.cn-hangzhou.cr.aliyuncs.com/higress` |
| 北美 | `higress-registry.us-west-1.cr.aliyuncs.com/higress` |
|东南亚 | `higress-registry.ap-southeast-7.cr.aliyuncs.com/higress` |

**示例**: 北美部署
```bash
helm install hiclaw higress.io/hiclaw \
  -n hiclaw-system --create-namespace \
  --set global.imageRegistry=higress-registry.us-west-1.cr.aliyuncs.com/higress \
  --set credentials.llmApiKey=<your-api-key> \
  --set credentials.adminPassword=<password> \
  --set gateway.publicURL=http://localhost:18080
```

### 访问方式

**端口转发**:
```bash
kubectl port-forward -n hiclaw-system svc/higress-gateway 18080:80
```

打开 http://localhost:18080 → Element Web 登录

**生产环境**: 配置 Ingress/LoadBalancer/DNS 指向 `svc/higress-gateway`

### 升级

```bash
helm repo update
helm upgrade hiclaw higress.io/hiclaw -n hiclaw-system --reuse-values
```

### 卸载

```bash
helm uninstall hiclaw -n hiclaw-system
kubectl delete namespace hiclaw-system
```

---

## 部署模式对比

| 对比项 | 本地单机 | Kubernetes |
|---|---|---|
| **部署复杂度** | 一键安装 | Helm 配置 |
| **资源隔离** | 共享容器 | 独立 Pod |
| **可扩展性** | 单主机 | 多节点集群 |
| **持久化** | Docker Volume | PVC |
| **监控** | Docker logs | Prometheus/Grafana |
| **适用场景** | 开发测试 | 生产环境 |

---

## 自检问题

1. 本地单机部署和 Kubernetes 部署的主要区别是什么？
2. 嵌入式控制器包含哪些组件？
3. Helm Chart 的核心 Values 有哪些？
4. 如何选择镜像仓库区域？

---

**下一步**：阅读 [04-controller.md](04-controller.md)