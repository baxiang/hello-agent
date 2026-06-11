# 各模块结构图全集 — 源码·实战·原理

> 本文以 15 幅 Mermaid 类图/结构图/流程序列图，逐模块展开 tRPC-Agent-Go v1.10.0 的完整内部结构，可作为阅读源码的导航地图。

---

## 1. 顶层类关系总图

```mermaid
classDiagram
    class Runner {
        <<interface>>
        +Run(ctx, userID, sessionID, message, runOpts) chan Event
        +Close() error
    }
    class ManagedRunner {
        <<interface>>
        +Cancel(requestID) bool
        +RunStatus(requestID) RunStatus
    }
    class SteerableRunner {
        <<interface>>
        +EnqueueUserMessage(requestID, message) error
    }

    class runnerImpl {
        -appName string
        -agents map~string~Agent
        -sessionService Service
        -memoryService Service
        -artifactService Service
        -pluginManager PluginManager
        -runs map~string~runHandle
        +Run() chan Event
        +Close() error
    }

    class Agent {
        <<interface>>
        +Run(ctx, invocation) chan Event
        +Tools() Tool[]
        +Info() Info
        +SubAgents() Agent[]
        +FindSubAgent(name) Agent
    }
    class LLMAgent {
        -model Model
        -models map~string~Model
        -tools Tool[]
        -toolSets ToolSet[]
        -flow Flow
        -planner Planner
        -codeExecutor CodeExecutor
        -subAgents Agent[]
        -structuredOutput StructuredOutput
        +Run(ctx, inv) chan Event
    }
    class GraphAgent {
        -graph Graph
        -executor Executor
        -subAgents Agent[]
        -initialState State
        +Run(ctx, inv) chan Event
    }

    class Model {
        <<interface>>
        +GenerateContent(ctx, req) chan Response
        +Info() Info
    }
    class Tool {
        <<interface>>
        +Declaration() Declaration
    }
    class CallableTool {
        <<interface>>
        +Call(ctx, jsonArgs) any
    }
    class StreamableTool {
        <<interface>>
        +StreamableCall(ctx, jsonArgs) StreamReader
    }
    class ToolSet {
        <<interface>>
        +Tools(ctx) Tool[]
        +Close() error
        +Name() string
    }

    class Invocation {
        +Agent Agent
        +Session Session
        +Model Model
        +Message Message
        +MemoryService Service
        +ArtifactService Service
        +Plugins PluginManager
        +RunOptions RunOptions
        +EndInvocation bool
    }

    class Session {
        +ID string
        +AppName string
        +UserID string
        +State StateMap
        +Events Event[]
        +Summaries map~string~Summary
        +Tracks map~Track~TrackEvents
    }
    class Service {
        <<interface>>
        +CreateSession() Session
        +GetSession() Session
        +AppendEvent() error
        +CreateSessionSummary() error
        +Close() error
    }

    class Event {
        +Response Response
        +RequestID string
        +InvocationID string
        +Author string
        +Branch string
        +StateDelta map
        +StructuredOutput any
    }

    class PluginManager {
        <<interface>>
        +AgentCallbacks() Callbacks
        +ModelCallbacks() Callbacks
        +ToolCallbacks() Callbacks
        +OnEvent(ctx, inv, e) Event
        +Close() error
    }

    class Knowledge {
        <<interface>>
        +Search(ctx, req) SearchResult
    }

    Runner <|-- ManagedRunner
    ManagedRunner <|-- SteerableRunner
    Runner <|.. runnerImpl
    Agent <|.. LLMAgent
    Agent <|.. GraphAgent
    Tool <|-- CallableTool
    Tool <|-- StreamableTool

    runnerImpl --> Agent : resolves
    runnerImpl --> Service : sessionService
    runnerImpl --> PluginManager : pluginManager
    runnerImpl ..> Invocation : creates

    LLMAgent --> Model : uses
    LLMAgent --> Tool : has
    LLMAgent --> ToolSet : has
    LLMAgent ..> Knowledge : uses

    GraphAgent --> "1" Graph : wraps
    GraphAgent --> "1" Executor : has

    Invocation --> Agent : references
    Invocation --> Session : references
    Invocation --> Model : references
    Invocation --> PluginManager : references

    Session --> Event : contains
    Service ..> Session : manages

    PluginManager --> "3" Callbacks : composes

    style Runner fill:#e3f2fd
    style Agent fill:#e8f5e9
    style Model fill:#fff3e0
    style Tool fill:#fce4ec
    style Invocation fill:#f3e5f5
```

---

## 2. Agent 系统 — LLMAgent 内部结构

```mermaid
classDiagram
    class LLMAgent {
        -name string
        -model Model
        -models map~string~Model
        -modelSelector ModelSelector
        -instruction Text
        -systemPrompt Text
        -genConfig GenerationConfig
        -flow Flow
        -tools Tool[]
        -toolSets ToolSet[]
        -codeExecutor CodeExecutor
        -planner Planner
        -subAgents Agent[]
        -agentCallbacks Callbacks
        -outputKey string
        -outputSchema map
        -structuredOutput StructuredOutput
        +Run(ctx, inv) chan Event
        +Tools() Tool[]
        +Info() Info
        +SubAgents() Agent[]
    }

    class Options {
        +Model Model
        +Models map~string~Model
        +Instruction Text
        +Tools []Tool
        +ToolSets []ToolSet
        +Knowledge Knowledge
        +Memory Service
        +Planner Planner
        +CodeExecutor CodeExecutor
        +SubAgents []Agent
        +StructuredOutput StructuredOutput
        +Callbacks Callbacks
        +Extensions []Extension
    }

    class Flow {
        <<interface>>
        +Run(ctx, inv) chan Event
    }

    class llmflow {
        -model Model
        -requestProcessors []Processor
        -responseProcessors []Processor
        +Run(ctx, inv) chan Event
    }

    class Planner {
        <<interface>>
        +Plan(ctx, inv) PlanResult
    }

    class Extension {
        <<interface>>
        +Name() string
        +AgentCallbacks() Callbacks
        +ModelCallbacks() Callbacks
        +ToolCallbacks() Callbacks
        +Tools() Tool[]
    }

    LLMAgent --> Flow : delegates Run()
    LLMAgent --> Options : built from
    LLMAgent --> Planner : optional
    LLMAgent --> Extension : via WithExtensions()

    Flow <|.. llmflow : implements
    llmflow --> Model : invokes

    Options --> Knowledge : optional
    Options --> Model : required

    style LLMAgent fill:#e8f5e9
    style Flow fill:#fff3e0
    style Planner fill:#fce4ec
```

---

## 3. GraphAgent — 图 Agent 结构

```mermaid
classDiagram
    class GraphAgent {
        -name string
        -description string
        -graph Graph
        -executor Executor
        -subAgents Agent[]
        -agentCallbacks Callbacks
        -initialState State
        -channelBufferSize int
        +Run(ctx, inv) chan Event
    }

    class Graph {
        -schema StateSchema
        -nodes map~string~Node
        -edges map~string~[]Edge
        -conditionalEdges map~string~ConditionalEdge
        -entryPoint string
        -channelManager Manager
        -triggerToNodes map~string~[]string
        -cache Cache
        -cachePolicy CachePolicy
        +Validate() error
    }

    class Node {
        +ID string
        +Name string
        +Type NodeType
        +Function NodeFunc
        +instruction string
        +llmModel Model
        +baseTools map~string~Tool
        +toolSets []ToolSet
        +callbacks NodeCallbacks
        +cachePolicy CachePolicy
        +retryPolicies []RetryPolicy
        +interruptBefore bool
        +interruptAfter bool
        +enableParallelTools bool
        +agentInputMapper Mapper
        +agentOutputMapper Mapper
        +destinations map~string~string
        +ends map~string~string
    }

    class Edge {
        +From string
        +To string
    }

    class ConditionalEdge {
        +From string
        +Condition UniversalCondFunc
        +PathMap map~string~string
    }

    class Executor {
        -graph Graph
        -maxSteps int
        -maxConcurrency int
        -stepTimeout Duration
        -nodeTimeout Duration
        -checkpointSaver CheckpointSaver
        -checkpointManager CheckpointManager
        -executionEngine Engine
        +Execute(ctx, state, inv) chan Event
    }

    class State {
        <<map~string~any>>
    }

    class StateGraph {
        -graph Graph
        +AddNode(id, fn) StateGraph
        +AddLLMNode(id, model, inst, tools) StateGraph
        +AddToolsNode(id, tools) StateGraph
        +AddAgentNode(id) StateGraph
        +SetEntryPoint(id) StateGraph
        +AddEdge(from, to) StateGraph
        +AddConditionalEdges(from, cond, paths) StateGraph
        +Compile() Graph
    }

    GraphAgent --> Graph : wraps
    GraphAgent --> Executor : creates
    Graph --> Node : contains
    Graph --> Edge : contains
    Graph --> ConditionalEdge : conditional edges
    Executor --> Graph : executes
    Executor --> State : reads/writes
    StateGraph ..> Graph : builds via Compile()

    style GraphAgent fill:#e8f5e9
    style Graph fill:#e3f2fd
    style Executor fill:#fff3e0
    style StateGraph fill:#fce4ec
```

---

## 4. Node 节点类型枚举

```mermaid
graph LR
    subgraph "NodeType"
        FN[function<br/>自定义函数节点]
        LM[llm<br/>LLM 调用节点]
        TL[tool<br/>工具执行节点]
        AG[agent<br/>子 Agent 节点]
        JN[join<br/>屏障同步节点]
        RT[router<br/>路由器节点]
    end

    subgraph "典型图拓扑"
        ENTRY[入口: SetEntryPoint] --> FN
        FN --> LM
        LM -->|有 ToolCalls| TL
        LM -->|无 ToolCalls| EXIT[出口: SetFinishPoint]
        TL --> LM
    end

    style FN fill:#e8f5e9
    style LM fill:#e3f2fd
    style TL fill:#fff3e0
    style AG fill:#fce4ec
    style JN fill:#f3e5f5
    style RT fill:#e0f2f1
```

---

## 5. Runner 执行流程序列图

```mermaid
sequenceDiagram
    actor User as 调用方
    participant Runner as Runner
    participant SessionSvc as SessionService
    participant Agent as Agent
    participant Plugin as PluginManager
    participant Model as Model
    participant Tool as Tool

    User->>Runner: Run(ctx, userID, sessionID, msg)
    Runner->>Runner: 生成 RequestID
    Runner->>Runner: 解析 AppName

    Runner->>SessionSvc: GetSession(key)
    alt Session 不存在
        SessionSvc-->>Runner: nil
        Runner->>SessionSvc: CreateSession(key, state)
        SessionSvc-->>Runner: newSession
    else Session 存在
        SessionSvc-->>Runner: session
    end

    Runner->>Runner: resolveCurrentTurnMessages()
    Runner->>Runner: 解析 Agent（按名称/默认/覆盖）

    Runner->>Runner: newRunInvocation()
    Note over Runner: 构建 Invocation{<br/>Agent, Session, Model,<br/>MemoryService, Plugins...}

    Runner->>Agent: Run(ctx, invocation)
    Agent-->>Runner: eventChan

    loop 事件循环
        Agent->>Model: GenerateContent(req)
        Model-->>Agent: Response（含 ToolCalls）

        alt 需要调用工具
            Agent->>Plugin: OnEvent(beforeToolEvent)
            Agent->>Tool: Call(args)
            Tool-->>Agent: result
            Agent->>Plugin: OnEvent(afterToolEvent)
        end

        Agent-->>Runner: event (流式/最终)
        Runner->>Plugin: OnEvent(event)
        Runner->>SessionSvc: AppendEvent(event)
        Runner-->>User: event
    end

    Runner->>Runner: 发送 runner.completion 事件
    Runner-->>User: completion event
```

---

## 6. Model 层完整类型

```mermaid
classDiagram
    class Model {
        <<interface>>
        +GenerateContent(ctx, req) chan Response
        +Info() Info
    }
    class IterModel {
        <<interface>>
        +GenerateContentIter(ctx, req) Seq~Response~
    }

    class Request {
        +Messages []Message
        +GenerationConfig
        +StructuredOutput StructuredOutput
        +ExtraFields map~string~any
        +Headers map~string~string
        +Tools map~string~Tool
    }

    class Message {
        +Role Role
        +Content string
        +ContentParts []ContentPart
        +ToolID string
        +ToolName string
        +ToolCalls []ToolCall
        +ReasoningContent string
    }

    class ToolCall {
        +Type string
        +Function FunctionDef
        +ID string
        +Index int
    }

    class FunctionDef {
        +Name string
        +Description string
        +Arguments []byte
        +Strict bool
    }

    class ContentPart {
        +Type ContentType
        +Text string
        +Image Image
        +Audio Audio
        +File File
    }

    class GenerationConfig {
        +MaxTokens int
        +Temperature float64
        +TopP float64
        +Stream bool
        +Stop []string
        +ThinkingEnabled bool
        +ThinkingTokens int
        +ReasoningEffort string
    }

    class Response {
        +ID string
        +Object string
        +Model string
        +Created int64
        +Choices []Choice
        +Usage Usage
        +Error ResponseError
        +Done bool
        +IsPartial bool
    }

    class Choice {
        +Index int
        +Message Message
        +Delta Message
        +FinishReason string
    }

    class Usage {
        +PromptTokens int
        +CompletionTokens int
        +TotalTokens int
        +TimingInfo TimingInfo
    }

    class ResponseError {
        +Message string
        +Type string
        +Param string
        +Code string
    }

    class Info {
        +Name string
        +ContextWindow int
    }

    Model <|-- IterModel
    Request --> Message : contains
    Request --> GenerationConfig : embeds
    Message --> ToolCall : contains
    Message --> ContentPart : contains
    ToolCall --> FunctionDef : has
    Response --> Choice : contains
    Response --> Usage : has
    Response --> ResponseError : has
    Choice --> Message : delta/full

    style Model fill:#fff3e0
    style Request fill:#e3f2fd
    style Response fill:#e8f5e9
    style Message fill:#fce4ec
```

---

## 7. Tool 系统完整层次

```mermaid
classDiagram
    class Tool {
        <<interface>>
        +Declaration() Declaration
    }
    class CallableTool {
        <<interface>>
        +Call(ctx, jsonArgs) any
        +Declaration() Declaration
    }
    class StreamableTool {
        <<interface>>
        +StreamableCall(ctx, jsonArgs) StreamReader
        +Declaration() Declaration
    }

    class ToolSet {
        <<interface>>
        +Tools(ctx) Tool[]
        +Close() error
        +Name() string
    }

    class Declaration {
        +Name string
        +Description string
        +InputSchema Schema
        +OutputSchema Schema
    }

    class Schema {
        +Type string
        +Description string
        +Properties map~string~Schema
        +Required []string
        +Items Schema
        +Enum []any
        +Default any
    }

    class FunctionTool {
        -name string
        -desc string
        -inputSchema Schema
        -fn func(ctx, args) any
        +Call(ctx, args) any
        +Declaration() Declaration
    }

    class MCPToolSet {
        -serverConn MCPConnection
        -tools []Tool
        +Tools(ctx) Tool[]
        +Close() error
    }

    class AgentTool {
        -agent Agent
        -skipSummarization bool
        +Call(ctx, args) any
        +Declaration() Declaration
    }

    class TransferTool {
        -agentNames []string
        +Call(ctx, args) any
    }

    class KnowledgeSearchTool {
        -knowledge Knowledge
        +Call(ctx, args) any
    }

    Tool <|-- CallableTool : extends
    Tool <|-- StreamableTool : extends
    CallableTool <|.. FunctionTool : implements
    CallableTool <|.. AgentTool : implements
    CallableTool <|.. TransferTool : implements
    CallableTool <|.. KnowledgeSearchTool : implements
    ToolSet <|.. MCPToolSet : implements

    Declaration --> Schema : InputSchema/OutputSchema

    style Tool fill:#fce4ec
    style CallableTool fill:#e8f5e9
    style StreamableTool fill:#e3f2fd
    style ToolSet fill:#fff3e0
```

---

## 8. Session 系统 — Service 与后端

```mermaid
classDiagram
    class Session {
        +ID string
        +AppName string
        +UserID string
        +State StateMap
        +Events []Event
        +Summaries map~string~Summary
        +Tracks map~Track~TrackEvents
        +UpdatedAt Time
        +CreatedAt Time
        +Hash int
        +ServiceMeta map~string~string
    }

    class Key {
        +AppName string
        +UserID string
        +SessionID string
    }

    class UserKey {
        +AppName string
        +UserID string
    }

    class StateMap {
        <<map~string~[]byte>>
    }

    class Summary {
        +Summary string
        +Topics []string
        +UpdatedAt Time
        +Boundary SummaryBoundary
    }

    class SummaryBoundary {
        +Version int
        +FilterKey string
        +LastEventID string
        +CutoffAt Time
    }

    class Service {
        <<interface>>
        +CreateSession(ctx, key, state) Session
        +GetSession(ctx, key) Session
        +ListSessions(ctx, userKey) []Session
        +DeleteSession(ctx, key) error
        +UpdateAppState(ctx, appName, state) error
        +UpdateUserState(ctx, userKey, state) error
        +UpdateSessionState(ctx, key, state) error
        +AppendEvent(ctx, sess, event) error
        +CreateSessionSummary(ctx, sess, filterKey, force) error
        +EnqueueSummaryJob(ctx, sess, filterKey, force) error
        +GetSessionSummaryText(ctx, sess) (string,bool)
        +Close() error
    }

    class SearchableService {
        <<interface>>
        +SearchEvents(ctx, req) []EventSearchResult
    }

    class WindowService {
        <<interface>>
        +GetEventWindow(ctx, req) EventWindow
    }

    class InMemoryService {
        -sessions map~Key~Session
        -appStates map~string~StateMap
        -userStates map~UserKey~StateMap
    }

    class PostgresService {
        -db *sql.DB
        +CreateSession() Session
        +GetSession() Session
        +AppendEvent() error
    }

    Service <|-- SearchableService
    Service <|-- WindowService
    Service <|.. InMemoryService : implements
    Service <|.. PostgresService : implements

    Session --> StateMap : State
    Session --> Event : Events[]
    Session --> Summary : Summaries
    Key ..> Session : identifies
    UserKey ..> Session : user scope
    Summary --> SummaryBoundary : has

    style Service fill:#e3f2fd
    style Session fill:#e8f5e9
    style InMemoryService fill:#fff3e0
    style PostgresService fill:#fce4ec
```

---

## 9. Memory 系统 — 双模式与后端

```mermaid
classDiagram
    class Service {
        <<interface>>
        +AddMemory(ctx, userKey, memory, topics) error
        +UpdateMemory(ctx, memoryKey, memory, topics) error
        +DeleteMemory(ctx, memoryKey) error
        +ClearMemories(ctx, userKey) error
        +ReadMemories(ctx, userKey, limit) []Entry
        +SearchMemories(ctx, userKey, query) []Entry
        +Tools() []Tool
        +EnqueueAutoMemoryJob(ctx, sess) error
        +Close() error
    }

    class Entry {
        +ID string
        +AppName string
        +UserID string
        +Memory Memory
        +CreatedAt Time
        +UpdatedAt Time
        +Score float64
    }

    class Memory {
        +Memory string
        +Topics []string
        +LastUpdated Time
        +Kind Kind
        +EventTime Time
        +Participants []string
        +Location string
    }

    class Kind {
        <<enumeration>>
        fact
        episode
    }

    class Key {
        +AppName string
        +UserID string
        +MemoryID string
    }

    class SearchOptions {
        +Kind Kind
        +TimeAfter Time
        +TimeBefore Time
        +SimilarityThreshold float64
        +HybridSearch bool
        +Deduplicate bool
        +OrderByEventTime bool
    }

    class Tool {
        <<from tool pkg>>
        +memory_add
        +memory_update
        +memory_delete
        +memory_clear
        +memory_search
        +memory_load
    }

    Service --> Entry : returns
    Service --> Tool : registers
    Entry --> Memory : contains
    Memory --> Kind : typed
    Service --> SearchOptions : search params

    Service : Agentic Mode (Tools())
    Service : Auto Mode (EnqueueAutoMemoryJob())

    style Service fill:#e8f5e9
    style Entry fill:#e3f2fd
    style Memory fill:#fff3e0
    style SearchOptions fill:#fce4ec
```

---

## 10. Memory 后端一览

```mermaid
graph TB
    Service["memory.Service<br/>统一接口"]

    Service --> Postgres["postgres<br/>完整功能"]
    Service --> MySQL["mysql<br/>完整功能"]
    Service --> SQLite["sqlite<br/>嵌入式"]
    Service --> Redis["redis<br/>分布式"]
    Service --> InMemory["inmemory<br/>测试/简单"]
    Service --> Mem0["mem0<br/>外部平台"]

    subgraph Vector["向量后端"]
        PGVec["pgvector<br/>向量检索"]
        MySQLVec["mysqlvec<br/>向量检索"]
        SQLiteVec["sqlitevec<br/>本地向量"]
    end

    Service --> Vector

    subgraph Modes["双运行模式"]
        Agentic["Agentic 模式<br/>模型主动调用 CRUD 工具"]
        Auto["Auto 模式<br/>后台提取器自动归档"]
    end

    Service --> Modes

    style Service fill:#e3f2fd
    style Postgres fill:#e8f5e9
    style PGVec fill:#fff3e0
    style Agentic fill:#fce4ec
    style Auto fill:#f3e5f5
```

---

## 11. Knowledge/RAG 管线

```mermaid
graph LR
    subgraph Ingestion["写入管线"]
        SRC["source<br/>文件/URL/目录"] --> DOC["document<br/>文档模型"]
        DOC --> OCR["ocr<br/>图片文字提取"]
        DOC --> CHUNK["chunking<br/>文本切分"]
        CHUNK --> EMB["embedder<br/>向量化"]
        EMB --> VEC["vectorstore<br/>向量存储"]
    end

    subgraph Retrieval["召回管线"]
        QRY["query<br/>查询增强"] --> RET["retriever<br/>检索策略"]
        RET --> RERANK["reranker<br/>重排序"]
        RERANK --> FILTER["searchfilter<br/>元数据过滤"]
    end

    VEC --> RET

    subgraph Interface["对外接口"]
        KN["knowledge.Knowledge<br/>Search(ctx, req) SearchResult"]
        TOOL["knowledge_search tool<br/>挂载到 Agent"]
    end

    RET --> KN
    KN --> TOOL

    style KN fill:#e3f2fd
    style VEC fill:#e8f5e9
    style EMB fill:#fff3e0
    style CHUNK fill:#fce4ec
    style RERANK fill:#f3e5f5
```

---

## 12. Event 系统 — 事件结构与流转

```mermaid
classDiagram
    class Event {
        <<embeds model.Response>>
        -ID string
        -Object string
        -Model string
        -Created int64
        -Choices []Choice
        -Usage Usage
        -Error ResponseError
        -Done bool
        -IsPartial bool
        +RequestID string
        +InvocationID string
        +ParentInvocationID string
        +Author string
        +Timestamp Time
        +Branch string
        +Tag string
        +RequiresCompletion bool
        +LongRunningToolIDs map
        +StateDelta map~string~[]byte
        +Extensions map~string~RawMessage
        +StructuredOutput any
        +FilterKey string
        +Actions EventActions
        +Version int
    }

    class EventActions {
        +SkipSummarization bool
    }

    class Response {
        +ID string
        +Object string
        +Model string
        +Choices []Choice
        +Usage Usage
        +Error ResponseError
        +Done bool
        +IsPartial bool
    }

    Event --|> Response : embeds *model.Response
    Event --> EventActions : has

    note for Event "流式链路：<br/>Model → Agent → Plugin.OnEvent()<br/>→ Session.AppendEvent()<br/>→ emit to user channel"
```

---

## 13. 事件流时序

```mermaid
sequenceDiagram
    participant Model as Model
    participant Flow as llmflow (Flow)
    participant Agent as Agent
    participant Plugin as PluginManager
    participant Session as SessionService
    participant User as 调用方 chan

    Model->>Flow: Response (IsPartial=true, Delta)
    Flow->>Flow: BeforeModel/AfterModel Callbacks
    Flow->>Flow: ResponseProcessor 处理
    Flow-->>Agent: event{IsPartial:true}
    Agent-->>User: event

    Note over Model,User: ...多轮工具调用中间穿插 streaming...

    Model->>Flow: Response (IsPartial=true, ToolCalls)
    Flow->>Flow: FunctionCallResponseProcessor
    Flow->>Plugin: BeforeTool Callbacks
    Flow->>Tool: Call(args)
    Tool-->>Flow: result
    Flow->>Plugin: AfterTool Callbacks
    Flow-->>Agent: event{StateDelta...}

    Model->>Flow: Response (Done=true, no ToolCalls)
    Flow->>Flow: 最终 Response
    Flow-->>Agent: event{IsPartial:false, Done:true}
    Agent-->>User: event

    User-->>User: 检测 IsRunnerCompletion() → break
```

---

## 14. Plugin 系统 — 注册与执行

```mermaid
classDiagram
    class Plugin {
        <<interface>>
        +Name() string
        +Register(r Registry)
    }

    class Registry {
        +BeforeAgent(cb BeforeAgentCallback)
        +AfterAgent(cb AfterAgentCallback)
        +BeforeModel(cb BeforeModelCallback)
        +AfterModel(cb AfterModelCallback)
        +BeforeTool(cb BeforeToolCallback)
        +AfterTool(cb AfterToolCallback)
        +OnEvent(hook EventHook)
    }

    class Manager {
        -plugins []Plugin
        -agentCallbacks Callbacks
        -modelCallbacks Callbacks
        -toolCallbacks Callbacks
        -eventHooks []namedEventHook
        +AgentCallbacks() Callbacks
        +ModelCallbacks() Callbacks
        +ToolCallbacks() Callbacks
        +OnEvent(ctx, inv, e) Event
        +Close() error
    }

    class PluginManager {
        <<interface>>
        +AgentCallbacks() Callbacks
        +ModelCallbacks() Callbacks
        +ToolCallbacks() Callbacks
        +OnEvent(ctx, inv, e) Event
        +Close() error
    }

    class GuardrailPlugin {
        -rules []ContentRule
        +Name() string
        +Register(r Registry)
    }

    class LoggingPlugin {
        +Name() string
        +Register(r Registry)
    }

    class GlobalInstructionPlugin {
        -instruction string
        +Name() string
        +Register(r Registry)
    }

    Plugin <|.. GuardrailPlugin : implements
    Plugin <|.. LoggingPlugin : implements
    Plugin <|.. GlobalInstructionPlugin : implements
    Manager --> Plugin : aggregates
    Manager ..|> PluginManager : implements

    Registry --> Manager : wires callbacks

    style Plugin fill:#e3f2fd
    style Manager fill:#e8f5e9
    style Registry fill:#fff3e0
    style GuardrailPlugin fill:#fce4ec
```

---

## 15. Server 层 — 三种服务协议

```mermaid
graph TB
    subgraph 外部["外部世界"]
        FRONT["前端 UI<br/>AG-UI Client"]
        A2AR["远程 Agent<br/>A2A Client"]
        OPENAI["OpenAI 兼容<br/>API Client"]
    end

    subgraph Server["Server 层"]
        AGUI["AG-UI Server<br/>SSE 流式 /chat"]
        A2A["A2A Server<br/>Agent Card / Task"]
        OAI["OpenAI Server<br/>/v1/chat/completions"]
    end

    subgraph Core["核心"]
        RUNNER["Runner"]
        AGENT["Agent"]
    end

    FRONT -->|SSE| AGUI
    A2AR -->|A2A Protocol| A2A
    OPENAI -->|OpenAI API| OAI

    AGUI --> RUNNER
    A2A --> RUNNER
    OAI --> RUNNER
    RUNNER --> AGENT

    AGUI -->|子端点| CANCEL["/cancel<br/>取消运行"]
    AGUI -->|子端点| SNAP["/messages/snapshot<br/>历史快照"]

    A2A -->|扩展| ADK["ADK 兼容模式"]
    A2A -->|扩展| ARTIFACT["Artifact 流式"]
    A2A -->|扩展| SSE["SSE 事件流"]

    style Server fill:#e3f2fd
    style AGUI fill:#e8f5e9
    style A2A fill:#fff3e0
    style OAI fill:#fce4ec
```

---

## 附录：全模块速查表

| 模块 | 核心接口 | 关键 Struct | 子包数 |
|------|---------|------------|--------|
| **agent** | `Agent`, `PluginManager` | `Invocation`, `Info`, `RunOptions` | ~15 |
| **llmagent** | (实现 Agent) | `LLMAgent`, `Options` | - |
| **graphagent** | (实现 Agent) | `GraphAgent` | - |
| **runner** | `Runner`, `ManagedRunner`, `SteerableRunner` | `runnerImpl`, `RunStatus` | - |
| **model** | `Model`, `IterModel` | `Request`, `Response`, `Message` | ~9 |
| **tool** | `Tool`, `CallableTool`, `StreamableTool`, `ToolSet` | `Declaration`, `Schema` | ~16 |
| **session** | `Service` | `Session`, `Key`, `Summary` | ~8 |
| **memory** | `Service` | `Entry`, `Memory`, `SearchOptions` | ~10 |
| **knowledge** | `Knowledge` | `SearchRequest`, `SearchResult` | ~11 |
| **graph** | (StateGraph 流式 API) | `Graph`, `Node`, `Edge`, `Executor` | ~1 |
| **event** | (值类型) | `Event`, `EventActions` | - |
| **plugin** | `Plugin` | `Manager`, `Registry` | ~8 |
| **server** | `agui.Server`, `a2a.Server` | - | ~3 |
