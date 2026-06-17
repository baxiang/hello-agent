# Agent 评测框架 - 全面评估智能体质量的系统化方案

## 概述

tRPC-Agent-Go 提供了一套完整的 Agent 评测框架，支持从评测集管理、指标定义、评测执行到结果存储的全流程自动化。该框架适用于回归测试、上线前质量把关、Prompt 调优等场景，帮助开发者科学地衡量和提升 Agent 的表现。

## 核心概念

评测框架围绕四大核心组件构建：

- **EvalSet（评测集）**：定义测试用例集合，每个用例包含用户输入、期望输出和工具调用轨迹。支持 `inmemory`（内存）和 `local`（本地文件）两种存储方式。
- **Metric（评测指标）**：定义评分标准和阈值，框架内置了多种评测准则（Criterion），包括 ROUGE 文本相似度、LLM 判别、工具轨迹匹配等。
- **Evaluator（评测器）**：执行评测逻辑的核心引擎，通过 `registry` 注册机制支持自定义评测器扩展。
- **EvalResult（评测结果）**：存储评测输出，包含每个用例的得分、状态和详细信息。

## 代码解析

### 基础评测流程

以 `local` 示例为例，展示最基本的评测搭建过程：

```go
// 1. 创建被评测的 Runner
runner := runner.NewRunner(appName, newCalculatorAgent(*modelName, *streaming))
defer runner.Close()

// 2. 初始化各管理器
evalSetManager := evalsetlocal.New(evalset.WithBaseDir(*dataDir))
metricManager := metriclocal.New(metric.WithBaseDir(*dataDir))
evalResultManager := evalresultlocal.New(evalresult.WithBaseDir(*outputDir))
registry := registry.New()

// 3. 创建评测器
agentEvaluator, _ := evaluation.New(
    appName, runner,
    evaluation.WithEvalSetManager(evalSetManager),
    evaluation.WithMetricManager(metricManager),
    evaluation.WithEvalResultManager(evalResultManager),
    evaluation.WithRegistry(registry),
    evaluation.WithNumRuns(*numRuns),
)
defer agentEvaluator.Close()

// 4. 执行评测
result, _ := agentEvaluator.Evaluate(ctx, *evalSetID)
```

框架遵循统一的"构建管理器 -> 创建评测器 -> 执行评测"三步模式，无论使用内存存储还是文件存储，接口保持一致。

### 内存评测集定义

`inmemory` 示例展示了如何通过代码直接构造评测集，适合单元测试场景：

```go
cases := []*evalset.EvalCase{
    {
        EvalID: "calc_add",
        Conversation: []*evalset.Invocation{{
            UserContent:   &model.Message{Role: model.RoleUser, Content: "calc add 2 3"},
            FinalResponse: &model.Message{Role: model.RoleAssistant, Content: "calc result: 5"},
            Tools: []*evalset.Tool{{
                Name:      "calculator",
                Arguments: map[string]any{"operation": "add", "a": 2.0, "b": 3.0},
                Result:    map[string]any{"result": 5.0},
            }},
        }},
    },
}
```

每个 `EvalCase` 包含完整的对话轨迹，可以验证最终回复和工具调用行为是否符合预期。

### 多种评测维度

框架的子目录覆盖了丰富的评测维度：

| 子目录 | 评测维度 | 说明 |
|--------|---------|------|
| `rouge/` | 文本相似度 | 基于 ROUGE 指标评估回复与参考答案的匹配度 |
| `llm/finalresponse/` | LLM 判别 | 使用 LLM 作为裁判评估最终回复质量 |
| `llm/hallucination/` | 幻觉检测 | 检测 Agent 回复中的事实错误 |
| `tooltrajectory/` | 工具轨迹 | 验证 Agent 是否按预期顺序调用了正确的工具 |
| `usersimulation/` | 用户模拟 | 使用模拟用户进行多轮对话评测 |
| `llmverifier/` | Best-of-N 验证 | 多次采样后通过 LLM 裁判选出最优回复 |
| `promptiter/` | Prompt 迭代优化 | 自动化 Prompt 调优，支持同步/异步执行 |

### 用户模拟评测

`usersimulation` 示例展示了高级多轮对话评测模式：

```go
userSimulator, _ := usersimulation.New(simRunner)
agentEvaluator, _ := evaluation.New(
    appName, actualRunner,
    evaluation.WithJudgeRunner(judgeRunner),
    evaluation.WithUserSimulator(userSimulator),
    // ...其他配置
)
```

该模式使用三个独立的 Runner：候选 Agent、模拟用户和裁判 Agent，实现端到端的自动化多轮对话评测。

## 运行方式

```bash
export OPENAI_API_KEY="sk-..."

# 本地文件存储评测
cd examples/evaluation/local
go run main.go -model deepseek-v4-flash -eval-set math-basic

# ROUGE 文本相似度评测
cd examples/evaluation/rouge
go run main.go -eval-set rouge-basic

# 工具轨迹评测
cd examples/evaluation/tooltrajectory
go run main.go -eval-set tooltrajectory-basic

# Prompt 迭代优化（同步模式）
cd examples/evaluation/promptiter/syncrun
go run main.go -max-rounds 4
```

预期输出包含每个测试用例的评测状态和分数：

```
Case calc_add -> PASSED
  Metric tool_trajectory_avg_score: score 1.00 (threshold 1.00) => PASSED
```

## 总结

tRPC-Agent-Go 的评测框架提供了从简单断言到复杂多轮对话评测的完整方案。关键收获：

- **统一接口**：所有评测维度共享相同的 Manager/Evaluator 抽象，便于组合使用
- **可扩展性**：通过 `registry` 机制可注册自定义评测器，适配任意业务场景
- **存储无关**：支持内存、本地文件、MySQL 等多种存储后端，灵活适配开发和生产环境
- **自动化闭环**：`promptiter` 子模块实现了评测驱动的 Prompt 自动优化，形成"评测-分析-优化"闭环

该模块与"进化篇"的 Evolution 功能互为补充：评测框架提供质量度量，Evolution 提供自动改进能力。
