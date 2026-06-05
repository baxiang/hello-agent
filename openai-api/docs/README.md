# OpenAI Chat Completions API — 协议级深入理解

> 这不是"怎么用 OpenAI SDK"的教程，而是**深入理解 `POST v1/chat/completions` 协议本身**——请求格式、响应结构、流式 SSE 协议、Function Calling 底层机制、Token 计算原理。
>
> ADK-Go 的 `model.LLM` 接口、LangChain 的 `ChatModel`、OpenAI Agents SDK 的 `Agent.run()` ——所有这些框架的底层，都在与这个 API 协议对话。

## 文档目录

| # | 文档 | 说明 |
|---|------|------|
| 00 | [协议总览](./00-overview.md) | API 设计哲学、为什么它成为行业标准、与框架的关系 |
| 01 | [请求与响应格式](./01-request-response.md) | 端点、鉴权、Messages 结构、Choices、FinishReason、Usage |
| 02 | [流式协议 (SSE)](./02-streaming.md) | `stream: true`、SSE 协议格式、delta vs message、客户端解析 |
| 03 | [Function Calling 机制](./03-function-calling.md) | tools 声明、tool_choice、function call/response 回合、并行调用 |
| 04 | [Token 计算与计费](./04-token.md) | tiktoken、BPE 编码、context window、pricing、token 优化 |
| 05 | [多模态输入](./05-multimodal.md) | Vision API、image_url vs base64、audio 输入、video |
| 06 | [参数调优](./06-parameters.md) | temperature、top_p、max_tokens、seed、logprobs、stop |

## 为什么需要学这个

```
你调用的框架：
  ADK-Go    →  实现了 model.LLM 接口  →  底层 HTTP 调用
  LangChain →  实现了 ChatModel      →  底层 HTTP 调用
  OpenAI SDK →  client.chat.completions.create() → 底层 HTTP 调用
                                           ↓
                              POST https://api.openai.com/v1/chat/completions
                                           ↓
                              这才是真正的"协议层"
```

学会了这层协议，你就理解了所有框架的"底座"。切换框架只是换一层封装，底层的请求/响应格式不变。

## 学习路径

1. [01 请求与响应格式](./01-request-response.md) — 先看懂一个完整的请求和响应长什么样
2. [02 流式协议](./02-streaming.md) — 理解 SSE 是怎么逐 token 推送的
3. [03 Function Calling](./03-function-calling.md) — 理解工具调用背后的协议机制
4. [04 Token 计算](./04-token.md) — 理解成本、限制和优化
5. [05 多模态](./05-multimodal.md) — 图片、音频怎么传给 API
6. [06 参数调优](./06-parameters.md) — 控制输出质量的关键参数
