# 06 - Memory 系统

## AgentState

AgentState 管理 Agent 的上下文和记忆：

```python
class AgentState:
    session_id: str         # 会话 ID
    reply_id: str           # 当前回复 ID
    context: list[Msg]      # 上下文消息列表
    summary: str            # 压缩摘要
    cur_iter: int           # 当前 ReAct 迭代次数
    permission_context      # 权限上下文
    tool_context            # 工具上下文
```

## Context 管理

### 上下文添加

```python
# Agent 自动管理上下文
async def observe(self, msgs: Msg | list[Msg]) -> None:
    """接收外部消息并保存到上下文"""
```

### 上下文结构

```
AgentState.context:
[
    SystemMsg("system", "You're a helpful assistant..."),
    UserMsg("user", "Hello!"),
    AssistantMsg("assistant", "Hi! How can I help?"),
    UserMsg("user", "What's the weather?"),
    AssistantMsg("assistant", [ToolCallBlock(...)]),
    AssistantMsg("assistant", [ToolResultBlock(...), TextBlock(...)]),
    ...
]
```

## Context Compression

### 自动压缩

```python
await agent.compress_context()
```

### ContextConfig

```python
class ContextConfig:
    trigger_ratio: float = 0.8   # 触发压缩阈值比例
    reserve_ratio: float = 0.1   # 保留比例
    compression_prompt: str      # 压缩提示词
    summary_schema: dict         # 摘要 JSON Schema
    summary_template: str        # 摘要模板
```

### 压缩流程

```
1. 检查 token 数是否超过阈值
   threshold = trigger_ratio * model.context_size

2. 分割上下文：
   - msgs_to_compress: 待压缩消息
   - msgs_to_reserve: 保留消息

3. 调用模型生成结构化摘要：
   summary = await model.generate_structured_output(
       messages=[system, summary_prev, msgs_to_compress, compression_prompt],
       structured_model=summary_schema,
   )

4. 更新状态：
   - state.summary = summary_template.format(summary)
   - state.context = msgs_to_reserve
```

## Workspace & Offloader

### Workspace 概念

Workspace 管理长期记忆和外部存储：

```python
class Workspace:
    session_id: str
    path: str              # 存储路径
    
    async def save_context(self, msgs: list[Msg]) -> str:
        """保存上下文到外部存储"""
    
    async def load_context(self, path: str) -> list[Msg]:
        """从外部存储加载上下文"""
```

### Offloader

Offloader 将压缩内容卸载到外部存储：

```python
class Offloader:
    async def offload_context(
        self,
        session_id: str,
        msgs: list[Msg],
    ) -> str:
        """卸载上下文，返回存储路径"""
```

### 配置 Offloader

```python
from agentscope.workspace import Offloader

offloader = Offloader(
    storage_type="minio",  # 或 "local"
    path="/workspace/memory",
)

agent = Agent(
    model=model,
    offloader=offloader,
)
```

## 多轮对话

### 基本流程

```python
import asyncio
from agentscope.agent import Agent
from agentscope.message import UserMsg

async def main():
    agent = Agent(
        name="Assistant",
        model=model,
    )
    
    # 第一轮
    result1 = await agent.reply(UserMsg("user", "My name is Alice"))
    print(result1.content)
    
    # 第二轮（Agent 记住上一轮）
    result2 = await agent.reply(UserMsg("user", "What's my name?"))
    print(result2.content)  # "Your name is Alice"
    
    # 第三轮
    result3 = await agent.reply(UserMsg("user", "Tell me more about myself"))
    print(result3.content)

asyncio.run(main())
```

## Session 管理

### 创建新 Session

```python
from agentscope.state import AgentState

state = AgentState(
    session_id="user_123_session_456",
)

agent = Agent(
    name="Assistant",
    model=model,
    state=state,
)
```

### 恢复 Session

```python
# 保存状态
state_dict = agent.state.to_dict()

# 恢复状态
restored_state = AgentState.from_dict(state_dict)
agent = Agent(
    name="Assistant",
    model=model,
    state=restored_state,
)
```

## Memory 后端

### MinIO 存储

```python
from agentscope.workspace import MinIOOffloader

offloader = MinIOOffloader(
    endpoint="localhost:9000",
    access_key="minioadmin",
    secret_key="minioadmin",
    bucket="agent-memory",
)

agent = Agent(
    model=model,
    offloader=offloader,
)
```

### 本地文件存储

```python
from agentscope.workspace import LocalOffloader

offloader = LocalOffloader(
    path="/workspace/memory",
)
```

## 完整示例

```python
import asyncio
from agentscope.agent import Agent, ContextConfig
from agentscope.model import OpenAIChatModel
from agentscope.message import UserMsg
from agentscope.state import AgentState
import os

async def main():
    state = AgentState(session_id="demo_session")
    
    context_config = ContextConfig(
        trigger_ratio=0.7,  # 70% 时触发压缩
        reserve_ratio=0.15, # 保留 15%
    )
    
    agent = Agent(
        name="LongTermAssistant",
        model=OpenAIChatModel(
            model="gpt-4",
            api_key=os.environ["OPENAI_API_KEY"],
        ),
        state=state,
        context_config=context_config,
    )
    
    # 多轮对话
    for i in range(10):
        result = await agent.reply(
            UserMsg("user", f"Round {i}: Tell me a story about topic {i}")
        )
        print(f"Round {i}: {result.content[:50]}...")
        
        # 检查是否需要压缩
        await agent.compress_context()

asyncio.run(main())
```

## 下一步

- [07-mcp-a2a.md](07-mcp-a2a.md) — MCP/A2A 集成
- [08-service.md](08-service.md) — Agent Service