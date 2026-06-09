# tRPC-Agent-Go 技术调研报告

> 调研日期：2026-06-09
>
> 资料来源：
> - GitHub 仓库：https://github.com/trpc-group/trpc-agent-go
> - 官方文档：https://trpc-group.github.io/trpc-agent-go/
> - Go Packages：https://pkg.go.dev/trpc.group/trpc-go/trpc-agent-go

---

## 目录

1. [项目概述](#1-项目概述)
2. [架构设计](#2-架构设计)
3. [核心组件详解](#3-核心组件详解)
   - [Agent](#31-agent)
   - [Runner](#32-runner)
   - [Model](#33-model)
   - [Tool](#34-tool)
   - [Session](#35-session)
   - [Memory](#36-memory)
   - [Knowledge](#37-knowledge)
   - [Graph Agent](#38-graph-agent)
   - [Planner](#39-planner)
   - [Skill](#310-skill)
   - [Artifact](#311-artifact)
4. [Server 与集成](#4-server-与集成)
5. [可观测性](#5-可观测性)
6. [Quick Start 示例](#6-quick-start-示例)
7. [最佳实践](#7-最佳实践)
8. [生态与对比](#8-生态与对比)

---

## 1. 项目概述

### 基本信息

| 属性 | 说明 |
|------|------|
| **Go 模块路径** | `trpc.group/trpc-go/trpc-agent-go` |
| **最新版本** | v1.10.0 (2026-06-05) |
| **许可证** | Apache-2.0 |
| **Go 版本要求** | Go 1.21+ |
| **开发团队** | tRPC 团队（腾讯） |
| **仓库地址** | https://github.com/trpc-group/trpc-agent-go |
| **官方文档** | https://trpc-group.github.io/trpc-agent-go/ |

### 定位

tRPC-Agent-Go 是 tRPC 团队开源的 Go 语言 AI Agent 开发框架，补齐了 tRPC 在 Go 语言 AI 生态的拼图。此前该团队已开源了：

- **tRPC-A2A-Go**：Agent-to-Agent (A2A) 开发框架
- **tRPC-MCP-Go**：MCP (Model Context Protocol) 开发框架

绝大多数主流的 Agent 框架（AutoGen、CrewAI、Agno、ADK 等）都是 Python 实现，而 Go 在微服务、高并发和部署方面具有天然优势。tRPC-Agent-Go 利用 Go 的高并发能力和 tRPC 生态，为 Go 场景带来 LLM 推理、协商和自适应能力，满足"智能+性能"的复杂业务需求。

### 核心特性

- **多样化 Agent 系统**：LLMAgent、ChainAgent、ParallelAgent、CycleAgent、GraphAgent
- **丰富的工具生态**：内置常用工具，支持 Function、MCP 协议等多种扩展方式
- **智能会话管理**：支持 Redis/Memory/SQLite/MySQL/PostgreSQL/ClickHouse 等多种存储后端
- **长期记忆**：支持 Agentic 和 Auto 两种模式
- **RAG 知识检索**：支持 PGVector、Elasticsearch、Qdrant、Milvus 等多种向量数据库
- **GraphAgent**：类型安全的图工作流，等价于 Go 版 LangGraph
- **Agent Skills**：可复用的 SKILL.md 工作流，支持安全执行
- **Artifacts**：版本化的文件存储（内存、S3、COS）
- **Prompt Caching**：自动成本优化，缓存内容可节省 90% 成本
- **端到端可观测性**：OpenTelemetry 全链路追踪、Langfuse 集成
- **评测框架**：自动化评测集 + 指标度量
- **AG-UI / A2A 协议**：Agent-User Interaction 与 Agent-to-Agent 互操作

### 企业验证

已在腾讯元宝、腾讯视频、腾讯新闻、IMA、QQ 音乐等业务中落地验证。

---

## 2. 架构设计

### 整体架构

tRPC-Agent-Go 采用模块化架构设计，核心组件均可插拔，组件间通过事件驱动机制解耦通信，支持回调注入自定义逻辑。

```
┌─────────────────────────────────────────────────────────────┐
│                         Runner                               │
│  - Session 管理   - Event 流处理   - 插件系统                  │
│  - ID 生成       - 可观测集成     - Completion 事件           │
└────────────────────────┬────────────────────────────────────┘
                         │ agent.RunWithPlugins(ctx, inv, agent)
┌────────────────────────▼────────────────────────────────────┐
│                         Agent                                │
│  - 接收 Invocation   - 返回 <-chan *event.Event               │
│  - 多种实现：LLMAgent / ChainAgent / ParallelAgent / ...      │
└────────────────────────┬────────────────────────────────────┘
                         │
        ┌────────────────┼────────────────┐
        ▼                ▼                ▼
   ┌─────────┐    ┌──────────┐    ┌──────────┐
   │  Model  │    │   Tool   │    │ Planner  │
   │  LLM 调用│    │ 工具执行  │    │ 规划推理  │
   └─────────┘    └──────────┘    └──────────┘
```

### 执行流程

1. **Runner** 编排整个执行管道，管理 Session
2. **Agent** 使用多个专用组件处理请求
3. **Planner** 确定最优策略和工具选择
4. **Tools** 执行具体任务（API 调用、计算、搜索）
5. **Memory** 维护上下文并从交互中学习
6. **Knowledge** 提供 RAG 能力支持文档理解

### 核心包职责

| 包 | 职责 |
|----|------|
| `agent` | 核心执行单元，处理用户输入并生成响应 |
| `runner` | Agent 执行器，管理执行流程并连接 Session/Memory 服务 |
| `model` | 支持多种 LLM 模型（OpenAI、Anthropic、DeepSeek 等） |
| `tool` | 提供各种工具能力（Function、MCP、DuckDuckGo 等） |
| `session` | 管理用户会话状态和事件 |
| `memory` | 记录用户长期记忆和个性化信息 |
| `knowledge` | 实现 RAG 知识检索能力 |
| `planner` | 提供 Agent 规划和推理能力 |
| `graph` | 图执行引擎 |
| `artifact` | 版本化的文件制品存储 |
| `skill` | 可复用的 Agent Skills（SKILL.md） |
| `event` | 事件类型和流式载荷定义 |
| `evaluation` | 评测框架 |
| `server` | HTTP 服务（Gateway、AG-UI、A2A） |
| `telemetry` | OpenTelemetry 追踪和指标 |
| `codeexecutor` | 代码执行器（本地、E2B、容器、Jupyter） |
| `callbacks` | 回调钩子系统 |
| `plugin` | Runner 级全局插件 |
| `prompt` | Prompt 模板 |

---

## 3. 核心组件详解

### 3.1 Agent

Agent 是 tRPC-Agent-Go 框架的核心执行单元，实现统一接口，支持流式输出和回调机制。

#### Agent 接口

```go
type Agent interface {
    Run(ctx context.Context, invocation *Invocation) (<-chan *event.Event, error)
    Info() Info
    SubAgents() []Agent
    FindSubAgent(name string) Agent
}
```

#### Agent 类型

| Agent 类型 | 包路径 | 说明 |
|-----------|--------|------|
| **LLMAgent** | `agent/llmagent` | 基于大语言模型，支持工具调用和推理 |
| **ChainAgent** | `agent/chainagent` | 链式执行，支持多步骤任务分解 |
| **ParallelAgent** | `agent/parallelagent` | 并行处理，多专家协作 |
| **CycleAgent** | `agent/cycleagent` | 迭代循环，支持自优化 |
| **GraphAgent** | `agent/graphagent` | 图工作流，兼容现有编排习惯 |
| **A2AAgent** | `agent/a2aagent` | 与远程 A2A Agent 通信 |
| **ClaudeCodeAgent** | `agent/claudecode` | 调用本地 Claude Code CLI |
| **CodexAgent** | `agent/codex` | 调用本地 Codex CLI |
| **DifyAgent** | `agent/dify` | Dify 平台集成 |
| **TaskRun** | `agent/taskrun` | 持久化后台任务运行控制面 |

#### LLMAgent 核心配置选项

```go
agent := llmagent.New("assistant",
    // 基础配置
    llmagent.WithModel(modelInstance),          // 模型实例
    llmagent.WithDescription("..."),            // Agent 描述
    llmagent.WithInstruction("..."),            // 系统指令

    // 工具配置
    llmagent.WithTools([]tool.Tool{...}),       // 工具列表
    llmagent.WithToolSets([]tool.ToolSet{...}), // 工具集

    // 生成配置
    llmagent.WithGenerationConfig(genConfig),   // 生成参数（Stream、Temperature 等）

    // 子 Agent
    llmagent.WithSubAgents([]agent.Agent{...}), // 可委托的子 Agent

    // 消息过滤
    llmagent.WithMessageTimelineFilterMode(...), // 时间维过滤
    llmagent.WithMessageBranchFilterMode(...),   // 分支维过滤

    // 安全限制
    llmagent.WithMaxLLMCalls(10),               // 最大 LLM 调用次数
    llmagent.WithMaxToolIterations(5),          // 最大工具迭代次数

    // 结构化输出
    llmagent.WithStructuredOutputJSON(...),     // JSON 结构化输出
    llmagent.WithStructuredOutputJSONSchema(...), // JSON Schema 输出

    // 回调
    llmagent.WithAgentCallbacks(callbacks),     // Agent 级回调

    // 推理模式
    llmagent.WithReasoningContentMode(...),     // DeepSeek Thinking 模式

    // 技能
    llmagent.WithCodeExecutor(executor),        // 代码执行器

    // 会话
    llmagent.WithAddSessionSummary(true),       // 启用会话摘要
)
```

#### 消息可见性控制

LLMAgent 支持两种维度的消息过滤：

**时间维度 (TimelineFilterMode)**：
- `TimelineFilterAll`：包含历史消息 + 当前请求消息（默认）
- `TimelineFilterCurrentRequest`：仅当前 runner.Run 的消息
- `TimelineFilterCurrentInvocation`：仅当前 Invocation 上下文的消息

**分支维度 (BranchFilterMode)**：
- `BranchFilterModeAll`：所有 Agent 的消息
- `BranchFilterModePrefix`：前缀匹配（默认，含祖先/自身/后代）
- `BranchFilterModeSubtree`：仅自身和后代
- `BranchFilterModeExact`：仅精确匹配

#### 结构化输出

| 方法 | 说明 |
|------|------|
| `WithStructuredOutputJSONSchema` | 自定义 JSON Schema，最灵活 |
| `WithStructuredOutputJSON` | 从 Go 类型自动生成 Schema（推荐） |
| `WithOutputSchema` (Legacy) | 旧版方式 |
| `WithOutputKey` | 提取特定字段到 Session State |

### 3.2 Runner

Runner 是 Agent 执行器，提供会话管理、事件流处理、插件系统的统一入口。

#### 创建 Runner

```go
// 基础创建
r := runner.NewRunner("app-name", agent,
    runner.WithSessionService(sessionService),
    runner.WithMemoryService(memoryService),
    runner.WithArtifactService(artifactService),
    runner.WithPlugins(plugins...),
)

// Agent 工厂模式（每个请求创建新 Agent）
r := runner.NewRunnerWithAgentFactory("my-app", "assistant",
    func(ctx context.Context, ro agent.RunOptions) (agent.Agent, error) {
        return llmagent.New("assistant",
            llmagent.WithInstruction(ro.Instruction),
        ), nil
    },
)
```

#### RunOptions 核心配置

```go
eventChan, err := r.Run(ctx, userID, sessionID, message,
    // 运行控制
    agent.WithRequestID("req-123"),              // 请求 ID（用于取消和状态查询）
    agent.WithStream(true),                      // 流式输出
    agent.WithMaxRunDuration(30*time.Second),    // 最大运行时间
    agent.WithDetachedCancel(true),              // 分离取消（后台继续）

    // Agent 选择
    agent.WithAgent(myCustomAgent),              // 覆盖 Agent
    agent.WithAgentByName("sandboxed"),          // 按名称选择 Agent

    // 上下文
    agent.WithInstruction("..."),                // 覆盖指令
    agent.WithAppName("project-a"),              // 多租户隔离
    agent.WithMessages(historyMessages),         // 提供历史消息

    // 恢复
    agent.WithResume(true),                      // 恢复中断的运行

    // 工具
    agent.WithToolFilter(...),                   // 工具过滤
    agent.WithToolPermissionPolicyFunc(...),     // 权限策略
    agent.WithToolCallArgumentsJSONRepairEnabled(true), // JSON 参数修复

    // 回调
    agent.WithAgentCallbacks(callbacks),         // 请求级回调
)
```

#### 停止运行

```go
// A: Ctrl+C 终端程序
ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt)
defer stop()

// B: 代码取消
ctx, cancel := context.WithCancel(context.Background())
defer cancel()

// C: 按 requestID 取消
mr := r.(runner.ManagedRunner)
mr.Cancel(requestID)

// D: 内部停止 (StopError)
// 在 Tool 或回调中返回 agent.NewStopError("reason")
```

#### 插件系统

```go
r := runner.NewRunner("my-app", a,
    runner.WithPlugins(
        plugin.NewLogging(),
        plugin.NewGlobalInstruction("You must follow security policies."),
    ),
)
```

Plugin 实现 `plugin.Plugin` 接口，可挂载到 Agent、Tool、Model 生命周期。

#### Ralph Loop 模式

外循环模式，Runner 持续迭代直到验证条件满足：

```go
r := runner.NewRunner("my-app", a,
    runner.WithRalphLoop(runner.RalphLoopConfig{
        MaxIterations:     20,
        CompletionPromise: "DONE",
        VerifyCommand:     "go test ./... -count=1",
        VerifyTimeout:     2 * time.Minute,
    }),
)
```

### 3.3 Model

Model 模块是 LLM 抽象层，提供统一的模型调用接口。

#### Model 接口

```go
type Model interface {
    GenerateContent(ctx context.Context, request *Request) (<-chan *Response, error)
    Info() Info
}

// 可选迭代器接口，减少 channel 开销
type IterModel interface {
    Model
    GenerateContentIter(ctx context.Context, request *Request) (Seq[*Response], error)
}
```

#### 支持的平台

| 平台 | 模型示例 | API 地址 |
|------|---------|----------|
| OpenAI | gpt-4o, gpt-4o-mini | https://api.openai.com/v1 |
| DeepSeek | deepseek-v4-flash, deepseek-v4-pro | https://api.deepseek.com |
| 腾讯混元 | hunyuan-2.0-thinking-* | https://api.hunyuan.cloud.tencent.com/v1 |
| 通义千问 | qwen-* | https://dashscope.aliyuncs.com/compatible-mode/v1 |
| Anthropic | claude-* | 通过 `model/anthropic` 包 |

#### GenerationConfig

```go
type GenerationConfig struct {
    Stream           bool     `json:"stream"`
    Temperature      *float64 `json:"temperature,omitempty"`
    MaxTokens        *int     `json:"max_tokens,omitempty"`
    TopP             *float64 `json:"top_p,omitempty"`
    Stop             []string `json:"stop,omitempty"`
    FrequencyPenalty *float64 `json:"frequency_penalty,omitempty"`
    PresencePenalty  *float64 `json:"presence_penalty,omitempty"`
    ReasoningEffort  *string  `json:"reasoning_effort,omitempty"`  // "low"/"medium"/"high"/"max"/"xhigh"
    ThinkingEnabled  *bool    `json:"thinking_enabled,omitempty"`
    ThinkingTokens   *int     `json:"thinking_tokens,omitempty"`
}
```

#### 模型切换

支持 Agent 级别和 Per-Request 级别切换：

```go
// Agent 级别
agent := llmagent.New("assistant",
    llmagent.WithModel(openai.New("gpt-4o-mini")),
)

// 注册多个模型
agent := llmagent.New("assistant",
    llmagent.WithModelRegistry(map[string]model.Model{
        "fast":  openai.New("gpt-4o-mini"),
        "smart": openai.New("gpt-4o"),
    }),
)

// Per-Request 切换
events, err := r.Run(ctx, userID, sessionID, msg,
    agent.WithModelName("smart"),
)
```

#### 高级特性

- **回调函数**：`WithChatRequestCallback`、`WithChatResponseCallback`、`WithChatChunkCallback`、`WithChatStreamCompleteCallback`
- **Batch API**：批量处理多个请求
- **重试机制**：`WithRetryPolicy` 配置自动重试
- **自定义 HTTP Header**：`WithHeaders`、Per-Request Headers
- **Token 计数**：`SimpleTokenCounter`
- **Token Tailoring**：自动裁剪消息以适应上下文窗口
- **Variant 优化**：`VariantDeepSeek`、`VariantHunyuan` 等平台特定适配
- **Model Failover**：模型故障转移
- **Model Hedge**：多模型对冲请求
- **ModelSelector**：模型选择器

#### Provider 机制

```go
import "trpc.group/trpc-go/trpc-agent-go/model/provider"

// 使用预注册的 Provider
m, _ := provider.Model("openai", "gpt-4o-mini")

// 注册自定义 Provider
provider.Register("my-provider", myProviderConfig)
```

### 3.4 Tool

Tool 系统是 Agent 与外部交互的核心组件。

#### Tool 接口

```go
type Tool interface {
    Declaration() *Declaration  // 工具元数据
}

type CallableTool interface {
    Call(ctx context.Context, jsonArgs []byte) (any, error)
    Tool
}

type StreamableTool interface {
    StreamableCall(ctx context.Context, jsonArgs []byte) (*StreamReader, error)
    Tool
}

type ToolSet interface {
    Tools(context.Context) []tool.Tool
    Close() error
    Name() string
}
```

#### 工具类型

| 类型 | 说明 |
|------|------|
| **Function Tools** | Go 函数直接实现，最简单 |
| **Agent Tool (AgentTool)** | 将 Agent 包装为可调用工具 |
| **DuckDuckGo Tool** | 基于 DuckDuckGo API 的搜索工具 |
| **MCP ToolSet** | MCP 协议标准的外部工具集 |
| **Claude Code ToolSet** | Claude Code 风格的文件/搜索/命令工具 |
| **Todo Tool** | 结构化的任务检查列表 |

#### MCP 传输方式

| 传输方式 | 说明 |
|----------|------|
| **STDIO** | 通过标准输入输出与子进程通信 |
| **SSE** | Server-Sent Events |
| **Streamable HTTP** | HTTP 流式传输 |

```go
// STDIO 示例
ts := mcp.NewMCPToolSet(
    mcp.ConnectionConfig{
        Transport: "stdio",
        Command:   "python",
        Args:      []string{"mcp_server.py"},
    },
)

// SSE 示例
ts := mcp.NewMCPToolSet(
    mcp.ConnectionConfig{
        Transport: "sse",
        ServerURL: "http://localhost:8080/sse",
    },
)

// Streamable HTTP 示例
ts := mcp.NewMCPToolSet(
    mcp.ConnectionConfig{
        Transport: "streamable_http",
        ServerURL: "http://localhost:8080/mcp",
    },
)
```

#### 工具权限策略

```go
events, err := r.Run(ctx, userID, sessionID, message,
    agent.WithToolPermissionPolicyFunc(
        func(ctx context.Context, req *tool.PermissionRequest) (tool.PermissionDecision, error) {
            if req.Metadata.Destructive {
                return tool.AskPermission("destructive tools require approval"), nil
            }
            return tool.AllowPermission(), nil
        },
    ),
)
```

#### 工具重试

```go
policy := &tool.RetryPolicy{
    MaxAttempts:     3,
    InitialInterval: 200 * time.Millisecond,
    BackoffFactor:   2.0,
    MaxInterval:     2 * time.Second,
    Jitter:          true,
}

agent := llmagent.New("assistant",
    llmagent.WithTools([]tool.Tool{myTool}),
    llmagent.WithToolCallRetryPolicy(policy),
)
```

#### Tool Call ID 获取

```go
func myTool(ctx context.Context, args MyArgs) (any, error) {
    toolCallID, ok := tool.ToolCallIDFromContext(ctx)
    // 用于日志、指标、子 Agent 关联等
}
```

### 3.5 Session

Session 管理对话上下文，隔离维度为 `<appName, userID, SessionID>`。

#### Session Service 接口

```go
type Service interface {
    CreateSession(ctx context.Context, key Key, state StateMap, options ...Option) (*Session, error)
    GetSession(ctx context.Context, key Key, options ...Option) (*Session, error)
    ListSessions(ctx context.Context, userKey UserKey, options ...Option) ([]*Session, error)
    DeleteSession(ctx context.Context, key Key, options ...Option) error
    UpdateAppState(ctx context.Context, appName string, state StateMap) error
    UpdateUserState(ctx context.Context, userKey UserKey, state StateMap) error
    UpdateSessionState(ctx context.Context, key Key, state StateMap) error
    AppendEvent(ctx context.Context, session *Session, event *event.Event, options ...Option) error
    CreateSessionSummary(ctx context.Context, sess *Session, filterKey string, force bool) error
    EnqueueSummaryJob(ctx context.Context, sess *Session, filterKey string, force bool) error
    Close() error
}
```

#### 存储后端对比

| 存储 | 场景 | 持久化 | 分布式 | 复杂查询 |
|------|------|--------|--------|----------|
| **Memory** | 开发/测试 | ❌ | ❌ | ❌ |
| **SQLite** | 本地持久化 | ✅ | ❌ | ✅ |
| **Redis** | 生产分布式 | ✅ | ✅ | ❌ |
| **PostgreSQL** | 生产复杂查询 | ✅ | ✅ | ✅ |
| **PGVector** | 语义召回 | ✅ | ✅ | ✅ |
| **MySQL** | 生产复杂查询 | ✅ | ✅ | ✅ |
| **ClickHouse** | 海量数据 | ✅ | ✅ | ✅ |

#### 会话摘要

支持 LLM 自动压缩长对话历史：

```go
summarizer := summary.NewSummarizer(llm,
    summary.WithChecksAny(
        summary.CheckEventThreshold(20),        // 超过 20 个事件
        summary.CheckTokenThreshold(4000),      // 超过 4000 token
        summary.CheckTimeThreshold(5*time.Minute),
    ),
    summary.WithMaxSummaryWords(200),
)

sessionService := inmemory.NewSessionService(
    inmemory.WithSummarizer(summarizer),
    inmemory.WithAsyncSummaryNum(2),
    inmemory.WithSummaryQueueSize(100),
)
```

#### TTL 管理

```go
sessionService := inmemory.NewSessionService(
    inmemory.WithSessionTTL(30*time.Minute),
    inmemory.WithAppStateTTL(24*time.Hour),
    inmemory.WithUserStateTTL(7*24*time.Hour),
)
```

#### Hook 机制

```go
sessionService := inmemory.NewSessionService(
    // 写入前拦截
    inmemory.WithAppendEventHook(func(ctx *session.AppendEventContext, next func() error) error {
        if containsSensitiveContent(ctx.Event) {
            return fmt.Errorf("sensitive content detected")
        }
        return next()
    }),
    // 读取后过滤
    inmemory.WithGetSessionHook(func(ctx *session.GetSessionContext, next func() (*session.Session, error)) (*session.Session, error) {
        sess, err := next()
        if err != nil { return nil, err }
        sess.Events = filterEvents(sess.Events)
        return sess, nil
    }),
)
```

### 3.6 Memory

Memory 管理长期用户信息，隔离维度为 `<appName, userID>`，可理解为围绕单一用户逐步积累的"个人档案"。

#### 两种模式

| 维度 | Agentic 模式 (Tools) | Auto 模式 (Extractor) |
|------|---------------------|----------------------|
| **工作方式** | Agent 决定何时调用 memory 工具 | 系统自动从对话中提取记忆 |
| **用户体验** | 可见 - 用户看到工具调用 | 透明 - 后台静默创建 |
| **控制权** | Agent 完全控制记忆内容 | Extractor 基于对话分析决定 |
| **可用工具** | add/update/search/load（默认）；delete/clear 可配置 | search 默认暴露；load 启用后暴露；写入操作被隐藏 |
| **处理方式** | 同步 - 响应生成期间 | 异步 - 后台 Worker 处理 |
| **适用场景** | 需要精确控制记忆内容 | 自然对话、无感记忆构建 |

#### Agentic 模式配置

```go
memoryService := memoryinmemory.NewMemoryService()
agent := llmagent.New("memory-assistant",
    llmagent.WithTools(memoryService.Tools()), // add/update/search/load
)
runner := runner.NewRunner("app", agent,
    runner.WithMemoryService(memoryService),
)
```

#### Auto 模式配置（推荐）

```go
extractorModel := openai.New("deepseek-v4-flash")
memExtractor := extractor.NewExtractor(extractorModel)
memoryService := memoryinmemory.NewMemoryService(
    memoryinmemory.WithExtractor(memExtractor),
    memoryinmemory.WithAsyncMemoryNum(1),
    memoryinmemory.WithMemoryQueueSize(10),
    memoryinmemory.WithMemoryJobTimeout(30*time.Second),
)
```

#### 存储后端

| 后端 | 说明 |
|------|------|
| **inmemory** | 开发测试 |
| **redis** | 生产环境 |
| **mysql** | 关系型数据库 |
| **postgres** | 关系型数据库 |
| **pgvector** | PostgreSQL + 向量搜索 |
| **sqlitevec** | SQLite + 向量搜索 |
| **mysqlvec** | MySQL + 向量搜索 |
| **mem0** | 外部长期记忆集成 |
| **tencentdb** | 腾讯云 Agent Memory |

### 3.7 Knowledge

Knowledge 提供 RAG（检索增强生成）能力。

#### 使用流程

```go
// 1. 创建 Embedder
embedder := openaiembedder.New(
    openaiembedder.WithModel("text-embedding-3-small"),
)

// 2. 创建 Vector Store
vectorStore := vectorinmemory.New()

// 3. 创建知识源
sources := []source.Source{
    filesource.New([]string{"./data/llm.md"}),
    dirsource.New([]string{"./docs"}),
}

// 4. 创建 Knowledge
kb := knowledge.New(
    knowledge.WithEmbedder(embedder),
    knowledge.WithVectorStore(vectorStore),
    knowledge.WithSources(sources),
    knowledge.WithEnableSourceSync(true),  // 启用智能同步
)

// 5. 加载文档
kb.Load(ctx,
    knowledge.WithShowProgress(true),
    knowledge.WithSourceConcurrency(4),
    knowledge.WithDocConcurrency(64),
)

// 6. 创建搜索工具
searchTool := knowledgetool.NewKnowledgeSearchTool(kb,
    knowledgetool.WithToolName("knowledge_search"),
    knowledgetool.WithMaxResults(10),
    knowledgetool.WithMinScore(0.5),
)

// 7. 集成到 Agent
agent := llmagent.New("knowledge-assistant",
    llmagent.WithModel(modelInstance),
    llmagent.WithTools([]tool.Tool{searchTool}),
)
```

#### 支持的组件

| 类别 | 支持 |
|------|------|
| **Embedder** | OpenAI、Gemini、Ollama、HuggingFace |
| **Reranker** | TopK、Cohere、Infinity/TEI |
| **VectorStore** | In-Memory、PGVector、TcVector、Elasticsearch、Qdrant、Milvus |
| **Source** | File、Directory、URL、Auto |
| **Query Enhancer** | Passthrough、LLM |
| **Extractor** | Docling（复杂格式转换） |
| **OCR** | Tesseract |
| **Filter** | 静态过滤、智能过滤（AgenticFilter） |

### 3.8 Graph Agent

Graph Agent 提供类型安全的图工作流能力，功能等价于 Go 版 LangGraph。

#### 核心概念

```go
// 1. 创建 State Schema
schema := graph.NewStateSchema()
schema.AddField("counter", graph.StateField{
    Type:    reflect.TypeOf(0),
    Reducer: graph.DefaultReducer,
})

// 2. 创建 Graph
sg := graph.NewStateGraph(schema)

// 3. 添加节点
sg.AddNode("prepare", prepareFunc)
sg.AddLLMNode("ask", modelInstance,
    graph.WithLLMNodeInstruction("You are a helpful assistant."),
    graph.WithLLMNodeTools(tools),
)
sg.AddToolsNode("tools", tools)

// 4. 添加边
sg.SetEntryPoint("prepare")
sg.AddEdge("prepare", "ask")
sg.AddToolsConditionalEdges("ask", "tools", "fallback")
sg.AddEdge("tools", "ask")
sg.SetFinishPoint("fallback")

// 5. 编译为 Agent
graph, _ := sg.Compile()
graphAgent, _ := graphagent.New("workflow", graph)

// 6. 通过 Runner 运行
r := runner.NewRunner("graph-app", graphAgent)
```

#### 节点类型

| 节点类型 | 说明 |
|----------|------|
| **Function Node** | 自定义函数节点 |
| **LLM Node** | LLM 推理节点 |
| **Tools Node** | 工具执行节点 |
| **Agent Node** | 子 Agent 节点 |

#### 路由机制

- **条件路由**：`AddConditionalEdges(nodeID, conditionFunc, pathMap)`
- **多条件扇出**：`AddMultiConditionalEdges(nodeID, conditionFunc, pathMap)`
- **命名终点**：`sg.AddNamedEnds(nodeID, endsMap)`
- **Command 模式**：节点内动态路由和扇出

#### 执行引擎

- **BSP（默认）**：确定性超步模型 (Plan → Execute → Update)
- **DAG（可选）**：无全局超步屏障的急切调度

#### 高级特性

- **Human-in-the-Loop**：中断和恢复
- **静态中断点**：调试断点
- **外部中断**：暂停按钮
- **Checkpoint**：状态持久化和时间旅行
- **Node Cache**：节点结果缓存
- **Node Retry & Backoff**：节点级重试

#### State 数据流约定

| State Key | 说明 |
|-----------|------|
| `user_input` | 一次性用户输入（消费后清理） |
| `one_shot_messages` | 一次性消息覆盖 |
| `messages` | 持久化消息历史 |
| `last_response` | 最后文本响应 |
| `last_response_id` | 最后响应 ID |
| `node_responses` | 各节点输出映射 |
| `metadata` | 通用元数据 |

### 3.9 Planner

Planner 提供 Agent 规划和推理能力，帮助 Agent 确定最优策略和工具选择。

### 3.10 Skill

Agent Skills 是遵循 Anthropic Agent Skills 规范的可复用工作流。

```go
repo, _ := skill.NewFSRepository("./skills")

tools := []tool.Tool{
    skilltool.NewLoadTool(repo),
    skilltool.NewRunTool(repo, localexec.New()),
}

agent := llmagent.New("skilled-assistant",
    llmagent.WithModel(modelInstance),
    llmagent.WithTools(tools),
    llmagent.WithCodeExecutor(localexec.New()),
    llmagent.WithEnableCodeExecutionResponseProcessor(false), // 禁用自动执行
)
```

`NewFSRepository` 支持：
- 本地目录
- HTTP(S) URL（自动下载并缓存 .zip/.tar.gz）
- 多个根目录（组合共享技能和用户私有技能）
- `repo.Refresh()` 热更新

### 3.11 Artifact

Artifact 提供版本化的文件制品存储。

```go
artifactService := artifactinmemory.NewService()

agent := llmagent.New("artifact-agent",
    llmagent.WithModel(modelInstance),
)

runner := runner.NewRunner("app", agent,
    runner.WithArtifactService(artifactService),
)
```

支持的存储后端：In-Memory、S3、COS（腾讯云对象存储）。

---

## 4. Server 与集成

### Gateway

```go
gateway.NewServer(
    gateway.WithRunner(runner),
    gateway.WithPort(8080),
)
```

### AG-UI

Agent-User Interaction 协议，提供 SSE 实时通信：

- **Chat Route**：`/agui/chat` - 实时对话
- **History Route**：`/agui/history` - 消息快照
- **Cancel Route**：`/agui/cancel` - 取消运行

### A2A

Agent-to-Agent 互操作协议：

```go
a2aAgent := a2aagent.New(
    a2aagent.WithA2AClient(a2aClient),
)
```

### OpenClaw Runtime

类似 OpenClaw 的 Gateway 实现，包含 Telegram + Gateway 集成，支持：
- 稳定 Session IDs
- Per-session 序列化
- 安全控制（allowlist + mention 门控）

---

## 5. 可观测性

### OpenTelemetry 集成

```go
import "trpc.group/trpc-go/trpc-agent-go/telemetry"

// 使用 OTLP 导出
cleanup, _ := telemetry.SetupOTLP(ctx)
defer cleanup(ctx)
```

### Langfuse 集成

```go
import "trpc.group/trpc-go/trpc-agent-go/telemetry/langfuse"

clean, _ := langfuse.Start(ctx)
defer clean(ctx)

runner := runner.NewRunner("app", agent)
events, _ := runner.Run(ctx, "user-1", "session-1", message,
    agent.WithSpanAttributes(
        attribute.String("langfuse.user.id", "user-1"),
        attribute.String("langfuse.session.id", "session-1"),
    ))
```

### 执行 Trace

```go
import "trpc.group/trpc-go/trpc-agent-go/agent/trace"

// 获取执行 Trace
trace := agent.GetExecutionTrace(invocation)
```

---

## 6. Quick Start 示例

### 最简 Agent

```go
package main

import (
    "context"
    "fmt"
    "log"

    "trpc.group/trpc-go/trpc-agent-go/agent/llmagent"
    "trpc.group/trpc-go/trpc-agent-go/model"
    "trpc.group/trpc-go/trpc-agent-go/model/openai"
    "trpc.group/trpc-go/trpc-agent-go/runner"
    "trpc.group/trpc-go/trpc-agent-go/tool"
    "trpc.group/trpc-go/trpc-agent-go/tool/function"
)

func main() {
    // 1. 创建模型
    modelInstance := openai.New("deepseek-v4-flash",
        openai.WithVariant(openai.VariantDeepSeek),
    )

    // 2. 创建工具
    calculatorTool := function.NewFunctionTool(
        calculator,
        function.WithName("calculator"),
        function.WithDescription("加减乘除运算"),
    )

    // 3. 创建 Agent
    agent := llmagent.New("assistant",
        llmagent.WithModel(modelInstance),
        llmagent.WithTools([]tool.Tool{calculatorTool}),
        llmagent.WithGenerationConfig(model.GenerationConfig{
            Stream: true,
        }),
    )

    // 4. 创建 Runner
    r := runner.NewRunner("calculator-app", agent)
    defer r.Close()

    // 5. 执行对话
    ctx := context.Background()
    events, err := r.Run(ctx, "user-001", "session-001",
        model.NewUserMessage("计算 2+3 等于多少"),
    )
    if err != nil {
        log.Fatal(err)
    }

    // 6. 处理事件流
    for event := range events {
        if event.Object == "chat.completion.chunk" {
            fmt.Print(event.Response.Choices[0].Delta.Content)
        }
    }
    fmt.Println()
}

func calculator(ctx context.Context, req struct {
    A  float64 `json:"a" jsonschema:"description=第一操作数,required"`
    B  float64 `json:"b" jsonschema:"description=第二操作数,required"`
    Op string  `json:"op" jsonschema:"description=操作类型,enum=add,enum=sub,enum=mul,enum=div,required"`
}) (map[string]any, error) {
    var result float64
    switch req.Op {
    case "add", "+": result = req.A + req.B
    case "sub", "-": result = req.A - req.B
    case "mul", "*": result = req.A * req.B
    case "div", "/": result = req.A / req.B
    default: return nil, fmt.Errorf("invalid operation: %s", req.Op)
    }
    return map[string]any{"result": result}, nil
}
```

### 多 Agent 协作

```go
// 创建分析 Agent
analyzer := llmagent.New("analyzer",
    llmagent.WithModel(modelInstance),
    llmagent.WithInstruction("Analyze the input and break it down into steps."),
)

// 创建执行 Agent
executor := llmagent.New("executor",
    llmagent.WithModel(modelInstance),
    llmagent.WithInstruction("Execute the given steps."),
)

// 组合为 Chain
pipeline := chainagent.New("problem-solver",
    chainagent.WithSubAgents([]agent.Agent{analyzer, executor}),
)

r := runner.NewRunner("multi-agent-app", pipeline)
events, _ := r.Run(ctx, userID, sessionID, message)
```

### 带记忆的 Agent

```go
memoryService := memoryinmemory.NewMemoryService(
    memoryinmemory.WithExtractor(extractor.NewExtractor(extractorModel)),
    memoryinmemory.WithAsyncMemoryNum(1),
)

agent := llmagent.New("memory-assistant",
    llmagent.WithModel(modelInstance),
    llmagent.WithTools(memoryService.Tools()),
)

r := runner.NewRunner("memory-app", agent,
    runner.WithSessionService(sessionService),
    runner.WithMemoryService(memoryService),
)
```

### RAG 知识检索 Agent

```go
kb := knowledge.New(
    knowledge.WithEmbedder(openaiembedder.New()),
    knowledge.WithVectorStore(vectorinmemory.New()),
    knowledge.WithSources([]source.Source{
        filesource.New([]string{"./data/doc.md"}),
    }),
)
kb.Load(ctx)

searchTool := knowledgetool.NewKnowledgeSearchTool(kb,
    knowledgetool.WithToolName("search_docs"),
)

agent := llmagent.New("rag-assistant",
    llmagent.WithModel(modelInstance),
    llmagent.WithTools([]tool.Tool{searchTool}),
)
```

### GraphAgent 工作流

```go
sg := graph.NewStateGraph(graph.MessagesStateSchema())

sg.AddLLMNode("ask", modelInstance,
    graph.WithLLMNodeInstruction("You are a helpful assistant."),
    graph.WithLLMNodeTools(tools),
)
sg.AddToolsNode("tools", tools)
sg.AddNode("fallback", func(ctx context.Context, s graph.State) (any, error) {
    return graph.State{"result": "done"}, nil
})

sg.SetEntryPoint("ask")
sg.AddToolsConditionalEdges("ask", "tools", "fallback")
sg.AddEdge("tools", "ask")
sg.SetFinishPoint("fallback")

g, _ := sg.Compile()
graphAgent, _ := graphagent.New("workflow", g,
    graphagent.WithDescription("A workflow agent"),
)

r := runner.NewRunner("graph-app", graphAgent)
events, _ := r.Run(ctx, "user-1", "session-1",
    model.NewUserMessage("What is 2+3?"),
)
```

---

## 7. 最佳实践

### 7.1 推荐的使用模式

1. **始终使用 Runner**：不要直接调用 Agent 接口，Runner 提供了 Session、Memory、插件等集成
2. **正确关闭 Runner**：使用 `defer r.Close()` 释放资源
3. **使用 `event.IsRunnerCompletion()` 判断结束**：比 `event.IsFinalResponse()` 更可靠

### 7.2 安全建议

- 设置 `MaxLLMCalls` 和 `MaxToolIterations` 防止无限循环
- 使用 `WithToolPermissionPolicyFunc` 控制危险工具
- 启用 `WithToolCallArgumentsJSONRepairEnabled` 提高鲁棒性
- 使用 Session Hook 进行内容安全过滤

### 7.3 性能建议

- 生产环境使用 Redis/PostgreSQL 等持久化 Session 存储
- 启用 Session Summary 减少 Token 消耗
- 使用 Prompt Caching 降低成本
- 合理配置 Knowledge 的并发参数 `WithSourceConcurrency` / `WithDocConcurrency`

### 7.4 错误处理

```go
for event := range eventChan {
    if event.Error != nil {
        log.Printf("Error: %s (type: %s)", event.Error.Message, event.Error.Type)
        continue
    }
    // ...
    if event.IsRunnerCompletion() {
        break
    }
}
```

### 7.5 运行取消

```go
// 推荐：取消 context
ctx, cancel := context.WithCancel(context.Background())
defer cancel()

// Ctrl+C
ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt)
defer stop()

// 按 RequestID
mr := r.(runner.ManagedRunner)
mr.Cancel(requestID)
```

---

## 8. 生态与对比

### 与 Python Agent 框架的对比

| 特性 | tRPC-Agent-Go | LangChain | AutoGen | CrewAI |
|------|:---:|:---:|:---:|:---:|
| **语言** | Go | Python | Python | Python |
| **多 Agent 协作** | ✅ | ✅ | ✅ | ✅ |
| **Graph 工作流** | ✅ (GraphAgent) | ✅ (LangGraph) | ❌ | ❌ |
| **MCP 协议** | ✅ | ❌ | ❌ | ❌ |
| **A2A 协议** | ✅ | ❌ | ❌ | ❌ |
| **AG-UI 协议** | ✅ | ❌ | ❌ | ❌ |
| **Agent Skills** | ✅ | ❌ | ❌ | ❌ |
| **Artifacts** | ✅ | ❌ | ❌ | ❌ |
| **评测框架** | ✅ | ✅ (LangSmith) | ❌ | ❌ |
| **内存/并发** | 高 | 低 | 中 | 中 |

### 腾讯内部验证

tRPC-Agent-Go 已在以下业务中获得验证：
- 腾讯元宝（AI 助手）
- 腾讯视频（内容推荐）
- 腾讯新闻（信息检索）
- IMA（智能客服）
- QQ 音乐（个性化推荐）

### 开源灵感来源

受 ADK、Agno、CrewAI、AutoGen、LangGraph 等优秀框架启发。

---

## 附录

### 子包索引

```
trpc.group/trpc-go/trpc-agent-go/
├── agent/                    # Agent 核心接口与实现
│   ├── a2aagent/            # A2A 互操作 Agent
│   ├── chainagent/          # 链式 Agent
│   ├── claudecode/          # Claude Code CLI Agent
│   ├── codex/               # Codex CLI Agent
│   ├── cycleagent/          # 循环 Agent
│   ├── dify/                # Dify Agent
│   ├── extension/           # Agent 扩展（如 todoenforcer）
│   ├── graphagent/          # 图 Agent
│   ├── llmagent/            # LLM Agent
│   │   └── builtin/         # 内置 Agent 预设
│   ├── parallelagent/       # 并行 Agent
│   ├── structure/           # 静态结构导出
│   ├── taskrun/             # 后台任务运行
│   └── trace/               # 执行 Trace 模型
├── artifact/                 # 制品存储
│   ├── cos/                 # 腾讯云 COS
│   ├── inmemory/            # 内存存储
│   └── s3/                  # S3 存储
├── codeexecutor/             # 代码执行器
│   ├── container/           # 容器执行
│   ├── e2b/                 # E2B 代码解释器
│   ├── jupyter/             # Jupyter 执行
│   ├── local/               # 本地执行
│   └── workspaceio/         # 工作区 I/O
├── event/                    # 事件系统
├── evaluation/               # 评测框架
├── graph/                    # 图执行引擎
│   └── checkpoint/          # 检查点（inmemory/sqlite/redis）
├── knowledge/                # RAG 知识系统
│   ├── embedder/            # 嵌入模型
│   ├── reranker/            # 重排序
│   ├── source/              # 知识源
│   ├── vectorstore/         # 向量存储
│   ├── filter/              # 过滤器
│   ├── extractor/           # 内容提取器
│   ├── query/               # 查询增强器
│   └── ocr/                 # OCR 识别
├── memory/                   # 记忆服务
├── model/                    # 模型抽象层
│   ├── openai/              # OpenAI 兼容
│   ├── anthropic/           # Anthropic 兼容
│   └── provider/            # Provider 注册机制
├── planner/                  # 规划器
├── plugin/                   # 插件系统
├── runner/                   # 运行器
├── server/                   # HTTP 服务
│   ├── gateway/             # Gateway
│   ├── agui/                # AG-UI 协议
│   ├── a2a/                 # A2A 协议
│   └── openclaw-runtime/    # OpenClaw 运行时
├── session/                  # 会话管理
│   └── summary/             # 会话摘要
├── skill/                    # Agent Skills
├── telemetry/                # 可观测性
└── tool/                     # 工具系统
    ├── function/             # 函数工具
    ├── claudecode/           # Claude Code 工具集
    ├── duckduckgo/           # DuckDuckGo 搜索
    ├── mcp/                  # MCP 工具
    ├── todo/                 # Todo 工具
    └── webfetch/             # Web 抓取
```
