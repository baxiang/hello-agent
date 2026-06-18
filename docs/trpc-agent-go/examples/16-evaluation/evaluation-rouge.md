# ROUGE 文本相似度评测 - 确定性的字面匹配

> **源码路径**：[`trpc-agent-go/examples/evaluation/rouge/`](../../../../trpc-agent-go/examples/evaluation/rouge)
> **示例类型**：评测器（确定性准则） · **难度**：入门

## 概述

`rouge/` 演示 `final_response_avg_score` 指标 + `finalResponse.rouge` 准则：把 Agent 最终回复与参考答案做 ROUGE 打分，**当 ROUGE 分数达到阈值时记 match=1，否则 mismatch=0**。它完全确定、可复现，不需要 LLM 裁判，适合"答案相对固定、看重字面命中"的评测。

与 [`llm`](./evaluation-llm.md) 家族的对比：llm 类用 LLM 当裁判打主观分；rouge 用字面 n-gram 重叠，零成本、零随机性。中文场景下用字面 ROUGE 容易被分词拖累，应改用 [`jieba`](./evaluation-jieba.md)。

## 核心概念

### ROUGE 准则的工作方式

评测器对每个用例输出确定性的 0/1：

- 命中阈值 → `score = 1.00`（passed）
- 未命中 → `score = 0.00`（failed）

ROUGE 的 precision 对冗余、Markdown、额外格式高度敏感，因此示例刻意把 Agent 指令压成**一句纯文本**（见 `agent.go`）：

```go
const rougeAgentInstruction = "Answer in exactly one short sentence of plain text. " +
    "Do not use markdown, lists, or code formatting. Output only the answer."
```

配合 `MaxTokens: 64`、`Temperature: 0.0`，让输出尽量短且稳定。

### 接线与 local 一致

rouge 的 main 流程与 [`local`](./evaluation-local.md) 完全相同（四管理器 + 评测器），差异只在：
- 应用名 `rouge-app`、EvalSet `rouge-basic`
- 指标文件里用的是 `finalResponse.rouge` 准则（在 `.metrics.json` 中声明 ROUGE 类型、阈值）

## 代码解析

`main.go` 调用 `newRougeAgent`（一个最简 `llmagent`），其余走标准评测流水线。真正的 ROUGE 配置（ROUGE-1/2/L、precision/recall/f1、阈值）都在 `data/rouge-app/rouge-basic.metrics.json` 里声明，代码无需感知细节。

### 数据布局

```text
data/
└── rouge-app/
    ├── rouge-basic.evalset.json    # 含 QA 用例与期望答案
    └── rouge-basic.metrics.json    # final_response_avg_score + finalResponse.rouge 准则
```

## 运行方式

### 环境变量

| 变量 | 必需 | 说明 | 默认值 |
|------|------|------|--------|
| `OPENAI_API_KEY` | 是 | 模型 API Key | — |
| `OPENAI_BASE_URL` | 否 | 模型端点 | `https://api.openai.com/v1` |

### 命令行参数

| 参数 | 说明 | 默认值 |
|------|------|--------|
| `-model` | 被评测 Agent 模型 | `gpt-5.2` |
| `-streaming` | 是否流式输出 | `false` |
| `-data-dir` | EvalSet/Metric 目录 | `./data` |
| `-output-dir` | 结果输出目录 | `./output` |
| `-eval-set` | 要执行的 EvalSet ID | `rouge-basic` |
| `-runs` | 每个用例重复评测次数 | `1` |

### 运行命令

```bash
cd examples/evaluation/rouge
export OPENAI_API_KEY="sk-..."

go run . -eval-set rouge-basic -runs 1
```

### 预期输出

```log
✅ Evaluation completed with ROUGE criterion
App: rouge-app
Eval Set: rouge-basic
Overall Status: passed
Runs: 1
Case <case-id> -> passed
  Metric final_response_avg_score: score 1.00 (threshold 1.00) => passed

Results saved under: ./output
```

结果写入 `./output/rouge-app`。

## 适用场景与对比

**选 rouge 当：**
- 参考答案相对固定（事实问答、固定话术）
- 想要零成本、完全可复现的回归基线
- 评测英文或分词明确的文本

| 维度 | rouge（本文件） | jieba | llm（finalresponse 等） |
|------|------|-------|------|
| 打分主体 | ROUGE n-gram 重叠 | 结巴分词后的 ROUGE | LLM 裁判 |
| 随机性 | 无 | 无 | 有（受采样影响） |
| 成本 | 零（不调 LLM 评分） | 零 | 每用例多次调用 LLM |
| 适合语言 | 英文/空格分词 | 中文 | 任意 |
| 主观语义 | ❌ | ❌ | ✅ |

## 关键要点

1. ROUGE 准则是**确定性**的 0/1 匹配，结果完全可复现，适合做回归门槛。
2. ROUGE precision 对冗长和格式敏感，务必把 Agent 输出约束成短句纯文本。
3. 评测器对 ROUGE 配置无感知，所有 ROUGE 类型/阈值都在 `.metrics.json` 里声明。
4. 中文应改用 [`jieba`](./evaluation-jieba.md) 注册中文分词器，避免按空格切词导致失真。

## 总结

rouge 是"确定性字面匹配"的入门示例。需要语义主观打分时切到 [`llm`](./evaluation-llm.md)；需要中文场景时切到 [`jieba`](./evaluation-jieba.md)；需要校验工具调用顺序时切到 [`tooltrajectory`](./evaluation-tooltrajectory.md)。
