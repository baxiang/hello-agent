# 回调系统基础（Callbacks Basic）- Agent/Model/Tool 三级回调全景演示

> **源码路径**：[`trpc-agent-go/examples/callbacks/`](../../../../trpc-agent-go/examples/callbacks)
> **示例类型**：交互式 Chat · **难度**：入门

## 概述

`callbacks/`（顶层目录）是回调系统的**入门级综合演示**：一个带工具调用的多轮 Chat，同时挂载 `AgentCallbacks` / `ModelCallbacks` / `ToolCallbacks` 三套钩子，把 Agent 执行、模型推理、工具调用的每一个 Before/After 切片都打印到控制台，并演示了几种典型干预手段（自定义响应、参数修改、结果覆盖、原始请求访问）。

与同级兄弟示例的关系：

| 示例 | 聚焦点 |
|------|--------|
| 本文（basic） | 三级回调的**完整接线 + 全部干预手法**（入门） |
| [`auth`](./callbacks-auth.md) | 用 `Invocation.State` 做**鉴权与审计**（进阶） |
| [`timer`](./callbacks-timer.md) | 用回调做**性能计时 + OpenTelemetry 上报**（进阶） |
| [`imagetool`](./callbacks-imagetool.md) | 用 `ToolResultMessages` 把工具结果转成**多模态图片消息**（进阶） |

## 核心概念

### 三级回调一览

trpc-agent-go 把 Agent 一次执行的生命周期切成三个层级，每层都有 Before/After 两个钩子：

| 层级 | 包 | Before 钩子 | After 钩子 | 典型用途 |
|------|----|-------------|------------|----------|
| Agent | `agent` | `RegisterBeforeAgent` | `RegisterAfterAgent` | 入参日志、鉴权注入、Invocation State 初始化 |
| Model | `model` | `RegisterBeforeModel` | `RegisterAfterModel` | 请求拦截、Mock 响应、内容审核 |
| Tool | `tool` | `RegisterBeforeTool` | `RegisterAfterTool` | 参数校验/修改、Mock 结果、结果格式化 |

调用顺序（一轮含工具的执行）：`BeforeAgent → BeforeModel → AfterModel → BeforeTool → AfterTool → BeforeModel → AfterModel → AfterAgent`。

### 两种注册方式

```go
// 1) 传统写法：先 New 再 Register
modelCallbacks := model.NewCallbacks()
modelCallbacks.RegisterBeforeModel(beforeFn)
modelCallbacks.RegisterAfterModel(afterFn)

// 2) 链式写法（推荐，便于复用配置）
modelCallbacks := model.NewCallbacks().
    RegisterBeforeModel(beforeFn).
    RegisterAfterModel(afterFn)
```

回调构造完后，通过三个 With 选项一次性注入 LLM Agent：

```go
llmAgent := llmagent.New("chat-assistant",
    llmagent.WithAgentCallbacks(agentCallbacks),
    llmagent.WithModelCallbacks(modelCallbacks),
    llmagent.WithToolCallbacks(toolCallbacks),
)
```

### 回调返回值的"短路"语义

返回**非 nil 的结果**就能短路默认执行：

| 回调 | 短路字段 | 效果 |
|------|---------|------|
| `BeforeModel` | `BeforeModelResult.CustomResponse` | 跳过实际 LLM 调用，直接用该响应 |
| `BeforeTool` | `BeforeToolResult.CustomResult` | 跳过工具执行，直接用该结果 |
| `BeforeTool` | `BeforeToolResult.ModifiedArguments` | **不短路**，但工具按修改后的参数执行 |
| `AfterModel` | `AfterModelResult.CustomResponse` | 覆盖模型响应 |
| `AfterTool` | `AfterToolResult.CustomResult` | 覆盖工具结果 |
| `BeforeAgent` | `BeforeAgentResult.CustomResponse` | 跳过整个 Agent 执行 |

### 通过 context 拿到 Invocation

Model 和 Tool 回调无法直接拿到 `args.Invocation`，需要从 `ctx` 中取：

```go
if inv, ok := agent.InvocationFromContext(ctx); ok && inv != nil {
    fmt.Printf("agent=%s, id=%s\n", inv.AgentName, inv.InvocationID)
}
```

这是 [`auth`](./callbacks-auth.md) 和 [`timer`](./callbacks-timer.md) 共用的入口模式。

## 代码解析

### 文件结构

- `main.go`：交互循环、Runner 接线、事件流处理
- `callbacks.go`：所有回调的注册与具体逻辑
- `tools.go`：`calculator` 和 `current_time` 两个工具的实现及入参/出参结构体

### BeforeModel：打印上下文 + 触发性短路

```go
func (c *multiTurnChatWithCallbacks) createBeforeModelCallback() model.BeforeModelCallbackStructured {
    return func(ctx context.Context, args *model.BeforeModelArgs) (*model.BeforeModelResult, error) {
        userMsg := c.extractLastUserMessage(args.Request)
        fmt.Printf("\n🔵 BeforeModelCallback: model=%s, lastUserMsg=%q\n", c.modelName, userMsg)

        if inv, ok := agent.InvocationFromContext(ctx); ok && inv != nil {
            fmt.Printf("🔵 BeforeModelCallback: ✅ Invocation present in ctx (agent=%s, id=%s)\n",
                inv.AgentName, inv.InvocationID)
        }

        // 触发条件：用户输入 "custom model" → 短路返回
        if c.shouldReturnCustomResponse(userMsg) {
            return &model.BeforeModelResult{CustomResponse: c.createCustomResponse()}, nil
        }
        return nil, nil
    }
}
```

### AfterModel：访问原始请求 + 覆盖响应

`AfterModelArgs` 同时携带 `Request` 和 `Response`，可以做"原始输入 vs 模型输出"的关联：

```go
func (c *multiTurnChatWithCallbacks) createAfterModelCallback() model.AfterModelCallbackStructured {
    return func(ctx context.Context, args *model.AfterModelArgs) (*model.AfterModelResult, error) {
        c.handleModelFinished(args.Response)
        c.demonstrateOriginalRequestAccess(args.Request, args.Response)

        // 模型输出包含 "override me" → 替换响应
        if c.shouldOverrideResponse(args.Response) {
            return &model.AfterModelResult{CustomResponse: c.createOverrideResponse()}, nil
        }
        return nil, nil
    }
}
```

> 流式场景下 `AfterModelCallback` 会被多次触发，示例通过 `resp.Done` 判定只处理最后一帧，避免重复触发。

### BeforeTool：参数修改 + Mock 结果双演示

`calculator` 工具会同时演示两种干预：

```go
// 1) 参数标准化：把 operation 转小写（ModifiedArguments）
var calcArgs calculatorArgs
json.Unmarshal(args.Arguments, &calcArgs)
calcArgs.Operation = strings.ToLower(calcArgs.Operation)
modifiedArgsJSON, _ := json.Marshal(calcArgs)
args.Arguments = modifiedArgsJSON

// 2) 特殊值拦截：参数包含 "42" → 直接返回 Mock 结果（CustomResult）
if c.shouldReturnCustomToolResult(args.ToolName, args.Arguments) {
    return &tool.BeforeToolResult{CustomResult: c.createCustomCalculatorResult()}, nil
}

// 3) 仅修改参数时也要把 ModifiedArguments 显式返回
if modifiedArgs != nil {
    return &tool.BeforeToolResult{ModifiedArguments: modifiedArgs}, nil
}
```

### AfterTool：结果格式化

`current_time` 工具的结果在 After 回调里被拼上一个 `Formatted` 字段：

```go
if c.shouldFormatTimeResult(args.ToolName, args.Result) {
    return &tool.AfterToolResult{CustomResult: c.formatTimeResult(args.Result)}, nil
}
```

### Agent 回调：起止边界

```go
// BeforeAgent：打印用户消息、invocationID
fmt.Printf("\n🟢 BeforeAgentCallback: agent=%s, invocationID=%s, userMsg=%q\n",
    args.Invocation.AgentName, args.Invocation.InvocationID, args.Invocation.Message.Content)

// AfterAgent：打印执行错误和回复内容概览
fmt.Printf("\n🟡 AfterAgentCallback: agent=%s, invocationID=%s, runErr=%v, userMsg=%q\n", ...)
```

## 运行方式

### 环境变量

| 变量 | 必需 | 说明 |
|------|------|------|
| `OPENAI_API_KEY` | 是 | 模型 API Key |

### 命令行参数

| 参数 | 说明 | 默认值 |
|------|------|--------|
| `-model` | 模型名 | `deepseek-v4-flash` |
| `-streaming` | 是否流式输出 | `true` |

### 运行命令

```bash
cd examples/callbacks
export OPENAI_API_KEY="your-api-key"

go run .                          # 默认流式
go run . -model gpt-4o-mini       # 切换模型
go run . -streaming=false         # 非流式
```

### 交互命令与触发短语

| 输入 | 触发效果 |
|------|----------|
| `show me original request` | 演示 AfterModel 访问原始 Request |
| `override me` | AfterModel 覆盖响应 |
| `custom model` | BeforeModel 返回自定义响应（短路 LLM） |
| `calculator 42 + 42` | BeforeTool 返回 Mock 结果（短路工具） |
| `/history` | 让 Agent 复述对话历史 |
| `/new` | 开启新会话 |
| `/exit` | 退出 |

### 预期输出

```
🚀 Multi-turn Chat with Runner + Tools + Callbacks
Model: deepseek-v4-flash
Streaming: true
Available tools: calculator, current_time
==================================================
✅ Chat with callbacks ready! Session: chat-session-1750000000

👤 You: calculate 42 + 42
🟢 BeforeAgentCallback: agent=chat-assistant, invocationID=inv-...
🔵 BeforeModelCallback: model=deepseek-v4-flash, lastUserMsg="calculate 42 + 42"
🔵 BeforeModelCallback: ✅ Invocation present in ctx (agent=chat-assistant, id=inv-...)
🤖 Assistant:
🔧 CallableTool calls initiated:
   • calculator (ID: call_abc)
     Args: {"operation":"ADD","a":42,"b":42}
🔄 Executing tools...
🟠 BeforeToolCallback: tool=calculator, args={"operation":"ADD","a":42,"b":42}
🟠 BeforeToolCallback: Modified args for calculator: {"operation":"add","a":42,"b":42}
🟠 BeforeToolCallback: triggered, custom result returned for calculator with 42.
🟤 AfterToolCallback: tool=calculator, args=..., result={custom 42 42 4242}, err=<nil>
... (模型基于 mock 结果继续回复)
🟣 AfterModelCallback: model=deepseek-v4-flash has finished
🟡 AfterAgentCallback: agent=chat-assistant, completed
```

## 适用场景与对比

**选 basic 当：**
- 第一次接触 trpc-agent-go 回调系统，想看一遍完整的 Before/After 链路
- 需要一份能直接复制的"参数修改 / Mock / 响应覆盖"代码模板
- 不需要外部依赖（无数据库、无 OTEL Collector）

**对比兄弟示例：**

| 维度 | basic | auth | timer | imagetool |
|------|-------|------|-------|-----------|
| 主要演示 | 全套干预手法 | Invocation.State 鉴权 | 计时 + OTEL | ToolResultMessages |
| 回调类型 | Before/After 三套 | Before/After（Agent+Tool） | Before/After 三套 | `ToolResultMessages` |
| 外部依赖 | 无 | 无 | docker（OTEL 栈） | 多模态模型 |
| 交互方式 | 多轮 Chat | 多轮 Chat | 多轮 Chat | 单次执行 |
| 难度 | 入门 | 进阶 | 进阶 | 进阶 |

## 关键要点

1. **三级粒度**：Agent/Model/Tool 三层 Before/After 钩子覆盖了一次执行的完整链路
2. **注册方式**：传统式和链式（`model.NewCallbacks().RegisterXxx(...).RegisterYyy(...)`）等价，链式更简洁
3. **短路返回**：`BeforeXxx` 返回 `CustomResponse/CustomResult` 即跳过默认执行；`AfterXxx` 返回 `CustomResponse/CustomResult` 即覆盖原值
4. **参数修改不短路**：`BeforeToolResult.ModifiedArguments` 只改参数、不跳过执行
5. **原始请求访问**：`AfterModelArgs.Request` 携带原始 Request，可用于内容还原、合规复查
6. **Invocation 来源**：Agent 回调从 `args.Invocation` 拿；Model/Tool 回调从 `agent.InvocationFromContext(ctx)` 拿

## 总结

basic 示例是回调系统的"全景图"。看懂本文后，再去 [`auth`](./callbacks-auth.md) 学习如何用 `Invocation.State` 做鉴权与审计、去 [`timer`](./callbacks-timer.md) 学习如何把回调接入 OpenTelemetry、去 [`imagetool`](./callbacks-imagetool.md) 学习 `ToolResultMessages` 这条多模态支路——它们都是本文骨架上的专项扩展。回到 [`callbacks`](./callbacks.md) 索引页可看到所有子示例的导航与选型建议。
