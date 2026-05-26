# Runner 执行模型

Runner 是 ADK-Go 的运行时引擎，负责将用户消息路由到正确的 Agent、管理会话生命周期、协调事件持久化，以及集成插件系统。它是连接 Agent 定义与实际执行的桥梁。

## 1. Runner 结构

定义于 `source/runner/runner.go:116-126`：

```go
type Runner struct {
    appName         string
    rootAgent       agent.Agent
    sessionService  session.Service
    artifactService artifact.Service
    memoryService   memory.Service

    parents           parentmap.Map
    pluginManager     *plugininternal.PluginManager
    autoCreateSession bool
}
```

| 字段 | 说明 |
|------|------|
| `appName` | 应用名称，用于 Session 隔离 |
| `rootAgent` | Agent 树的根节点，执行的起点 |
| `sessionService` | 会话持久化服务，必需 |
| `artifactService` | Artifact 存储服务，可选 |
| `memoryService` | 跨会话记忆服务，可选 |
| `parents` | Agent 父子关系映射，用于跨树转移判断 |
| `pluginManager` | 插件管理器，协调整个插件生命周期 |
| `autoCreateSession` | Session 不存在时自动创建 |

## 2. Runner.Config

```go
type Config struct {
    AppName          string
    Agent            agent.Agent       // 必需
    SessionService   session.Service   // 必需
    ArtifactService  artifact.Service  // 可选
    MemoryService    memory.Service    // 可选
    PluginConfig     PluginConfig      // 可选
    AutoCreateSession bool             // 可选
}
```

`Agent` 和 `SessionService` 是必需字段，缺失时 `New()` 返回错误。创建 Runner 时，`parentmap.New()` 会遍历整个 Agent 树构建父子映射。

## 3. Runner.Run() 执行流程

`Run()` 方法签名：

```go
func (r *Runner) Run(ctx context.Context, userID, sessionID string,
    msg *genai.Content, cfg agent.RunConfig, opts ...RunOption) iter.Seq2[*session.Event, error]
```

完整执行流程如下：

### 步骤 1：获取/创建 Session

通过 `sessionService.Get()` 查找现有会话。若不存在且 `autoCreateSession` 为 true，则自动创建。否则返回错误。

### 步骤 2：findAgentToRun 路由

基于会话历史和当前消息，找到应处理本次请求的 Agent（详见第 5 节）。

### 步骤 3：注入 Context

将 `parentmap`、`RunConfig`、`PluginManager` 通过 `context.Value` 注入到 Go context 中，供 Agent 执行时访问：

```go
ctx = parentmap.ToContext(ctx, r.parents)
ctx = runconfig.ToContext(ctx, &runconfig.RunConfig{...})
ctx = plugininternal.ToContext(ctx, r.pluginManager)
```

### 步骤 4：构建 Artifacts 和 Memory 适配器

若配置了 `artifactService` 或 `memoryService`，构建对应的适配器实例，绑定当前会话信息。

### 步骤 5：appendMessageToSession 保存用户消息

将用户消息作为事件追加到 Session。此步骤包括：

- **PluginManager.RunOnUserMessageCallback**：插件可修改用户消息
- **SaveInputBlobsAsArtifacts**：若 `RunConfig.SaveInputBlobsAsArtifacts` 为 true，将消息中的二进制数据保存为 Artifact，并用文本占位符替换
- **stateDelta**：通过 `WithStateDelta` 选项注入的状态增量写入事件的 `Actions.StateDelta`

### 步骤 6：PluginManager.RunBeforeRunCallback

插件系统的前置回调。若返回非 nil 结果，Runner 立即产出提前退出事件并终止本次调用。此机制允许插件实现全局拦截、限流等逻辑。

### 步骤 7：执行 Agent.Run()

遍历 Agent 的迭代器，逐事件处理：

```go
for event, err := range agentToRun.Run(ctx) {
    // 处理每个事件...
}
```

### 步骤 8：PluginManager.RunOnEventCallback

对每个事件调用插件的事件回调，插件可修改或替换事件内容。

### 步骤 9：AppendEvent 持久化

仅 `Partial == false` 的事件才会持久化到 Session。Partial 事件（流式中间片段）仅转发给下游，不写入会话历史。

### 步骤 10：PluginManager.RunAfterRunCallback

通过 `defer` 确保在 Runner 退出时执行，用于全局清理、日志收尾、指标上报。此回调不产出事件。

## 4. Runner.RunLive()

`RunLive()` 是 Runner 的双向流式模式，适用于实时对话场景：

```go
func (r *Runner) RunLive(ctx context.Context, userID, sessionID string,
    cfg agent.LiveRunConfig, opts ...RunOption) (agent.LiveSession, iter.Seq2[*session.Event, error], error)
```

### LiveSession 接口

```go
type LiveSession interface {
    Send(req LiveRequest) error
    Close() error
}
```

- **`Send()`**：发送实时输入（文本、音频、函数响应等）。发送的文本内容会自动持久化到 Session 历史
- **`Close()`**：关闭会话

### 事件缓冲逻辑

Live 模式下有特殊的事件排序逻辑，确保转录（transcription）事件优先输出：

1. 若当前事件包含 `InputTranscription` 或 `OutputTranscription`，标记 `isTranscribing = true`
2. 若正在转录中收到工具调用/响应事件，将其缓冲到 `bufferedEvents`
3. 当非 partial 的转录事件到达时，先输出转录事件，再输出所有缓冲的工具事件
4. 不含 `InlineData` 的非 partial 事件持久化到 Session

`runnerLiveSession` 包装了 Agent 返回的原始 LiveSession，在 `Send()` 中自动将用户文本内容保存到 Session。

## 5. findAgentToRun 路由逻辑

定义于 `source/runner/runner.go:592-623`，决定由哪个 Agent 处理当前请求。

### 路由策略

1. **处理用户函数调用响应**：若用户消息包含 `FunctionResponse`，通过 `handleUserFunctionCallResponse` 从会话历史中倒序查找匹配的 `FunctionCall` 事件，将控制权返回给发起调用的 Agent

2. **从会话历史查找最近 Agent**：倒序遍历会话事件，跳过 `Author == "user"` 的事件，找到最近的非用户事件的 Author 对应的 Agent

3. **检查可转移性**：调用 `isTransferableAcrossAgentTree()` 验证该 Agent 及其所有祖先是否允许向父级转移（`DisallowTransferToParent` 检查）

4. **回退到根 Agent**：若以上均未找到合适的 Agent，则回退到 `rootAgent`

### isTransferableAcrossAgentTree

沿 Agent 的父链逐层检查：若任一祖先 Agent 设置了 `DisallowTransferToParent`，则返回 false，该 Agent 不可被选为执行目标（回退到根 Agent）。

### handleUserFunctionCallResponse

当用户消息包含函数响应时，需要在历史事件中找到对应的函数调用事件。函数调用事件携带了发起调用的 Agent 名称，由此确定目标 Agent。此逻辑假设所有函数响应对应同一 Agent 的调用。

## 6. Agent 树与父映射

`parentmap.Map` 是 `map[string]agent.Agent` 类型的别名，维护每个 Agent 名称到其父 Agent 的映射。创建 Runner 时由 `parentmap.New(rootAgent)` 递归遍历子树构建。

此映射的核心作用：
- **跨树转移判断**：`isTransferableAcrossAgentTree` 沿父链向上检查
- **Agent 查找**：在 `findAgentToRun` 中定位 Agent 在树中的位置

通过 `parentmap.ToContext(ctx, parents)` 注入到 context 中，Agent 执行时可通过 context 访问父映射。

## 7. RunConfig

```go
type RunConfig struct {
    StreamingMode             StreamingMode
    SaveInputBlobsAsArtifacts bool
}
```

| 字段 | 说明 |
|------|------|
| `StreamingMode` | 流式模式：`StreamingModeNone`（无流式）或 `StreamingModeSSE`（服务端推送事件流式） |
| `SaveInputBlobsAsArtifacts` | 若为 true，用户输入中的二进制数据（图片、文件等）自动保存为 Artifact |

## 8. RunOption

```go
type RunOption func(*runOptions)
```

目前支持的选项：

- **`WithStateDelta(delta map[string]any)`**：向本次调用的用户消息事件注入状态增量，状态值会写入 `event.Actions.StateDelta`，在事件持久化时合并到 Session State。适用于从外部注入初始状态。

```go
for event, err := range runner.Run(ctx, userID, sessionID, msg, cfg,
    runner.WithStateDelta(map[string]any{"init_key": "init_value"}),
) {
    // 处理事件
}
```
