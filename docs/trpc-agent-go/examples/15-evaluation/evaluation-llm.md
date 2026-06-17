# LLM-as-Judge 评测家族 - 用 LLM 裁判量化回复质量

> **源码路径**：[`trpc-agent-go/examples/evaluation/llm/`](../../../../trpc-agent-go/examples/evaluation/llm)
> **示例类型**：评测器（LLM 裁判准则） · **难度**：进阶
> **子变体**：6 个（`finalresponse` / `rubricresponse` / `knowledgerecall` / `hallucination` / `template` / `caselevelrubric`）

## 概述

`llm/` 目录下的 6 个子示例都用 **LLM 当裁判**对 Agent 回复打分，但各自聚焦不同质量维度：最终答案对齐、rubric 维度、知识召回、幻觉检测、自定义模板、用例级 rubric 绑定。它们共享同一套"四管理器 + 评测器"骨架，差异主要在指标文件（`.metrics.json`）里声明的 `evaluatorName` 和裁判配置。

与 [`rouge`](./evaluation-rouge.md)/[`jieba`](./evaluation-jieba.md)（确定性字面匹配）的区别：LLM 裁判能理解语义、容忍换述，但引入随机性与成本；与 [`tooltrajectory`](./evaluation-tooltrajectory.md) 的区别：那些校验行为，本家族校验文案质量。

## 核心概念

### 两种裁判注入方式

1. **judgeModel（写在指标 JSON）**：在 `.metrics.json` 的 `criterion.llmJudge.judgeModel` 里写死裁判模型与凭证（凭证用 `${JUDGE_MODEL_API_KEY}` 占位符展开）。`finalresponse` / `rubricresponse` / `knowledgerecall` / `caselevelrubric` 走这条路。
2. **judgeRunner（注入 Go 代码）**：用 `evaluation.WithJudgeRunner(judgeRunner)` 传入一个独立 Runner，指标文件不写模型配置。`hallucination` 走这条路，`template` 则用一个 `judgeModelMetricManager` 包装器在运行时覆盖裁判模型名。

### 共同骨架

每个子示例的 main.go 都是这一段（以 `finalresponse` 为例）：

```go
runner := runner.NewRunner(appName, newQAAgent(*modelName, *streaming))
evalSetManager := evalsetlocal.New(evalset.WithBaseDir(*dataDir))
metricManager := metriclocal.New(metric.WithBaseDir(*dataDir))
evalResultManager := evalresultlocal.New(evalresult.WithBaseDir(*outputDir))
registry := registry.New()
agentEvaluator, err := evaluation.New(appName, runner,
    evaluation.WithEvalSetManager(evalSetManager),
    evaluation.WithMetricManager(metricManager),
    evaluation.WithEvalResultManager(evalResultManager),
    evaluation.WithRegistry(registry),
)
result, err := agentEvaluator.Evaluate(ctx, *evalSetID)
```

## 六个子变体

### 1. finalresponse — 最终答案对齐

- 应用：`final-response-app`，EvalSet：`final-response-basic`，模型默认 `deepseek-v4-flash`
- 指标：`llm_final_response`，把 Agent 回复与参考答案对比打分
- 裁判：通过 `${JUDGE_MODEL_API_KEY}` / `${JUDGE_MODEL_BASE_URL}` 占位符注入
- 用途：最基础的"答案对不对"语义评测

### 2. rubricresponse — 多 rubric 维度评分

- 应用：`rubric-response-app`，EvalSet：`rubric-response-basic`
- 指标：`llm_rubric_response`，两条 rubric（正确性、相关性），3 个采样
- 用途：需要按多个维度分别打分的场景

### 3. knowledgerecall — 知识召回质量

- 应用：`knowledge-recall-app`，EvalSet：`knowledge-recall-basic`
- 指标：`llm_rubric_knowledge_recall`，校验召回的知识是否相关
- 特点：Agent 配检索工具 + 本地知识库（`knowledge/llm.md`），需 embedding 凭证
- 用途：RAG 类 Agent 的检索质量评测

### 4. hallucination — 幻觉检测

- 应用：`hallucination-eval-app`，EvalSet：`hallucination-basic`，模型默认 `gpt-5.4`
- 指标：`llm_hallucinations`，**通过 judgeRunner 注入**（非 JSON 配置）
- 机制：把最终答案切句，逐句检查是否被"捕获到的 grounding 上下文（工具调用 + 工具输出）"支撑，给出句子级通过率
- 特色：Agent 必须调本地 `product_catalog_lookup` 工具；`-force-hallucination` 切到脚本化 Agent，发出正确工具轨迹但故意说错事实，便于验证失败行为

```go
judgeRunner := runner.NewRunner(appName+"-judge", newJudgeAgent(*modelName))
agentEvaluator, err := evaluation.New(appName, actualRunner,
    ...
    evaluation.WithJudgeRunner(judgeRunner),
)
```

### 5. template — 自定义裁判模板

- 应用：`template-eval-app`，EvalSet：`template-basic`，模型默认 `gpt-5.2`
- 指标：`llm_judge_template`，含 `template.prompt` / `template.variableBindings`
- 两个打分器：`single_score` 和 `rubric_scores`
- 特色：用 `judgeModelMetricManager` 包装 metric 管理器，在 `Get` 时运行时覆盖裁判模型名（见 `main.go:109` 的 `overrideJudgeModelName`），实现"模型名不写死在 JSON"

### 6. caselevelrubric — 用例级 rubric 绑定

- 应用：`case-level-rubric-app`，EvalSet：`case-level-rubric-basic`
- 双指标：`tool_trajectory_avg_score`（工具） + `travel_answer_quality`（路由到 `llm_rubric_response`，拥有 rubric）
- 关键：用例里 `rubrics[0].metricName` 绑定到 `travel_answer_quality`（而非 trajectory），于是 case 级 rubric 只追加给 LLM rubric 指标，trajectory 指标照常跑
- 用途：演示同一 EvalSet 里"非 rubric 指标 + rubric 指标"共存，且 rubric 精准绑定的行为

## 运行方式

### 通用环境变量

| 变量 | 必需 | 说明 |
|------|------|------|
| `OPENAI_API_KEY` | 是 | Agent 模型 API Key |
| `OPENAI_BASE_URL` | 否 | Agent 模型端点 |
| `JUDGE_MODEL_API_KEY` | 多数子变体是 | 裁判模型 API Key（hallucination 用同一 `OPENAI_API_KEY`） |
| `JUDGE_MODEL_BASE_URL` | 否 | 裁判模型端点 |
| `OPENAI_EMBEDDING_API_KEY` | knowledgerecall 必需 | embedding 模型 Key |
| `OPENAI_EMBEDDING_BASE_URL` / `OPENAI_EMBEDDING_MODEL` | 否 | embedding 端点 / 模型（默认 `text-embedding-3-small`） |

### 通用命令行参数

| 参数 | 说明 |
|------|------|
| `-model` | Agent 模型 |
| `-streaming` | 是否流式 |
| `-data-dir` | EvalSet/Metric 目录（默认 `./data`） |
| `-output-dir` | 结果输出目录（默认 `./output`） |
| `-eval-set` | 要执行的 EvalSet ID |
| `-force-hallucination` | （仅 hallucination）强制错误回答以验证失败 |

### 运行命令示例

```bash
# finalresponse
cd examples/evaluation/llm/finalresponse
OPENAI_API_KEY=sk-... JUDGE_MODEL_API_KEY=sk-... go run . -eval-set final-response-basic

# rubricresponse
cd examples/evaluation/llm/rubricresponse
OPENAI_API_KEY=sk-... JUDGE_MODEL_API_KEY=sk-... go run . -eval-set rubric-response-basic

# knowledgerecall（额外需要 embedding key）
cd examples/evaluation/llm/knowledgerecall
OPENAI_API_KEY=sk-... JUDGE_MODEL_API_KEY=sk-... OPENAI_EMBEDDING_API_KEY=sk-... go run . -eval-set knowledge-recall-basic

# hallucination（裁判走 judgeRunner，复用 OPENAI_API_KEY）
cd examples/evaluation/llm/hallucination
OPENAI_API_KEY=sk-... go run . -eval-set hallucination-basic
OPENAI_API_KEY=sk-... go run . -force-hallucination -eval-set hallucination-basic   # 验证失败

# template
cd examples/evaluation/llm/template
go run . -eval-set template-basic

# caselevelrubric
cd examples/evaluation/llm/caselevelrubric
OPENAI_API_KEY=sk-... JUDGE_MODEL_API_KEY=sk-... go run . -eval-set case-level-rubric-basic
```

每个子示例结果写入对应的 `./output/<app>` 目录。

## 子变体选型对比

| 子变体 | 指标 | 裁判注入 | 适合场景 |
|--------|------|---------|---------|
| finalresponse | `llm_final_response` | judgeModel(JSON) | 答案语义对齐 |
| rubricresponse | `llm_rubric_response` | judgeModel(JSON) | 多维度打分 |
| knowledgerecall | `llm_rubric_knowledge_recall` | judgeModel(JSON) | RAG 检索质量 |
| hallucination | `llm_hallucinations` | judgeRunner(代码) | 事实幻觉检测 |
| template | `llm_judge_template` | 运行时覆盖 | 自定义裁判 prompt |
| caselevelrubric | `llm_rubric_response` + trajectory | judgeModel(JSON) | 用例级 rubric 绑定 |

## 关键要点

1. LLM-as-Judge 家族共享四管理器骨架，差异集中在 `.metrics.json` 的 `evaluatorName` 与裁判配置。
2. 裁判有两种注入：写死在 JSON（judgeModel + 占位符）或代码注入（`WithJudgeRunner`）。
3. `template` 演示了用 metric 管理器包装器在运行时改裁判模型，避免把模型名写进 JSON。
4. `hallucination` 把答案切句、对 grounding 上下文逐句核验，是"事实幻觉"而非"字面匹配"。
5. `caselevelrubric` 展示同一 EvalSet 多指标共存 + rubric 精准绑定到指定指标。

## 总结

llm 家族覆盖了"用 LLM 量化回复质量"的主流范式。需要确定性字面匹配时回到 [`rouge`](./evaluation-rouge.md)/[`jieba`](./evaluation-jieba.md)；需要校验工具行为时用 [`tooltrajectory`](./evaluation-tooltrajectory.md)；需要在线选优时看 [`llmverifier`](./evaluation-llmverifier.md)。
