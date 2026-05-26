import asyncio
import os

from agentscope.agent import Agent
from agentscope.model import DashScopeChatModel, OpenAIChatModel
from agentscope.credential import DashScopeCredential
from agentscope.message import UserMsg


async def main() -> None:
    """最简 Agent 示例
    
    步骤：
    1. 创建 Model 实例（DashScope 或 OpenAI）
    2. 创建 Agent 实例
    3. 发送消息并获取回复
    """
    
    # 方式 1：使用 DashScope（阿里云）
    model = DashScopeChatModel(
        credential=DashScopeCredential(
            api_key=os.environ.get("DASHSCOPE_API_KEY", "")
        ),
        model="qwen3.6-plus",
    )
    
    # 方式 2：使用 OpenAI（取消注释使用）
    # model = OpenAIChatModel(
    #     model="gpt-4",
    #     api_key=os.environ.get("OPENAI_API_KEY", ""),
    # )
    
    agent = Agent(
        name="Friday",
        system_prompt="You're a helpful assistant named Friday. Always be concise.",
        model=model,
    )
    
    print("=== Hello Agent Demo ===")
    print("Sending: 'Hello, Friday!'")
    
    result = await agent.reply(UserMsg("Tony", "Hello, Friday!"))
    
    print(f"Response: {result.content}")
    
    print("\n=== Second Round ===")
    print("Sending: 'What is your name?'")
    
    result2 = await agent.reply(UserMsg("Tony", "What is your name?"))
    
    print(f"Response: {result2.content}")


if __name__ == "__main__":
    asyncio.run(main())