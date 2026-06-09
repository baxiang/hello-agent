# DeepSeek V3/V4 实战 — 从 API 调通到生产部署

> DeepSeek 是国内最成熟的 OpenAI 兼容 API 提供商之一。本文以 DeepSeek V3（文本）和 V4（推理增强）为例，覆盖从基础调用到高级特性的完整实战。

## 1. 平台速览

| 属性 | 说明 |
|------|------|
| **API 地址** | `https://api.deepseek.com/v1` |
| **认证方式** | `Authorization: Bearer sk-xxx` （在 [platform.deepseek.com](https://platform.deepseek.com) 获取） |
| **可用模型** | `deepseek-chat`（V3 文本）, `deepseek-v4-flash`（V4 快速）, `deepseek-v4-pro`（V4 推理增强） |
| **兼容性** | 完全兼容 OpenAI Chat Completions API |
| **特有功能** | 思考模式（`reasoning_content`）、前缀补全（Beta） |
| **定价** | V3: ¥1/M tokens 输入，¥2/M tokens 输出；V4: 参考官网最新定价 |

## 2. 环境准备

```bash
# 设置 API Key
export DEEPSEEK_API_KEY="sk-xxxxxxxxxxxxxxxx"
export DEEPSEEK_BASE_URL="https://api.deepseek.com/v1"
```

## 3. 基础文本对话

### 3.1 cURL

```bash
curl https://api.deepseek.com/v1/chat/completions \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $DEEPSEEK_API_KEY" \
  -d '{
    "model": "deepseek-chat",
    "messages": [
      {"role": "system", "content": "你是一个专业的技术文档翻译助手，将英文技术文档翻译成流畅的中文。"},
      {"role": "user", "content": "Translate: The Transformer architecture uses self-attention mechanisms to process sequences in parallel, significantly improving training efficiency compared to recurrent neural networks."}
    ],
    "temperature": 0.3,
    "max_tokens": 500
  }'
```

### 3.2 Python

```python
import os
from openai import OpenAI

# DeepSeek 完全兼容 OpenAI SDK
client = OpenAI(
    api_key=os.environ.get("DEEPSEEK_API_KEY"),
    base_url="https://api.deepseek.com/v1",
)

response = client.chat.completions.create(
    model="deepseek-chat",
    messages=[
        {"role": "system", "content": "你是一个专业的技术文档翻译助手。"},
        {"role": "user", "content": "Translate: The Transformer architecture uses self-attention mechanisms to process sequences in parallel."},
    ],
    temperature=0.3,
    max_tokens=500,
)

print(response.choices[0].message.content)
# 输出: Transformer 架构使用自注意力机制来并行处理序列...
```

### 3.3 Go

```go
package main

import (
    "context"
    "fmt"
    "os"

    openai "github.com/sashabaranov/go-openai"
)

func main() {
    client := openai.NewClientWithConfig(openai.DefaultConfig(os.Getenv("DEEPSEEK_API_KEY")))
    client.BaseURL = "https://api.deepseek.com/v1"

    resp, err := client.CreateChatCompletion(context.Background(), openai.ChatCompletionRequest{
        Model: "deepseek-chat",
        Messages: []openai.ChatCompletionMessage{
            {Role: openai.ChatMessageRoleSystem, Content: "你是一个专业的技术文档翻译助手。"},
            {Role: openai.ChatMessageRoleUser, Content: "Translate: The Transformer architecture..."},
        },
        Temperature: 0.3,
        MaxTokens:   500,
    })
    if err != nil {
        panic(err)
    }
    fmt.Println(resp.Choices[0].Message.Content)
}
```

## 4. 流式输出

### 4.1 Python 流式

```python
stream = client.chat.completions.create(
    model="deepseek-chat",
    messages=[
        {"role": "user", "content": "用 500 字解释分布式训练中的梯度累积技术。"}
    ],
    temperature=0.7,
    max_tokens=1000,
    stream=True,  # 启用流式
)

print("🤖 Assistant: ", end="", flush=True)
for chunk in stream:
    if chunk.choices[0].delta.content:
        print(chunk.choices[0].delta.content, end="", flush=True)
print()
```

### 4.2 Go 流式

```go
stream, err := client.CreateChatCompletionStream(context.Background(), openai.ChatCompletionRequest{
    Model: "deepseek-chat",
    Messages: []openai.ChatCompletionMessage{
        {Role: openai.ChatMessageRoleUser, Content: "用 500 字解释分布式训练中的梯度累积技术。"},
    },
    Stream: true,
})
if err != nil {
    panic(err)
}
defer stream.Close()

fmt.Print("🤖 Assistant: ")
for {
    response, err := stream.Recv()
    if err == io.EOF { break }
    if err != nil { panic(err) }
    fmt.Print(response.Choices[0].Delta.Content)
}
```

## 5. Function Calling（工具调用）

### 5.1 Python

```python
tools = [
    {
        "type": "function",
        "function": {
            "name": "get_weather",
            "description": "获取指定城市的实时天气信息",
            "parameters": {
                "type": "object",
                "properties": {
                    "city": {
                        "type": "string",
                        "description": "城市名称，如 北京、上海"
                    },
                    "unit": {
                        "type": "string",
                        "enum": ["celsius", "fahrenheit"],
                        "description": "温度单位"
                    }
                },
                "required": ["city"]
            }
        }
    }
]

# 第一轮：模型请求调用工具
response = client.chat.completions.create(
    model="deepseek-chat",
    messages=[
        {"role": "user", "content": "北京和上海今天哪个更热？"}
    ],
    tools=tools,
    tool_choice="auto",
)

msg = response.choices[0].message
if msg.tool_calls:
    for tool_call in msg.tool_calls:
        print(f"🔧 调用工具: {tool_call.function.name}")
        print(f"   参数: {tool_call.function.arguments}")
        # 解析参数
        import json
        args = json.loads(tool_call.function.arguments)

        # 模拟工具执行
        weather_data = {
            "北京": {"temperature": 22, "condition": "晴"},
            "上海": {"temperature": 25, "condition": "多云"},
        }
        result = weather_data.get(args["city"], {"temperature": 20, "condition": "未知"})

        # 第二轮：将工具结果返回
        messages = [
            {"role": "user", "content": "北京和上海今天哪个更热？"},
            msg,  # 包含 tool_calls 的 assistant 消息
            {
                "role": "tool",
                "tool_call_id": tool_call.id,
                "content": json.dumps(result, ensure_ascii=False),
            }
        ]

        # 第二轮调用
        response2 = client.chat.completions.create(
            model="deepseek-chat",
            messages=messages,
        )
        print(f"🤖: {response2.choices[0].message.content}")
```

### 5.2 Go

```go
tools := []openai.Tool{
    {
        Type: openai.ToolTypeFunction,
        Function: &openai.FunctionDefinition{
            Name:        "get_weather",
            Description: "获取指定城市的实时天气信息",
            Parameters: map[string]any{
                "type": "object",
                "properties": map[string]any{
                    "city": map[string]any{
                        "type":        "string",
                        "description": "城市名称",
                    },
                    "unit": map[string]any{
                        "type": "string",
                        "enum": []string{"celsius", "fahrenheit"},
                    },
                },
                "required": []string{"city"},
            },
        },
    },
}

resp, _ := client.CreateChatCompletion(context.Background(), openai.ChatCompletionRequest{
    Model:    "deepseek-chat",
    Messages: []openai.ChatCompletionMessage{
        {Role: openai.ChatMessageRoleUser, Content: "北京和上海今天哪个更热？"},
    },
    Tools: tools,
})

// 处理 tool_calls...
```

## 6. DeepSeek V4 思考模式（Reasoning）

DeepSeek V4 支持思考模式，模型在回答前会先进行内部推理（生成 `reasoning_content`）。

### 6.1 启用思考模式

```python
response = client.chat.completions.create(
    model="deepseek-v4-pro",  # 或 deepseek-v4-flash
    messages=[
        {"role": "user", "content": "一个池塘里的荷花每天数量翻倍。第 30 天荷花铺满整个池塘。请问第几天荷花铺满半个池塘？"}
    ],
    temperature=0.6,
    max_tokens=2000,
    # 思考模式参数
    extra_body={
        "thinking": {"type": "enabled"},
    },
)

# 获取思考内容
thinking_content = response.choices[0].message.reasoning_content
final_answer = response.choices[0].message.content

if thinking_content:
    print(f"🧠 思考过程:\n{thinking_content[:500]}...\n")

print(f"💬 最终回答:\n{final_answer}")
```

### 6.2 流式 + 思考模式

```python
stream = client.chat.completions.create(
    model="deepseek-v4-pro",
    messages=[
        {"role": "user", "content": "请分析 React 和 Vue 的渲染机制差异，从虚拟DOM、响应式系统、编译优化三个维度对比。"}
    ],
    stream=True,
    extra_body={"thinking": {"type": "enabled"}},
)

thinking_mode = True
for chunk in stream:
    delta = chunk.choices[0].delta

    # 思考内容和回答内容是分开的 chunk
    if hasattr(delta, 'reasoning_content') and delta.reasoning_content:
        print(f"\033[90m{delta.reasoning_content}\033[0m", end="", flush=True)
    elif delta.content:
        if thinking_mode:
            print("\n\n--- 思考结束，开始回答 ---\n")
            thinking_mode = False
        print(delta.content, end="", flush=True)
```

### 6.3 多轮对话中的思考内容处理

```python
# ❌ 错误做法：将思考内容一起发送给下一轮
messages = [
    {"role": "user", "content": "解释量子计算"},
]
response1 = client.chat.completions.create(
    model="deepseek-v4-pro",
    messages=messages,
    extra_body={"thinking": {"type": "enabled"}},
)

# ✅ 正确做法：只保留最终回答（content），丢弃思考内容（reasoning_content）
assistant_msg = response1.choices[0].message
# 创建新的 assistant 消息，去除 reasoning_content
messages.append({
    "role": "assistant",
    "content": assistant_msg.content,  # 只要 content，不要 reasoning_content
})

# 下一轮对话
messages.append({"role": "user", "content": "请用更简单的语言再解释一遍"})
response2 = client.chat.completions.create(
    model="deepseek-v4-pro",
    messages=messages,
)
```

> **重要**：根据 DeepSeek 官方建议，多轮对话中不发送历史轮的 `reasoning_content`。tRPC-Agent-Go 默认配置 `ReasoningContentModeDiscardPreviousTurns` 已处理此逻辑。

## 7. JSON 模式（结构化输出）

```python
response = client.chat.completions.create(
    model="deepseek-chat",
    messages=[
        {"role": "system", "content": "你是一个数据提取助手。始终以 JSON 格式输出。"},
        {"role": "user", "content": """
从以下文本中提取人名、公司名和职位：
"张三目前在北京字节跳动担任高级软件工程师，此前他在深圳腾讯工作过3年。"
"""},
    ],
    temperature=0,  # 结构化输出建议 temperature=0
    response_format={"type": "json_object"},  # JSON 模式
)

import json
result = json.loads(response.choices[0].message.content)
print(json.dumps(result, indent=2, ensure_ascii=False))
# 输出:
# {
#   "persons": [
#     {"name": "张三", "company": "字节跳动", "position": "高级软件工程师"},
#     {"name": "张三", "company": "腾讯", "position": null}
#   ]
# }
```

## 8. Token 计数与成本控制

### 8.1 粗略估算（4 字符 ≈ 1 token）

```python
def estimate_tokens(text: str) -> int:
    """粗略估算：中文 1.5 字符/token，英文 4 字符/token"""
    chinese_chars = sum(1 for c in text if '\u4e00' <= c <= '\u9fff')
    other_chars = len(text) - chinese_chars
    return int(chinese_chars / 1.5 + other_chars / 4)

prompt = "请写一篇关于人工智能发展历史的 5000 字综述"
tokens = estimate_tokens(prompt)
cost = tokens / 1_000_000 * 1  # V3 输入 ¥1/M tokens
print(f"估算 token: {tokens}, 成本: ¥{cost:.6f}")
```

### 8.2 精确计数（tiktoken）

```python
import tiktoken

# DeepSeek 使用与 OpenAI 相同的 tokenizer（cl100k_base）
encoding = tiktoken.get_encoding("cl100k_base")

def count_tokens(text: str) -> int:
    return len(encoding.encode(text))

prompt = "请写一篇关于人工智能发展历史的 5000 字综述"
tokens = count_tokens(prompt)
print(f"精确 token: {tokens}")
```

## 9. 错误处理与重试

```python
import time
import random

def chat_with_retry(client, messages, max_retries=3):
    """带指数退避重试的 API 调用"""
    for attempt in range(max_retries):
        try:
            response = client.chat.completions.create(
                model="deepseek-chat",
                messages=messages,
                temperature=0.7,
            )
            return response
        except Exception as e:
            error_str = str(e)

            # 速率限制 → 等待后重试
            if "rate_limit" in error_str.lower():
                wait = (2 ** attempt) + random.uniform(0, 1)
                print(f"速率限制，{wait:.1f}s 后重试...")
                time.sleep(wait)
                continue

            # 服务器错误 → 重试
            if "server_error" in error_str.lower() or "503" in error_str:
                wait = 2 ** attempt
                print(f"服务器错误，{wait}s 后重试...")
                time.sleep(wait)
                continue

            # 输入过长 → 截断
            if "context_length" in error_str.lower():
                print("输入过长，自动截断...")
                messages = truncate_messages(messages)
                continue

            # 其他错误 → 不重试
            raise

    raise Exception(f"{max_retries} 次重试后仍然失败")

def truncate_messages(messages):
    """截断消息列表以适应上下文窗口"""
    # 保留 system + 最后 10 条消息
    system_msgs = [m for m in messages if m["role"] == "system"]
    other_msgs = [m for m in messages if m["role"] != "system"]
    return system_msgs + other_msgs[-10:]
```

## 10. 最佳实践总结

| 实践 | 建议 |
|------|------|
| **结构化输出** | `temperature=0` + `response_format={"type":"json_object"}` |
| **翻译/摘要** | `temperature=0.3`，低温度保证一致性 |
| **创意写作** | `temperature=0.8-1.0`，高温度增加多样性 |
| **代码生成** | `temperature=0.1` + V4 Pro 思考模式 |
| **多轮对话** | 去除历史轮的 `reasoning_content`，只保留 `content` |
| **长上下文** | DeepSeek V3 支持 128K context，充分利用但避免无意义填充 |
| **成本控制** | 使用 tiktoken 精确计数，设置 `max_tokens` 上限 |
| **错误处理** | 429/503 指数退避重试，400 检查参数，401 检查 API Key |
| **并发调用** | DeepSeek API 默认 RPM 限制，高并发场景建议客户端排队 |
