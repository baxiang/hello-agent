# 沙箱 Agent

Sandbox Agent 是 OpenAI Agents SDK 的安全执行机制——将 Agent 的代码执行隔离在容器中，防止恶意代码影响宿主机。

## 1. 为什么需要沙箱

当 Agent 需要执行代码时（如数据分析、自动化脚本），直接在宿主机执行有安全风险：
- 恶意代码访问文件系统
- 网络攻击
- 资源耗尽

沙箱 Agent 将所有代码执行隔离在独立容器中。

## 2. 创建沙箱 Agent

```python
from agents import Agent
from agents.sandbox import SandboxAgent, SandboxManifest

manifest = SandboxManifest(
    name="data-analysis-sandbox",
    base_image="python:3.11-slim",
    pip_requirements=["pandas", "matplotlib"],
    system_packages=["libopenblas-dev"],
)

sandbox = SandboxAgent(
    manifest=manifest,
    agent_config={
        "name": "data_analyst",
        "instructions": "Analyze the provided data and generate insights.",
        "model": "gpt-4o",
    },
)
```

## 3. SandboxManifest 配置

```python
from agents.sandbox import SandboxManifest, Mount

manifest = SandboxManifest(
    name="my-sandbox",
    base_image="python:3.11-slim",

    # Python 依赖
    pip_requirements=[
        "numpy",
        "pandas",
        "scikit-learn",
    ],

    # 系统包
    system_packages=[
        "git",
        "build-essential",
    ],

    # 文件挂载
    mounts=[
        Mount(
            source="./local_data",
            target="/data",
        ),
        Mount(
            source="./scripts",
            target="/scripts",
        ),
    ],

    # 环境变量
    env={
        "API_KEY": "abc123",
        "DEBUG": "true",
    },

    # 端口暴露
    ports=[8888, 5000],

    # 资源限制
    memory_limit="2g",
    cpu_limit=2,
    timeout=300,  # 最长运行 5 分钟
)
```

## 4. 运行沙箱 Agent

```python
from agents.sandbox import SandboxAgentRunner

runner = SandboxAgentRunner()

# 运行沙箱中的 Agent
result = await runner.run(
    sandbox,
    "Analyze the CSV file at /data/sales.csv and create a summary chart.",
    session_id="analysis-1",
)

print(result.final_output)
# 代码在容器中执行，结果返回给调用方
```

## 5. 沙箱生命周期

```
创建 manifest → 构建镜像 → 启动容器 → Agent 执行 → 保存快照 → 销毁容器
```

### 快照（Snapshot）

```python
# 保存沙箱状态
snapshot = await sandbox.snapshot()
await snapshot.save("analysis-result")

# 从快照恢复
restored = await sandbox.load_snapshot("analysis-result")
```

### 物化（Materialize）

将沙箱配置物化为实际容器：

```python
from agents.sandbox import materialize

container = await materialize(manifest)
# container 是运行中的 Docker/Podman 容器
```

## 6. 远程沙箱

```python
from agents.sandbox import RemoteSandboxAgent

remote_sandbox = RemoteSandboxAgent(
    manifest=manifest,
    agent_config={"name": "remote_agent", ...},
    remote_host="https://sandbox-cluster.example.com",
    auth_token="your-token",
)
```

远程沙箱将代码执行路由到远程服务器（Kubernetes / Docker Swarm），适合多租户和规模化部署。

## 7. 安全最佳实践

```python
manifest = SandboxManifest(
    name="secure-sandbox",

    # 只读文件系统（除了 /tmp 和挂载点）
    read_only_rootfs=True,

    # 禁止网络访问
    network_disabled=True,

    # 非 root 用户
    user="sandbox-user",

    # Capability 限制
    capabilities_drop=["ALL"],
    capabilities_add=[],

    # Seccomp 过滤
    seccomp_profile="default",

    # 资源限制
    memory_limit="512m",
    cpu_limit=1,
    timeout=60,  # 1 分钟超时
)
```

## 8. 沙箱中的工具

沙箱内的 Agent 可以使用所有标准工具，工具在沙箱**外部**执行（宿主机侧）：

```python
@function_tool
def query_database(sql: str) -> list[dict]:
    """数据库查询在宿主机执行，不在沙箱内"""
    return db.execute(sql)

sandbox = SandboxAgent(
    manifest=manifest,
    agent_config={
        "name": "db_analyst",
        "tools": [query_database],  # 工具在外部执行
        "model": "gpt-4o",
    },
)
```

## 9. 调试沙箱

```python
from agents.sandbox import SandboxAgent

sandbox = SandboxAgent(
    manifest=manifest,
    agent_config={...},
    debug=True,  # 启用调试模式
)
# 1. 容器日志实时输出到控制台
# 2. 容器停止后保留（不自动删除）
# 3. 可手动 docker exec 进入容器检查
```

## 10. 与 ADK Code Executor 对比

| 维度 | OpenAI Sandbox Agent | ADK-Python Code Executor |
|------|---------------------|-------------------------|
| 隔离方式 | Docker/Podman 容器 | GKE / Container / Vertex |
| 镜像管理 | Manifest + 自动构建 | 手动构建 |
| 远程执行 | ✅ RemoteSandboxAgent | ✅ |
| 快照 | ✅ Snapshot | ❌ |
| 云平台绑定 | 无（标准容器） | GCP 深度集成 |
| 学习曲线 | 低 | 中 |

## 11. 常见问题

**Q：沙箱需要 Docker 吗？**

A：是的，需要 Docker 或 Podman 运行。RemoteSandboxAgent 可以把 Docker 放在远程服务器。

**Q：沙箱启动慢吗？**

A：首次构建镜像需要几分钟。后续使用缓存镜像，启动几秒内。

**Q：沙箱 Agent 可以调用外部 API 吗？**

A：默认允许网络访问。设置 `network_disabled=True` 可以完全隔离。
