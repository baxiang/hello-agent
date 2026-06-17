# 流式协议 (SSE)

> **进阶篇第四节。** [入门篇 03](./getting-started/03-core-params.md#stream-流式输出-高频) 你试过 `"stream": true`——字一个个冒出来。本节讲它背后的协议：SSE（Server-Sent Events）长什么样、delta 怎么拼接、`[DONE]` 怎么处理、流式中途断了怎么办。
>
> **本节你将学到**：SSE chunk 格式、delta 的几种类型（content / tool_calls / reasoning）、跨语言对比、错误恢复。
>
> **一句话比喻**：非流式像**寄包裹**（生成完一次性寄出），流式像**打电话**（边说边听）——首字延迟低，但你要会「边接边拼」。

## 1. 开启流式

```json
{
  "model": "gpt-4o",
  "messages": [{"role": "user", "content": "Tell me a story"}],
  "stream": true,
  "stream_options": {"include_usage": true}
}
```

响应头：

```http
Content-Type: text/event-stream
Cache-Control: no-cache
Connection: keep-alive
```

## 2. SSE 基础格式

```
data: {json}\n\n
```

每个 `data:` 行为一次推送，`\n\n` 双换行分隔。可选 `event:` 行指定事件类型（OpenAI 不使用，直接推 `data:`）。

### 一次完整流示例

```
data: {"id":"chatcmpl-xxx","object":"chat.completion.chunk","created":...,"model":"gpt-4o","choices":[{"index":0,"delta":{"role":"assistant","content":""},"finish_reason":null}]}

data: {"id":"chatcmpl-xxx","object":"chat.completion.chunk","created":...,"model":"gpt-4o","choices":[{"index":0,"delta":{"content":"Once"},"finish_reason":null}]}

data: {"id":"chatcmpl-xxx","object":"chat.completion.chunk","created":...,"model":"gpt-4o","choices":[{"index":0,"delta":{"content":" upon"},"finish_reason":null}]}

data: {"id":"chatcmpl-xxx","object":"chat.completion.chunk","created":...,"model":"gpt-4o","choices":[{"index":0,"delta":{"content":" a"},"finish_reason":null}]}

...（更多内容 token）...

data: {"id":"chatcmpl-xxx","object":"chat.completion.chunk","created":...,"model":"gpt-4o","choices":[{"index":0,"delta":{},"finish_reason":"stop"}],"usage":{"prompt_tokens":12,"completion_tokens":80,"total_tokens":92}}

data: [DONE]
```

## 3. Chunk 结构

每个 chunk 的 `object` 为 `"chat.completion.chunk"`，`choices[0]` 包含 `delta` 字段（而非完整的 `message`）：

### Delta 字段 vs Message 字段

| 非流式 choices[0].message | 流式 choices[0].delta | 说明 |
|--------------------------|----------------------|------|
| `.content` (string) | `.content` (string) | 逐 token 的增量文本 |
| `.role` | `.role` | 仅第一个 chunk 有 |
| `.tool_calls` (array) | `.tool_calls` (array) | 逐 chunk 填充 |
| `.refusal` | `.refusal` | 拒绝原因 |
| `.function_call` | `.function_call` | 旧版（弃用） |

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

只有 `role` 和空 `content`——告知客户端角色是 assistant。

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

每个内容 chunk 的 `delta.content` 是**增量文本**。客户端需拼接所有增量得到完整回复。

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
    "total_tokens": 92,
    "completion_tokens_details": {"reasoning_tokens": 0}
  }
}
```

- `finish_reason` 非 null
- `usage` 仅在 `stream_options.include_usage: true` 时出现
- `delta` 为空对象 `{}`

## 4. o 系列模型的 Reasoning 流式

o 系列模型（o3-mini、o4-mini）有推理 token，在流式中通过 `delta.reasoning_content` 推送：

```
data: {"choices":[{"delta":{"reasoning_content":"Let"},"finish_reason":null}]}

data: {"choices":[{"delta":{"reasoning_content":" me"},"finish_reason":null}]}

data: {"choices":[{"delta":{"reasoning_content":" think"},"finish_reason":null}]}

data: {"choices":[{"delta":{"content":"The answer is"},"finish_reason":null}]}
```

**解析规则**：
- `reasoning_content` 在 `content` 之前推送
- 两者不会在同一 chunk 中同时出现
- 合并时需分别累积 `reasoning_content` 和 `content`

## 5. Tool Call 流式

### 单个 tool call 流式

```
data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call_xxx","type":"function","function":{"name":"get_weather","arguments":""}}]}}]}

data: {"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":"{\"city"}}]}}]}

data: {"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":"\":\"Tokyo\"}"}}]}}]}

data: {"choices":[{"delta":{},"finish_reason":"tool_calls"}]}
```

**关键规则**：
- `id` 和 `function.name` 在 tool_call 的**第一个 chunk** 中出现
- `function.arguments` 是**增量 JSON 片段字符串**——逐 chunk 拼接再 `JSON.parse()`
- `index` 区分多个并行 tool call

### 并行 tool_calls 流式

```
data: {"choices":[{"delta":{"tool_calls":[
  {"index":0,"id":"call_1","type":"function","function":{"name":"get_weather","arguments":""}},
  {"index":1,"id":"call_2","type":"function","function":{"name":"get_time","arguments":""}}
]}}]}

data: {"choices":[{"delta":{"tool_calls":[
  {"index":0,"function":{"arguments":"{\"city\":\"Tokyo\"}"}},
  {"index":1,"function":{"arguments":"{\"timezone\":\"Asia/Tokyo\"}"}}
]}}]}

data: {"choices":[{"delta":{},"finish_reason":"tool_calls"}]}
```

两个 tool call 在同一 chunk 中交错推送。

### 解析实现

```python
tool_calls = {}  # index -> accumulated

for chunk in stream:
    delta = chunk["choices"][0]["delta"]

    if "tool_calls" in delta:
        for tc in delta["tool_calls"]:
            idx = tc["index"]

            if idx not in tool_calls:
                tool_calls[idx] = {
                    "id": "",
                    "type": "function",
                    "function": {"name": "", "arguments": ""},
                }

            tc_data = tool_calls[idx]
            if "id" in tc:
                tc_data["id"] += tc["id"]
            if "function" in tc:
                if "name" in tc["function"]:
                    tc_data["function"]["name"] += tc["function"]["name"]
                if "arguments" in tc["function"]:
                    tc_data["function"]["arguments"] += tc["function"]["arguments"]

# 完成后解析
for tc in tool_calls.values():
    tc["function"]["arguments_obj"] = json.loads(tc["function"]["arguments"])
```

## 6. Python 客户端实现

```python
import httpx, json

async def stream_chat(model: str, messages: list, api_key: str):
    full_content = ""
    reasoning = ""
    tool_calls = {}

    async with httpx.AsyncClient(timeout=120) as client:
        async with client.stream(
            "POST",
            "https://api.openai.com/v1/chat/completions",
            headers={
                "Authorization": f"Bearer {api_key}",
                "Content-Type": "application/json",
            },
            json={
                "model": model,
                "messages": messages,
                "stream": True,
                "stream_options": {"include_usage": True},
            },
        ) as response:
            response.raise_for_status()

            async for line in response.aiter_lines():
                if not line.startswith("data: "):
                    continue

                data = line[6:]
                if data == "[DONE]":
                    break

                chunk = json.loads(data)
                delta = chunk["choices"][0].get("delta", {})

                # 推理内容
                if "reasoning_content" in delta:
                    reasoning += delta["reasoning_content"]

                # 文本内容
                if "content" in delta and delta["content"]:
                    token = delta["content"]
                    full_content += token
                    print(token, end="", flush=True)

                # 工具调用
                if "tool_calls" in delta:
                    for tc in delta["tool_calls"]:
                        idx = tc["index"]
                        if idx not in tool_calls:
                            tool_calls[idx] = {"id": "", "name": "", "arguments": ""}
                        tool_calls[idx]["id"] += tc.get("id", "")
                        if "function" in tc:
                            tool_calls[idx]["name"] += tc["function"].get("name", "")
                            tool_calls[idx]["arguments"] += tc["function"].get("arguments", "")

    return {
        "content": full_content,
        "reasoning": reasoning,
        "tool_calls": tool_calls,
    }
```

## 7. 流式错误处理

### 连接中断

SSE 流可能在任何时候中断。客户端需实现：

```python
MAX_RETRIES = 3

for attempt in range(MAX_RETRIES):
    try:
        async for chunk in stream_response():
            yield chunk
        break  # 正常结束
    except (httpx.ReadError, ConnectionError) as e:
        if attempt == MAX_RETRIES - 1:
            raise
        # 指数退避
        await asyncio.sleep(2 ** attempt)
```

### 空 chunk

某些情况下可能收到 `delta` 为空对象 `{}` 或数据行内容为空——这是合法的，跳过即可。

### 心跳

非活跃期间流保持连接但无数据推送。客户端应设置合理超时：

```python
timeout = httpx.Timeout(120.0, read=60.0)
```

## 8. stream_options

```json
{
  "stream": true,
  "stream_options": {
    "include_usage": true
  }
}
```

`include_usage: true` 让流式最后一个 chunk 包含 `usage` 字段。**不设置时流式看不到 Token 用量**。

## 9. [DONE] 信号

```
data: [DONE]
```

不是 JSON——需特殊处理。**必须检查**：`if data == "[DONE]"`。

## 10. 流式协议对比

| 特征 | OpenAI | Anthropic | Gemini |
|------|--------|-----------|--------|
| 格式 | `data: {json}\n\n` | `event: type\ndata: {json}\n\n` | `data: {json}\n\n` |
| 文本 delta | `delta.content` | `content_block_delta.delta.text` | `candidates[0].content.parts[0].text` |
| tool call delta | `delta.tool_calls[].function.arguments` | `input_json_delta.partial_json` | `functionCall.args` |
| 推理 | `delta.reasoning_content` | `thinking_delta.thinking` | `thought` |
| 结束信号 | `data: [DONE]` | `event: message_stop` | `data: [DONE]` |
| usage 时机 | 最后一个 chunk（需 opt-in） | `message_delta` 事件 | 最后一个 chunk |

## 动手实验

1. **裸眼看 SSE**：用 `curl -N https://api.openai.com/v1/chat/completions ... -d '{"stream":true,...}'`，直接看终端一行行输出的 `data: {...}` 原始格式，不用任何解析库。
2. **拼接 delta**：写个 Python 脚本用 `requests` + `stream=True`，逐行读 `data:`，累加 `delta.content`，最后打印完整文本——体会「边收边拼」。
3. **拿 usage**：加 `stream_options: {"include_usage": true}`，找到 `data: [DONE]` 之前那个 `choices` 为空、`usage` 有值的 chunk。
4. **断流模拟**：在拼接脚本里读到一半 `break` 退出，看你会拿到半截文本——理解为什么生产代码要处理「流被中途打断」。
5. **流式 tool call**：参考 [Function Calling §9](./04-function-calling.md#_9-流式-function-calling)，跑一个流式工具调用，体验按 `index` 拼装 `arguments` 的复杂度。

## 接下来

- [Function Calling 机制](./04-function-calling.md) —— 流式下 tool_calls 怎么拼装的完整说明
- [多模态](./05-multimodal.md) —— 流式下音频输出的特殊处理
- [Token 计费](./getting-started/02-tokens.md) —— 流式下怎么拿 token 用量（`include_usage`）
