# 08 - Agent Service

## FastAPI 服务架构

AgentScope 提供生产级 FastAPI 服务，支持：
- 多租户隔离
- Session 管理
- 权限控制
- 流式响应

### 服务结构

```
agent_service/
├── main.py              # FastAPI 入口
├── routers/
│   ├── agent.py         # Agent API
│   ├── session.py       # Session API
│   └── auth.py          # 认证 API
├── services/
│   ├── agent_manager.py # Agent 管理
│   └── session_store.py # Session 存储
└── models/
│   └── requests.py      # 请求模型
```

## 启动服务

### 基本启动

```bash
cd examples/agent_service
python main.py
```

### 配置参数

```python
# main.py
from fastapi import FastAPI

app = FastAPI(
    title="AgentScope Service",
    version="2.0.0",
)

@app.on_event("startup")
async def startup():
    # 初始化 Agent 池
    await init_agent_pool()

@app.on_event("shutdown")
async def shutdown():
    # 清理资源
    await cleanup_agents()
```

## API 端点

### Agent API

| 端点 | 方法 | 说明 |
|---|---|---|
| `/api/agents` | GET | 列出可用 Agent |
| `/api/agents/{name}` | GET | 获取 Agent 信息 |
| `/api/agents/{name}/chat` | POST | 发送消息 |
| `/api/agents/{name}/stream` | POST | 流式响应 |

### Session API

| 端点 | 方法 | 说明 |
|---|---|---|
| `/api/sessions` | POST | 创建 Session |
| `/api/sessions/{id}` | GET | 获取 Session |
| `/api/sessions/{id}` | DELETE | 删除 Session |

## 多租户设计

### Tenant 隔离

```python
class TenantContext:
    tenant_id: str
    agents: dict[str, Agent]
    sessions: dict[str, AgentState]
    
    def create_agent(self, config: AgentConfig) -> Agent:
        """为租户创建 Agent"""
    
    def get_session(self, session_id: str) -> AgentState:
        """获取租户 Session"""
```

### Tenant 存储

```python
class TenantStore:
    tenants: dict[str, TenantContext]
    
    async def create_tenant(self, tenant_id: str) -> TenantContext:
        """创建租户"""
    
    async def get_tenant(self, tenant_id: str) -> TenantContext:
        """获取租户"""
```

## Session 管理

### Session 创建

```python
from pydantic import BaseModel

class CreateSessionRequest(BaseModel):
    tenant_id: str
    agent_name: str
    system_prompt: str | None = None

@app.post("/api/sessions")
async def create_session(req: CreateSessionRequest):
    tenant = tenant_store.get_tenant(req.tenant_id)
    state = AgentState(session_id=uuid.uuid4().hex)
    
    session_id = await tenant.create_session(
        agent_name=req.agent_name,
        state=state,
    )
    
    return {"session_id": session_id}
```

### Session 恢复

```python
@app.get("/api/sessions/{session_id}")
async def get_session(session_id: str, tenant_id: str):
    tenant = tenant_store.get_tenant(tenant_id)
    state = tenant.get_session(session_id)
    
    return {
        "session_id": session_id,
        "context_length": len(state.context),
        "summary": state.summary,
    }
```

## 权限控制

### Permission Engine

```python
from agentscope.permission import PermissionEngine, PermissionRule

engine = PermissionEngine()

# 添加规则
engine.add_rule(
    PermissionRule(
        tool_name="Bash",
        behavior=PermissionBehavior.ASK,
        conditions={"command": "rm *"},
    )
)
```

### API 认证

```python
from fastapi import Depends, HTTPException

async def get_current_tenant(token: str = None) -> str:
    # 验证 JWT token
    tenant_id = verify_token(token)
    if not tenant_id:
        raise HTTPException(401, "Invalid token")
    return tenant_id

@app.post("/api/agents/{name}/chat")
async def chat(
    name: str,
    req: ChatRequest,
    tenant_id: str = Depends(get_current_tenant),
):
    # 租户隔离的 Agent
    agent = tenant_store.get_agent(tenant_id, name)
    result = await agent.reply(req.message)
    return {"response": result.content}
```

## 流式响应

### SSE (Server-Sent Events)

```python
from fastapi.responses import StreamingResponse

@app.post("/api/agents/{name}/stream")
async def stream_chat(
    name: str,
    req: ChatRequest,
):
    agent = get_agent(name)
    
    async def event_stream():
        async for evt in agent.reply_stream(req.message):
            yield f"data: {evt.to_json()}\n\n"
    
    return StreamingResponse(
        event_stream(),
        media_type="text/event-stream",
    )
```

## 完整示例

```python
# main.py
import asyncio
from fastapi import FastAPI
from agentscope.agent import Agent
from agentscope.model import OpenAIChatModel
from agentscope.message import UserMsg
import os

app = FastAPI()

agents = {}

@app.on_event("startup")
async def startup():
    agents["default"] = Agent(
        name="default",
        model=OpenAIChatModel(
            model="gpt-4",
            api_key=os.environ["OPENAI_API_KEY"],
        ),
    )

@app.post("/chat")
async def chat(message: str):
    result = await agents["default"].reply(UserMsg("user", message))
    return {"response": result.content}

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
```

## 下一步

- [09-webui.md](09-webui.md) — Web UI 集成
- [10-knowledge.md](10-knowledge.md) — 前置知识清单