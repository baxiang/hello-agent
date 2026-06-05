# 多模态输入

OpenAI API 支持文本之外的多模态输入——图片、音频、视频。本章聚焦 `v1/chat/completions` 端点中的多模态消息格式。

## 1. Vision：图片输入

```json
{
  "model": "gpt-4o",
  "messages": [
    {
      "role": "user",
      "content": [
        {"type": "text", "text": "What is in this image?"},
        {
          "type": "image_url",
          "image_url": {
            "url": "https://example.com/photo.jpg",
            "detail": "auto"
          }
        }
      ]
    }
  ]
}
```

### image_url 参数

| 参数 | 说明 |
|------|------|
| `url` | 图片 URL（`https://...`）或 base64 编码（`data:image/jpeg;base64,...`） |
| `detail` | `"auto"`（默认）、`"low"`（512px）、`"high"`（细节模式） |

### Base64 方式

```python
import base64

def encode_image(path: str) -> str:
    with open(path, "rb") as f:
        return base64.b64encode(f.read()).decode("utf-8")

content = [
    {"type": "text", "text": "Describe this image"},
    {
        "type": "image_url",
        "image_url": {
            "url": f"data:image/jpeg;base64,{encode_image('photo.jpg')}",
            "detail": "high",
        },
    },
]
```

### detail 模式对比

| Detail | 处理方式 | Token 消耗 | 适用 |
|--------|---------|-----------|------|
| `auto` | 自动选择 | 自适应 | 通用 |
| `low` | 缩放至 512x512 | 85 tokens | 快速分类、缩略图 |
| `high` | 多 crop 拼接 | 详细：~170 tokens/crop | 文字识别、精细分析 |

## 2. 多图输入

```json
{
  "content": [
    {"type": "text", "text": "Compare these two images"},
    {
      "type": "image_url",
      "image_url": {"url": "https://example.com/before.jpg"}
    },
    {
      "type": "image_url",
      "image_url": {"url": "https://example.com/after.jpg"}
    }
  ]
}
```

每张图独立处理，Token 消耗累加。

## 3. Audio 输入

```json
{
  "model": "gpt-4o-audio-preview",
  "messages": [
    {
      "role": "user",
      "content": [
        {"type": "text", "text": "What is being said in this audio?"},
        {
          "type": "input_audio",
          "input_audio": {
            "data": "base64-encoded-audio-data...",
            "format": "wav"
          }
        }
      ]
    }
  ]
}
```

### Audio 参数

| 参数 | 说明 |
|------|------|
| `data` | Base64 编码的音频数据 |
| `format` | `"wav"` 或 `"mp3"` |

当前仅 `gpt-4o-audio-preview` 模型支持音频输入。

## 4. Video 输入

视频通过抽帧方式——上传关键帧作为图片序列：

```json
{
  "content": [
    {"type": "text", "text": "Describe what happens in this video"},
    {"type": "image_url", "image_url": {"url": "data:image/jpeg;base64,frame1..."}},
    {"type": "image_url", "image_url": {"url": "data:image/jpeg;base64,frame2..."}},
    {"type": "image_url", "image_url": {"url": "data:image/jpeg;base64,frame3..."}}
  ]
}
```

OpenAI 没有原生的 video 输入类型——视频处理是客户端层面的抽帧逻辑。

## 5. 文件输入

```json
{
  "content": [
    {"type": "text", "text": "Summarize this document"},
    {
      "type": "file",
      "file": {
        "file_id": "file-abc123",
        "filename": "report.pdf"
      }
    }
  ]
}
```

需要先通过 `v1/files` 端点上传文件获取 `file_id`。

## 6. 输出多模态

### 结构化输出 + 文本

```python
# 输出类型为普通文本（默认）
# 模型返回纯文本
```

### 图像生成（独立端点）

图像生成不走 `v1/chat/completions`，而是 `v1/images/generations`（DALL-E）：

```bash
curl https://api.openai.com/v1/images/generations \
  -H "Authorization: Bearer $KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "dall-e-3",
    "prompt": "A cat sitting on a cloud",
    "n": 1,
    "size": "1024x1024"
  }'
```

## 7. 在 ADK-Go 中的对应

```go
// genai 包定义了统一的多模态 Part 类型
type Part struct {
    Text       string
    InlineData *Blob  // 对应 base64 编码的图片/音频
    // ...
}

// 将 genai.Part 转为 OpenAI API 格式时：
// Text → {"type": "text", "text": ...}
// InlineData → {"type": "image_url", "image_url": {"url": "data:...;base64,..."}}
```

## 8. 多模态成本

图片按 detail 模式计费：

| Detail | Token 折算 |
|--------|-----------|
| `low` | 85 tokens/张 |
| `high` | 每 512px tile 约 170 tokens |

```python
def estimate_image_tokens(width: int, height: int, detail: str) -> int:
    if detail == "low":
        return 85
    # high 模式
    if width > 2048 or height > 2048:
        scale = 2048 / max(width, height)
        width, height = int(width * scale), int(height * scale)
    if min(width, height) > 768:
        scale = 768 / min(width, height)
        width, height = int(width * scale), int(height * scale)
    tiles_w = (width + 511) // 512
    tiles_h = (height + 511) // 512
    return 85 + 170 * tiles_w * tiles_h
```

## 9. 支持的图片格式

- PNG
- JPEG / JPG
- WEBP
- 非动画 GIF
- 最大 20MB/张
