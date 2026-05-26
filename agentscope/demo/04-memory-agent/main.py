import asyncio
import os

from agentscope.agent import Agent, ContextConfig
from agentscope.model import OpenAIChatModel
from agentscope.message import UserMsg
from agentscope.state import AgentState


async def main() -> None:
    """记忆系统示例
    
    步骤：
    1. 创建 AgentState（Session 管理）
    2. 配置 ContextConfig（压缩设置）
    3. 多轮对话展示记忆持久化
    """
    
    session_id = "demo_session_001"
    state = AgentState(session_id=session_id)
    
    context_config = ContextConfig(
        trigger_ratio=0.7,   # 70% token 时触发压缩
        reserve_ratio=0.15,  # 保留 15% token
    )
    
    agent = Agent(
        name="MemoryAssistant",
        system_prompt=(
            "You're an assistant with memory. "
            "Remember information from previous messages."
        ),
        model=OpenAIChatModel(
            model="gpt-4",
            api_key=os.environ.get("OPENAI_API_KEY", ""),
        ),
        state=state,
        context_config=context_config,
    )
    
    print("=== Memory Agent Demo ===")
    print(f"Session ID: {session_id}")
    
    print("\n--- Round 1 ---")
    print("Sending: 'My name is Alice and I live in Beijing'")
    
    result1 = await agent.reply(
        UserMsg("user", "My name is Alice and I live in Beijing")
    )
    print(f"Response: {result1.content}")
    
    print("\n--- Round 2 ---")
    print("Sending: 'What is my name?'")
    
    result2 = await agent.reply(UserMsg("user", "What is my name?"))
    print(f"Response: {result2.content}")
    
    print("\n--- Round 3 ---")
    print("Sending: 'Where do I live?'")
    
    result3 = await agent.reply(UserMsg("user", "Where do I live?"))
    print(f"Response: {result3.content}")
    
    print(f"\n=== Context Length: {len(agent.state.context)} ===")
    print(f"=== Current Iteration: {agent.state.cur_iter} ===")


if __name__ == "__main__":
    asyncio.run(main())