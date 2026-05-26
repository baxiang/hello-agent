# 长期记忆服务

长期记忆服务（Memory Service）使 Agent 能够跨会话保留和检索信息。与 Session 的短期状态不同，Memory 专注于语义搜索和知识积累，允许 Agent 在回答用户问题时参考过去的对话内容。

## 1. Memory Service 接口

定义于 `source/memory/service.go:31-39`：

```go
type Service interface {
    AddSessionToMemory(ctx context.Context, s session.Session) error
    SearchMemory(ctx context.Context, req *SearchRequest) (*SearchResponse, error)
}
```

- **`AddSessionToMemory()`**：将一个会话添加到记忆服务。同一会话可以在其生命周期内多次添加（增量更新）
- **`SearchMemory()`**：根据查询搜索相关记忆条目，无匹配时返回空切片

### SearchRequest

```go
type SearchRequest struct {
    Query   string
    UserID  string
    AppName string
}
```

搜索以 `UserID` + `AppName` 为作用域，确保记忆在用户和应用维度隔离。

### SearchResponse 与 Entry

```go
type SearchResponse struct {
    Memories []Entry
}

type Entry struct {
    ID             string
    Content        *genai.Content
    Author         string
    Timestamp      time.Time
    CustomMetadata map[string]any
}
```

| 字段 | 说明 |
|------|------|
| `ID` | 记忆条目的唯一标识 |
| `Content` | 记忆的主要内容（包含文本 Part 列表） |
| `Author` | 记忆作者 |
| `Timestamp` | 原始内容产生的时间，推荐 ISO 8601 格式 |
| `CustomMetadata` | 可选的自定义元数据 |

## 2. InMemory 实现

定义于 `source/memory/inmemory.go`：

```go
func InMemoryService() Service
```

线程安全的内存实现，使用 `sync.RWMutex` 保护内部存储。数据结构为 `map[key]map[sessionID][]value`，按 `appName+userID` 和 `sessionID` 两级索引。

### AddSessionToMemory 实现

遍历会话中的所有事件，提取包含文本内容的事件：
- 对每个文本 Part，使用 `extractWords()` 分词并转为小写，构建词集合
- 跳过不含文本内容的事件
- 将事件内容、作者、时间戳等存入 `value` 结构体

### SearchMemory 实现

- 对查询文本同样执行 `extractWords()` 分词
- 在指定用户+应用的索引下遍历所有事件
- 使用 `checkMapsIntersect()` 检查查询词集合与事件词集合是否有交集
- 有交集的事件作为搜索结果返回

> 注意：InMemory 实现使用简单的关键词交集匹配，不支持语义搜索。生产环境应使用 VertexAI 实现。

## 3. VertexAI 实现

定义于 `source/memory/vertexai/vertexai.go`，基于 Vertex AI MemoryBank 的实现：

```go
type ServiceConfig struct {
    vertexaiutil.AgentEngineData
    StateKeySessionLastUpdateTime string
    WaitForCompletion             bool
}

func NewService(ctx context.Context, config *ServiceConfig) (memory.Service, error)
```

关键配置：
- **`AgentEngineData`**：指定 Vertex AI Agent Engine 实例
- **`StateKeySessionLastUpdateTime`**：控制增量记忆生成。若为空，添加整个会话；若指定，则从 Session State 中读取该键对应的 `time.Time` 值，仅添加更新时间在此之后的事件
- **`WaitForCompletion`**：是否等待记忆生成完成

## 4. Memory 在 Agent 中的使用

### agent.Memory 接口

定义于 `source/agent/agent.go:120-123`：

```go
type Memory interface {
    AddSessionToMemory(context.Context, session.Session) error
    SearchMemory(ctx context.Context, query string) (*memory.SearchResponse, error)
}
```

这是 Agent 层面的记忆接口，简化了 `memory.Service` 的调用——`SearchMemory` 只需传入查询字符串，自动使用当前会话的 `UserID` 和 `AppName`。

Runner 在创建 `InvocationContext` 时，若配置了 `MemoryService`，会自动将其包装为 `agent.Memory` 实现注入到上下文中。工具和回调函数通过 `tool.Context` 或 `agent.CallbackContext` 即可访问记忆功能。

### 在 Instruction 中引用记忆

Agent 的 `Instruction` 模板可以使用 `{key_name}` 占位符引用会话状态。虽然记忆内容不会直接作为模板变量注入，但通过 `preloadmemorytool` 或 `loadmemorytool`，记忆内容可以在运行时被加载并注入到系统指令或工具结果中。

## 5. loadmemorytool 与 preloadmemorytool

### loadmemorytool

定义于 `source/tool/loadmemorytool/tool.go`，名为 `load_memory` 的工具，由模型**主动调用**：

- 接受 `query` 参数，调用 `toolCtx.SearchMemory()` 搜索记忆
- 返回匹配的记忆条目列表
- `ProcessRequest()` 追加以下指令到系统提示：
  > "You have memory. You can use it to answer questions. If any questions need you to look up the memory, you should call load_memory function with a query."

适用场景：模型根据需要按需查询记忆，适用于记忆量较大、不需要每次都加载的场景。

### preloadmemorytool

定义于 `source/tool/preloadmemorytool/tool.go`，名为 `preload_memory` 的工具，**自动执行**：

- `ProcessRequest()` 在每个 LLM 请求前自动触发
- 提取用户当前查询文本，调用 `SearchMemory()` 搜索相关记忆
- 将匹配的记忆格式化为时间戳+作者+内容的文本，注入 `<PAST_CONVERSATIONS>` 标签中

适用场景：需要自动将相关上下文提供给模型，无需模型显式请求记忆的场景。

### 对比

| 特性 | loadmemorytool | preloadmemorytool |
|------|----------------|-------------------|
| 触发方式 | 模型主动调用 | 每个 LLM 请求前自动执行 |
| 控制粒度 | 模型决定何时查询 | 始终注入相关记忆 |
| Token 开销 | 按需，较节省 | 每次请求都消耗 |
| 适用场景 | 记忆量大、按需查询 | 需要持续上下文感知 |
