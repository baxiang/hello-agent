# 05 - Message & Event

## Message 类型

### 基本消息类

```python
class Msg:
    id: str               # 消息 ID
    name: str             # 发送者名称
    role: str             # 角色：user/assistant/system
    content: list[ContentBlock]  # 内容块
    usage: Usage          # Token 使用统计

class UserMsg(Msg):
    role = "user"

class AssistantMsg(Msg):
    role = "assistant"

class SystemMsg(Msg):
    role = "system"
```

### 创建消息

```python
from agentscope.message import UserMsg, AssistantMsg, SystemMsg

# 用户消息
user_msg = UserMsg(
    name="Tony",
    content="Hello, Friday!",
)

# 系统消息
system_msg = SystemMsg(
    name="system",
    content="You're a helpful assistant.",
)

# Agent 回复
assistant_msg = AssistantMsg(
    name="Friday",
    content="Hi! How can I help you?",
)
```

## ContentBlock 类型

### TextBlock

```python
class TextBlock(ContentBlock):
    type = "text"
    text: str  # 文本内容
```

### ThinkingBlock

```python
class ThinkingBlock(ContentBlock):
    type = "thinking"
    text: str  # 思考内容
```

### ToolCallBlock

```python
class ToolCallBlock(ContentBlock):
    type = "tool_call"
    id: str           # 工具调用 ID
    name: str         # 工具名称
    input: str        # 工具输入（JSON）
    state: ToolCallState  # 调用状态
```

### ToolResultBlock

```python
class ToolResultBlock(ContentBlock):
    type = "tool_result"
    id: str           # 对应 ToolCall ID
    name: str         # 工具名称
    output: list[ContentBlock]  # 输出内容
    state: ToolResultState  # 结果状态
```

### DataBlock

```python
class DataBlock(ContentBlock):
    type = "data"
    source: Base64Source | URLSource  # 数据源
    mime_type: str    # MIME 类型
```

## Event 系统

### EventType 枚举

```python
class EventType:
    REPLY_START          # 回复开始
    REPLY_END            # 回复结束
    MODEL_CALL_START     # 模型调用开始
    MODEL_CALL_END       # 模型调用结束
    TEXT_BLOCK_START     # 文本块开始
    TEXT_BLOCK_DELTA     # 文本增量
    TEXT_BLOCK_END       # 文本块结束
    THINKING_BLOCK_START # 思考块开始
    THINKING_BLOCK_DELTA # 思考增量
    THINKING_BLOCK_END   # 思考块结束
    TOOL_CALL_START      # 工具调用开始
    TOOL_CALL_DELTA      # 工具调用增量
    TOOL_CALL_END        # 工具调用结束
    TOOL_RESULT_START    # 工具结果开始
    TOOL_RESULT_DELTA    # 工具结果增量
    TOOL_RESULT_END      # 工具结果结束
    EXCEED_MAX_ITERS     # 超过最大迭代
    REQUIRE_USER_CONFIRM # 需要用户确认
```

### 事件类

```python
class ReplyStartEvent(AgentEvent):
    session_id: str
    reply_id: str
    name: str

class TextBlockDeltaEvent(AgentEvent):
    reply_id: str
    block_id: str
    text: str

class ToolCallStartEvent(AgentEvent):
    reply_id: str
    tool_call_id: str
    tool_name: str
```

## 流式事件处理

### reply_stream 示例

```python
import asyncio
from agentscope.agent import Agent
from agentscope.message import UserMsg
from agentscope.event import EventType

async def main():
    agent = Agent(
        name="Assistant",
        model=model,
    )
    
    async for evt in agent.reply_stream(UserMsg("user", "Hello!")):
        match evt.type:
            case EventType.REPLY_START:
                print("[Start]")
            
            case EventType.TEXT_BLOCK_START:
                print("[Text Start]")
            
            case EventType.TEXT_BLOCK_DELTA:
                print(evt.text, end="", flush=True)
            
            case EventType.TEXT_BLOCK_END:
                print("\n[Text End]")
            
            case EventType.MODEL_CALL_END:
                print(f"Tokens: {evt.input_tokens} + {evt.output_tokens}")
            
            case EventType.REPLY_END:
                print("[Done]")

asyncio.run(main())
```

### 处理工具调用事件

```python
async for evt in agent.reply_stream(UserMsg("user", "List files")):
    match evt.type:
        case EventType.TOOL_CALL_START:
            print(f"\n[Tool: {evt.tool_name}]")
        
        case EventType.TOOL_RESULT_START:
            print(f"[Result Start]")
        
        case EventType.TOOL_RESULT_TEXT_DELTA:
            print(evt.text)
        
        case EventType.TOOL_RESULT_END:
            print(f"[Result End] state={evt.state}")
```

## 事件流结构

```
reply_stream 输出顺序：

ReplyStartEvent
  │
  ├─► ModelCallStartEvent
  │     │
  │     ├─► ThinkingBlockStartEvent
  │     │     ├─► ThinkingBlockDeltaEvent (多次)
  │     │     └─► ThinkingBlockEndEvent
  │     │
  │     ├─► TextBlockStartEvent
  │     │     ├─► TextBlockDeltaEvent (多次)
  │     │     └─► TextBlockEndEvent
  │     │
  │     ├─► ToolCallStartEvent
  │     │     ├─► ToolCallDeltaEvent
  │     │     └─► ToolCallEndEvent
  │     │
  │     └─► ModelCallEndEvent
  │
  ├─► ToolResultStartEvent
  │     ├─► ToolResultTextDeltaEvent (多次)
  │     └─► ToolResultEndEvent
  │
  └─► ReplyEndEvent
        └─► AssistantMsg (最终消息)
```

## 用户确认

### RequireUserConfirmEvent

```python
class RequireUserConfirmEvent(AgentEvent):
    reply_id: str
    tool_calls: list[ToolCallBlock]
```

### 处理确认

```python
from agentscope.event import UserConfirmResultEvent, ConfirmResult

# 用户确认结果
confirm_result = UserConfirmResultEvent(
    reply_id=evt.reply_id,
    confirm_results=[
        ConfirmResult(
            tool_call=tool_call,
            confirmed=True,  # 或 False
        )
    ]
)

# 继续回复
async for evt in agent.reply_stream(confirm_result):
    # ...
```

## 下一步

- [06-memory.md](06-memory.md) — Memory 系统
- [08-service.md](08-service.md) — Agent Service