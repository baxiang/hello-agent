# OpenAI API 协议：从小白到精通

> 用最简单的 curl 调用，一步步理解大模型 API 的底层协议。
>
> 所有 Agent 框架（ADK-Go、LangChain、OpenAI Agents SDK）的底层，都在与这个协议对话。学会这层，切换框架只是换一层封装。

## 从哪开始

| 你的情况 | 起点章节 |
|---|---|
| 没调过大模型 API，想从零开始 | 入门基础 → [00 第一次调用](./getting-started/00-first-call.md) |
| 已经会基本调用，想深入协议 | 协议进阶 → [协议总览](./00-overview.md) |
| 想对比国产模型（DeepSeek/Kimi/Qwen）省成本 | 工程实践 → [DeepSeek V3/V4](./07-deepseek.md) |

## 文档目录

### 入门基础

零基础起步，每篇都用 curl 演示，不依赖任何 SDK。建立对 API 的直觉。

| # | 文档 | 说明 |
|---|------|------|
| 00 | [第一次调用：5 分钟跑通](./getting-started/00-first-call.md) | 最简 curl 请求逐行拆解、响应字段解读、3 个常见错误 |
| 01 | [messages 数组](./getting-started/01-messages-intro.md) | 聊天记录比喻、system/user/assistant 三角色、多轮对话 |
| 02 | [Token 计费单位](./getting-started/02-tokens.md) | token 是什么、usage 字段、与费用/速度/上限的关系 |
| 03 | [常用参数详解](./getting-started/03-core-params.md) | temperature、max_tokens、top_p、stop、n、stream、seed、response_format、penalty |

### 协议进阶

已建立直觉后，深入协议本身——messages 五角色、响应全字段、SSE 流式、Function Calling、多模态、参数全解。

| # | 文档 | 说明 |
|---|------|------|
| 00 | [协议总览](./00-overview.md) | API 设计哲学、行业标准地位、协议生命周期、与框架分层关系 |
| 01 | [Messages 消息系统](./01-messages.md) | 五种 Role（system/developer/user/assistant/tool）、content 格式、消息顺序规则 |
| 02 | [响应格式](./02-response.md) | 完整响应字段、choices/finish_reason/service_tier/usage/refusal |
| 03 | [流式协议 (SSE)](./03-streaming.md) | SSE chunk 格式、delta 类型、tool call 流式、reasoning 流式、错误处理 |
| 04 | [Function Calling 机制](./04-function-calling.md) | tools 声明、tool_choice、parallel_tool_calls、strict 模式、完整循环实现 |
| 05 | [多模态输入与输出](./05-multimodal.md) | Vision/Audio/File 输入、modalities/audio 输出参数、Token 估算 |
| 06 | [参数全解](./06-parameters.md) | 全部 25+ 参数逐一详解（含 reasoning_effort、prediction、store 等） |

### 工程实践

国产模型对比、成本与选型。

| # | 文档 | 说明 |
|---|------|------|
| 07 | [DeepSeek V3/V4](./07-deepseek.md) | |
| 08 | [Kimi 月之暗面](./08-kimi.md) | |
| 09 | [通义千问 Qwen](./09-qwen.md) | |

## 为什么需要学这层协议

学完入门 4 篇后，看这张图会豁然开朗——所有框架最终都在和同一个协议对话：

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

1. **入门**：[00 第一次调用](./getting-started/00-first-call.md) → [01 messages](./getting-started/01-messages-intro.md) → [02 token](./getting-started/02-tokens.md) → [03 参数](./getting-started/03-core-params.md)
2. **进阶**：[协议总览](./00-overview.md) → [Messages](./01-messages.md) → [响应格式](./02-response.md) → [流式](./03-streaming.md) → [Function Calling](./04-function-calling.md) → [多模态](./05-multimodal.md) → [参数全解](./06-parameters.md)
3. **实战**：[DeepSeek](./07-deepseek.md) → [Kimi](./08-kimi.md) → [Qwen](./09-qwen.md)
