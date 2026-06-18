# Claude Code 评测 - 评估 Claude CLI Agent 的工具使用

> **源码路径**：[`trpc-agent-go/examples/evaluation/claudecode/`](../../../../trpc-agent-go/examples/evaluation/claudecode)
> **示例类型**：评测器（外部 Agent 集成） · **难度**：进阶

## 概述

`claudecode/` 把评测流水线对准**Claude Code CLI Agent**——不是 trpc-agent-go 自己的 Agent，而是通过 `agent/claudecode` 适配器驱动的本地 `claude` 命令行。它演示如何用 `tool_trajectory_avg_score` 校验 Claude Code 的三类能力（MCP 工具、Skill、Subagent），证明评测框架可评估任意符合接口的外部 Agent。

## 核心概念

### 适配 Claude Code CLI

`agent.go` 用 `claudecode.New` 构造一个把 Claude CLI 包装成 `agent.Agent` 的实例：

```go
opts := []claudecode.Option{
    claudecode.WithBin(strings.TrimSpace(bin)),                                   // claude 可执行文件
    claudecode.WithOutputFormat(claudecode.OutputFormat(strings.TrimSpace(outputFormat))), // json / stream-json
    claudecode.WithWorkDir(strings.TrimSpace(workDir)),
    claudecode.WithExtraArgs(
        "--permission-mode", "bypassPermissions",
        "--strict-mcp-config",
        "--mcp-config", ".mcp.json",
    ),
}
return claudecode.New(opts...)
```

`workDir` 指向包含 `.mcp.json` 和 `.claude/` 的项目目录，Claude Code 据此加载项目级 MCP server、Skill、Subagent。

### 三类被校验能力

| 能力 | 工具名形态 | 说明 |
|------|-----------|------|
| MCP 工具 | `mcp__<server>__<tool>`（如 `mcp__eva_cli_example__calculator`） | 项目级 MCP server 提供 |
| Skill | 归一化为 `skill_run`（由 `agent/claudecode` 归一） | 项目级 `.claude/skills/` |
| Subagent | `Task` 工具调用 | 项目级 `.claude/agents/`；Agent 还会发一个单独的 transfer 事件，不被轨迹指标捕获 |

评测用 `tool_trajectory_avg_score` 校验这些工具调用的名称和部分参数/结果是否符合预期。

### 原始日志钩子

`-log-dir` 非空时，`newLogHook` 返回一个 `RawOutputHook`，把每次调用的 stdout/stderr/prompt 按 CLI session ID 落盘到 `<logDir>/claude-cli-logs/<cli-session-id>.log.txt`，便于排查 Claude CLI 行为。

## 代码解析

main 流程是标准四管理器 + 评测器，被评测 Agent 换成 Claude Code 适配器。`-work-dir` 默认 `.`，即示例自身目录（含 `.mcp.json`、`.claude/`、`mcpserver/`）。

### 目录布局

```text
claudecode/
  agent.go / main.go / .mcp.json
  .claude/
    skills/weather-query/SKILL.md
    agents/contact-lookup-agent.md
  mcpserver/main.go                # 示例 MCP server（calculator 工具），由 .mcp.json 通过 go run ./mcpserver 启动
  data/claudecode-eval-app/
    claudecode-basic.evalset.json
    claudecode-basic.metrics.json
  output/claudecode-eval-app/*.evalset_result.json
```

## 运行方式

### 前置条件

1. 本地已安装并登录 Claude Code CLI。
2. `claude` 在 `PATH` 中，或用 `-claude-bin` 指定路径。
3. 已安装 Go（MCP server 经 `.mcp.json` 用 `go run ./mcpserver` 启动）。

### 命令行参数

| 参数 | 说明 | 默认值 |
|------|------|--------|
| `-claude-bin` | Claude CLI 路径 | `claude` |
| `-output-format` | transcript 输出格式：`json` / `stream-json` | `json` |
| `-work-dir` | Claude Code 项目目录（含 `.mcp.json` 与 `.claude`） | `.` |
| `-log-dir` | 可选：持久化 Claude CLI 原始 stdout/stderr 的目录 | — |
| `-data-dir` | EvalSet/Metric 目录 | `./data` |
| `-output-dir` | 结果输出目录 | `./output` |
| `-eval-set` | 要执行的 EvalSet ID | `claudecode-basic` |
| `-runs` | 每个用例重复评测次数 | `1` |

### 运行命令

```bash
cd trpc-agent-go/examples/evaluation/claudecode

go run . \
  -claude-bin "claude" \
  -output-format "json" \
  -work-dir "." \
  -data-dir "./data" \
  -output-dir "./output" \
  -eval-set "claudecode-basic" \
  -runs 1
```

### 预期输出

```log
✅ Evaluation completed with Claude Code example
App: claudecode-eval-app
Eval Set: claudecode-basic
Overall Status: passed
Runs: 1
Case <case-id> -> passed
  Metric tool_trajectory_avg_score: score 1.00 (threshold 1.00) => passed

Results saved under: ./output
```

## 适用场景与对比

**选 claudecode 当：**
- 要评测 Claude Code CLI 这种外部 Agent 的工具使用
- 想把项目级 MCP / Skill / Subagent 纳入回归

| 维度 | claudecode（本文件） | skill | local |
|------|------|------|------|
| 被评测 Agent | Claude Code CLI（外部） | trpc-agent-go llmagent | trpc-agent-go llmagent |
| 工具来源 | MCP / Skill / Task | Agent Skills 仓库 | function tool |
| 依赖 | claude CLI + Go MCP server | 仅模型 | 仅模型 |

## 关键要点

1. `agent/claudecode` 把 Claude CLI 包装成 `agent.Agent`，评测框架可直接评估外部 Agent。
2. MCP 工具名为 `mcp__<server>__<tool>`，Skill 调用被归一为 `skill_run`，Subagent 走 `Task`。
3. `RawOutputHook` 可持久化 CLI 原始输出，排查问题非常方便。
4. 评测维度仍是 `tool_trajectory_avg_score`，说明指标层与 Agent 实现解耦。

## 总结

claudecode 展示了评测框架对**外部 Agent** 的兼容性。与 [`skill`](./evaluation-skill.md) 对比，可看出"同一个指标、不同 Agent 实现"的复用价值——理解 trajectory 指标后，评估任何工具型 Agent 都只需准备对应数据。
