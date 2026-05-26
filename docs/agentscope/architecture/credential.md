# Credential 模块分析

## 源码位置

`src/agentscope/credential/` (14 文件)

## Credential 类图

```
┌─────────────────────────────────────────────────────────────┐
│                    CredentialBase                            │
├─────────────────────────────────────────────────────────────┤
│  api_key: str | None                                         │
├─────────────────────────────────────────────────────────────┤
│  to_dict() → dict                                            │
└─────────────────────────────────────────────────────────────┘
          │
          │ extends
          ▼
┌─────────────────┐ ┌─────────────────┐ ┌─────────────────┐
│DashScopeCred    │ │  OpenAICred     │ │ AnthropicCred   │
│  api_key        │ │   api_key       │ │    api_key      │
│                 │ │   base_url      │ │                 │
└─────────────────┘ └─────────────────┘ └─────────────────┘
          │
          │ extends
          ▼
┌─────────────────┐ ┌─────────────────┐ ┌─────────────────┐
│  GeminiCred     │ │  OllamaCred     │ │  DeepSeekCred   │
│  api_key        │ │ (无 api_key)    │ │    api_key      │
│  project_id     │ │                 │ │                 │
└─────────────────┘ └─────────────────┘ └─────────────────┘
```

## Credential 类型

| Credential | 服务商 | 特殊参数 |
|---|---|---|
| `DashScopeCredential` | 阿里云 | `api_key` |
| `OpenAICredential` | OpenAI | `api_key`, `base_url` |
| `AnthropicCredential` | Anthropic | `api_key` |
| `GeminiCredential` | Google | `api_key`, `project_id` |
| `OllamaCredential` | Ollama | 无（本地） |
| `DeepSeekCredential` | DeepSeek | `api_key` |
| `MoonshotCredential` | Kimi | `api_key` |
| `XAICredential` | xAI | `api_key` |

## Credential Factory

```python
class CredentialFactory:
    @staticmethod
    def create(provider: str, **kwargs) -> CredentialBase:
        """根据 provider 创建 Credential"""
        
        match provider:
            case "dashscope":
                return DashScopeCredential(api_key=kwargs["api_key"])
            case "openai":
                return OpenAICredential(
                    api_key=kwargs["api_key"],
                    base_url=kwargs.get("base_url"),
                )
            case "anthropic":
                return AnthropicCredential(api_key=kwargs["api_key"])
            case "ollama":
                return OllamaCredential()
            ...
```

## Model 关联

### DashScopeChatModel

```python
class DashScopeChatModel(ChatModelBase):
    credential: DashScopeCredential
    model: str
    
    def __init__(
        self,
        credential: DashScopeCredential,
        model: str,
    ):
        self.credential = credential
        self.model = model
```

### OpenAIChatModel

```python
class OpenAIChatModel(ChatModelBase):
    api_key: str
    base_url: str | None
    model: str
    
    def __init__(
        self,
        model: str,
        api_key: str | None = None,
        base_url: str | None = None,
    ):
        # 可直接传 api_key 或使用 Credential
        self.api_key = api_key or os.environ.get("OPENAI_API_KEY")
        self.base_url = base_url
```

## 安全存储

### 环境变量

```python
import os

credential = DashScopeCredential(
    api_key=os.environ["DASHSCOPE_API_KEY"],
)
```

### 配置文件

```python
# config.yaml
credentials:
  dashscope:
    api_key: ${DASHSCOPE_API_KEY}
  openai:
    api_key: ${OPENAI_API_KEY}

# 加载
from yaml import safe_load

config = safe_load(open("config.yaml"))
dashscope_cred = DashScopeCredential(
    api_key=os.environ.get(config["credentials"]["dashscope"]["api_key"]),
)
```

## Credential 注入

### Model 内部使用

```python
async def _chat(self, messages, tools):
    headers = {
        "Authorization": f"Bearer {self.credential.api_key}",
        "Content-Type": "application/json",
    }
    
    response = await aiohttp.post(
        self.base_url,
        headers=headers,
        json={"messages": messages, "tools": tools},
    )
    
    return response
```

## 设计模式

| 模式 | 应用 |
|---|---|
| **策略模式** | 不同 Credential 实现 |
| **工厂模式** | CredentialFactory |
| **值对象** | Credential 不可变 |