import asyncio
import os

from agentscope.agent import Agent
from agentscope.model import OpenAIChatModel
from agentscope.tool import Toolkit
from agentscope.mcp import MCPClient
from agentscope.message import UserMsg


async def main() -> None:
    """MCP 集成示例
    
    步骤：
    1. 创建 MCPClient（配置 MCP Server）
    2. 注册到 Toolkit
    3. MCP 工具自动发现和调用
    
    注意：需要先安装 MCP Server
    pip install mcp-server-filesystem
    """
    
    filesystem_mcp = MCPClient(
        name="filesystem",
        config={
            "command": "mcp-server-filesystem",
            "args": ["--root", "."],
        }
    )
    
    toolkit = Toolkit(
        mcps=[filesystem_mcp],
    )
    
    agent = Agent(
        name="FileManager",
        system_prompt=(
            "You're a file management assistant. "
            "Use MCP tools to manage files."
        ),
        model=OpenAIChatModel(
            model="gpt-4",
            api_key=os.environ.get("OPENAI_API_KEY", ""),
        ),
        toolkit=toolkit,
    )
    
    print("=== MCP Agent Demo ===")
    print("Note: Requires mcp-server-filesystem installed")
    
    print("\nDiscovering MCP tools...")
    tools = await filesystem_mcp.list_tools()
    print(f"Found {len(tools)} MCP tools:")
    for tool in tools:
        print(f"  - {tool.name}: {tool.description[:50]}...")
    
    print("\n--- Task ---")
    print("Sending: 'List all Python files using MCP tools'")
    
    result = await agent.reply(
        UserMsg("user", "List all Python files in current directory")
    )
    
    print(f"Response: {result.content}")


if __name__ == "__main__":
    asyncio.run(main())