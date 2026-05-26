# 会话与状态管理

会话（Session）是 ADK-Go 中管理用户与 Agent 交互状态的核心机制。它记录对话事件、维护状态变量，并通过作用域前缀区分不同层级的状态共享范围。Session Service 则负责会话的持久化和检索。

## 1. Session 接口

定义于 `source/session/session.go:32-46`：

```go
type Session interface {
    ID() string
    AppName() string
    UserID() string
    State() State
    Events() Events
    LastUpdateTime() time.Time
}
```

| 方法 | 说明 |
|------|------|
| `ID()` | 会话唯一标识 |
| `AppName()` | 所属应用名称 |
| `UserID()` | 所属用户标识 |
| `State()` | 返回会话状态（键值存储） |
| `Events()` | 返回会话事件列表 |
| `LastUpdateTime()` | 最后更新时间 |

### State 接口

定义于 `source/session/session.go:51-62`：

```go
type State interface {
    Get(string) (any, error)
    Set(string, any) error
    All() iter.Seq2[string, any]
}
```

- **`Get()`**：获取指定键的值，键不存在时返回 `ErrStateKeyNotExist`
- **`Set()`**：设置键值对，覆盖已有值
- **`All()`**：返回迭代器遍历所有键值对，迭代顺序不保证

另有 `ReadonlyState` 接口仅包含 `Get()` 和 `All()`，用于只读场景。

### 状态作用域前缀

定义于 `source/session/session.go:163-176`：

| 前缀 | 常量 | 作用域 |
|------|------|--------|
| `app:` | `KeyPrefixApp` | 应用级状态，同一应用下所有用户和会话共享 |
| `user:` | `KeyPrefixUser` | 用户级状态，同一用户（同一应用）的所有会话共享 |
| `temp:` | `KeyPrefixTemp` | 临时状态，仅当前调用（从接收用户输入到生成最终输出）有效，调用完成后丢弃 |

不带前缀的键默认为会话级状态。State Service 在持久化时会根据前缀将状态分发到对应的存储层（app state、user state、session state），并在读取时合并。

### Events 接口

定义于 `source/session/session.go:79-87`：

```go
type Events interface {
    All() iter.Seq[*Event]
    Len() int
    At(i int) *Event
}
```

提供迭代器遍历、长度查询和索引访问三种方式操作事件序列。

## 2. Event 结构体

定义于 `source/session/session.go:92-118`，表示对话中的一次交互：

```go
type Event struct {
    model.LLMResponse

    ID          string
    Timestamp   time.Time
    InvocationID string
    Branch      string
    Author      string
    Actions     EventActions
    LongRunningToolIDs []string
}
```

| 字段 | 说明 |
|------|------|
| `LLMResponse` | 嵌入的 LLM 响应（包含 Content、CitationMetadata 等） |
| `ID` | 事件唯一标识，由存储层设置 |
| `Timestamp` | 事件时间戳，由存储层设置 |
| `InvocationID` | 调用标识，由 agent.Context 设置 |
| `Branch` | 事件分支（格式如 `agent_1.agent_2`），用于子 Agent 对话隔离 |
| `Author` | 事件作者名称 |
| `Actions` | 事件附带的行为 |
| `LongRunningToolIDs` | 长运行函数调用的 ID 集合 |

### IsFinalResponse()

```go
func (e *Event) IsFinalResponse() bool {
    if e.Actions.SkipSummarization || len(e.LongRunningToolIDs) > 0 {
        return true
    }
    return !hasFunctionCalls(&e.LLMResponse) &&
        !hasFunctionResponses(&e.LLMResponse) &&
        !e.LLMResponse.Partial &&
        !hasTrailingCodeExecutionResult(&e.LLMResponse)
}
```

判定为最终响应的条件：
- `SkipSummarization` 为 `true`，或存在长运行工具调用
- 或者：不包含函数调用、不包含函数响应、不是部分响应、不包含尾随代码执行结果

在多 Agent 调用中，每个参与的 Agent 都可能产生 `IsFinalResponse() == true` 的事件。

### NewEvent() 构造函数

```go
func NewEvent(invocationID string) *Event {
    return &Event{
        ID:           uuid.NewString(),
        InvocationID: invocationID,
        Timestamp:    time.Now(),
        Actions:      EventActions{StateDelta: make(map[string]any), ArtifactDelta: make(map[string]int64)},
    }
}
```

自动生成 UUID、设置当前时间戳，并初始化 `StateDelta` 和 `ArtifactDelta` 映射。

### EventActions

定义于 `source/session/session.go:143-160`：

```go
type EventActions struct {
    StateDelta                 map[string]any
    ArtifactDelta              map[string]int64
    RequestedToolConfirmations map[string]toolconfirmation.ToolConfirmation
    SkipSummarization          bool
    TransferToAgent            string
    Escalate                   bool
}
```

| 字段 | 说明 |
|------|------|
| `StateDelta` | 状态变更映射，键可带作用域前缀 |
| `ArtifactDelta` | 制品更新映射，键为文件名，值为版本号 |
| `RequestedToolConfirmations` | 需要用户确认的工具调用 |
| `SkipSummarization` | 为 `true` 时跳过对函数响应的模型摘要 |
| `TransferToAgent` | 非空时，将控制权转移到指定 Agent |
| `Escalate` | 为 `true` 时，向上级 Agent 升级 |

## 3. Session Service

定义于 `source/session/service.go:25-32`：

```go
type Service interface {
    Create(context.Context, *CreateRequest) (*CreateResponse, error)
    Get(context.Context, *GetRequest) (*GetResponse, error)
    List(context.Context, *ListRequest) (*ListResponse, error)
    Delete(context.Context, *DeleteRequest) error
    AppendEvent(context.Context, Session, *Event) error
}
```

`AppendEvent()` 在追加事件后会自动移除临时状态键（`temp:` 前缀）。

### InMemoryService

```go
func InMemoryService() Service
```

内存实现，维护 `appState` 和 `userState` 两个映射用于跨会话状态共享。适用于开发和测试。

### 请求/响应类型

**CreateRequest**：
```go
type CreateRequest struct {
    AppName   string
    UserID    string
    SessionID string         // 可选，为空时自动生成
    State     map[string]any // 初始状态
}
```

**GetRequest**（支持事件过滤）：
```go
type GetRequest struct {
    AppName         string
    UserID          string
    SessionID       string
    NumRecentEvents int        // 返回最近 N 个事件，0 表示不过滤
    After           time.Time  // 返回此时间之后的事件，零值表示不过滤
}
```

**ListRequest** 和 **DeleteRequest** 按 `AppName` + `UserID`（+ `SessionID`）进行操作。

## 4. Database Session

定义于 `source/session/database/`，基于 GORM 的关系数据库实现（支持 PostgreSQL、Spanner、SQLite 等）。

```go
func NewSessionService(dialector gorm.Dialector, opts ...gorm.Option) (session.Service, error)
```

关键特性：
- 使用 GORM 事务保证原子性
- `AutoMigrate()` 自动创建/更新数据库表结构
- `AppendEvent()` 中检查会话时间戳防止过期写入（stale session 检测）
- `extractStateDeltas()` 根据前缀将状态变更拆分到 app、user、session 三层
- `mergeStates()` 读取时合并三层状态，恢复带前缀的键名

## 5. VertexAI Session

定义于 `source/session/vertexai/`，基于 Vertex AI Agent Engine 的会话服务实现。适用于 Google Cloud 部署场景，利用 Vertex AI 的托管会话存储能力。使用时需要配置 Agent Engine 实例信息和认证凭据。
