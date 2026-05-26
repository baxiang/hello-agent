import asyncio
import os

from agentscope.agent import Agent
from agentscope.model import OpenAIChatModel
from agentscope.message import UserMsg
from agentscope.event import EventType


async def main() -> None:
    """流式响应示例
    
    步骤：
    1. 创建 Agent
    2. 使用 reply_stream() 获取事件流
    3. 处理不同 EventType
    """
    
    agent = Agent(
        name="Assistant",
        system_prompt="You're a helpful assistant. Provide detailed explanations.",
        model=OpenAIChatModel(
            model="gpt-4",
            api_key=os.environ.get("OPENAI_API_KEY", ""),
        ),
    )
    
    print("=== Stream Agent Demo ===")
    print("Sending: 'Explain how async/await works in Python'")
    print("\n--- Stream Output ---\n")
    
    async for evt in agent.reply_stream(
        UserMsg("user", "Explain how async/await works in Python")
    ):
        match evt.type:
            case EventType.REPLY_START:
                print("[Reply Start]")
            
            case EventType.MODEL_CALL_START:
                print(f"[Model: {evt.model_name}]")
            
            case EventType.TEXT_BLOCK_START:
                print("[Text Start]")
            
            case EventType.TEXT_BLOCK_DELTA:
                print(evt.text, end="", flush=True)
            
            case EventType.TEXT_BLOCK_END:
                print("\n[Text End]")
            
            case EventType.MODEL_CALL_END:
                print(f"\n[Tokens: {evt.input_tokens} + {evt.output_tokens}]")
            
            case EventType.REPLY_END:
                print("[Reply End]")
            
            case _:
                pass
    
    print("\n=== Demo Complete ===")


if __name__ == "__main__":
    asyncio.run(main())