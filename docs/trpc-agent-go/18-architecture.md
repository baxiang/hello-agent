# tRPC-Agent-Go 架构图与流程图全集

> 本文通过 11 幅 Mermaid 图完整呈现 tRPC-Agent-Go 的系统架构、核心流程与数据流。

---

## 1. 整体系统架构

```mermaid
graph TB
    subgraph 外部["外部世界"]
        User["用户/前端"]
        A2ARemote["远程 A2A Agent"]
        MCPServer["MCP Tool Server"]
    end

    subgraph Server["Server 层"]
        Gateway["Gateway HTTP"]
        AGUI["AG-UI SSE"]
        A2ASrv["A2A Server"]
        OpenClaw["OpenClaw IM 网关"]
    end

    subgraph Runner["Runner 层"]
        R["Runner"]
        Plugin["Plugin 插件链"]
    end

    subgraph Agent["Agent 层"]
        LLMA["LLMAgent"]
        Chain["ChainAgent"]
        Parallel["ParallelAgent"]
        Cycle["CycleAgent"]
        Graph["GraphAgent"]
        A2AAgent["A2AAgent"]
    end

    subgraph Core["核心组件"]
        Model["Model 模型层"]
        Tool["Tool 工具系统"]
        Planner["Planner 规划器"]
        CodeExec["CodeExecutor"]
    end

    subgraph State["状态管理"]
        Session["Session 会话"]
        Memory["Memory 记忆"]
        Knowledge["Knowledge RAG"]
    end

    subgraph Infra["基础设施"]
        OTel["OpenTelemetry"]
        Langfuse["Langfuse"]
        Skill["Skill 仓库"]
        Artifact["Artifact 存储"]
    end

    User --> Gateway
    User --> AGUI
    A2ARemote --> A2ASrv

    Gateway --> R
    AGUI --> R
    OpenClaw --> R

    R --> Plugin
    R --> LLMA
    R --> Chain
    R --> Parallel
    R --> Cycle
    R --> Graph

    LLMA --> Model
    LLMA --> Tool
    LLMA --> Planner
    LLMA --> CodeExec

    Chain --> LLMA
    Parallel --> LLMA
    Cycle --> LLMA
    Graph --> LLMA

    A2AAgent --> A2ARemote

    R --> Session
    R --> Memory
    LLMA --> Knowledge
    LLMA --> Memory
    Graph --> Knowledge

    R --> OTel
    R --> Langfuse

    Tool --> MCPServer
    CodeExec --> Skill
    Agent --> Artifact

    style User fill:#e1f5fe
    style R fill:#fff3e0
    style LLMA fill:#e8f5e9
    style Model fill:#fce4ec
    style Tool fill:#f3e5f5
    style Session fill:#e0f2f1
```

---

## 2. 请求完整生命周期

```mermaid
sequenceDiagram
    autonumber
    participant U as User
    participant FE as Frontend
    participant GW as Gateway/AG-UI
    participant R as Runner
    participant SS as Session Service
    participant A as Agent
    participant M as Model
    participant T as Tool

    U->>FE: 输入消息
    FE->>GW: POST /chat
    GW->>R: Run(ctx, userID, sessionID, message)

    rect rgb(230, 245, 230)
    Note over R,SS: 阶段 1: 准备
    R->>SS: GetSession(key)
    SS-->>R: Session{Events, State}
    R->>R: 构建 Invocation
    R->>R: 执行 BeforeAgent 插件链
    end

    rect rgb(255, 243, 224)
    Note over R,M: 阶段 2: Agent 执行
    R->>A: agent.RunWithPlugins(ctx, inv)

    loop LLM 推理循环
        A->>A: buildMessages
        A->>M: GenerateContent(ctx, request)
        M-->>A: 流式 chunk (text/tool_call/refusal)

        alt 文本回复
            A-->>R: event{content: "..."}
        else 工具调用
            A-->>R: event{tool_calls: [...]}
            A->>T: Tool.Call(ctx, jsonArgs)
            T-->>A: tool result
            A->>A: append tool result → messages
        else 安全拒绝
            A-->>R: event{refusal: "..."}
        end
    end
    end

    rect rgb(227, 242, 253)
    Note over R,SS: 阶段 3: 后处理
    R->>SS: AppendEvent(non-partial events)
    R-->>GW: 流式 event channel
    GW-->>FE: SSE 实时推送
    FE-->>U: 逐字渲染
    end

    rect rgb(252, 228, 236)
    Note over R,SS: 阶段 4: 完成
    R->>R: 触发 Memory 后台提取
    R-->>GW: runner.completion 事件
    GW-->>FE: run_finished
    FE-->>U: 完成提示
    end
```

---

## 3. LLMAgent 执行循环

```mermaid
flowchart TD
    START(["Run(ctx, invocation)"]) --> INIT["初始化 LLMFlow"]
    INIT --> LOOP{"循环入口"}

    LOOP --> BUILD["构建 messages"]
    BUILD --> CALL["model.GenerateContent()"]
    CALL --> CHUNK{"遍历 response chunk"}

    CHUNK -->|"每个 chunk"| EMIT["发射 event → channel"]
    EMIT --> CHUNK

    CHUNK -->|"response.Done"| CHECK_TYPE{"choice 类型?"}

    CHECK_TYPE -->|"content ≠ null"| TEXT_REPLY["文本回复"]
    TEXT_REPLY --> END(["结束循环 → close channel"])

    CHECK_TYPE -->|"tool_calls ≠ null"| EXEC_TOOLS["执行工具<br/>BeforeTool → PermissionCheck → Call → AfterTool"]
    EXEC_TOOLS --> APPEND["工具结果 append 到 messages"]
    APPEND --> CHECK_LIMITS{"检查限制"}
    CHECK_LIMITS -->|"MaxToolIterations 超限"| FLOW_ERR["发出 flow_error → 结束"]
    CHECK_LIMITS -->|"MaxLLMCalls 超限"| STOP_ERR["返回 StopError"]
    CHECK_LIMITS -->|"正常"| LOOP

    CHECK_TYPE -->|"refusal ≠ null"| REFUSE["安全拒绝"]
    REFUSE --> END

    style START fill:#e8f5e9
    style END fill:#fce4ec
    style CALL fill:#fff3e0
    style EXEC_TOOLS fill:#e3f2fd
```

---

## 4. 事件系统数据流

```mermaid
flowchart LR
    subgraph Producer["事件生产者"]
        AG["Agent Goroutine"]
        TG["Tool Goroutine"]
        MG["Model Goroutine"]
    end

    subgraph Pipeline["事件管道"]
        CH["chan *event.Event<br/>(buffer=256)"]
    end

    subgraph Consumer["事件消费者"]
        RW["Runner<br/>持久化到 Session"]
        FE["Frontend<br/>SSE 实时渲染"]
        PL["Plugin<br/>拦截/修改"]
        OB["Observability<br/>OTel Span/Langfuse"]
    end

    AG -->|"event{content}"| CH
    TG -->|"event{tool_call}"| CH
    MG -->|"event{chunk}"| CH

    CH --> RW
    CH --> FE
    CH --> PL
    CH --> OB

    style CH fill:#fff3e0,stroke:#f57c00
```

---

## 5. Multi-Agent 编排模式

```mermaid
flowchart TD
    subgraph ChainAgent["ChainAgent: 顺序流水线"]
        C_IN["输入"] --> C1["Agent A"]
        C1 --> C2["Agent B"]
        C2 --> C3["Agent C"]
        C3 --> C_OUT["输出"]
    end

    subgraph ParallelAgent["ParallelAgent: 并发分析"]
        P_IN["输入"] --> P1["Agent A"]
        P_IN --> P2["Agent B"]
        P_IN --> P3["Agent C"]
        P1 --> P_MERGE["合并结果"]
        P2 --> P_MERGE
        P3 --> P_MERGE
        P_MERGE --> P_OUT["输出"]
    end

    subgraph CycleAgent["CycleAgent: 迭代优化"]
        CY_START["输入"] --> CY_PLAN["Planner"]
        CY_PLAN --> CY_EXEC["Executor"]
        CY_EXEC --> CY_CHECK{"满足退出条件?"}
        CY_CHECK -->|"否"| CY_PLAN
        CY_CHECK -->|"是"| CY_OUT["输出"]
    end

    subgraph AgentTool["AgentTool: 委托调用"]
        AT_COORD["Coordinator"] -->|"tool_call"| AT_SUB["Specialist Agent"]
        AT_SUB -->|"tool_result"| AT_COORD
    end
```

---

## 6. Graph Agent — BSP 执行引擎

```mermaid
flowchart TD
    subgraph Superstep1["Superstep 1"]
        N_PREP["prepare: 预处理"]
    end

    N_PREP --> Superstep2

    subgraph Superstep2["Superstep 2"]
        N_LLM["ask: LLM 推理"]
    end

    N_LLM -->|"finish_reason=tool_calls"| Superstep3
    N_LLM -->|"finish_reason=stop"| Superstep4

    subgraph Superstep3["Superstep 3"]
        N_TOOL["tools: 执行工具"]
    end

    N_TOOL -->|"工具结果 → messages"| Superstep2

    subgraph Superstep4["Superstep 4"]
        N_DONE["fallback: 结束"]
    end

    subgraph Parallel["并行扇出示例"]
        ROUTER["router"] --> A["Node A"]
        ROUTER --> B["Node B"]
        ROUTER --> C["Node C"]
        A --> JOIN["join barrier"]
        B --> JOIN
        C --> JOIN
        JOIN --> NEXT["下游节点"]
    end

    style N_LLM fill:#e3f2fd
    style N_TOOL fill:#fff3e0
    style JOIN fill:#fce4ec
```

---

## 7. Memory + Session 记忆系统

```mermaid
flowchart TD
    subgraph 在线路径["在线路径（用户对话中）"]
        U_MSG["用户消息"] --> AGENT["Agent 处理"]
        AGENT --> PRELOAD["Memory 预加载<br/>注入最近 5 条记忆 → System Prompt"]
        AGENT --> SEARCH["memory_search<br/>Agent 主动查询记忆"]
    end

    subgraph SessionPath["Session 持久化"]
        AGENT --> SS["Session Service"]
        SS --> DB["存储后端<br/>Memory/SQLite/Redis/PG/MySQL/ClickHouse"]
    end

    subgraph 离线路径["离线路径（后台异步）"]
        AGENT --> CHECK{"Extractor Check<br/>满足条件?"}
        CHECK -->|"是"| QUEUE["加入提取队列"]
        QUEUE --> WORKER["Worker Goroutine"]
        WORKER --> EXT_LLM["Extractor LLM 分析对话"]
        EXT_LLM --> OPS["生成 MemoryOp"]
        OPS --> MEM_DB["Memory 存储<br/>InMemory/Redis/PG/PGVector/..."]
        OPS -->|"add"| MEM_DB
        OPS -->|"update"| MEM_DB
        OPS -->|"delete"| MEM_DB
    end

    style PRELOAD fill:#e8f5e9
    style EXT_LLM fill:#fff3e0
    style MEM_DB fill:#e3f2fd
```

---

## 8. Knowledge RAG 知识检索

```mermaid
flowchart LR
    subgraph 离线索引["离线索引（一次性）"]
        SRC["知识源<br/>File/Dir/URL"] --> EXTRACT["Extractor<br/>PDF→Markdown"]
        EXTRACT --> SPLIT["TextSplitter<br/>分块"]
        SPLIT --> EMBED["Embedder<br/>文本→向量"]
        EMBED --> VS["VectorStore<br/>PGVector/Milvus/Qdrant/..."]
    end

    subgraph 在线检索["在线检索（每次对话）"]
        QUERY["用户问题"] --> ENHANCE["QueryEnhancer<br/>多轮改写"]
        ENHANCE --> Q_EMBED["Embedder<br/>问题→向量"]
        Q_EMBED --> SEARCH["VectorStore.Search<br/>相似度检索"]
        SEARCH --> RERANK["Reranker<br/>重排序 Top-K"]
        RERANK --> FILTER["Filter<br/>元数据过滤"]
        FILTER --> CTX["注入 LLM Context"]
    end

    VS -.->|"共享存储"| SEARCH

    style VS fill:#fff3e0
    style CTX fill:#e8f5e9
```

---

## 9. MCP 协议集成

```mermaid
flowchart LR
    subgraph Agent侧["tRPC-Agent-Go"]
        A["LLMAgent"]
        TS["MCPToolSet"]
    end

    subgraph Transport["传输层"]
        STDIO["STDIO<br/>子进程管道"]
        SSE["SSE<br/>HTTP 长连接"]
        HTTP["Streamable HTTP<br/>双向流式"]
    end

    subgraph Server["MCP Server"]
        PYTHON["Python MCP Server"]
        NODE["Node.js MCP Server"]
        GO["Go MCP Server"]
        REMOTE["远程 MCP Service"]
    end

    A -->|"WithToolSets"| TS
    TS -->|"tools/list → 工具声明"| STDIO
    TS -->|"tools/list → 工具声明"| SSE
    TS -->|"tools/list → 工具声明"| HTTP

    STDIO --> PYTHON
    SSE --> REMOTE
    HTTP --> REMOTE

    PYTHON -->|"tools/call → 执行"| NODE
    REMOTE -->|"tools/call → 执行"| GO

    style TS fill:#e3f2fd
    style STDIO fill:#e8f5e9
    style SSE fill:#fff3e0
    style HTTP fill:#f3e5f5
```

---

## 10. 三协议协作：AG-UI + A2A + MCP

```mermaid
flowchart TB
    subgraph Frontend["前端"]
        COPILOT["CopilotKit / TDesign Chat"]
    end

    subgraph GoAgent["Go Coordinator (tRPC-Agent-Go)"]
        COORD["Coordinator LLMAgent"]
        LOCAL["本地 SubAgent"]
        A2A_CLIENT["A2AAgent Client"]
        MCP_CLIENT["MCPToolSet"]
    end

    subgraph Remote["远程 Agent"]
        PY_AGENT["Python Agent<br/>(ADK / LangChain / 自研)"]
        PY_MCP["Python MCP Server"]
    end

    subgraph Infra["基础设施"]
        DB["PostgreSQL<br/>Session + Memory"]
        VECTOR["PGVector<br/>Knowledge"]
        OBS["OpenTelemetry<br/>+ Langfuse"]
    end

    COPILOT -->|"AG-UI SSE"| COORD

    COORD --> LOCAL
    COORD -->|"A2A Task"| A2A_CLIENT
    COORD -->|"MCP tools/list"| MCP_CLIENT

    A2A_CLIENT -->|"A2A Protocol"| PY_AGENT
    PY_AGENT -->|"MCP tools/call"| PY_MCP

    MCP_CLIENT --> PY_MCP

    COORD --> DB
    COORD --> VECTOR
    COORD --> OBS
    PY_AGENT --> OBS

    style COORD fill:#e8f5e9
    style PY_AGENT fill:#fff3e0
    style COPILOT fill:#e3f2fd
```

---

## 11. 生产部署架构

```mermaid
flowchart TB
    subgraph LB["负载均衡"]
        Nginx["Nginx / ALB"]
    end

    subgraph Apps["Agent 服务集群"]
        APP1["Agent Instance 1"]
        APP2["Agent Instance 2"]
        APP3["Agent Instance N"]
    end

    subgraph StateStore["状态存储"]
        REDIS["Redis<br/>Session 热数据"]
        PG["PostgreSQL<br/>Session/Memory 持久"]
        VEC["PGVector<br/>Knowledge + 语义召回"]
    end

    subgraph LLM["模型服务"]
        API["OpenAI / DeepSeek / Anthropic API"]
        LOCAL_LLM["自部署 vLLM / Ollama"]
    end

    subgraph OBS["可观测性栈"]
        JAEGER["Jaeger / Tempo<br/>链路追踪"]
        PROM["Prometheus<br/>指标收集"]
        GRAFANA["Grafana<br/>可视化面板"]
        LF["Langfuse<br/>LLM 分析"]
    end

    Nginx --> APP1
    Nginx --> APP2
    Nginx --> APP3

    APP1 --> REDIS
    APP1 --> PG
    APP1 --> VEC
    APP2 --> REDIS
    APP2 --> PG
    APP2 --> VEC
    APP3 --> REDIS
    APP3 --> PG
    APP3 --> VEC

    APP1 --> API
    APP2 --> API
    APP3 --> API
    APP1 --> LOCAL_LLM

    APP1 --> JAEGER
    APP1 --> PROM
    APP1 --> LF
    APP2 --> OBS
    APP3 --> OBS

    JAEGER --> GRAFANA
    PROM --> GRAFANA
```

---

## 图例说明

| 颜色 | 含义 |
|------|------|
| 绿色 | 入口/开始节点 |
| 橙色 | 核心处理节点 |
| 蓝色 | 数据存储/传输 |
| 粉色 | 安全/边界节点 |
| 紫色 | 扩展/插件 |

## 关键数据流汇总

| 数据流 | 来源 → 目标 | 承载内容 |
|--------|------------|----------|
| **用户消息** | Frontend → Runner.Run() | 用户输入的文本/多模态内容 |
| **Event 事件流** | Agent → Runner → Frontend | LLM 文本/工具调用/状态变更 |
| **Session 持久化** | Runner → Session Service → DB | 完整对话历史 |
| **Memory 提取** | Runner → Extractor → Memory DB | 用户画像/偏好/事实 |
| **Knowledge 检索** | Agent → VectorStore → LLM Context | 相关文档片段 |
| **A2A 任务** | Coordinator → 远程 Agent | 跨框架 Agent 协作 |
| **MCP 工具调用** | Agent → MCP Server → Tool Result | 外部工具能力 |
