# DeerFlow 快速部署指南

## 1. 前置要求

### 1.1 系统要求

| 部署方式 | 最低配置 | 推荐配置 |
|---------|---------|---------|
| 本地开发 | 4 vCPU, 8 GB RAM | 8 vCPU, 16 GB RAM |
| Docker Dev | 4 vCPU, 8 GB RAM | 8 vCPU, 16 GB RAM |
| 生产部署 | 8 vCPU, 16 GB RAM | 16 vCPU, 32 GB RAM |

### 1.2 必备工具

- **Git**: 用于克隆仓库
- **Docker**: 用于容器化部署（推荐）
- **Node.js 22+**: 前端依赖（本地开发需要）
- **Python 3.12+**: 后端依赖（本地开发需要）
- **uv**: Python 包管理器（本地开发需要）
- **pnpm**: Node 包管理器（本地开发需要）

检查命令：
```bash
# 检查 Git
git --version

# 检查 Docker
docker --version

# 检查 Node.js（本地开发）
node --version  # 需要 >= 22

# 检查 Python（本地开发）
python3 --version  # 需要 >= 3.12

# 检查 uv（本地开发）
uv --version

# 检查 pnpm（本地开发）
pnpm --version
```

### 1.3 LLM API Key

推荐模型：
- **DeepSeek v3.2**: 性价比高，适合中文
- **Kimi 2.5**: Moonshot AI，中文效果好
- **Doubao-Seed-2.0-Code**: 字节跳动，代码能力强

获取 API Key：
- DeepSeek: https://platform.deepseek.com/
- Kimi: https://platform.moonshot.cn/
- OpenAI: https://platform.openai.com/

## 2. Docker 部署（推荐）

### 2.1 克隆仓库

```bash
git clone https://github.com/bytedance/deer-flow.git
cd deer-flow
```

### 2.2 运行配置向导

```bash
make setup
```

向导会引导你：
1. 选择 LLM Provider
2. 输入 API Key
3. 配置 Web Search（可选）
4. 选择 Sandbox 模式

生成的配置文件：
- `config.yaml`: 主配置文件
- `.env`: 环境变量（包含 API Key）

### 2.3 启动服务

```bash
# 拉取沙箱镜像（首次或镜像更新时）
make docker-init

# 启动开发服务（热重载）
make docker-start
```

启动后访问: http://localhost:2026

### 2.4 验证部署

```bash
# 检查服务状态
make doctor

# 查看日志
docker logs deer-flow-gateway
```

### 2.5 停止服务

```bash
make docker-stop
```

## 3. 本地开发部署

### 3.1 安装依赖

```bash
# 克隆仓库
git clone https://github.com/bytedance/deer-flow.git
cd deer-flow

# 运行配置向导
make setup

# 安装所有依赖
make install
```

### 3.2 启动开发服务

```bash
# 前台启动
make dev

# 或后台启动
make dev-daemon
```

启动后访问: http://localhost:2026

### 3.3 停止服务

```bash
make stop
```

### 3.4 检查服务

```bash
# 检查配置
make doctor

# 检查依赖
make check
```

## 4. 基础配置

### 4.1 config.yaml 结构

```yaml
# LLM 配置
models:
  - name: deepseek-v3
    display_name: DeepSeek V3
    use: langchain_openai:ChatOpenAI
    model: deepseek-chat
    api_key: $DEEPSEEK_API_KEY
    base_url: https://api.deepseek.com/v1

# Sandbox 配置
sandbox:
  use: deerflow.community.aio_sandbox:AioSandboxProvider
  mode: docker  # local 或 docker

# Web Search（可选）
web_search:
  provider: tavily
  api_key: $TAVILY_API_KEY
```

### 4.2 .env 文件

```bash
# LLM API Keys
DEEPSEEK_API_KEY=your-deepseek-api-key
OPENAI_API_KEY=your-openai-api-key
KIMI_API_KEY=your-kimi-api-key

# Web Search（可选）
TAVILY_API_KEY=your-tavily-api-key

# Tracing（可选）
LANGSMITH_TRACING=true
LANGSMITH_API_KEY=your-langsmith-key
```

### 4.3 手动配置

如果不想使用向导：

```bash
# 复制配置模板
make config

# 编辑 config.yaml
vim config.yaml

# 编辑 .env
vim .env
```

## 5. 执行第一个任务

### 5.1 通过 Web UI

1. 打开浏览器访问 http://localhost:2026
2. 在聊天框输入任务，例如：
   ```
   研究 2026 年 AI Agent 发展趋势，生成一份简要报告
   ```
3. 观察任务执行过程：
   - Lead Agent 分析任务
   - 可能生成 Sub-Agents
   - 使用 Research Skill
   - 生成 Report
4. 查看结果和输出文件

### 5.2 通过 API

```bash
# 创建 thread
curl -X POST http://localhost:2026/api/langgraph/threads \
  -H "Content-Type: application/json" \
  -d '{}'

# 返回: {"thread_id": "xxx"}

# 创建 run
curl -X POST http://localhost:2026/api/langgraph/threads/{thread_id}/runs \
  -H "Content-Type: application/json" \
  -d '{
    "assistant_id": "lead_agent",
    "input": {
      "messages": [{"role": "user", "content": "研究 AI Agent 发展趋势"}]
    }
  }'

# 流式获取结果
curl -X GET http://localhost:2026/api/langgraph/threads/{thread_id}/runs/{run_id}/stream
```

### 5.3 观察执行过程

查看日志：
```bash
# Docker 部署
docker logs -f deer-flow-gateway

# 本地部署
tail -f .deer-flow/logs/gateway.log
```

观察关键信息：
- Agent 状态转换
- Sub-Agent 创建和执行
- Tool 调用记录
- Token 使用情况

## 6. 常见问题

### 6.1 Docker 权限问题

```bash
# Linux 上需要加入 docker 组
sudo usermod -aG docker $USER
newgrp docker

# 重新登录后重试
```

### 6.2 API Key 配置错误

```bash
# 检查 .env 文件
cat .env | grep API_KEY

# 确保没有多余空格或引号
DEEPSEEK_API_KEY=sk-xxxx  # 正确
DEEPSEEK_API_KEY="sk-xxxx"  # 错误（某些情况下）
```

### 6.3 端口占用

```bash
# 检查端口占用
lsof -i :2026

# 修改端口（config.yaml）
gateway:
  port: 3000
```

### 6.4 依赖安装失败

```bash
# 清理并重新安装
make clean
make install
```

## 7. 下一步

完成部署后：
- 阅读 `02-Agent编排架构/部署体验.md` 学习 Agent 编排
- 尝试不同执行模式（Flash/Standard/Pro/Ultra）
- 查看生成的文件和输出结果
- 开始源码分析阶段

---

## 部署记录

部署日期：____________
部署方式：____________
LLM Provider：____________
遇到的问题：____________
解决方案：____________

---

## 参考资料

- [Install.md](https://github.com/bytedance/deer-flow/blob/main/Install.md)
- [CONTRIBUTING.md](https://github.com/bytedance/deer-flow/blob/main/CONTRIBUTING.md)
- [config.example.yaml](https://github.com/bytedance/deer-flow/blob/main/config.example.yaml)