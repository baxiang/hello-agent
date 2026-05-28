# 04 - Streaming、Observability 与 Evals

生产 Agent 不只要能返回答案，还要能解释运行过程、追踪失败、控制成本，并用评估体系防止行为回退。本章覆盖流式体验、Logfire/OpenTelemetry 和 Pydantic Evals。

## 1. 为什么需要流式

流式输出解决两个问题：

- 用户体验：长答案不用等到最后才看到。
- 运行可见性：可以展示工具调用、阶段性状态或生成中的文本。

适合流式的场景：

- 长报告生成。
- Markdown 文档生成。
- 代码审查报告。
- 多工具调用的 Agent。
- 交互式 UI。

不一定需要流式：

- 简短分类。
- JSON 决策。
- 后台批处理。

## 2. 流式设计原则

流式不是把文本一块块吐出去这么简单。

要考虑：

- UI 如何处理 partial output。
- 最终 structured output 如何校验。
- 工具调用期间展示什么。
- 中途失败如何显示。
- 用户取消如何传递。
- 日志如何关联同一次 run。

基本策略：

```text
Start run
  -> emit status: thinking
  -> emit tool call event
  -> emit partial text
  -> emit final output
  -> persist result and trace id
```

## 3. Observability

Agent 生产问题通常不是“代码崩了”这么简单，而是：

- 模型输出质量下降。
- 工具调用变慢。
- token 成本上升。
- 某个 provider 错误率升高。
- schema 校验失败变多。
- prompt injection 导致异常行为。

所以要记录：

- trace id。
- agent name。
- model。
- prompt/input 摘要。
- output schema version。
- tool calls。
- latency。
- usage/cost。
- validation errors。
- retry count。

## 4. Logfire 和 OpenTelemetry

Pydantic AI 与 Pydantic Logfire 紧密集成，并可使用 OpenTelemetry 生态。Logfire 适合：

- 查看 LLM 调用链路。
- 查看工具调用。
- 分析成本和延迟。
- 调试校验失败。
- 观察 evals 结果。

如果团队已有 OTel backend，也可以把 trace 发到现有系统。

## 5. Evals 是什么

Evals 用来系统评估 Agent 行为。它不是传统单元测试的替代品，而是补充。

单元测试关注：

- 函数是否按预期运行。
- schema 是否校验。
- 工具是否处理边界。

Evals 关注：

- Agent 回答是否准确。
- 是否按策略使用工具。
- 是否正确拒绝危险请求。
- 是否保持输出质量。
- 新模型或 prompt 是否导致回退。

## 6. Eval case 设计

一个 eval case 应包含：

- 输入。
- 期望行为。
- 可接受输出标准。
- 评分方式。
- 标签。

示例：

```python
case = {
    "name": "billing_dispute_requires_escalation",
    "input": "I was charged twice and want a refund.",
    "expected": {
        "escalate": True,
        "category": "billing",
    },
}
```

## 7. 评分方式

常见评分：

- 精确匹配：结构化字段必须等于期望。
- 规则评分：例如 answer 不得包含禁止词。
- LLM-as-judge：让另一个模型评分。
- 人工标注：高风险场景。
- 业务指标：点击率、解决率、升级率。

建议：

- 结构化字段优先用规则评分。
- 自然语言质量可用 judge，但要抽样人工复核。
- 高风险决策不要只靠 LLM judge。

## 8. Regression Evals

每次改这些内容都应跑 evals：

- prompt。
- output schema。
- 工具描述。
- 模型。
- provider。
- 依赖数据检索逻辑。

最小实践：

```text
PR:
  - unit tests
  - small eval set

Nightly:
  - larger eval set
  - cost/latency report

Release:
  - comparison against previous production version
```

## 9. Debugging 流程

问题：Agent 没有调用工具。

检查：

1. 工具 docstring 是否清楚。
2. 工具参数是否太复杂。
3. prompt 是否告诉 Agent 使用工具。
4. 模型是否支持工具调用。
5. trace 中是否出现 tool schema。
6. eval case 是否覆盖该行为。

问题：结构化输出经常失败。

检查：

1. schema 是否太复杂。
2. 字段描述是否模糊。
3. enum 是否过多。
4. 输出类型是否应拆小。
5. 模型是否支持可靠结构化输出。
6. retry 后是否仍失败。

## 10. 本章检查点

读完本章，你应该能：

- 判断哪些 Agent 需要流式。
- 设计一次 Agent run 的观测字段。
- 区分单元测试和 evals。
- 为 Agent 设计 eval case。
- 用 trace 定位工具调用和输出校验问题。

