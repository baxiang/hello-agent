# Langfuse 远程实验 - 接入外部可观测平台

> **源码路径**：[`trpc-agent-go/examples/evaluation/langfuse/`](../../../../trpc-agent-go/examples/evaluation/langfuse)
> **示例类型**：服务化 + 外部平台集成 · **难度**：进阶

## 概述

`langfuse/` 在官方 `server/evaluation` HTTP 服务上挂载 **Langfuse 远程实验**支持：Langfuse 通过 webhook 触发数据集运行，本服务拉取数据集、用真实 LLM Agent + 裁判本地跑推理与评测，再把 trace、case 级分数、run 级聚合分数回写 Langfuse。它把"评测执行"留在本地、"评测管理/可视化"交给 Langfuse。

与 [`server`](./evaluation-server.md) 的区别：server 是纯本地 HTTP API；langfuse 在其之上加了一条"被 Langfuse 远程驱动 + 回写 Langfuse"的双向通道。

## 核心概念

### 双重 Handler 装配

```go
// 1. 启动 Langfuse telemetry
cleanup, err := telemetrylangfuse.Start(ctx)

// 2. 评测器（真实 Agent + 裁判 Runner）
agentEvaluator, err := coreevaluation.New(appNameValue, agentRunner,
    coreevaluation.WithEvalSetManager(evalSetManager),
    coreevaluation.WithEvalResultManager(evalResultManager),
    coreevaluation.WithMetricManager(metricManager),
    coreevaluation.WithJudgeRunner(judgeRunner),
)

// 3. Langfuse 远程实验 Handler（带自定义 case builder）
langfuseHandler, err := langfuseeval.New(appNameValue, agentEvaluator, evalSetManager, metricManager, evalResultManager,
    langfuseeval.WithCaseBuilder(buildCaseSpec),       // 把数据集条目转成 EvalCase
    langfuseeval.WithPath(defaultRoutePath),
    langfuseeval.WithUserIDSupplier(func(_ context.Context) string { return defaultUserID }),
    langfuseeval.WithEnvironment(defaultEnvironment),
)

// 4. 把 Langfuse handler 作为路由注册器挂到评测 server
server, err := sevaluation.New(
    sevaluation.WithAppName(appNameValue),
    sevaluation.WithBasePath(defaultBasePath),
    sevaluation.WithAgentEvaluator(agentEvaluator),
    sevaluation.WithEvalSetManager(evalSetManager),
    sevaluation.WithEvalResultManager(evalResultManager),
    sevaluation.WithRouteRegistrar(langfuseHandler),   // 关键
)
```

### CaseBuilder：数据集 → EvalCase

`casebuilder.go` 的 `buildCaseSpec` 把 Langfuse 数据集条目转成 `CaseSpec`：从 `input.question`、`expectedOutput.answer`、可选 `metadata.expectedTools` 构造 `EvalCase`。Langfuse 协议处理留在官方包，示例只负责"数据集解析 + 真实 Agent 接线"。

### 默认端点与指标

- 端点：`http://127.0.0.1:8088/evaluation/langfuse/remote-experiment`
- 指标（`sample.metrics.json`）：`tool_trajectory_avg_score` + `llm_rubric_response`
- 真实 `llmagent` 带 `calculator` 工具；rubric 由运行时 judgeRunner 评判，指标文件不嵌模型配置

## 代码解析

main 启动 telemetry、建 Agent/judge Runner、建本地文件管理器与评测器、建 Langfuse handler 并挂到 server，最后 `ListenAndServe` 并等待 SIGINT/SIGTERM 优雅关闭（10s 超时）。

### 数据集条目格式

`input`：

```json
{ "question": "What is 2 + 3? Use the calculator tool." }
```

`expectedOutput`：

```json
{ "answer": "5" }
```

`metadata.expectedTools`（可选，配合 `tool_trajectory_avg_score`）：

```json
{ "expectedTools": [{ "name": "calculator", "arguments": {"operation":"add","a":2,"b":3}, "result": {"result":5} }] }
```

## 运行方式

### 必需环境变量

| 变量 | 说明 |
|------|------|
| `OPENAI_API_KEY` | 示例 Agent 与裁判模型 Key |
| `LANGFUSE_HOST` | Langfuse telemetry 导出的 host:port |
| `LANGFUSE_PUBLIC_KEY` | Langfuse 公钥（telemetry + 远程实验 handler） |
| `LANGFUSE_SECRET_KEY` | Langfuse 私钥（telemetry + 远程实验 handler） |

### 可选环境变量

| 变量 | 说明 | 默认值 |
|------|------|--------|
| `LANGFUSE_INSECURE` | Langfuse 无 TLS 时用明文 HTTP | `false` |
| `OPENAI_BASE_URL` | Agent/裁判端点 | `https://api.openai.com/v1` |

### 命令行参数

| 参数 | 说明 | 默认值 |
|------|------|--------|
| `-addr` | 服务监听地址 | `:8088` |
| `-model` | 示例 Agent 模型 | `gpt-4.1-mini` |
| `-streaming` | 是否流式 | `false` |
| `-data-dir` | 本地 EvalSet/Metric 目录 | `./data` |
| `-output-dir` | 本地结果目录 | `./output` |

### 启动服务

```bash
cd trpc-agent-go/examples/evaluation/langfuse
LANGFUSE_HOST=127.0.0.1:3000 LANGFUSE_INSECURE=true \
LANGFUSE_PUBLIC_KEY=pk-lf-... LANGFUSE_SECRET_KEY=sk-lf-... \
OPENAI_API_KEY=sk-... go run .
```

### 触发远程实验

方式一：在 Langfuse UI 里把数据集的远程运行 webhook 指向 `http://<host>:8088/evaluation/langfuse/remote-experiment`，粘贴 payload 默认配置后触发。

方式二：直接 curl：

```bash
curl -X POST http://127.0.0.1:8088/evaluation/langfuse/remote-experiment \
  -H 'Content-Type: application/json' \
  -d '{
    "projectId": "your-project-id",
    "datasetId": "your-dataset-id",
    "datasetName": "remote-eval-demo",
    "payload": {
      "runName": "remote-demo-20260410",
      "runDescription": "Remote experiment example with a real agent and judge runner.",
      "userId": "payload-user",
      "traceTags": ["payload-tag-a", "payload-tag-b"]
    }
  }'
```

> 触发前需为目标数据集 ID 准备 metric 文件：`cp ./data/langfuse-remote-eval-app/sample.metrics.json ./data/langfuse-remote-eval-app/<dataset-id>.metrics.json`。

### 在 Langfuse 中看到

- 选定数据集下创建一条远程 dataset run
- 每个数据集条目一条 trace
- trace 上的 case 级分数
- dataset run 上的 run 级聚合分数
- OTEL 摄入完成后的工具 observation
- 评分 comment 来自评测器 reason 与通过率摘要

## 适用场景与对比

**选 langfuse 当：**
- 已用 Langfuse 做 trace/数据集管理，想把本地推理接入其评测体系
- 需要把分数、trace、聚合结果统一在 Langfuse 可视化

| 维度 | langfuse（本文件） | server | local |
|------|------|------|------|
| 触发方 | Langfuse webhook / curl | curl / 前端 | CLI |
| 结果去向 | 本地 + Langfuse 评分 | 本地 + API 返回 | 本地文件 |
| 外部依赖 | Langfuse 实例 + 凭证 | 无 | 无 |

## 关键要点

1. langfuse 在 `server/evaluation` 之上加 `langfuseeval` handler，通过 `WithRouteRegistrar` 挂载。
2. CaseBuilder 负责把 Langfuse 数据集条目转成 `EvalCase`，协议处理留在官方包。
3. 一次远程实验 = 拉数据集 → 本地推理+评测 → 回写 trace/分数/聚合。
4. 需要四套凭证：`OPENAI_API_KEY` + 三个 `LANGFUSE_*`。

## 总结

langfuse 是评测框架与外部可观测平台集成的范本。把它和 [`server`](./evaluation-server.md)、[`mysql`](./evaluation-mysql.md) 组合，可以搭建从"触发 → 执行 → 存储 → 可视化"的完整评测平台。
