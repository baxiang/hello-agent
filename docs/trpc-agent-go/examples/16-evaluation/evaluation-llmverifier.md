# LLM Verifier Best-of-N - 多次采样后让裁判选出最优回复

> **源码路径**：[`trpc-agent-go/examples/evaluation/llmverifier/`](../../../../trpc-agent-go/examples/evaluation/llmverifier)
> **示例类型**：Runner 选项（Best-of-N） · **难度**：进阶

## 概述

`llmverifier/` 不走标准评测流水线，而是演示 **Best-of-N 推理**：对同一 prompt 让 Agent 跑 N 次，每次产出候选回复，再用 `llm_verifier_pairwise` 指标 + LLM 裁判两两比较，**只输出最终的胜者**。这是"在线质量提升"而非"离线打分"——评测发生在推理过程中，直接决定用户看到的内容。

与其它评测示例的区别：那些是"跑完看分数"；llmverifier 是"边跑边选，把选择结果当答案"，通过 `bestofn.NewRunnerOption` 作为 Runner 选项注入，对调用方而言和普通 Runner 一样。

## 核心概念

### Best-of-N Runner 选项

```go
bestOfNOpt, err := bestofn.NewRunnerOption(
    bestofn.WithAttempts(*attempts),                          // 候选数 N
    bestofn.WithSelectionMode(bestofn.SelectionModePairwise), // 两两比较
    bestofn.WithEvalMetrics(llmVerifierMetric()),             // 裁判指标
    bestofn.WithJudgeRunner(judgeRunner),                     // 裁判 Runner
    bestofn.WithJudgeRunnerNumSamples(*judgeSamples),         // 每候选裁判采样数
)
r := runner.NewRunner(appName, newCandidateAgent(...), bestOfNOpt)
```

关键点：`bestofn.NewRunnerOption` 返回一个 `runner.RunnerOption`，挂在候选 Runner 上。Runner 内部会对每次 `Run` 自动做 N 次采样 + 裁判筛选。

### 裁判指标（metric.go）

`llm_verifier_pairwise` 指标，阈值 0.5，包含 4 条 rubric：

```go
return &metric.EvalMetric{
    MetricName: "llm_verifier_pairwise",
    Threshold:  0.5,
    Criterion: &criterion.Criterion{LLMJudge: &criterionllm.LLMCriterion{
        Rubrics: []*criterionllm.Rubric{
            {ID: "accuracy",         Content: &criterionllm.RubricContent{Text: "...准确满足请求，无臆测..."}},
            {ID: "conciseness",      Content: &criterionllm.RubricContent{Text: "...简洁、不超长..."}},
            {ID: "required_terms",   Content: &criterionllm.RubricContent{Text: "...包含用户明确要求的术语..."}},
            {ID: "clarity",          Content: &criterionllm.RubricContent{Text: "...易于目标受众理解..."}},
        },
    }},
}
```

### 流式缓存与重放

当候选 Agent 启用流式时，Best-of-N 会在内部**缓存所有候选事件**，只在裁判选定胜者后把胜者的事件重放出去——对调用方完全透明。

## 代码解析

`main.go` 构造候选 Agent（高 temperature 0.9 以制造多样性）和裁判 Runner（独立 Agent），然后 `runOnce` 调一次 `r.Run`，从事件流里取最终非 partial 的回复作为答案打印。

```go
fmt.Printf("Running %d candidate attempts and selecting with LLM verifier...\n", *attempts)
answer, err := runOnce(ctx, r, *prompt)
fmt.Println("Selected answer:")
fmt.Println(answer)
```

## 运行方式

### 命令行参数

| 参数 | 说明 | 默认值 |
|------|------|--------|
| `-model` | 候选模型 | `deepseek-v4-flash` |
| `-judge-model` | 裁判模型 | `deepseek-v4-flash` |
| `-base-url` | OpenAI 兼容端点 | — |
| `-api-key` | API Key | — |
| `-prompt` | 用户 prompt | 内置默认（解释 LLM-as-a-Verifier） |
| `-attempts` | 候选数 N | `3` |
| `-judge-samples` | 每候选裁判采样数 | `1` |
| `-max-tokens` | 候选最大输出 token | `512` |
| `-judge-max-tokens` | 裁判最大输出 token | `1200` |
| `-temperature` | 候选采样温度 | `0.9` |

> 注意：本示例用 `-base-url` / `-api-key` flag 而非环境变量传凭证。

### 运行命令

```bash
cd examples/evaluation
go run ./llmverifier \
  -model deepseek-v4-flash \
  -judge-model deepseek-v4-flash \
  -base-url "$OPENAI_BASE_URL" \
  -api-key "$OPENAI_API_KEY" \
  -attempts 3
```

自定义 prompt：

```bash
go run ./llmverifier -base-url "$OPENAI_BASE_URL" -api-key "$OPENAI_API_KEY" \
  -prompt "Explain LLM-as-a-Verifier for an online support agent in two bullets."
```

### 预期输出

```log
Prompt:
Explain LLM-as-a-Verifier for an online agent in no more than 120 words. ...

Running 3 candidate attempts and selecting with LLM verifier...

Selected answer:
<裁判选出的最优回复>
```

## 适用场景与对比

**选 llmverifier 当：**
- 想"在线"提升单次回复质量，而不是事后打分
- 可接受 N 倍推理成本换取更优答案
- 需要透明的流式体验（胜者重放）

| 维度 | llmverifier（本文件） | llm（finalresponse 等） |
|------|------|------|
| 角色 | 在线筛选（Best-of-N） | 离线打分 |
| 是否走标准评测流水线 | ❌（Runner 选项） | ✅ |
| 用户看到 | 裁判选的胜者 | 原始回复 + 事后分数 |
| 成本 | N 倍候选 + 裁判 | 1 次回复 + 裁判 |

## 关键要点

1. Best-of-N 通过 `bestofn.NewRunnerOption` 作为 Runner 选项注入，对调用方透明。
2. `SelectionModePairwise` 让裁判对候选两两比较选出胜者。
3. 裁判指标是带 rubric 的 `llm_verifier_pairwise`，阈值 0.5。
4. 流式模式下内部缓存候选、仅重放胜者事件。
5. 这是"在线质量提升"，与标准评测流水线的"离线打分"互补。

## 总结

llmverifier 是评测能力"前移到推理时"的范例。它和 [`llm`](./evaluation-llm.md) 家族共享同一套 rubric/裁判思想，但用途完全不同：前者用于生产时挑选最优回复，后者用于开发时量化 Agent 质量。
