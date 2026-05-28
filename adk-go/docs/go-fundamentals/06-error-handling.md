# 错误处理 — ADK-Go 中的错误传播与恢复

## 1. Go 错误处理基础

Go 使用多返回值模式处理错误，没有 try/catch。基本模式：

```go
result, err := doSomething()
if err != nil {
    return err  // 向上传播
}
```

`error` 是一个内置接口，仅包含 `Error() string` 方法。Go 社区推崇**显式错误检查**——每个可能失败的操作都必须检查返回的 error。

adk-go 在此基础上，结合 `iter.Seq2` 迭代器模式，构建了一套独特的错误传播机制。

## 2. iter.Seq2 中的错误：Event 和 error 分开传递

adk-go 的核心迭代器类型是 `iter.Seq2[*session.Event, error]`。这意味着每次迭代可以产生两种结果：

- `*session.Event`：正常的事件（模型响应、工具调用结果等）
- `error`：运行时错误

这是 adk-go 最关键的架构决策之一。对比两种可能的方案：

```go
// 方案 A（adk-go 选择）：Event 和 error 分离
iter.Seq2[*session.Event, error]

// 方案 B（未采用）：Event 内嵌 error
iter.Seq[*session.Event]  // Event 内包含错误信息
```

方案 A 的优势在于**消费者可以区分事件的两种处理路径**：正常事件需要展示给用户，错误需要记录或重试。如果错误被内嵌到 Event 中，消费者必须解析 Event 来判断是正常响应还是错误。

## 3. adk-go 错误传播模式

### 3.1 Agent.Run() 通过 yield(event, err) 传递错误

`Agent` 接口的 `Run` 方法（agent/agent.go:46）返回 `iter.Seq2[*session.Event, error]`：

```go
type Agent interface {
    Run(InvocationContext) iter.Seq2[*session.Event, error]
    // ...
}
```

在实现中（agent/agent.go:162-215），错误通过 `yield(event, err)` 传递给消费者：

```go
func (a *agent) Run(ctx InvocationContext) iter.Seq2[*session.Event, error] {
    return func(yield func(*session.Event, error) bool) {
        // BeforeAgentCallbacks 错误
        event, err := runBeforeAgentCallbacks(ctx)
        if event != nil || err != nil {
            if !yield(event, err) {
                return
            }
        }

        // 业务逻辑迭代中的错误
        for event, err := range a.run(ctx) {
            if !yield(event, err) {
                return
            }
        }

        // AfterAgentCallbacks 错误
        event, err = runAfterAgentCallbacks(ctx)
        if event != nil || err != nil {
            yield(event, err)
        }
    }
}
```

注意 `yield` 的返回值 `bool`——当消费者不再需要更多值时返回 false，迭代器应立即停止。这是 Go 1.23 迭代器的标准模式。

### 3.2 Flow.Run() 的错误传播

LLM Agent 的核心逻辑在 `internal/llminternal/base_flow.go:101-127`。`Flow.Run()` 在循环中调用 `runOneStep()`，任何错误都会终止整个流程：

```go
func (f *Flow) Run(ctx agent.InvocationContext) iter.Seq2[*session.Event, error] {
    return func(yield func(*session.Event, error) bool) {
        for {
            var lastEvent *session.Event
            for ev, err := range f.runOneStep(ctx) {
                if err != nil {
                    yield(nil, err)  // 错误直接向上传递，终止流程
                    return
                }
                if !yield(ev, nil) {
                    return
                }
                lastEvent = ev
            }
            if lastEvent == nil || lastEvent.IsFinalResponse() {
                return  // 正常结束
            }
        }
    }
}
```

关键点：**一旦 `runOneStep` 产生错误，Run 立即终止**。错误不会与正常事件交替产生——错误是终局性的。

### 3.3 runOneStep 中的多层错误检查

`runOneStep`（base_flow.go:528-654）是错误处理最密集的函数。它在多个检查点传播错误：

```go
func (f *Flow) runOneStep(ctx agent.InvocationContext) iter.Seq2[*session.Event, error] {
    return func(yield func(*session.Event, error) bool) {
        // 1. 模型未配置
        if f.Model == nil {
            yield(nil, fmt.Errorf("agent %q: %w", ctx.Agent().Name(), ErrModelNotConfigured))
            return
        }

        // 2. 预处理错误
        for ev, err := range f.preprocess(ctx, req) {
            if err != nil {
                yield(nil, err)
                return
            }
        }

        // 3. LLM 调用错误
        for resp, err := range f.callLLM(ctx, req, stateDelta, artifactDelta) {
            if err != nil {
                yield(nil, err)
                return
            }
            // 后处理错误
            if err := f.postprocess(ctx, req, resp); err != nil {
                yield(nil, err)
                return
            }
            // ...

            // 4. 函数调用处理错误
            ev, err := f.handleFunctionCalls(ctx, tools, resp.LLMResponse, nil, nil)
            if err != nil {
                yield(nil, err)
                return
            }
        }
    }
}
```

每个阶段都有独立的错误检查，确保错误不会静默丢失。

### 3.4 Runner 消费迭代器时检查 error

在 `runner/runner.go:234-266`，Runner 消费 agent 的迭代器，区分处理错误和正常事件：

```go
for event, err := range agentToRun.Run(ctx) {
    if err != nil {
        if !yield(event, err) {
            return
        }
        continue  // 错误后继续尝试消费
    }

    // Plugin 处理正常事件
    if pluginManager != nil {
        modifiedEvent, err := pluginManager.RunOnEventCallback(ctx, event)
        if err != nil {
            if !yield(nil, err) {
                return
            }
            continue
        }
        if modifiedEvent != nil {
            event = modifiedEvent
        }
    }

    // 仅持久化非部分事件
    if !event.LLMResponse.Partial {
        if err := r.sessionService.AppendEvent(ctx, storedSession, event); err != nil {
            yield(nil, fmt.Errorf("failed to add event to session: %w", err))
            return
        }
    }

    if !yield(event, nil) {
        return
    }
}
```

注意 Runner 在遇到错误时**没有立即返回**，而是 `continue` 继续尝试消费后续事件。这与 Flow.Run() 的策略不同——Flow 中错误是终局性的，但 Runner 允许 agent 在产生错误后继续产生事件。

## 4. LLM 错误的回调处理

### 4.1 OnModelErrorCallback

当 LLM 调用返回错误时，adk-go 先尝试通过回调恢复，而非直接传播错误。在 `base_flow.go:750-766`：

```go
for resp, err := range generateContent(ctx, f.Model, req, useStream) {
    if err != nil {
        // 先尝试错误回调恢复
        cbResp, cbErr := f.runOnModelErrorCallbacks(ctx, req, stateDelta, artifactDelta, err)
        if cbErr != nil {
            yield(nil, cbErr)
            return
        }
        if cbResp == nil {
            yield(nil, err)  // 回调未恢复，传播原始错误
            return
        }
        // 回调返回了替代响应，继续流程
        resp = &responseWithEventID{
            LLMResponse: cbResp,
            eventID:     resp.eventID,
        }
    }
}
```

`OnModelErrorCallback` 的签名（agent/llmagent/llmagent.go:297-301）：

```go
type OnModelErrorCallback func(ctx agent.CallbackContext,
    llmRequest *model.LLMRequest,
    llmResponseError error,
) (*model.LLMResponse, error)
```

如果回调返回非 nil 的 `LLMResponse`，则替代原始响应继续流程；如果返回 error，则传播该错误；如果返回 nil, nil，则传播原始 LLM 错误。

### 4.2 OnToolErrorCallback

工具执行错误也有类似的回调机制。在 `plugin/plugin.go:45`：

```go
OnToolErrorCallback llmagent.OnToolErrorCallback
```

其签名（agent/llmagent/llmagent.go:324-328）：

```go
type OnToolErrorCallback func(ctx tool.Context, tool tool.Tool,
    args map[string]any, err error,
) (map[string]any, error)
```

## 5. RetryAndReflect：自动重试插件

`plugin/retryandreflect/plugin.go` 实现了一个自我修复的自动重试插件。它的核心思路是：**工具失败时不直接返回错误给 LLM，而是构造一个包含错误信息和反思指导的响应，让 LLM 修正参数后重试**。

### 5.1 创建与配置

```go
// 创建默认配置的重试插件（最多重试 3 次）
retryPlugin, err := retryandreflect.New()

// 自定义配置
retryPlugin, err := retryandreflect.New(
    retryandreflect.WithMaxRetries(5),                        // 最多重试 5 次
    retryandreflect.WithErrorIfRetryExceeded(true),            // 超限后返回 error
    retryandreflect.WithTrackingScope(retryandreflect.Global), // 全局跟踪失败次数
)
```

### 5.2 错误处理流程

当工具执行失败时（retryandreflect/plugin.go:142-180）：

```go
func (r *retryAndReflect) onToolError(ctx tool.Context, tool tool.Tool,
    args map[string]any, err error,
) (map[string]any, error) {
    return r.handleToolError(ctx, tool, args, err)
}

func (r *retryAndReflect) handleToolError(ctx tool.Context, failedTool tool.Tool,
    args map[string]any, err error,
) (map[string]any, error) {
    // 跳过确认类错误
    if errors.Is(err, tool.ErrConfirmationRequired) || errors.Is(err, tool.ErrConfirmationRejected) {
        return nil, nil
    }

    // maxRetries 为 0 时直接返回
    if r.maxRetries == 0 {
        if r.errorIfRetryExceeded {
            return nil, err
        }
        return r.createToolRetryExceedMsg(failedTool, args, err), nil
    }

    // 增加失败计数
    currentRetries := toolFailureCounter[failedTool.Name()] + 1
    toolFailureCounter[failedTool.Name()] = currentRetries

    if currentRetries <= r.maxRetries {
        // 未超限：返回反思响应，LLM 会根据指导修正参数
        return r.createToolReflectionResponse(failedTool, args, err, currentRetries), nil
    }

    // 超限：返回超出消息或 error
    if r.errorIfRetryExceeded {
        return nil, err
    }
    return r.createToolRetryExceedMsg(failedTool, args, err), nil
}
```

### 5.3 反思响应

`createToolReflectionResponse`（retryandreflect/plugin.go:223-248）返回一个包含错误详情和反思指导的 map：

```go
return map[string]any{
    "response_type":       reflectAndRetryResponseType,
    "error_type":          fmt.Sprintf("%T", toolErr),
    "error_details":       toolErr.Error(),
    "retry_count":         retryCount,
    "reflection_guidance": strings.TrimSpace(buf.String()),  // 来自模板的指导文本
}
```

这个响应被返回给 LLM，LLM 阅读 `reflection_guidance` 后调整参数重新调用工具。

### 5.4 作用域跟踪

TrackingScope 控制失败计数的生命周期（retryandreflect/plugin.go:51-58）：

- **Invocation**：每次 invocation 重置计数
- **Global**：全局累计，跨 invocation 不重置

## 6. 错误与 Event 分离的设计哲学

为什么 adk-go 选择 `iter.Seq2[*session.Event, error]` 而非将错误嵌入 Event？原因有三：

### 6.1 语义清晰

Event 代表**已发生的交互**（用户输入、模型响应、工具调用）。错误代表**未能完成的过程**。将两者混合会让 Event 的语义变得模糊。

### 6.2 消费者行为不同

正常 Event 需要：持久化到 Session、展示给用户、触发后续流程。
错误需要：记录日志、重试、通知用户异常。
分离后消费者可以清晰地实现不同的处理路径。

### 6.3 错误可以终止迭代

`iter.Seq2` 的 yield 返回 false 时迭代停止。消费者可以在收到错误后决定是否继续，这种控制力在混合模式中难以实现。

## 7. 常见陷阱

### 7.1 迭代器中吞掉错误

最常见的错误是在消费迭代器时忽略 error：

```go
// 错误：只处理 Event，忽略 error
for event := range agent.Run(ctx) {  // 编译错误！Seq2 必须接收两个值
}

// 依然错误：接收了 error 但不处理
for event, err := range agent.Run(ctx) {
    if err != nil {
        log.Printf("error: %v", err)  // 仅日志，不中断
        continue                        // 继续消费
    }
    processEvent(event)
}
```

虽然在某些场景下继续消费是合理的（如 Runner 的做法），但**你必须意识到错误后的 Event 可能处于不一致状态**。

### 7.2 未处理 yield 返回的 false

在实现迭代器时，必须检查 yield 的返回值：

```go
// 错误：忽略 yield 返回值
for ev, err := range inner {
    yield(ev, err)  // 如果消费者已停止，继续迭代浪费资源
}

// 正确：检查 yield 返回值
for ev, err := range inner {
    if !yield(ev, err) {
        return  // 消费者已停止，立即退出
    }
}
```

adk-go 中所有迭代器实现都遵循此模式，例如 agent/agent.go:197-204：

```go
for event, err := range a.run(ctx) {
    if event != nil && event.Author == "" {
        event.Author = getAuthorForEvent(ctx, event)
    }
    if !yield(event, err) {
        return
    }
}
```

### 7.3 LLMResponse 的 ErrorCode 与 Go error 混淆

`model.LLMResponse` 有 `ErrorCode` 和 `ErrorMessage` 字段（model/llm.go:64-65），这是 LLM API 层面的错误（如内容过滤、安全拦截），与 Go 的 error 接口是两回事：

```go
type LLMResponse struct {
    // ...
    ErrorCode    string  // API 错误码，如 "SAFETY"
    ErrorMessage string  // API 错误描述
}
```

一个 LLMResponse 可能同时有 Content（部分内容）和 ErrorCode（安全过滤）。正确做法是**两者都检查**：

```go
if resp.ErrorCode != "" {
    // API 层面错误，可能是安全过滤、配额超限等
}
if err != nil {
    // Go 层面错误，网络故障、超时等
}
```

### 7.4 SessionService.AppendEvent 的错误处理

`AppendEvent` 可能返回错误（如后端存储故障），但 Event 本身可能已经生成。在 runner/runner.go:257-260：

```go
if err := r.sessionService.AppendEvent(ctx, storedSession, event); err != nil {
    yield(nil, fmt.Errorf("failed to add event to session: %w", err))
    return  // 终止迭代
}
```

如果 AppendEvent 失败，整个 Run 迭代终止。这意味着消费者可能已经看到了之前的一些事件，但最后一个事件未被持久化。你的消费者代码必须考虑这种**部分成功**的场景。

### 7.5 Plugin 回调中的错误传播

Plugin 回调返回错误时，PluginManager 会立即停止调用后续插件并传播错误（internal/plugininternal/plugin_manager.go:120-134）：

```go
func (pm *PluginManager) RunOnEventCallback(cctx agent.InvocationContext, event *session.Event) (*session.Event, error) {
    for _, plugin := range pm.plugins {
        callback := plugin.OnEventCallback()
        if callback != nil {
            newEvent, err := callback(cctx, event)
            if err != nil {
                return nil, err  // 立即返回，后续插件不执行
            }
            if newEvent != nil {
                return newEvent, nil  // 插件修改了事件，提前退出
            }
        }
    }
    return nil, nil
}
```

注意**短路行为**：任一插件返回非 nil 结果（无论是修改后的事件还是错误），后续插件都不会被调用。如果你的插件链有依赖关系，必须确保注册顺序正确。
