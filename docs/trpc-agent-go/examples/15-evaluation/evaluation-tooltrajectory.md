# 工具调用轨迹评测 - 校验 Agent 是否调对了工具

> **源码路径**：[`trpc-agent-go/examples/evaluation/tooltrajectory/`](../../../../trpc-agent-go/examples/evaluation/tooltrajectory)
> **示例类型**：评测器（轨迹准则） · **难度**：进阶

## 概述

`tooltrajectory/` 用 `tool_trajectory_avg_score` 指标校验 Agent **实际调用了哪些工具、参数和结果是否正确**，而不是看最终文案。示例是一个"出行助手"Agent，配备天气、新闻、时间、票务四个工具，期望它在回答出行建议前依次调齐这四类信息。

与 [`rouge`](./evaluation-rouge.md)/[`llm`](./evaluation-llm.md) 的区别：那些看"文字像不像"，trajectory 看"行为对不对"——这对工具型 Agent 才是真正该测的东西。

## 核心概念

### 多工具 + 顺序无关匹配

指标支持 `orderSensitive: false`（顺序无关）：Agent 调工具的先后可以变，只要工具名/参数/结果匹配即可。示例还演示了**按工具覆盖默认匹配策略**：对 `get_time` 忽略结果、对 `get_ticket` 忽略动态 `time` 字段，让带时间戳的轨迹在匹配时稳健。

### 被评测 Agent

`agent.go` 注册四个 function tool：

```go
weatherTool := function.NewFunctionTool(getWeather, function.WithName("get_weather"), ...)
newsTool    := function.NewFunctionTool(getNews,    function.WithName("get_news"), ...)
timeTool    := function.NewFunctionTool(getTime,    function.WithName("get_time"), ...)
ticketTool  := function.NewFunctionTool(getTicket,  function.WithName("get_ticket"), ...)

return llmagent.New("tooltrajectory-agent",
    llmagent.WithModel(openai.New(modelName)),
    llmagent.WithTools([]tool.Tool{weatherTool, newsTool, timeTool, ticketTool}),
    llmagent.WithInstruction(`Always call tools to answer: ... 用中文总结天气、提醒、票务与出行建议`),
    llmagent.WithGenerationConfig(genCfg),
)
```

`get_time` 返回当前 `time.RFC3339`、`get_ticket` 用入参时间——两者都含动态值，正好体现"需要按字段忽略"的匹配需求。

## 代码解析

main 流程是标准四管理器 + 评测器，EvalSet 为 `tooltrajectory-basic`（出行到上海，查天气/新闻/时间/票）。差异都在 `data/tooltrajectory-app/tooltrajectory-basic.metrics.json`：

- `criterion.toolTrajectory.orderSensitive: false`
- `defaultStrategy`：name/arguments/result 各自的 `matchStrategy`
- 按工具 override：忽略 `get_time` 结果、忽略 `get_ticket` 的 `time` 字段

## 运行方式

### 环境变量

| 变量 | 必需 | 说明 | 默认值 |
|------|------|------|--------|
| `OPENAI_API_KEY` | 是 | Agent 模型 API Key | — |
| `OPENAI_BASE_URL` | 否 | 模型端点 | `https://api.openai.com/v1` |

### 命令行参数

| 参数 | 说明 | 默认值 |
|------|------|--------|
| `-model` | 出行 Agent 模型 | `deepseek-v4-flash` |
| `-streaming` | 是否流式输出 | `false` |
| `-data-dir` | EvalSet/Metric 目录 | `./data` |
| `-output-dir` | 结果输出目录 | `./output` |
| `-eval-set` | 要执行的 EvalSet ID | `tooltrajectory-basic` |
| `-runs` | 每个用例重复评测次数 | `1` |

### 运行命令

```bash
cd examples/evaluation/tooltrajectory
export OPENAI_API_KEY="sk-..."

go run . -data-dir ./data -output-dir ./output -model gpt-4o-mini -eval-set tooltrajectory-basic
```

### 预期输出

```log
✅ Evaluation completed with tool trajectory example
App: tooltrajectory-app
Eval Set: tooltrajectory-basic
Overall Status: passed
Runs: 1
Case travel_alerts -> passed
  Metric tool_trajectory_avg_score: score 1.00 (threshold 1.00) => passed

Results saved under: ./output
```

产物：`output/tooltrajectory-app/tooltrajectory-app_tooltrajectory-basic_<run-id>.evalset_result.json`。

### 数据布局

```text
data/tooltrajectory-app/
    ├── tooltrajectory-basic.evalset.json    # 出行到上海的用例
    └── tooltrajectory-basic.metrics.json    # 顺序无关 + 按工具覆盖匹配策略
```

## 适用场景与对比

**选 tooltrajectory 当：**
- Agent 的价值在"调对工具"而非文案
- 需要容忍工具调用顺序波动
- 轨迹含动态字段（时间戳、随机 ID），需按字段忽略

| 维度 | tooltrajectory（本文件） | trace | rouge |
|------|------|------|------|
| 校验对象 | 工具调用名/参数/结果 | 预录 trace（工具 + 文案） | 文字字面 |
| 是否跑推理 | ✅（真实跑 Agent） | ❌（用预录 trace） | ✅ |
| 顺序敏感 | 可配（默认无关） | 可配 | — |

与 [`trace`](./evaluation-trace.md) 的关键差别：tooltrajectory 让 Agent **实时跑一遍**再比对轨迹；trace 直接拿**预录好的轨迹**做离线评测，不调用 Agent 模型。

## 关键要点

1. `tool_trajectory_avg_score` 是工具型 Agent 的核心指标，校验行为而非文案。
2. `orderSensitive: false` 容忍调用顺序波动；按工具 override 可忽略动态字段。
3. 匹配策略（exact 等）可对 name / arguments / result 分别配置。
4. 与 trace 模式互补：本示例跑实时推理，trace 评测预录数据。

## 总结

tooltrajectory 是"行为正确性"评测的代表。需要离线评测预录数据时看 [`trace`](./evaluation-trace.md)；需要同时校验文案时，可在同一 EvalSet 里叠加 [`llm`](./evaluation-llm.md) 类指标——[`caselevelrubric`](./evaluation-llm.md) 正演示了"trajectory + LLM rubric"双指标的组合。
