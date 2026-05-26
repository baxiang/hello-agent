import asyncio
import os

from agentscope.agent import Agent
from agentscope.model import OpenAIChatModel
from agentscope.tool import Toolkit, Bash, Read, Glob
from agentscope.message import UserMsg


async def main() -> None:
    """工具调用示例
    
    步骤：
    1. 创建 Toolkit 实例并注册工具
    2. 创建带 Toolkit 的 Agent
    3. 发送需要工具调用的消息
    """
    
    toolkit = Toolkit(
        tools=[
            Bash(),      # 执行 shell 命令
            Read(),      # 读取文件
            Glob(),      # 搜索文件
        ]
    )
    
    agent = Agent(
        name="Developer",
        system_prompt=(
            "You're a developer assistant. "
            "Use tools to help with coding tasks. "
            "Always be concise."
        ),
        model=OpenAIChatModel(
            model="gpt-4",
            api_key=os.environ.get("OPENAI_API_KEY", ""),
        ),
        toolkit=toolkit,
    )
    
    print("=== Tool Agent Demo ===")
    print("Sending: 'List Python files in current directory'")
    
    result = await agent.reply(
        UserMsg("user", "List Python files in current directory")
    )
    
    print(f"Response: {result.content}")
    
    print("\n=== Second Task ===")
    print("Sending: 'Read the main.py file'")
    
    result2 = await agent.reply(
        UserMsg("user", "Read the main.py file")
    )
    
    print(f"Response: {result2.content}")


if __name__ == "__main__":
    asyncio.run(main())