# 插件系统

Plugin 是 ADK-Go 的横切关注点机制，允许在不修改 Agent 核心逻辑的前提下注入日志、重试、参数修改等行为。通过回调钩子，Plugin 可以介入 Agent 执行的各个阶段，实现观察、拦截和修改。

## 1. Plugin 结构

Plugin 的定义位于 `source/plugin/plugin.go`。核心数据结构是 `Config` 和 `Plugin`。

### Config

`Config` 定义了 Plugin 的全部配置，包含名称和一系列可选的回调函数：

```go
type Config struct {
    Name string

    OnUserMessageCallback OnUserMessageCallback
    OnEventCallback       OnEventCallback

    BeforeRunCallback BeforeRunCallback
    AfterRunCallback  AfterRunCallback

    BeforeAgentCallback agent.BeforeAgentCallback
    AfterAgentCallback  agent.AfterAgentCallback

    BeforeModelCallback  llmagent.BeforeModelCallback
    AfterModelCallback   llmagent.AfterModelCallback
    OnModelErrorCallback llmagent.OnModelErrorCallback

    BeforeToolCallback  llmagent.BeforeToolCallback
    AfterToolCallback   llmagent.AfterToolCallback
    OnToolErrorCallback llmagent.OnToolErrorCallback

    CloseFunc func() error
}
```

各字段说明：

- **Name**：Plugin 的唯一标识名，用于日志和调试。
- **OnUserMessageCallback**：用户消息到达时的回调，可检查或修改用户输入。
- **OnEventCallback**：Agent 产出事件时的回调，可在流式传输中修改事件。
- **BeforeRunCallback / AfterRunCallback**：Agent 整次执行（Run）前后触发。
- **BeforeAgentCallback / AfterAgentCallback**：单个 Agent 执行前后触发（适用于多 Agent 编排场景）。
- **BeforeModelCallback / AfterModelCallback**：LLM 调用前后触发。`BeforeModelCallback` 可返回非 nil 的 `LLMResponse` 来跳过 LLM 调用。
- **OnModelErrorCallback**：LLM 调用出错时的回调，可用于错误处理或返回备用响应。
- **BeforeToolCallback / AfterToolCallback**：工具执行前后触发。`BeforeToolCallback` 可修改工具参数。
- **OnToolErrorCallback**：工具执行出错时的回调，可用于重试或返回替代结果。
- **CloseFunc**：Plugin 关闭时的清理函数。若未设置，默认为空操作。

### Plugin 结构体与访问方法

通过 `plugin.New(cfg)` 创建 Plugin 实例。返回的 `Plugin` 结构体通过访问器方法暴露各回调：

```go
p, err := plugin.New(plugin.Config{
    Name:              "my_plugin",
    BeforeRunCallback: myBeforeRun,
    AfterRunCallback:  myAfterRun,
})
if err != nil {
    log.Fatal(err)
}

// 访问回调
cb := p.BeforeRunCallback()
```

`Plugin` 还提供 `Name()` 和 `Close()` 方法。`Close()` 安全调用内部 `closeFunc`，且保证不会 panic。

### 回调类型定义

```go
type OnUserMessageCallback func(agent.InvocationContext, *genai.Content) (*genai.Content, error)
type BeforeRunCallback     func(agent.InvocationContext) (*genai.Content, error)
type AfterRunCallback      func(agent.InvocationContext)
type OnEventCallback       func(agent.InvocationContext, *session.Event) (*session.Event, error)
```

- **OnUserMessageCallback**：接收调用上下文和用户消息内容，返回修改后的内容或 nil。返回非 nil 内容不会中断流程。
- **BeforeRunCallback**：返回非 nil 的 `*genai.Content` 将**跳过整个执行**，直接将该内容作为响应返回（提前退出）。
- **AfterRunCallback**：无返回值，仅用于善后操作（如日志记录、指标采集）。
- **OnEventCallback**：接收当前事件，返回修改后的事件或 nil。返回非 nil 事件将替换原始事件，实现流中事件的动态修改。

## 2. Plugin 生命周期

一次完整的 Agent 调用中，Plugin 回调的触发顺序如下：

```
用户消息到达
  └─ OnUserMessageCallback
BeforeRunCallback
  ├─ BeforeAgentCallback (当前 Agent)
  │   ├─ BeforeModelCallback
  │   │   └─ LLM 调用
  │   ├─ AfterModelCallback / OnModelErrorCallback
  │   ├─ BeforeToolCallback (每个工具调用)
  │   │   └─ 工具执行
  │   └─ AfterToolCallback / OnToolErrorCallback
  └─ AfterAgentCallback
  └─ OnEventCallback (每个产出的事件)
AfterRunCallback
```

### 提前退出逻辑

`BeforeRunCallback` 是唯一的拦截点：若返回非 nil 的 `*genai.Content`，Runner 将跳过后续所有执行（包括 Agent、Model、Tool 回调），直接将该内容作为最终响应。这在实现缓存、鉴权拒绝等场景下非常有用。

### 事件修改

`OnEventCallback` 在流式传输过程中对每个事件调用。返回非 nil 的事件将替换原始事件，返回 nil 则保留原始事件。这使得 Plugin 可以在运行时动态修改事件内容，例如过滤敏感信息、添加元数据等。

## 3. 内置 Plugin

### LoggingPlugin

位于 `source/plugin/loggingplugin/logging_plugin.go`，提供控制台日志输出，是调试和学习的最佳参考。

```go
p := loggingplugin.MustNew("my_logger")
```

LoggingPlugin 注册了所有回调，在终端以灰色 ANSI 颜色输出关键事件：

- 用户消息内容、Invocation ID、Session ID
- Agent 执行开始/结束
- LLM 请求（模型名、系统指令、可用工具）和响应（内容、Token 用量）
- 工具调用的名称、参数和结果
- 错误信息

### RetryAndReflect

位于 `source/plugin/retryandreflect/plugin.go`，实现 LLM 工具调用的错误重试与反思机制。当工具执行失败时，自动生成反思提示引导 LLM 修正调用。

```go
p := retryandreflect.MustNew(
    retryandreflect.WithMaxRetries(3),
    retryandreflect.WithTrackingScope(retryandreflect.Invocation),
)
```

核心配置选项：

- **WithMaxRetries(n)**：最大重试次数，默认 3。
- **WithErrorIfRetryExceeded(bool)**：超出重试次数时是否返回错误。若为 false（默认），则生成停止使用该工具的指令而非报错。
- **WithTrackingScope(scope)**：失败计数的作用域。`Invocation`（默认）按单次调用计数，`Global` 跨所有调用全局计数。

工作原理：

1. **OnToolErrorCallback**：捕获工具错误，递增失败计数。若未超出最大重试次数，使用 `reflection.md` 模板生成反思响应，引导 LLM 分析错误原因（参数错误、前提条件缺失、替代方案等）并修正调用。若超出重试次数，使用 `exceeded.md` 模板生成停止指令。
2. **AfterToolCallback**：工具成功执行后重置该工具的失败计数（但不重置刚由 OnToolErrorCallback 生成的反思响应）。
3. 跳过 `tool.ErrConfirmationRequired` 和 `tool.ErrConfirmationRejected` 错误，这些属于人机交互确认流程，不应触发重试。

### FunctionCallModifier

位于 `source/plugin/functioncallmodifier/plugin.go`，允许在 LLM 调用前后修改函数调用的参数声明和实际参数。

```go
p := functioncallmodifier.MustNewPlugin(functioncallmodifier.FunctionCallModifierConfig{
    Predicate: func(toolName string) bool {
        return toolName == "my_tool"
    },
    Args: map[string]*genai.Schema{
        "user_id": {Type: "STRING", Description: "当前用户 ID"},
    },
    OverrideDescription: func(orig string) string {
        return orig + " (user_id 会自动注入)"
    },
})
```

工作流程：

1. **BeforeModelCallback**：根据 `Predicate` 筛选目标工具，向其函数声明中注入额外参数（`Args`），并可覆盖描述文字。这使得 LLM 能"看到"这些参数并在调用时提供值。
2. **AfterModelCallback**：从 LLM 返回的函数调用中移除注入的参数，将其值存入 Session State（键格式为 `{functionCallID}/{paramName}`），确保工具执行时不会收到这些外部注入的参数。

典型场景：自动注入当前用户 ID、请求上下文等 LLM 不应感知的参数。

## 4. PluginManager

PluginManager 是 Runner 内部的协调器，管理多个 Plugin 的回调执行顺序。用户不直接与 PluginManager 交互，而是通过 Runner 的配置注册 Plugin。

当多个 Plugin 注册了同一类型的回调时，PluginManager 按注册顺序依次调用。对于返回值的回调（如 `BeforeRunCallback`），只要有一个 Plugin 返回非 nil 内容即触发提前退出。

## 5. PluginConfig in Runner

在 `runner.Config` 中通过 `PluginConfig` 字段配置 Plugin：

```go
r, err := runner.New(runner.Config{
    AppName:  "my_app",
    Agent:    myAgent,
    SessionService: session.InMemoryService(),
    PluginConfig: runner.PluginConfig{
        Plugins: []*plugin.Plugin{
            loggingplugin.MustNew("app_logger"),
            retryandreflect.MustNew(),
        },
        CloseTimeout: 10 * time.Second,
    },
})
```

- **Plugins**：Plugin 实例列表，按顺序注册。
- **CloseTimeout**：Runner 关闭时等待 Plugin `Close()` 的超时时间。

当 Runner 关闭时，会依次调用每个 Plugin 的 `Close()` 方法。若任一 Plugin 在 `CloseTimeout` 内未完成关闭，Runner 将强制退出。因此，Plugin 的 `CloseFunc` 应设计为可快速完成的操作。
