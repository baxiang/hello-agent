# Model 模块分析

## 源码位置

`src/agentscope/model/` (16 文件)

## 类图

```
┌─────────────────────────────────────────────────────────────┐
│                     ChatModelBase                            │
├─────────────────────────────────────────────────────────────┤
│  model: str                                                  │
│  context_size: int                                           │
├─────────────────────────────────────────────────────────────┤
│  chat(messages, tools) → ChatResponse | AsyncGenerator       │
│  chat_stream(messages, tools) → AsyncGenerator               │
│  count_tokens(messages) → int                                │
│  generate_structured_output(messages, schema) → StructuredResponse │
└─────────────────────────────────────────────────────────────┘
          │
          │ extends
          ▼
┌─────────────────────────────────────────────────────────────┐
│                  DashScopeChatModel                          │
├─────────────────────────────────────────────────────────────┤
│  credential: DashScopeCredential                             │
│  base_url: str                                               │
├─────────────────────────────────────────────────────────────┤
│  _chat(...) → 内部调用                                        │
└─────────────────────────────────────────────────────────────┘
          │
          │ extends
          ▼
┌─────────────────────────────────────────────────────────────┐
│                   OpenAIChatModel                            │
├─────────────────────────────────────────────────────────────┤
│  api_key: str                                                │
│  base_url: str                                               │
├─────────────────────────────────────────────────────────────┤
│  _chat(...) → 内部调用                                        │
└─────────────────────────────────────────────────────────────┘
```

## Model 实现列表

| 类 | 服务商 | 特殊参数 |
|---|---|---|
| `DashScopeChatModel` | 阿里云 | `credential: DashScopeCredential` |
| `OpenAIChatModel` | OpenAI | `api_key`, `base_url` |
| `AnthropicChatModel` | Anthropic | `credential: AnthropicCredential` |
| `GeminiChatModel` | Google | `credential: GeminiCredential` |
| `OllamaChatModel` | 本地 | `base_url` |
| `DeepSeekChatModel` | DeepSeek | `api_key` |
| `MoonshotChatModel` | Kimi | `api_key` |
| `XAIChatModel` | xAI | `api_key` |

## ChatResponse 结构

```python
class ChatResponse:
    content: list[ContentBlock]
    usage: ChatUsage | None
    is_last: bool
    
class ChatUsage:
    input_tokens: int
    output_tokens: int
```

## Formatter 系统

### Formatter 基类

```python
class FormatterBase:
    def format_messages(self, messages: list[Msg]) -> list[dict]:
        """转换为 API 格式"""
    
    def format_tools(self, tools: list[dict]) -> list[dict]:
        """转换为工具格式"""
    
    def parse_response(self, response: dict) -> ChatResponse:
        """解析 API 响应"""
```

### Formatter 类型

| Formatter | API 格式 |
|---|---|
| `OpenAIFormatter` | OpenAI messages format |
| `DashScopeFormatter` | DashScope messages format |
| `AnthropicFormatter` | Anthropic messages format |
| `GeminiFormatter` | Gemini messages format |
| `OllamaFormatter` | Ollama messages format |

## 流式响应处理

### chat_stream()

```python
async def chat_stream(
    self,
    messages: list[Msg],
    tools: list[dict] | None = None,
) -> AsyncGenerator[ChatResponse, None]:
    """流式返回响应"""
    
    # 调用 API
    stream = await self._api_call_stream(messages, tools)
    
    # 解析流
    async for chunk in stream:
        response = self.formatter.parse_stream_chunk(chunk)
        yield response
```

### 流式 chunk 处理

```python
async for chunk in model.chat_stream(messages):
    if chunk.is_last:
        # 最后 chunk，完整响应
        final_response = chunk
    else:
        # 中间 chunk
        for block in chunk.content:
            if isinstance(block, TextBlock):
                print(block.text, end="")
```

## Structured Output

### generate_structured_output()

```python
async def generate_structured_output(
    self,
    messages: list[Msg],
    structured_model: dict,
) -> StructuredResponse:
    """生成结构化输出"""
    
    # 添加 tool schema
    tool_schema = [{
        "type": "function",
        "function": {
            "name": "generate_structured_output",
            "parameters": structured_model,
        }
    }]
    
    # 调用模型
    response = await self.chat(messages, tools=tool_schema)
    
    # 解析结果
    return StructuredResponse(
        content=json.loads(response.tool_call.input),
        usage=response.usage,
    )
```

## Token 计算

### count_tokens()

```python
async def count_tokens(
    self,
    messages: list[Msg],
    tools: list[dict] | None = None,
) -> int:
    """计算 token 数"""
    
    # 使用模型 API 或估算
    formatted = self.formatter.format_messages(messages)
    return await self._api_count_tokens(formatted, tools)
```

## 设计模式

| 模式 | 应用 |
|---|---|
| **策略模式** | 不同 Model 实现 |
| **模板方法** | chat/chat_stream 固定流程 |
| **适配器模式** | Formatter 转换不同 API 格式 |