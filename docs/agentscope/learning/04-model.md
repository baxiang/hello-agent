# 04 - Model 配置

## ChatModelBase 基类

所有模型实现继承自 `ChatModelBase`：

```python
class ChatModelBase:
    model: str           # 模型名称
    context_size: int    # 最大上下文长度
    
    async def chat(
        self,
        messages: list[Msg],
        tools: list[dict] | None = None,
    ) -> ChatResponse | AsyncGenerator:
        """调用模型"""
    
    async def count_tokens(
        self,
        messages: list[Msg],
    ) -> int:
        """计算 token 数"""
```

## 支持的模型

| 模型类 | 服务商 | 示例模型 |
|---|---|---|
| `DashScopeChatModel` | 阿里云 | qwen3.6-plus, qwen-max |
| `OpenAIChatModel` | OpenAI | gpt-4, gpt-3.5-turbo |
| `AnthropicChatModel` | Anthropic | claude-3-opus |
| `GeminiChatModel` | Google | gemini-1.5-pro |
| `OllamaChatModel` | 本地 | llama3, mistral |
| `DeepSeekChatModel` | DeepSeek | deepseek-chat |
| `MoonshotChatModel` | Kimi | moonshot-v1 |
| `XAIChatModel` | xAI | grok-beta |

## DashScope 配置

### 基本用法

```python
from agentscope.model import DashScopeChatModel
from agentscope.credential import DashScopeCredential
import os

model = DashScopeChatModel(
    credential=DashScopeCredential(
        api_key=os.environ["DASHSCOPE_API_KEY"]
    ),
    model="qwen3.6-plus",
)
```

### 模型列表

| 模型 | 说明 |
|---|---|
| `qwen3.6-plus` | 推理增强版 |
| `qwen-max` | 最强版本 |
| `qwen-turbo` | 快速版本 |

## OpenAI 配置

### 基本用法

```python
from agentscope.model import OpenAIChatModel
import os

model = OpenAIChatModel(
    model="gpt-4",
    api_key=os.environ["OPENAI_API_KEY"],
)
```

### 自定义 Base URL

```python
model = OpenAIChatModel(
    model="gpt-4",
    api_key=os.environ["OPENAI_API_KEY"],
    base_url="https://api.openai.com/v1",
)
```

## Ollama 本地模型

### 启动 Ollama

```bash
ollama serve
ollama pull llama3
```

### 配置

```python
from agentscope.model import OllamaChatModel

model = OllamaChatModel(
    model="llama3",
    base_url="http://localhost:11434",
)
```

## Credential 管理

### Credential 类型

| Credential | 服务商 |
|---|---|---|
| `DashScopeCredential` | 阿里云 |
| `OpenAICredential` | OpenAI |
| `AnthropicCredential` | Anthropic |
| `GeminiCredential` | Google |
| `OllamaCredential` | Ollama（无密钥） |

### 安全存储

```python
from agentscope.credential import DashScopeCredential

credential = DashScopeCredential(
    api_key=os.environ["DASHSCOPE_API_KEY"],
)

model = DashScopeChatModel(
    credential=credential,
    model="qwen-max",
)
```

## 流式调用

### Stream Response

```python
async def chat_stream(
    self,
    messages: list[Msg],
) -> AsyncGenerator[ChatResponse, None]:
    """流式返回响应"""
```

### 处理流式输出

```python
async for chunk in model.chat_stream(messages):
    if chunk.is_last:
        # 最后一个 chunk，完整响应
        print(chunk.content)
    else:
        # 中间 chunk
        for block in chunk.content:
            if isinstance(block, TextBlock):
                print(block.text, end="")
```

## ChatResponse 结构

```python
class ChatResponse:
    content: list[ContentBlock]  # 内容块列表
    usage: ChatUsage             # Token 使用统计
    is_last: bool                # 是否最后 chunk
    
class ChatUsage:
    input_tokens: int
    output_tokens: int
```

## Structured Output

### 生成结构化输出

```python
schema = {
    "type": "object",
    "properties": {
        "name": {"type": "string"},
        "age": {"type": "integer"},
    },
    "required": ["name", "age"],
}

result = await model.generate_structured_output(
    messages=messages,
    structured_model=schema,
)

print(result.content)  # {"name": "Alice", "age": 30}
```

## Model Fallback

### 配置备用模型

```python
from agentscope.agent import Agent, ModelConfig

model_config = ModelConfig(
    fallback_models=["gpt-3.5-turbo", "qwen-turbo"],
    max_retries=3,
)

agent = Agent(
    model=OpenAIChatModel(model="gpt-4"),
    model_config=model_config,
)
```

## 完整示例

```python
import asyncio
from agentscope.agent import Agent
from agentscope.model import DashScopeChatModel
from agentscope.credential import DashScopeCredential
from agentscope.message import UserMsg
import os

async def main():
    model = DashScopeChatModel(
        credential=DashScopeCredential(
            api_key=os.environ["DASHSCOPE_API_KEY"]
        ),
        model="qwen3.6-plus",
    )
    
    agent = Agent(
        name="Assistant",
        system_prompt="You're a helpful assistant.",
        model=model,
    )
    
    result = await agent.reply(UserMsg("user", "Hello!"))
    print(result.content)

asyncio.run(main())
```

## 下一步

- [05-message.md](05-message.md) — Message & Event
- [06-memory.md](06-memory.md) — Memory 系统