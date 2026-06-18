# 用户模拟 + 期望 Runner - 候选与参考答案逐轮对比

> **源码路径**：[`trpc-agent-go/examples/evaluation/usersimulation_expectedrunner/`](../../../../trpc-agent-go/examples/evaluation/usersimulation_expectedrunner)
> **示例类型**：评测器（动态模拟 + 参考推理） · **难度**：进阶

## 概述

`usersimulation_expectedrunner/` 在 [`usersimulation`](./evaluation-usersimulation.md) 基础上引入第四个 Runner——**expected Runner（参考 Runner）**：先让 expected Runner 按 `conversationScenario` 驱动出一条对话 transcript，再把**相同的用户输入序列**回放到候选 Runner 上，最后用 `llm_rubric_critic` 把候选回复与 expected 回复逐轮对比。这是多轮对话评测里最严格的一种形态。

## 核心概念

### 四个 Runner

```go
actualRunner    := runner.NewRunner(appName, newCandidateTravelAgent(*modelName, *streaming))
expectedRunner  := runner.NewRunner(appName+"-expected", newReferenceTravelAgent(expectedModel, *expectedReasoningEffort))
simRunner       := runner.NewRunner(appName+"-sim", newSimulatorAgent(simulatorModel))
judgeRunner     := runner.NewRunner(appName+"-judge", newJudgeAgent(judgeModel, *judgeReasoningEffort))

userSimulator, err := usersimulation.New(simRunner)

agentEvaluator, err := evaluation.New(appName, actualRunner,
    evaluation.WithEvalSetManager(evalSetManager),
    evaluation.WithMetricManager(metricManager),
    evaluation.WithEvalResultManager(evalResultManager),
    evaluation.WithRegistry(registry),
    evaluation.WithExpectedRunner(expectedRunner),   // 参考 Runner
    evaluation.WithJudgeRunner(judgeRunner),         // 裁判
    evaluation.WithUserSimulator(userSimulator),     // 模拟用户
)
```

### driver=expected 的执行流程

EvalSet 开启 `expectedRunnerEnabled` 并把 `conversationScenario.driver` 设为 `expected`：

1. 框架先让 **expected Runner** 驱动场景，产出一条 transcript（用户输入序列 + expected 回复）。
2. 把**同一串用户输入**回放到 **候选 Runner**，得到候选回复。
3. 用 `llm_rubric_critic`（judgeRunner）逐轮对比候选 vs expected。
4. 生成的 `ExpectedInferences` 持久化进 EvalResult 的 `expectedInvocation.finalResponse`。

### 模型分层与回退

expected/judge 通常希望比候选更强，因此示例暴露独立的模型与 reasoning effort 参数，并用 `firstNonEmpty` 做回退：

```go
expectedModel  := firstNonEmpty(*expectedModelName, *modelName)
simulatorModel := firstNonEmpty(*simulatorModelName, *modelName)
judgeModel     := firstNonEmpty(*judgeModelName, expectedModel, *modelName)
```

## 代码解析

main 流程在 usersimulation 之上多挂 `WithExpectedRunner`，并按"expected 偏强"的实践分层配置模型。EvalSet 为 `business-trip-expected-runner`，指标为 `llm_rubric_critic`。

### 数据布局

```text
data/usersimulation_expectedrunner_app/
    ├── business-trip-expected-runner.evalset.json    # conversationScenario, driver=expected, expectedRunnerEnabled
    └── business-trip-expected-runner.metrics.json    # llm_rubric_critic
```

EvalResult 同时含 `actualInvocation` 和 `expectedInvocation`，每个 expected invocation 应有非空 `finalResponse`。

## 运行方式

### 环境变量

| 变量 | 必需 | 说明 | 默认值 |
|------|------|------|--------|
| `OPENAI_API_KEY` | 是 | 候选/expected/模拟/裁判共用 | — |
| `OPENAI_BASE_URL` | 否 | 端点 | `https://api.openai.com/v1` |

### 命令行参数

| 参数 | 说明 | 默认值 |
|------|------|--------|
| `-model` | 候选模型 | `gpt-5.4` |
| `-expected-model` | expected Runner 模型（空则回退 `-model`） | — |
| `-simulator-model` | 模拟器模型（空则回退 `-model`） | — |
| `-judge-model` | 裁判模型（空则回退 `-expected-model` 或 `-model`） | — |
| `-expected-reasoning-effort` | expected Runner 推理强度（空串禁用覆盖） | `medium` |
| `-judge-reasoning-effort` | 裁判推理强度（空串禁用覆盖） | `medium` |
| `-streaming` | 候选是否流式 | `false` |
| `-data-dir` | EvalSet/Metric 目录 | `./data` |
| `-output-dir` | 结果输出目录 | `./output` |
| `-eval-set` | 要执行的 EvalSet ID | `business-trip-expected-runner` |

### 运行命令

```bash
cd examples/evaluation/usersimulation_expectedrunner
export OPENAI_API_KEY="sk-..."

go run . -model gpt-5.4 -expected-model gpt-5.4 -judge-model gpt-5.4 \
  -data-dir ./data -output-dir ./output -eval-set business-trip-expected-runner
```

结果写入 `./output/usersimulation_expectedrunner_app`。

## 适用场景与对比

**选 usersimulation_expectedrunner 当：**
- 多轮对话需要"参考答案级"的严格对比
- 想让 expected Runner 用更强模型/reasoning 给出标杆
- 评测目标是"候选相对参考的差距"

| 维度 | 本示例 | usersimulation | local |
|------|------|------|------|
| Runner 数 | 4（候选/expected/模拟/裁判） | 3 | 1 |
| 对比方式 | llm_rubric_critic（候选 vs expected） | 仅 rubric | 固定答案 |
| 用户输入来源 | expected 驱动后回放 | 模拟器动态 | 固定 |

## 关键要点

1. expected Runner 先驱动场景生成 transcript，再把同一用户输入序列回放给候选。
2. `llm_rubric_critic` 逐轮对比候选 vs expected 的回复。
3. 模型/reasoning 分层：expected 与 judge 通常配更强配置，用 `firstNonEmpty` 回退。
4. EvalResult 同时保存 `actualInvocation` 和 `expectedInvocation`，可追溯每轮参考答案。

## 总结

这是动态多轮对话评测里最严格的形态。需要更轻量的多轮评测时回到 [`usersimulation`](./evaluation-usersimulation.md)；需要评测 Claude Code / Skill 这类外部 Agent 时，看 [`claudecode`](./evaluation-claudecode.md) 与 [`skill`](./evaluation-skill.md)。
