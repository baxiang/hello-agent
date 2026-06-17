# 评测生命周期回调 - 在每个阶段插入自定义逻辑

> **源码路径**：[`trpc-agent-go/examples/evaluation/callbacks/`](../../../../trpc-agent-go/examples/evaluation/callbacks)
> **示例类型**：评测器（生命周期钩子） · **难度**：进阶

## 概述

`callbacks/` 注册了**评测全流程的 8 个生命周期钩子**，把每个阶段的入参打印出来，帮助理解框架"在什么时点给了你什么"。它是调试评测行为、接入监控/审计/自定义改写的入口。被评测对象是带 calculator 工具的 math Agent，指标用 `tool_trajectory_avg_score`。

与其它示例的区别：callbacks 不改变评测结果本身，而是**可观测性与扩展点**——你可以基于这些钩子做日志、指标上报、甚至篡改输入输出。

## 核心概念

### 8 个生命周期钩子

评测分两大阶段：**Inference（推理）** 和 **Evaluate（打分）**，各有 Set / Case 两个粒度的 Before/After：

| 阶段 | 钩子 | 触发时机 |
|------|------|---------|
| 推理 | `BeforeInferenceSet` | 整个 EvalSet 推理开始 |
| 推理 | `BeforeInferenceCase` | 单个用例推理开始（含 SessionID） |
| 推理 | `AfterInferenceCase` | 单个用例推理结束（含 Result） |
| 推理 | `AfterInferenceSet` | 整个 EvalSet 推理结束（含全部 Results） |
| 打分 | `BeforeEvaluateSet` | 整个 EvalSet 打分开始 |
| 打分 | `BeforeEvaluateCase` | 单个用例打分开始 |
| 打分 | `AfterEvaluateCase` | 单个用例打分结束（含 InferenceResult + Result） |
| 打分 | `AfterEvaluateSet` | 整个 EvalSet 打分结束 |

### 注册回调

`main.go` 用 `service.NewCallbacks()` 聚合回调，再用 `evaluation.WithCallbacks` 注入：

```go
callbacks := service.NewCallbacks().Register("logger", newLoggingCallback())
agentEvaluator, err := evaluation.New(
    appName, runner,
    evaluation.WithEvalSetManager(evalSetManager),
    evaluation.WithMetricManager(metricManager),
    evaluation.WithEvalResultManager(evalResultManager),
    evaluation.WithRegistry(registry),
    evaluation.WithNumRuns(*numRuns),
    evaluation.WithCallbacks(callbacks),   // 关键
)
```

每个 `Callback` 是一个结构体，字段就是各钩子函数（见 `main.go:72`）：

```go
return &service.Callback{
    BeforeInferenceSet: func(ctx context.Context, args *service.BeforeInferenceSetArgs) (*service.BeforeInferenceSetResult, error) {
        printCallbackArgs("BeforeInferenceSet", args)
        return nil, nil
    },
    // ... 其余 7 个同理
}
```

钩子返回的 `Result` 指针若非 nil，可用来改写流程；本示例一律返回 `nil` 仅做日志。

## 代码解析

`newLoggingCallback` 构造一个把入参 `json.Marshal` 后打印的回调；`printCallbackArgs(point, args)` 是通用打印器。被评测 Agent 是标准 calculator Agent，应用 `math-eval-app`，EvalSet `math-basic`。

## 运行方式

### 环境变量

| 变量 | 必需 | 说明 | 默认值 |
|------|------|------|--------|
| `OPENAI_API_KEY` | 是 | 模型 API Key | — |
| `OPENAI_BASE_URL` | 否 | 模型端点 | `https://api.openai.com/v1` |

### 命令行参数

| 参数 | 说明 | 默认值 |
|------|------|--------|
| `-model` | calculator Agent 模型 | `deepseek-v4-flash` |
| `-streaming` | 是否流式输出 | `false` |
| `-data-dir` | EvalSet/Metric 目录 | `./data` |
| `-output-dir` | 结果输出目录 | `./output` |
| `-eval-set` | 要执行的 EvalSet ID | `math-basic` |
| `-runs` | 每个用例重复评测次数 | `1` |

### 运行命令

```bash
cd examples/evaluation/callbacks
export OPENAI_API_KEY="sk-..."

go run . -eval-set math-basic -runs 1
```

### 预期输出

先逐阶段打印回调日志，最后打印评测摘要：

```log
[callback BeforeInferenceSet] args={"Request":{"appName":"math-eval-app","evalSetId":"math-basic"}}
[callback BeforeInferenceCase] args={"Request":{...},"EvalCaseID":"calc_add","SessionID":"da25bf57-..."}
[callback AfterInferenceCase] args={"Request":{...},"Result":{...},"Error":null}
[callback AfterInferenceSet] args={"Request":{...},"Results":[...],"Error":null}
[callback BeforeEvaluateSet] args={"Request":{...}}
[callback BeforeEvaluateCase] args={"Request":{...},"EvalCaseID":"calc_add"}
[callback AfterEvaluateCase] args={"Request":{...},"InferenceResult":{...},"Result":{...},"Error":null}
[callback AfterEvaluateSet] args={"Request":{...},"Result":{...},"Error":null}
✅ Evaluation completed with callbacks
...
Case calc_add -> passed
  Metric tool_trajectory_avg_score: score 1.00 (threshold 1.00) => passed
```

结果写入 `./output/math-eval-app`。

## 适用场景与对比

**选 callbacks 当：**
- 想看清评测框架内部时序、调试用例执行
- 需要在评测各阶段做监控上报、审计日志
- 打算在 Before/After 钩子里改写输入输出（返回非 nil Result）

| 维度 | callbacks（本文件） | local（无回调） |
|------|------|------|
| 可观测性 | 8 个阶段钩子 | 仅最终摘要 |
| 可扩展 | 可在钩子改写流程 | 无 |
| 适用 | 调试/监控/审计 | 标准跑评测 |

## 关键要点

1. 评测分 Inference / Evaluate 两阶段，各有 Set/Case 粒度的 Before/After，共 8 个钩子。
2. `service.NewCallbacks().Register(name, cb)` 聚合，`evaluation.WithCallbacks` 注入。
3. 钩子入参携带 Request、EvalCaseID、SessionID、Result、Error 等丰富上下文。
4. 返回非 nil 的 Result 可用于改写流程（本示例仅做日志返回 nil）。

## 总结

callbacks 是评测框架的"可观测性与扩展中枢"。把它和 [`contextmessage`](./evaluation-contextmessage.md)、[`trace`](./evaluation-trace.md) 组合，可以精细掌控"何时、以什么上下文、跑哪个用例、得到什么结果"。
