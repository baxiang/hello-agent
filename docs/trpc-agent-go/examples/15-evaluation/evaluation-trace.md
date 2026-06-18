# Trace 离线评测 - 用预录轨迹评测，不跑推理

> **源码路径**：[`trpc-agent-go/examples/evaluation/trace/`](../../../../trpc-agent-go/examples/evaluation/trace)
> **示例类型**：评测器（轨迹模式） · **难度**：进阶

## 概述

`trace/` 用每个用例的 `evalMode = "trace"`，让评测服务**跳过 Runner 推理阶段**，直接把 `actualConversation`（预录的真实 trace）当作"实际表现"去评测。它的价值在于：你可以对**已经发生过**的对话离线打分，不必每轮都重新调用模型。

与 [`tooltrajectory`](./evaluation-tooltrajectory.md) 的关键区别：tooltrajectory 让 Agent 实时跑一遍再比对；trace 完全不跑 Agent，只用预录数据——所以 `OPENAI_*` 在 trace 模式下不真正调用，仍保留是为了和其它示例一致。

## 核心概念

### evalMode = "trace"

当 EvalCase 的 `evalMode` 为 `"trace"` 时，框架跳过 inference，直接用 `actualConversation` 作为实际轨迹。本示例在同一个 EvalSet 上挂了**两个指标**：

- `tool_trajectory_avg_score`：把 `actualConversation` 里的工具调用与 `conversation`（参考轨迹）比对。
- `llm_rubric_response`：用 LLM 裁判评判实际 trace 的**最终答案质量**，不依赖参考输出。

### trace 数据结构

`actualConversation` 里包含完整的预录 trace：用户提示、工具调用（工具调用 ID、工具名、入参、执行结果）、最终回复。`conversation` 提供期望输出（可选），作为工具轨迹比对的参考。

## 代码解析

main 流程与 [`local`](./evaluation-local.md) 完全相同——四管理器 + 评测器 + `Evaluate`。所有 trace 行为的差异都体现在 `data/trace-eval-app/` 的 JSON：

```text
data/trace-eval-app/
    ├── trace-basic.evalset.json    # evalMode=trace 的用例，含 actualConversation
    └── trace-basic.metrics.json    # tool_trajectory_avg_score + llm_rubric_response
```

## 运行方式

### 环境变量

| 变量 | 必需 | 说明 | 默认值 |
|------|------|------|--------|
| `OPENAI_API_KEY` | 否 | trace 模式不调用 Agent，保留以求一致 | — |
| `OPENAI_BASE_URL` | 否 | 同上 | `https://api.openai.com/v1` |
| `JUDGE_MODEL_API_KEY` | 是 | LLM 裁判（`llm_rubric_response`）需要 | — |
| `JUDGE_MODEL_BASE_URL` | 否 | 裁判模型端点 | `https://api.openai.com/v1` |

> trace 模式跳过推理，Agent 模型不会被调用；但 `llm_rubric_response` 仍需裁判模型。

### 命令行参数

| 参数 | 说明 | 默认值 |
|------|------|--------|
| `-model` | Agent 模型（trace 模式不调用） | `deepseek-v4-flash` |
| `-streaming` | 是否流式（trace 模式不调用） | `false` |
| `-data-dir` | EvalSet/Metric 目录 | `./data` |
| `-output-dir` | 结果输出目录 | `./output` |
| `-eval-set` | 要执行的 EvalSet ID | `trace-basic` |
| `-runs` | 每个用例重复评测次数 | `1` |

### 运行命令

```bash
cd examples/evaluation/trace
export JUDGE_MODEL_API_KEY="sk-..."

go run . -data-dir ./data -output-dir ./output -eval-set trace-basic
```

结果写入 `./output/trace-eval-app`。

## 适用场景与对比

**选 trace 当：**
- 要对线上/历史已发生的对话离线打分
- 不想为评测反复消耗模型调用
- 想同时校验工具轨迹和最终答案质量

| 维度 | trace（本文件） | tooltrajectory | callbacks |
|------|------|------|------|
| 是否跑 Agent 推理 | ❌（用预录 trace） | ✅ | ✅ |
| 校验维度 | 轨迹 + 文案 | 仅轨迹 | 任意（看挂的指标） |
| 模型消耗 | 仅裁判 | Agent + 可能的裁判 | Agent |
| 数据来源 | 预录 trace（可用 [`evalsetrecorder`](./evaluation-evalsetrecorder.md) 录制） | 实时生成 | 实时生成 |

trace 模式与录制器是天然搭档：用 [`evalsetrecorder`](./evaluation-evalsetrecorder.md) 开 `WithTraceModeEnabled(true)` 把真实流量录成 trace 用例，再用本示例离线评测。

## 关键要点

1. `evalMode = "trace"` 让评测**跳过推理**，用 `actualConversation` 作为实际表现。
2. 可在一个 EvalSet 内同时挂轨迹指标和 LLM 文案指标，离线覆盖"行为 + 质量"。
3. trace 模式下 Agent 模型不被调用，但 LLM 裁判指标仍需 `JUDGE_MODEL_API_KEY`。
4. 配合录制器可形成"录制真实流量 → 离线评测"的回归闭环。

## 总结

trace 是离线评测的基石。理解了"evalMode 控制是否跑推理"，再去看 [`tooltrajectory`](./evaluation-tooltrajectory.md)（在线跑 + 比轨迹）和 [`evalsetrecorder`](./evaluation-evalsetrecorder.md)（生产 trace 数据）就会非常清晰。
