# 01-LangChain入门

> LangChain 是最流行的 LLM 应用开发框架，本章带你快速入门核心概念

## 本章概览

```
┌─────────────────────────────────────────────────────────────────┐
│                     LangChain 核心概念                            │
│                                                                 │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐          │
│  │ 01 模型基础   │  │ 02 消息系统   │  │ 03 流式与批量 │          │
│  │              │  │              │  │              │          │
│  │ init_chat_   │  │ HumanMessage │  │ stream()     │          │
│  │ model()      │  │ AIMessage    │  │ batch()      │          │
│  │ invoke()     │  │ SystemMessage│  │ astream_     │          │
│  │              │  │ ToolMessage  │  │ events()     │          │
│  └──────────────┘  └──────────────┘  └──────────────┘          │
│                                                                 │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐          │
│  │ 04 工具调用   │  │ 05 结构化输出 │  │ 06 提示工程   │          │
│  │              │  │              │  │              │          │
│  │ @tool        │  │ Pydantic     │  │ System Prompt│          │
│  │ bind_tools() │  │ TypedDict    │  │ Templates    │          │
│  │ tool_choice  │  │ JSON Schema  │  │ 多模态提示    │          │
│  │              │  │              │  │ 缓存优化      │          │
│  └──────────────┘  └──────────────┘  └──────────────┘          │
│                                                                 │
│                     ┌──────────────┐                            │
│                     │ 07 入门实战   │                            │
│                     │              │                            │
│                     │ 智能代码助手  │                            │
│                     │ 综合运用全部  │                            │
│                     │ 核心概念      │                            │
│                     └──────────────┘                            │
└─────────────────────────────────────────────────────────────────┘
```

## 学习目标

- 理解 LangChain 统一模型接口 (`init_chat_model`)
- 掌握消息系统 (HumanMessage/AIMessage/SystemMessage/ToolMessage)
- 学会流式输出和批量调用
- 掌握工具调用和结构化输出
- 能够编写高效的提示词
- 综合运用全部概念构建实际应用

## 章节内容

| 序号 | 标题 | 内容 |
|------|------|------|
| 01 | 模型基础 | `init_chat_model()`、模型参数、invoke/stream/batch、多轮对话 |
| 02 | 消息系统 | 核心消息类型、多模态消息、Content Blocks、Token 统计、消息裁剪 |
| 03 | 流式与批量 | `stream()`、`batch()`、`batch_as_completed()`、`astream_events()` |
| 04 | 工具调用 | `@tool`、`bind_tools()`、并行调用、强制调用、工具执行循环 |
| 05 | 结构化输出 | Pydantic、TypedDict、JSON Schema、`with_structured_output()` |
| 06 | 提示工程 | System Prompt、Prompt 模板、多模态提示、缓存优化、设计模式 |
| 07 | 入门实战 | 智能代码助手，综合运用全部核心概念 |

## 快速开始

### 1. 安装

```bash
uv init --python 3.11
uv add "langchain[openai]"
uv add pydantic
```

### 2. 配置 API Key

```bash
# Moonshot Kimi
export MOONSHOT_API_KEY="your-key"

# DeepSeek
export DEEPSEEK_API_KEY="your-key"
```

### 3. 运行示例

```python
from langchain.chat_models import init_chat_model
from langchain.messages import HumanMessage

model = init_chat_model("moonshot:moonshot-v1-8k")
response = model.invoke(HumanMessage("你好，请介绍一下自己"))
print(response.content)
```

## 推荐模型

| 场景 | 推荐模型 | 特点 |
|------|---------|------|
| 日常对话 | `moonshot:moonshot-v1-8k` | 速度快，成本低 |
| 长文本 | `moonshot:moonshot-v1-32k` | 上下文窗口大 |
| 代码生成 | `deepseek:deepseek-chat` | 代码能力强 |
| 复杂推理 | `moonshot:moonshot-v1-128k` | 上下文极大 |

## 常见错误

### 1. 忘记设置 API Key

```python
# 错误
model = init_chat_model("moonshot:moonshot-v1-8k")
# AuthenticationError: No API key provided

# 正确：先设置环境变量
# export MOONSHOT_API_KEY="your-key"
model = init_chat_model("moonshot:moonshot-v1-8k")
```

### 2. 格式错误

```python
# 错误：某些模型只接受消息列表
model.invoke("你好")

# 正确
from langchain.messages import HumanMessage
model.invoke([HumanMessage("你好")])
```

## 学习路径

```
模型基础 (01)
    │
    ├──→ 消息系统 (02) ──→ 流式与批量 (03)
    │         │                    │
    │         ▼                    ▼
    │    工具调用 (04) ←──── 提示工程 (06)
    │         │
    │         ▼
    │   结构化输出 (05)
    │         │
    ▼         ▼
   入门实战 (07) ← 综合运用全部概念
```

**推荐学习顺序**：
1. 先读 **01 模型基础**，了解如何初始化和调用模型
2. 读 **02 消息系统**，理解 LLM 交互的数据结构
3. 读 **03 流式与批量**，掌握不同调用模式
4. 读 **04 工具调用** 和 **05 结构化输出**，学习核心能力
5. 读 **06 提示工程**，提升提示词编写水平
6. 最后做 **07 入门实战**，综合运用全部知识

## 下一步

学完本章后，建议继续学习：

- **09.02 - LangChain 进阶**：Chains、Agents、Memory、Callbacks
- **09.03 - LangGraph 基础**：状态机、图、条件边
- **09.04 - LangGraph 进阶**：多 Agent、流控制、持久化