# Tool Calling — trpc-agent-go 的招牌能力

> trpc-agent-go 的招牌能力是 Tool Calling——让 LLM 自主决定调哪个工具。不懂 `tool_call → tool_response` 循环，就看不懂任何带工具的示例。

## 核心概念

普通 Chat Completion 只会「说」，不会「做」——模型无法查天气、查数据库、调外部 API。Tool Calling（也叫 Function Calling）补上了这个口子：**模型在回答前，可以先要求调用一个由宿主程序提供的函数，把函数返回值喂回来再生成最终答案**。一次完整的 Tool Calling 由五步构成：

```
┌────────┐  ① user: "北京今天天气？"         ┌────────┐
│  User  │ ────────────────────────────────▶ │  LLM   │
└────────┘                                    └────────┘
                                                  │
                 ② assistant + tool_calls         │
            [{id:call_1, name:get_weather,        ▼
             args:{"city":"北京"}}]
┌────────┐  ③ 框架拦截 tool_calls, 执行函数  ┌────────┐
│Framework│◀──────────────────────────────│ Tool   │
│ Agent  │  返回 {"temp":18,"cond":"晴"}   │ (Go)   │
└────────┘ ──────────────────────────────▶ └────────┘
            ④ role:tool, tool_id:call_1,
              content:"{\"temp\":18,...}"
            ───────────────────────────────▶ ┌────────┐
                                              │  LLM   │
                 ⑤ 最终自然语言回答           │        │
            "北京今天 18°C, 晴, 适合出行。"   └────────┘
```

理解这个循环要抓住三个要点：

1. **工具是 schema 描述的，不是代码**。宿主把工具的 `name`、`description`、`parameters`(JSON Schema) 提前告诉模型。模型根据这套「说明书」**自主决定**该不该调、调哪个、参数怎么填。schema 写得越清晰，模型选错工具的概率越低。
2. **`tool_calls` 不是字符串**，而是 assistant message 上的一个结构化字段（`[]ToolCall`），框架必须能识别它，而不是把它当普通文本。
3. **`tool` 角色消息必须回带 `tool_id`**。一次问句可能触发**多个并行工具调用**（parallel tool calls），每个 call 都有独立 id；宿主要为每个 id 生成一条 `role: tool` 消息，模型才能正确配对结果。少回一条或回错 id，模型会以为工具丢了，要么重试要么编结果。

整条流程对调用方来说，**最重要的事**是：(a) 注册工具时给出干净的 schema；(b) 框架（不是业务代码）负责截获 `tool_calls`、执行、回灌 `tool` 消息、再次请求模型，直到模型不再要工具为止。

## 在 trpc-agent-go 里

### `ToolCall` 与 `role: tool` 消息

模型侧的 tool call 在 `model/request.go:563-577` 里被建模成一个独立结构体：

```go
// model/request.go:563
type ToolCall struct {
    Type     string                 `json:"type"`        // 目前固定为 "function"
    Function FunctionDefinitionParam `json:"function,omitempty"`
    ID       string                 `json:"id,omitempty"` // 模型下发的调用 ID, 回灌 tool 消息时要用
    Index    *int                   `json:"index,omitempty"` // 流式响应里分片聚合用
    ExtraFields map[string]any      `json:"extra_fields,omitempty"`
}
```

`ToolCall` 挂在 assistant 消息上（`model/request.go:75-76`）：

```go
// model/request.go:75
// ToolCalls is the optional tool calls for the message.
ToolCalls []ToolCall `json:"tool_calls,omitempty"`
```

而工具结果通过 `NewToolMessage` 构造为 `role: tool` 消息（`model/request.go:350-358`）：

```go
// model/request.go:350
func NewToolMessage(toolID, toolName, content string) Message {
    return Message{
        Role:     RoleTool,
        ToolID:   toolID,   // 必须等于 assistant 下发的 ToolCall.ID
        ToolName: toolName,
        Content:  content,  // 通常是 JSON 字符串
    }
}
```

注意 `ToolID` 这一列：**parallel tool calls 时模型会下发多个 `ToolCall` 各自带 ID，回灌必须 1:1 对应**，框架据此把结果配对到正确的 call。

### `NewFunctionTool[I, O any]`：用泛型自动生成 schema

手写 JSON Schema 又长又易错。trpc-agent-go 用 Go 泛型解决了这件事——你只写一个普通 Go 函数和它的入参/出参 struct，schema 由框架反射生成（`tool/function/function_tool.go:117-163`）：

```go
// tool/function/function_tool.go:117
func NewFunctionTool[I, O any](fn func(context.Context, I) (O, error), opts ...Option) *FunctionTool[I, O] {
    // ...
    var (
        emptyI I
        emptyO O
    )
    var iSchema *tool.Schema
    if options.inputSchema != nil {
        iSchema = options.inputSchema
    } else {
        iSchema = itool.GenerateJSONSchema(reflect.TypeOf(emptyI)) // (1) 由 I 反推 schema
    }
    // ...
}
```

**(1)** 处是关键：框架用 `reflect.TypeOf(emptyI)` 反射你的入参 struct，连同字段上的 `jsonschema:"description=...,enum=..."` tag 一起编译成 JSON Schema。这意味着 **schema 永远和 Go 类型一致**，不会出现「文档说有 3 个参数、代码实际要 4 个」的漂移。

### 真实示例：calculator 工具

`examples/runner/tools.go` 给了一个可直接对照的最小例子。先是入参/出参 struct，字段上的 tag 就是 schema 描述：

```go
// examples/runner/tools.go:83
type calculatorArgs struct {
    Operation string  `json:"operation" jsonschema:"description=The operation to perform,enum=add,enum=subtract,enum=multiply,enum=divide,enum=power"`
    A         float64 `json:"a" jsonschema:"description=First number"`
    B         float64 `json:"b" jsonschema:"description=Second number"`
}
```

然后是函数本体（`examples/runner/tools.go:20-48`）：

```go
// examples/runner/tools.go:20
func (c *multiTurnChat) calculate(ctx context.Context, args calculatorArgs) (calculatorResult, error) {
    var result float64
    switch strings.ToLower(args.Operation) {
    case "add", "+":   result = args.A + args.B
    case "subtract", "-": result = args.A - args.B
    // ...
    }
    return calculatorResult{Operation: args.Operation, A: args.A, B: args.B, Result: result}, nil
}
```

最后在 `examples/runner/main.go:97-101` 注册成 tool，并通过 `llmagent.WithTools` 挂到 agent：

```go
// examples/runner/main.go:97
calculatorTool := function.NewFunctionTool(
    c.calculate,
    function.WithName("calculator"),
    function.WithDescription("Perform basic mathematical calculations (add, subtract, multiply, divide, power)"),
)
// examples/runner/main.go:120
llmagent.New(agentName,
    llmagent.WithModel(modelInstance),
    llmagent.WithTools([]tool.Tool{calculatorTool, timeTool}),
    llmagent.WithEnableParallelTools(*enableParallel), // (2) 允许模型一次下发多个 tool_calls
)
```

**(2)** `WithEnableParallelTools` 打开并行调用——模型可以在一轮里同时要 `calculator` 和 `current_time`，框架会并发执行并按 ID 回灌两条 `role: tool` 消息。

### 框架内置的 agent loop

业务代码只负责「注册工具 + 处理最终事件流」，**截获 `tool_calls`、调用 `tool.Call`、构造 `NewToolMessage`、再次请求模型** 这整套循环由 `LLMAgent` 内部完成。调用方想自己接管执行（比如工具要外部签名、人审）也可以，用 `WithExternalTools`（`agent/invocation.go:927-933`）把工具标为「外部执行」，框架会在下发 `tool_calls` 后停下来，把执行权交还给你，由你调 `model.NewToolMessage` 准备好结果再继续下一轮。

## 常见陷阱

### 陷阱 1：工具名带中文 / 特殊字符 → 模型识别率骤降或 API 报错

❌ 用 `WithName("计算器")`、`WithName("get-weather()")` 之类带中文、括号、空格的名字。Kimi、DeepSeek 等多家 provider 对 tool name 强制要求正则 `^[a-zA-Z0-9_-]+$`，含中文或特殊符号会直接 400，即便 provider 接受，模型对非 snake_case 命名的召回率也会显著下降。

✅ 修复：tool name **只用 `a-z`/`0-9`/`_`/`-`**，源码注释 `tool/function/function_tool.go:55-62` 已明确写出这条约束。`tool/function/function_tool.go:63` 的 `WithName` 文档把它列为「Best practice」。

```go
// ❌ 多家 provider 直接拒绝
function.WithName("计算器")
function.WithName("get-weather()")

// ✅ snake_case 动词短语
function.WithName("calculator")
function.WithName("get_weather")
```

### 陷阱 2：schema 写得太省（缺 description / enum）→ 模型瞎填参数

❌ 只给字段标 `json:"city"` 不加 `jsonschema:"description=..."`。模型不知道 `city` 该填中文还是拼音、要不要带「市」、是否接受缩写，结果就是同一种问法每次填的值都不一样，工具调用稳定性崩盘。

✅ 修复：每个字段都写 `description`；取值有限的字段加 `enum`；歧义字段给例子。对比 `examples/runner/tools.go:84`：`operation` 字段同时带了 description 和五个 enum，模型几乎不会填错。

```go
// ❌ 模型只能猜
type args struct {
    City string `json:"city"`
}

// ✅ 模型有明确指引
type args struct {
    City string `json:"city" jsonschema:"description=城市中文名,例如 北京/上海"`
    Unit string `json:"unit" jsonschema:"description=温度单位,enum=celsius,enum=fahrenheit"`
}
```

### 陷阱 3：工具返回大段文本 → context 爆炸

❌ 一个 `search_docs` 工具把整页 HTML / 几万字原文塞进 `calculatorResult` 这种返回值。每个 tool call 的结果都会以 `role: tool` 消息进对话历史，**且不会自动截断**——多轮调用下来 token 消耗指数级增长，最终触发 max_tokens 或被 provider 拒绝。

✅ 修复：工具内部**先压缩、再返回**——长文本走摘要 / 截断，大列表分页只返回 Top-N；必要时用 `function.WithSkipSummarization(true)`（`tool/function/function_tool.go:87-91`）让外层 agent 跳过二次总结，避免「工具已经摘要过、agent 又摘要一遍」的叠加浪费。

### 陷阱 4：用名词 / 缩写给工具命名 → 模型不知道何时该调

❌ `WithName("db")`、`WithName("q")`、`WithName("data")`——名字是名词或单字母，`description` 又很简短。模型判断「要不要调这个工具」主要靠 **name + description 的语义匹配**，名词命名让模型把它当数据当字段，而不是可执行动作。

✅ 修复：name 用 **「动词 + 宾语」的 snake_case**（`get_weather`、`search_docs`、`calculate`），description 第一句话直接说「在什么情况下调用本工具」。`examples/runner/main.go:100` 的 `Perform basic mathematical calculations (...)` 就是好范例。

```go
// ❌ 名词命名 + 模糊描述
function.WithName("db"),
function.WithDescription("database helper")

// ✅ 动词短语 + 触发场景
function.WithName("query_order"),
function.WithDescription("Query order status by order ID. Use when the user asks about an existing order.")
```

## 小结

- Tool Calling 的本质是一条 `tool_call → tool_response` 循环：assistant 消息携带结构化的 `ToolCalls`，宿主执行后用 `role: tool` 消息（带 `tool_id`）回灌，模型据此生成最终答案。
- trpc-agent-go 用 `model.ToolCall`（`model/request.go:563`）建模 tool call，用 `model.NewToolMessage`（`model/request.go:350`）构造回灌消息；并行调用时 `tool_id` 必须 1:1 对齐。
- `function.NewFunctionTool[I, O any]`（`tool/function/function_tool.go:117`）靠 Go 泛型 + `reflect` 自动从入参 struct 生成 JSON Schema，schema 与类型同源，不漂移。
- 业务代码只写「函数 + 入参 struct + jsonschema tag」，agent loop（截获 tool_calls / 执行 / 回灌 / 再次请求）由 `LLMAgent` 内部完成；要自己接管执行就用 `WithExternalTools`。
- 工具名严格用 `^[a-zA-Z0-9_-]+$` 的 snake_case 动词短语，schema 每个字段都要有 description / enum，工具返回值要先压缩——这三件事决定 Tool Calling 的稳定性。

**延伸阅读：**

- [工具系统](../examples/02-tool-system/tool.md)
- [MCP 工具](../examples/03-mcp-tools/mcptool.md)
- [LLM 与 Chat Completion](./07-llm-chat-completion)
