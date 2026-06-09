# 实践总结 — DeepSeek·Kimi·Qwen 对比与选型

> 本文汇总三大国产模型的实践经验，提供横向对比和选型决策框架。

## 1. 核心参数对比

| 参数 | DeepSeek V3 | DeepSeek V4 | Kimi | Qwen-Plus | Qwen-Max |
|------|:---:|:---:|:---:|:---:|:---:|
| **上下文窗口** | 128K | 128K | 128K | 32K | 32K |
| **输出上限** | 8K | 8K | 4K | 8K | 8K |
| **多模态** | ❌ | ❌ | ✅ 文件/图片 | ✅ VL模型 | ✅ VL模型 |
| **Function Calling** | ✅ | ✅ | ✅ | ✅ | ✅ |
| **JSON 模式** | ✅ | ✅ | ❌ | ✅ | ✅ |
| **流式输出** | ✅ | ✅ | ✅ | ✅ | ✅ |
| **思考模式** | ❌ | ✅ | ❌ | ❌ | ❌ |
| **联网搜索** | ❌ | ❌ | ✅ | ❌ | ❌ |
| **超长文档** | ❌ | ❌ | ❌ | ✅ Qwen-Long 1000万 | — |
| **内容审核** | 宽松 | 宽松 | 中等 | 严格 | 严格 |

## 2. API 端点速查

```bash
# DeepSeek
BASE_URL="https://api.deepseek.com/v1"
AUTH="Authorization: Bearer sk-xxx"

# Kimi (月之暗面)
BASE_URL="https://api.moonshot.cn/v1"
AUTH="Authorization: Bearer sk-xxx"

# Qwen (通义千问)
BASE_URL="https://dashscope.aliyuncs.com/compatible-mode/v1"
AUTH="Authorization: Bearer sk-xxx"
```

三种 API 均兼容 OpenAI Chat Completions 格式，可以使用同一个 SDK。

## 3. 多模型统一调用封装

```python
import os
from openai import OpenAI

class MultiModelClient:
    """统一的国内模型调用客户端"""

    PROVIDERS = {
        "deepseek": {
            "base_url": "https://api.deepseek.com/v1",
            "models": ["deepseek-chat", "deepseek-v4-flash", "deepseek-v4-pro"],
        },
        "kimi": {
            "base_url": "https://api.moonshot.cn/v1",
            "models": ["moonshot-v1-8k", "moonshot-v1-32k", "moonshot-v1-128k"],
        },
        "qwen": {
            "base_url": "https://dashscope.aliyuncs.com/compatible-mode/v1",
            "models": ["qwen-turbo", "qwen-plus", "qwen-max", "qwen-long"],
        },
    }

    def __init__(self):
        self.clients = {}
        for name, cfg in self.PROVIDERS.items():
            api_key = os.environ.get(f"{name.upper()}_API_KEY")
            if api_key:
                self.clients[name] = OpenAI(
                    api_key=api_key,
                    base_url=cfg["base_url"],
                )

    def chat(self, provider: str, model: str, messages: list, **kwargs):
        client = self.clients.get(provider)
        if not client:
            raise ValueError(f"Provider {provider} not configured")
        return client.chat.completions.create(
            model=model,
            messages=messages,
            **kwargs,
        )

    def compare(self, messages: list, temperature=0.7):
        """同一问题发给多个模型，对比结果"""
        results = {}
        for provider, client in self.clients.items():
            models = self.PROVIDERS[provider]["models"]
            model = models[0]  # 使用默认模型
            try:
                response = client.chat.completions.create(
                    model=model,
                    messages=messages,
                    temperature=temperature,
                )
                results[provider] = {
                    "model": model,
                    "content": response.choices[0].message.content,
                    "usage": response.usage,
                }
            except Exception as e:
                results[provider] = {"error": str(e)}
        return results

# 使用
client = MultiModelClient()
results = client.compare([
    {"role": "user", "content": "用一句话描述人工智能的未来。"},
])

for provider, result in results.items():
    if "error" in result:
        print(f"❌ {provider}: {result['error']}")
    else:
        print(f"✅ {provider} ({result['model']}): {result['content'][:100]}...")
```

## 4. 场景选型决策树

```
需要什么能力？
│
├─ 长文本处理（>100K tokens）
│   ├─ 需要处理 PDF/图片 → Kimi（文件对话）
│   ├─ 需要处理海量文档 → Qwen-Long（1000万tokens）
│   └─ 一般长文本 → DeepSeek V3 128K（性价比最高）
│
├─ 多模态（图片/视频理解）
│   ├─ 国内服务 → Qwen-VL（最成熟）
│   └─ 纯图片 → Kimi（文件上传）
│
├─ 代码生成与推理
│   ├─ 复杂推理 → DeepSeek V4 Pro（思考模式）
│   └─ 一般代码 → DeepSeek V3（代码训练优化）
│
├─ Agent 工具调用
│   ├─ 需要原生工具生态 → Qwen（阿里云插件生态）
│   ├─ Function Calling → DeepSeek 或 Qwen
│   └─ 联网搜索 → Kimi（内置搜索）
│
├─ 内容生成（需审核）
│   ├─ 需要严格审核 → Qwen（内置审核）
│   └─ 灵活对话 → DeepSeek（审核宽松）
│
└─ 高并发低成本
    ├─ 最低成本 → DeepSeek V3
    └─ 快速响应 → Qwen-Turbo
```

## 5. 组合使用策略

### 5.1 路由模式

```python
class SmartRouter:
    """根据任务类型自动路由到最适合的模型"""

    def __init__(self):
        self.deepseek_key = os.environ.get("DEEPSEEK_API_KEY")
        self.kimi_key = os.environ.get("MOONSHOT_API_KEY")
        self.qwen_key = os.environ.get("DASHSCOPE_API_KEY")

    def route(self, task_type: str, messages: list, **kwargs) -> str:
        if task_type == "code_review" and self.deepseek_key:
            return self._call("deepseek", "deepseek-chat", messages, **kwargs)

        elif task_type == "long_document" and self.kimi_key:
            return self._call("kimi", "moonshot-v1-128k", messages, **kwargs)

        elif task_type == "image_analysis" and self.qwen_key:
            return self._call("qwen", "qwen-vl-plus", messages, **kwargs)

        elif task_type == "translation" and self.deepseek_key:
            return self._call("deepseek", "deepseek-chat", messages, temperature=0.3)

        else:
            # 默认：DeepSeek（性价比最高）
            return self._call("deepseek", "deepseek-chat", messages, **kwargs)
```

### 5.2 降级模式

```python
class FallbackChain:
    """主模型失败时自动降级到备用模型"""

    CHAIN = [
        ("deepseek", "deepseek-chat"),     # 首选
        ("deepseek", "deepseek-v4-pro"),    # 降级1：同厂商更强模型
        ("kimi", "moonshot-v1-128k"),       # 降级2：Kimi
        ("qwen", "qwen-plus"),              # 降级3：Qwen
    ]

    def call_with_fallback(self, messages: list, **kwargs):
        last_error = None
        for provider, model in self.CHAIN:
            try:
                response = self._call(provider, model, messages, **kwargs)
                if provider != self.CHAIN[0][0]:
                    print(f"⚠️ 已降级到 {provider}/{model}")
                return response
            except Exception as e:
                last_error = e
                print(f"⚠️ {provider}/{model} 失败: {e}")
                continue

        raise Exception(f"所有模型均失败。最后错误: {last_error}")
```

## 6. Token 成本计算器

```python
class TokenCostCalculator:
    """三大模型 Token 成本计算"""

    PRICING = {
        "deepseek-chat": {"input": 1.0, "output": 2.0},    # ¥/M tokens
        "deepseek-v4-flash": {"input": 2.0, "output": 8.0},
        "deepseek-v4-pro": {"input": 2.5, "output": 10.0},
        "moonshot-v1-8k": {"input": 12.0, "output": 12.0},
        "moonshot-v1-128k": {"input": 60.0, "output": 60.0},
        "qwen-turbo": {"input": 0.3, "output": 0.6},
        "qwen-plus": {"input": 0.8, "output": 2.0},
        "qwen-max": {"input": 2.0, "output": 6.0},
    }

    @staticmethod
    def estimate_cost(model: str, prompt_tokens: int, completion_tokens: int) -> float:
        pricing = TokenCostCalculator.PRICING.get(model, {"input": 0, "output": 0})
        input_cost = prompt_tokens / 1_000_000 * pricing["input"]
        output_cost = completion_tokens / 1_000_000 * pricing["output"]
        return input_cost + output_cost

    @classmethod
    def compare_costs(cls, prompt_tokens=1000, completion_tokens=500):
        """对比各模型处理相同任务的成本"""
        print(f"\n📊 成本对比 (输入 {prompt_tokens} tokens, 输出 {completion_tokens} tokens):\n")
        print(f"{'模型':<25} {'输入成本':>10} {'输出成本':>10} {'总成本':>10}")
        print("-" * 55)
        for model, pricing in cls.PRICING.items():
            total = cls.estimate_cost(model, prompt_tokens, completion_tokens)
            input_c = prompt_tokens / 1_000_000 * pricing["input"]
            output_c = completion_tokens / 1_000_000 * pricing["output"]
            print(f"{model:<25} ¥{input_c:>8.4f} ¥{output_c:>8.4f} ¥{total:>8.4f}")

# 运行对比
TokenCostCalculator.compare_costs(prompt_tokens=1000, completion_tokens=500)
```

## 7. 生产环境 Checklist

| 检查项 | DeepSeek | Kimi | Qwen |
|--------|:---:|:---:|:---:|
| API Key 轮换机制 | ✅ | ✅ | ✅ |
| 指数退避重试 | ✅（429/503） | ✅ | ✅（含审核失败） |
| 并发限制处理 | RPM/TPM 监控 | RPM 监控 | QPS 监控 |
| 错误分类处理 | ✅ | ✅ | ✅（含 Arrearage/DataInspection） |
| Token 成本追踪 | response.usage | response.usage | response.usage |
| 内容安全审核 | 需自行实现 | 需自行实现 | 平台内置 |
| 私有化部署 | ❌ | ❌ | ✅（百炼平台） |

## 8. 总结

| 场景 | 首选 | 原因 |
|------|:---:|------|
| **通用对话（性价比）** | DeepSeek V3 | 能力均衡，成本最低 |
| **复杂推理** | DeepSeek V4 Pro | 思考模式业界领先 |
| **长文档/文件对话** | Kimi | 原生文件上传+128K |
| **多模态分析** | Qwen-VL | 图片+视频理解最成熟 |
| **海量文档** | Qwen-Long | 1000万 tokens 业界最大 |
| **Agent 工具编排** | DeepSeek→Qwen | FC 成熟度最高 |
| **高并发低成本** | Qwen-Turbo | 速度最快，成本极低 |
| **企业合规** | Qwen | 内置内容安全审核 |
