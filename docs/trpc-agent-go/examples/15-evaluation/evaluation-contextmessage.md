# ContextMessage 评测 - 注入上下文而不污染会话历史

> **源码路径**：[`trpc-agent-go/examples/evaluation/`](../../../../trpc-agent-go/examples/evaluation/contextmessage)
> **示例类型**：评测器（用例构造） · **难度**：进阶

## 概述

`contextmessage/` 演示为每个用例注入 `contextMessages`：这些 system/user/assistant 消息会**进入每一次模型请求**，但**不会写进 Session 历史**。这让评测可以临时给 Agent 塞入"你是谁""当前在什么环境"等上下文，而不污染会话 transcript。

示例用 `llm_final_response` 指标（LLM 裁判）校验 Agent 是否真的"记住"了注入的身份信息。

## 核心概念

### contextMessages 的语义

`contextMessages` 区别于普通对话消息：它对模型可见、对 Session 不可见。典型用法：

```json
{
  "evalId": "identity_name",
  "contextMessages": [
    { "role": "system", "content": "Your name is trpc-agent-go bot" }
  ]
}
```

这条 system 消息会让 Agent 在本轮回答时自称 `trpc-agent-go bot`，却不会出现在会话历史里——非常适合评测"Agent 在特定人设/环境下是否表现正确"。

### 双模型：Agent + 裁判

本示例同时需要被评测 Agent 和 LLM 裁判，因此两套 Key 都要：

- `OPENAI_API_KEY`：Agent 模型
- `JUDGE_MODEL_API_KEY`：`llm_final_response` 的裁判模型

## 代码解析

main 流程是标准四管理器 + 评测器，EvalSet 为 `contextmessage-basic`，指标用 `llm_final_response`。所有 contextMessages 都声明在用例 JSON 里：

```text
data/contextmessage-app/
    ├── contextmessage-basic.evalset.json    # 每个用例可带 contextMessages
    └── contextmessage-basic.metrics.json    # llm_final_response 指标
```

新增用例只需在 JSON 里加 `contextMessages`，或新建一个 eval-set ID 即可。

## 运行方式

### 环境变量

| 变量 | 必需 | 说明 | 默认值 |
|------|------|------|--------|
| `OPENAI_API_KEY` | 是 | Agent 模型 API Key | — |
| `OPENAI_BASE_URL` | 否 | Agent 模型端点 | `https://api.openai.com/v1` |
| `JUDGE_MODEL_API_KEY` | 是 | 裁判模型 API Key | — |
| `JUDGE_MODEL_BASE_URL` | 否 | 裁判模型端点 | `https://api.openai.com/v1` |

### 命令行参数

| 参数 | 说明 | 默认值 |
|------|------|--------|
| `-model` | Agent 模型 | `deepseek-v4-flash` |
| `-streaming` | 是否流式输出 | `false` |
| `-data-dir` | EvalSet/Metric 目录 | `./data` |
| `-output-dir` | 结果输出目录 | `./output` |
| `-eval-set` | 要执行的 EvalSet ID | `contextmessage-basic` |
| `-runs` | 每个用例重复评测次数 | `1` |

### 运行命令

```bash
cd examples/evaluation/contextmessage
export OPENAI_API_KEY="sk-..."
export JUDGE_MODEL_API_KEY="sk-..."

go run . -eval-set contextmessage-basic -runs 1
```

### 预期输出

```log
✅ Evaluation completed with local storage
App: contextmessage-app
Eval Set: contextmessage-basic
Overall Status: passed
Runs: 1
Case identity_name -> passed
  Metric llm_final_response: score 1.00 (threshold 1.00) => passed
```

结果文件：`output/contextmessage-app/contextmessage-app_contextmessage-basic_<uuid>.evalset_result.json`。

## 适用场景与对比

**选 contextmessage 当：**
- 评测需要给 Agent 设定临时人设/身份/环境
- 想注入 system 指令但不希望它长期留在会话历史
- 需要为同一 Agent 在不同上下文下跑差异化用例

| 维度 | contextmessage（本文件） | local（普通用例） | trace |
|------|------|------|------|
| 上下文注入 | 每用例 `contextMessages` | 仅对话本身 | 预录 trace |
| 是否进 Session 历史 | ❌ | ✅ | — |
| 指标 | llm_final_response | tool_trajectory_avg_score | 轨迹 + rubric |

## 关键要点

1. `contextMessages` 对模型可见、对 Session 不可见，适合临时人设/环境注入。
2. 用例 JSON 中按 EvalCase 维度声明，互不影响。
3. 配合 LLM 裁判指标（`llm_final_response`）可验证 Agent 是否真的"服从"了注入的上下文。
4. 需要同时配置 Agent 与裁判两套模型凭证。

## 总结

contextmessage 解决的是"评测时如何临时塑造 Agent 上下文"。结合 [`callbacks`](./evaluation-callbacks.md) 还能在评测各阶段插入自定义逻辑，进一步掌控评测流程。
