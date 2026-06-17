# 模型选择器（Selector）- 按 LLM 调用阶段自动路由模型

> **源码路径**：[`trpc-agent-go/examples/model/selector/`](../../../../trpc-agent-go/examples/model/selector)
> **示例类型**：精细化路由 · **难度**：进阶

## 概述

`selector/` 演示 `agent.WithModelSelector`：**每一次 LLM 调用**都执行用户提供的回调函数，由回调根据 `agent.Invocation` 状态返回该次调用该用的 `model.Model`。这是模型路由策略里**粒度最细**的一种——一次 `runner.Run` 内部可能触发多次 LLM 调用（如工具调用循环），每次都可以用不同模型。

与兄弟策略的核心区别：
- 相对 [`switch`](./model-switch.md)：selector 由**代码逻辑**决定，且可深入到单次 LLM 调用粒度
- 相对 [`failover`](./model-failover.md) / [`hedge`](./model-hedge.md)：selector 是**正常路由**，不是错误容错
- 适合"工具规划用大模型、最终答复用小模型"这类成本优化场景

## 核心概念

### ModelSelector 回调签名

```go
type ModelSelector func(ctx context.Context, inv *agent.Invocation) (model.Model, error)
```

注意：返回的是 `model.Model` **实例**而不是模型名字字符串。这给了调用方最大灵活性——可以为不同阶段返回配置完全不同的模型实例（不同 base URL、不同 token 限制等）。

### Invocation 状态：路由依据

`agent.Invocation` 是一次 `runner.Run` 的运行时上下文，可在工具执行期间通过 `SetState` 写入键值，在 selector 回调里通过 `GetStateValue[T]` 读出：

```go
// 工具执行时写入状态
agent.InvocationFromContext(ctx).SetState(stateKey, true)

// selector 回调里读出状态
checked, ok := agent.GetStateValue[bool](inv, stateKey)
```

这是 selector 实现"按阶段路由"的核心机制——**应用层拥有路由逻辑**，框架只负责传递状态。

### 本示例的两阶段路由

```
用户提问 "请计算 19 * 23"
        ↓
  ┌─────────────────────────────┐
  │ 第 1 次 LLM 调用             │ ← selector 返回 toolCallModel
  │   模型决定调用 calculator    │   （状态：calculator 未调用）
  └─────────────────────────────┘
        ↓
  ┌─────────────────────────────┐
  │ 工具 calculator 执行         │ ← 工具写入状态：
  │   结果：19*23=437            │   calculator_called = true
  └─────────────────────────────┘
        ↓
  ┌─────────────────────────────┐
  │ 第 2 次 LLM 调用             │ ← selector 返回 finalModel
  │   综合工具结果给出最终答复   │   （状态：calculator 已调用）
  └─────────────────────────────┘
```

通过把"是否已经调用过 calculator"作为状态，selector 在两次 LLM 调用之间切换了模型。

## 代码解析

示例拆成 4 个文件，是这一组示例里最模块化的：

| 文件 | 职责 |
|------|------|
| `main.go` | 解析 `-tool-call-model` / `-final-model` flag |
| `agent.go` | Runner/Agent 接线 + selector 闭包 |
| `tool.go` | calculator 工具实现（含状态写入） |
| `print.go` | Banner、事件流消费、工具调用打印 |

### Selector 实现（`agent.go`）

```go
const calculatorCalledStateKey = "example:model_selector:calculator_called"

func selectByToolState(toolCallModel, finalModel model.Model) agent.ModelSelector {
    return func(_ context.Context, inv *agent.Invocation) (model.Model, error) {
        calculatorCalled, ok := agent.GetStateValue[bool](inv, calculatorCalledStateKey)
        if ok && calculatorCalled {
            fmt.Printf("ModelSelector: %s (final answer)\n", finalModel.Info().Name)
            return finalModel, nil
        }
        fmt.Printf("ModelSelector: %s (tool planning)\n", toolCallModel.Info().Name)
        return toolCallModel, nil
    }
}
```

闭包捕获两个模型，根据状态返回对应实例。`finalModel.Info().Name` 取出模型自身名字用于打印。

### 把 selector 传入 Run（`agent.go`）

```go
eventChan, err := r.Run(
    ctx,
    "demo-user",
    "demo-session",
    model.NewUserMessage(userPrompt),
    agent.WithModelSelector(modelSelector),   // 关键：注入 selector
)
```

`agent.WithModelSelector` 是 `agent.RunOption`，所以可以和 [`switch`](./model-switch.md) 的 `WithModelName` 等 RunOption **叠加使用**。

### 工具写入状态（`tool.go`）

```go
func calculate(ctx context.Context, input calculatorInput) (calculatorOutput, error) {
    // ... 计算逻辑 ...
    if inv, ok := agent.InvocationFromContext(ctx); ok {
        inv.SetState(calculatorCalledStateKey, true)
    }
    return calculatorOutput{...}, nil
}
```

工具通过 `agent.InvocationFromContext(ctx)` 拿到当前 Invocation，再 `SetState` 标记自己已执行。这是框架提供的**安全的状态共享通道**——不污染 Session、不跨请求泄漏。

### 共享 endpoint 配置（`agent.go`）

```go
func openAIModelOptions() []openai.Option {
    baseURL := strings.TrimSpace(os.Getenv("OPENAI_BASE_URL"))
    if baseURL == "" {
        return nil
    }
    return []openai.Option{openai.WithBaseURL(baseURL)}
}
```

两个模型在本示例里共享 `OPENAI_BASE_URL` 和 `OPENAI_API_KEY`——它们只通过**模型名**区分。生产场景里完全可以为两个模型配不同的 endpoint/key。

## 运行方式

### 环境变量

| 变量 | 必需 | 说明 |
|------|------|------|
| `OPENAI_API_KEY` | 是 | API Key |
| `OPENAI_BASE_URL` | 否 | 模型端点 |

### 命令行参数

| 参数 | 说明 | 默认值 |
|------|------|--------|
| `-tool-call-model` | 工具规划阶段用的模型 | `deepseek-v4-flash` |
| `-final-model` | 最终答复阶段用的模型 | `deepseek-v4-flash` |

### 运行命令

```bash
cd examples/model/selector
export OPENAI_API_KEY="your-key"
export OPENAI_BASE_URL="your-openai-compatible-base-url"

go run .                                            # 两阶段同模型
go run . -tool-call-model deepseek-v4-pro -final-model deepseek-v4-flash
```

### 预期输出

```
Model Selector Example
Tool-call model: deepseek-v4-pro
Final-answer model: deepseek-v4-flash
==================================================
ModelSelector: deepseek-v4-pro (tool planning)

Tool call: calculator
Args: {"a":19,"b":23,"operation":"multiply"}

Tool result: {"expression":"19 * 23","result":437}
ModelSelector: deepseek-v4-flash (final answer)
Assistant: 19 乘以 23 等于 437。
```

注意 selector 被调用了**两次**，分别返回了不同模型——这正是它区别于 [`switch`](./model-switch.md)（单次 Run 只能选一个）的核心能力。

## 适用场景与对比

**选 selector 当：**
- 工具规划阶段和最终答复阶段对模型能力要求不同（如规划要强模型、答复要快模型）
- 想按 Invocation 状态做精细化成本控制
- 需要在一次 Run 内多次切模型

**不应选 selector 当：**
- 只想给用户切换按钮 → [`switch`](./model-switch.md)
- 想做错误容错 → [`failover`](./model-failover.md) / [`hedge`](./model-hedge.md)
- 只是想给不同模型配不同 prompt → [`promptmap`](./model-promptmap.md)

### selector vs switch（易混淆）

| 维度 | selector | switch |
|------|---------|--------|
| 决策方 | 代码（回调函数） | 人（用户/调用方） |
| 粒度 | **每次 LLM 调用** | 整个 Agent 或单次请求 |
| 状态来源 | `agent.Invocation` | CLI/调用方输入 |
| 一次 Run 内切几次 | 多次 | 0 或 1 次 |

### selector vs promptmap

| 维度 | selector | promptmap |
|------|---------|-----------|
| 切换对象 | 模型实例 | system prompt 文本 |
| 触发条件 | Invocation 状态 | 当前激活的模型名 |
| 适合 | 模型能力差异大 | 同模型、不同行为指令 |

## 关键要点

1. **粒度细到每次 LLM 调用**：这是它最独特的能力
2. **返回 `model.Model` 而非名字**：可以为不同阶段配不同 endpoint/key
3. **状态通过 Invocation 共享**：工具 `SetState`，selector `GetStateValue[T]`
4. **应用层拥有路由逻辑**：框架不预设路由规则
5. **可与其他 RunOption 叠加**：`WithModelSelector` + `WithModelName` 等可共存

## 总结

selector 是模型路由策略里**表达力最强**的一种：你可以写任意复杂的回调，按 Invocation 状态、按调用阶段、按业务上下文选模型。如果场景简单（只需用户切换），用 [`switch`](./model-switch.md) 即可；如果想按模型配 prompt，用 [`promptmap`](./model-promptmap.md)。
