# EvalSet 录制器 - 把真实流量沉淀成可复用评测集

> **源码路径**：[`trpc-agent-go/examples/evaluation/evalsetrecorder/`](../../../../trpc-agent-go/examples/evaluation/evalsetrecorder)
> **示例类型**：录制器（Runner 插件） · **难度**：进阶

## 概述

`evalsetrecorder/` 不是"跑一次评测"，而是**逆向生成评测集**：它把 Runner 上发生的真实对话（用户输入、工具调用、最终回复）作为 Runner 插件实时录制下来，沉淀成一份可复用的 EvalSet 文件。当你苦于"没有标注数据来评测 Agent"时，录制器是最省力的起手式。

与其它评测示例的区别：那些示例**消费**现成的 EvalSet 来打分；录制器**生产** EvalSet，本身不执行任何指标计算。

## 核心概念

### recorder 是 Runner 插件

```go
manager := evalsetlocal.New(evalset.WithBaseDir(*evalSetDir))
rec, err := recorder.New(manager)
run := runner.NewRunner(appName, newCalculatorAgent(*modelName, *streaming),
    runner.WithPlugins(rec))
```

- `recorder.New(manager)` 接收一个 `evalset.Manager`（这里用 local 文件后端），把录到的内容写进去。
- 通过 `runner.WithPlugins(rec)` 挂到 Runner 上，对业务代码零侵入。

### 默认 ID 映射

默认情况下，录制器用 `sessionID` 同时作为 `EvalSetID` 和 `EvalCaseID`，文件落盘到：

```text
<evalsetDir>/<appName>/<sessionID>.evalset.json
```

它还会把 `RunOptions.RuntimeState` 快照进 `SessionInput.State`，并把注入的 context messages 记录在 EvalCase 作用域，方便回放。

### TraceMode：录制成 trace 用例

开启 `recorder.WithTraceModeEnabled(true)` 后，录制器会生成 `EvalModeTrace` 类型的用例，把每轮对话追加到 `ActualConversation` 而非 `Conversation`——这正是 [`trace`](./evaluation-trace.md) 评测模式所需要的数据形态。

## 代码解析

`main.go` 演示在**同一 session** 里跑 3 轮，验证 Agent 能记住上下文：

```go
turns := []string{
    "i am 18 years old",
    "what is my age?",
    "calculate my age * 2",
}
for _, text := range turns {
    events, err := run.Run(ctx, *userID, *sessionID, model.NewUserMessage(text))
    // ... 逐 event 打印
}
run.Close()  // 关闭 Runner（必要时 flush 异步写）
```

关闭 Runner 后，再 `manager.Get(ctx, appName, *sessionID)` 把落盘的 EvalSet 读回并 `MarshalIndent` 打印，直观看到"对话是如何被结构化成 EvalCase 的"。

## 运行方式

### 环境变量

| 变量 | 必需 | 说明 | 默认值 |
|------|------|------|--------|
| `OPENAI_API_KEY` | 是 | 模型 API Key | — |
| `OPENAI_BASE_URL` | 否 | 模型端点 | `https://api.openai.com/v1` |

### 命令行参数

| 参数 | 说明 | 默认值 |
|------|------|--------|
| `-evalset-dir` | EvalSet 文件写入目录 | `./output` |
| `-model` | 被录制 Agent 模型 | `gpt-5.2` |
| `-streaming` | 是否流式输出 | `false` |
| `-user` | Runner 的 userID | `user-1` |
| `-session` | 同时作为 EvalSetID/EvalCaseID 的 sessionID | `session-1` |

### 运行命令

```bash
cd examples/evaluation/evalsetrecorder
export OPENAI_API_KEY="sk-..."

go run . -evalset-dir "./output" -session "session-1"
```

### 预期产物

```text
./output/evalset-recorder-app/session-1.evalset.json
```

控制台会先打印每轮的 event JSON，最后打印录制出的完整 EvalSet 结构。

## 适用场景与对比

**选 evalsetrecorder 当：**
- 没有标注数据，想从真实/线上流量冷启动一份评测集
- 希望评测用例随业务演进"自动生长"
- 需要把线上 trace 沉淀成 [`trace`](./evaluation-trace.md) 模式用例（配合 `WithTraceModeEnabled`）

| 维度 | evalsetrecorder（录制器） | 手写 EvalSet（local/inmemory） |
|------|------|------|
| 数据来源 | 真实 Runner 流量 | 人工编写 |
| 侵入性 | Runner 插件，零侵入 | 需单独维护用例文件 |
| 产出 | `.evalset.json` 文件 | 已有用例文件 |
| 是否打分 | ❌（只录制） | ✅ |

## 关键要点

1. 录制器是一个 **Runner 插件**，通过 `runner.WithPlugins(rec)` 挂载，对业务零侵入。
2. 默认 `sessionID` 即 `EvalSetID`/`EvalCaseID`，会快照 `RuntimeState` 到 `SessionInput.State`。
3. `WithTraceModeEnabled(true)` 产出 trace 模式用例（写入 `ActualConversation`），可直接喂给 trace 评测。
4. 务必 `run.Close()`，以便刷新可能的异步写入。
5. 录制器只生产用例、不计算指标——拿到用例后配合 [`local`](./evaluation-local.md) 等示例再跑评测。

## 总结

evalsetrecorder 解决了"评测数据从哪来"的问题。把它和 [`trace`](./evaluation-trace.md) 评测、[`local`](./evaluation-local.md) 存储组合起来，就能形成"录制真实流量 → 沉淀 trace 用例 → 回归评测"的闭环。
