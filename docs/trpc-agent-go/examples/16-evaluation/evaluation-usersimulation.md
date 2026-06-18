# 用户模拟评测 - 让模拟用户驱动多轮对话评测

> **源码路径**：[`trpc-agent-go/examples/evaluation/usersimulation/`](../../../../trpc-agent-go/examples/evaluation/usersimulation)
> **示例类型**：评测器（动态模拟） · **难度**：进阶

## 概述

`usersimulation/` 演示**动态用户模拟**：EvalSet 不再提供固定的多轮 `conversation`，而是用 `conversationScenario` 描述一个场景，由**模拟用户 Runner** 根据场景计划和候选 Agent 的最新回复，实时生成下一句用户发言。这样就能端到端评测多轮对话型 Agent，而不必人工标注每一轮。

示例用 `llm_rubric_response` 指标 + `evaluation.WithJudgeRunner(...)`，rubric 只写在指标文件里，裁判回复由独立的 judge Runner 运行时产出。

## 核心概念

### 三个独立 Runner

```go
actualRunner := runner.NewRunner(appName, newTravelPlannerAgent(*modelName, *streaming))
simRunner    := runner.NewRunner(appName+"-sim", newSimulatorAgent(*modelName))
judgeRunner  := runner.NewRunner(appName+"-judge", newJudgeAgent(*modelName))

userSimulator, err := usersimulation.New(simRunner)

agentEvaluator, err := evaluation.New(appName, actualRunner,
    evaluation.WithEvalSetManager(evalSetManager),
    evaluation.WithMetricManager(metricManager),
    evaluation.WithEvalResultManager(evalResultManager),
    evaluation.WithRegistry(registry),
    evaluation.WithJudgeRunner(judgeRunner),       // 裁判 Runner
    evaluation.WithUserSimulator(userSimulator),   // 用户模拟器
)
```

- **actualRunner**：被评测的候选 Agent（出行规划）
- **simRunner**：模拟用户，被 `usersimulation.New` 包装成 `userSimulator`
- **judgeRunner**：rubric 裁判

### 场景驱动的对话生成

`stopSignal` 和 `maxAllowedInvocations` 直接来自 EvalSet 文件（本示例不覆盖），模拟器据此决定何时结束对话。场景计划描述"用户想要什么"，模拟器在每一轮基于候选 Agent 的最新回复生成下一句用户输入。

## 代码解析

main 流程在标准四管理器基础上多了 `WithJudgeRunner` + `WithUserSimulator` 两个选项。EvalSet 为 `business-trip-scenario`，指标为 `llm_rubric_response`（仅 rubric 定义，无 `judgeModel` 条目）。

### 数据布局

```text
data/usersimulation-app/
    ├── business-trip-scenario.evalset.json    # 一个 conversationScenario 用例
    └── business-trip-scenario.metrics.json    # llm_rubric_response（仅 rubric 定义）
```

## 运行方式

### 环境变量

| 变量 | 必需 | 说明 | 默认值 |
|------|------|------|--------|
| `OPENAI_API_KEY` | 是 | 候选/模拟/裁判三个 Agent 共用 | — |
| `OPENAI_BASE_URL` | 否 | 端点 | `https://api.openai.com/v1` |

### 命令行参数

| 参数 | 说明 | 默认值 |
|------|------|--------|
| `-model` | 候选/模拟/裁判共用模型 | `gpt-5.4` |
| `-streaming` | 候选是否流式 | `false` |
| `-data-dir` | EvalSet/Metric 目录 | `./data` |
| `-output-dir` | 结果输出目录 | `./output` |
| `-eval-set` | 要执行的 EvalSet ID | `business-trip-scenario` |

### 运行命令

```bash
cd examples/evaluation/usersimulation
export OPENAI_API_KEY="sk-..."

go run . -model gpt-5.4 -data-dir ./data -output-dir ./output -eval-set business-trip-scenario
```

结果写入 `./output/usersimulation-app`，控制台打印总体状态与每用例得分。

## 适用场景与对比

**选 usersimulation 当：**
- 评测多轮对话 Agent，但不想人工标注每轮
- 希望对话内容随 Agent 表现动态演进（更真实的压力测试）

| 维度 | usersimulation（本文件） | usersimulation_expectedrunner | 固定 conversation（local） |
|------|------|------|------|
| 用户发言来源 | 模拟器动态生成 | 模拟器 + expected 驱动 | 固定标注 |
| Runner 数量 | 3（候选/模拟/裁判） | 4（+expected） | 1（候选） |
| 是否有参考答案 | ❌（仅 rubric） | ✅（expected 推理） | ✅ |

## 关键要点

1. 动态用户模拟用 `conversationScenario` + `usersimulation.New(simRunner)` 替代固定多轮对话。
2. 三个 Runner 分工：候选、模拟用户、rubric 裁判。
3. `stopSignal` / `maxAllowedInvocations` 来自 EvalSet，控制对话何时结束。
4. rubric 裁判通过 `WithJudgeRunner` 注入，指标文件只放 rubric 定义。

## 总结

usersimulation 适合"开放式多轮对话"评测。当需要把候选和参考答案逐轮对比时，升级到 [`usersimulation_expectedrunner`](./evaluation-usersimulation-expectedrunner.md)，它会引入第四个 expected Runner 并用 `llm_rubric_critic` 做更严格的对比。
