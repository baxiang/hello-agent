# tRPC-Agent-Go 深度学习笔记

> tRPC 团队开源的 Go 语言 AI Agent 开发框架。本文档从源码、实战、设计原理三个维度深度剖析。
>
> **最新版本**：v1.10.0（2026-06-05） | **Go 要求**：1.21+ | **许可证**：Apache-2.0

## 1. 项目定位

绝大多数主流 Agent 框架（AutoGen、CrewAI、Agno、ADK）都是 Python 实现。Go 在微服务、高并发和部署方面有天然优势——goroutine 的轻量并发模型天然适配 Agent 的多路并行调用场景。

tRPC-Agent-Go 是 tRPC 团队的第三块 AI 拼图：
- **tRPC-A2A-Go**：Agent-to-Agent 互操作协议
- **tRPC-MCP-Go**：Model Context Protocol 工具协议
- **tRPC-Agent-Go**：智能 Agent 构建框架

### 设计哲学（核心原则）

1. **模块化可插拔**：Agent/Model/Tool/Session/Memory/Knowledge 均为接口抽象，可替换
2. **事件驱动解耦**：组件间通过 `<-chan *event.Event` 通信，支持流式、回调、插件
3. **显式优于隐式**：Runner 显式管理 Session/Memory 生命周期，不用魔法注入
4. **安全第一**：MaxLLMCalls/MaxToolIterations 双重限制，权限策略，沙箱执行

### 核心特性全景

| 特性 | 实现 |
|------|------|
| **Agent 类型** | LLMAgent / ChainAgent / ParallelAgent / CycleAgent / GraphAgent / A2AAgent / DifyAgent |
| **模型支持** | OpenAI / DeepSeek / Anthropic / 混元 / 千问（OpenAI 兼容协议） |
| **工具生态** | Function Tool / MCP(STDIO/SSE/HTTP) / AgentTool / DuckDuckGo / Todo / ClaudeCode |
| **会话存储** | Memory / SQLite / Redis / PostgreSQL / PGVector / MySQL / ClickHouse |
| **长期记忆** | Agentic 模式（Agent 主动管理）/ Auto 模式（LLM Extractor 后台提取） |
| **RAG 知识库** | 6 种 VectorStore / 5 种 Embedder / 3 种 Reranker / 智能过滤 |
| **图工作流** | GraphAgent（Go 版 LangGraph）/ BSP+DAG 双引擎 / Checkpoint / HITL |
| **可观测性** | OpenTelemetry + Langfuse / 执行 Trace / Debug Server |
| **协议支持** | AG-UI（SSE 实时交互）/ A2A（跨框架互操作）/ MCP（工具标准） |
| **安全** | 权限策略 / 沙箱执行 / 调用次数限制 / 内容过滤 |

### 企业验证

腾讯元宝、腾讯视频、腾讯新闻、IMA、QQ 音乐等业务落地。

---

## 2. 架构设计

### 整体架构

```
┌─────────────────────────────────────────────────────────────┐
│                         Runner                               │
│  - Session 生命周期      - Event 流处理       - 插件管理       │
│  - Invocation ID 生成   - 可观测 Span 创建    - Completion 事件│
└────────────────────────┬────────────────────────────────────┘
                         │ agent.RunWithPlugins(ctx, inv, agent)
┌────────────────────────▼────────────────────────────────────┐
│                         Agent                                │
│  - 接收 Invocation 上下文  - 返回 <-chan *event.Event          │
│  - LLMAgent: LLM 推理循环 + 工具调用 + 响应处理               │
│  - ChainAgent: 子 Agent 顺序流水线                            │
│  - ParallelAgent: 子 Agent 并发 + 结果合并                    │
│  - CycleAgent: 规划→执行→检查 循环                            │
│  - GraphAgent: 有向图工作流（BSP/DAG 引擎）                   │
└────────────────────────┬────────────────────────────────────┘
                         │
        ┌────────────────┼─────────────────┐
        ▼                ▼                  ▼
   ┌─────────┐    ┌───────────┐    ┌────────────┐
   │  Model  │    │   Tool    │    │  Planner   │
   │ LLM 调用 │    │  工具执行  │    │  规划推理   │
   │ 流式/非流│    │ 权限/重试  │    │  任务分解   │
   └─────────┘    └───────────┘    └────────────┘
```

### 执行流程图

```
用户消息
  │
  ▼
Runner.Run(userID, sessionID, message)
  │
  ├─ 1. Session Service.GetSession() → 加载历史消息
  ├─ 2. 创建 Invocation{Session, Message, RunOptions}  
  ├─ 3. 注入 Memory Service / Artifact Service
  ├─ 4. 执行 BeforeAgent 回调链
  │
  ▼
Agent.Run(ctx, invocation)
  │
  ├─ LLMAgent 执行循环：
  │   ├─ 构建 messages（系统指令 + 历史 + 用户消息）
  │   ├─ model.GenerateContent(ctx, request)
  │   │     ├─ BeforeModel 回调
  │   │     ├─ HTTP POST → LLM API
  │   │     ├─ AfterModel 回调
  │   │     └─ 返回 <-chan *Response（流式逐 chunk 推送）
  │   ├─ 解析 response.Choices
  │   │     ├─ content ≠ null → 文本回复 → break
  │   │     ├─ tool_calls ≠ null → 执行工具
  │   │     │     ├─ BeforeTool 回调
  │   │     │     ├─ 权限检查（PermissionPolicy）
  │   │     │     ├─ Tool.Call(ctx, jsonArgs)
  │   │     │     ├─ AfterTool 回调
  │   │     │     └─ tool result 追加到 messages，继续循环
  │   │     └─ refusal ≠ null → 安全拒绝
  │   └─ 检查 MaxLLMCalls / MaxToolIterations 限制
  │
  ▼
Runner 后处理
  ├─ 5. Session Service.AppendEvent() → 持久化非 partial 事件
  ├─ 6. Memory Auto Extraction（如果启用 Extractor）
  ├─ 7. 执行 AfterAgent 回调链
  ├─ 8. 发出 runner.completion 事件
  └─ 9. 关闭 event channel
```

### 事件系统（核心通信机制）

```go
type Event struct {
    ID              string         // 唯一事件 ID
    InvocationID    string         // 所属 Invocation
    ParentInvocationID string      // 父 Invocation（子 Agent 场景）
    RequestID       string         // 所属 Request
    Author          string         // 事件作者（Agent 名称）
    Object          string         // "chat.completion" / "chat.completion.chunk" / "agent.transfer"
    Response        *model.Response // 响应内容
    Error           *ResponseError  // 错误信息
    StateDelta      map[string][]byte // Graph State 变更
    IsPartial       bool           // 是否为流式中间块
    Done            bool           // 是否为最终事件
    Timestamp       time.Time
}
```

**事件流的设计意义**：
- Channel 作为并发安全的通信管道，天然支持 goroutine 间的流式传递
- `ParentInvocationID` 支持构建 Agent 调用树（前端可渲染嵌套 UI）
- `StateDelta` 让 GraphAgent 的节点状态变更可被外部观测
- `Object` 字段让消费者按类型过滤（如 UI 忽略 `agent.transfer` 系统事件）

---

## 3. 核心包依赖关系

```
agent ──→ tool ──→ model
  │          │
  ├──→ session
  ├──→ memory
  ├──→ knowledge
  └──→ graph

runner ──→ agent + session + memory + plugin

server ──→ runner + agui + a2a
```

每个包都是接口抽象，依赖方向从上层到下层，形成清晰的单向依赖。

---

## 4. 快速开始

### 环境准备

```bash
export OPENAI_API_KEY="sk-xxx"
export OPENAI_BASE_URL="https://api.deepseek.com"   # 可选
```

### Hello World

```go
package main

import (
    "context"
    "fmt"

    "trpc.group/trpc-go/trpc-agent-go/agent/llmagent"
    "trpc.group/trpc-go/trpc-agent-go/model"
    "trpc.group/trpc-go/trpc-agent-go/model/openai"
    "trpc.group/trpc-go/trpc-agent-go/runner"
)

func main() {
    model := openai.New("deepseek-v4-flash")

    agent := llmagent.New("assistant",
        llmagent.WithModel(model),
        llmagent.WithGenerationConfig(model.GenerationConfig{Stream: true}),
    )

    r := runner.NewRunner("hello-app", agent)
    defer r.Close()

    events, _ := r.Run(context.Background(),
        "user-1", "session-1",
        model.NewUserMessage("Hello, what can you do?"),
    )

    for event := range events {
        if len(event.Response.Choices) > 0 {
            fmt.Print(event.Response.Choices[0].Delta.Content)
        }
        if event.IsRunnerCompletion() { break }
    }
}
```

---

## 5. 子包索引

```
trpc.group/trpc-go/trpc-agent-go/
├── agent/               # Agent 核心（LLM/Chain/Parallel/Cycle/Graph/A2A/Dify/ClaudeCode/Codex）
├── runner/              # Runner 执行器
├── model/               # 模型层（openai/anthropic/provider）
├── tool/                # 工具系统（function/claudecode/duckduckgo/mcp/todo/webfetch/agenttool/skilltool）
├── session/             # 会话管理 + 摘要
├── memory/              # 长期记忆 + Extractor
├── knowledge/           # RAG 知识库
├── graph/               # 图执行引擎 + Checkpoint
├── planner/             # Agent 规划器
├── artifact/            # 制品存储
├── skill/               # Agent Skills
├── codeexecutor/        # 代码执行器（local/e2b/container/jupyter）
├── event/               # 事件定义
├── evaluation/          # 评测框架
├── promptiter/          # Prompt 迭代优化
├── server/              # HTTP 服务（gateway/agui/a2a/a2ui/openclaw）
├── telemetry/           # OpenTelemetry + Langfuse
├── plugin/              # Runner 级插件
└── callbacks/           # 回调钩子
```

---

## 6. 生态与集成

> 本节源自原「生态与进阶」深度文（14-ecosystem.md），融合辅助模块与生态关系。

### 生态全景

tRPC-Agent-Go 以三大支柱融入 AI 工程生态：

```
                        tRPC-Agent-Go
                              │
        ┌─────────────────────┼─────────────────────┐
        │                     │                     │
   ┌────▼────┐          ┌────▼────┐          ┌────▼────┐
   │tRPC-A2A-Go│        │tRPC-MCP-Go│         │  Go 生态  │
   │跨框架互操作│        │  工具协议  │         │  高并发   │
   └─────────┘          └─────────┘          └─────────┘
        │                     │                     │
        └─────────────────────┼─────────────────────┘
                              │
        ┌─────────────────────┼─────────────────────┐
        │                     │                     │
   ┌────▼────┐          ┌────▼────┐          ┌────▼────┐
   │  AG-UI  │          │ Gateway │          │OpenClaw │
   │ 用户UI   │          │ HTTP API│          │ IM 网关  │
   └─────────┘          └─────────┘          └─────────┘
                              │
        ┌─────────────────────┼─────────────────────┐
        │                     │                     │
   ┌────▼────┐          ┌────▼────┐          ┌────▼────┐
   │OpenTelemetry│      │Langfuse │          │ Debug   │
   │  链路追踪   │      │ LLM分析 │          │ Server  │
   └─────────┘          └─────────┘          └─────────┘
```

### 三大协议定位

| 协议 | 全称 | 生态角色 |
|------|------|----------|
| **MCP** | Model Context Protocol | 工具调用标准，统一 Function Tool / 文件系统 / 外部能力接入 |
| **A2A** | Agent-to-Agent | 跨框架互操作，与 AutoGen / CrewAI / ADK 等 Python 框架互通 |
| **AG-UI** | Agent-UI 协议 | SSE 实时交互，前端流式渲染 Agent 推理过程 |

### 辅助模块矩阵

| 模块 | 职责 | 后端 / 实现 |
|------|------|-------------|
| **Artifact** | 版本化制品存储（图片 / 文本 / 报告） | inmemory / S3 / COS（腾讯云） |
| **Code Executor** | 代码执行隔离 | local / Docker / E2B（云沙箱）/ Jupyter |
| **Planner** | LLM 调用前任务分解与工具选择 | Builtin Planner / Custom 接口 |
| **Evaluation** | 评测集 + 重复运行 + 指标统计 | Accuracy / Latency / TokenUsage |
| **PromptIter** | 基于评测结果自动迭代 Prompt | 与 Evaluation 形成优化闭环 |
| **Agent Skills** | Anthropic Skills 规范实现 | skilltool 工具集 + 热更新 |

### 部署与安全考量

**代码执行安全层级**（隔离强度递增）：

| 执行器 | 隔离性 | 适用场景 |
|--------|--------|----------|
| <code>local</code> | 低（可访问宿主机） | 快速迭代、可信环境 |
| <code>container</code>（Docker） | 中（容器隔离） | 生产推荐 |
| <code>e2b</code> | 高（云端隔离 + 审计） | 多租户、最强安全 |
| <code>jupyter</code> | 低（交互式） | 教学 / 演示 |

**制品存储后端选择**：<code>inmemory</code>（开发测试）/ <code>s3</code>（AWS 生产）/ <code>cos</code>（腾讯云生产）。

**Agent Skills 安全模型**：隔离工作区（临时目录，执行后清理）+ 策略模式（命令白名单）+ 环境变量清洗（移除敏感 env）+ 超时控制。

### 可观测性集成

| 集成 | 层级 | 用途 |
|------|------|------|
| **OpenTelemetry** | 通用链路追踪 | 标准 Trace / Span 接入企业监控 |
| **Langfuse** | LLM 专用分析 | Token 成本、Prompt 调试、评估对比 |
| **Debug Server** | 本地调试 | 实时查看 Event 流与 Agent 状态 |

---

## 学习路线建议

1. **[Agent 基础](./examples/01-agent-basics/)** — 理解 LLMAgent 执行循环，是所有 Agent 类型的基础
2. **[Model 模型层](./examples/13-model-provider/model)** — 理解 LLM 调用机制，如何接入不同模型
3. **[Tool 工具系统](./examples/02-tool-system/tool)** — 理解 Agent 如何与外部交互
4. **[Session 会话](./examples/07-session-management/session)** — 对话上下文持久化
5. **[Multi-Agent 编排](./examples/05-multi-agent/multiagent)** — Chain/Parallel/Cycle 组合模式
6. **[Memory 记忆](./examples/06-memory-system/memory)** — 跨对话用户信息积累
7. **[Knowledge RAG](./examples/12-knowledge-rag/knowledge)** — 知识库检索增强
8. **[Graph 工作流](./examples/04-graph-workflow/graph)** — 图工作流（含基础与高级模式）
9. **[MCP 协议](./examples/03-mcp-tools/mcptool)** — 工具标准协议
10. **[A2A 协议](./examples/09-a2a-protocol/)** — 跨框架互操作
11. **[AG-UI 协议](./examples/10-agui-protocol/)** — 前端实时交互
12. **[可观测性](./examples/16-observability/callbacks)** — 监控与调试
13. **[示例总览](./examples/)** — 完整示例目录（含协议服务端总览）
