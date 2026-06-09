# Tool 工具系统 — 源码·实战·原理

Tool 系统是 Agent 与外部世界交互的唯一通道。本文从接口设计到 MCP 实战，深入 Function Tool 的 Schema 生成、MCP 连接生命周期。

## 1. 概念概述

### 1.1 接口层次

```go
// tool/tool.go
type Tool interface {
    Declaration() *Declaration
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

**接口层次设计哲学**：
- `Tool` 是抽象基类——只声明"我是做什么的"（元数据）
- `CallableTool` 是同步调用——简单的 API 请求
- `StreamableTool` 是流式调用——LLM 可渐进消费结果（如日志查询）
- `ToolSet` 是批量管理——一组工具共享生命周期（如 MCP 连接）

### 1.2 Declaration 元数据

```go
type Declaration struct {
    Name         string   // 工具名——LLM 用于 Function Calling 的参数
    Description  string   // 工具描述——LLM 据此决定是否调用
    InputSchema  *Schema  // 入参 JSON Schema
    OutputSchema *Schema  // 出参 JSON Schema（可选）
}
```

> **最重要的设计原则**：Name 和 Description 的准确性直接决定工具调用精度。模糊的描述 → LLM 调用错误率显著上升。

---

## 2. 源码走读：Function Tool

### 2.1 Schema 自动生成

```go
// tool/function/function_tool.go（简化）
func NewFunctionTool[I, O any](
    fn func(context.Context, I) (O, error),
    opts ...Option,
) Tool {

    // 使用反射生成 JSON Schema
    schema := generateSchema(reflect.TypeOf((*I)(nil)).Elem())

    return &functionTool{
        declaration: &tool.Declaration{
            Name:        name,
            Description: desc,
            InputSchema: schema,
        },
        fn: func(ctx context.Context, jsonArgs []byte) (any, error) {
            var input I
            json.Unmarshal(jsonArgs, &input) // LLM 的 arguments 是 JSON 字符串
            return fn(ctx, input)
        },
    }
}
```

### 2.2 Schema 生成规则

```go
// 从 Go struct 生成 JSON Schema 的映射规则：
type MyInput struct {
    Name    string  `json:"name" jsonschema:"description=用户名,required"`
    Age     int     `json:"age" jsonschema:"description=年龄,minimum=0,maximum=150"`
    Tags    []string `json:"tags" jsonschema:"description=标签列表"`
    Enabled bool    `json:"enabled" jsonschema:"description=是否启用"`
}

// 生成等价于：
// {
//   "type": "object",
//   "properties": {
//     "name":    {"type": "string",  "description": "用户名"},
//     "age":     {"type": "integer", "description": "年龄", "minimum": 0, "maximum": 150},
//     "tags":    {"type": "array",   "description": "标签列表", "items": {"type": "string"}},
//     "enabled": {"type": "boolean", "description": "是否启用"}
//   },
//   "required": ["name"]
// }
```

**jsonschema tag 支持的验证关键字**：
`description`、`required`、`enum`、`minimum`、`maximum`、`minLength`、`maxLength`、`pattern`、`format`、`default`

> 注意：jsonschema tag 以逗号 `,` 分隔，**description 值不能包含逗号**。

### 2.3 Call 方法

```go
func (t *functionTool) Call(ctx context.Context, jsonArgs []byte) (any, error) {
    // 1. JSON 反序列化（自动处理 Go 零值语义）
    var input I
    if err := json.Unmarshal(jsonArgs, &input); err != nil {
        return nil, fmt.Errorf("invalid arguments: %w", err)
    }

    // 2. 注入 tool_call_id 到 context
    ctx = context.WithValue(ctx, toolCallIDKey, /*从 parent ctx 获取*/)

    // 3. 调用业务函数
    return t.fn(ctx, input)
}
```

---

## 3. 源码走读：MCP ToolSet

### 3.1 连接生命周期

```
[创建] → [连接] → [Initialize] → [ListTools] → [Tools() 读取缓存]
                                                      ↓
                                              [Close] → [断开连接]
```

```go
// tool/mcp/mcp_toolset.go（简化）
type MCPToolSet struct {
    config    ConnectionConfig
    client    *mcp.Client
    sessionID string
    tools     []tool.Tool // 缓存
    mu        sync.RWMutex
    connected bool
}

func (ts *MCPToolSet) Tools(ctx context.Context) []tool.Tool {
    ts.mu.RLock()
    if ts.connected {
        defer ts.mu.RUnlock()
        return ts.tools
    }
    ts.mu.RUnlock()

    // 懒连接——首次调用 Tools() 时建立
    ts.mu.Lock()
    defer ts.mu.Unlock()

    client, err := ts.connect(ctx)
    ts.client = client
    ts.connected = true

    // 列出 MCP 服务端工具
    mcpTools, _ := client.ListTools(ctx, &mcp.ListToolsRequest{})
    ts.tools = convertMCPTools(mcpTools)
    return ts.tools
}
```

**懒连接的优势**：ToolSet 创建时不建立连接，避免未使用的 MCP 服务白白占用资源。首次 `Tools()` 调用时才连接。

### 3.2 三种传输实现的差异

| | STDIO | SSE | Streamable HTTP |
|----|----|----|----|
| **底层** | `os/exec` 子进程 | `net/http` + EventSource | `net/http` |
| **连接** | stdin/stdout 管道 | 长连接 SSE | HTTP POST + 流式响应 |
| **适用** | 本地工具 | 远程工具服务 | 远程 + 复杂认证 |
| **重连** | 重启子进程 | 重建 SSE 连接 | 重建 HTTP 连接 |
| **认证** | 无（进程内部） | HTTP Header | HTTP Header / Token |
| **并发** | 串行（管道特性） | 并发 | 并发 |

**STDIO 的串行限制**：子进程的 stdin/stdout 是单工通道，多个并发工具调用需要加锁排队。SSE 和 Streamable HTTP 无此限制。

### 3.3 MCP 反馈到 LLM 的参数格式

MCP 工具的参数被转换为 OpenAI Function Calling 格式：

```json
// MCP Tool 定义：
// name: "get_weather"
// inputSchema: {"type": "object", "properties": {"city": {"type": "string"}}}

// 转换为 OpenAI Tool 声明：
{
    "type": "function",
    "function": {
        "name": "get_weather",
        "description": "...",
        "parameters": {
            "type": "object",
            "properties": {
                "city": {"type": "string", "description": "..."}
            },
            "required": ["city"]
        }
    }
}
```

---

## 4. 实战

### 4.1 Function Tool — 完整示例

```go
type WeatherArgs struct {
    City string `json:"city" jsonschema:"description=城市名称,required"`
    Unit string `json:"unit" jsonschema:"description=温度单位,enum=celsius,enum=fahrenheit"`
}

type WeatherResult struct {
    Temperature float64 `json:"temperature"`
    Condition   string  `json:"condition"`
    Humidity    float64 `json:"humidity"`
}

func getWeather(ctx context.Context, args WeatherArgs) (WeatherResult, error) {
    // 真实调用天气 API
    resp, err := http.Get(fmt.Sprintf("https://api.weather.com?city=%s&unit=%s",
        url.QueryEscape(args.City), args.Unit))
    // ...
    return WeatherResult{Temperature: 22.5, Condition: "晴", Humidity: 0.65}, nil
}

weatherTool := function.NewFunctionTool(
    getWeather,
    function.WithName("get_weather"),
    function.WithDescription("获取指定城市的实时天气信息"),
)
```

### 4.2 MCP + STDIO 完整配置

```go
ts := mcp.NewMCPToolSet(
    mcp.ConnectionConfig{
        Transport: "stdio",
        Command:   "python",
        Args:      []string{"-m", "my_mcp_server"},
        Env:       []string{"API_KEY=" + os.Getenv("MY_API_KEY")},
        Timeout:   30 * time.Second,
    },
    mcp.WithToolFilterFunc(func(name string) bool {
        return !strings.HasPrefix(name, "_") // 过滤内部工具
    }),
)
defer ts.Close()

agent := llmagent.New("assistant",
    llmagent.WithModel(model),
    llmagent.WithToolSets([]tool.ToolSet{ts}),
)
```

### 4.3 MCP + Streamable HTTP with Auth

```go
ts := mcp.NewMCPToolSet(
    mcp.ConnectionConfig{
        Transport:   "streamable_http",
        ServerURL:   "https://mcp.example.com",
        HTTPHeaders: map[string]string{
            "Authorization": "Bearer " + getToken(),
        },
        Timeout: 10 * time.Second,
    },
)
```

### 4.4 Streamable Tool

```go
func streamLogs(ctx context.Context, input LogQuery) *tool.StreamReader {
    stream := tool.NewStream(100)
    go func() {
        defer stream.Writer.Close()
        // 模拟逐行推送日志
        for _, line := range queryLogs(input.Query) {
            chunk := tool.StreamChunk{
                Content:  LogEntry{Line: line, Timestamp: time.Now()},
                Metadata: tool.Metadata{CreatedAt: time.Now()},
            }
            if closed := stream.Writer.Send(chunk, nil); closed { break }
            time.Sleep(50 * time.Millisecond)
        }
    }()
    return stream.Reader
}

logTool := function.NewStreamableFunctionTool[LogQuery, LogEntry](
    streamLogs,
    function.WithName("query_logs"),
    function.WithDescription("流式查询系统日志"),
)
```

---

## 5. 设计原理

### 5.1 为什么 Tool 的 arguments 是 JSON 字符串而非结构化对象？

LLM 的 Function Calling 返回的 `function.arguments` 就是 JSON 字符串。将接口参数设计为 `jsonArgs []byte` 而非已解析的结构体，原因：

1. **零解析开销传递**：如果 Agent 仅是 MCP 代理（调用外部 API，不关心参数内容），可以原样转发
2. **延迟解析**：权限检查可以在原始 JSON 上执行（如检查参数大小），无需先解析
3. **容错**：LLM 可能生成非严格 JSON，框架层可以先修复再传递

### 5.2 ToolSet vs Tool 的边界

- **Tool** = 一个原子能力（如"计算器"）
- **ToolSet** = 一组相关能力的容器（如"某个 MCP 服务器提供的所有工具"）

ToolSet 的核心价值在于**生命周期管理**：
- `Close()` 清理连接——MCP client 断开、进程 kill
- `Tools()` 缓存——避免每次 LLM 调用都重新获取工具列表
- ToolSet 的 Name 用于冲突检测和多 ToolSet 合并时的去重

### 5.3 并发工具执行

同一轮对话中 LLM 可能返回多个 `tool_calls`。框架默认并行执行它们——只有当工具实现了并发安全标记时才真正并行：

```go
// 框架内部检查
if tool.Metadata().ConcurrencySafe {
    // 并行执行
} else {
    // 串行执行（默认安全）
}
```
