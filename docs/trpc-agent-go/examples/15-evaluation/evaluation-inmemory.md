# 内存存储评测 - 用代码直接构造评测集

> **源码路径**：[`trpc-agent-go/examples/evaluation/inmemory/`](../../../../trpc-agent-go/examples/evaluation/inmemory)
> **示例类型**：评测器（存储后端） · **难度**：入门

## 概述

`inmemory/` 把 EvalSet、Metric、EvalResult 三类资产**全部放在内存**里，用例和指标在 Go 代码里直接构造，不依赖任何磁盘文件。它最适合单元测试、CI 里跑的快速断言，以及想看评测器返回完整 JSON 结构的场景。

与 [`local`](./evaluation-local.md) 的区别：local 把用例/指标写成 JSON 文件、随源码管理；inmemory 完全在代码里 `Create` / `AddCase` / `Add`，结果也只存在内存管理器中（示例最后会把它序列化打印出来）。

## 核心概念

### 三类 inmemory 管理器

```go
evalSetManager := evalsetinmemory.New()
metricManager := metricinmemory.New()
evalResultManager := evalresultinmemory.New()
registry := registry.New()
```

其余接线（`evaluation.New(...)` + `Evaluate`）与 local 完全一致——评测器对存储后端是透明的，这就是存储无关性的体现。

### 用代码构造 EvalCase

`inmemory/main.go:131` 的 `prepareEvalSet` 用 `Create` 建 EvalSet、再逐个 `AddCase`：

```go
evalSetManager.Create(ctx, appName, evalSetID)
cases := []*evalset.EvalCase{
    {
        EvalID: "calc_add",
        Conversation: []*evalset.Invocation{{
            InvocationID: "calc_add-1",
            UserContent:   &model.Message{Role: model.RoleUser, Content: "calc add 2 3"},
            FinalResponse: &model.Message{Role: model.RoleAssistant, Content: "calc result: 5"},
            Tools: []*evalset.Tool{{
                ID:   "tool_use_1",
                Name: "calculator",
                Arguments: map[string]any{"operation": "add", "a": 2.0, "b": 3.0},
                Result:    map[string]any{"result": 5.0},
            }},
        }},
        SessionInput: &evalset.SessionInput{AppName: appName, UserID: "user"},
    },
    // calc_multiply 同理 ...
}
for _, evalCase := range cases {
    evalSetManager.AddCase(ctx, appName, evalSetID, evalCase)
}
```

### 用代码构造 Metric

`prepareMetric` 直接构造 `EvalMetric`，准则用默认的 `criterion.New()`（即 `tool_trajectory_avg_score`）：

```go
evalMetric := &metric.EvalMetric{
    MetricName: "tool_trajectory_avg_score",
    Threshold:  1.0,
    Criterion:  criterion.New(),
}
metricManager.Add(ctx, appName, evalSetID, evalMetric)
```

## 代码解析

`main()` 流程：建 runner → 建 inmemory 管理器 → `prepareEvalSet` / `prepareMetric` 填充数据 → 建 evaluator → `Evaluate` → `printSummary`。其中 `printSummary` 除了逐用例打印，还通过 `evalResultManager.List` + `Get` 把结果 JSON `MarshalIndent` 后整段输出，方便直接看到 EvalResult 的完整结构。

## 运行方式

### 环境变量

| 变量 | 必需 | 说明 | 默认值 |
|------|------|------|--------|
| `OPENAI_API_KEY` | 是 | 模型 API Key | — |
| `OPENAI_BASE_URL` | 否 | 模型端点 | `https://api.openai.com/v1` |

### 命令行参数

| 参数 | 说明 | 默认值 |
|------|------|--------|
| `-model` | 被评测 Agent 模型 | `deepseek-v4-flash` |
| `-streaming` | 是否流式输出 | `false` |
| `-runs` | 每个用例重复评测次数 | `1` |

注意：inmemory 示例**没有** `-data-dir` / `-output-dir` / `-eval-set` 参数——用例和指标都在代码里，结果也在内存。

### 运行命令

```bash
cd examples/evaluation/inmemory
export OPENAI_API_KEY="sk-..."

go run . -runs 1
```

### 预期输出

```log
✅ Evaluation completed
App: math-eval-app
Eval Set: math-basic
Overall Status: passed
Runs: 1
Case calc_add -> passed
  Metric tool_trajectory_avg_score: score 1.00 (threshold 1.00) => passed

Case calc_multiply -> passed
  Metric tool_trajectory_avg_score: score 1.00 (threshold 1.00) => passed

✅ Evaluation details:
{ ... 完整 EvalResult JSON ... }
```

## 适用场景与对比

**选 inmemory 当：**
- 在单元测试 / CI 中做断言，不希望产生磁盘文件
- 用例数据高度动态、由代码生成
- 想直接拿到 EvalResult 对象做进一步处理

| 维度 | inmemory（本文件） | local | mysql |
|------|------|------|-------|
| 用例构造 | Go 代码 `AddCase` | 磁盘 JSON | MySQL 表 |
| 文件产物 | 无 | `.evalset_result.json` | MySQL 行 |
| 是否可 Review | ❌（在代码里） | ✅ | ✅（需查库） |
| 典型用途 | 测试 / 演示 | 工程基线 | 多人协作 |

## 关键要点

1. inmemory 展示了评测框架的**存储无关性**：只需把三个 `local`/`mysql` 管理器换成 `inmemory`，其余代码不变。
2. `EvalCase` 在代码里构造时，`Conversation` 包含完整的 `UserContent` / `FinalResponse` / `Tools`，等价于一个迷你对话轨迹。
3. 结果管理器同样有 inmemory 实现，可通过 `List`/`Get` 取回后直接 `json.MarshalIndent` 查看。
4. 适合写 Go 单元测试，把"评测通过"作为断言条件。

## 总结

inmemory 是评测框架的"零依赖"形态，理解了它再去看 [`local`](./evaluation-local.md)（落盘）、[`mysql`](./evaluation-mysql.md)（数据库）就会非常自然——它们只是把同一套管理器接口换成了不同后端实现。
