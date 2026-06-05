# ADK-Python 项目总览

## 项目简介

ADK-Python（Agent Development Kit for Python）是 Google 开源的多语言 AI Agent 开发工具包中**最成熟的版本**，当前版本 2.2.0，采用 Apache 2.0 许可证。ADK 支持 Python、Go、TypeScript、Java 四种语言，其中 Python 因生态最丰富、功能最完整而定位为核心开发语言。

与 Go 版本的"代码优先、性能优先"不同，Python 版本的 ADK 更强调**开发者体验**和**生态集成**——通过 LiteLLM 支持 100+ 大模型、基于图的 Workflow 编排引擎、以及完整的 Evaluation 评估框架。

## 设计哲学

ADK-Python 2.x 相较 v1.x 进行了重大重构，核心设计理念：

- **Code-First（代码优先）**：Agent、Tool、Workflow 全部用 Python 代码定义，享受类型提示和 Pydantic 校验。
- **模型无关（Model-Agnostic）**：通过 LiteLLM 集成，原生支持 OpenAI、Gemini、Claude、DeepSeek 等 100+ 模型，同时内置 Gemini / Vertex AI 的深度集成。
- **图驱动 Workflow**：基于 Node + Edge 的 DAG 工作流引擎，所有节点（Agent、Tool、Function）统一继承 `BaseNode`，通过边定义执行顺序。
- **多 Agent 协作**：通过子 Agent（`sub_agents`）、Agent 转移（`transfer_to_agent`）和 Workflow 编排实现灵活的多 Agent 架构。
- **MCP + A2A 双协议**：通过 MCP 接入外部工具和数据源，通过 A2A 协议与其他 Agent 框架互操作。
- **内置 Evaluation**：提供完整的评估框架，支持 LLM-as-Judge、端到端测试、回归测试。
- **Python 3.11+**：利用 asyncio、Pydantic v2、类型注解等现代 Python 特性。

## 核心概念

### Agent（智能体）

Agent 是所有可执行单元的基类。ADK-Python 中 `Agent` 是 `LlmAgent` 的别名（`source/src/google/adk/__init__.py:19`）：

```python
from google.adk import Agent

agent = Agent(
    name="assistant",
    model="gemini-2.5-flash",
    instruction="You are a helpful assistant.",
    tools=[search_tool, calc_tool],
)
```

子 Agent 通过 `sub_agents` 注册，LLM 可自动调用 `transfer_to_agent` 将控制权转交给子 Agent：

```python
coordinator = Agent(
    name="coordinator",
    model="gemini-2.5-flash",
    sub_agents=[refund_agent, complaint_agent],
)
```

### Tool（工具）

ADK-Python 支持多种工具类型（`source/src/google/adk/tools/` 包含 60+ 文件）：

```python
# 函数工具：直接传函数，ADK 自动推导参数 Schema
def get_weather(city: str) -> dict:
    return {"temperature": 25, "condition": "sunny"}

agent = Agent(
    name="weather_bot",
    model="gemini-2.5-flash",
    tools=[get_weather],  # 直接传函数即可
)
```

内置工具包括：`google_search_tool`、`bash_tool`、`load_memory_tool`、`exit_loop_tool`、`mcp_tool`、`openapi_tool`、`langchain_tool` 等。

### Workflow（工作流）

ADK-Python 2.x 的 Workflow 是**基于图的 Node 编排引擎**（`source/src/google/adk/workflow/_workflow.py:148`）。每个节点（BaseNode）可以是 Agent、Tool 或自定义 FunctionNode，通过边（Edge）定义执行顺序：

```python
from google.adk.workflow import Workflow, START

researcher = Agent(name="researcher", model="gemini-2.5-flash", ...)
analyst = Agent(name="analyst", model="gemini-2.5-flash", ...)
writer = Agent(name="writer", model="gemini-2.5-flash", ...)

pipeline = Workflow(
    name="research_pipeline",
    edges=[
        (START, researcher),        # 入口 → 研究员
        (researcher, analyst),       # 研究员 → 分析师
        (analyst, writer),           # 分析师 → 作者
    ],
)
```

Workflow 核心能力：
- **顺序执行**：通过边串联节点
- **条件路由**：通过 `route` 参数实现分支选择
- **并行执行**：`max_concurrency` 控制并行度，同一来源的多条边并行调度
- **动态节点**：`ctx.run_node()` 在运行时动态创建子节点
- **HITL 中断恢复**：支持人工审核节点后恢复执行

### Runner（运行器）

Runner 是状态无关的执行引擎（`source/src/google/adk/runners.py:152`）：

```python
from google.adk import Runner
from google.adk.sessions import InMemorySessionService

runner = Runner(
    app_name="my_app",
    node=agent,  # 可以是 Agent 或 Workflow
    session_service=InMemorySessionService(),
)

async for event in runner.run_async(
    user_id="user1",
    session_id=session.id,
    new_message=types.Content(parts=[types.Part(text="Hello")], role="user"),
):
    print(event.content)
```

### Memory（记忆）

跨会话的长期记忆（`source/src/google/adk/memory/`），支持 InMemory 和 Vertex AI RAG 两种后端。

### Session（会话）

对话状态与事件管理（`source/src/google/adk/sessions/`），内置 InMemory、SQLite、Vertex AI 实现。

## 与 ADK-Go 的对比

| 维度 | ADK-Python | ADK-Go |
|------|-----------|--------|
| 版本 | 2.2.0 | v1.2.0 |
| 成熟度 | ⭐⭐⭐⭐⭐ | ⭐⭐⭐ |
| 模型支持 | 100+（LiteLLM） | Gemini 内置 + 自定义 |
| Workflow | ✅ 图驱动 DAG 引擎 | 仅 Sequential/Parallel/Loop |
| 多 Agent 协作 | sub_agents + transfer + Workflow | Agent Transfer + Workflow Agents |
| Evaluation | ✅ 完整框架 | ❌ |
| Planner | ✅ | ❌ |
| Code Executor | ✅（GKE/Container/Vertex） | ❌ |
| OpenTelemetry | ✅ 内置 | ✅ 内置 |
| Python 版本 | 3.11+ | N/A |
| 部署体积 | Python 运行时 | 单二进制 MB 级 |
| 并发模型 | asyncio | goroutine |
| 适用场景 | 快速原型、复杂编排、评估 | 高性能后端、云原生 |

## 适用场景

ADK-Python 特别适合：

- **快速原型验证**：Python 生态 + LiteLLM 百模型支持，最快几分钟搭建 Agent 原型。
- **复杂多 Agent 编排**：Workflow DAG + 多层 Agent 树实现企业级协作。
- **评估驱动开发**：内置 Evaluation 框架，实现 Agent 质量可量化。
- **生态丰富**：LangChain、LlamaIndex、CrewAI 等工具无缝集成。
- **Google Cloud 集成**：Vertex AI、Cloud Run、BigQuery、Spanner 一等公民支持。

## 常见问题

**Q：Python 和 Go 版本怎么选？**

A：Python 技术栈、需要复杂编排和评估 → 选 Python。Go 技术栈、追求高性能和云原生 → 选 Go。两者可通过 A2A 协议互操作。

**Q：2.2.0 稳定吗？**

A：核心 API（Agent、Tool、Runner）已稳定。Workflow 仍在快速迭代，API 可能有调整。

**Q：支持非 Gemini 模型吗？**

A：通过 LiteLLM 支持 100+ 模型（OpenAI、Claude、DeepSeek、Ollama 等），同时内置 Gemini 和 Vertex AI 深度集成。

**Q：如何部署到生产环境？**

A：支持 Cloud Run、Vertex AI Agent Engine、自定义 Docker 容器，内置 OpenTelemetry 可观测性。

## 学习路径

1. 阅读本总览，理解 ADK-Python 的定位和核心概念
2. 参考 [ADK-Go 系列文档](../adk-go/) 理解 Agent 通用概念（Agent、Tool、Runner、Session）
3. 关注 Python 独有特性：Workflow 图编排、Evaluation 评估、Code Executor
4. 深入源码：`source/src/google/adk/` 下各包实现
