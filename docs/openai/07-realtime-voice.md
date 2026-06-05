# 实时语音 Agent

OpenAI Agents SDK 原生支持 `gpt-realtime-2` 模型，通过 WebSocket 实现低延迟双向语音对话。不需要额外的语音管线（ASR/TTS），音频输入直接进模型，音频输出直接从模型出。

## 1. Realtime Agent 架构

```
客户端（浏览器/App）
    │  WebSocket（音频流）
    ▼
┌─────────────────────────────┐
│ RealtimeModel               │  ← gpt-realtime-2 模型
│   ├── 语音转文字（内置 ASR）    │
│   ├── 文字理解与推理            │
│   ├── 文字转语音（内置 TTS）    │
│   └── 工具调用                 │
└─────────┬───────────────────┘
          │ 工具结果
          ▼
     ┌─────────┐
     │ Tools   │  ← FunctionTool / MCP / Agent-as-Tool
     └─────────┘
```

## 2. 创建 Realtime Agent

```python
from agents import Agent
from agents.realtime import RealtimeModel

realtime_model = RealtimeModel(
    model="gpt-realtime-2",
    voice="alloy",        # alloy / echo / shimmer 等
    output_audio_format={
        "type": "pcm16",
        "rate": 24000,
    },
)

agent = Agent(
    name="voice_assistant",
    model=realtime_model,
    instructions="You are a helpful voice assistant. Keep answers concise.",
    tools=[get_weather],
)
```

## 3. 运行 Realtime 会话

```python
from agents.realtime import RealtimeRunner

runner = RealtimeRunner()

async with runner.connect(agent) as session:
    # session 提供 WebSocket 双向通信

    # 发送音频（PCM16 格式）
    audio_chunk = await microphone.read()  # 来自麦克风的 PCM 数据
    await session.send_audio(audio_chunk)

    # 接收音频
    async for event in session.stream_events():
        if event.type == "audio":
            speaker.play(event.data)  # 播放输出的音频
        elif event.type == "transcript":
            print(f"[User]: {event.data.input_transcript}")
            print(f"[Agent]: {event.data.output_transcript}")
```

## 4. 音频格式配置

### 输入格式

```python
RealtimeModel(
    input_audio_format={
        "type": "pcm16",  # PCM 16-bit
        "rate": 24000,    # 24kHz
    },
)
```

### 输出格式

```python
RealtimeModel(
    output_audio_format={
        "type": "pcm16",
        "rate": 24000,
    },
)

# 或使用默认
RealtimeModel(voice="alloy")  # 自动选择最佳格式
```

## 5. 语音选择

| Voice | 描述 |
|-------|------|
| `alloy` | 中性、平衡 |
| `echo` | 温暖、低沉 |
| `fable` | 英式、优雅 |
| `onyx` | 深沉、权威 |
| `nova` | 友好、活泼 |
| `shimmer` | 清晰、自信 |

## 6. Realtime 中的工具调用

Realtime Agent 支持所有标准工具——FunctionTool、MCP、Agent-as-Tool：

```python
from agents import function_tool

@function_tool
def get_weather(city: str) -> str:
    """语音调用获取天气"""
    return f"{city}: sunny, 22°C"

agent = Agent(
    name="weather_voice",
    model=RealtimeModel(voice="nova"),
    tools=[get_weather],
)
# 用户说 "What's the weather in Tokyo?" → Agent 自动调用 get_weather
```

## 7. Realtime Handoff

```python
from agents.realtime import RealtimeModel
from agents import Agent, handoff

support = Agent(name="support", model=RealtimeModel(voice="alloy"), ...)
billing = Agent(name="billing", model=RealtimeModel(voice="echo"), ...)

triage = Agent(
    name="triage",
    model=RealtimeModel(voice="nova"),
    handoffs=[support, billing],
)
```

Handoff 时语音自然切换——不同 Agent 可以有不同的 Voice。

## 8. 转录

```python
# 启用了转录的 RealtimeModel
model = RealtimeModel(
    voice="alloy",
    input_audio_transcription=True,   # 用户语音 → 文字
    output_audio_transcription=True,  # Agent 语音 → 文字
)

async for event in session.stream_events():
    if event.type == "input_transcript":
        print(f"[User said]: {event.data}")
    elif event.type == "output_transcript":
        print(f"[Agent said]: {event.data}")
```

## 9. 降噪与打断

```python
# 设置 VAD（Voice Activity Detection）参数
RealtimeModel(
    turn_detection={
        "type": "server_vad",
        "threshold": 0.5,           # 语音检测阈值
        "prefix_padding_ms": 300,   # 开始前保留的静音
        "silence_duration_ms": 500, # 多长静音算结束
    },
)
```

用户打断（interruption）：
- 用户在 Agent 说话时开始说话 → Agent 自动停止
- SDK 发送 `response.cancel` 事件
- 工具调用如果还在执行则继续（不会中途取消）

## 10. Voice Pipeline（高级抽象）

Realtime 是低层 WebSocket API，Voice Pipeline 是更高层的抽象：

```python
from agents.voice import VoicePipeline, VoicePipelineConfig
from agents.voice.models import OpenAILLMModel, OpenAITTModel
from agents import Agent

agent = Agent(name="assistant", model="gpt-4o", ...)

pipeline = VoicePipeline(
    agent=agent,
    config=VoicePipelineConfig(
        tts_model=OpenAITTModel(voice="alloy"),
        stt_model=OpenAISttModel(),
    ),
)
```

Voice Pipeline 自动处理：音频输入 → STT → Agent → TTS → 音频输出。

## 11. 常见问题

**Q：Realtime 和 Voice Pipeline 选哪个？**

A：Realtime 延迟更低（单模型 ASR+推理+TTS），适合实时对话。Voice Pipeline 更灵活（可替换 ASR/TTS 模型），适合质量优先的场景。

**Q：Realtime Agent 支持哪些语言？**

A：gpt-realtime-2 支持多语言自动识别和生成，不需要额外配置。

**Q：Realtime 模式下工具调用有延迟吗？**

A：工具调用在后台执行，Agent 可以继续说话或等待。这由 SDK 的内部并发调度处理。
