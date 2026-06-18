# Team 示例 - Coordinator 与 Swarm 两种团队协作模式

## 概述

本示例演示 tRPC-Agent-Go 框架 `team` 包提供的两种高级团队协作模式：**Coordinator Team**（协调者团队）和 **Swarm Team**（蜂群团队）。Coordinator 模式由一个协调者 Agent 统一调度成员 Agent 并整合最终结果，适合需要产出统一交付物的场景；Swarm 模式则允许 Agent 之间通过 `transfer_to_agent` 进行对等控制权转移，适合需要多角度讨论与自由协作的场景。

## 核心概念

### Coordinator Team - 协调者模式

在 Coordinator 模式中，一个协调者 Agent 扮演"管理者"角色：它接收用户请求后，通过工具调用的形式咨询各成员 Agent，收集专家意见后生成统一的最终回答。成员 Agent 被框架自动注册为协调者的工具（tool），协调者按需调用。

### Swarm Team - 蜂群模式

在 Swarm 模式中，不存在中心化的协调者。对话从一个入口 Agent 开始，每个 Agent 可以通过 `transfer_to_agent` 将控制权转移给其他 Agent。最后一个发言的 Agent 的输出即为最终回答。这种模式模拟了团队成员之间的自由讨论和交接。

### MemberToolConfig - 成员工具配置

`team` 包提供了细粒度的成员行为控制：

- **StreamInner**：是否向用户展示成员 Agent 的内部输出
- **InnerTextMode**：`include` 展示成员完整文本，`exclude` 仅展示进度
- **HistoryScope**：`parent` 让成员共享协调者的对话历史，`isolated` 让成员仅看到自己的输入输出
- **SkipSummarization**：跳过协调者的总结步骤，直接展示成员输出

## 代码解析

### 一、Coordinator Team

**1. 定义三个专家成员**

```go
requirementsAnalyst := llmagent.New("requirements_analyst",
    llmagent.WithModel(modelInstance),
    llmagent.WithDescription("Clarifies goals, constraints, and acceptance criteria."),
    llmagent.WithInstruction("Clarify requirements, constraints, and success criteria."),
)
solutionDesigner := llmagent.New("solution_designer",
    llmagent.WithDescription("Proposes solution options and recommends a design."),
    // ...
)
qualityReviewer := llmagent.New("quality_reviewer",
    llmagent.WithDescription("Reviews for risks, edge cases, and missing details."),
    // ...
)
```

三个成员分别负责需求分析、方案设计和质量审查，模拟真实团队中的角色分工。

**2. 创建协调者 Agent**

```go
coordinator := llmagent.New(teamName,
    llmagent.WithModel(modelInstance),
    llmagent.WithInstruction(
        "You are the coordinator. Consult the right specialists, "+
            "then produce the final answer.",
    ),
)
```

协调者的指令明确其职责：根据问题性质选择合适的专家咨询，最终整合各方意见给出统一回答。

**3. 使用 team.New 组装团队**

```go
memberCfg := team.DefaultMemberToolConfig()
memberCfg.StreamInner = showInner
memberCfg.InnerTextMode = mode
memberCfg.HistoryScope = team.HistoryScopeParentBranch

teamInstance, err := team.New(coordinator, members,
    team.WithMemberToolConfig(memberCfg),
)
```

`team.New()` 接收协调者和成员列表，框架自动将每个成员注册为协调者可调用的工具。`MemberToolConfig` 精确控制成员的可见性和历史共享行为。

**4. 三种展示模式**

```bash
go run . -show-inner=false                        # 仅显示协调者最终回答
go run . -show-inner=true -member-inner-text=include  # 显示成员完整输出
go run . -show-inner=true -member-inner-text=exclude  # 显示进度但隐藏成员文本
```

### 二、Swarm Team

**1. 定义四个对等 Agent**

```go
optimist := llmagent.New("optimist",
    llmagent.WithInstruction(
        "Discuss the topic from an optimistic, creative angle. "+
            "When you want another perspective, transfer control. "+
            "When the discussion is ready to conclude, transfer to summarizer.",
    ),
)
skeptic := llmagent.New("skeptic", /* 质疑和挑战假设 */)
pragmatist := llmagent.New("pragmatist", /* 关注实际约束和执行 */)
summarizer := llmagent.New("summarizer",
    llmagent.WithInstruction("Summarize the discussion... Do not transfer control."),
)
```

每个讨论 Agent 的指令中明确说明：可以在需要其他视角时主动转移控制权，讨论结束时转给 summarizer 做总结。summarizer 是终结者，不再转移控制权。

**2. 使用 team.NewSwarm 组装蜂群**

```go
teamInstance, err := team.NewSwarm(teamName, entryAgentName, members, teamOpts...)
```

`NewSwarm` 需要指定入口 Agent 名称（本例为 `optimist`），每次用户消息默认从入口 Agent 开始处理。

**3. 跨请求控制权保持**

```go
team.WithCrossRequestTransfer(true)
```

启用此选项后，当一轮对话以 Agent B 结束时，下一轮用户消息将从 Agent B 继续处理，而非重置回入口 Agent。

## 运行方式

**环境准备：**

```bash
export OPENAI_API_KEY="your-api-key"
```

**运行命令：**

```bash
# Coordinator 模式
cd examples/team/coord
go run .

# Swarm 模式
cd examples/team/swarm
go run .
go run . -cross-request-transfer=true  # 启用跨请求控制权保持
```

**Coordinator 模式示例提问：**

```
Design a simple "export data" feature for a web app:
define requirements, propose an API and a backend design,
then list risks and next steps.
```

**Swarm 模式示例提问：**

```
We need to choose between REST and gRPC for an internal service.
Discuss the tradeoffs, then give a recommendation with next steps.
```

## 总结

两种团队模式的对比：

| 特性 | Coordinator | Swarm |
|------|-------------|-------|
| **控制方式** | 中心化协调 | 去中心化转移 |
| **最终输出** | 协调者整合 | 最后发言者 |
| **适用场景** | 统一交付物（方案、报告） | 开放讨论（头脑风暴、辩论） |
| **成员关系** | 上下级（协调者调用成员） | 对等（成员间自由转移） |
| **API** | `team.New()` | `team.NewSwarm()` |

掌握 Team 模式后，可进一步学习：

- **multiagent** 示例：了解更底层的 Chain/Cycle/Parallel 编排模式
- **transfer** 示例：了解基于 `transfer_to_agent` 的动态任务委派，这也是 Swarm 模式的底层机制
