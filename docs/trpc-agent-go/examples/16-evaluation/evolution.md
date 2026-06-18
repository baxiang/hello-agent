# Agent 自我进化 - 从任务执行中自动提取和复用技能

## 概述

Evolution（自我进化）是 tRPC-Agent-Go 的高级特性，允许 Agent 在执行任务后自动提取可复用的技能（Skill），并在后续相似任务中加载这些技能以提升效率和一致性。该功能实现了 Agent 的"越用越聪明"，适用于需要持续优化的生产级 Agent 系统。

## 核心概念

Evolution 机制由以下核心组件协作完成：

- **Evolution Service**：进化服务的核心协调器，负责驱动整个技能提取和管理流程。
- **ReviewPolicy（审查策略）**：决定何时触发技能提取。默认策略在满足以下条件之一时触发：工具调用次数 >= 4、用户纠正、或工具执行出错后恢复。
- **Skill Repository**：技能仓库，基于文件系统持久化存储提取的技能（`managed_skills/` 目录）。
- **Quality Gates（质量门禁）**：多级质量检查管道，包括 SpecGate（规格检查）、SafetyGate（安全检查）和 EffectivenessGate（效果检查），确保只有高质量的技能才能被采纳。
- **CandidateStore / ActivePointer**：技能版本管理机制，支持修订历史追踪和活跃版本指向。

## 代码解析

### 初始化进化服务

```go
repo, _ := skill.NewFSRepository(skillsDir)

evoSvc := evolution.NewService(mdl,
    evolution.WithManagedSkillsDir(skillsDir),
    evolution.WithSkillRepository(repo),
    evolution.WithReviewPolicy(alwaysReviewPolicy{}),
    evolution.WithCandidateStore(evolution.NewFileCandidateStore(revisionsDir)),
    evolution.WithActivePointer(evolution.NewFileActivePointer(revisionsDir)),
    evolution.WithSpecGate(evolution.NewDefaultSpecGate()),
    evolution.WithSafetyGate(evolution.NewDefaultSafetyGate()),
    evolution.WithEffectivenessGate(evolution.NewOutcomeBasedEffectivenessGate()),
)
```

进化服务通过 `WithXxx` 选项模式配置，每个质量门禁都可以独立替换或关闭。`CandidateStore` 和 `ActivePointer` 基于文件系统实现，确保技能版本可追溯。

### 将进化服务集成到 Runner

```go
ag := llmagent.New("city-comparison-agent",
    llmagent.WithModel(mdl),
    llmagent.WithSkills(repo),
    llmagent.WithMaxOverviewSkills(5),
    llmagent.WithTools([]tool.Tool{newCityTool()}),
)

d.runner = runner.NewRunner("evolution-demo", ag,
    runner.WithEvolutionService(d.evoSvc),
)
```

关键在于两处绑定：Agent 通过 `WithSkills` 加载技能仓库以读取已有技能；Runner 通过 `WithEvolutionService` 注入进化服务以在任务完成后触发技能提取。

### 运行时行为

进化过程在后台自动执行，开发者无需额外干预：

1. **Round 1**：Agent 没有任何技能，从头解决任务
2. **后台提取**：任务完成后，审查器分析会话记录，提取出可复用的 Skill 文件（Markdown 格式的 checklist）
3. **Round 2+**：Agent 通过 `skill_load` 加载已有技能，按照 checklist 执行任务

```go
func (d *evolutionDemo) waitForReviewer() {
    fmt.Print("  Waiting for background skill extraction...")
    time.Sleep(5 * time.Second)
    d.repo.Refresh()
    fmt.Println(" done.")
}
```

### 质量门禁指标

进化服务提供详细的质量门禁统计：

```go
if metrics, ok := d.evoSvc.(evolution.ApprovalGateMetricsProvider); ok {
    m := metrics.ApprovalGateMetrics()
    fmt.Printf("  Candidates seen:       %d\n", m.CandidatesSeen)
    fmt.Printf("  Revisions promoted:    %d\n", m.RevisionsPromoted)
    fmt.Printf("  Spec-gate rejected:    %d\n", m.SpecGateRejected)
    fmt.Printf("  Safety-gate rejected:  %d\n", m.SafetyGateRejected)
}
```

### 高级配置

框架还支持人工审批和影子模式：

```go
// 人工审批门禁：新技能需人工确认后才能生效
evolution.WithHumanGate(evolution.NewCreateOnlyHoldGate())

// 影子模式：门禁评估并记录日志但不阻止采纳，适合灰度发布
evolution.WithApprovalGateShadow(true)
```

## 运行方式

```bash
export OPENAI_API_KEY="sk-..."
cd examples/evolution

# 基本运行（3轮任务）
go run main.go

# 指定模型和轮次
go run main.go -model gpt-4o-mini -rounds 5

# 清除已有技能，重新开始
go run main.go -clean
```

预期输出：

```
Round 1/3 - Skills available: 0
  Response: Tokyo has a population of 13.96 million...
  Waiting for background skill extraction... done.

Round 2/3 - Skills available: 1 [City Info Lookup]
  Response: London has a population of 8.98 million...

FINAL STATE
Managed skills (1):
  - City Info Lookup: Looks up city facts using city_lookup tool...
Quality gate metrics:
  Candidates seen: 2, Revisions promoted: 2
```

运行后生成的文件结构：

```
managed_skills/
  city-info-lookup/SKILL.md          # 提取的技能文件
managed_skills_revisions/
  city-info-lookup/
    revisions/20260501T.../meta.json # 版本快照
    audit.log                        # 审计日志
    active.txt                       # 当前活跃版本
```

## 总结

Evolution 实现了 Agent 的自适应学习能力，关键收获：

- **零代码优化**：无需修改 Agent 逻辑，技能自动从任务执行中提取
- **质量保障**：多级门禁确保只有通过规格、安全和效果检查的技能才会被采纳
- **版本可控**：完整的修订历史和审计日志，支持回滚和追溯
- **渐进式部署**：影子模式和人工审批机制支持安全的生产环境接入

该模块与评测框架形成闭环：评测框架度量 Agent 质量，Evolution 自动提取和优化 Agent 行为。
