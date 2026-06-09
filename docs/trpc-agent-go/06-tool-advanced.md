# 工具进阶 — 权限·重试·Tool Call ID 链路

本文深入工具系统的安全机制、重试策略、以及跨 Agent 调用的 Tool Call ID 传递链路。

## 1. 权限策略系统

### 1.1 三层安全模型

```
┌──────────────────────────────────────────┐
│  Layer 1: ToolFilter（可见性控制）         │
│  - 决定哪些工具对 LLM 可见                │
│  - LLM 只能调用 Filter 放行的工具          │
└──────────────┬───────────────────────────┘
               ▼
┌──────────────────────────────────────────┐
│  Layer 2: ToolPermissionPolicy（权限检查） │
│  - LLM 请求调用后、执行前检查              │
│  - 可返回 Allow / Deny / AskPermission    │
└──────────────┬───────────────────────────┘
               ▼
┌──────────────────────────────────────────┐
│  Layer 3: ToolExecutionFilter（执行拦截）  │
│  - 标记需要外部执行的工具                 │
│  - 框架不自动执行，交由调用方处理          │
└──────────────────────────────────────────┘
```

### 1.2 ToolFilter — 可见性控制

```go
// Agent 全局过滤
agent := llmagent.New("assistant",
    llmagent.WithTools(allTools),
    llmagent.WithToolFilter(func(t tool.Tool) bool {
        return t.Declaration().Name != "dangerous_tool"
    }),
)

// Per-Run 过滤（覆盖 Agent 级别）
events, _ := r.Run(ctx, userID, sessionID, msg,
    agent.WithToolFilter(func(t tool.Tool) bool {
        return isAdmin(userID) || !toolMetadata.Destructive
    }),
)
```

**设计要点**：Filter 在 LLM 调用之前执行——被过滤的工具根本不会出现在 LLM 的 tools 声明中，LLM 无从知晓它们存在。

### 1.3 ToolPermissionPolicy — 运行时权限

```go
type PermissionRequest struct {
    ToolName    string
    ToolDeclaration *Declaration
    Arguments   []byte         // JSON 格式的参数
    Metadata    ToolMetadata
    Invocation  *Invocation
}

type PermissionDecision int
const (
    AllowDecision  PermissionDecision = iota  // 允许执行
    DenyDecision                               // 拒绝执行
    AskDecision                                // 需要审批
)

events, _ := r.Run(ctx, userID, sessionID, msg,
    agent.WithToolPermissionPolicyFunc(func(ctx context.Context, req *tool.PermissionRequest) (tool.PermissionDecision, error) {
        // 示例：破坏性操作需要审批
        if req.Metadata.Destructive {
            return tool.AskPermission("destructive action requires approval"), nil
        }
        // 示例：超过 1MB 的参数拒绝
        if len(req.Arguments) > 1024*1024 {
            return tool.DenyPermission("arguments too large"), nil
        }
        return tool.AllowPermission(), nil
    }),
)
```

**三种决策的语义**：

| 决策 | 行为 | LLM 收到的反馈 |
|------|------|---------------|
| `AllowPermission()` | 正常执行工具 | 正常的 tool result |
| `DenyPermission(reason)` | 跳过执行 | `{"error": "denied", "reason": "..."}` |
| `AskPermission(reason)` | 跳过执行 | `{"error": "approval_required", "reason": "..."}` |

**实现细节**：PermissionPolicy 在 JSON 参数修复（如果启用）和 BeforeTool 回调（参数验证后）执行。工具如果实现了 `PermissionChecker` 接口，其 Checker 优先于全局 Policy。

### 1.4 ToolExecutionFilter — 执行拦截

```go
events, _ := r.Run(ctx, userID, sessionID, msg,
    agent.WithToolExecutionFilter(func(t tool.Tool, args []byte) bool {
        // 返回 true 的工具由框架自动执行
        // 返回 false 的工具标记为 "pending"，调用方自行处理
        return t.Declaration().Name != "human_approval_required"
    }),
)
```

标记为 pending 的工具调用需要在事件中捕获并另行处理。

---

## 2. 工具重试机制

### 2.1 RetryPolicy 配置

```go
type RetryPolicy struct {
    MaxAttempts     int           // 总尝试次数（含首次）
    InitialInterval time.Duration // 首次重试前的等待
    BackoffFactor   float64       // 退避因子（指数增长）
    MaxInterval     time.Duration // 最大间隔
    Jitter          bool          // 是否加入随机抖动
    RetryOn         func(ctx context.Context, info *RetryInfo) (bool, error) // 自定义重试条件
}

type RetryInfo struct {
    ToolName     string
    Attempt      int
    RawError     error
    ResultError  bool     // 是否为结果级别错误（而非底层错误）
    Elapsed      time.Duration
}
```

### 2.2 默认重试规则

```go
// tool/retry.go
func DefaultRetryOn(ctx context.Context, info *RetryInfo) (bool, error) {
    if info.RawError == nil { return false, nil }
    if errors.Is(info.RawError, context.Canceled) { return false, nil }
    if errors.Is(info.RawError, context.DeadlineExceeded) { return false, nil }

    // 网络瞬时错误
    if errors.Is(info.RawError, io.EOF) { return true, nil }
    if errors.Is(info.RawError, io.ErrUnexpectedEOF) { return true, nil }

    // 检查 net.Error 的 Timeout/Temporary
    var netErr net.Error
    if errors.As(info.RawError, &netErr) {
        return netErr.Timeout() || netErr.Temporary(), nil
    }
    return false, nil
}
```

**保守策略的原因**：工具可能产生副作用（写入数据库、发送通知），盲目重试可能导致重复操作。默认只重试网络层面的瞬时错误。

### 2.3 自定义重试条件

```go
policy := &tool.RetryPolicy{
    MaxAttempts:     2,
    InitialInterval: 200 * time.Millisecond,
    BackoffFactor:   2.0,
    MaxInterval:     time.Second,
    RetryOn: func(ctx context.Context, info *tool.RetryInfo) (bool, error) {
        // 1. 先走默认规则
        if retry, err := tool.DefaultRetryOn(ctx, info); retry || err != nil {
            return retry, err
        }
        // 2. 结果级错误也重试（谨慎使用）
        if info.ResultError {
            return true, nil
        }
        // 3. 特定错误消息
        if strings.Contains(info.RawError.Error(), "temporary unavailable") {
            return true, nil
        }
        return false, nil
    },
}
```

### 2.4 重试在 LLMAgent 和 Graph 中的配置

```go
// LLMAgent
agent := llmagent.New("assistant",
    llmagent.WithTools([]tool.Tool{myTool}),
    llmagent.WithToolCallRetryPolicy(policy),
)

// Graph ToolsNode
sg.AddToolsNode("tools", tools,
    graph.WithToolCallRetryPolicy(policy),
)
```

**重试范围**：仅重试当前工具调用——不会重跑整个 Agent 或 Graph 流程。

---

## 3. Tool Call ID 链路

### 3.1 什么是 Tool Call ID

每次 LLM 发起工具调用时，OpenAI/Anthropic API 会返回一个唯一 `tool_call_id`：

```json
{
    "id": "call_abc123def456",
    "type": "function",
    "function": {
        "name": "get_weather",
        "arguments": "{\"city\":\"Beijing\"}"
    }
}
```

这个 ID 必须原样带回 `role: "tool"` 消息中。LLM 用它将工具结果与调用请求关联。

### 3.2 在工具内部读取 Tool Call ID

```go
func myTool(ctx context.Context, args MyArgs) (any, error) {
    // 从 context 中获取
    toolCallID, ok := tool.ToolCallIDFromContext(ctx)

    // 使用场景 1：日志关联
    log.Printf("[TOOL:%s] executing with args: %+v", toolCallID, args)

    // 使用场景 2：状态隔离（并发工具调用时）
    stateKey := fmt.Sprintf("tool_state_%s", toolCallID)
    store.Set(stateKey, intermediateResult)

    // 使用场景 3：指标
    metrics.IncCounter("tool_calls", 1, "tool_name", "my_tool",
        "tool_call_id", toolCallID)
}
```

### 3.3 工具内启动子 Agent 的 ID 传递

```go
const runtimeStateParentToolCallID = "display.parent_tool_call_id"

func delegateToChild(ctx context.Context, args DelegateArgs) (string, error) {
    // 1. 获取当前 tool_call_id
    toolCallID, _ := tool.ToolCallIDFromContext(ctx)

    // 2. 获取父 Invocation
    parentInv, _ := agent.InvocationFromContext(ctx)

    // 3. 创建子 Invocation — 传递 tool_call_id
    childRunOpts := parentInv.RunOptions
    childRunOpts.RuntimeState = map[string]any{
        runtimeStateParentToolCallID: toolCallID,
    }

    childInv := parentInv.Clone(
        agent.WithInvocationAgent(childAgent),
        agent.WithInvocationMessage(model.NewUserMessage(args.Message)),
        agent.WithInvocationRunOptions(childRunOpts),
    )

    // 4. 执行子 Agent
    childCtx := agent.NewInvocationContext(ctx, childInv)
    eventCh, _ := agent.RunWithPlugins(childCtx, childInv, childAgent)

    // 事件自动携带：
    // - ev.InvocationID       → childInv.InvocationID
    // - ev.ParentInvocationID → parentInv.InvocationID
    // UI 层可构建完整调用树
    var final string
    for ev := range eventCh {
        if c := ev.Response.Choices[0].Message.Content; c != "" {
            final = c
        }
    }
    return final, nil
}
```

**调用树构建规则**：
- `InvocationID` + `ParentInvocationID` → Agent 执行树
- `tool_call_id` → 子 Agent 归属到父 Agent 的哪个 tool call 卡片
- 前端可渲染嵌套 UI：Coordinator → Tool Call "delegate_to_child" → Child Agent 输出

### 3.4 Tool Call ID 的注入时机

框架在 BeforeTool 回调之前将 `tool_call_id` 注入 `context.Context`。如果 BeforeTool 回调替换了 context（创建新的裸 context），下游工具代码将丢失该 ID。

---

## 4. JSON 参数修复

```go
events, _ := r.Run(ctx, userID, sessionID, msg,
    agent.WithToolCallArgumentsJSONRepairEnabled(true),
)
```

**修复能力**：
- 未引号的 object key：`{name: "test"}` → `{"name": "test"}`
- 尾随逗号：`{"a": 1,}` → `{"a": 1}`
- 单引号：`{'name': 'test'}` → `{"name": "test"}`
- 缺失闭合引号（best-effort）

**执行时机**：在 PermissionPolicy 检查**之前**——策略检查的是修复后的合法 JSON。

---

## 5. 内置工具速查

### DuckDuckGo

```go
searchTool := duckduckgo.NewTool(
    duckduckgo.WithBaseURL("https://api.duckduckgo.com"),
    duckduckgo.WithHTTPClient(&http.Client{Timeout: 15 * time.Second}),
)
```

### Todo

```go
todoTool := todo.New()

// 软约束（默认）
agent := llmagent.New("todo-agent",
    llmagent.WithTools([]tool.Tool{todoTool}),
    llmagent.WithInstruction(todo.DefaultToolPrompt),
)

// 硬约束（todo 未完不能结束）
agent := llmagent.New("strict-todo-agent",
    llmagent.WithExtensions([]agent.Extension{todoenforcer.New()}),
)
```

### Claude Code ToolSet

```go
toolSet, _ := claudecode.NewToolSet(
    claudecode.WithBaseDir("/workspace"),
    claudecode.WithReadOnly(false),    // 允许 Write/Edit
    claudecode.WithMaxFileSize(10<<20), // 10MB 文件限制
)
```

**Claude Code ToolSet 工具列表**：
- Read：读文件
- Write：写文件（ReadOnly=false）
- Edit：精确替换（ReadOnly=false）
- Bash：执行 shell 命令
- Glob：按模式查找文件
- Grep：搜索文件内容
- WebFetch：获取 URL 内容
- WebSearch：开放网络搜索
- TaskStop / TaskOutput：后台任务管理
- NotebookEdit：编辑 .ipynb 文件（ReadOnly=false）

---

## 6. MCP Broker — 按需发现

```go
broker := mcp.NewBroker(
    mcp.WithBrokerServers([]string{
        "https://mcp-server-1.example.com",
        "https://mcp-server-2.example.com",
    }),
    mcp.WithBrokerAuthHook(func(ctx context.Context, url string) map[string]string {
        return map[string]string{"Authorization": "Bearer " + getUserToken(ctx)}
    }),
)
```

Broker 提供 4 个 LLM 可见工具：`mcp_list_servers` → `mcp_describe_server` → `mcp_connect_server` → `mcp_disconnect_server`。实现渐进式发现——LLM 先看有哪些服务器，再查看特定服务器的工具，最后按需连接。
