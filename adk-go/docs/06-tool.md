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
```

### StreamingFunctionTool

定义于 `source/tool/functiontool/streaming_function.go`，用于流式输出场景：

```go
type StreamingFunc[TArgs any] func(tool.Context, TArgs) iter.Seq2[string, error]

func NewStreaming[TArgs any](cfg Config, handler StreamingFunc[TArgs]) (tool.Tool, error)
```

与 `FunctionTool` 不同，处理函数返回 `iter.Seq2[string, error]`，逐步 yield 文本片段，适用于实时输出场景（如逐字生成回答）。确认逻辑与 `FunctionTool` 完全一致。

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
