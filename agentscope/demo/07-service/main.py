import asyncio
import os

from fastapi import FastAPI
from agentscope.agent import Agent
from agentscope.model import OpenAIChatModel
from agentscope.message import UserMsg


app = FastAPI(title="AgentScope Demo Service")

agents = {}


@app.on_event("startup")
async def startup():
    """初始化 Agent"""
    agents["default"] = Agent(
        name="default",
        system_prompt="You're a helpful assistant.",
        model=OpenAIChatModel(
            model="gpt-4",
            api_key=os.environ.get("OPENAI_API_KEY", ""),
        ),
    )
    print("Agent initialized")


@app.get("/")
async def root():
    """健康检查"""
    return {"status": "ok", "agents": list(agents.keys())}


@app.post("/chat")
async def chat(message: str):
    """同步聊天"""
    result = await agents["default"].reply(UserMsg("user", message))
    return {"response": str(result.content)}


@app.post("/stream")
async def stream(message: str):
    """流式聊天（简化版）"""
    from fastapi.responses import StreamingResponse
    
    async def event_stream():
        async for evt in agents["default"].reply_stream(UserMsg("user", message)):
            yield f"data: {evt.to_json()}\n\n"
    
    return StreamingResponse(
        event_stream(),
        media_type="text/event-stream",
    )


async def main() -> None:
    """本地测试运行"""
    print("=== Agent Service Demo ===")
    print("Starting service on http://localhost:8000")
    print("Endpoints:")
    print("  - GET  /       : Health check")
    print("  - POST /chat   : Sync chat")
    print("  - POST /stream : Stream chat")
    
    import uvicorn
    uvicorn.run(app, host="127.0.0.1", port=8000)


if __name__ == "__main__":
    asyncio.run(main())