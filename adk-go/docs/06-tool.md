# 工具系统

工具系统是 ADK-Go 的核心扩展机制，允许 Agent 调用外部功能、访问 API 或与其他 Agent 协作。ADK-Go 通过 `tool.Tool` 接口统一抽象所有工具，并提供了 FunctionTool、AgentTool、MCP Toolset 等多种实现。

## 1. tool.Tool 接口

定义于 `source/tool/tool.go:42-50`：

```go
type Tool interface {
    Name() string
    Description() string
    IsLongRunning() bool
}
```

- **`Name()`**：工具的唯一标识名称，LLM 通过此名称决定调用哪个工具
- **`Description()`**：工具功能描述，帮助 LLM 理解何时调用此工具
- **`IsLongRunning()`**：标识是否为长时间运行操作（如异步任务），长运行工具通常会先返回资源 ID，稍后再完成

### tool.Context 接口

`tool.Context` 定义于 `source/tool/tool.go:55-102`，扩展了 `agent.CallbackContext`（提供 `Artifacts()` 和 `State()` 方法），增加了工具执行专用的上下文：

```go
type Context interface {
    agent.CallbackContext
    FunctionCallID() string
    Actions() *session.EventActions
    SearchMemory(context.Context, string) (*memory.SearchResponse, error)
    ToolConfirmation() *toolconfirmation.ToolConfirmation
    RequestConfirmation(hint string, payload any) error
}
```

| 方法 | 说明 |
|------|------|
| `FunctionCallID()` | 返回触发此工具执行的函数调用唯一标识 |
| `Actions()` | 返回当前事件的 `EventActions`，工具可通过它修改状态、转移 Agent 等 |
| `SearchMemory()` | 对 Agent 的长期记忆执行语义搜索 |
| `ToolConfirmation()` | 获取当前 HITL 确认状态，`nil` 表示尚未请求确认 |
| `RequestConfirmation()` | 发起人机确认流程，向用户展示确认提示 |

### tool.Toolset 接口

`Toolset` 定义于 `source/tool/tool.go:106-113`，表示工具的集合：

```go
type Toolset interface {
    Name() string
    Tools(ctx agent.ReadonlyContext) ([]Tool, error)
}
```

`Tools()` 接受 `ReadonlyContext`，允许根据当前调用状态动态返回不同的工具集。

### Predicate 与 FilterToolset

`Predicate`（`source/tool/tool.go:116`）用于条件性地暴露工具：

```go
type Predicate func(ctx agent.ReadonlyContext, tool Tool) bool
```

`AllowedToolsPredicate` 创建一个白名单过滤器：

```go
// 仅允许名为 "search" 和 "calculator" 的工具
predicate := tool.AllowedToolsPredicate([]string{"search", "calculator"})
```

`FilterToolset` 将谓词应用于整个工具集：

```go
filtered := tool.FilterToolset(myToolset, predicate)
```

`filteredToolset` 在调用 `Tools()` 时会遍历所有工具，仅保留谓词返回 `true` 的工具。

## 2. FunctionTool

`FunctionTool` 是最常用的工具类型，将普通 Go 函数包装为 LLM 可调用的工具。

### 泛型创建

定义于 `source/tool/functiontool/function.go:78`：

```go
func New[TArgs, TResults any](cfg Config, handler Func[TArgs, TResults]) (tool.Tool, error)
```

`Func` 类型签名为：

```go
type Func[TArgs, TResults any] func(tool.Context, TArgs) (TResults, error)
```

**类型约束**：`TArgs` 必须是 `struct` 或 `map` 类型（或指向它们的指针），否则返回 `ErrInvalidArgument`。

### Config 配置

```go
type Config struct {
    Name                        string
    Description                 string
    InputSchema                 *jsonschema.Schema   // 可选，nil 时自动推断
    OutputSchema                *jsonschema.Schema   // 可选，nil 时自动推断
    IsLongRunning               bool
    RequireConfirmation         bool
    RequireConfirmationProvider any                  // func(TArgs) bool
}
```

### 自动 Schema 推断

当 `InputSchema`/`OutputSchema` 为 `nil` 时，`FunctionTool` 使用 `jsonschema.For[T]()` 自动从 Go 结构体类型推断 JSON Schema。例如：

```go
type WeatherArgs struct {
    City string `json:"city" jsonschema:"description=城市名称"`
}

type WeatherResult struct {
    Temperature float64 `json:"temperature" jsonschema:"description=温度(摄氏度)"`
    Condition   string  `json:"condition" jsonschema:"description=天气状况"`
}

weatherTool, err := functiontool.New(functiontool.Config{
    Name:        "get_weather",
    Description: "获取指定城市的天气信息",
}, func(ctx tool.Context, args WeatherArgs) (WeatherResult, error) {
    return WeatherResult{Temperature: 25.5, Condition: "晴"}, nil
})
```

### jsonschema tag 最佳实践

`jsonschema` tag 是最容易被忽略但**最重要的部分**——它直接决定了 LLM 能否正确调用你的工具。

```go
type searchUserArgs struct {
    // 好的 jsonschema 描述：清晰告诉 LLM 这个参数是什么
    Username string `json:"username" jsonschema:"The exact username to search for. Do not guess or make up usernames."`

    // 差的 jsonschema 描述：LLM 不知道该传什么
    // Username string `json:"username" jsonschema:"user"`
}
```

**最佳实践**：
- 描述要具体，说明格式和约束
- 告诉 LLM 不该做什么（"Do not guess"）
- 枚举值直接列出（"Must be one of: active, inactive, pending"）
- 带示例值（"e.g. ORD-20260101-001"）

### 必填 vs 可选参数

```go
type queryOrderArgs struct {
    OrderID      string `json:"order_id" jsonschema:"The order ID, e.g. ORD-20260101-001."`  // 必填
    IncludeItems bool   `json:"include_items,omitempty" jsonschema:"Whether to include item details."` // 可选
}
```

规则很简单：带 `omitempty` → 可选参数，不带 `omitempty` → 必填参数。

### 返回值设计模式

```go
// 方式一：返回结构体（推荐，类型安全）
type orderResult struct {
    Status   string  `json:"status"`
    Amount   float64 `json:"amount"`
    Currency string  `json:"currency"`
}

func lookupOrder(ctx tool.Context, args queryOrderArgs) (orderResult, error) {
    // ...
}

// 方式二：返回 map（灵活，适合动态字段）
func flexibleQuery(ctx tool.Context, args queryArgs) (map[string]any, error) {
    result := map[string]any{
        "status": "found",
        "data":   someDynamicData,
    }
    return result, nil
}

// 方式三：返回指针（允许 nil 表示"未找到"）
func findUser(ctx tool.Context, args findUserArgs) (*userResult, error) {
    user, err := db.FindUser(args.UserID)
    if err != nil {
        return nil, err
    }
    if user == nil {
        return nil, nil  // 返回 nil 表示未找到，不是错误
    }
    return &userResult{Name: user.Name, Email: user.Email}, nil
}
```

### Declaration() 与 Run()

- **`Declaration()`**：生成 `genai.FunctionDeclaration`，包含名称、描述和参数/返回值的 JSON Schema。若 `IsLongRunning` 为 `true`，会自动追加长运行操作的提示说明
- **`Run()`**：执行工具处理器。流程为：将 `map[string]any` 参数通过 JSON Schema 转换为 `TArgs` 类型 → 检查 HITL 确认 → 调用处理函数 → 将结果转换为 `map[string]any`

### 人机确认流程（HITL）

`FunctionTool` 内置了确认逻辑：

1. 若 `RequireConfirmation` 为 `true` 或 `RequireConfirmationProvider` 返回 `true`，工具会调用 `ctx.RequestConfirmation()` 发起确认请求
2. 此时设置 `SkipSummarization = true` 并返回 `ErrConfirmationRequired` 错误
3. 用户确认后，工具再次被调用，`ctx.ToolConfirmation()` 返回确认结果
4. 若 `Confirmed` 为 `false`，返回 `ErrConfirmationRejected` 错误

```go
// 静态确认：所有调用都需要用户批准
tool, _ := functiontool.New(functiontool.Config{
    Name:                "delete_database",
    Description:         "删除数据库",
    RequireConfirmation: true,
}, deleteDatabase)

// 动态确认：仅当操作涉及生产环境时需要确认
tool, _ := functiontool.New(functiontool.Config{
    Name:        "deploy_service",
    Description: "部署服务",
    RequireConfirmationProvider: func(args DeployArgs) bool {
        return args.Environment == "production"
    },
}, deployService)

// 级别三：高级确认（带自定义 payload）
func requestTimeOff(ctx tool.Context, args timeOffArgs) (map[string]any, error) {
    confirmation := ctx.ToolConfirmation()
    if confirmation == nil {
        // 首次调用：请求人工确认，附带自定义数据
        ctx.RequestConfirmation(
            "请审批请假申请："+args.Reason,
            map[string]any{"approved_days": 0},
        )
        return map[string]any{"status": "等待主管审批..."}, nil
    }

    // 第二次调用：已收到确认结果
    payload := confirmation.Payload.(map[string]any)
    approvedDays := int(payload["approved_days"].(float64))
    approvedDays = min(approvedDays, args.Days)

    if approvedDays == 0 {
        return map[string]any{"status": "请假被拒绝", "approved_days": 0}, nil
    }

    return map[string]any{
        "status":        "审批通过",
        "approved_days": approvedDays,
    }, nil
}
```

**确认工作流程**：

```
用户请求 → Agent 调用工具 → 工具发现需要确认
  → 返回确认请求（带 payload）→ 用户在前端审批
  → 用户响应 → Agent 再次调用工具（带确认结果）
  → 工具读取确认结果 → 执行实际操作
```

> ⚠️ **已知限制**：Tool Confirmation 目前为**实验性功能**，`DatabaseSessionService` 和 `VertexAiSessionService` 不支持。

### StreamingFunctionTool

定义于 `source/tool/functiontool/streaming_function.go`，用于流式输出场景：

```go
type StreamingFunc[TArgs any] func(tool.Context, TArgs) iter.Seq2[string, error]

func NewStreaming[TArgs any](cfg Config, handler StreamingFunc[TArgs]) (tool.Tool, error)
```

与 `FunctionTool` 不同，处理函数返回 `iter.Seq2[string, error]`，逐步 yield 文本片段，适用于实时输出场景（如逐字生成回答）。确认逻辑与 `FunctionTool` 完全一致。

### Tool Context 实战

`tool.Context` 不只是一个普通的 context——它是功能丰富的"工具箱"。继承链如下：

```
context.Context                    ← 标准 Go context
  └── agent.ReadonlyContext        ← 只读上下文
        ├── UserID()               ← 当前用户 ID
        ├── SessionID()            ← 当前会话 ID
        ├── AppName()              ← 应用名称
        ├── AgentName()            ← 当前 Agent 名称
        ├── UserContent()          ← 用户原始消息
        └── ReadonlyState()        ← 只读状态
  └── agent.CallbackContext        ← 可写上下文
        ├── State()                ← 读写会话状态
        └── Artifacts()            ← 产物管理
  └── tool.Context                 ← Tool 专属
        ├── FunctionCallID()       ← 本次调用 ID
        ├── Actions()              ← 流程控制（转移 Agent 等）
        ├── SearchMemory()         ← 搜索长期记忆
        ├── ToolConfirmation()     ← 人工确认状态
        └── RequestConfirmation()  ← 请求人工确认
```

以下是常见场景的代码示例：

#### 读写状态

```go
func updatePreference(ctx tool.Context, args updatePrefArgs) (*updatePrefResult, error) {
    key := "user:preferences"

    // 读取现有偏好
    val, _ := ctx.State().Get(key)
    prefs := map[string]string{}
    if m, ok := val.(map[string]string); ok {
        prefs = m
    }

    // 更新偏好
    prefs[args.Preference] = args.Value
    ctx.State().Set(key, prefs)

    return &updatePrefResult{Status: "updated"}, nil
}
```

**状态作用域规则**：

| 前缀 | 作用域 | 生命周期 | 示例 |
|------|--------|----------|------|
| 无前缀 | 当前会话 | 会话存续期间 | `"last_query"` |
| `app:` | 应用级 | 跨用户共享 | `"app:maintenance_mode"` |
| `user:` | 用户级 | 跨会话持久化 | `"user:preferences"` |
| `temp:` | 临时 | 不持久化 | `"temp:calc_step"` |

**实战：工具间传递数据**

```go
func queryOrder(ctx tool.Context, args queryOrderArgs) (orderResult, error) {
    order, err := db.GetOrder(args.OrderID)
    if err != nil {
        return orderResult{}, err
    }

    // 把查询结果存入状态，供后续工具使用
    ctx.State().Set("last_order_id", args.OrderID)
    ctx.State().Set("last_order_amount", order.Amount)

    return orderResult{
        Status:   order.Status,
        Amount:   order.Amount,
        Currency: "CNY",
    }, nil
}

func refundOrder(ctx tool.Context, args refundArgs) (refundResult, error) {
    // 如果用户没指定订单 ID，使用上次查询的
    orderID := args.OrderID
    if orderID == "" {
        val, _ := ctx.State().Get("last_order_id")
        if val == nil {
            return refundResult{}, fmt.Errorf("未找到订单，请先查询订单")
        }
        orderID = val.(string)
    }

    // 执行退款...
    return refundResult{Status: "refunded", OrderID: orderID}, nil
}
```

#### Agent 转移

`ctx.Actions().TransferToAgent` 让工具函数能动态改变 Agent 的执行流程：

```go
func handleInquiry(ctx tool.Context, args inquiryArgs) (inquiryResult, error) {
    query := strings.ToLower(args.Query)

    switch {
    case strings.Contains(query, "退款") || strings.Contains(query, "退货"):
        ctx.Actions().TransferToAgent = "refund_agent"
        return inquiryResult{Status: "正在转接退款专员..."}, nil

    case strings.Contains(query, "投诉") || strings.Contains(query, "差评"):
        ctx.Actions().TransferToAgent = "complaint_agent"
        return inquiryResult{Status: "正在转接投诉专员..."}, nil

    default:
        return inquiryResult{Status: "handled", Response: "已为您处理"}, nil
    }
}
```

`EventActions` 支持的字段：

| 字段 | 类型 | 说明 |
|------|------|------|
| `TransferToAgent` | string | 转移到指定 Agent |
| `Escalate` | bool | 上报给父 Agent |
| `SkipSummarization` | bool | 跳过 LLM 对工具结果的摘要 |

#### Artifacts 产物管理

```go
func analyzeDocument(ctx tool.Context, args analyzeArgs) (*analyzeResult, error) {
    // 加载用户上传的文档
    doc, err := ctx.Artifacts().Load(ctx, args.FileName)
    if err != nil {
        return nil, fmt.Errorf("文档加载失败: %w", err)
    }

    // 处理文档...
    analysis := processDoc(doc)

    // 保存分析结果
    part := genai.NewPartFromText(analysis)
    ctx.Artifacts().Save(ctx, "analysis_result", part)

    return &analyzeResult{Status: "done"}, nil
}
```

#### 搜索长期记忆

```go
func answerWithMemory(ctx tool.Context, args queryArgs) (*answerResult, error) {
    memoryResp, err := ctx.SearchMemory(ctx, args.Query)
    if err != nil {
        return nil, err
    }

    var context string
    for _, m := range memoryResp.Memories {
        context += m.Text + "\n"
    }

    return &answerResult{Context: context}, nil
}
```

#### 人工确认（Human-in-the-Loop）

```go
func deleteRecord(ctx tool.Context, args deleteArgs) (*deleteResult, error) {
    // 高风险操作前请求人工确认
    if args.Force != true {
        err := ctx.RequestConfirmation(
            "即将删除记录 "+args.RecordID+"，确认删除？",
            map[string]any{"record_id": args.RecordID},
        )
        if err != nil {
            return nil, fmt.Errorf("操作已取消")
        }
    }

    // 执行删除...
    return &deleteResult{Status: "deleted"}, nil
}
```

## 3. AgentTool

`AgentTool`（`source/tool/agenttool/agent_tool.go`）将一个 Agent 包装为工具，实现 Agent-as-Tool 模式，使 LLM 可以在工具调用中委托子任务给另一个 Agent。

### 创建

```go
func New(agent agent.Agent, cfg *Config) tool.Tool
```

`Config` 仅包含 `SkipSummarization` 选项，默认为 `false`。

### 输入 Schema

- 若被包装的 Agent 定义了 `InputSchema`，则使用该 Schema 作为工具参数
- 否则，使用默认的 `"request"` 字符串参数：

```go
decl.Parameters = &genai.Schema{
    Type: "OBJECT",
    Properties: map[string]*genai.Schema{
        "request": {Type: "STRING"},
    },
    Required: []string{"request"},
}
```

### 执行流程

`Run()` 方法执行以下步骤：

1. 设置 `SkipSummarization`（若配置启用）
2. 根据 `InputSchema` 验证并序列化输入参数
3. 创建独立的 `Runner` 和 `Session`（使用 `InMemoryService`）
4. 从父上下文复制状态（过滤 `_adk` 内部前缀）
5. 运行子 Agent，收集最后一个包含文本内容的 Event
6. 若子 Agent 定义了 `OutputSchema`，验证输出格式；否则包装为 `{"result": text}`

## 4. MCP Toolset

`mcptoolset`（`source/tool/mcptoolset/set.go`）连接 MCP（Model Context Protocol）服务器，将 MCP 工具转换为 ADK 工具。

### 创建

```go
func New(cfg Config) (tool.Toolset, error)
```

### Config 配置

```go
type Config struct {
    Client                       *mcp.Client           // 可选自定义 MCP 客户端
    Transport                    mcp.Transport         // MCP 传输层（如 CommandTransport）
    ToolFilter                   tool.Predicate        // 已弃用，使用 tool.FilterToolset 替代
    RequireConfirmation          bool
    RequireConfirmationProvider  tool.ConfirmationProvider
}
```

### 懒加载

MCP 会话采用懒创建策略：首次请求 LLM 时才建立与 MCP 服务器的连接，避免不必要的资源消耗。

### 使用示例

```go
mcpTs, err := mcptoolset.New(mcptoolset.Config{
    Transport: &mcp.CommandTransport{Command: exec.Command("my-mcp-server")},
})
if err != nil {
    log.Fatalf("创建 MCP Toolset 失败: %v", err)
}

llmagent.New(llmagent.Config{
    Name:        "my_agent",
    Model:       model,
    Description: "具有 MCP 工具的 Agent",
    Instruction: "...",
    Toolsets:    []tool.Toolset{mcpTs},
})
```

`Tools()` 方法会调用 `mcpClient.ListTools()` 获取 MCP 工具列表，逐个转换为 ADK `tool.Tool`，并通过 `ToolFilter` 过滤。

## 5. 内置工具

ADK-Go 提供了多种开箱即用的内置工具：

### geminitool.GoogleSearch

定义于 `source/tool/geminitool/google_search.go`，Gemini 2 模型内置的 Google 搜索工具。它在 `ProcessRequest()` 中将 `genai.Tool{GoogleSearch: &genai.GoogleSearch{}}` 添加到 LLM 请求，由模型内部执行搜索，不需要本地代码执行。

### loadmemorytool

定义于 `source/tool/loadmemorytool/tool.go`，名为 `load_memory` 的工具，允许模型显式查询长期记忆。接受 `query` 字符串参数，调用 `toolCtx.SearchMemory()` 返回匹配的记忆条目。`ProcessRequest()` 还会追加记忆使用说明到系统指令中。

### preloadmemorytool

定义于 `source/tool/preloadmemorytool/tool.go`，名为 `preload_memory` 的工具，在每个 LLM 请求前自动执行（而非由模型显式调用）。它提取用户当前查询文本，搜索相关记忆，并将匹配的过去对话注入系统指令的 `<PAST_CONVERSATIONS>` 标签中。

### loadartifactstool

定义于 `source/tool/loadartifactstool/load_artifacts_tool.go`，名为 `load_artifacts` 的工具。`ProcessRequest()` 会：列出当前会话的所有制品文件名并注入指令；处理已完成的 `load_artifacts` 函数调用，并行加载指定制品内容到对话历史中。

### exitlooptool

定义于 `source/tool/exitlooptool/tool.go`，名为 `exit_loop` 的工具。基于 `FunctionTool` 构建，调用时设置 `Escalate = true` 和 `SkipSummarization = true`，用于跳出循环 Agent 的执行循环。

### exampletool

定义于 `source/tool/exampletool/tool.go`，将 few-shot 示例注入 LLM 请求的工具。`ProcessRequest()` 根据配置的 `Example` 列表（包含 `Input` 和 `Output`），构建格式化的示例系统指令追加到请求中。

### skilltoolset

定义于 `source/tool/skilltoolset/toolset.go`，提供技能（Skill）系统的工具集，包含三个工具：
- **`list_skills`**：列出可用技能
- **`load_skill`**：加载指定技能的完整指令
- **`load_skill_resource`**：加载技能目录内的资源文件

`ProcessRequest()` 会将可用技能列表和技能使用说明注入系统指令。

## 6. 工具确认（HITL）

### ToolConfirmation 结构体

定义于 `source/tool/toolconfirmation/tool_confirmation.go:50-64`：

```go
type ToolConfirmation struct {
    Hint      string `json:"hint"`      // 向用户解释为何需要确认
    Confirmed bool   `json:"confirmed"` // 用户决策：true=批准，false=拒绝
    Payload   any    `json:"payload"`   // 附加上下文数据
}
```

### 确认流程

ADK 使用 `adk_request_confirmation` 作为确认函数调用的名称，流程如下：

1. 工具检测到需要确认（`RequireConfirmation` 或 `Provider` 返回 `true`）
2. 调用 `ctx.RequestConfirmation(hint, payload)`，发出确认请求
3. ADK 生成一个 `FunctionCall`（名称为 `adk_request_confirmation`），包含 `toolConfirmation` 和 `originalFunctionCall` 参数
4. 客户端应用监听此事件，向用户展示确认提示
5. 用户做出决定后，客户端发送 `FunctionResponse`，包含 `{"confirmed": bool}`
6. 工具再次执行时，通过 `ctx.ToolConfirmation()` 获取确认状态

`OriginalCallFrom()` 辅助函数可从确认函数调用中提取原始的工具调用信息，支持 `*genai.FunctionCall` 和 `map[string]any` 两种格式。

### WithConfirmation 包装器

`tool.WithConfirmation()`（`source/tool/tool.go:192`）可以批量地为整个 Toolset 注入确认逻辑：

```go
confirmed := tool.WithConfirmation(myToolset, true, nil)
```

它会遍历 Toolset 中的所有工具，对实现了 `runnableTool` 接口（提供 `Declaration()` 和 `Run()` 方法）的工具包装为 `confirmationTool`，在 `Run()` 中自动处理确认流程。未实现 `runnableTool` 的工具则原样保留。

## 7. Events：Agent 的事件流

Agent 的 `Run` 方法返回 `iter.Seq2[*session.Event, error]`——一个事件流。Runner 消费这些事件，将其转换为用户可见的输出。ADK 定义了多种事件类型：

| 事件类型 | 说明 |
|----------|------|
| `ContentEvent` | Agent 生成的内容（文本、工具调用等） |
| `StateEvent` | 状态变更 |
| `ActionsEvent` | Agent 流程控制（转移、上报等） |
| `ArtifactEvent` | 产物变更 |
| `ErrorEvent` | 错误信息 |

## 8. 核心包速查

| 包 | 用途 |
|----|------|
| `google.golang.org/adk/agent` | Agent 接口和自定义 Agent |
| `google.golang.org/adk/agent/llmagent` | LLM Agent |
| `google.golang.org/adk/model` | 模型接口 |
| `google.golang.org/adk/model/gemini` | Gemini 模型（内置实现） |
| `google.golang.org/adk/tool/functiontool` | 函数工具 |
| `google.golang.org/adk/tool/geminitool` | Gemini 内置工具（Google Search） |
| `google.golang.org/adk/tool/agenttool` | Agent-as-a-Tool |
| `google.golang.org/adk/tool/mcptoolset` | MCP 工具集 |
| `google.golang.org/adk/session` | 会话和状态管理 |
| `google.golang.org/adk/memory` | 长期记忆 |
| `google.golang.org/adk/artifact` | 产物管理 |
| `google.golang.org/adk/runner` | 运行时引擎 |
| `google.golang.org/adk/cmd/launcher` | 启动器（基础） |
| `google.golang.org/adk/cmd/launcher/full` | 全功能启动器（Web UI + API） |
| `google.golang.org/genai` | Google GenAI SDK（底层模型 API） |

## 9. 常用代码模板

```go
// 最小 LlmAgent
agent, _ := llmagent.New(llmagent.Config{
    Name:  "agent_name",
    Model: model,
})

// 带工具的 LlmAgent
agent, _ := llmagent.New(llmagent.Config{
    Name:        "agent_name",
    Model:       model,
    Instruction: "系统提示词",
    Tools:       []tool.Tool{myTool},
})

// 最小 FunctionTool
tool, _ := functiontool.New(functiontool.Config{
    Name:        "tool_name",
    Description: "工具描述",
}, myFunc)

// 最小 Custom Agent
agent, _ := agent.New(agent.Config{
    Name: "custom_agent",
    Run: func(ctx agent.InvocationContext) iter.Seq2[*session.Event, error] {
        return func(yield func(*session.Event, error) bool) {
            // 自定义逻辑
        }
    },
})
```

## 10. Agent-as-a-Tool 实战

将一个 Agent 包装为工具，实现 Agent 间委托：

```go
import "google.golang.org/adk/tool/agenttool"

// 创建一个专门做摘要的 Agent
summarizer, _ := llmagent.New(llmagent.Config{
    Name:        "summarizer",
    Model:       model,
    Instruction: "你是一个摘要专家。请对提供的内容生成简洁的摘要。",
})

// 将 Agent 包装为 Tool（SkipSummarization 避免双层摘要）
summarizeTool := agenttool.New(summarizer, &agenttool.Config{
    SkipSummarization: true,
})

// 在主 Agent 中使用
mainAgent, _ := llmagent.New(llmagent.Config{
    Name:  "main_agent",
    Model: model,
    Tools: []tool.Tool{
        searchTool,
        summarizeTool,  // 把摘要 Agent 当工具用
    },
})
```

## 11. 长运行工具

有些工具需要较长时间执行（如创建工单后等待审批）。设置 `IsLongRunning: true` 启用"暂停-恢复"模式：

```go
createTicketTool, _ := functiontool.New(functiontool.Config{
    Name:          "create_ticket",
    Description:   "Create a support ticket and wait for approval.",
    IsLongRunning: true,  // 标记为长运行工具
}, func(ctx tool.Context, args createTicketArgs) (createTicketResult, error) {
    // 创建工单
    ticketID := createTicketInSystem(args.Title, args.Description)

    // 返回初始结果，Agent 会暂停等待
    return createTicketResult{
        Status:   "pending_approval",
        TicketID: ticketID,
    }, nil
})
```

长运行工具返回后，Agent 会暂停。应用后续通过 REST API 发送 `FunctionResponse`（带 `WillContinue` 标志）来继续执行。

## 12. Skills 技能系统

Skills 是 ADK v1.2.0 引入的**实验性功能**，把指令、工具和参考资源打包成一个自包含的"技能包"。

### Skill 目录结构

```
skills/
    weather-skill/
        SKILL.md              # 必需：技能描述 + 指令
        references/           # 参考文档
            city-list.txt
        assets/               # 资源文件
        scripts/              # 脚本
```

`SKILL.md` 示例：

```markdown
---
name: weather-assistant
description: 提供城市天气查询和历史天气分析能力
---

## 使用说明

当用户询问天气相关问题时，按以下步骤操作：

1. 使用 get_city_weather 工具获取当前天气
2. 如果用户问历史天气，使用 get_historical_weather 工具
3. 回复时包含温度、天气描述和穿衣建议

## 注意事项

- 温度低于 10°C 时提醒用户注意保暖
- 温度高于 35°C 时提醒用户注意防暑
```

### 在 Go 代码中使用 Skills

```go
import (
    "google.golang.org/adk/tool/skilltoolset"
    "google.golang.org/adk/tool/skilltoolset/skill"
)

skillToolset, err := skilltoolset.New(ctx, skilltoolset.Config{
    Source: skill.NewFileSystemSource(os.DirFS("./skills")),
})

// 绑定到 Agent（注意用 Toolsets，不是 Tools）
agent, _ := llmagent.New(llmagent.Config{
    Name:     "skill_agent",
    Model:    model,
    Toolsets: []tool.Toolset{skillToolset},
})
```

## 13. Tools vs Toolsets

| 维度 | Tools | Toolsets |
|------|-------|----------|
| 定义方式 | `[]tool.Tool{tool1, tool2}` | `[]tool.Toolset{toolset1}` |
| 工具列表 | 固定不变 | **可动态变化** |
| 过滤能力 | 无 | 支持 Predicate 按条件过滤 |
| 适用场景 | 工具数量少且固定 | Skills、MCP、动态权限控制 |

```go
// Tools：简单的固定工具列表
agent, _ := llmagent.New(llmagent.Config{
    Tools: []tool.Tool{searchTool, calcTool, emailTool},
})

// Toolsets：动态过滤（根据用户角色暴露不同工具）
agent, _ := llmagent.New(llmagent.Config{
    Toolsets: []tool.Toolset{
        tool.FilterToolset(myToolset, tool.AllowedToolsPredicate([]string{"search", "calc"})),
    },
})
```

## 14. 常见问题与踩坑指南

**Q：jsonschema tag 写错了会怎样？**

A：LLM 会误解参数含义，导致传错参数或调用失败。这是自定义 Tool 最常见的 bug 来源。建议每次修改 tag 后测试 Agent 的工具调用是否正确。

**Q：Tool 函数里能调用数据库吗？**

A：可以。Tool 函数就是普通的 Go 函数，你可以做任何操作——调用 HTTP API、查询数据库、读写文件、发送消息。但要注意**超时处理**，LLM 等待工具响应的时间是有限的。

**Q：一个 Agent 能挂多少个 Tool？**

A：没有硬性限制，但 LLM 的工具选择能力会随着工具数量增加而下降。建议不超过 10-15 个工具。如果工具太多，考虑用多 Agent 架构（每个 Agent 只负责一类工具）。

**Q：OpenAPI Tools 支持 Go 吗？**

A：目前不支持。ADK-Go 无法直接从 OpenAPI spec 自动生成 Tool。替代方案：手动定义 FunctionTool，或使用 MCP Tools。

**Q：Tool 性能优化怎么做？**

A：Go 天然支持 goroutine 并发，Tool 函数内部可以使用 goroutine 并行调用多个 API。虽然 ADK-Go 不保证自动并行执行多个 tool call，但你可以通过在 Tool 函数内使用并发来优化。

## 15. functiontool.Config 速查

| 参数 | 说明 |
|------|------|
| `Name` | 工具名称，LLM 通过此名称调用 |
| `Description` | 工具描述，**决定 LLM 调用准确性** |
| `IsLongRunning` | 长运行工具标记 |
| `RequireConfirmation` | 始终需要确认 |
| `RequireConfirmationProvider` | 动态确认判断函数 `func(TArgs) bool` |
| `InputSchema` | 手动指定输入 Schema（默认从 tag 推断） |
| `OutputSchema` | 手动指定输出 Schema |
