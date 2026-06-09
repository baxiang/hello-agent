# Tool 工具系统详解

Tool 系统是 Agent 与外部世界交互的核心组件，支持 Function Tools、MCP Tools、Agent Tools 等多种类型。

## 1. 核心接口

### 1.1 Tool 接口层次

```go
// 基础接口 — 所有工具的根
type Tool interface {
    Declaration() *Declaration  // 返回工具元数据
}

// 可调用工具 — 同步执行
type CallableTool interface {
    Call(ctx context.Context, jsonArgs []byte) (any, error)
    Tool
}

// 流式工具 — 流式返回结果
type StreamableTool interface {
    StreamableCall(ctx context.Context, jsonArgs []byte) (*StreamReader, error)
    Tool
}

// 工具集 — 管理一组相关工具的生命周期
type ToolSet interface {
    Tools(context.Context) []tool.Tool
    Close() error
    Name() string
}
```

### 1.2 Declaration 元数据

```go
type Declaration struct {
    Name        string       // 工具名（必须稳定、唯一、描述性，推荐 snake_case）
    Description string       // 工具描述（LLM 据此决定何时使用）
    InputSchema *Schema      // 输入参数 JSON Schema
    OutputSchema *Schema     // 输出 JSON Schema（可选）
}
```

> **重要**：`name` 和 `description` 直接影响 LLM 工具调用的准确率。缺失或模糊的描述会显著降低工具调用稳定性。

---

## 2. Function Tools

Go 函数直接转换为工具，是最简单的工具类型。

### 2.1 Callable Tool

```go
import "trpc.group/trpc-go/trpc-agent-go/tool/function"

func calculator(ctx context.Context, req struct {
    Operation string  `json:"operation" jsonschema:"description=运算类型,enum=add,enum=sub,enum=mul,enum=div,required"`
    A         float64 `json:"a" jsonschema:"description=第一操作数,required"`
    B         float64 `json:"b" jsonschema:"description=第二操作数,required"`
}) (map[string]interface{}, error) {
    // ... 实现
}

calcTool := function.NewFunctionTool(
    calculator,
    function.WithName("calculator"),
    function.WithDescription("执行加减乘除运算"),
)
```

### 2.2 字段描述标记

使用 `jsonschema` struct tag 定义字段约束：

```go
type WeatherInput struct {
    Location string `json:"location" jsonschema:"description=查询地点,required"`
    Unit     string `json:"unit" jsonschema:"description=温度单位,enum=celsius,enum=fahrenheit"`
}
```

`jsonschema` 标签以逗号 `,` 分隔，**描述值不能包含逗号**。兼容旧版 `description:"..."` 标签。

### 2.3 自定义 Input Schema

需要完整控制输入 Schema 时：

```go
calcTool := function.NewFunctionTool(
    calculator,
    function.WithName("calculator"),
    function.WithInputSchema(myCustomSchema),  // 完全绕过自动生成
)
```

### 2.4 Streamable Tool

```go
type weatherOutput struct {
    Weather string `json:"weather"`
}

func getStreamableWeather(input weatherInput) *tool.StreamReader {
    stream := tool.NewStream(10)
    go func() {
        defer stream.Writer.Close()
        for i := 0; i < len(result); i++ {
            chunk := tool.StreamChunk{
                Content:  result[i:i+1],
                Metadata: tool.Metadata{CreatedAt: time.Now()},
            }
            if closed := stream.Writer.Send(chunk, nil); closed { break }
            time.Sleep(10 * time.Millisecond)
        }
    }()
    return stream.Reader
}

weatherStreamTool := function.NewStreamableFunctionTool[weatherInput, weatherOutput](
    getStreamableWeather,
    function.WithName("get_weather_stream"),
    function.WithDescription("流式获取天气信息"),
)
```

**流式工具适用场景**：日志查询、实时数据流、大文件处理等需要渐进返回结果的场景。

---

## 3. MCP Tools（Model Context Protocol）

基于 MCP 协议接入外部工具服务，支持三种传输方式。

### 3.1 STDIO Transport

```go
import "trpc.group/trpc-go/trpc-agent-go/tool/mcp"

ts := mcp.NewMCPToolSet(
    mcp.ConnectionConfig{
        Transport: "stdio",
        Command:   "python",
        Args:      []string{"mcp_server.py"},
        Timeout:   30 * time.Second,
    },
)
defer ts.Close()
```

### 3.2 SSE Transport

```go
ts := mcp.NewMCPToolSet(
    mcp.ConnectionConfig{
        Transport: "sse",
        ServerURL: "http://localhost:8080/sse",
        Timeout:   10 * time.Second,
    },
)
```

### 3.3 Streamable HTTP Transport

```go
ts := mcp.NewMCPToolSet(
    mcp.ConnectionConfig{
        Transport:     "streamable_http",
        ServerURL:     "http://localhost:8080/mcp",
        HTTPHeaders:   map[string]string{"Authorization": "Bearer token"},
    },
)
```

### 3.4 MCP 工具过滤

```go
// 按名称包含/排除
ts := mcp.NewMCPToolSet(
    config,
    mcp.WithToolFilterFunc(func(name string) bool {
        return !strings.HasPrefix(name, "internal_")
    }),
)

// Per-Run 过滤
events, _ := r.Run(ctx, userID, sessionID, msg,
    agent.WithToolFilter(func(t tool.Tool) bool {
        return t.Declaration().Name != "dangerous_tool"
    }),
)
```

### 3.5 MCP Broker（按需发现）

MCP Broker 让 Agent 在对话中动态发现和连接 MCP 服务器：

```go
broker := mcp.NewBroker(
    mcp.WithBrokerServers(serverURLs),
    mcp.WithBrokerAuthHook(func(ctx context.Context, url string) map[string]string {
        return map[string]string{"Authorization": "Bearer " + getUserToken(ctx)}
    }),
)
```

Broker 提供 4 个模型可见工具：`mcp_list_servers`、`mcp_describe_server`、`mcp_connect_server`、`mcp_disconnect_server`。

### 3.6 动态 Tool Discovery

LLMAgent 级别的选项，让 Agent 在运行时动态获取 MCP 工具：

```go
agent := llmagent.New("dynamic-agent",
    llmagent.WithModel(modelInstance),
    llmagent.WithDynamicMCPToolDiscovery(true),
)
```

---

## 4. Agent Tool（AgentTool）

将 Agent 包装为可调用工具，用于构建多 Agent 协作系统。

### 4.1 基础用法

```go
import "trpc.group/trpc-go/trpc-agent-go/tool/agenttool"

weatherAgentTool := agenttool.New(weatherAgent,
    agenttool.WithSkipSummarization(true),   // 跳过子 Agent 的摘要
    agenttool.WithStreamInner(true),         // 流式转发内部输出
    agenttool.WithHistoryScope(agenttool.HistoryScopeIsolated), // 上下文隔离
)
```

### 4.2 流式转发

启用 `WithStreamInner(true)` 后，子 Agent 的输出会实时转发到父 Agent 的 event channel。

### 4.3 上下文可见性

| 模式 | 说明 |
|------|------|
| `HistoryScopeFull` | 子 Agent 看到完整对话历史 |
| `HistoryScopeIsolated` | 仅看到当前工具调用的 message |
| `HistoryScopeParentToolCall` | 看到父 Agent 的 tool call 上下文 |

---

## 5. 内置工具

### 5.1 DuckDuckGo 搜索

```go
import "trpc.group/trpc-go/trpc-agent-go/tool/duckduckgo"

searchTool := duckduckgo.NewTool(
    duckduckgo.WithBaseURL("https://api.duckduckgo.com"),
    duckduckgo.WithUserAgent("my-app/1.0"),
    duckduckgo.WithHTTPClient(&http.Client{Timeout: 15 * time.Second}),
)
```

### 5.2 Todo Tool

```go
import "trpc.group/trpc-go/trpc-agent-go/tool/todo"

todoTool := todo.New()
agent := llmagent.New("todo-assistant",
    llmagent.WithTools([]tool.Tool{todoTool}),
    llmagent.WithInstruction(todo.DefaultToolPrompt), // 教 LLM 何时调用 todo_write
)
```

**Todo 强制执行**：安装 `todoenforcer` 扩展后，有未完成 todo 的 Agent 必须完成或声明阻塞才能结束。

```go
import "trpc.group/trpc-go/trpc-agent-go/agent/extension/todoenforcer"

agent := llmagent.New("todo-assistant",
    llmagent.WithExtensions([]agent.Extension{todoenforcer.New()}),
)
```

### 5.3 Claude Code ToolSet

```go
import "trpc.group/trpc-go/trpc-agent-go/tool/claudecode"

toolSet, _ := claudecode.NewToolSet(
    claudecode.WithBaseDir("."),
    claudecode.WithReadOnly(true),
)
defer toolSet.Close()
```

提供 Bash、Read、Glob、Grep、WebFetch、WebSearch 等工具。ReadOnly 模式下去除 Write/Edit/NotebookEdit。

---

## 6. 权限与安全

### 6.1 Tool Metadata

```go
type ToolMetadata struct {
    ReadOnly        bool
    Destructive     bool
    ConcurrencySafe bool
    SearchOrRead    bool
    OpenWorld       bool
    MaxResultSize   int
}
```

MCP 工具的 `readOnlyHint`、`destructiveHint`、`openWorldHint` 注解会自动映射到 Metadata。

### 6.2 权限策略

```go
events, _ := r.Run(ctx, userID, sessionID, message,
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

三种决策：

| 决策 | 行为 |
|------|------|
| `tool.AllowPermission()` | 执行工具 |
| `tool.DenyPermission(reason)` | 跳过，返回 `denied` 结果给模型 |
| `tool.AskPermission(reason)` | 跳过，返回 `approval_required` 结果给模型 |

### 6.3 工具执行过滤器

```go
events, _ := r.Run(ctx, userID, sessionID, msg,
    agent.WithToolExecutionFilter(func(t tool.Tool, args []byte) bool {
        return t.Declaration().Name == "external_api" // 仅标记特定工具
    }),
)
// 标记的工具调用留待调用方自行执行，不进入框架的自动执行流程
```

---

## 7. 工具重试

```go
policy := &tool.RetryPolicy{
    MaxAttempts:     3,
    InitialInterval: 200 * time.Millisecond,
    BackoffFactor:   2.0,
    MaxInterval:     2 * time.Second,
    Jitter:          true,
}

// LLMAgent
agent := llmagent.New("assistant",
    llmagent.WithTools([]tool.Tool{myTool}),
    llmagent.WithToolCallRetryPolicy(policy),
)

// Graph
sg.AddToolsNode("tools", tools,
    graph.WithToolCallRetryPolicy(policy),
)
```

默认重试规则覆盖 `io.EOF`、`io.ErrUnexpectedEOF`、网络超时等常见瞬时错误。自定义 `RetryOn` 可扩展重试条件：

```go
policy.RetryOn = func(ctx context.Context, info *tool.RetryInfo) (bool, error) {
    if retry, err := tool.DefaultRetryOn(ctx, info); retry || err != nil {
        return retry, err
    }
    return info.ResultError, nil // 结果级失败也重试
}
```

---

## 8. Tool Call ID

在工具内部获取当前平台分配的工具调用 ID：

```go
func myTool(ctx context.Context, args MyArgs) (any, error) {
    toolCallID, ok := tool.ToolCallIDFromContext(ctx)
    log.Printf("tool_call_id=%s args=%+v", toolCallID, args)
    // ...
}
```

**子 Agent 关联**：当工具内部启动子 Agent 时，可以将 `tool_call_id` 通过 `RuntimeState` 传递给子 Agent，UI 层可利用此信息构建执行树：

```go
func delegateToChild(ctx context.Context, args delegateArgs) (string, error) {
    toolCallID, _ := tool.ToolCallIDFromContext(ctx)
    parentInv, _ := agent.InvocationFromContext(ctx)

    childRunOptions := parentInv.RunOptions
    childRunOptions.RuntimeState = map[string]any{
        "display.parent_tool_call_id": toolCallID,
    }

    childCtx := agent.NewInvocationContext(ctx, parentInv.Clone(
        agent.WithInvocationAgent(childAgent),
        agent.WithInvocationRunOptions(childRunOptions),
    ))

    eventCh, _ := agent.RunWithPlugins(childCtx, parentInv, childAgent)
    // ...
}
```

---

## 9. 动态 ToolSet 管理

运行时动态添加/移除 ToolSet：

```go
agent := llmagent.New("dynamic-agent",
    llmagent.WithModel(modelInstance),
)

// 运行时动态注册
agent.SetToolSets(ctx, []tool.ToolSet{newToolSet})
```

### JSON 参数自动修复

```go
events, _ := r.Run(ctx, userID, sessionID, msg,
    agent.WithToolCallArgumentsJSONRepairEnabled(true),
)
```

自动修复未引号的 key、尾随逗号等非严格 JSON。

---

## 10. 并行工具执行

框架默认支持同一轮对话中的多个 `tool_calls` 并行执行（当工具实现了 `ConcurrencySafe` metadata 标记时）。无此标记的工具串行执行以保证安全。
