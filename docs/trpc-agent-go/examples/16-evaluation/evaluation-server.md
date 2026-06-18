# 在线评测服务 - 把评测能力暴露成 HTTP API

> **源码路径**：[`trpc-agent-go/examples/evaluation/server/`](../../../../trpc-agent-go/examples/evaluation/server)
> **示例类型**：服务化（HTTP API） · **难度**：进阶

## 概述

`server/` 把评测工作流包装成 HTTP 服务，让网页或其它系统能**远程触发评测**，而不必登录机器跑 CLI。它基于官方 `server/evaluation` 包，提供"列 EvalSet、跑评测、查结果"三类端点，是搭建评测平台 UI 后端的最小模板。

与 [`local`](./evaluation-local.md) 的区别：local 是一次性 CLI 程序；server 是常驻进程，把同一套评测器以 REST 形式提供。

## 核心概念

### 用 sevaluation 包装评测器

```go
agentEvaluator, err := evaluation.New(appName, agentRunner,
    evaluation.WithEvalSetManager(evalSetManager),
    evaluation.WithMetricManager(metricManager),
    evaluation.WithEvalResultManager(evalResultManager),
    evaluation.WithRegistry(registry),
)

server, err := sevaluation.New(
    sevaluation.WithAppName(appName),
    sevaluation.WithBasePath(*basePath),
    sevaluation.WithAgentEvaluator(agentEvaluator),
    sevaluation.WithEvalSetManager(evalSetManager),
    sevaluation.WithMetricManager(metricManager),
    sevaluation.WithEvalResultManager(evalResultManager),
)
log.Printf("Evaluation server listening on %s%s", *addr, server.BasePath())
http.ListenAndServe(*addr, server.Handler())
```

评测器与各管理器同时注入 server，server 据此对外提供读写端点。

### HTTP 端点

| 方法 | 路径 | 作用 |
|------|------|------|
| GET | `/evaluation/sets` | 列出可用 EvalSet |
| GET | `/evaluation/sets/{setId}` | 查看某个 EvalSet |
| POST | `/evaluation/runs` | 触发一次评测（body 含 `setId`、`numRuns`） |
| GET | `/evaluation/results` | 列出结果 |
| GET | `/evaluation/results/{resultId}` | 查看某次结果详情 |

## 代码解析

被评测对象是 calculator math Agent（`math-eval-app`），数据文件随仓库提供：

```text
examples/evaluation/server/data/math-eval-app/
    |-- math-basic.evalset.json
    `-- math-basic.metrics.json
```

`-data-dir` 必须含与 appName 同名的子目录。整个 server 的 main 只做"建 runner → 建评测器 → 建 server → `ListenAndServe`"。

## 运行方式

### 环境变量

| 变量 | 必需 | 说明 | 默认值 |
|------|------|------|--------|
| `OPENAI_API_KEY` | 是 | 模型 API Key | — |
| `OPENAI_BASE_URL` | 否 | 模型端点 | `https://api.openai.com/v1` |

### 命令行参数

| 参数 | 说明 | 默认值 |
|------|------|--------|
| `-addr` | 监听地址 | `:8080` |
| `-base-path` | 暴露的基础路径 | `/evaluation` |
| `-model` | calculator Agent 模型 | `deepseek-v4-flash` |
| `-streaming` | 是否流式 | `false` |
| `-data-dir` | EvalSet/Metric 目录 | `./data` |
| `-output-dir` | 结果输出目录 | `./output` |

### 运行命令

```bash
cd trpc-agent-go/examples/evaluation/server
export OPENAI_API_KEY="sk-..."

go run . -addr ":8080" -base-path "/evaluation" \
  -model deepseek-v4-flash -data-dir ./data -output-dir ./output
```

### 调用示例

列出 EvalSet：

```bash
curl "http://127.0.0.1:8080/evaluation/sets"
```

触发一次评测（响应体含 `evaluationResult`）：

```bash
curl -X POST "http://127.0.0.1:8080/evaluation/runs" \
  -H "Content-Type: application/json" \
  -d '{"setId":"math-basic","numRuns":1}'
```

查结果：

```bash
curl "http://127.0.0.1:8080/evaluation/results"
curl "http://127.0.0.1:8080/evaluation/results/<resultId>"
```

## 适用场景与对比

**选 server 当：**
- 想搭评测平台 UI，前端通过 HTTP 调用
- 需要远程/多人触发评测
- 想把评测嵌进 CI/Webhook

| 维度 | server（本文件） | local（CLI） | langfuse |
|------|------|------|------|
| 形态 | 常驻 HTTP 服务 | 一次性 CLI | 常驻 HTTP + 外部平台 |
| 触发方 | curl / 前端 / Webhook | 命令行 | Langfuse webhook |
| 结果去向 | 本地文件 + API 返回 | 本地文件 | 本地 + Langfuse 评分 |

## 关键要点

1. `sevaluation.New` 把评测器 + 三个管理器包装成 HTTP 服务。
2. 端点覆盖"列 EvalSet / 跑评测 / 查结果"全流程，可直接对接前端。
3. `-base-path` 控制路径前缀，便于反向代理与多实例共存。
4. 数据布局与 [`local`](./evaluation-local.md) 一致，迁移成本低。

## 总结

server 是评测能力服务化的起点。需要把评测接到 Langfuse 这类外部可观测平台时，参考 [`langfuse`](./evaluation-langfuse.md)；需要 Prompt 自动优化时，参考 [`promptiter`](./evaluation-promptiter.md) 的 server 子变体。
