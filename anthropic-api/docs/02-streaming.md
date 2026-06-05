# 流式协议 (SSE)

Anthropic 的 SSE 格式比 OpenAI 更结构化——每个事件有明确的 `event:` 类型行。

## 1. 开启流式

```json
{
  "model": "claude-sonnet-4-20250514",
  "max_tokens": 1000,
  "messages": [{"role": "user", "content": "Tell me a story"}],
  "stream": true
}
```

## 2. SSE 格式

```
event: message_start
data: {"type": "message_start", "message": {...}}

event: content_block_start
data: {"type": "content_block_start", "index": 0, "content_block": {"type": "text", "text": ""}}

event: content_block_delta
data: {"type": "content_block_delta", "index": 0, "delta": {"type": "text_delta", "text": "Once"}}

event: content_block_delta
data: {"type": "content_block_delta", "index": 0, "delta": {"type": "text_delta", "text": " upon"}}

event: content_block_delta
data: {"type": "content_block_delta", "index": 0, "delta": {"type": "text_delta", "text": " a"}}

...（更多 delta）...

event: content_block_stop
data: {"type": "content_block_stop", "index": 0}

event: message_delta
data: {"type": "message_delta", "delta": {"stop_reason": "end_turn"}, "usage": {"output_tokens": 80}}

event: message_stop
data: {"type": "message_stop"}
```

## 3. 事件类型详解

| Event | 触发时机 | data 内容 |
|-------|---------|-----------|
| `message_start` | 流开始 | 完整 message 对象（content 为空） |
| `content_block_start` | 一个新 block 开始 | block 原型（text 为空，tool_use 有 name） |
| `content_block_delta` | block 内容更新 | delta 对象（text_delta / input_json_delta） |
| `content_block_stop` | block 结束 | index |
| `message_delta` | 消息级别的更新 | stop_reason、usage |
| `message_stop` | 整个消息结束 | 空 |
| `ping` | 心跳 | 空（保持连接） |

## 4. 文本流式解析

```python
import json

async def parse_text_stream(response):
    """从 Anthropic SSE 流中提取完整文本"""
    content_blocks = {}  # index -> accumulated text

    async for line in response.aiter_lines():
        if not line.startswith("data: "):
            continue

        data = json.loads(line[6:])
        event_type = data.get("type")

        if event_type == "content_block_start":
            idx = data["index"]
            if data["content_block"]["type"] == "text":
                content_blocks[idx] = ""

        elif event_type == "content_block_delta":
            idx = data["index"]
            delta = data["delta"]
            if delta["type"] == "text_delta":
                content_blocks[idx] += delta["text"]
                print(delta["text"], end="", flush=True)

        elif event_type == "message_delta":
            stop_reason = data["delta"]["stop_reason"]
            usage = data.get("usage", {})

    return "".join(content_blocks.values())
```

## 5. Tool Use 流式

工具调用在流式中的格式：

```
event: content_block_start
data: {"type":"content_block_start","index":1,"content_block":{"type":"tool_use","id":"toolu_01Xxx","name":"get_weather","input":{}}}

event: content_block_delta
data: {"type":"content_block_delta","index":1,"delta":{"type":"input_json_delta","partial_json":"{\"city"}}

event: content_block_delta
data: {"type":"content_block_delta","index":1,"delta":{"type":"input_json_delta","partial_json":"\":\""}}

event: content_block_delta
data: {"type":"content_block_delta","index":1,"delta":{"type":"input_json_delta","partial_json":"Tokyo\"}"}}

event: content_block_stop
data: {"type":"content_block_stop","index":1}
```

`input_json_delta` 是**增量 JSON 片段**——需要拼接所有 `partial_json` 后 `JSON.parse()` 得到完整参数。

### Tool Use 流式解析

```python
tool_use_blocks = {}  # index -> {id, name, partial_json}

# content_block_start 时记录 id 和 name
if data["content_block"]["type"] == "tool_use":
    block = data["content_block"]
    tool_use_blocks[idx] = {
        "id": block["id"],
        "name": block["name"],
        "partial_json": "",
    }

# content_block_delta 时累积 partial_json
if delta["type"] == "input_json_delta":
    tool_use_blocks[idx]["partial_json"] += delta["partial_json"]

# content_block_stop 时完成
tool_input = json.loads(tool_use_blocks[idx]["partial_json"])
```

## 6. 在 ADK-Go 中的对应

```go
// ADK-Go 的流式抽象统一了 OpenAI 和 Anthropic 的差异
// 底层：Anthropic 有 event 类型行，OpenAI 没有
// ADK-Go 内部将两种格式统一为 iter.Seq2[*LLMResponse, error]

func (m *ClaudeModel) generateStream(...) iter.Seq2[*model.LLMResponse, error] {
    return func(yield func(*model.LLMResponse, error) bool) {
        scanner := bufio.NewScanner(resp.Body)
        var fullContent string

        for scanner.Scan() {
            line := scanner.Text()

            // Anthropic 特有：跳过 event: 行，只处理 data: 行
            if !strings.HasPrefix(line, "data: ") {
                continue
            }

            var event map[string]any
            json.Unmarshal([]byte(line[6:]), &event)

            switch event["type"] {
            case "content_block_delta":
                delta := event["delta"].(map[string]any)
                if text, ok := delta["text"].(string); ok {
                    fullContent += text
                    yield(&model.LLMResponse{
                        Content: genai.NewContentFromText(text, "model"),
                        Partial: true,
                    }, nil)
                }
            case "message_stop":
                yield(&model.LLMResponse{
                    Content: genai.NewContentFromText(fullContent, "model"),
                    Partial: false,
                    TurnComplete: true,
                }, nil)
            }
        }
    }
}
```

## 7. vs OpenAI SSE 的关键差异

| 维度 | OpenAI | Anthropic |
|------|--------|-----------|
| 事件标识 | 无 `event:` 行 | 有 `event:` 行（message_start/delta/stop 等） |
| 内容推送 | `choices[0].delta.content` (string) | `content_block_delta.delta.text` (需索引管理) |
| 工具调用 | `choices[0].delta.tool_calls[0].function.arguments` | `content_block_delta.delta.input_json_delta.partial_json` |
| 结束信号 | `data: [DONE]` | `event: message_stop` |
| 心跳 | 无 | `event: ping`（长时间无输出时） |
| Usage 时机 | 最后一个 chunk（需 `stream_options`） | `message_delta` 事件中 |

## 8. ping 心跳

Anthropic 在长时间运行时发送 `ping` 保持连接：

```
event: ping
data: {}
```

客户端应忽略 ping 事件，但连接管理需要处理它。

## 9. 错误事件

```
event: error
data: {"type": "error", "error": {"type": "overloaded_error", "message": "..."}}
```

错误在流中间出现时，`event:` 为 `error`。客户端应中断并重试。
