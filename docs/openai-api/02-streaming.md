# 流式协议 (SSE)

## 1. 开启流式

只需在请求中加 `"stream": true`：

```json
{
  "model": "gpt-4o",
  "messages": [{"role": "user", "content": "Tell me a story"}],
  "stream": true
}
```

HTTP 响应头变为：

```http
Content-Type: text/event-stream
Transfer-Encoding: chunked
```

## 2. SSE 协议格式

Server-Sent Events 的基本格式：

```
data: {json}\n\n
```

每个 `data:` 行是一次推送，`\n\n` 双换行分隔事件。可选地还有 `event:` 行指定事件类型。

### 示例：一次完整的流式响应

```
data: {"id":"chatcmpl-xxx","object":"chat.completion.chunk","created":1718236800,"model":"gpt-4o","choices":[{"index":0,"delta":{"role":"assistant","content":""},"finish_reason":null}]}

data: {"id":"chatcmpl-xxx","object":"chat.completion.chunk","created":1718236800,"model":"gpt-4o","choices":[{"index":0,"delta":{"content":"Once"},"finish_reason":null}]}

data: {"id":"chatcmpl-xxx","object":"chat.completion.chunk","created":1718236800,"model":"gpt-4o","choices":[{"index":0,"delta":{"content":" upon"},"finish_reason":null}]}

data: {"id":"chatcmpl-xxx","object":"chat.completion.chunk","created":1718236800,"model":"gpt-4o","choices":[{"index":0,"delta":{"content":" a"},"finish_reason":null}]}

...（更多 token）...

data: {"id":"chatcmpl-xxx","object":"chat.completion.chunk","created":1718236800,"model":"gpt-4o","choices":[{"index":0,"delta":{},"finish_reason":"stop"}],"usage":{"prompt_tokens":12,"completion_tokens":80,"total_tokens":92}}

data: [DONE]
```

## 3. Chunk 结构 vs 完整响应

非流式响应的 `message` 字段在流式中变为 `delta`：

| 非流式 | 流式 | 说明 |
|--------|------|------|
| `.choices[0].message.content` | `.choices[0].delta.content` | 逐 token 累积 |
| `.choices[0].message.tool_calls` | `.choices[0].delta.tool_calls` | 工具调用逐步填充 |
| `.choices[0].finish_reason` | `.choices[0].finish_reason` | 最后一个 chunk 才有值 |

### 第一个 chunk

```json
{
  "choices": [{
    "index": 0,
    "delta": {"role": "assistant", "content": ""},
    "finish_reason": null
  }]
}
```

第一个 chunk 的 `delta.role` = `"assistant"`，`content` 为空字符串——只是告诉客户端"角色是 assistant"。

### 内容 chunk

```json
{
  "choices": [{
    "index": 0,
    "delta": {"content": " world"},
    "finish_reason": null
  }]
}
```

每个内容 chunk 包含当前 token 的新增文本。客户端需要**拼接**所有 `delta.content`。

### 最后一个 chunk

```json
{
  "choices": [{
    "index": 0,
    "delta": {},
    "finish_reason": "stop"
  }],
  "usage": {
    "prompt_tokens": 12,
    "completion_tokens": 80,
    "total_tokens": 92
  }
}
```

`finish_reason` 非 null + `usage` 信息（仅 stream_options 开启时）。

## 4. 客户端解析实现

### Python 原始实现（理解原理）

```python
import httpx
import json

async def stream_chat(model: str, messages: list, api_key: str):
    """从零实现流式请求——不对接任何 SDK"""
    client = httpx.AsyncClient(timeout=60)

    async with client.stream(
        "POST",
        "https://api.openai.com/v1/chat/completions",
        headers={
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json",
            "Accept": "text/event-stream",
        },
        json={
            "model": model,
            "messages": messages,
            "stream": True,
        },
    ) as response:
        full_content = ""

        async for line in response.aiter_lines():
            if not line.startswith("data: "):
                continue

            data_str = line[6:]  # 去掉 "data: " 前缀

            if data_str == "[DONE]":
                break

            chunk = json.loads(data_str)
            delta = chunk["choices"][0]["delta"]

            if "content" in delta:
                token = delta["content"]
                full_content += token
                print(token, end="", flush=True)  # 实时输出

    return full_content
```

### Go 实现（ADK-Go 参考）

```go
func (m *DeepSeekModel) generateStream(ctx context.Context, req *model.LLMRequest) iter.Seq2[*model.LLMResponse, error] {
    return func(yield func(*model.LLMResponse, error) bool) {
        resp, _ := http.DefaultClient.Do(httpReq)
        defer resp.Body.Close()

        scanner := bufio.NewScanner(resp.Body)
        var fullContent string

        for scanner.Scan() {
            line := scanner.Text()
            if !strings.HasPrefix(line, "data: ") {
                continue
            }
            dataStr := strings.TrimPrefix(line, "data: ")
            if dataStr == "[DONE]" {
                break
            }

            var chunk chatChunk
            json.Unmarshal([]byte(dataStr), &chunk)
            delta := chunk.Choices[0].Delta

            fullContent += delta.Content
            yield(&model.LLMResponse{
                Content: &genai.Content{
                    Role: "model",
                    Parts: []*genai.Part{{Text: delta.Content}},
                },
                Partial: true,  // 标记为部分响应
            }, nil)
        }

        // 最后一个完整响应
        yield(&model.LLMResponse{
            Content: &genai.Content{
                Role: "model",
                Parts: []*genai.Part{{Text: fullContent}},
            },
            Partial: false,
            TurnComplete: true,
        }, nil)
    }
}
```

## 5. 流式 Function Calling

工具调用在流式模式下的特殊处理：

```
data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call_xxx","type":"function","function":{"name":"get_weather","arguments":""}}]}}]}

data: {"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":"{\""}}]}}]}

data: {"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":"city"}}]}}]}

data: {"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":"\":\""}}]}}]}

data: {"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":"Tokyo"}}]}}]}

data: {"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":"\"}"}}]}}]}

data: {"choices":[{"finish_reason":"tool_calls"}]}
```

要点：
- `tool_calls` 的 `id` 和 `function.name` 在第一个 chunk 中出现
- `function.arguments` 是一个**JSON 字符串片段**，需要逐 chunk 拼接
- 拼接完成后再 `JSON.parse()` 得到完整参数对象
- `index` 用于区分多个并行 tool call

### 解析 tool_calls 的代码

```python
tool_calls = {}  # index -> accumulated

async for line in stream:
    chunk = json.loads(line)
    delta = chunk["choices"][0]["delta"]

    if "tool_calls" in delta:
        for tc in delta["tool_calls"]:
            idx = tc["index"]
            if idx not in tool_calls:
                tool_calls[idx] = {
                    "id": tc.get("id", ""),
                    "type": "function",
                    "function": {"name": "", "arguments": ""},
                }
            if "id" in tc:
                tool_calls[idx]["id"] = tc["id"]
            if "function" in tc:
                if "name" in tc["function"]:
                    tool_calls[idx]["function"]["name"] += tc["function"]["name"]
                if "arguments" in tc["function"]:
                    tool_calls[idx]["function"]["arguments"] += tc["function"]["arguments"]
```

## 6. stream_options

```json
{
  "stream": true,
  "stream_options": {
    "include_usage": true
  }
}
```

设置 `include_usage: true` 后，流式最后一个 chunk 会包含 `usage` 字段（否则流式模式下看不到 token 用量）。

## 7. 两种流式与框架对应

| 方式 | 协议 | 框架层如何用 |
|------|------|-------------|
| OpenAI SSE | `data: {json}\n\n` | ADK-Go `iter.Seq2` 迭代器、Python `AsyncGenerator` |
| Gemini SSE | `data: {json}\n\n`（格式不同）| 同上 |
| Anthropic SSE | `event: content_block_delta\ndata: {json}\n\n` | SSE event 字段区分类型 |
| Ollama | NDJSON（每行一个 JSON） | 逐行解析 |

底层协议略有不同，但框架通过 `model.LLM` 接口已为你封装了这些差异。

## 8. [DONE] 信号

流式结束标志是一行：

```
data: [DONE]
```

**不是 JSON**——解析时需特殊处理。所有兼容 OpenAI SSE 的 API 都遵循这个约定。
