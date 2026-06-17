# 本地文件存储评测 - 最基础的评测流水线

> **源码路径**：[`trpc-agent-go/examples/evaluation/local/`](../../../../trpc-agent-go/examples/evaluation/local)
> **示例类型**：评测器（存储后端） · **难度**：入门

## 概述

`local/` 是评测框架最经典的入门示例，演示用**本地文件**承载 EvalSet、Metric、EvalResult 三类资产：用例与指标以 `.evalset.json` / `.metrics.json` 形式随源码管理，结果落盘为 `.evalset_result.json`，便于检查、版本化、对比回归。它的"四管理器 + 评测器"接线是绝大多数评测示例的共同骨架。

与 [`inmemory`](./evaluation-inmemory.md) 的核心区别：local 的用例/指标/结果**持久化在磁盘 JSON**，适合需要可复现、可 Review 的真实工程；inmemory 的用例/指标在**代码里运行时构造**，适合单测和快速试验。

## 核心概念

### 四管理器 + 评测器的统一接线

所有基于本地存储的评测示例（`local`、`rouge`、`tooltrajectory`、`trace`、`callbacks` 等）都遵循同一段接线：

```go
// 1. 被评测的 Runner
runner := runner.NewRunner(appName, newCalculatorAgent(*modelName, *streaming))
defer runner.Close()

// 2. 三个本地管理器 + 一个评测器注册表
evalSetManager := evalsetlocal.New(evalset.WithBaseDir(*dataDir))
metricManager := metriclocal.New(metric.WithBaseDir(*dataDir))
evalResultManager := evalresultlocal.New(evalresult.WithBaseDir(*outputDir))
registry := registry.New()

// 3. 创建评测器
agentEvaluator, err := evaluation.New(
    appName, runner,
    evaluation.WithEvalSetManager(evalSetManager),
    evaluation.WithMetricManager(metricManager),
    evaluation.WithEvalResultManager(evalResultManager),
    evaluation.WithRegistry(registry),
    evaluation.WithNumRuns(*numRuns),
)
defer agentEvaluator.Close()

// 4. 按 evalSetID 执行评测
result, err := agentEvaluator.Evaluate(ctx, *evalSetID)
```

local 版把 `*dataDir` 同时喂给 evalset/metric 管理器、把 `*outputDir` 喂给 evalresult 管理器，这正是"输入随源码、输出隔离"的典型布局。

## 代码解析

### main.go 主流程

`local/main.go:40` 的 `main()` 极其精简，只做三件事：解析 flag → 组装上述四件套 → 调 `Evaluate` 并打印摘要。被评测 Agent 是一个带 `calculator` 工具的 `llmagent`，对应 math-eval-app 应用。

### 数据布局

```text
data/
└── math-eval-app/
    ├── math-basic.evalset.json    # EvalSet：含 calc_add / calc_multiply 用例
    └── math-basic.metrics.json    # Metric：tool_trajectory_avg_score，阈值 1.0
```

`math-basic` 用例期望 Agent 调用 `calculator` 工具完成加法/乘法，指标用 `tool_trajectory_avg_score` 校验工具名、参数、结果是否匹配。这种"先调工具再回答"的轨迹是工具类 Agent 评测的标配。

## 运行方式

### 环境变量

| 变量 | 必需 | 说明 | 默认值 |
|------|------|------|--------|
| `OPENAI_API_KEY` | 是 | 模型 API Key | — |
| `OPENAI_BASE_URL` | 否 | 模型端点 | `https://api.openai.com/v1` |

### 命令行参数

| 参数 | 说明 | 默认值 |
|------|------|--------|
| `-model` | 被评测 Agent 使用的模型 | `deepseek-v4-flash` |
| `-streaming` | 是否流式输出 | `false` |
| `-data-dir` | 存放 `.evalset.json` / `.metrics.json` 的目录 | `./data` |
| `-output-dir` | 写入评测结果的目录 | `./output` |
| `-eval-set` | 要执行的 EvalSet ID | `math-basic` |
| `-runs` | 每个用例重复评测次数 | `1` |

### 运行命令

```bash
cd examples/evaluation/local
export OPENAI_API_KEY="sk-..."

go run . -eval-set math-basic -runs 1
```

### 预期输出

```log
✅ Evaluation completed with local storage
App: math-eval-app
Eval Set: math-basic
Overall Status: passed
Runs: 1
Case calc_add -> passed
  Metric tool_trajectory_avg_score: score 1.00 (threshold 1.00) => passed

Case calc_multiply -> passed
  Metric tool_trajectory_avg_score: score 1.00 (threshold 1.00) => passed

Results saved under: ./output
```

结果文件落盘到 `output/math-eval-app/math-eval-app_math-basic_<uuid>.evalset_result.json`。

## 适用场景与对比

**选 local 当：**
- 评测用例、指标需要随源码版本化、可 Code Review
- 需要可复现、可对比的回归基线
- 团队希望"改 JSON 即增改用例"，不重新编译

| 维度 | local（本文件） | inmemory | mysql |
|------|------|----------|-------|
| 用例来源 | 磁盘 `.evalset.json` | Go 代码运行时构造 | MySQL 表 `evaluation_eval_cases` |
| 指标来源 | 磁盘 `.metrics.json` | Go 代码构造 | MySQL 表 `evaluation_metrics` |
| 结果存储 | 磁盘 `.evalset_result.json` | 内存（可序列化打印） | MySQL 表 `evaluation_eval_set_results` |
| 适用场景 | 工程实践 / 回归基线 | 单元测试 / 快速试验 | 多人协作 / 生产持久化 |

## 关键要点

1. local 是理解整套评测框架的**入门模板**：四管理器 + 评测器的接线在几乎所有评测示例中重复出现。
2. 用例与指标分离成 `.evalset.json` / `.metrics.json` 两类文件，便于按 EvalSet 维度独立演进。
3. 输入目录（`-data-dir`）与输出目录（`-output-dir`）解耦，可把用例纳入 Git 而把结果排除。
4. 通过 `-runs N` 可对每个用例做多次重复评测，统计稳定性。

## 总结

掌握了 local 的四管理器接线，再去看 [`rouge`](./evaluation-rouge.md)、[`tooltrajectory`](./evaluation-tooltrajectory.md)、[`callbacks`](./evaluation-callbacks.md) 等同类示例会发现它们只是**换了 metric 文件和被评测 Agent**，骨架完全一致。需要切到内存或 MySQL 后端时，参考 [`inmemory`](./evaluation-inmemory.md) 与 [`mysql`](./evaluation-mysql.md)。
