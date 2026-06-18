# 评测系统 - 科学衡量与持续提升 Agent 质量

> **源码路径**：[`trpc-agent-go/examples/evaluation/`](../../../../trpc-agent-go/examples/evaluation)
> **子示例数**：19 个 · 本页为分类索引，每个子示例有独立详解

## 概述

tRPC-Agent-Go 的 `evaluation/` 目录用 **19 个独立子示例**展示了 Agent 质量评测的完整光谱：从最基础的本地文件评测，到 LLM 裁判、工具轨迹、动态用户模拟，再到 MySQL 持久化、HTTP 服务化、Langfuse 集成，以及评测驱动的 Prompt 自动优化（PromptIter）。无论你想做回归基线、上线把关还是自动调优，都能在这里找到对应范式。

## 子示例导航

### 评测器与准则（如何打分）

| 子示例 | 角色 | 难度 | 一句话说明 |
|--------|------|------|-----------|
| [`local`](./evaluation-local.md) | 存储后端 | 入门 | 本地文件承载 EvalSet/Metric/Result，最经典的入门骨架 |
| [`inmemory`](./evaluation-inmemory.md) | 存储后端 | 入门 | 用例/指标在代码里构造，结果在内存，适合单测 |
| [`rouge`](./evaluation-rouge.md) | 确定性准则 | 入门 | ROUGE 字面匹配，零成本可复现的回归门槛 |
| [`jieba`](./evaluation-jieba.md) | 确定性准则 | 进阶 | 注册结巴中文分词器做 ROUGE，解决中文失真 |
| [`llm`](./evaluation-llm.md) | LLM 裁判 | 进阶 | 6 个子变体（finalresponse/rubric/knowledge/hallucination/template/caselevel） |
| [`llmverifier`](./evaluation-llmverifier.md) | Best-of-N | 进阶 | 多次采样 + LLM 裁判两两比较，在线选出最优回复 |
| [`tooltrajectory`](./evaluation-tooltrajectory.md) | 轨迹准则 | 进阶 | 校验 Agent 是否调对工具，顺序无关 + 按字段忽略 |
| [`trace`](./evaluation-trace.md) | 离线轨迹 | 进阶 | 用预录 trace 评测，跳过推理，离线打分 |
| [`contextmessage`](./evaluation-contextmessage.md) | 用例构造 | 进阶 | 注入上下文到每次请求但不污染 Session 历史 |
| [`callbacks`](./evaluation-callbacks.md) | 生命周期钩子 | 进阶 | 8 个阶段钩子，可观测性与扩展点 |

### 动态与 Agent 集成（评什么）

| 子示例 | 角色 | 难度 | 一句话说明 |
|--------|------|------|-----------|
| [`usersimulation`](./evaluation-usersimulation.md) | 动态模拟 | 进阶 | 模拟用户驱动多轮对话，3 个 Runner |
| [`usersimulation_expectedrunner`](./evaluation-usersimulation-expectedrunner.md) | 动态模拟 | 进阶 | 引入 expected Runner，候选与参考逐轮对比（4 Runner） |
| [`claudecode`](./evaluation-claudecode.md) | 外部 Agent | 进阶 | 评测 Claude Code CLI 的 MCP/Skill/Subagent 工具使用 |
| [`skill`](./evaluation-skill.md) | 能力集成 | 进阶 | 校验 Agent 是否正确加载并执行 Agent Skills |

### 记录器与存储（数据去哪/从哪来）

| 子示例 | 角色 | 难度 | 一句话说明 |
|--------|------|------|-----------|
| [`evalsetrecorder`](./evaluation-evalsetrecorder.md) | 录制器 | 进阶 | Runner 插件，把真实流量沉淀成可复用 EvalSet |
| [`mysql`](./evaluation-mysql.md) | 存储后端 | 进阶 | EvalSet/Metric/Result 全部入库，多人协作 |

### 服务化与外部平台（怎么触发）

| 子示例 | 角色 | 难度 | 一句话说明 |
|--------|------|------|-----------|
| [`server`](./evaluation-server.md) | HTTP 服务 | 进阶 | 把评测暴露成 REST API，供前端/远程触发 |
| [`langfuse`](./evaluation-langfuse.md) | 平台集成 | 进阶 | 接 Langfuse 远程实验，本地推理 + 回写分数/trace |

### Prompt 优化工作流（评测驱动改进）

| 子示例 | 角色 | 难度 | 一句话说明 |
|--------|------|------|-----------|
| [`promptiter`](./evaluation-promptiter.md) | 自动优化 | 进阶 | 评测驱动的 Prompt 自动调优（同步/异步/HTTP/多节点） |

## 选型建议

### 评测准则怎么选

```
要评什么？
├── 最终答案字面匹配（答案固定、要可复现）
│   ├── 英文/空格分词          → rouge
│   └── 中文                   → jieba（注册结巴分词器）
├── 最终答案语义质量
│   ├── 答案对齐               → llm/finalresponse
│   ├── 多 rubric 维度         → llm/rubricresponse
│   ├── RAG 检索质量           → llm/knowledgerecall
│   ├── 事实幻觉检测           → llm/hallucination
│   ├── 自定义裁判 prompt      → llm/template
│   └── 用例级 rubric 绑定     → llm/caselevelrubric
├── 工具调用行为
│   ├── 在线跑 + 比对          → tooltrajectory
│   └── 离线预录 trace         → trace
├── 多轮对话
│   ├── 模拟用户驱动           → usersimulation
│   └── 候选 vs 参考逐轮对比   → usersimulation_expectedrunner
└── 在线选优（生产时）         → llmverifier（Best-of-N）
```

### 存储/触发怎么选

| 需求 | 推荐 |
|------|------|
| 快速试验/单测 | [`inmemory`](./evaluation-inmemory.md) |
| 工程基线/可 Review | [`local`](./evaluation-local.md) |
| 多人协作/历史追溯 | [`mysql`](./evaluation-mysql.md) |
| 没有标注数据冷启动 | [`evalsetrecorder`](./evaluation-evalsetrecorder.md)（录制真实流量） |
| 前端/远程触发 | [`server`](./evaluation-server.md) |
| 接 Langfuse 可视化 | [`langfuse`](./evaluation-langfuse.md) |
| 自动改进 Prompt | [`promptiter`](./evaluation-promptiter.md) |

## 核心概念

### 四大共享抽象

所有评测示例都围绕以下抽象，差别只在"换成哪个后端/准则/触发方式"：

- **EvalSet（评测集）**：一组 `EvalCase`，每个含用户输入、期望输出、工具调用轨迹。存储后端可换：inmemory / local / mysql。
- **Metric（指标）**：评分准则 + 阈值。准则可换：ROUGE / LLM 裁判 / 工具轨迹 / 自定义模板。
- **Evaluator（评测器）**：`evaluation.New(...)` 组装，执行"推理 → 打分"流水线。
- **EvalResult（评测结果）**：每用例得分、状态、明细，可落盘/入库/回写平台。

### 统一的四管理器接线

绝大多数示例共享同一段骨架（以 [`local`](./evaluation-local.md) 为模板）：

```go
evalSetManager    := <backend>.New(...)      // inmemory / local / mysql
metricManager     := <backend>.New(...)
evalResultManager := <backend>.New(...)
registry          := registry.New()

agentEvaluator, _ := evaluation.New(appName, runner,
    evaluation.WithEvalSetManager(evalSetManager),
    evaluation.WithMetricManager(metricManager),
    evaluation.WithEvalResultManager(evalResultManager),
    evaluation.WithRegistry(registry),
    // 按需追加：WithJudgeRunner / WithUserSimulator /
    //          WithExpectedRunner / WithCallbacks / WithMetricRegistry
)
result, _ := agentEvaluator.Evaluate(ctx, evalSetID)
```

**存储无关性**：把 inmemory/local/mysql 三个管理器互换，业务代码不变。
**准则可扩展**：通过 `registry` / `WithMetricRegistry` 注册自定义评测器与分词器（如 [`jieba`](./evaluation-jieba.md)）。

### 两个关键扩展点

- **JudgeRunner**：把 LLM 裁判作为独立 Runner 注入（[`hallucination`](./evaluation-llm.md)、[`usersimulation`](./evaluation-usersimulation.md) 等），指标文件不必写死模型。
- **Callbacks**：8 个生命周期钩子（[`callbacks`](./evaluation-callbacks.md)），用于日志、监控、改写流程。

## 学习路径建议

1. **先读 [`local`](./evaluation-local.md)**：掌握"四管理器 + 评测器"骨架，这是几乎所有示例的共同基础。
2. **对比存储后端**：[`inmemory`](./evaluation-inmemory.md)（代码构造）与 [`mysql`](./evaluation-mysql.md)（入库），体会存储无关性。
3. **学评测准则**：从 [`rouge`](./evaluation-rouge.md)/[`jieba`](./evaluation-jieba.md)（确定性）→ [`llm`](./evaluation-llm.md) 家族（LLM 裁判）→ [`tooltrajectory`](./evaluation-tooltrajectory.md)/[`trace`](./evaluation-trace.md)（行为）。
4. **进阶动态与服务**：[`usersimulation`](./evaluation-usersimulation.md)、[`server`](./evaluation-server.md)、[`langfuse`](./evaluation-langfuse.md)。
5. **高阶闭环**：[`promptiter`](./evaluation-promptiter.md) 把评测升级为自动优化。

## 共通的运行方式

```bash
# 通用前置
export OPENAI_API_KEY="sk-..."
export OPENAI_BASE_URL="https://api.openai.com/v1"   # 可选

# 入门：本地文件评测
cd examples/evaluation/local    && go run . -eval-set math-basic

# 换准则
cd examples/evaluation/rouge    && go run . -eval-set rouge-basic
cd examples/evaluation/tooltrajectory && go run . -eval-set tooltrajectory-basic

# 换后端
cd examples/evaluation/inmemory && go run .
cd examples/evaluation/mysql    && go run . -dsn "..."

# 高阶
cd examples/evaluation/promptiter/syncrun && go run . -max-rounds 4
```

## 总结

评测系统的设计精髓在于**解耦**：同一套 `evaluation.New` 接口，存储侧可换 inmemory/local/mysql，准则侧可换 ROUGE/LLM 裁判/工具轨迹，裁判侧可注入 Runner 或写死 JSON，触发侧可走 CLI/HTTP/Langfuse。理解了 [`local`](./evaluation-local.md) 的骨架，其它示例都是在这个骨架上替换组件——最终在 [`promptiter`](./evaluation-promptiter.md) 里，评测本身又成了自动优化的目标函数，形成"度量 → 分析 → 改进"的完整闭环。

评测系统与 [`session`](../08-session-management/session.md) 紧密配合：Session 维护单次会话上下文，评测负责对 Agent 在这些上下文中的表现打分。生产环境建议组合使用。
