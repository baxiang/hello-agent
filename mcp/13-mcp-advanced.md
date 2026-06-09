# MCP 进阶架构 — Session·生产部署·安全

> Session 生命周期、三种传输对比、生产部署（Docker/K8s）、安全架构、与 A2A 协同。

## 1. Session 生命周期

```
[Client]                               [Server]
    ├─ connect() ────────────────────→ 建立传输连接
    ├─ Initialize ───────────────────→ 能力协商
    │  {protocolVersion, capabilities}
    │  ←─────── InitializeResult ────
    │  {protocolVersion, serverInfo, instructions}
    ├─ Initialized (notification) ──→ 握手完成
    ├─ tools/list ──────────────────→ 获取工具
    ├─ tools/call ──────────────────→ 调用工具
    │  ←─────── CallToolResult ──────
    ├─ tools/call ──────────────────→ 再次调用
    ├─ Disconnect ──────────────────→ 断开连接
```

- **STDIO**：子进程退出 = session 结束，重连需重启子进程
- **SSE/HTTP**：支持 `sessionID` 恢复，连接意外断开后自动重连

## 2. 传输方式对比

| 维度 | STDIO | SSE | Streamable HTTP |
|------|-------|-----|-----------------|
| 通信方向 | 双向（stdin/out） | Server→Client 推送 | 双向流式 |
| 连接建立 | 子进程启动 | GET /sse + POST | POST 单一端点 |
| 并发调用 | 串行 | 并发 | 并发 |
| 网络 | 本地 | 需要网络 | 需要网络 |
| 进程管理 | Client 负责 | Server 独立 | Server 独立 |
| 认证 | 环境变量 | HTTP Header | Header/Token |
| 代理/LB | N/A | 需 SSE 支持 | 标准 HTTP |

**选择决策**：
```
同机器 → STDIO（零网络开销）
跨机器 → 需要并发 → Streamable HTTP（推荐）
跨机器 → 无需并发 → SSE（兼容性好）
```

## 3. 生产部署

### Docker

```dockerfile
FROM python:3.12-slim
WORKDIR /app
COPY requirements.txt .
RUN pip install -r requirements.txt
COPY server.py .
EXPOSE 8080
CMD ["python", "-m", "mcp", "run", "--transport", "streamable-http", "--port", "8080", "server.py"]
```

### Kubernetes

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: mcp-server
spec:
  replicas: 3
  selector:
    matchLabels:
      app: mcp-server
  template:
    spec:
      containers:
      - name: server
        image: my-mcp-server:latest
        ports:
        - containerPort: 8080
        env:
        - name: WORK_DIR
          value: "/workspace"
        - name: GITHUB_TOKEN
          valueFrom:
            secretKeyRef:
              name: mcp-secrets
              key: github-token
        livenessProbe:
          httpGet:
            path: /health
            port: 8080
---
apiVersion: v1
kind: Service
metadata:
  name: mcp-server
spec:
  selector:
    app: mcp-server
  ports:
  - port: 8080
```

## 4. 安全架构

```
Layer 1: 传输安全
  - STDIO: 进程隔离 | HTTPS: TLS 1.3 | mTLS: 双向证书

Layer 2: 认证
  - Bearer Token / OAuth 2.0 / API Key

Layer 3: 授权（工具级别）
  - 读/写分离 | 工具白名单 | 参数注入防护

Layer 4: 审计
  - 所有调用日志 | 参数+结果记录 | 异常告警
```

## 5. MCP + A2A 协同

```
┌──────────────┐     A2A      ┌──────────────┐
│ Go Coordinator│ ───────────→ │ Python Agent │
│              │              │              │
│ MCP Client ──┼── MCP ──────→│ MCP Client ──┼── MCP ──→ [DB Server]
└──────────────┘              └──────────────┘
```

- **A2A**：跨框架 Agent 任务委托（Go → Python）
- **MCP**：Agent 与工具标准化交互
- **AG-UI**：前端与 Agent 实时通信

## 6. Streamable HTTP 迁移建议

Streamable HTTP 已替代 SSE 成为推荐传输：
- 单一端点（无需 GET /sse + POST /message 两步）
- 双向流式（Server 推送 + Client 流式上传）
- 标准 HTTP（兼容所有代理/LB/CDN）
- 新项目优先使用 Streamable HTTP
