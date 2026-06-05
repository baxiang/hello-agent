# 多模态输入与输出

OpenAI API 在 `v1/chat/completions` 中统一支持文本、图片、音频的输入和输出。

## 1. Vision：图片输入

```json
{
  "model": "gpt-4o",
  "messages": [{
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
  }]
}
```

### image_url 参数

| 参数 | 必填 | 说明 |
|------|------|------|
| `url` | ✅ | HTTPS URL 或 `data:image/...;base64,...` |
| `detail` | ❌ | `auto`（默认）/ `low` / `high` |

### Base64 编码

```python
import base64

with open("photo.jpg", "rb") as f:
    b64 = base64.b64encode(f.read()).decode()

content = [{
    "type": "image_url",
    "image_url": {"url": f"data:image/jpeg;base64,{b64}", "detail": "high"}
}]
```

### detail 模式

| Detail | 处理 | Token | 适用 |
|--------|------|-------|------|
| `auto` | 自动判断 | 自适应 | 通用 |
| `low` | 压缩至 512x512 | 85 tokens | 分类、快速识别 |
| `high` | 多 tile 拼接 | 85 + 170×tiles | 文字识别、精细分析 |

### Token 估算（high 模式）

```python
def estimate_image_tokens(w: int, h: int) -> int:
    # 缩放至 fit 2048x2048
    if w > 2048 or h > 2048:
        scale = 2048 / max(w, h)
        w, h = int(w * scale), int(h * scale)
    # 短边缩放至 fit 768
    if min(w, h) > 768:
        scale = 768 / min(w, h)
        w, h = int(w * scale), int(h * scale)
    tiles = ((w + 511) // 512) * ((h + 511) // 512)
    return 85 + 170 * tiles
```

### 支持的图片格式

PNG、JPEG/JPG、WEBP、非动画 GIF。最大 20MB/张，最多 2048x2048 像素后缩放。

### 模型支持

`gpt-4o`、`gpt-4o-mini`、`gpt-4-turbo`、`o1`——所有 vision 模型。`o1` 不支持 `detail` 参数。

## 2. Audio 输入

```json
{
  "model": "gpt-4o-audio-preview",
  "messages": [{
    "role": "user",
    "content": [
      {"type": "text", "text": "What is being said?"},
      {
        "type": "input_audio",
        "input_audio": {
          "data": "base64-audio-data...",
          "format": "wav"
        }
      }
    ]
  }]
}
```

| 参数 | 说明 |
|------|------|
| `data` | Base64 编码音频 |
| `format` | `wav` 或 `mp3` |

仅 `gpt-4o-audio-preview` 支持。

## 3. Audio 输出

请求输出音频时需设置 `modalities` 和 `audio` 参数：

```json
{
  "model": "gpt-4o-audio-preview",
  "modalities": ["text", "audio"],
  "audio": {
    "voice": "alloy",
    "format": "wav"
  },
  "messages": [{"role": "user", "content": "Tell me about AI"}]
}
```

### audio 参数

| 参数 | 说明 |
|------|------|
| `voice` | `alloy` / `echo` / `fable` / `onyx` / `nova` / `shimmer` |
| `format` | `wav` / `mp3` / `flac` / `opus` / `pcm16` |

响应中包含 `audio` 字段：

```json
{
  "message": {
    "role": "assistant",
    "audio": {
      "id": "audio_abc123",
      "data": "base64-audio-data...",
      "expires_at": 1718323200,
      "transcript": "AI stands for Artificial Intelligence..."
    }
  }
}
```

`audio.data` 是 base64 编码的音频——客户端需解码后播放。

## 4. 文件输入

```json
{
  "role": "user",
  "content": [
    {"type": "text", "text": "Summarize this document"},
    {"type": "file", "file": {"file_id": "file-abc123"}}
  ]
}
```

### 上传文件

```bash
curl https://api.openai.com/v1/files \
  -H "Authorization: Bearer $KEY" \
  -F "purpose=assistants" \
  -F "file=@report.pdf"
```

响应返回 `file_id`。支持 PDF、DOCX、PPTX、TXT、MD、代码文件。

## 5. Image Generation（独立端点）

图像生成不走 `v1/chat/completions`，而是 `POST v1/images/generations`（DALL-E）：

```bash
curl https://api.openai.com/v1/images/generations \
  -H "Authorization: Bearer $KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "dall-e-3",
    "prompt": "A cat on a cloud",
    "n": 1,
    "size": "1024x1024",
    "quality": "standard"
  }'
```

## 6. Vision + Function Calling 组合

```json
{
  "model": "gpt-4o",
  "messages": [{
    "role": "user",
    "content": [
      {"type": "text", "text": "Extract the text from this receipt"},
      {"type": "image_url", "image_url": {"url": "data:image/jpeg;base64,..."}}
    ]
  }],
  "tools": [{
    "type": "function",
    "function": {
      "name": "create_expense",
      "description": "Create an expense record",
      "parameters": {
        "type": "object",
        "properties": {
          "amount": {"type": "number"},
          "vendor": {"type": "string"},
          "date": {"type": "string"}
        },
        "required": ["amount", "vendor"]
      }
    }
  }],
  "tool_choice": "required"
}
```

模型先分析图片提取文字，然后调用 `create_expense` 结构化输出。

## 7. Modalities 参数（输出控制）

```json
{
  "modalities": ["text"]           // 仅文本（默认）
  "modalities": ["text", "audio"]  // 文本 + 音频
}
```

仅 `gpt-4o-audio-preview` 支持 `audio`。其他模型忽略此参数。

## 8. 多模态成本

### 图片

| Detail | 每张 Token | 每张成本 (gpt-4o) |
|--------|-----------|-------------------|
| `low` | 85 | $0.00021 |
| `high` (1 tile) | 255 | $0.00064 |
| `high` (4 tiles) | 765 | $0.0019 |
| `high` (9 tiles) | 1615 | $0.0040 |

### 音频

| 模型 | 输入 | 输出 |
|------|------|------|
| gpt-4o-audio-preview | $40/MTok | $80/MTok |

音频按音频 token 计费，约为文本 token 的 16 倍。

## 9. 支持的模型速查

| 模型 | 文本 | 图片输入 | 音频输入 | 音频输出 |
|------|------|---------|---------|---------|
| gpt-4o | ✅ | ✅ | ❌ | ❌ |
| gpt-4o-mini | ✅ | ✅ | ❌ | ❌ |
| gpt-4-turbo | ✅ | ✅ | ❌ | ❌ |
| gpt-4o-audio-preview | ✅ | ❌ | ✅ | ✅ |
| o1 / o3-mini | ✅ | ✅ | ❌ | ❌ |
| o4-mini | ✅ | ✅ | ❌ | ❌ |
| gpt-4.1 | ✅ | ✅ | ❌ | ❌ |
