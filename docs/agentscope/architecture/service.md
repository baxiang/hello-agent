# Agent Service 模块分析

## 源码位置

`examples/agent_service/` 

## 服务架构

```
agent_service/
├── main.py              # FastAPI 入口
├── routers/
│   ├── agent.py         # Agent API 路由
│   ├── session.py       # Session API 路由
│   ├── auth.py          # 认证 API 路由
├── services/
│   ├── agent_manager.py # Agent 池管理
│   ├── session_store.py # Session 存储
│   ├── tenant_store.py  # 租户管理
├── models/
│   ├── requests.py      # Pydantic 请求模型
│   ├── responses.py     # Pydantic 响应模型
└── config.py            # 服务配置
```

## FastAPI 入口

```python
from fastapi import FastAPI

app = FastAPI(
    title="AgentScope Service",
    version="2.0.0",
)

@app.on_event("startup")
async def startup():
    # 初始化 Agent 池
    await init_agent_pool()
    
    # 初始化存储
    await init_stores()

@app.on_event("shutdown")
async def shutdown():
    # 清理资源
    await cleanup_agents()
```

## Agent API

### 端点列表

| 端点 | 方法 | 说明 |
|---|---|---|
| `/api/agents` | GET | 列出可用 Agent |
| `/api/agents/{name}` | GET | 获取 Agent 信息 |
| `/api/agents/{name}/chat` | POST | 发送消息（同步） |
| `/api/agents/{name}/stream` | POST | 发送消息（流式） |

### Chat 端点

```python
@app.post("/api/agents/{name}/chat")
async def chat(
    name: str,
    req: ChatRequest,
    tenant_id: str = Depends(get_current_tenant),
):
    agent = tenant_store.get_agent(tenant_id, name)
    result = await agent.reply(UserMsg("user", req.message))
    
    return ChatResponse(
        response=result.content,
        session_id=agent.state.session_id,
    )
```

### Stream 端点

```python
@app.post("/api/agents/{name}/stream")
async def stream_chat(
    name: str,
    req: ChatRequest,
):
    agent = get_agent(name)
    
    async def event_stream():
        async for evt in agent.reply_stream(UserMsg("user", req.message)):
            yield f"data: {evt.to_json()}\n\n"
    
    return StreamingResponse(
        event_stream(),
        media_type="text/event-stream",
    )
```

## Session API

### 创建 Session

```python
@app.post("/api/sessions")
async def create_session(req: CreateSessionRequest):
    session_id = uuid.uuid4().hex
    state = AgentState(session_id=session_id)
    
    # 创建 Agent
    agent = Agent(
        name=req.agent_name,
        model=get_model(req.model_config),
        state=state,
    )
    
    # 存储到租户
    tenant_store.add_session(req.tenant_id, session_id, agent)
    
    return {"session_id": session_id}
```

### 获取 Session

```python
@app.get("/api/sessions/{session_id}")
async def get_session(session_id: str, tenant_id: str):
    agent = tenant_store.get_session(tenant_id, session_id)
    state = agent.state
    
    return {
        "session_id": session_id,
        "context_length": len(state.context),
        "summary": state.summary,
        "cur_iter": state.cur_iter,
    }
```

## 多租户设计

### TenantContext

```python
class TenantContext:
    tenant_id: str
    agents: dict[str, Agent]
    sessions: dict[str, AgentState]
    
    def create_agent(self, config: AgentConfig) -> Agent:
        """为租户创建专属 Agent"""
    
    def get_agent(self, name: str) -> Agent:
        """获取租户的 Agent"""
    
    def get_session(self, session_id: str) -> AgentState:
        """获取租户的 Session"""
```

### TenantStore

```python
class TenantStore:
    tenants: dict[str, TenantContext]
    
    async def create_tenant(self, tenant_id: str) -> TenantContext:
        """创建新租户"""
        context = TenantContext(tenant_id=tenant_id)
        self.tenants[tenant_id] = context
        return context
    
    def get_tenant(self, tenant_id: str) -> TenantContext:
        """获取租户上下文"""
        return self.tenants.get(tenant_id)
```

## 认证

### JWT 认证

```python
from fastapi import Depends, HTTPException
from jose import JWTError, jwt

async def get_current_tenant(token: str = Header("Authorization")) -> str:
    try:
        payload = jwt.decode(token, SECRET_KEY)
        tenant_id = payload.get("tenant_id")
        if not tenant_id:
            raise HTTPException(401)
        return tenant_id
    except JWTError:
        raise HTTPException(401, "Invalid token")
```

## 启动命令

```bash
# 开发模式
python main.py

# 生产模式
uvicorn main:app --host 0.0.0.0 --port 8000 --workers 4
```

## 设计模式

| 模式 | 应用 |
|---|---|
| **工厂模式** | Agent 创建 |
| **依赖注入** | FastAPI Depends |
| **多租户隔离** | TenantContext |