import asyncio
import os

from agentscope.agent import Agent
from agentscope.model import OpenAIChatModel
from agentscope.tool import Toolkit, Bash
from agentscope.message import UserMsg


async def main() -> None:
    """多 Agent 协作示例
    
    步骤：
    1. 创建多个不同角色的 Agent
    2. Agent A 分析任务并分配
    3. Agent B 执行具体工作
    4. Agent A 整合结果
    """
    
    toolkit = Toolkit(
        tools=[Bash()],
    )
    
    coordinator = Agent(
        name="Coordinator",
        system_prompt=(
            "You're a coordinator. "
            "Analyze tasks and decide which should be delegated to Worker. "
            "For simple questions, answer directly. "
            "For technical tasks, respond with 'DELEGATE: <task description>'"
        ),
        model=OpenAIChatModel(
            model="gpt-4",
            api_key=os.environ.get("OPENAI_API_KEY", ""),
        ),
    )
    
    worker = Agent(
        name="Worker",
        system_prompt=(
            "You're a technical worker. "
            "Execute coding tasks using tools. "
            "Return clear results."
        ),
        model=OpenAIChatModel(
            model="gpt-4",
            api_key=os.environ.get("OPENAI_API_KEY", ""),
        ),
        toolkit=toolkit,
    )
    
    print("=== Multi-Agent Demo ===")
    
    print("\n--- Coordinator Analysis ---")
    print("Sending: 'I need to create a hello.py file'")
    
    coordinator_result = await coordinator.reply(
        UserMsg("user", "I need to create a hello.py file with a print statement")
    )
    
    print(f"Coordinator: {coordinator_result.content}")
    
    if "DELEGATE:" in str(coordinator_result.content):
        task = str(coordinator_result.content).split("DELEGATE:")[1].strip()
        
        print(f"\n--- Delegating to Worker ---")
        print(f"Task: {task}")
        
        worker_result = await worker.reply(UserMsg("coordinator", task))
        
        print(f"Worker Result: {worker_result.content}")
        
        print("\n--- Coordinator Summary ---")
        summary_result = await coordinator.reply(
            UserMsg("user", f"Worker completed: {worker_result.content}")
        )
        
        print(f"Summary: {summary_result.content}")
    else:
        print("No delegation needed")


if __name__ == "__main__":
    asyncio.run(main())