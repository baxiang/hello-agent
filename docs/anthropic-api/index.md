# Anthropic Messages API — 协议级深入理解

> Anthropic Messages API（`POST v1/messages`）是 Claude 模型的原生协议。与 OpenAI Chat Completions API 有相似的目标但设计哲学不同——Anthropic 追求更强的可控性和安全性。

## 文档目录

| # | 文档 | 说明 |
|---|------|------|
| 00 | [协议总览](./00-overview.md) | Anthropic vs OpenAI 协议对比、设计哲学、版本体系 |
| 01 | [Messages API 格式](./01-messages.md) | 端点、鉴权、system prompt、messages/content 结构 |
| 02 | [流式协议 (SSE)](./02-streaming.md) | event 类型、content_block_delta、message_delta |
| 03 | [Tool Use 机制](./03-tool-use.md) | tool_use block、tool_result、并行工具调用 |
| 04 | [内容块 (Content Blocks)](./04-content-blocks.md) | text/image/tool_use/tool_result/thinking 块详解 |
| 05 | [扩展思考 (Extended Thinking)](./05-extended-thinking.md) | thinking block、budget_tokens、签名验证 |
| 06 | [参数调优](./06-parameters.md) | max_tokens(必填)、temperature、stop_sequences、top_k/top_p |

## OpenAI vs Anthropic 协议速查

| 维度 | OpenAI | Anthropic |
|------|--------|-----------|
| 端点 | `/v1/chat/completions` | `/v1/messages` |
| 鉴权 | `Authorization: Bearer` | `x-api-key` |
| System prompt | `messages[0].role="system"` | 顶层 `system` 字段 |
| 响应格式 | `choices[0].message.content` (string) | `content[0].text` (block array) |
| max_tokens | 可选 | **必填** |
| 工具调用 | `tool_calls` JSON 数组 | `tool_use` content block |
| 流式格式 | `data: {json}\n\n` | `event: xxx\ndata: {json}\n\n` |
| 思考/推理 | o 系列模型 | Extended Thinking（可见思考过程） |
| API 版本 | 无版本号 | `anthropic-version: 2023-06-01` |

## 学习路径

1. [00 协议总览](./00-overview.md) → 理解 Anthropic 协议与 OpenAI 的关键差异
2. [01 Messages API](./01-messages.md) → 从第一个请求开始
3. [04 内容块](./04-content-blocks.md) → 理解 Anthropic 最独特的数据结构
4. [03 Tool Use](./03-tool-use.md) → 工具调用协议
5. [02 流式协议](./02-streaming.md) → 流式输出格式
6. [05 扩展思考](./05-extended-thinking.md) → Claude 独有的推理能力
7. [06 参数调优](./06-parameters.md) → 参数实践
