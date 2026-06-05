# OpenAI Chat Completions API — 协议级深入理解

> 本文档剖析 `POST v1/chat/completions` 协议本身——请求格式、响应结构、流式 SSE 协议、Function Calling 底层机制、Token 计算原理。
>
> ADK-Go 的 `model.LLM` 接口、LangChain 的 `ChatModel`、OpenAI Agents SDK 的 `Agent.run()` ——所有这些框架的底层，都在与这个 API 协议对话。

## 文档目录

| # | 文档 | 说明 |
|---|------|------|
| 00 | [协议总览](./00-overview.md) | API 设计哲学、行业标准地位、协议生命周期、与框架分层关系 |
| 01 | [Messages 消息系统](./01-messages.md) | 五种 Role（system/developer/user/assistant/tool）、content 格式、消息顺序规则 |
| 02 | [响应格式](./02-response.md) | 完整响应字段、choices/finish_reason/service_tier/usage/refusal |
| 03 | [流式协议 (SSE)](./03-streaming.md) | SSE chunk 格式、delta 类型、tool call 流式、reasoning 流式、错误处理 |
| 04 | [Function Calling 机制](./04-function-calling.md) | tools 声明、tool_choice、parallel_tool_calls、strict 模式、完整循环实现 |
| 05 | [多模态输入与输出](./05-multimodal.md) | Vision/Audio/File 输入、modalities/audio 输出参数、Token 估算 |
| 06 | [参数全解](./06-parameters.md) | 全部 25+ 参数逐一详解（含 reasoning_effort、prediction、store 等） |

## 为什么需要学这个

```
你调用的框架：
  ADK-Go    →  model.LLM.GenerateContent()  →  底层 HTTP 调用
  LangChain →  ChatModel.invoke()            →  底层 HTTP 调用
  OpenAI SDK → client.chat.completions.create() → 底层 HTTP 调用
                                                      ↓
                                  POST https://api.openai.com/v1/chat/completions
                                                      ↓
                                  这才是真正的"协议层"
```

学会了这层协议，切换框架只是换一层封装——底层的 `messages` 数组、`tools` 声明、`stream` 逻辑完全不变。

## 学习路径

1. [01 Messages 消息系统](./01-messages.md) — 先搞懂对话是怎么组织的
2. [02 响应格式](./02-response.md) — 再搞懂模型返回了什么
3. [03 流式协议](./03-streaming.md) — 理解逐 token 推送的机制
4. [04 Function Calling](./04-function-calling.md) — 理解工具调用背后的协议
5. [05 多模态](./05-multimodal.md) — 图片/音频/文件怎么传
6. [06 参数全解](./06-parameters.md) — 每个参数的作用和最佳实践
