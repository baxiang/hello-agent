# 10 - 前置知识清单

## Python 3.11+ 特性

### match-case 语句

```python
# AgentScope 事件处理
match evt.type:
    case EventType.TEXT_BLOCK_DELTA:
        print(evt.text)
    case EventType.TOOL_CALL_START:
        print(f"Tool: {evt.tool_name}")
    case EventType.REPLY_END:
        print("Done")
```

### 类型注解改进

```python
# Union 类型简化
def func(x: int | str) -> None:  # 以前: int | str

# Optional 简化
def func(x: int | None) -> None:  # 以前: Optional[int]

# AsyncGenerator 类型
async def stream() -> AsyncGenerator[AgentEvent, None]:
    ...
```

## asyncio 异步编程

### async/await

```python
import asyncio

async def main():
    agent = Agent(...)
    result = await agent.reply(UserMsg("Hello"))
    print(result.content)

asyncio.run(main())
```

### AsyncGenerator

```python
async def reply_stream(self) -> AsyncGenerator[AgentEvent, None]:
    async for evt in self._reply():
        yield evt

# 使用
async for evt in agent.reply_stream(msg):
    print(evt)
```

### 并发执行

```python
# 并发工具调用
results = await asyncio.gather(
    tool_call_a(),
    tool_call_b(),
    return_exceptions=True,
)
```

### Queue

```python
from asyncio import Queue

queue = Queue()

async def producer():
    await queue.put(item)

async def consumer():
    item = await queue.get()
```

## FastAPI 框架

### 基本用法

```python
from fastapi import FastAPI

app = FastAPI()

@app.get("/")
async def root():
    return {"message": "Hello"}

@app.post("/chat")
async def chat(message: str):
    return {"response": "..."}
```

### 依赖注入

```python
from fastapi import Depends

async def get_agent(name: str) -> Agent:
    return agents[name]

@app.post("/agents/{name}/chat")
async def chat(
    name: str,
    message: str,
    agent: Agent = Depends(get_agent),
):
    result = await agent.reply(UserMsg("user", message))
    return {"response": result.content}
```

### SSE 响应

```python
from fastapi.responses import StreamingResponse

@app.post("/stream")
async def stream(message: str):
    async def event_stream():
        async for evt in agent.reply_stream(msg):
            yield f"data: {evt.to_json()}\n\n"
    
    return StreamingResponse(
        event_stream(),
        media_type="text/event-stream",
    )
```

## Pydantic 数据验证

### BaseModel

```python
from pydantic import BaseModel

class ChatRequest(BaseModel):
    message: str
    session_id: str | None = None
    
class ChatResponse(BaseModel):
    response: str
    tokens: int
```

### JSON Schema

```python
# 自动生成 JSON Schema
schema = ChatRequest.model_json_schema()
# {
#   "type": "object",
#   "properties": {
#     "message": {"type": "string"},
#     "session_id": {"type": ["string", "null"]}
#   },
#   "required": ["message"]
# }
```

### 动态模型

```python
from pydantic import create_model

DynamicModel = create_model(
    "DynamicModel",
    field1=(str, None),
    field2=(int, 0),
)
```

## MCP 协议基础

### Server 实现

```python
from mcp.server import Server

server = Server("my-mcp")

@server.list_tools()
async def list_tools():
    return [Tool(name="my_tool", ...)]

@server.call_tool()
async def call_tool(name: str, arguments: dict):
    return "Result"
```

### Client 实现

```python
from mcp import Client

client = Client()
await client.connect("stdio", command="my-server")

tools = await client.list_tools()
result = await client.call_tool("my_tool", {"arg": "value"})
```

## Jinja2 模板

### 基本用法

```python
from jinja2 import Template

template = Template("""
{% for skill in skills %}
<skill>
<name>{{ skill.name }}</name>
<description>{{ skill.description }}</description>
</skill>
{% endfor %}
""")

output = template.render(skills=[...])
```

## JSON Schema

### 验证

```python
import jsonschema

schema = {
    "type": "object",
    "properties": {
        "query": {"type": "string"}
    },
    "required": ["query"]
}

jsonschema.validate({"query": "test"}, schema)
```

## 其他工具

### inspect 模块

```python
import inspect

# 检查是否为异步函数
if inspect.iscoroutinefunction(func):
    await func()
else:
    func()

# 检查是否为异步生成器
if inspect.isasyncgen(func):
    async for item in func():
        ...
```

### uuid 模块

```python
import uuid

# 生成唯一 ID
session_id = uuid.uuid4().hex
```

### deepcopy

```python
from copy import deepcopy

# 深拷贝消息
copied_msg = deepcopy(msg)
```

## 学习路径总结

完成本章后，你应该掌握：
- Python 3.11+ 新特性
- asyncio 异步编程
- FastAPI Web 框架
- Pydantic 数据验证
- MCP 协议基础

这些知识将帮助你理解 AgentScope 的核心实现。