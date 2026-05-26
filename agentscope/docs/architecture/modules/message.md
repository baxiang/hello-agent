# Message & Event 模块分析

## 源码位置

- `src/agentscope/message/` (5 文件)
- `src/agentscope/event/` (4 文件)

## Message 类图

```
┌─────────────────────────────────────────────────────────────┐
│                          Msg                                 │
├─────────────────────────────────────────────────────────────┤
│  id: str                                                     │
│  name: str                                                   │
│  role: str                                                   │
│  content: list[ContentBlock]                                 │
│  usage: Usage | None                                         │
├─────────────────────────────────────────────────────────────┤
│  get_content_blocks(types) → list[ContentBlock]              │
│  has_content_blocks(types) → bool                            │
│  to_dict() → dict                                            │
└─────────────────────────────────────────────────────────────┘
          │
          │ extends
          ▼
┌─────────────────┐ ┌─────────────────┐ ┌─────────────────┐
│    UserMsg      │ │  AssistantMsg   │ │    SystemMsg    │
│  role="user"    │ │role="assistant" │ │  role="system"  │
└─────────────────┘ └─────────────────┘ └─────────────────┘
```

## ContentBlock 类型

```python
class ContentBlockTypes:
    TEXT = "text"
    THINKING = "thinking"
    HINT = "hint"
    TOOL_CALL = "tool_call"
    TOOL_RESULT = "tool_result"
    DATA = "data"
```

### TextBlock

```python
class TextBlock(ContentBlock):
    type = "text"
    text: str
```

### ThinkingBlock

```python
class ThinkingBlock(ContentBlock):
    type = "thinking"
    text: str
```

### ToolCallBlock

```python
class ToolCallBlock(ContentBlock):
    type = "tool_call"
    id: str
    name: str
    input: str
    state: ToolCallState
    suggested_rules: list[PermissionRule]
```

### ToolCallState

```python
class ToolCallState:
    PENDING = "pending"      # 待处理
    ASKING = "asking"        # 等待用户确认
    ALLOWED = "allowed"      # 已允许
    SUBMITTED = "submitted"  # 已提交外部执行
    FINISHED = "finished"    # 已完成
```

### ToolResultBlock

```python
class ToolResultBlock(ContentBlock):
    type = "tool_result"
    id: str
    name: str
    output: list[ContentBlock]
    state: ToolResultState
```

### ToolResultState

```python
class ToolResultState:
    SUCCESS = "success"
    ERROR = "error"
    DENIED = "denied"
    INTERRUPTED = "interrupted"
```

## Event 类图

```
┌─────────────────────────────────────────────────────────────┐
│                       EventBase                              │
├─────────────────────────────────────────────────────────────┤
│  type: EventType                                             │
│  reply_id: str                                               │
├─────────────────────────────────────────────────────────────┤
│  to_json() → str                                             │
└─────────────────────────────────────────────────────────────┘
          │
          │ extends
          ▼
┌─────────────────┐ ┌─────────────────┐ ┌─────────────────┐
│ ReplyStartEvent │ │  ReplyEndEvent  │ │ModelCallStartEvt│
└─────────────────┘ └─────────────────┘ └─────────────────┘
          │
          ▼
┌─────────────────┐ ┌─────────────────┐ ┌─────────────────┐
│TextBlockStartEvt│ │TextBlockDeltaEvt│ │ TextBlockEndEvt │
│  block_id: str  │ │  text: str      │ │  block_id: str  │
└─────────────────┘ └─────────────────┘ └─────────────────┘
```

## EventType 枚举

```python
class EventType:
    # Reply 生命周期
    REPLY_START = "reply_start"
    REPLY_END = "reply_end"
    
    # Model 调用
    MODEL_CALL_START = "model_call_start"
    MODEL_CALL_END = "model_call_end"
    
    # Text Block
    TEXT_BLOCK_START = "text_block_start"
    TEXT_BLOCK_DELTA = "text_block_delta"
    TEXT_BLOCK_END = "text_block_end"
    
    # Thinking Block
    THINKING_BLOCK_START = "thinking_block_start"
    THINKING_BLOCK_DELTA = "thinking_block_delta"
    THINKING_BLOCK_END = "thinking_block_end"
    
    # Tool Call
    TOOL_CALL_START = "tool_call_start"
    TOOL_CALL_DELTA = "tool_call_delta"
    TOOL_CALL_END = "tool_call_end"
    
    # Tool Result
    TOOL_RESULT_START = "tool_result_start"
    TOOL_RESULT_TEXT_DELTA = "tool_result_text_delta"
    TOOL_RESULT_DATA_DELTA = "tool_result_data_delta"
    TOOL_RESULT_END = "tool_result_end"
    
    # Data Block
    DATA_BLOCK_START = "data_block_start"
    DATA_BLOCK_DELTA = "data_block_delta"
    DATA_BLOCK_END = "data_block_end"
    
    # 特殊事件
    EXCEED_MAX_ITERS = "exceed_max_iters"
    REQUIRE_USER_CONFIRM = "require_user_confirm"
    REQUIRE_EXTERNAL_EXECUTION = "require_external_execution"
```

## 事件流结构

```
ReplyStartEvent
    │
    ▼
ModelCallStartEvent
    │
    ├─► ThinkingBlockStartEvent
    │       ├─► ThinkingBlockDeltaEvent (N 次)
    │       └─► ThinkingBlockEndEvent
    │
    ├─► TextBlockStartEvent
    │       ├─► TextBlockDeltaEvent (N 次)
    │       └─► TextBlockEndEvent
    │
    ├─► ToolCallStartEvent
    │       ├─► ToolCallDeltaEvent
    │       └─► ToolCallEndEvent
    │
    ▼
ModelCallEndEvent (input_tokens, output_tokens)
    │
    ▼
ToolResultStartEvent
    │
    ├─► ToolResultTextDeltaEvent (N 次)
    │
    ▼
ToolResultEndEvent (state)
    │
    ▼
ReplyEndEvent
    │
    ▼
AssistantMsg (最终消息)
```

## 设计模式

| 模式 | 应用 |
|---|---|
| **观察者模式** | Event 流事件发射 |
| **状态模式** | ToolCallState 状态流转 |
| **组合模式** | Msg 组合 ContentBlock |