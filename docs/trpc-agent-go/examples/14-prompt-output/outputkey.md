# Output Key 示例 - 链式 Agent 间的数据传递

## 概述

本示例演示如何使用 `WithOutputKey` 配合 `ChainAgent` 实现多 Agent 链式协作中的数据传递。第一个 Agent 的输出通过 `output_key` 存入会话状态，第二个 Agent 通过 Placeholder `{research_findings}` 读取该数据并基于其生成新内容，实现了 "研究→写作" 的流水线模式。

## 核心概念

### OutputKey

`llmagent.WithOutputKey(key)` 指定 Agent 完成后，将其最终输出自动存储到 Session State 中的指定键名下。这样链条中的后续 Agent 就可以通过 Placeholder 引用这些数据。

### ChainAgent

`chainagent.New()` 创建链式 Agent，通过 `chainagent.WithSubAgents()` 指定子 Agent 的执行顺序。链式 Agent 按顺序依次执行每个子 Agent，上一个 Agent 的输出可以通过 OutputKey + Placeholder 传递给下一个 Agent。

### OutputKey + Placeholder 数据流

```
用户输入 → Research Agent → output_key="research_findings" → Session State
                                                                    ↓
用户输出 ← Writer Agent ← {research_findings} 占位符解析 ← Session State
```

这种模式的优势是 Agent 之间完全解耦，通过 Session State 作为中间媒介传递数据。

## 代码解析

**1. 创建带 OutputKey 的研究 Agent**

```go
researchAgent := llmagent.New(
    "research-agent",
    llmagent.WithInstruction("You are a skilled research assistant..."),
    llmagent.WithOutputKey("research_findings"),
)
```

`WithOutputKey("research_findings")` 使得 Agent 的输出自动存储到 Session State 中键名为 `research_findings` 的位置。

**2. 创建使用 Placeholder 的写作 Agent**

```go
writerAgent := llmagent.New(
    "writer-agent",
    llmagent.WithInstruction("Based on the research findings: {research_findings}, "+
        "create an engaging and informative summary..."),
)
```

写作 Agent 的指令中包含 `{research_findings}` 占位符，运行时自动替换为研究 Agent 存储的输出内容。

**3. 组装链式 Agent**

```go
chainAgent := chainagent.New(
    "output-key-chain",
    chainagent.WithSubAgents([]agent.Agent{researchAgent, writerAgent}),
)
c.runner = runner.NewRunner(appName, chainAgent,
    runner.WithSessionService(sessionService),
)
```

通过 `WithSubAgents` 按顺序组装两个 Agent。Runner 必须配置 `SessionService` 才能支持 OutputKey 的状态存储。

**4. 处理链式事件流**

```go
func (c *outputKeyChainChat) handleAgentTransition(event *event.Event, ...) {
    if event.Author != *currentAgent {
        *currentAgent = event.Author
        c.displayAgentTransition(*currentAgent)
    }
}
```

通过 `event.Author` 字段追踪当前输出来自哪个 Agent，在 Agent 切换时显示转换标记。

## 运行方式

**环境准备：**

```bash
export OPENAI_API_KEY="your-api-key"
export OPENAI_BASE_URL="https://api.deepseek.com/v1"  # 可选
```

**运行命令：**

```bash
cd examples/outputkey
go run . -model deepseek-v4-flash
```

**预期输出：**

```
🔑 Output Key Chain Demo
Chain: Research Agent → Content Writer Agent
✅ Output Key Chain ready!
📝 Agents: research-agent → writer-agent

👤 You: What are the latest developments in quantum computing?
🔬 Research Agent: Quantum computing has seen significant breakthroughs...
  - IBM's 1,121-qubit Condor processor...
  - Google's quantum error correction milestone...
✍️  Writer Agent: The quantum computing landscape is evolving rapidly...
```

## 总结

OutputKey + Placeholder 是 tRPC-Agent-Go 中实现链式 Agent 数据传递的首选模式，具有 **声明式配置、自动存储、零耦合** 的优点。与 **outputkeystate** 示例的工具访问方式相比，Placeholder 方式更简洁直观。两种方式可以根据复杂度需求选择：简单传递用 Placeholder，需要条件查询或多键访问用工具方式。
