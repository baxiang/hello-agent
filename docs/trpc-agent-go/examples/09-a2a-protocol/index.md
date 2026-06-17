# A2A 协议 - Agent-to-Agent 跨框架互操作

> **源码路径**：[`trpc-agent-go/examples/`](../../../../trpc-agent-go/examples)（本分类覆盖 a2a 下的 adk/agent/codeexecution/multipath/subagent）
> **本页**：分类索引 + 深度原理（融合原 17-a2a.md）

## 子示例导航

| 子示例 | 文章 | 难度 | 一句话说明 |
|--------|------|------|-----------|
| [`a2aadk/`](./a2aadk.md) | A2A ADK 互操作 | 入门 | Go 客户端对接 Python ADK 服务器，跨语言工具调用与代码执行 |
| [`a2aagent/`](./a2aagent.md) | A2A Agent | 进阶 | 搭建 A2A 服务器 + 客户端，含自动发现、自定义 DataPart、结构化错误 |
| [`a2acodeexecution/`](./a2acodeexecution.md) | A2A 代码执行 | 进阶 | 构建具备本地 Python 代码执行能力的 A2A 服务器 |
| [`a2amultipath/`](./a2amultipath.md) | A2A 多路径 | 进阶 | 单端口多 URL 路径暴露多个 Agent（生产部署推荐模式） |
| [`a2asubagent/`](./a2asubagent.md) | A2A 子 Agent 协作 | 进阶 | 协调者模式，中心 Coordinator 分发任务给多个远程专业子 Agent |

## 选型建议

```
需要跨框架/跨语言调用远程 Agent？
├── 快速验证 Go ↔ Python ADK 互操作      → a2aadk（最小跨语言对接）
├── 搭建完整 A2A 服务端 + 客户端          → a2aagent（含发现/错误处理）
├── 远程 Agent 要执行代码                → a2acodeexecution（Python 代码执行）
└── 协调者编排多个远程专业 Agent          → a2asubagent（Coordinator 分发）

部署形态选型？
├── 单进程多 Agent                       → a2amultipath（单端口多路径）
└── 独立进程独立扩缩                     → 各示例均可，配合 a2asubagent 编排
```

**各子示例差异**：`a2aadk` 偏「客户端视角对接现成服务」；`a2aagent` 是「服务端 + 客户端双向完整闭环」；`a2acodeexecution` 聚焦「远程能力扩展」；`a2amultipath` 解决「部署拓扑」；`a2asubagent` 解决「多 Agent 编排拓扑」。

## 核心概念

- **A2A**：Google 提出的跨框架 Agent 互操作开放标准。tRPC-Agent-Go 基于 `trpc-a2a-go` 实现完整客户端，可将任何兼容 A2A 的远程 Agent 包装为本地 `agent.Agent`。详见 [深度原理 › A2A 协议核心接口](#a2a-协议核心接口)
- **Task**：A2A 协议的核心工作单元，承载一次 Agent 执行的状态流转与产出。状态机覆盖 `submitted → working → {completed|failed|cancelled}`。详见 [深度原理 › Task 模型与生命周期](#task-模型与生命周期)
- **Agent Card**：远程 Agent 通过 `/.well-known/agent-card.json` 声明能力（skills、capabilities、鉴权、I/O 模式），客户端据此发现与选择 Agent。详见 [深度原理 › Agent Card 与发现](#agent-card-与发现)

## 深度原理

> 本节源自原「核心组件」深度文（17-a2a.md），整合接口源码签名、设计哲学与配置速查。

### A2A 在 tRPC-Agent-Go 中的位置

A2A 的核心价值是让远程 Agent 对 Coordinator **完全透明**：

```
┌──────────────────────────────────────────────────────────┐
│                  Coordinator (LLMAgent)                   │
│                                                          │
│  SubAgents:                                              │
│  ├── WeatherAgent (本地 LLMAgent)                        │
│  ├── MathAgent (本地 LLMAgent)                            │
│  ├── A2AAgent → Remote Python ADK Agent（A2A 协议）       │
│  └── A2AAgent → Remote LangChain Agent（A2A 协议）        │
│                                                          │
│  对 Coordinator 来说，所有 SubAgent 都是 agent.Agent 接口 │
│  无论本地还是远程，调用方式完全一致                         │
└──────────────────────────────────────────────────────────┘
```

### A2A 协议核心接口

A2A 客户端分两层：`trpc-a2a-go/client` 负责 HTTP/SSE 传输，`agent/a2aagent` 将其包装为 `agent.Agent` 接口实现。

**核心 API 签名**：

```go
// trpc-a2a-go/client：创建 A2A 传输客户端
func New(opts ...Option) (*Client, error)

// trpc-agent-go/agent/a2aagent：包装为本地 Agent
func New(opts ...Option) agent.Agent
```

**最小接线**（客户端 + 包装 + 接入 Coordinator）：

```go
import (
    "trpc.group/trpc-go/trpc-agent-go/agent/a2aagent"
    "trpc.group/trpc-go/trpc-a2a-go/client"
)

// 1. 创建 A2A 传输客户端
a2aClient, _ := client.New(
    client.WithBaseURL("https://remote-agent.example.com"),
    client.WithHTTPClient(&http.Client{Timeout: 60 * time.Second}),
)

// 2. 包装为 tRPC-Agent-Go Agent
remoteAgent := a2aagent.New(
    a2aagent.WithA2AClient(a2aClient),
    a2aagent.WithStreaming(true),
)

// 3. 当作本地 Agent 使用，与本地 Agent 并列
coordinator := llmagent.New("coordinator",
    llmagent.WithModel(model),
    llmagent.WithSubAgents([]agent.Agent{
        localWeatherAgent,
        remoteAgent,
    }),
)

r := runner.NewRunner("app", coordinator)
events, _ := r.Run(ctx, "user-1", "session-1",
    model.NewUserMessage("Analyze the market data and give weather forecast."),
)
```

**关键设计**：`A2AAgent` 实现了 `agent.Agent` 接口（`Run/Info/SubAgents` 三件套），对上层完全透明。Coordinator 不关心 SubAgent 是本地的还是远程的，本地与远程 Agent 在 SubAgents 列表中并列出现。

### Task 模型与生命周期

A2A 通过 HTTP `POST /tasks` 发起任务，通过 SSE 流式回传状态与产出。完整生命周期：

```
[Go Client]                              [Python Remote Agent]
     │                                            │
     ├─ POST /tasks ────────────────────────────→ │
     │   {method: "tasks/send",                    │
     │    params: {id: "task-1",                   │
     │            message: {role:"user",           │
     │                      parts:[{text:"..."}]}}}│
     │                                            ├─ Agent 处理 / 调用 LLM / 执行工具
     │  ←────── SSE event: status ─────────────   │  {state: "working", ...}
     │  ←────── SSE event: artifact ───────────   │  {parts: [{text: "The analysis..."}]}
     │  ←────── SSE event: final ──────────────   │  {state: "completed"}
```

**TaskStatus 状态机**——四态有限自动机，不可回退：

```
                    ┌─────────────┐
                    │  submitted  │ (初始状态)
                    └──────┬──────┘
                           │
                    ┌──────▼──────┐
                    │   working   │ (Agent 执行中)
                    └──────┬──────┘
                           │
              ┌────────────┼────────────┐
              │            │            │
     ┌────────▼───┐  ┌────▼─────┐  ┌───▼────────┐
     │  completed │  │  failed  │  │  cancelled  │
     └────────────┘  └──────────┘  └────────────┘
```

**Task 数据模型**核心字段：

| 字段 | 作用 |
|------|------|
| `id` / `sessionId` | Task 唯一标识与归属会话，支撑多轮续接 |
| `status.state` | 状态机当前态，驱动客户端行为 |
| `status.message` | 状态附带的消息（如 working 时的进度说明） |
| `artifacts` | 产出物列表，每个 artifact 由若干 `parts` 组成（text/file/data） |
| `history` | Message 列表，记录对话全量历史 |

Task 的 `parts` 是多态的：`text`（纯文本）、`file`（含 url/mimeType/bytes，支持二进制如图表）、`data`（结构化 DataPart，详见 `a2aagent` 子示例的自定义 DataPart）。

### Agent Card 与发现

远程 Agent 通过 Agent Card 声明能力与接口，客户端据此做服务发现与选择。

**Agent Card 结构**（`GET /.well-known/agent-card.json`）：

```json
{
    "name": "Weather Analyst",
    "description": "Analyzes weather patterns and provides forecasts",
    "url": "https://remote-agent.example.com",
    "capabilities": {
        "streaming": true,
        "pushNotifications": false
    },
    "skills": [
        {
            "id": "weather_analysis",
            "name": "Weather Analysis",
            "description": "Analyze historical weather data and provide forecasts",
            "tags": ["weather", "analysis", "forecast"],
            "examples": ["What's the weather forecast for Tokyo?"]
        }
    ],
    "defaultInputModes": ["text"],
    "defaultOutputModes": ["text"],
    "authentication": {
        "schemes": ["bearer"]
    }
}
```

**三种发现模式**：

```go
// 1. 显式指定 BaseURL（已知地址，最简单）
a2aagent.New(a2aagent.WithA2AClient(a2aClient))

// 2. 通过 Agent Card URL 自动发现（客户端拉取 Card 解析能力）
agent, _ := a2aagent.New(
    a2aagent.WithAgentCardURL("https://remote-agent.example.com"),
)

// 3. 注册中心发现模式（按 skill 选择，适合多 Agent 动态路由）
agent, _ := a2aagent.New(
    a2aagent.WithRegistryURL("https://registry.example.com"),
    a2aagent.WithAgentSelector("weather_analysis"),
)
```

`skills` 是发现与路由的核心维度：协调者可基于用户意图匹配 skill id/tags，自动定位到合适的远程 Agent。

### 设计哲学

#### 为什么需要 A2A？跨框架互操作与解耦

tRPC-Agent-Go 的本地 Agent 体系（SubAgents / AgentTool）只能在本进程内、同语言、同框架间协作。A2A 解决的是**跨边界**场景：

- **跨语言**：Go 编排层调用 Python/LangChain 等异构 Agent
- **跨框架**：任何实现 A2A 标准的框架都可互通，不锁定技术栈
- **独立部署**：远程 Agent 可独立扩缩容、独立升级、独立团队治理
- **安全隔离**：进程级与网络级隔离，避免共享内存带来的风险

#### A2A vs AgentTool 选择

| | A2A Agent | AgentTool |
|----|----|----|
| **通信方式** | HTTP/SSE 跨进程 | 进程内函数调用 |
| **协议标准** | ✅ A2A 开放标准 | ❌ 框架专有 |
| **跨语言** | ✅ 任何语言 | ❌ 仅 Go |
| **跨框架** | ✅ 任何 A2A 实现 | ❌ 仅 tRPC-Agent-Go |
| **延迟** | 网络延迟 + 序列化 | 零开销函数调用 |
| **独立部署** | ✅ 独立扩缩 | ❌ 共享进程资源 |
| **安全隔离** | ✅ 进程/网络隔离 | ❌ 共享内存 |
| **状态管理** | A2A Session | Agent Invocation |
| **适用场景** | 跨团队/跨组织 Agent | 同一进程内的专家 Agent |

**选择决策树**：

```
需要跨团队/跨语言/跨框架协作？
├── 是 → A2A Agent
└── 否 → 同一进程内拆分 Agent？
         ├── 是 → AgentTool 或 SubAgents
         └── 否 → 单一 LLMAgent 即可
```

#### A2A 与 MCP / AG-UI 的边界

三者正交、可组合，各管一段：

- **A2A**：Agent ↔ Agent 的互操作协议（谁调用哪个 Agent）
- **MCP**：Agent ↔ Tool 的工具协议（Agent 调用什么工具/数据源）
- **AG-UI**：Agent ↔ Frontend 的前端协议（用户如何看到 Agent 过程）

典型的「Go 做编排、Python 做分析」混合架构：

```
[User Frontend]
     │ AG-UI (SSE)
     ▼
[Go Coordinator Agent]
     │
     ├── A2A ──→ [Python Data Analysis Agent]
     │               ├── MCP ──→ [Database Tool Server]
     │               └── MCP ──→ [Chart Generation Server]
     │
     └── MCP ──→ [Internal API Server]
```

- Go Coordinator 通过 A2A 将分析任务委托给 Python Agent
- Python Agent 通过 MCP 调用数据库和图表工具
- Go Coordinator 同时通过 MCP 调用内部 API
- 前端通过 AG-UI 实时看到整个协作过程

**边界原则**：A2A 管 Agent 间的委托，MCP 管 Agent 到外部能力的接入，AG-UI 管人机交互。三者不应混用——不要用 MCP 去做 Agent 间通信，也不要用 A2A 去调用单个工具。

#### 为什么 A2AAgent 要实现 agent.Agent 接口？

「接口透明」是 A2A 集成的核心设计：远程 Agent 和本地 Agent 实现同一个 `agent.Agent` 接口，Coordinator 的 `WithSubAgents` 列表中二者完全平等。好处：

1. Coordinator 代码零修改即可接入远程 Agent
2. 本地/远程可平滑迁移——开发期用本地 Agent，生产期换成 A2A 远程 Agent
3. 测试友好——可注入 mock Agent 替换真实远程调用

#### 为什么用 SSE 流式而非请求-响应？

A2A 的 Agent 执行通常较长（LLM 推理 + 多步工具调用）。SSE 流式让客户端：

- 实时获取 `working` 进度，而非长时间阻塞等待
- 增量接收 artifact，首字延迟低
- 支持中途取消（cancel 对应 `cancelled` 状态）

### 配置速查

#### A2A 传输客户端（`trpc-a2a-go/client.New`）

| 配置选项 | 类型 | 说明 |
|----------|------|------|
| `client.WithBaseURL(url)` | `string` | 远程 Agent 的基础 URL（必填） |
| `client.WithHTTPClient(c)` | `*http.Client` | 自定义 HTTP 客户端（超时、传输层配置） |

#### A2AAgent 包装（`agent/a2aagent.New`）

| 配置选项 | 类型 | 说明 |
|----------|------|------|
| `a2aagent.WithA2AClient(c)` | `*client.Client` | 注入已创建的 A2A 传输客户端（显式模式） |
| `a2aagent.WithStreaming(b)` | `bool` | 启用 SSE 流式接收（推荐） |
| `a2aagent.WithAgentCardURL(url)` | `string` | 通过 Agent Card URL 自动发现 |
| `a2aagent.WithRegistryURL(url)` | `string` | 注册中心发现模式 |
| `a2aagent.WithAgentSelector(skill)` | `string` | 按 skill id 选择目标 Agent（配合 RegistryURL） |

**三种接入模式速记**：`WithA2AClient`（显式地址）｜`WithAgentCardURL`（Card 自动发现）｜`WithRegistryURL + WithAgentSelector`（注册中心 + skill 路由）。

## 学习路径建议

1. **先读 [`a2aadk`](./a2aadk.md)**：用最小代价跑通 Go ↔ Python ADK 的跨语言对接，建立「远程 Agent 即本地 Agent」的直觉
2. **再读 [`a2aagent`](./a2aagent.md)**：看服务端 + 客户端完整闭环，理解 Agent Card、自定义 DataPart、结构化错误
3. **按能力扩展分支**：
   - 远程 Agent 要执行代码 → [`a2acodeexecution`](./a2acodeexecution.md)
   - 单端口部署多 Agent → [`a2amultipath`](./a2amultipath.md)
4. **进阶读 [`a2asubagent`](./a2asubagent.md)**：理解 Coordinator 协调者模式如何编排多个远程专业 Agent
5. **回到本页「深度原理」节**：在跑通示例后重读接口签名、状态机与 A2A/MCP/AG-UI 边界，理解「为什么这么设计」
6. **对照选型**：用本文「A2A vs AgentTool」表和决策树，判断你的场景是否真的需要 A2A

## 总结

A2A 分类的设计精髓在于**接口透明、协议开放、边界正交**：

- **接口透明**：`A2AAgent` 实现 `agent.Agent`，远程与本地 Agent 在 Coordinator 眼中完全平等，零侵入接入
- **协议开放**：基于 Google A2A 标准，跨语言跨框架，不锁定技术栈，支持独立部署与扩缩
- **边界正交**：A2A 管 Agent 间委托，MCP 管工具接入，AG-UI 管人机交互，三者各司其职、自由组合
- **Task 状态机**：`submitted → working → {completed|failed|cancelled}` 四态有限自动机 + SSE 流式，支撑长任务进度可见与中途取消

进一步学习：

- Agent 基础与 Coordinator 模式：[`01-agent-basics`](../01-agent-basics/)
- 多 Agent 编排（本地 SubAgents / AgentTool）：[`05-multi-agent`](../05-multi-agent/)
- 工具系统（MCP 对照）：[`02-tool-system`](../02-tool-system/)
- 宏观架构与组件关系：[`18-architecture`](../../18-architecture.md)
