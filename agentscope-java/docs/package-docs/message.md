# io.agentscope.core.message — 消息包文档

## 核心类型

- **`Msg`** — 不可变消息对象，包含角色、内容块和元数据。通过 Builder 创建：`Msg.builder().role(MsgRole.USER).content(block).build()`
- **`MsgRole`** — 枚举：`USER`、`ASSISTANT`、`SYSTEM`、`TOOL`

## ContentBlock 类型层次

`ContentBlock` 是 sealed 类层次结构，包含 7 种子类型：

```
ContentBlock (sealed)
  ├── TextBlock        — 纯文本内容
  ├── ThinkingBlock    — 思维链推理内容
  ├── ImageBlock       — 图片（URL 或 Base64）
  ├── AudioBlock       — 音频（URL 或 Base64）
  ├── VideoBlock       — 视频（URL 或 Base64）
  ├── ToolUseBlock     — 工具调用请求（id, name, input JSON）
  └── ToolResultBlock  — 工具执行结果（id, name, output ContentBlocks）
```

## JSON 序列化

所有类型使用 Jackson 注解进行多态序列化。`ContentBlock` 上的 `@JsonTypeInfo` 判别符使用 `"type"` 属性和类型特定名称（`"text"`、`"thinking"`、`"tool_use"` 等）。

## 结构化输出

`Msg` 支持通过元数据提取结构化数据：
- `msg.getStructuredData(Class<T>)` — 将元数据转为类型化 POJO/record
- `agent.call(msgs, MyOutput.class)` — 从 LLM 请求结构化输出

## 线程安全

`Msg` 和所有 `ContentBlock` 子类型**不可变**，可安全并发读取。

## 相关文档

- [核心包](../core.md)
