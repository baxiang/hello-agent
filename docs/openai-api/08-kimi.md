# Kimi（月之暗面）实战 — 长上下文·文件对话·联网搜索

> Kimi 是月之暗面（Moonshot AI）开发的大语言模型，以其超长上下文窗口（128K-1M tokens）和文件对话能力著称。本文覆盖 Kimi API 的完整实战。

## 1. 平台速览

| 属性 | 说明 |
|------|------|
| **API 地址** | `https://api.moonshot.cn/v1` |
| **认证方式** | `Authorization: Bearer sk-xxx` （在 [platform.moonshot.cn](https://platform.moonshot.cn) 获取） |
| **可用模型** | `moonshot-v1-8k`, `moonshot-v1-32k`, `moonshot-v1-128k`, `moonshot-v1-auto`（自动选择） |
| **兼容性** | 部分兼容 OpenAI Chat Completions API（基础对话+文件接口） |
| **特有功能** | 超长上下文（128K tokens）、文件对话（PDF/DOCX/图片）、联网搜索 |
| **上下文窗口** | 8K / 32K / 128K（按模型选择） |
| **定价** | ¥12/M tokens 输入，¥12/M tokens 输出（v1-8k）；v1-128k 等参考官网 |

## 2. 环境准备

```bash
export MOONSHOT_API_KEY="sk-xxxxxxxxxxxxxxxx"
export MOONSHOT_BASE_URL="https://api.moonshot.cn/v1"
```

## 3. 基础对话

### 3.1 cURL

```bash
curl https://api.moonshot.cn/v1/chat/completions \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $MOONSHOT_API_KEY" \
  -d '{
    "model": "moonshot-v1-8k",
    "messages": [
      {"role": "system", "content": "你是 Kimi，一个善于长文本处理的AI助手。回答简洁准确。"},
      {"role": "user", "content": "用三句话介绍 Moonshot AI 公司。"}
    ],
    "temperature": 0.3
  }'
```

### 3.2 Python

```python
import os
from openai import OpenAI

client = OpenAI(
    api_key=os.environ.get("MOONSHOT_API_KEY"),
    base_url="https://api.moonshot.cn/v1",
)

def chat(messages, model="moonshot-v1-8k", temperature=0.3):
    response = client.chat.completions.create(
        model=model,
        messages=messages,
        temperature=temperature,
    )
    return response.choices[0].message.content

# 测试
print(chat([
    {"role": "system", "content": "你是 Kimi，回答简洁准确。"},
    {"role": "user", "content": "用三句话介绍 Moonshot AI 公司。"},
]))
```

## 4. 超长上下文对话

### 4.1 128K 上下文窗口

```python
# 使用 128K 模型处理长文档
client = OpenAI(
    api_key=os.environ.get("MOONSHOT_API_KEY"),
    base_url="https://api.moonshot.cn/v1",
)

def summarize_long_article(article: str) -> str:
    """
    总结一篇长文章。
    128K tokens ≈ 40-50 万中文字符，可以一次性输入一整本书的部分章节。
    """
    response = client.chat.completions.create(
        model="moonshot-v1-128k",  # 使用 128K 模型
        messages=[
            {
                "role": "system",
                "content": "你是一个专业的文档分析助手。请对用户提供的文章进行结构化总结，包括：核心观点、关键论据、文章结构、值得关注的细节。",
            },
            {"role": "user", "content": f"请分析以下文章：\n\n{article}"},
        ],
        temperature=0.3,
        max_tokens=2000,
    )
    return response.choices[0].message.content

# 示例：处理一篇 10 万字的学术论文
with open("long_paper.txt", "r") as f:
    paper = f.read()

summary = summarize_long_article(paper)
print(summary)
```

### 4.2 长文档分块处理策略

当文档超出 128K 时，需要分块处理：

```python
def chunk_text(text: str, chunk_size: int = 100000) -> list[str]:
    """将文本按 chunk_size 字符分块（约 25K tokens）"""
    chunks = []
    start = 0
    while start < len(text):
        end = min(start + chunk_size, len(text))
        # 尽量在段落边界截断
        if end < len(text):
            # 回退到最近的段落分隔符
            for sep in ["\n\n", "\n", "。", "."]:
                pos = text.rfind(sep, start, end)
                if pos > start + chunk_size // 2:
                    end = pos + 1
                    break
        chunks.append(text[start:end])
        start = end
    return chunks

def summarize_long_text_in_chunks(text: str) -> str:
    """分块总结长文本"""
    chunks = chunk_text(text)

    # 第一阶段：逐块总结
    chunk_summaries = []
    for i, chunk in enumerate(chunks):
        print(f"处理第 {i+1}/{len(chunks)} 块...")
        response = client.chat.completions.create(
            model="moonshot-v1-128k",
            messages=[
                {"role": "system", "content": "请用一段话总结以下内容，保留关键数字和日期。"},
                {"role": "user", "content": chunk},
            ],
            temperature=0.1,
            max_tokens=500,
        )
        chunk_summaries.append(response.choices[0].message.content)

    # 第二阶段：合并总结
    all_summaries = "\n\n---\n\n".join(chunk_summaries)
    final_response = client.chat.completions.create(
        model="moonshot-v1-128k",
        messages=[
            {"role": "system", "content": "请对以下分段总结进行全局汇总，生成一个结构化的完整总结。"},
            {"role": "user", "content": all_summaries},
        ],
        temperature=0.3,
        max_tokens=1000,
    )
    return final_response.choices[0].message.content
```

## 5. 文件对话

Kimi 的核心优势之一是文件对话——上传 PDF、DOCX、PPT、图片等文件后直接基于文件内容提问。

### 5.1 上传文件

```python
# Kimi 文件 API 兼容 OpenAI Files API
from pathlib import Path

# 1. 上传文件
def upload_file(file_path: str) -> str:
    """上传文件到 Kimi，返回 file_id"""
    with open(file_path, "rb") as f:
        file_obj = client.files.create(
            file=f,
            purpose="file-extract",  # Kimi 使用 file-extract 而非 assistants
        )
    print(f"✅ 上传成功: {file_obj.filename} → {file_obj.id}")
    return file_obj.id

# 上传 PDF
file_id = upload_file("report.pdf")
```

### 5.2 基于文件对话

```python
def chat_with_file(file_id: str, question: str) -> str:
    """基于上传的文件进行对话"""
    response = client.chat.completions.create(
        model="moonshot-v1-128k",
        messages=[
            {
                "role": "system",
                "content": "你是 Kimi，一个文件分析助手。请基于提供的文件内容回答问题。",
            },
            {
                "role": "system",
                "content": file_id,  # Kimi 通过 system 消息传入 file_id
            },
            {"role": "user", "content": question},
        ],
        temperature=0.3,
    )
    return response.choices[0].message.content

# 示例：基于 PDF 提问
answer = chat_with_file(file_id, "这篇报告的三个核心结论是什么？")
print(answer)
```

### 5.3 多文件对话

```python
def chat_with_multiple_files(file_ids: list[str], question: str) -> str:
    """基于多个文件进行对话"""
    # 构建 messages
    messages = [
        {
            "role": "system",
            "content": "你是 Kimi。请基于以下文件内容，综合分析后回答问题。",
        },
    ]

    # 每个文件作为一个 system 消息
    for fid in file_ids:
        messages.append({"role": "system", "content": fid})

    messages.append({"role": "user", "content": question})

    response = client.chat.completions.create(
        model="moonshot-v1-128k",
        messages=messages,
        temperature=0.3,
    )
    return response.choices[0].message.content

# 上传多个文件
pdf_id = upload_file("annual_report.pdf")
docx_id = upload_file("meeting_notes.docx")

answer = chat_with_multiple_files(
    [pdf_id, docx_id],
    "对比年报和会议纪要，今年公司的主要战略调整有哪些？",
)
print(answer)
```

### 5.4 文件管理

```python
# 列出所有文件
files = client.files.list()
for f in files.data:
    print(f"{f.id}: {f.filename} ({f.bytes} bytes)")

# 获取文件详情
file_info = client.files.retrieve(file_id)
print(f"状态: {file_info.status}")

# 获取文件内容
content = client.files.content(file_id)
with open(f"downloaded_{file_info.filename}", "wb") as f:
    f.write(content.content)

# 删除文件
client.files.delete(file_id)
```

## 6. 联网搜索

```python
def chat_with_web_search(question: str) -> str:
    """带联网搜索的对话"""
    response = client.chat.completions.create(
        model="moonshot-v1-128k",
        messages=[
            {"role": "system", "content": "你是 Kimi。"},
            {"role": "user", "content": question},
        ],
        temperature=0.3,
        # Kimi 的联网搜索参数（需要在控制台开通）
        extra_body={
            "search": {
                "enabled": True,
            },
        },
    )
    return response.choices[0].message.content

# 示例：查询最新信息
answer = chat_with_web_search("2026年6月中国A股市场的主要指数表现如何？")
print(answer)
```

## 7. 流式输出

```python
def stream_chat(messages, model="moonshot-v1-8k"):
    """流式对话"""
    stream = client.chat.completions.create(
        model=model,
        messages=messages,
        temperature=0.7,
        stream=True,
    )

    full_response = ""
    for chunk in stream:
        if chunk.choices[0].delta.content:
            content = chunk.choices[0].delta.content
            print(content, end="", flush=True)
            full_response += content

    return full_response
```

## 8. Function Calling

Kimi 支持与 OpenAI 兼容的 Function Calling：

```python
tools = [
    {
        "type": "function",
        "function": {
            "name": "search_database",
            "description": "在公司内部数据库中搜索信息",
            "parameters": {
                "type": "object",
                "properties": {
                    "query": {"type": "string", "description": "搜索关键词"},
                    "department": {
                        "type": "string",
                        "enum": ["engineering", "marketing", "hr", "finance"],
                        "description": "部门",
                    },
                },
                "required": ["query"],
            },
        },
    }
]

response = client.chat.completions.create(
    model="moonshot-v1-128k",
    messages=[
        {"role": "user", "content": "查询工程部最新的技术方案文档"}
    ],
    tools=tools,
    tool_choice="auto",
)

if response.choices[0].message.tool_calls:
    print(f"🔧 调用: {response.choices[0].message.tool_calls[0].function.name}")
    # 执行工具...
```

## 9. Kimi vs DeepSeek 场景选择

| 场景 | 推荐 | 原因 |
|------|:---:|------|
| **长文档分析（>100页）** | Kimi | 原生 128K 上下文 + 文件对话 |
| **代码生成与推理** | DeepSeek V4 | 思考模式 + 代码训练优化 |
| **常规对话** | 两者皆可 | 质量相当，按成本选择 |
| **PDF/图片理解** | Kimi | 原生文件上传 + OCR |
| **联网搜索** | Kimi | 内置联网搜索 |
| **低延迟要求** | DeepSeek V3 | 响应速度较快 |
| **高并发生产** | DeepSeek | API 更成熟，稳定性更好 |

## 10. 最佳实践

| 实践 | 建议 |
|------|------|
| **文件处理** | 先用 `moonshot-v1-128k` 处理文件，再用 `moonshot-v1-8k` 做对话（兼顾效果与成本） |
| **长文档总结** | 分段总结 + 全局汇总的两阶段策略 |
| **上传文件大小** | 单个文件不超过 100MB，大文件建议先用代码提取文本 |
| **多文件关联** | 每个文件一个 system 消息传入 file_id |
| **联网搜索** | 仅在需要实时信息时启用，避免不必要的API开销 |
| **成本控制** | 128K 模型成本较高，对话轮次多时可用 `moonshot-v1-auto` 自动降级 |
