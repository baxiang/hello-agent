# Skill 调用评测 - 校验 Agent 是否正确使用技能

> **源码路径**：[`trpc-agent-go/examples/evaluation/skill/`](../../../../trpc-agent-go/examples/evaluation/skill)
> **示例类型**：评测器（Agent 能力集成） · **难度**：进阶

## 概述

`skill/` 校验 Agent 是否**正确使用 Agent Skills**：先加载期望的 skill，再调用它执行脚本，且执行成功（`exit_code == 0`）。评测用 `tool_trajectory_avg_score` 校验这条 `skill_load` → `skill_run` 的工具调用轨迹。

> 说明：本示例有意 pin 到**旧的 skill 执行接口**（`skill_load` / `skill_run`），以便轨迹断言能针对具体工具名。新代码推荐用 docs 里的现代 Skill 接线方式，但此处展示的评测模式可无缝迁移。

## 核心概念

### Skills 文件仓库 + Full 工具档

`agent.go` 用 `skill.NewFSRepository` 从目录加载 SKILL.md 形态的技能，并通过 `SkillToolProfileFull` 开启完整的 skill 工具（默认 `knowledge_only` 档不注册 `skill_run`）：

```go
repo, err := skill.NewFSRepository(*skillsDir)
return llmagent.New("skill-eval-agent",
    llmagent.WithModel(openai.New(modelName)),
    llmagent.WithGenerationConfig(genCfg),
    llmagent.WithSkills(repo),
    llmagent.WithSkillToolProfile(llmagent.SkillToolProfileFull),  // 关键：开启 skill_run
    llmagent.WithCodeExecutor(localexec.New()),
    llmagent.WithEnableCodeExecutionResponseProcessor(false),
    llmagent.WithInstruction(`...必须用 "write-ok" 技能，先 skill_load 再 skill_run 执行 bash scripts/write_ok.sh，并带 output_files: ["out/ok.txt"]`),
)
```

### 被校验的三步行为

1. Agent 调 `skill_load` 加载 `write-ok` 技能。
2. Agent 调 `skill_run` 执行 `bash scripts/write_ok.sh`。
3. 执行成功（`exit_code == 0`）。

`tool_trajectory_avg_score` 据此校验工具名、参数与结果。

## 代码解析

main 流程是标准四管理器 + 评测器，多了 `skill.NewFSRepository(*skillsDir)` 并传给 Agent。EvalSet 为 `skill-call-basic`。

### 目录布局

```text
skill/
  agent.go / main.go
  skills/
    write-ok/
      SKILL.md
      scripts/write_ok.sh
  data/skill-eval-app/
    skill-call-basic.evalset.json
    skill-call-basic.metrics.json
  output/skill-eval-app/*.evalset_result.json
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
| `-data-dir` | EvalSet/Metric 目录 | `./data` |
| `-output-dir` | 结果输出目录 | `./output` |
| `-skills-dir` | SKILL.md 技能目录 | `./skills` |
| `-model` | Agent 模型 | `gpt-5.2` |
| `-streaming` | 是否流式 | `false` |
| `-eval-set` | 要执行的 EvalSet ID | `skill-call-basic` |
| `-runs` | 每个用例重复评测次数 | `1` |

### 运行命令

```bash
cd trpc-agent-go/examples/evaluation/skill
export OPENAI_API_KEY="sk-..."

go run . -model deepseek-v4-flash -skills-dir ./skills \
  -data-dir ./data -output-dir ./output -eval-set skill-call-basic -runs 1
```

### 预期输出

```log
✅ Evaluation completed with skill call example
App: skill-eval-app
Eval Set: skill-call-basic
Overall Status: passed
Runs: 1
Case <case-id> -> passed
  Metric tool_trajectory_avg_score: score 1.00 (threshold 1.00) => passed

Results saved under: ./output
```

## 适用场景与对比

**选 skill 当：**
- 需要回归"Agent 是否正确加载并执行技能"
- 技能涉及脚本执行，要校验 `exit_code`

| 维度 | skill（本文件） | claudecode | tooltrajectory |
|------|------|------|------|
| 被评测 Agent | llmagent（内置 skill） | Claude Code CLI | llmagent + function tool |
| 工具来源 | Agent Skills 仓库 | MCP / Skill / Task | 普通 function tool |
| 校验重点 | skill_load → skill_run → exit_code | MCP/Skill/Task 轨迹 | 工具名/参数/结果 |

## 关键要点

1. 需开启 `SkillToolProfileFull` 才会注册 `skill_run`，默认 `knowledge_only` 档不暴露它。
2. 技能来自 `skill.NewFSRepository(skillsDir)`，按 SKILL.md 目录组织。
3. 用 `tool_trajectory_avg_score` 校验"加载 → 执行 → 成功"三步轨迹。
4. 示例 pin 在旧 skill 接口以便断言工具名，评测模式本身可迁移到现代 Skill 接线。

## 总结

skill 与 [`claudecode`](./evaluation-claudecode.md) 都在评测"技能/工具使用"，只是一个评内置 llmagent 的 Skills，一个评外部 Claude CLI。两者共用 `tool_trajectory_avg_score`，体现了指标与 Agent 实现的解耦。
