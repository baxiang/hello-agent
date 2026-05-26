# DeerFlow 完整架构分析

## 一、整体架构概览

DeerFlow 2.0 采用分层架构设计，主要分为三层：

```
┌─────────────────────────────────────────────────────────┐
│                      Gateway Layer                       │
│  (FastAPI REST API + IM Channels + Auth + CSRF)         │
└─────────────────────────────────────────────────────────┘
                          ↓
┌─────────────────────────────────────────────────────────┐
│                    Runtime Layer                         │
│  (LangGraph Execution + Stream + Events + Checkpointer) │
└─────────────────────────────────────────────────────────┘
                          ↓
┌─────────────────────────────────────────────────────────┐
│                    Core Layer                            │
│  (Agents + Skills + Tools + Sandbox + Memory + Config)  │
└─────────────────────────────────────────────────────────┘
```

## 二、配置系统架构

### 2.1 配置模块结构

```
backend/packages/harness/deerflow/config/
├── 27个配置文件
├── app_config.py            ← 主配置聚合（457行）
├── model_config.py          ← 模型配置（41行）
├── sandbox_config.py        ← 沙箱配置
├── memory_config.py         ← 记忆配置
├── summarization_config.py  ← 摘要配置
├── tracing_config.py        ← 追踪配置
├── database_config.py       ← 数据库配置
└── ...
```

### 2.2 AppConfig 核心结构

```python
class AppConfig(BaseModel):
    log_level: str
    token_usage: TokenUsageConfig
    models: list[ModelConfig]
    sandbox: SandboxConfig
    tools: list[ToolConfig]
    tool_groups: list[ToolGroupConfig]
    skills: SkillsConfig
    skill_evolution: SkillEvolutionConfig
    extensions: ExtensionsConfig
    tool_search: ToolSearchConfig
    title: TitleConfig
    summarization: SummarizationConfig
    memory: MemoryConfig
    agents_api: AgentsApiConfig
    subagents: SubagentsAppConfig
    guardrails: GuardrailsConfig
    checkpointer: CheckpointerConfig
    database: DatabaseConfig
    run_events: RunEventsConfig
    stream_bridge: StreamBridgeConfig
    acp: ACPConfig
    safety_finish_reason: SafetyFinishReasonConfig
    circuit_breaker: CircuitBreakerConfig
```

### 2.3 配置加载流程

```python
def get_app_config() -> AppConfig:
    """获取应用配置单例"""
    # 1. 加载 .env 环境变量
    # 2. 读取 config.yaml
    # 3. 解析 YAML 到 Pydantic 模型
    # 4. 替换 $VAR 环境变量引用
    # 5. 验证配置合法性
    # 6. 返回配置对象
```

### 2.4 配置特点

- **Pydantic 验证**: 强类型检查
- **环境变量替换**: `$API_KEY` 自动替换
- **单例模式**: 全局共享配置对象
- **热更新**: 后端自动检测 config.yaml 变化

## 三、模型管理系统

### 3.1 模型工厂架构

```
backend/packages/harness/deerflow/models/
├── factory.py               ← 模型创建工厂（171行）
├── credential_loader.py     ← 凭证加载
├── vllm_provider.py         ← vLLM 适配
├── mindie_provider.py       ← MindIE 适配
├── openai_codex_provider.py ← Codex CLI 适配
├── claude_provider.py       ← Claude Code OAuth 适配
├── patched_openai.py        ← OpenAI 修复
├── patched_deepseek.py      ← DeepSeek 修复
└── patched_minimax.py       ← Minimax 修复
```

### 3.2 模型创建流程

```python
def create_chat_model(name: str, thinking_enabled: bool, attach_tracing: bool) -> BaseChatModel:
    # 1. 从 config 获取 ModelConfig
    # 2. resolve_class(model_config.use) 动态加载类
    # 3. 构建 model_settings（合并配置和环境变量）
    # 4. 处理 thinking 模式（supports_thinking）
    # 5. attach_tracing=True 时添加追踪回调
    # 6. 创建模型实例
    # 7. 返回 BaseChatModel
```

### 3.3 支持的 Provider

| Provider | 类路径 | 特性 |
|----------|--------|------|
| OpenAI | `langchain_openai:ChatOpenAI` | Responses API, Stream Usage |
| DeepSeek | `langchain_openai:ChatOpenAI` | Thinking 模式, 修复补丁 |
| Kimi | `langchain_openai:ChatOpenAI` | Moonshot 兼容 |
| vLLM | `deerflow.models.vllm_provider:VllmChatModel` | Qwen 推理模型 |
| Codex CLI | `deerflow.models.openai_codex_provider:CodexChatModel` | CLI 调用 |
| Claude Code | `deerflow.models.claude_provider:ClaudeChatModel` | OAuth 认证 |

### 3.4 Thinking 模式处理

```python
if thinking_enabled and model_config.supports_thinking:
    # 合并 when_thinking_enabled 配置
    model_settings = deep_merge(
        model_settings,
        model_config.when_thinking_enabled
    )
    
    # Qwen/vLLM 特殊处理
    if "chat_template_kwargs" in model_settings:
        model_settings["chat_template_kwargs"]["enable_thinking"] = True
```

## 四、Gateway API 架构

### 4.1 Gateway 模块结构

```
backend/app/gateway/
├── app.py                   ← FastAPI 应用（391行）
├── deps.py                  ← 依赖注入（依赖项）
├── services.py              ← 业务服务层（服务）
├── auth_middleware.py       ← 认证中间件
├── csrf_middleware.py       ← CSRF 保护
├── authz.py                 ← 权限控制
├── internal_auth.py         ← 内部认证
├── langgraph_auth.py        ← LangGraph 认证
├── routers/
│   ├── threads.py           ← 线程管理 API
│   ├── runs.py              ← 运行管理 API
│   ├── thread_runs.py       ← 线程运行 API
│   ├── agents.py            ← Agent 管理 API
│   ├── skills.py            ← Skill 管理 API
│   ├── memory.py            ← 记忆管理 API
│   ├── models.py            ← 模型列表 API
│   ├── mcp.py               ← MCP Server API
│   ├── channels.py          ← IM 渠道 API
│   ├── uploads.py           ← 文件上传 API
│   ├── artifacts.py         ← 输出产物 API
│   ├── feedback.py          ← 反馈 API
│   ├── auth.py              ← 认证 API
│   └── suggestions.py       ← 建议 API
└── auth/
    ├── local_provider.py    ← 本地认证 Provider
    └── ...                  ← 其他认证 Provider
```

### 4.2 FastAPI 应用创建

```python
@asynccontextmanager
async def lifespan(app: FastAPI):
    # Startup
    await langgraph_runtime(app)
    await _ensure_admin_user(app)
    yield
    # Shutdown
    await shutdown_sandbox_provider()
    await close_database_connections()

app = FastAPI(title="DeerFlow Gateway", lifespan=lifespan)

# 中间件
app.add_middleware(CORSMiddleware, ...)
app.add_middleware(AuthMiddleware)
app.add_middleware(CSRFMiddleware)

# 路由注册
app.include_router(threads.router)
app.include_router(runs.router)
app.include_router(agents.router)
...
```

### 4.3 LangGraph 兼容 API

```python
# /api/langgraph/threads - LangGraph Thread API
# /api/langgraph/threads/{thread_id}/runs - LangGraph Run API
# /api/langgraph/assistants - LangGraph Assistant API
# Gateway 翻译到内部 /api/* 路径
```

### 4.4 认证授权流程

```
请求 → AuthMiddleware → 
提取 token → 验证 token → 
获取 user_id → 注入到 context → 
CSRFMiddleware → 验证 CSRF → 
Router → 业务逻辑 → 
返回响应
```

## 五、追踪系统架构

### 5.1 Tracing 模块结构

```
backend/packages/harness/deerflow/tracing/
├── factory.py               ← 追踪工厂（54行）
├── metadata.py              ← 元数据注入
└── __init__.py              ← 导出接口
```

### 5.2 支持的追踪 Provider

```python
def build_tracing_callbacks() -> list[Any]:
    """构建追踪回调"""
    enabled_providers = get_enabled_tracing_providers()
    
    if "langsmith" in enabled_providers:
        callbacks.append(_create_langsmith_tracer(config))
    
    if "langfuse" in enabled_providers:
        callbacks.append(_create_langfuse_handler(config))
    
    return callbacks
```

### 5.3 LangSmith 集成

```python
def _create_langsmith_tracer(config) -> LangChainTracer:
    from langchain_core.tracers.langchain import LangChainTracer
    return LangChainTracer(project_name=config.project)
```

### 5.4 Langfuse 集成

```python
def _create_langfuse_handler(config) -> LangfuseCallbackHandler:
    from langfuse import Langfuse
    from langfuse.langchain import CallbackHandler
    
    # 初始化客户端
    Langfuse(
        secret_key=config.secret_key,
        public_key=config.public_key,
        host=config.host
    )
    
    return LangfuseCallbackHandler(public_key=config.public_key)
```

### 5.5 元数据注入

```python
def inject_langfuse_metadata(config: RunnableConfig) -> RunnableConfig:
    """注入 Langfuse 元数据"""
    metadata = config.get("metadata", {})
    metadata["session_id"] = thread_id
    metadata["user_id"] = get_effective_user_id()
    metadata["trace_name"] = assistant_id
    metadata["tags"] = [f"env:{DEER_FLOW_ENV}", f"model:{model_name}"]
    return config
```

## 六、持久化系统架构

### 6.1 Persistence 模块结构

```
backend/packages/harness/deerflow/persistence/
├── engine.py                ← 数据库引擎
├── base.py                  ← 基础模型
├── models/
│   └── run_event.py         ← 运行事件模型
├── user/
│   └── model.py             ← 用户模型
├── thread_meta/
│   ├── model.py             ← 线程元数据模型
│   ├── sql.py               ← SQL 实现
│   └── memory.py            ← 内存实现
├── feedback/
│   ├── model.py             ← 反馈模型
│   └── sql.py               ← SQL 实现
├── run/
│   ├── model.py             ← 运行模型
│   └── sql.py               ← SQL 实现
└── migrations/
    └── env.py               ← Alembic 迁移环境
```

### 6.2 数据库支持

```yaml
database:
  backend: sqlite     # sqlite | postgres
  sqlite_dir: .deer-flow/data
  postgres_url: postgresql://...
```

### 6.3 模型关系

```
User (用户)
  ↓
ThreadMeta (线程元数据)
  ↓
Run (运行记录)
  ↓
RunEvent (运行事件)
  ↓
Feedback (用户反馈)
```

### 6.4 查询示例

```python
# 线程元数据查询
thread_meta = ThreadMetaStore.get_by_thread_id(thread_id)

# 运行记录查询
runs = RunStore.list_by_thread_id(thread_id)

# 事件查询
events = RunEventStore.list_by_run_id(run_id)
```

## 七、Channels IM 渠道

### 7.1 Channels 模块结构

```
backend/app/channels/
├── manager.py               ← 渠道管理器（40421行，最大）
├── base.py                  ← 渠道基类
├── service.py               ← 渠道服务
├── commands.py              ← 命令处理
├── message_bus.py           ← 消息总线
├── store.py                 ← 渠道存储
├── telegram.py              ← Telegram Bot
├── slack.py                 ← Slack Socket Mode
├── feishu.py                ← 飞书 WebSocket
├── wecom.py                 ← 企业微信 WebSocket
├── wechat.py                ← 微信 iLink
├── dingtalk.py              ← 钉钉 Stream Push
└── discord.py               ← Discord Bot
```

### 7.2 渠道生命周期

```python
class ChannelManager:
    async def start_channels(self):
        """启动所有配置的渠道"""
        for channel in configured_channels:
            await channel.start()
    
    async def stop_channels(self):
        """停止所有渠道"""
        for channel in active_channels:
            await channel.stop()
```

### 7.3 消息处理流程

```
IM消息 → Channel Bot → 
解析消息 → 创建 thread → 
调用 Gateway API → 
执行 Agent → 
返回结果 → 
发送回复到 IM
```

### 7.4 命令支持

| 命令 | 功能 |
|------|------|
| `/new` | 新对话 |
| `/status` | 状态查询 |
| `/models` | 模型列表 |
| `/memory` | 查看记忆 |
| `/help` | 帮助信息 |

## 八、核心设计模式总结

### 8.1 工厂模式
- `create_chat_model()`: 模型创建
- `build_tracing_callbacks()`: 追踪创建
- `get_sandbox_provider()`: 沙箱创建

### 8.2 单例模式
- `get_app_config()`: 配置单例
- `get_memory_queue()`: 记忆队列单例
- `get_sandbox_provider()`: 沙箱单例

### 8.3 Provider 抽象模式
- `SandboxProvider`: 沙箱提供者
- `AuthProvider`: 认证提供者
- `TracingProvider`: 追踪提供者

### 8.4 中间件链模式
- 8+ Agent 中间件可组合
- Auth + CSRF Gateway 中间件
- Sandbox 安全中间件

### 8.5 配置驱动模式
- YAML 配置文件
- Pydantic 验证模型
- 环境变量替换
- 热更新支持

## 九、技术栈总结

| 层级 | 技术 |
|------|------|
| Gateway | FastAPI, Uvicorn, CORS, CSRF |
| Runtime | LangGraph, asyncio, StreamBridge |
| Agent | LangChain, BaseChatModel, Tools |
| Config | Pydantic, YAML, dotenv |
| Database | SQLite, PostgreSQL, Alembic |
| Tracing | LangSmith, Langfuse |
| Sandbox | Docker, Local, asyncio.Lock |
| Channels | Telegram, Slack, Feishu, WeCom, DingTalk |

---

**下一步**: 准备 API Key 实际部署体验运行