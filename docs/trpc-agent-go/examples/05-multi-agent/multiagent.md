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

## 深度原理
> 本节源自原「核心组件」深度文（02-agent-types.md 的 Chain/Parallel/Cycle 部分）。

### Chain/Parallel/Cycle 三种编排

三种编排 Agent 都实现 `agent.Agent` 接口，差异集中在 `Run` 方法如何调度子 Agent。核心结构签名（简化）：

```go
// agent/chainagent/chain_agent.go
type ChainAgent struct {
    name      string
    subAgents []agent.Agent
}

// agent/parallelagent/parallel_agent.go
type ParallelAgent struct {
    name      string
    subAgents []agent.Agent
}

// agent/cycleagent/cycle_agent.go
type CycleAgent struct {
    name          string
    subAgents     []agent.Agent // 例如 [planner, executor]
    maxIterations int
    exitCondition func(ctx, inv) bool
}
```

三者的本质差异在控制流与数据流：

| 类型 | 控制流 | 子 Agent 间数据流 | 终止条件 |
|------|--------|------------------|---------|
| **ChainAgent** | 顺序 | A 的 last_response → B 的 Message | 跑完最后一个子 Agent |
| **ParallelAgent** | 并发（goroutine + WaitGroup） | 无依赖，共享同一输入 Message | 全部子 Agent 完成 |
| **CycleAgent** | 循环 | 上一轮输出进入下一轮 Invocation | 退出条件命中 / 达到 maxIterations |

**关键实现细节**：
- 三者均通过 `inv.Clone()` 派生子 Invocation，保留 Session/Memory 等上下文；ParallelAgent 额外用 `sync.Mutex` 保护共享结果切片，确保并发上下文隔离。
- ChainAgent 通过 `WithInvocationMessage()` 把上一个 Agent 的 `last_response` 注入下一个 Agent 的输入。
- 子 Agent 的事件（含中间 tool call）全部原样透传，外部可观察完整执行过程；ParallelAgent 并发转发时需带索引标识避免 UI 混乱。

### Multi-Agent 编排设计

框架提供这三种模式，对应工作流拓扑的三种基本形态：

- **Chain** 解决「阶段化流水线」——任务可拆为有序步骤，前序输出是后序必要输入（规划 → 研究 → 撰写）。
- **Parallel** 解决「多视角分析」——同一输入需从不同维度独立处理，彼此无依赖（法律 / 技术 / 商业）。
- **Cycle** 解决「渐进优化」——需要反复迭代直到质量达标（生成 → 评审 → 改进）。

这三种是 DAG（有向无环图）的常见简化形态。当任务需要条件分支、多入度节点、跨阶段共享中间状态时，应升级到 GraphAgent。

### 设计哲学

**顺序 vs 并发 vs 循环的决策依据**：

1. **任务间是否存在数据依赖？**
   - 严格顺序依赖 → Chain（B 必须等 A 完成）
   - 完全独立 → Parallel（可同时跑）
   - 存在反馈回路（C 的结果要让 A 再跑一遍）→ Cycle

2. **延迟预算如何？**
   - Chain：总延迟 = T_A + T_B + T_C（累加）
   - Parallel：总延迟 = max(T_A, T_B, T_C)（取最大值）
   - Cycle：总延迟不可控，必须设 `maxIterations` 兜底

3. **结果如何产出？**
   - Chain 直接取最后一个 Agent 输出
   - Parallel 需二次合并（框架默认用 `\n\n---\n\n` 拼接，复杂场景需 LLM 再加工）
   - Cycle 取最后一轮迭代输出

**与 Ralph Loop 的区别**：Ralph Loop 在 Runner 层实现循环（验证驱动），CycleAgent 在 Agent 层实现（LLM 驱动）。

### 配置速查

#### ChainAgent

| Functional Option | 作用 |
|------------------|------|
| `chainagent.WithSubAgents([]agent.Agent)` | 注入有序子 Agent 列表，数组顺序即执行顺序 |

配合使用的子 Agent 选项：

| Functional Option | 作用 |
|------------------|------|
| `llmagent.WithAddContextPrefix(bool)` | 是否在传递给下游的上下文前加前缀（如 "For context: ..."）；传 JSON 等结构化数据时建议关闭 |

#### ParallelAgent

| Functional Option | 作用 |
|------------------|------|
| `parallelagent.WithSubAgents([]agent.Agent)` | 注入并发子 Agent 列表 |

并行模式推荐配置：

| 配置项 | 推荐值 | 原因 |
|--------|--------|------|
| `model.GenerationConfig.Stream` | `false` | 多 Agent 同时流式输出会字符级交叉 |

#### CycleAgent

| Functional Option | 作用 |
|------------------|------|
| `cycleagent.WithSubAgents([]agent.Agent)` | 注入循环体子 Agent 列表（如 [generator, critic]） |
| `cycleagent.WithMaxIterations(int)` | 最大迭代次数，必填以兜底延迟 |
| `cycleagent.WithEscalationFunc(func(*event.Event) bool)` | 自定义提前退出条件，返回 `true` 即停止（对应内部 `exitCondition` 字段） |

#### 编排模式总览

| 模式 | 适用场景 | 延迟特点 | 结果特点 |
|------|---------|---------|---------|
| **ChainAgent** | 严格顺序依赖的流水线 | 延迟累加 | 最终步骤的输出 |
| **ParallelAgent** | 无依赖的独立分析 | 取最大值 | 合并多个结果 |
| **CycleAgent** | 需要多轮迭代优化 | 不可控（需限制上限） | 最后迭代的输出 |
