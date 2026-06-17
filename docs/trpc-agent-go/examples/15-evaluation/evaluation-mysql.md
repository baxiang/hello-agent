# MySQL 存储评测 - 数据库持久化的评测资产

> **源码路径**：[`trpc-agent-go/examples/evaluation/mysql/`](../../../../trpc-agent-go/examples/evaluation/mysql)
> **示例类型**：评测器（存储后端） · **难度**：进阶

## 概述

`mysql/` 把 EvalSet、Metric、EvalResult 三类资产**全部存入 MySQL**，适合多人协作、需要集中管理和历史追溯的生产评测场景。它的接线骨架与 [`local`](./evaluation-local.md) 完全一致，差别只在三个管理器换成 `evalsetmysql` / `metricmysql` / `evalresultmysql`，并且需要先在库里建好表、塞好种子数据。

## 核心概念

### MySQL 三管理器

```go
evalSetManager, err := evalsetmysql.New(
    evalsetmysql.WithMySQLClientDSN(*mysqlDSN),
    evalsetmysql.WithTablePrefix(*tablePrefix),
    evalsetmysql.WithSkipDBInit(*skipDBInit),
)
metricManager, err := metricmysql.New(/* 同样的三个 Option */)
evalResultManager, err := evalresultmysql.New(/* 同样的三个 Option */)
```

三个管理器共用同一份 DSN 和表前缀，分别落到不同表（见下）。`WithSkipDBInit(true)` 可跳过建表，适合表已由 DBA 预先建好的环境。

### 表结构（带前缀）

| 表名（`{{PREFIX}}` = `-table-prefix`） | 作用 |
|------|------|
| `{{PREFIX}}evaluation_eval_sets` | EvalSet 元信息（app_name + eval_set_id 唯一） |
| `{{PREFIX}}evaluation_eval_cases` | 单个 EvalCase，`eval_case` 字段为 JSON |
| `{{PREFIX}}evaluation_metrics` | Metric 定义，`metric` 字段为 JSON |
| `{{PREFIX}}evaluation_eval_set_results` | 评测结果，`eval_case_results` / `summary` 为 JSON |

表定义与官方 schema 一致：
- `evaluation/evalset/mysql/schema.sql`
- `evaluation/metric/mysql/schema.sql`
- `evaluation/evalresult/mysql/schema.sql`

## 代码解析

`main.go` 的 `run()` 做四件事：校验 DSN → 建三个 mysql 管理器（出错时手动 `Close` 已建好的）→ 按通用方式建 evaluator → `Evaluate` 后打印摘要。摘要里会额外打印 `EvalSetResult ID`，这是写进 `evaluation_eval_set_results` 的结果行 ID。

注意管理器创建失败时的清理顺序（`main.go:67-80`）：先关 evalset，再关 metric，体现了对资源生命周期的细致管理。

### 种子数据

示例默认执行 `math-eval-app` / `math-basic`，但 MySQL 不会"自动建用例"——必须先用 README 提供的 SQL 插入 `calc_add` / `calc_multiply` 两个 EvalCase 与 `tool_trajectory_avg_score` 指标（`eval_case` / `metric` 字段是 JSON 列）。

## 运行方式

### 前置条件

- 可达的 MySQL 服务（支持 JSON 列类型）
- 已创建数据库
- 若 `-skip-db-init=false`，MySQL 用户需有建表权限

### 环境变量

| 变量 | 必需 | 说明 | 默认值 |
|------|------|------|--------|
| `OPENAI_API_KEY` | 是 | 模型 API Key | — |
| `OPENAI_BASE_URL` | 否 | 模型端点 | `https://api.openai.com/v1` |

### 命令行参数

| 参数 | 说明 | 默认值 |
|------|------|--------|
| `-dsn` | MySQL DSN | `user:password@tcp(localhost:3306)/db?parseTime=true&charset=utf8mb4` |
| `-table-prefix` | 评测表前缀 | `evaluation_example` |
| `-skip-db-init` | 跳过建表 | `false` |
| `-eval-set` | 要执行的 EvalSet ID | `math-basic` |
| `-runs` | 每个用例重复评测次数 | `1` |
| `-model` | 被评测 Agent 模型 | `deepseek-v4-flash` |
| `-streaming` | 是否流式输出 | `false` |

> DSN 必须带 `parseTime=true`，否则时间戳列扫描会失败。

### 运行命令

```bash
cd examples/evaluation/mysql
export OPENAI_API_KEY="sk-..."

go run . \
  -dsn "user:password@tcp(localhost:3306)/trpc_evaluation?parseTime=true&charset=utf8mb4" \
  -table-prefix "evaluation_example" \
  -eval-set "math-basic" -runs 1
```

### 验证结果

```sql
SELECT `eval_set_result_id`, `eval_set_id`, `created_at`
FROM `evaluation_example_evaluation_eval_set_results`
WHERE `app_name` = 'math-eval-app'
ORDER BY `created_at` DESC LIMIT 5;
```

## 适用场景与对比

**选 mysql 当：**
- 多人/多团队共享同一份评测集，需要集中管理
- 要长期保留历史评测结果做趋势分析
- 已有 MySQL 运维体系，不想引入额外文件存储

| 维度 | mysql（本文件） | local | inmemory |
|------|------|------|----------|
| 用例存储 | MySQL JSON 列 | 磁盘 JSON | 内存 |
| 协作性 | 高（集中库） | 中（Git） | 无 |
| 运维成本 | 需 DB + 建表 | 零依赖 | 零依赖 |
| 历史追溯 | ✅（按时间查） | 需手动归档 | ❌ |

## 关键要点

1. mysql 后端只替换三个管理器实现，评测器与业务代码完全不变——再次印证存储无关性。
2. 三个管理器共用 `-dsn` / `-table-prefix` / `-skip-db-init`，但落到不同表。
3. 用例和指标必须**预先入库**（README 提供完整建表 + INSERT SQL），不会自动从文件迁移。
4. DSN 必须包含 `parseTime=true`，这是时间列正确扫描的前提。

## 总结

mysql 是评测框架走向生产的第一步。需要把评测能力暴露给前端/外部系统时，再进一步参考 [`server`](./evaluation-server.md)（HTTP API）与 [`langfuse`](./evaluation-langfuse.md)（外部平台集成）。
