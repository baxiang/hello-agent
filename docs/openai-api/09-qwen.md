# 通义千问 Qwen 实战 — 多模态·RAG·Agent 编排

> Qwen（通义千问）是阿里云开发的大模型系列，覆盖文本、视觉、音频、代码等多种模态。本文以 Qwen-Max/Qwen-Plus/Qwen-Turbo 为例，覆盖文本对话、多模态、结构化输出、RAG 集成和 Agent 工具调用。

## 1. 平台速览

| 属性 | 说明 |
|------|------|
| **API 地址** | `https://dashscope.aliyuncs.com/compatible-mode/v1`（OpenAI 兼容） |
| **认证方式** | `Authorization: Bearer sk-xxx` （在 [dashscope.console.aliyun.com](https://dashscope.console.aliyun.com) 获取） |
| **可用模型** | `qwen-max`（最强）, `qwen-plus`（均衡）, `qwen-turbo`（快速）, `qwen-long`（长文本） |
| **兼容性** | 兼容 OpenAI Chat Completions API + 阿里云 DashScope 原生 API |
| **特有功能** | 多模态（文本+图片+音频+视频）、RAG 内置支持、Agent 编排、插件生态 |
| **上下文窗口** | Qwen-Max: 32K, Qwen-Long: 1000万 tokens（文档处理） |
| **定价** | 按模型和 token 量计费，参考官网最新定价 |

## 2. 环境准备

```bash
export DASHSCOPE_API_KEY="sk-xxxxxxxxxxxxxxxx"
export DASHSCOPE_BASE_URL="https://dashscope.aliyuncs.com/compatible-mode/v1"
```

## 3. 基础对话（OpenAI 兼容模式）

### 3.1 cURL

```bash
curl https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $DASHSCOPE_API_KEY" \
  -d '{
    "model": "qwen-plus",
    "messages": [
      {"role": "system", "content": "你是一个精通中国历史文化的AI助手。"},
      {"role": "user", "content": "唐朝和宋朝在文化艺术上各有什么特点？"}
    ],
    "temperature": 0.7,
    "max_tokens": 800
  }'
```

### 3.2 Python

```python
import os
from openai import OpenAI

client = OpenAI(
    api_key=os.environ.get("DASHSCOPE_API_KEY"),
    base_url="https://dashscope.aliyuncs.com/compatible-mode/v1",
)

response = client.chat.completions.create(
    model="qwen-plus",
    messages=[
        {"role": "system", "content": "你是一个精通中国历史文化的AI助手。"},
        {"role": "user", "content": "唐朝和宋朝在文化艺术上各有什么特点？"},
    ],
    temperature=0.7,
    max_tokens=800,
)

print(response.choices[0].message.content)
```

### 3.3 模型选择指南

| 模型 | 场景 | 特点 |
|------|------|------|
| `qwen-turbo` | 简单问答、分类 | 最快、最便宜 |
| `qwen-plus` | 日常对话、总结 | 效果/速度/成本平衡 |
| `qwen-max` | 复杂推理、创作 | 最强能力，成本最高 |
| `qwen-long` | 超长文档处理 | 1000万 tokens，按文档计费 |

## 4. 多模态输入（图片理解）

Qwen 支持传入图片 URL 或 Base64 编码的图片进行视觉理解。

### 4.1 图片 URL 输入

```python
response = client.chat.completions.create(
    model="qwen-vl-plus",  # 视觉语言模型
    messages=[
        {
            "role": "user",
            "content": [
                {
                    "type": "text",
                    "text": "这张图片里有什么？请详细描述。",
                },
                {
                    "type": "image_url",
                    "image_url": {
                        "url": "https://example.com/landscape.jpg"
                    },
                },
            ],
        },
    ],
)

print(response.choices[0].message.content)
```

### 4.2 Base64 图片输入

```python
import base64
from pathlib import Path

def encode_image(image_path: str) -> str:
    """将图片编码为 Base64 Data URL"""
    with open(image_path, "rb") as f:
        return f"data:image/{Path(image_path).suffix[1:]};base64,{base64.b64encode(f.read()).decode()}"

response = client.chat.completions.create(
    model="qwen-vl-plus",
    messages=[
        {
            "role": "user",
            "content": [
                {"type": "text", "text": "识别图中的文字并翻译成英文。"},
                {
                    "type": "image_url",
                    "image_url": {"url": encode_image("screenshot.png")},
                },
            ],
        },
    ],
    max_tokens=500,
)

print(response.choices[0].message.content)
```

### 4.3 多图对比分析

```python
response = client.chat.completions.create(
    model="qwen-vl-max",
    messages=[
        {
            "role": "user",
            "content": [
                {
                    "type": "text",
                    "text": "对比这两张 UI 设计图，分析它们在信息架构、视觉层次和交互设计上的差异。",
                },
                {"type": "image_url", "image_url": {"url": encode_image("design_v1.png")}},
                {"type": "image_url", "image_url": {"url": encode_image("design_v2.png")}},
            ],
        },
    ],
)

print(response.choices[0].message.content)
```

## 5. 结构化输出

### 5.1 JSON 模式

```python
def extract_structured_info(text: str) -> dict:
    """从文本中结构化提取信息"""
    response = client.chat.completions.create(
        model="qwen-plus",
        messages=[
            {
                "role": "system",
                "content": """你是一个数据提取助手。从文本中提取关键信息，严格按JSON格式输出。
输出格式：
{
  "company": {"name": "公司名", "industry": "行业"},
  "product": {"name": "产品名", "features": ["特性列表"]},
  "metrics": {"revenue": "营收", "users": "用户数"}
}""",
            },
            {"role": "user", "content": text},
        ],
        temperature=0,
        response_format={"type": "json_object"},
    )

    import json
    return json.loads(response.choices[0].message.content)

text = "字节跳动旗下的抖音在2025年实现了2000亿人民币的营收，月活用户超过8亿。"
result = extract_structured_info(text)
print(json.dumps(result, indent=2, ensure_ascii=False))
```

### 5.2 Schema 约束输出（Function Calling 反用）

```python
# 定义输出 Schema
output_schema = {
    "type": "object",
    "properties": {
        "sentiment": {
            "type": "string",
            "enum": ["positive", "negative", "neutral"],
            "description": "情感倾向"
        },
        "confidence": {
            "type": "number",
            "minimum": 0,
            "maximum": 1,
            "description": "置信度"
        },
        "keywords": {
            "type": "array",
            "items": {"type": "string"},
            "description": "关键词列表"
        },
        "summary": {
            "type": "string",
            "description": "一句话总结"
        },
    },
    "required": ["sentiment", "confidence", "keywords", "summary"],
}

response = client.chat.completions.create(
    model="qwen-plus",
    messages=[
        {
            "role": "system",
            "content": "你是一个文本分析助手。分析用户输入的文本情感，按 JSON Schema 输出。",
        },
        {"role": "user", "content": "今天天气真好，工作效率也很高，非常开心！"},
    ],
    temperature=0,
    # 阿里云 DashScope 原生的结构化输出参数
    extra_body={
        "result_format": "json",
        "stop": None,
    },
)

print(response.choices[0].message.content)
```

## 6. 流式对话

```python
def stream_chat_with_history(messages: list, model="qwen-plus"):
    """带历史记录的流式对话"""
    stream = client.chat.completions.create(
        model=model,
        messages=messages,
        temperature=0.7,
        stream=True,
        stream_options={"include_usage": True},  # 流式完成后返回 token 用量
    )

    full_response = ""
    usage = None
    for chunk in stream:
        # 处理文本增量
        if chunk.choices and chunk.choices[0].delta.content:
            content = chunk.choices[0].delta.content
            print(content, end="", flush=True)
            full_response += content
        # 最后一个 chunk 包含 usage
        if hasattr(chunk, 'usage') and chunk.usage:
            usage = chunk.usage

    if usage:
        print(f"\n\n📊 Tokens: {usage.total_tokens} (提示: {usage.prompt_tokens}, 生成: {usage.completion_tokens})")

    return full_response, usage

# 示例
messages = [
    {"role": "system", "content": "你是一个技术顾问。"},
    {"role": "user", "content": "解释一下什么是向量数据库，以及它与传统关系数据库的区别。"},
]
response, usage = stream_chat_with_history(messages, model="qwen-max")
```

## 7. Function Calling（工具调用）

```python
def execute_function_call(name: str, arguments: str) -> dict:
    """模拟工具执行"""
    import json
    args = json.loads(arguments)

    # 模拟的"数据库"查询
    mock_db = {
        "北京": {"temperature": 22, "condition": "晴", "aqi": 45},
        "上海": {"temperature": 25, "condition": "多云", "aqi": 62},
        "深圳": {"temperature": 28, "condition": "阵雨", "aqi": 38},
    }
    return mock_db.get(args.get("city", ""), {})

def agent_loop(user_query: str, max_iterations: int = 3):
    """Agent 循环：LLM 调用工具直到给出最终回答"""
    messages = [
        {"role": "system", "content": "你是一个天气助手。使用工具查询天气后回答用户。"},
        {"role": "user", "content": user_query},
    ]

    tools = [
        {
            "type": "function",
            "function": {
                "name": "get_weather",
                "description": "获取城市天气。参数 city 是城市名。",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "city": {"type": "string", "description": "城市名称"}
                    },
                    "required": ["city"],
                },
            },
        },
        {
            "type": "function",
            "function": {
                "name": "get_air_quality",
                "description": "获取城市空气质量 AQI。参数 city 是城市名。",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "city": {"type": "string", "description": "城市名称"}
                    },
                    "required": ["city"],
                },
            },
        },
    ]

    for i in range(max_iterations):
        response = client.chat.completions.create(
            model="qwen-plus",
            messages=messages,
            tools=tools,
            tool_choice="auto",
        )

        msg = response.choices[0].message

        # 如果模型直接回答了（无 tool_calls），结束循环
        if not msg.tool_calls:
            print(f"\n✅ 最终回答:\n{msg.content}")
            return msg.content

        # 处理工具调用
        messages.append(msg)
        for tool_call in msg.tool_calls:
            func_name = tool_call.function.name
            func_args = tool_call.function.arguments
            print(f"🔧 调用 {func_name}({func_args})")

            result = execute_function_call(func_name, func_args)

            messages.append({
                "role": "tool",
                "tool_call_id": tool_call.id,
                "content": json.dumps(result, ensure_ascii=False),
            })
            print(f"   结果: {result}")

    return "达到最大迭代次数"

# 测试
agent_loop("北京和深圳今天天气怎么样？哪个空气质量更好？")
```

## 8. 阿里云 DashScope 原生 API

除了 OpenAI 兼容模式，Qwen 还提供了功能更丰富的 DashScope 原生 API。

### 8.1 原生 API 调用

```python
import dashscope
from dashscope import Generation

dashscope.api_key = os.environ.get("DASHSCOPE_API_KEY")

def qwen_chat_native(messages: list, model: str = "qwen-plus"):
    """使用 DashScope 原生 API 调用 Qwen"""
    response = Generation.call(
        model=model,
        messages=messages,
        result_format="message",  # 完整消息格式
        temperature=0.7,
        top_p=0.8,
        max_tokens=1000,
    )

    if response.status_code == 200:
        return response.output.choices[0].message.content
    else:
        raise Exception(f"API Error: {response.code} - {response.message}")

# 测试
print(qwen_chat_native([
    {"role": "system", "content": "你是一个助手。"},
    {"role": "user", "content": "1+1等于几？"},
]))
```

### 8.2 流式原生 API

```python
def qwen_stream_native(messages: list, model: str = "qwen-plus"):
    """DashScope 原生流式 API"""
    responses = Generation.call(
        model=model,
        messages=messages,
        result_format="message",
        stream=True,
        incremental_output=True,
    )

    full_response = ""
    for response in responses:
        if response.status_code == 200:
            content = response.output.choices[0].message.content
            print(content, end="", flush=True)
            full_response += content
        else:
            print(f"\nError: {response.code} - {response.message}")

    return full_response
```

## 9. Qwen-Long 超长文档处理

Qwen-Long 支持最高 1000万 tokens 的文档处理，适合处理大量文档：

```python
def analyze_large_document(file_path: str) -> str:
    """使用 Qwen-Long 分析大文档"""
    with open(file_path, "r") as f:
        content = f.read()

    response = client.chat.completions.create(
        model="qwen-long",
        messages=[
            {
                "role": "system",
                "content": "你是一个专业的文档分析助手。请对以下文档进行全面分析。",
            },
            {"role": "user", "content": f"文档内容：\n\n{content}\n\n请给出：1. 核心议题 2. 关键结论 3. 数据要点 4. 建议行动项"},
        ],
        temperature=0.1,
        max_tokens=2000,
    )

    print(f"📊 用量: {response.usage}")
    return response.choices[0].message.content
```

## 10. 错误处理

```python
def safe_call(messages, model="qwen-plus", max_retries=3):
    """安全的 Qwen API 调用，带错误分类处理"""
    for attempt in range(max_retries):
        try:
            return client.chat.completions.create(
                model=model,
                messages=messages,
                temperature=0.7,
            )
        except Exception as e:
            error_msg = str(e)

            # 阿里云特有的错误处理
            if "Arrearage" in error_msg:
                # 账户欠费
                raise Exception("账户欠费，请充值后重试")

            if "DataInspectionFailed" in error_msg:
                # 内容审核不通过
                print("内容审核不通过，尝试改写...")
                messages = rewrite_messages(messages)
                continue

            if "Throttling" in error_msg or "RateLimit" in error_msg:
                wait = (2 ** attempt) + random.uniform(0, 1)
                print(f"限流，{wait:.1f}s 后重试...")
                time.sleep(wait)
                continue

            if "InternalError" in error_msg:
                wait = 2 ** attempt
                print(f"服务器错误，{wait}s 后重试...")
                time.sleep(wait)
                continue

            raise
    raise Exception(f"重试 {max_retries} 次后失败")

def rewrite_messages(messages):
    """改写可能触发审核的消息"""
    for msg in messages:
        if msg["role"] == "user":
            # 添加合规声明
            msg["content"] = "[以下内容仅用于学术研究] " + msg["content"]
    return messages
```

## 11. Qwen vs DeepSeek vs Kimi 选型矩阵

| | Qwen | DeepSeek | Kimi |
|----|:---:|:---:|:---:|
| **文本对话** | ⭐⭐⭐⭐⭐ | ⭐⭐⭐⭐⭐ | ⭐⭐⭐⭐ |
| **代码生成** | ⭐⭐⭐⭐ | ⭐⭐⭐⭐⭐ | ⭐⭐⭐ |
| **多模态** | ⭐⭐⭐⭐⭐ | 不支持 | ⭐⭐⭐⭐ |
| **超长文本** | ⭐⭐⭐⭐⭐ (1000万) | ⭐⭐⭐⭐ (128K) | ⭐⭐⭐⭐ (128K) |
| **文件对话** | ⭐⭐⭐⭐ | 不支持 | ⭐⭐⭐⭐⭐ |
| **Agent 工具** | ⭐⭐⭐⭐⭐ | ⭐⭐⭐⭐ | ⭐⭐⭐ |
| **API 成熟度** | ⭐⭐⭐⭐ | ⭐⭐⭐⭐⭐ | ⭐⭐⭐ |
| **中文能力** | ⭐⭐⭐⭐⭐ | ⭐⭐⭐⭐⭐ | ⭐⭐⭐⭐ |
| **价格竞争力** | ⭐⭐⭐⭐ | ⭐⭐⭐⭐⭐ | ⭐⭐⭐ |

## 12. 最佳实践

| 实践 | 建议 |
|------|------|
| **模型选择** | 日常用 `qwen-plus`，重任务用 `qwen-max`，长文档用 `qwen-long` |
| **多模态** | 图片理解用 `qwen-vl-plus`，视频分析用 `qwen-vl-max` |
| **结构化输出** | 在 system prompt 中明确 JSON 格式 + `temperature=0` |
| **内容审核** | 阿里云强制内容安全审核，敏感内容需要改写或使用企业内部通道 |
| **并发控制** | DashScope API 有 QPS 限制，高并发需实现客户端队列 |
| **成本优化** | 能用 `qwen-turbo` 的场景不升级到 `qwen-plus`；流式输出不增加成本 |
