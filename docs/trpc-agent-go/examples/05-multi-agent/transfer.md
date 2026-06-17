# Transfer 示例 - 基于 transfer_to_agent 的动态任务委派

## 概述

本示例演示 tRPC-Agent-Go 框架的 Agent 转移（Transfer）功能，展示如何构建一个协调者 Agent 通过内置的 `transfer_to_agent` 工具将任务动态委派给专业化子 Agent。与 Team 模式的静态编排不同，Transfer 模式更加轻量灵活——协调者根据用户请求的内容智能判断并转移控制权给最合适的专家 Agent。

## 核心概念

### SubAgent 与 Transfer 机制

当通过 `llmagent.WithSubAgents()` 为一个 Agent 注册子 Agent 时，框架自动为该 Agent 添加 `transfer_to_agent` 工具。协调者 Agent 在对话过程中可以调用此工具，将控制权完整转移给目标子 Agent。转移后，子 Agent 独立处理用户请求，拥有自己的工具集和指令。

### 与 Team 模式的区别

- **Transfer**：轻量级，协调者通过 `WithSubAgents` 直接挂载子 Agent，无需 `team` 包
- **Team Coordinator**：成员被注册为协调者的工具，协调者可多次调用成员并整合结果
- **Team Swarm**：成员间可自由转移控制权，无中心协调者

Transfer 模式适合"一次委派、完整处理"的场景，即协调者判断任务类型后将控制权完全交给专家。

### EndInvocationAfterTransfer

```go
llmagent.WithEndInvocationAfterTransfer(true)
```

启用此选项后，协调者在发起转移后立即结束自身调用，避免转移后仍产生多余输出。

## 代码解析

**1. 创建多个专业化子 Agent**

本示例将四个子 Agent 分别定义在独立文件中，职责清晰：

```go
// agent_math.go - 数学计算专家
func (c *transferChat) createMathAgent(modelInstance model.Model) agent.Agent {
    calculateTool := function.NewFunctionTool(c.calculate,
        function.WithName("calculate"),
        function.WithDescription("Perform mathematical calculations"),
    )
    return llmagent.New("math-agent",
        llmagent.WithModel(modelInstance),
        llmagent.WithInstruction("You are a math expert..."),
        llmagent.WithGenerationConfig(model.GenerationConfig{
            Temperature: floatPtr(0.3), // 低温度确保计算精确
        }),
        llmagent.WithTools([]tool.Tool{calculateTool}),
    )
}
```

四个子 Agent 及其工具：

| Agent | 工具 | 温度 | 职责 |
|-------|------|------|------|
| `math-agent` | `calculate` | 0.3 | 数学运算（加减乘除、幂运算） |
| `weather-agent` | `get_weather` | 0.5 | 天气查询与活动建议 |
| `research-agent` | `search` | 0.7 | 信息检索与知识问答 |
| `time-agent` | `calculate_time_diff` | 0.4 | 时间差计算与时长分析 |

温度参数的选择反映了任务特性：精确计算任务用低温度，创意性研究任务用较高温度。

**2. 创建协调者并挂载子 Agent**

```go
func (c *transferChat) createCoordinatorAgent(
    modelInstance model.Model, subAgents []agent.Agent,
) agent.Agent {
    return llmagent.New("coordinator-agent",
        llmagent.WithInstruction(`You are a coordinator agent...
Available sub-agents:
- math-agent: For mathematical calculations
- weather-agent: For weather information
- research-agent: For research and knowledge questions
- time-agent: For time calculations

When a user asks a question:
1. Analyze what type of task it is
2. Use transfer_to_agent to delegate to the appropriate specialist
3. If unsure, ask the user for clarification`),
        llmagent.WithSubAgents(subAgents),
        llmagent.WithEndInvocationAfterTransfer(c.endInvocationAfterTransfer),
    )
}
```

协调者的指令中列出所有可用子 Agent 及其能力描述，帮助 LLM 做出正确的路由决策。`WithSubAgents` 使框架自动注入 `transfer_to_agent` 工具。

**3. 处理转移事件**

```go
func (c *transferChat) handleTransfer(
    event *event.Event, currentAgent *string, assistantStarted *bool,
) bool {
    if event.Object == model.ObjectTypeTransfer {
        fmt.Printf("\n🔄 Transfer Event: %s\n",
            event.Response.Choices[0].Message.Content)
        *currentAgent = c.getAgentFromTransfer(event)
        *assistantStarted = false
        return true
    }
    return false
}
```

通过检查 `event.Object == model.ObjectTypeTransfer` 识别转移事件，从事件内容中解析目标 Agent 名称，并更新当前 Agent 状态以正确显示后续输出。

**4. 工具实现示例**

以时间差计算工具为例，展示了 tRPC-Agent-Go 的工具实现模式：

```go
type timeDiffArgs struct {
    StartTime string `json:"startTime" jsonschema:"description=Start time...,required"`
    EndTime   string `json:"endTime" jsonschema:"description=End time...,required"`
}

func (c *transferChat) calculateTimeDiff(
    _ context.Context, args timeDiffArgs,
) (timeDiffResult, error) {
    // 支持多种时间格式
    formats := []string{time.RFC3339, "2006-01-02 15:04:05", ...}
    // 解析、计算、返回结构化结果
    return timeDiffResult{Duration: duration.String(), Days: days, ...}, nil
}
```

框架通过 `json` 和 `jsonschema` 标签自动生成工具的 JSON Schema，LLM 据此生成正确的调用参数。

## 运行方式

**环境准备：**

```bash
export OPENAI_API_KEY="your-api-key"
export OPENAI_BASE_URL="https://api.deepseek.com/v1"  # 可选
```

**运行命令：**

```bash
cd examples/transfer
go run .
go run . -debug               # 启用调试日志，追踪转移事件顺序
go run . -end-invocation       # 协调者转移后立即结束
go run . -model gpt-4o-mini   # 指定模型
```

**预期输出：**

```
👤 You: Calculate the power of 2 to 10
🎯 Coordinator: I'll transfer this to our math specialist.
🔄 Initiating transfer...
🔄 Transfer Event: Transferring control to agent: math-agent
🧮 Math Specialist: I'll calculate 2^10 step by step.
🔧 🧮 executing tools:
   • calculate ({"operation":"power","a":2,"b":10})
   ✅ Tool completed
The result is 1024.

👤 You: What's the weather like in Tokyo?
🎯 Coordinator: Let me transfer to our weather specialist.
🔄 Transfer Event: Transferring control to agent: weather-agent
🌤️ Weather Specialist: ...
```

## 总结

Transfer 模式的核心优势在于：

- **自动路由**：协调者根据用户意图智能选择专家
- **完整委派**：控制权完全移交给子 Agent，子 Agent 可独立使用自己的工具集
- **模块化扩展**：新增子 Agent 只需创建 Agent + 更新协调者指令

本示例也展示了良好的代码组织实践——将每个子 Agent 放在独立文件中（`agent_math.go`、`agent_weather.go` 等），便于团队协作和维护。

与其他多 Agent 示例的关联：

- **multiagent/chain**：链式是固定顺序的编排，Transfer 是动态路由的委派
- **team/swarm**：Swarm 的底层也基于 `transfer_to_agent`，但提供了更完整的团队管理能力（跨请求保持、历史共享等）
- **team/coord**：Coordinator 将成员作为工具反复调用并整合，Transfer 则是一次性完整委派
