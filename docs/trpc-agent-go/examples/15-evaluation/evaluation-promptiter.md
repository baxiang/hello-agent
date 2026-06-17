# PromptIter 提示词优化 - 评测驱动的自动调优工作流

> **源码路径**：[`trpc-agent-go/examples/evaluation/promptiter/`](../../../../trpc-agent-go/examples/evaluation/promptiter)
> **示例类型**：评测工作流（自动优化） · **难度**：进阶
> **子变体**：4 个（`syncrun` / `asyncrun` / `server` / `multinode`）

## 概述

`promptiter/` 不只是"打分"，而是**评测驱动的自动 Prompt 优化**：给定一份弱 seed 指令、train/validation 评测集和裁判，PromptIter 循环地"评估 → 反向归因 → 聚合梯度 → 优化指令 → 再评估"，只在 validation 分数确实提升时才接受 patch。4 个子变体用同一套"体育战报"业务，展示了同步、异步、HTTP、多节点四种运行形态。

与其它评测示例的区别：那些是"评一次看分数"；PromptIter 是"评-改-再评"的闭环，把评测当作优化的目标函数。

## 核心概念

### PromptIter 五大角色

| 角色 | 作用 |
|------|------|
| 候选 Agent | 用当前指令跑 train/validation 用例 |
| 裁判（judge） | 给候选输出打分（共享 rubric 指标） |
| Backwarder | 反向归因：分析失败用例，定位指令缺陷 |
| Aggregator | 聚合多个目标表面的"梯度" |
| Optimizer | 据聚合结果产出新指令 patch |

引擎由 `promptiterengine.New(ctx, candidateAgent, evaluator, backwarder, aggregator, optimizer)` 组装。

### 接受策略与停止策略

- `AcceptancePolicy.MinScoreGain`：validation 分数提升至少多少才接受 patch（默认 `0.01`）。
- `StopPolicy.MaxRoundsWithoutAcceptance`：连续多少轮未接受即停（默认 `3`）。
- `StopPolicy.TargetScore`：达到目标分即停（默认 `1.0`）。
- `MaxRounds`：最大轮数（默认 `4`）。

### 共同业务：体育战报

候选 seed 指令故意写得很弱：

```text
生成一篇中文体育战报
```

train/validation 各 8 条用例，输入是结构化比赛 JSON，参考输出是固定可发布的中文战报（静态 gold，保证可复现）。共享 metric 文件用内置 final-response 评长度 + 多条 rubric（事实落地、数字精度、术语、关键序列、标题、中文体育文案）。

## 四个子变体

### 1. syncrun — 同步单 Agent

- 应用：`promptiter-nba-commentary-app`
- 形态：直接 `engine.Run` 跑完整循环
- 优化表面：单个 `candidate#instruction`
- `main.go` 解析 flag → `runSyncRunExample` → `buildPromptIterRuntime` 组装引擎 → `engine.Run(buildRunRequest(...))`
- 特点：最简单的同步单 Agent 入门示例

```go
targetSurfaceID := astructure.SurfaceID(candidateAgentName, astructure.SurfaceTypeInstruction)
result, err := runtime.engine.Run(ctx, buildRunRequest(cfg, targetSurfaceID))
```

### 2. asyncrun — 异步单 Agent

- 应用：同 syncrun
- 形态：`manager.Start` + `manager.Get` 轮询
- 多了 `-poll-interval`（默认 `1s`）
- 打印进度快照（当前轮次/阶段），最终摘要与 syncrun 一致

### 3. server — HTTP 控制面

- 形态：`server/promptiter` 暴露 HTTP 控制面
- 端点（base `/promptiter/v1/apps`）：
  - `GET .../structure`（解析可编辑表面）
  - `POST .../runs`（阻塞式）
  - `POST .../async-runs` + `GET .../async-runs/{id}` + `POST .../async-runs/{id}/cancel`
- 模型默认值可经 `CANDIDATE_MODEL_NAME` / `JUDGE_MODEL_NAME` / `WORKER_MODEL_NAME` 环境变量覆盖
- 附 `client.py`（仅用标准库）：解析 surface、提交 run、轮询进度、打印摘要

### 4. multinode — 多节点图

- 应用：`promptiter-sports-recap-agent`
- 候选是混合图：函数节点 + AgentNode 扇出/扇入

```text
prepare_game_input
   ├── headline_agent
   ├── highlights_agent
   └── stats_angle_agent
        ↓
join_recap_parts
        ↓
recap_writer
        ↓
sports_editor
```

- 同时优化 5 个 AgentNode 指令表面（`headline_agent#instruction` 等）
- 用 `manager.Start` + `waitForRun` 轮询

## 运行方式

### 环境变量

| 变量 | 必需 | 说明 | 默认值 |
|------|------|------|--------|
| `OPENAI_API_KEY` | 是 | OpenAI 兼容端点 Key | — |
| `OPENAI_BASE_URL` | 否 | 端点 | `https://api.openai.com/v1` |
| `CANDIDATE_MODEL_NAME` | server 可选 | 候选模型 | `deepseek-v3.2` |
| `JUDGE_MODEL_NAME` | server 可选 | 裁判模型 | `gpt-5.2` |
| `WORKER_MODEL_NAME` | server 可选 | worker 模型 | `gpt-5.2` |

### 通用 flag（syncrun / asyncrun / multinode）

| flag | 说明 | 默认值 |
|------|------|--------|
| `-model` | 候选模型 | `deepseek-v3.2` |
| `-candidate-instruction` | seed 指令 | `生成一篇中文体育战报` |
| `-judge-model` | 裁判模型 | `gpt-5.2` |
| `-worker-model` | worker 模型 | `gpt-5.2` |
| `-max-rounds` | 最大轮数 | `4` |
| `-min-score-gain` | 接受 patch 的最小提升 | `0.01` |
| `-max-rounds-without-acceptance` | 连续未接受即停 | `3` |
| `-target-score` | 目标分即停 | `1.0` |
| `-eval-case-parallelism` | 用例并发 | `16` |
| `-parallel-inference` / `-parallel-evaluation` | 推理/评测并发开关 | `true`/`true` |
| `-parallel-backward` / `-parallel-aggregation` / `-parallel-optimization` | 各阶段并发开关 | `false`/`true`/`true` |
| `-debug-io` | 打印各组件 IO | `false` |
| `-poll-interval` | （asyncrun/multinode）轮询间隔 | `1s` / `30s` |

> 阶段并发 flag 为 `0` 且对应 `-parallel-*` 开启时，该阶段用 `GOMAXPROCS`。

### 运行命令

```bash
# syncrun
cd examples/evaluation/promptiter/syncrun
export OPENAI_BASE_URL="..." OPENAI_API_KEY="..."
go run . -model deepseek-v3.2 -judge-model gpt-5.2 -worker-model gpt-5.2

# asyncrun
cd examples/evaluation/promptiter/asyncrun
go run . -model deepseek-v3.2 -judge-model gpt-5.2 -worker-model gpt-5.2

# multinode
cd examples/evaluation/promptiter/multinode
go run .

# server
cd examples/evaluation/promptiter/server
go run . -addr ":8080" -base-path "/promptiter/v1/apps"
python3 client.py            # 默认异步流程
```

### 典型结果（syncrun run.log）

```text
Initial instruction: "生成一篇中文体育战报"
Initial validation score: 0.37
Final accepted validation score: 0.85
Rounds executed: 4
Round 1 -> train 0.40, validation 0.85, accepted true,  delta 0.48
Round 2 -> train 0.82, validation 0.82, accepted false, delta -0.03
...
```

## 子变体选型对比

| 子变体 | 形态 | 优化表面 | 适合 |
|--------|------|---------|------|
| syncrun | `engine.Run` | 单个 | 最简同步入门 |
| asyncrun | `manager.Start/Get` | 单个 | 异步生命周期管理 |
| server | HTTP 控制面 | 单个 | 远程触发 / 平台化 |
| multinode | `manager.Start` | 5 个 AgentNode | 多表面、复杂候选图 |

## 关键要点

1. PromptIter 把评测当作优化的目标函数，"评估 → 反向 → 聚合 → 优化 → 再评估"。
2. 仅在 validation 分数提升超过 `MinScoreGain` 时接受 patch，保证不退化。
3. 四子变体共享业务与数据，只是运行形态不同：同步 / 异步 / HTTP / 多节点。
4. 静态 gold 答案 + 共享 rubric 让多次运行可比对、可复现。
5. multinode 演示同时优化图里多个 AgentNode 的指令表面。

## 总结

PromptIter 是评测框架的"高阶应用"：从度量质量走向自动改进质量。理解了它，就理解了"评测-分析-优化"闭环如何在一个框架内落地。
