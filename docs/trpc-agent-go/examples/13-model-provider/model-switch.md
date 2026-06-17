# 模型切换（Switch）- 运行时手动切换 Agent 的模型

> **源码路径**：[`trpc-agent-go/examples/model/switch/`](../../../../trpc-agent-go/examples/model/switch)
> **示例类型**：运行时控制 · **难度**：入门

## 概述

`switch/` 演示**两种**让用户主动切换 Agent 模型的方式：永久切换（影响后续所有请求）和单次切换（只影响下一次请求）。所有模型必须先**预注册**到 Agent 的模型表里，切换时按名字查找。

与兄弟策略的核心区别：
- 相对 [`failover`](./model-failover.md) / [`hedge`](./model-hedge.md)：switch 是**用户主动**触发，不是错误触发
- 相对 [`selector`](./model-selector.md)：switch 由**人**决定，selector 由**代码逻辑**决定
- 适合 A/B 测试、用户偏好、按任务挑模型等场景

## 核心概念

### 两种切换方法对比

| 维度 | 方法 1：Agent 级永久切换 | 方法 2：单次请求临时切换 |
|------|------------------------|------------------------|
| 命令 | `/switch <model>` | `/model <model>` |
| API | `agent.SetModelByName(name)` | `agent.WithModelName(name)` in `RunOption` |
| 影响范围 | **所有后续**请求 | **仅下一次**请求 |
| 持久性 | 直到再次切换 | 用完自动恢复默认 |
| 线程安全 | ✅ 原子操作 | ✅ RunOption 隔离 |
| 典型场景 | 用户偏好、改默认模型 | A/B 测试、临时 fallback |

### 预注册是前提

两种切换都依赖**按名字查找**，所以所有候选模型必须在 Agent 创建时通过 `WithModels(map)` 注册：

```go
models := map[string]model.Model{
    "deepseek-v4-flash": openai.New("deepseek-v4-flash",
        openai.WithVariant(openai.VariantDeepSeek)),
    "deepseek-v4-pro": openai.New("deepseek-v4-pro",
        openai.WithVariant(openai.VariantDeepSeek)),
}

agt := llmagent.New("switching-agent",
    llmagent.WithModels(models),                  // 注册模型表
    llmagent.WithModel(models["deepseek-v4-flash"]), // 设置默认
)
```

未注册的名字调用 `SetModelByName` 会返回错误。

### 变体（Variant）选项

示例里两个模型都用 `openai.WithVariant(openai.VariantDeepSeek)` 显式声明协议变体——虽然底层是 OpenAI SDK，但 DeepSeek 端点的某些字段语义和 OpenAI 略有差异，Variant 让 SDK 按对应厂商的协议细节处理。

## 代码解析

示例是单文件 `main.go`，用 `chatApp` 结构体管理两种切换状态：

```go
type chatApp struct {
    defaultModel        string
    agent               *llmagent.LLMAgent
    runner              runner.Runner
    models              map[string]model.Model // 用于校验
    sessionID           string
    nextModelName       string // 方法 2 的暂存状态
    usePerRequestSwitch bool
}
```

### 方法 1：永久切换（`/switch`）

```go
func (a *chatApp) handleSwitch(name string) error {
    if err := a.agent.SetModelByName(name); err != nil {
        fmt.Printf("Available models: deepseek-v4-flash, deepseek-v4-pro\n")
        return fmt.Errorf("failed to switch model: %w", err)
    }
    fmt.Printf("✅ Agent-level switch: all requests will now use %s\n", name)
    return nil
}
```

`SetModelByName` 直接修改 Agent 内部的默认模型指针，对所有后续 `runner.Run` 生效。

### 方法 2：单次切换（`/model`）

```go
func (a *chatApp) handleModelCommand(name string) error {
    if _, ok := a.models[name]; !ok {
        return fmt.Errorf("model %q not found in registered models", name)
    }
    a.nextModelName = name
    a.usePerRequestSwitch = true
    return nil
}

func (a *chatApp) processMessage(ctx context.Context, text string) error {
    var runOpts []agent.RunOption
    if a.usePerRequestSwitch && a.nextModelName != "" {
        runOpts = append(runOpts, agent.WithModelName(a.nextModelName))
        a.nextModelName = ""           // 用完立即清空
        a.usePerRequestSwitch = false
    }
    events, err := a.runner.Run(ctx, "user", a.sessionID,
        model.NewUserMessage(text), runOpts...)
    // ...
}
```

关键点：**用完即清**——保证单次切换不会污染后续请求。`agent.WithModelName` 通过 `RunOption` 注入，不影响 Agent 自身状态，因此对并发请求完全隔离。

### 替代写法

代码注释里提到，也可以用 `agent.WithModel(instance)` 直接传模型实例，适合需要为单次请求附加自定义配置（如不同的 base URL）的场景。

## 运行方式

### 环境变量

| 变量 | 必需 | 说明 | 默认值 |
|------|------|------|--------|
| `OPENAI_API_KEY` | 是 | 模型 API Key | — |
| `OPENAI_BASE_URL` | 否 | 模型端点（指向 DeepSeek 时设为 `https://api.deepseek.com/v1`） | `https://api.openai.com/v1` |

### 命令行参数

| 参数 | 说明 | 默认值 |
|------|------|--------|
| `-model` | 默认模型名 | `deepseek-v4-flash` |

### 运行命令

```bash
cd examples/model/switch
export OPENAI_API_KEY="your-key"
export OPENAI_BASE_URL="https://api.deepseek.com/v1"

go run main.go                              # 默认 flash
go run main.go -model deepseek-v4-pro       # 默认改为 pro
```

### 交互命令

| 命令 | 作用 |
|------|------|
| `/switch <model>` | 🔄 **永久**切换默认模型 |
| `/model <model>` | 🎯 **临时**用某模型跑一次 |
| `/new` | 🆕 开启新会话 |
| `/exit` | 👋 退出 |

### 预期输出

```
🚀 Model Switching Example
Model: deepseek-v4-flash
Commands: /switch X, /model X, /new, /exit
==================================================

✅ Chat ready! Session: session-1

💡 Special commands:
   /switch <model>  - 🔄 Agent-level: change default model for all requests
   /model <model>   - 🎯 Per-request: use model for next request only
   /new             - 🆕 Start a new session
   /exit            - 👋 End the conversation

👤 You: Hello
🤖 Hi! I'm running on Flash.

👤 You: /model deepseek-v4-pro
✅ Per-request mode: next request will use deepseek-v4-pro (agent default unchanged)

👤 You: Hello again
🔧 Per-request override: using model deepseek-v4-pro for this request only
🤖 Hi! I'm running on Pro.

👤 You: Hello
🤖 Hi! I'm running on Flash.    ← 自动恢复默认

👤 You: /switch deepseek-v4-pro
✅ Agent-level switch: all requests will now use deepseek-v4-pro

👤 You: Hello
🤖 Hi! I'm running on Pro.      ← 永久切换生效
```

## 适用场景与对比

**选 switch 当：**
- 想让用户选模型（如免费/付费档位）
- 做模型 A/B 测试（同一输入跑不同模型对比）
- 按任务类型挑模型（编码用 A、闲聊用 B）

**不应选 switch 当：**
- 想全自动按阶段路由 → [`selector`](./model-selector.md)
- 想自动容错 → [`failover`](./model-failover.md) / [`hedge`](./model-hedge.md)
- 想给每个模型配不同 system prompt → [`promptmap`](./model-promptmap.md)

### switch vs selector（易混淆）

| 维度 | switch | selector |
|------|--------|---------|
| 决策方 | **人**（用户/调用方） | **代码**（基于 Invocation 状态） |
| 切换粒度 | 整个 Agent 或单次请求 | **每次 LLM 调用**（一次 Run 可能多次） |
| 典型场景 | 用户偏好、A/B 测试 | 工具调用阶段用 A，最终答复用 B |

## 关键要点

1. **预注册是前提**：`llmagent.WithModels(map)` 必须先注册所有候选
2. **两种切换互不冲突**：永久切换 + 单次覆盖可叠加
3. **`SetModelByName` 永久、`WithModelName` 临时**：核心区别一句话
4. **单次切换用完即清**：避免状态泄漏到后续请求
5. **支持 Variant**：跨厂商协议差异由 `openai.WithVariant` 处理

## 总结

switch 是把模型选择权交给用户/调用方的最简方案——预注册 + 两个 API 就能跑通。如果想让代码按 LLM 调用阶段自动路由，看 [`selector`](./model-selector.md)；想让同一 Agent 针对不同模型用不同 prompt，看 [`promptmap`](./model-promptmap.md)。
