# Prompt 映射（PromptMap）- 同一 Agent 按模型切换 system prompt

> **源码路径**：[`trpc-agent-go/examples/model/promptmap/`](../../../../trpc-agent-go/examples/model/promptmap)
> **示例类型**：模型适配 · **难度**：入门

## 概述

`promptmap/` 演示如何让**同一个 `LLMAgent`** 在使用不同模型时自动套用不同的 system prompt。配置一次 `WithModelInstructions(map)`，之后切换模型时 prompt 跟着变，无需创建多个 Agent。

与兄弟策略的核心区别：
- 相对 [`switch`](./model-switch.md)：promptmap **不切模型**，只切 prompt；常和 switch 配合（switch 切模型，promptmap 跟着换 prompt）
- 相对 [`selector`](./model-selector.md)：promptmap 按"**当前激活的模型名**"路由 prompt，selector 按 Invocation 状态路由模型本身

## 核心概念

### 为什么需要按模型映射 prompt

不同模型对相同指令的响应差异很大：
- GPT-4o 可能需要更结构化的指令
- DeepSeek 可能更适合中文 prompt
- 小模型需要更明确的格式约束（如"以 MODEL_A: 开头"）

为每个模型手写一个 Agent 太冗余。promptmap 让**一个 Agent 容纳所有模型的 prompt 偏好**。

### 两层映射：Instruction 与 GlobalInstruction

trpc-agent-go 区分两层 system prompt：

| 层级 | API | 作用 |
|------|-----|------|
| GlobalInstruction | `WithGlobalInstruction` / `WithModelGlobalInstructions` | 全局系统提示，所有 Agent 共享 |
| Instruction | `WithInstruction` / `WithModelInstructions` | 当前 Agent 的系统提示 |

两者都可以提供"默认值 + 按模型映射"两套配置：

```go
agt := llmagent.New(agentName,
    llmagent.WithModels(models),                                // 注册模型
    llmagent.WithModel(defaultModel),                           // 默认模型
    llmagent.WithGlobalInstruction(defaultGlobalInstruction),   // 默认全局
    llmagent.WithInstruction(defaultInstruction),               // 默认 Agent
    llmagent.WithModelGlobalInstructions(map[string]string{     // 按模型全局
        modelA: "System: You are in MODEL_A mode.",
        modelB: "System: You are in MODEL_B mode.",
    }),
    llmagent.WithModelInstructions(map[string]string{           // 按模型 Agent
        modelA: "Start every answer with \"MODEL_A:\".",
        modelB: "Start every answer with \"MODEL_B:\".",
    }),
)
```

### 解析顺序

当一次请求实际激活模型 X 时：
1. 先查 `WithModelInstructions`（或 `WithModelGlobalInstructions`）map 里有没有 key=X 的条目
2. 有 → 用 map 里的 prompt
3. 没有 → 回退到 `WithInstruction`（或 `WithGlobalInstruction`）的默认值

## 代码解析

示例是单文件 `main.go`，用**同一条用户消息**跑两次，对比两次的输出前缀：

### 模型注册

```go
models := map[string]model.Model{
    *modelA: openai.New(*modelA),
    *modelB: openai.New(*modelB),
}
defaultModel := models[*modelA]
```

两个模型共享 `OPENAI_BASE_URL` 和 `OPENAI_API_KEY`，仅名字不同。这与 [`selector`](./model-selector.md) 的接线方式一致。

### 第一次跑：用默认模型 A

```go
msg := model.NewUserMessage("Say hello in one sentence.")

fmt.Printf("Run 1 (default model): %s\n", *modelA)
runOnce(ctx, r, sessionA, msg)
// 输出：MODEL_A: Hello! Nice to meet you.
```

走默认模型 → 查到 map 里 modelA 的条目 → 套用 "Start every answer with MODEL_A:"。

### 第二次跑：用 RunOption 临时切到模型 B

```go
fmt.Printf("\nRun 2 (per-request model): %s\n", *modelB)
runOnce(ctx, r, sessionB, msg,
    agent.WithModelName(*modelB),     // 临时切到 B
)
// 输出：MODEL_B: Hi there! How can I assist you today?
```

这里复用了 [`switch`](./model-switch.md) 的 `agent.WithModelName`——**模型一切换，promptmap 自动跟着换 prompt**，无需额外配置。

### 响应消费

```go
func printResponse(eventChan <-chan *event.Event) error {
    var out strings.Builder
    for ev := range eventChan {
        if ev.Error != nil {
            return fmt.Errorf("model error: %s", ev.Error.Message)
        }
        // ... 取 Delta 或 Message 内容 ...
    }
    fmt.Printf("Assistant: %s\n", strings.TrimSpace(out.String()))
    return nil
}
```

## 运行方式

### 环境变量

| 变量 | 必需 | 说明 |
|------|------|------|
| `OPENAI_API_KEY` | 是 | API Key |
| `OPENAI_BASE_URL` | 否 | 模型端点 |

### 命令行参数

| 参数 | 说明 | 默认值 |
|------|------|--------|
| `-a` | 模型 A 名字（默认模型） | `gpt-4o-mini` |
| `-b` | 模型 B 名字（对照模型） | `gpt-4o` |

### 运行命令

```bash
cd examples/model/promptmap
export OPENAI_API_KEY="your-api-key"

go run . -a gpt-4o-mini -b gpt-4o
```

### 预期输出

```
Model A: gpt-4o-mini
Model B: gpt-4o

Run 1 (default model): gpt-4o-mini
Assistant: MODEL_A: Hello! It's nice to meet you.

Run 2 (per-request model): gpt-4o
Assistant: MODEL_B: Hi there! How can I assist you today?
```

如果模型遵守 prompt，第一条响应以 `MODEL_A:` 开头，第二条以 `MODEL_B:` 开头——证明 prompt 跟着模型自动切换了。

## 适用场景与对比

**选 promptmap 当：**
- 同一 Agent 需要服务多个模型，每个模型有特定 prompt 偏好
- 想统一管理"模型→prompt"映射，避免散落的 if-else
- 配合 [`switch`](./model-switch.md) / [`selector`](./model-selector.md) 做端到端切换

**不应选 promptmap 当：**
- 各模型行为差异不大 → 直接用一个 prompt 即可
- 模型间差异在能力而非 prompt 上 → 用 [`selector`](./model-selector.md) 直接换模型

### promptmap vs selector

| 维度 | promptmap | selector |
|------|-----------|---------|
| 切换对象 | system prompt 文本 | 模型实例 |
| 触发依据 | 当前激活模型名 | Invocation 状态 |
| 配置位置 | Agent 创建时（map） | Run 时（回调） |
| 适合 | 同模型不同行为 | 不同模型不同能力 |

两者可以**叠加**：selector 切模型，promptmap 自动给切到的模型套对应 prompt。

## 关键要点

1. **两层映射并存**：Instruction 和 GlobalInstruction 各有独立的 map
2. **默认值兜底**：map 里没有的模型回退到 `WithInstruction` 默认值
3. **key 是模型名**：必须和 `model.Info().Name` 完全一致
4. **和 switch 无缝组合**：`WithModelName` 切模型时 prompt 自动跟着换
5. **避免多 Agent**：一个 Agent 容纳所有模型的 prompt 偏好

## 总结

promptmap 是模型适配层的"配置糖"——把"模型→prompt"映射集中管理，省去为每个模型单独建 Agent 的麻烦。常与 [`switch`](./model-switch.md) 或 [`selector`](./model-selector.md) 组合使用：上层切模型，promptmap 自动跟着换 prompt，端到端无感。
