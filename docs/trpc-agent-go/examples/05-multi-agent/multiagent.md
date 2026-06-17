# MultiAgent 示例 - 三种多 Agent 编排模式：链式、循环与并行

## 概述

本示例演示 tRPC-Agent-Go 框架提供的三种核心多 Agent 编排模式：**ChainAgent**（链式顺序执行）、**CycleAgent**（循环迭代优化）和 **ParallelAgent**（并行同步执行）。这三种模式覆盖了多 Agent 协作中最常见的工作流拓扑，适用于从内容生产到商业决策分析的各类场景。

## 核心概念

### ChainAgent - 链式顺序执行

`ChainAgent` 将多个子 Agent 按固定顺序串联执行，前一个 Agent 的输出自动作为下一个 Agent 的上下文输入。适合任务有明确阶段划分的场景，例如"规划 → 研究 → 撰写"的内容生产流水线。

### CycleAgent - 循环迭代优化

`CycleAgent` 在一组子 Agent 之间反复迭代执行，直到满足退出条件（质量阈值或最大迭代次数）。适合需要渐进式优化的场景，例如"生成 → 评审 → 改进"的内容打磨循环。

### ParallelAgent - 并行同步执行

`ParallelAgent` 将多个子 Agent 同时并发执行，各 Agent 独立处理同一输入的不同维度。适合各分析视角彼此独立、可并行处理的场景，能显著降低总体延迟。

## 代码解析

### 一、ChainAgent 链式模式

**1. 创建三个专业化子 Agent**

```go
planningAgent := llmagent.New("planning-agent",
    llmagent.WithModel(modelInstance),
    llmagent.WithInstruction("You are a planning specialist..."),
    llmagent.WithGenerationConfig(genConfig),
)
researchAgent := llmagent.New("research-agent",
    llmagent.WithTools([]tool.Tool{webSearchTool, knowledgeTool}),
    // ...
)
writingAgent := llmagent.New("writing-agent", /* ... */)
```

每个 Agent 有明确分工：规划 Agent 负责分解任务，研究 Agent 配备搜索工具收集信息，写作 Agent 整合前两步输出生成最终结果。

**2. 组装 ChainAgent 并运行**

```go
chainAgent := chainagent.New("multi-agent-chain",
    chainagent.WithSubAgents([]agent.Agent{planningAgent, researchAgent, writingAgent}),
)
c.runner = runner.NewRunner(appName, chainAgent)
```

子 Agent 数组的顺序即执行顺序。框架自动将前一个 Agent 的输出传递给下一个。

**3. 上下文前缀控制**

```go
llmagent.WithAddContextPrefix(!c.disablePrefix)
```

默认启用上下文前缀（如 `"For context: [agent A] said: ..."`），可通过 `-no-prefix` 标志禁用，在传递 JSON 等结构化数据时特别有用。

### 二、CycleAgent 循环模式

**1. 创建生成器和评审器**

```go
generateAgent := llmagent.New("generate-agent",
    llmagent.WithInstruction("You are a creative content generator..."),
    llmagent.WithTools([]tool.Tool{solutionTool}),
)
criticAgent := llmagent.New("critic-agent",
    llmagent.WithInstruction("...Give a score from 0-100 and decide if it needs improvement..."),
    llmagent.WithTools([]tool.Tool{scoreTool}),
)
```

评审 Agent 通过 `record_score` 工具输出质量评分和是否需要改进的决策。

**2. 配置循环退出条件**

```go
qualityEscalationFunc := func(evt *event.Event) bool {
    // 解析 record_score 工具返回值
    if strings.Contains(content, "\"needs_improvement\":false") {
        return true  // 质量达标，停止循环
    }
    return false     // 继续迭代
}

cycleAgent := cycleagent.New("cycle-demo",
    cycleagent.WithSubAgents([]agent.Agent{generateAgent, criticAgent}),
    cycleagent.WithMaxIterations(*maxIterPtr),
    cycleagent.WithEscalationFunc(qualityEscalationFunc),
)
```

`WithEscalationFunc` 注入自定义退出逻辑：当评审分数 >= 82 分时提前结束循环，否则继续迭代直到达到最大次数。

### 三、ParallelAgent 并行模式

**1. 创建四个独立分析 Agent**

```go
marketAgent := llmagent.New("market-analysis", /* 市场分析 */)
technicalAgent := llmagent.New("technical-assessment", /* 技术评估 */)
riskAgent := llmagent.New("risk-evaluation", /* 风险评估 */)
opportunityAgent := llmagent.New("opportunity-analysis", /* 机会分析 */)
```

四个 Agent 分别从市场、技术、风险、机会四个维度独立分析同一问题。

**2. 关闭流式输出避免交叉**

```go
genConfig := model.GenerationConfig{
    Stream: false, // 并行模式关闭流式，防止字符级交叉
}
```

由于多个 Agent 同时输出，开启流式会导致不同 Agent 的字符交叉混合，因此并行模式下推荐关闭流式。

**3. 组装并行 Agent**

```go
parallelAgent := parallelagent.New("parallel-demo",
    parallelagent.WithSubAgents([]agent.Agent{
        marketAgent, technicalAgent, riskAgent, opportunityAgent,
    }),
)
```

所有子 Agent 同时启动，总耗时等于最慢 Agent 的耗时，而非各 Agent 耗时之和。

## 运行方式

**环境准备：**

```bash
export OPENAI_API_KEY="your-api-key"
export OPENAI_BASE_URL="https://api.deepseek.com/v1"  # 可选
```

**运行命令：**

```bash
# 链式模式
cd examples/multiagent/chain
go run .
go run . -no-prefix          # 禁用上下文前缀

# 循环模式
cd examples/multiagent/cycle
go run .
go run . -max-iterations 5   # 设置最大迭代次数

# 并行模式
cd examples/multiagent/parallel
go run .
```

**链式模式预期输出：**

```
📋 Planning Agent: I'll create a structured analysis plan...
🔍 Research Agent: [调用 web_search 工具] ...
✍️  Writing Agent: Based on planning and research: ...
```

**循环模式预期输出：**

```
🤖 Generate Agent: [生成内容]
👀 Critic Agent: ✅ Quality Score: 75/100 ⚠️ Needs improvement
🤖 Generate Agent: [改进后内容]
👀 Critic Agent: ✅ Quality Score: 85/100 🎉 Quality threshold met
🏁 Cycle completed after 2 iteration(s)
```

**并行模式预期输出：**

```
📊 [market-analysis]: 市场分析结果...
⚙️  [technical-assessment]: 技术评估结果...
⚠️  [risk-evaluation]: 风险评估结果...
🚀 [opportunity-analysis]: 机会分析结果...
✅ Multi-perspective analysis completed in 4.1s
```

## 总结

三种编排模式的选型指南：

| 模式 | 适用场景 | 数据流 | 时间复杂度 |
|------|----------|--------|------------|
| **Chain** | 任务有顺序依赖 | A → B → C | T_A + T_B + T_C |
| **Cycle** | 需要迭代优化 | A → B → A → B... | N × (T_A + T_B) |
| **Parallel** | 各维度独立分析 | A ∥ B ∥ C ∥ D | max(T_A, T_B, T_C, T_D) |

掌握这三种模式后，可进一步学习：

- **team** 示例：了解 Coordinator 和 Swarm 两种团队协作模式
- **transfer** 示例：了解基于 `transfer_to_agent` 的动态任务委派机制
