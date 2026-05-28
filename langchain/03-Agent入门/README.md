# 03-Agent入门

本章介绍 LangChain Agent 的基础概念，从工具定义到完整实战项目。

## 学习目标

- 理解工具系统（@tool 装饰器、ToolRuntime 上下文）
- 掌握 Agent 构建（create_agent、动态模型/工具）
- 理解 ReAct 循环机制和流式追踪
- 学会配置系统提示词（静态、多模态、动态）
- 实现结构化输出（ToolStrategy、ProviderStrategy）
- 管理 Agent 内存（短期记忆、长期存储）
- 构建完整的实战项目

## 章节内容

| 序号 | 标题 | 内容 |
|------|------|------|
| 01 | 工具定义 | @tool 装饰器、自定义名称/描述、Pydantic args_schema、JSON Schema、保留参数名 |
| 02 | 工具上下文 | ToolRuntime：state 访问/更新、context、store、stream_writer、execution_info、server_info |
| 03 | 创建 Agent | create_agent、静态/动态模型、静态/动态工具、模型标识符字符串 |
| 04 | 系统提示词 | 字符串提示词、SystemMessage 多模态/缓存、动态提示词 @dynamic_prompt |
| 05 | ReAct 循环 | Reasoning+Acting 模式、工具执行流程、并行调用、错误处理 |
| 06 | 结构化输出 | ToolStrategy、ProviderStrategy、Union 类型、错误处理、自定义工具消息 |
| 07 | 内存管理 | AgentState、自定义状态/middleware/state_schema、短期记忆模式 |
| 08 | Agent 实战 | 完整实战项目：研究助手（搜索、计算、笔记、结构化输出） |

## 示例项目

`agent_basics/` - 单工具 Agent 示例

## 学习路径

```
工具定义 → 工具上下文 → 创建 Agent → 系统提示词
                                      ↓
                          ReAct 循环 → 结构化输出
                                      ↓
                              内存管理 → Agent 实战
```
