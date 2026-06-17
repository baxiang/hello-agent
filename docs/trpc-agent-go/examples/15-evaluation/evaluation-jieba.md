# 结巴分词 ROUGE 评测 - 注册中文自定义分词器

> **源码路径**：[`trpc-agent-go/examples/evaluation/jieba/`](../../../../trpc-agent-go/examples/evaluation/jieba)
> **示例类型**：评测器（确定性准则 + 自定义注册） · **难度**：进阶

## 概述

`jieba/` 演示如何通过 `evaluation.WithMetricRegistry(...)` 注册一个**自定义 ROUGE 分词器**（结巴/Jieba），在中文改写场景下用 ROUGE-1 F1 评测。它解决 [`rouge`](./evaluation-rouge.md) 的痛点：中文没有空格，按字面切词会让 ROUGE 严重失真；引入结巴分词后，匹配才贴近真实语义边界。

本示例依赖 CGO（`gojieba`），并提供 cgo / nocgo 两套构建文件。

## 核心概念

### 通过 MetricRegistry 注册分词器

`main_cgo.go` 关键三步：

```go
segmenter := gojieba.NewJieba()
defer segmenter.Free()

metricRegistry := metricregistry.New()
if err := metricRegistry.RegisterRougeTokenizer("jieba", jiebaTokenizer{segmenter: segmenter}); err != nil {
    return err
}

agentEvaluator, err := evaluation.New(
    appName, run,
    evaluation.WithEvalSetManager(evalSetManager),
    evaluation.WithMetricManager(metricManager),
    evaluation.WithEvalResultManager(evalResultManager),
    evaluation.WithRegistry(evaluatorRegistry),
    evaluation.WithMetricRegistry(metricRegistry),  // 关键：注入 metric registry
    evaluation.WithNumRuns(*numRuns),
)
```

指标文件里声明 `tokenizerName: "jieba"`，框架运行时就通过这个名字解析到注册的实现——这是"名字 + 注册表"解耦的典型用法。

### 实现 Tokenize 接口

```go
type jiebaTokenizer struct {
    segmenter *gojieba.Jieba
}

func (t jiebaTokenizer) Tokenize(text string) []string {
    segments := t.segmenter.Cut(text, true)   // HMM 精确模式
    tokens := make([]string, 0, len(segments))
    for _, segment := range segments {
        segment = strings.TrimSpace(segment)
        if segment != "" {
            tokens = append(tokens, segment)
        }
    }
    return tokens
}
```

### CGO 构建标签

- `main_cgo.go`：`//go:build cgo`，含真正实现。
- `main_nocgo.go`：`//go:build !cgo`，直接返回错误 `"the jieba example requires cgo; rebuild with CGO_ENABLED=1"`。

## 代码解析

被评测 Agent（`agent.go`）被指令"把中文改写成一句意思相近的中文"，`MaxTokens: 64`、`Temperature: 0.0`。EvalSet 用例：

- 输入：`今天天气很好，我们一起去公园散步。`
- 期望：`天气不错，一起去公园散步吧`
- 指标：`final_response_avg_score`，`finalResponse.rouge`，rouge1 / f1，阈值 precision 0.3 / recall 0.6 / f1 0.4。

## 运行方式

### 前置条件

`gojieba` 使用 CGO，需 `CGO_ENABLED=1` 并具备 C/C++ 工具链。

### 环境变量

| 变量 | 必需 | 说明 | 默认值 |
|------|------|------|--------|
| `OPENAI_API_KEY` | 是 | 模型 API Key | — |
| `OPENAI_BASE_URL` | 否 | 模型端点 | `https://api.openai.com/v1` |

### 命令行参数

| 参数 | 说明 | 默认值 |
|------|------|--------|
| `-data-dir` | EvalSet/Metric 目录 | `./data` |
| `-output-dir` | 结果输出目录 | `./output` |
| `-eval-set` | 要执行的 EvalSet ID | `jieba-rouge-zh` |
| `-model` | 改写 Agent 模型 | `gpt-5.2` |
| `-streaming` | 是否流式输出 | `false` |
| `-runs` | 每个用例重复评测次数 | `1` |

### 运行命令

```bash
cd examples/evaluation/jieba
export OPENAI_API_KEY="sk-..."
export CGO_ENABLED=1

go run . -eval-set jieba-rouge-zh -runs 1
```

### 预期输出

```log
✅ Evaluation completed with ROUGE criterion
App: jieba-eval-app
Eval Set: jieba-rouge-zh
Overall Status: passed
Runs: 1
Case rewrite-weather -> passed
  Metric final_response_avg_score: score 1.00 (threshold 1.00) => passed

Results saved under: ./output
```

详细 actual/expected 与指标明细存于 `output/jieba-eval-app/*.evalset_result.json`。

### 数据布局

```text
data/jieba-eval-app/
    ├── jieba-rouge-zh.evalset.json
    └── jieba-rouge-zh.metrics.json   # tokenizerName: "jieba"
output/jieba-eval-app/
    └── *.evalset_result.json
```

## 适用场景与对比

**选 jieba 当：**
- 评测中文回复，且答案有参考文本
- 不想引入 LLM 裁判，追求可复现

| 维度 | jieba（本文件） | rouge | llm（finalresponse） |
|------|------|------|------|
| 分词 | 结巴中文分词 | 按空格/默认 | 不需要（语义判断） |
| 语言 | 中文 | 英文为主 | 任意 |
| CGO | 需要 | 不需要 | 不需要 |
| 随机性 | 无 | 无 | 有 |

## 关键要点

1. 自定义 ROUGE 分词器通过 `evaluation.WithMetricRegistry` + `RegisterRougeTokenizer(name, impl)` 注册。
2. 指标文件用 `tokenizerName` 引用注册名，实现"声明与代码解耦"。
3. 中文必须用真正分词器，否则 ROUGE 按空格切词会严重失真。
4. 依赖 CGO；无 CGO 时构建会走到 nocgo 桩函数并报清晰错误。

## 总结

jieba 展示了评测框架的**可扩展注册机制**：名字写在 JSON、实现注册在代码。理解了这套机制，再去看 [`rouge`](./evaluation-rouge.md)（内置分词）和 [`llm`](./evaluation-llm.md)（LLM 裁判）就更容易把握它们各自的位置。
