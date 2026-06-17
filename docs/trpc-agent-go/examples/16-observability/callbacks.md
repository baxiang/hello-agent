# 回调系统 - Agent / Model / Tool 三级生命周期钩子

> **源码路径**：[`trpc-agent-go/examples/callbacks/`](../../../../trpc-agent-go/examples/callbacks)
> **子示例数**：4 个 · 本页为分类索引，每个子示例有独立详解

## 概述

回调系统是 trpc-agent-go **可观测性与运行时控制**的基石。它把一次 Agent 执行切分成 Agent / Model / Tool 三个层级，每层都提供 Before / After（以及 `ToolResultMessages`）钩子，让你可以在不修改框架代码的前提下，注入日志、鉴权、计时、内容审核、协议改写等任意逻辑。

`examples/callbacks/` 目录用 **1 个顶层示例 + 3 个子目录**覆盖了回调系统的四种典型用法。

## 子示例导航

| 子示例 | 聚焦点 | 难度 | 一句话说明 |
|--------|--------|------|-----------|
| [`callbacks/`（basic）](./callbacks-basic.md) | 全景入门 | 入门 | 三级 Before/After 全套钩子 + 参数修改 / Mock / 响应覆盖 |
| [`callbacks/auth/`](./callbacks-auth.md) | Invocation.State 鉴权 | 进阶 | 工具级权限检查 + 审计日志 |
| [`callbacks/timer/`](./callbacks-timer.md) | 计时 + OpenTelemetry | 进阶 | 三级耗时测量 + Jaeger/Prometheus 上报 |
| [`callbacks/imagetool/`](./callbacks-imagetool.md) | ToolResultMessages | 进阶 | 把工具返回的 PNG 字节转成多模态图片消息 |

## 选型建议

```
需要拦截或观测 Agent 执行？
├── 第一次接触，想看完整 Before/After 链路 ─────→ basic
├── 需要在工具层做权限控制 / 审计 ─────────────→ auth
├── 需要生产级 SLA 指标（P50/P99 耗时、Trace）─→ timer
└── 工具会产出图片/音频等非文本数据 ──────────→ imagetool
```

## 核心概念

### 三级回调全景

| 层级 | 包 | Before 钩子 | After 钩子 | 典型用途 |
|------|----|-------------|------------|----------|
| Agent | `agent` | `RegisterBeforeAgent` | `RegisterAfterAgent` | 入参日志、鉴权注入、State 初始化 |
| Model | `model` | `RegisterBeforeModel` | `RegisterAfterModel` | 请求拦截、Mock 响应、内容审核 |
| Tool | `tool` | `RegisterBeforeTool` | `RegisterAfterTool` | 参数校验/修改、Mock 结果、结果格式化 |
| Tool（消息层） | `tool` | — | `RegisterToolResultMessages` | 改写工具结果回传给模型的消息（多模态等） |

### 调用顺序

一次含工具调用的典型执行：

```
BeforeAgent
  ├── BeforeModel ── LLM 推理 ── AfterModel
  ├── BeforeTool  ── 工具执行 ── AfterTool  ── ToolResultMessages
  └── BeforeModel ── LLM 推理 ── AfterModel
AfterAgent
```

### 注册与注入

```go
// 传统写法
modelCallbacks := model.NewCallbacks()
modelCallbacks.RegisterBeforeModel(beforeModelFn)
modelCallbacks.RegisterAfterModel(afterModelFn)

// 链式写法（推荐，便于复用）
modelCallbacks := model.NewCallbacks().
    RegisterBeforeModel(beforeModelFn).
    RegisterAfterModel(afterModelFn)

// 一次性注入 Agent
llmAgent := llmagent.New("chat-assistant",
    llmagent.WithAgentCallbacks(agentCallbacks),
    llmagent.WithModelCallbacks(modelCallbacks),
    llmagent.WithToolCallbacks(toolCallbacks),
)
```

### 回调返回值的"短路"语义

| 回调 | 短路字段 | 效果 |
|------|---------|------|
| `BeforeModel` | `BeforeModelResult.CustomResponse` | 跳过 LLM 调用 |
| `BeforeTool` | `BeforeToolResult.CustomResult` | 跳过工具执行 |
| `BeforeTool` | `BeforeToolResult.ModifiedArguments` | **不短路**，工具按新参数执行 |
| `AfterModel` | `AfterModelResult.CustomResponse` | 覆盖模型响应 |
| `AfterTool` | `AfterToolResult.CustomResult` | 覆盖工具结果 |
| `BeforeAgent` | `BeforeAgentResult.CustomResponse` | 跳过整个 Agent |

返回 `nil` 则继续默认流程。

### Invocation 与 Invocation State

`agent.Invocation` 是一次 Agent 执行的上下文对象，包含 AgentName、InvocationID、Message，以及一个**线程安全、invocation 级别**的 KV 存储：

```go
inv.SetState(key, value)
v, ok := inv.GetState(key)
inv.DeleteState(key)
```

| 获取方式 | 适用回调 |
|----------|----------|
| `args.Invocation` | Agent 回调（BeforeAgent/AfterAgent） |
| `agent.InvocationFromContext(ctx)` | Model / Tool 回调 |

State 是 [`auth`](./callbacks-auth.md) 和 [`timer`](./callbacks-timer.md) 共同的"传递桥梁"，但承载内容截然不同：

| 示例 | Key 前缀 | 承载内容 |
|------|----------|----------|
| auth | `custom:user_context`、`custom:audit_log` | 用户身份、审计日志 |
| timer | `agent:`、`model:`、`tool:<name>:<callID>:` | 开始时间、trace span |

### ToolCallID 与并发工具调用

LLM 可在单次响应里返回多个 tool_call，框架**并发**执行它们。要隔离每次调用的 State / Span，必须在 key 中带上 ToolCallID：

```go
toolCallID := args.ToolCallID           // tool.BeforeToolArgs/AfterToolArgs 自带
if toolCallID == "" {
    toolCallID = "default"              // 老版本兼容兜底
}
key := fmt.Sprintf("tool:%s:%s:start_time", args.ToolName, toolCallID)
```

[`timer`](./callbacks-timer.md) 是唯一演示这一并发安全模式的示例。

## 共通的运行命令

```bash
# 通用前置
export OPENAI_API_KEY="your-api-key"

# 各子示例入口
cd examples/callbacks            && go run .                    # basic
cd examples/callbacks/auth       && go run . --role admin       # auth
cd examples/callbacks/timer      && docker compose up -d && go run .  # timer（需遥测栈）
cd examples                      && go run ./callbacks/imagetool  # imagetool
```

## 共同的命令行参数

basic / timer 共用相同的 flag 风格（`-model` / `-streaming`），auth 改用 `--user-id` / `--role` / `--model`，imagetool 仅 `-model` 且默认读 `MODEL_NAME` 环境变量。详见各子示例文档。

## 四种典型干预手法一览

| 手法 | 出现于 | 适用场景 |
|------|--------|----------|
| CustomResponse 短路 | basic 的 BeforeModel / AfterModel | Mock、内容拦截 |
| ModifiedArguments | basic 的 BeforeTool | 参数标准化、注入上下文 |
| CustomResult | basic 的 BeforeTool / AfterTool | Mock 结果、结果格式化 |
| 错误返回 | auth 的 BeforeTool | 鉴权拒绝、参数校验失败 |
| Invocation.State 注入 | auth 的 BeforeAgent | 用户身份、租户、A/B 分桶 |
| Metrics + Span | timer 的全部回调 | 性能观测、SLA 监控 |
| ToolResultMessages | imagetool | 多模态消息构造 |

## 学习路径建议

1. **先读 [`basic`](./callbacks-basic.md)**：理解三级回调的完整接线、四种短路返回、context 取 Invocation——这是所有其他示例的基础
2. **再读 [`auth`](./callbacks-auth.md)**：看 `Invocation.State` 如何在 Before/After 之间安全传递状态，以及如何用 error 拒绝执行
3. **接着读 [`timer`](./callbacks-timer.md)**：把回调接入 OpenTelemetry，并掌握 ToolCallID 处理并发工具调用的关键模式
4. **按需读 [`imagetool`](./callbacks-imagetool.md)**：当需要把工具的非文本结果（图片、音频、文件）送给多模态模型时

## 总结

回调系统的设计精髓在于**统一的生命周期切片 + 多种返回值语义**：同一套 Before/After 钩子，既能用来打日志、也能用来拦截请求、还能用来重塑协议消息；同一套 `Invocation.State`，既能装用户身份、也能装计时数据。理解了 basic 的全景图，再按需阅读 auth / timer / imagetool 的专项扩展，就能覆盖 Agent 生产化过程中的绝大多数观测与控制需求。

回调系统与同目录的 [`telemetry.md`](./telemetry.md)、[`tokentracker.md`](./tokentracker.md) 互为补充：Callbacks 提供应用层的精细控制钩子，Telemetry 提供平台级的自动链路追踪，TokenTracker 专注于 Token 维度的成本观测。
