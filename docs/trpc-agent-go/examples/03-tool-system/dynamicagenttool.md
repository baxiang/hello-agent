# 动态子 Agent 工具 - 按需组装子 Agent 的工具与指令

## 概述

`dynamicagenttool` 示例演示了 `agenttool.NewDynamicTool`：一个单一的 `dynamic_agent` 入口，由模型在每次调用时从预定义的安全边界中选择工具子集和指令，动态生成一个短生命周期的子 Agent 来执行任务。适用于工具池较大但每个任务只需少量工具的场景。

## 核心概念

与固定包装一个 Agent 的 `agenttool.NewTool` 不同，动态工具让模型在每次调用时决定：
- **tools**：子 Agent 可以使用哪些工具（从预定义集合中选择）
- **instruction**：子 Agent 本次任务的角色/指令

| 机制 | 模型选择什么 | 生命周期 | 控制权返回 |
|------|------------|---------|----------|
| `agenttool.NewTool` | 无（固定 Agent） | 每次调用 | 是 |
| `transfer_to_agent` | N 个预注册 Agent 之一 | 当前轮次剩余 | 否 |
| **`NewDynamicTool`** | **工具子集 + 指令** | **每次调用** | **是** |

## 代码解析

### 两种运行模式

**minimal 模式**：编排器同时注册工作空间工具和 `dynamic_agent`，模型可直接调用工具或通过子 Agent 委派。

```go
dynamicTool := agenttool.NewDynamicTool(common...)
orchestratorTools = append(workspaceTools, dynamicTool)
```

**bounded 模式**：编排器只注册 `dynamic_agent`，工作空间工具隐藏在 `WithCapabilityTools` 背后，实现渐进式工具披露。

```go
subTemplate := llmagent.New("subagent",
    llmagent.WithModel(modelInstance),
    llmagent.WithInstruction("You are a focused worker sub-agent..."),
)

dynamicTool := agenttool.NewDynamicTool(
    agenttool.WithTemplateAgent(subTemplate),
    agenttool.WithCapabilityTools(workspaceTools),
    // ...
)
orchestratorTools = []tool.Tool{dynamicTool}  // 只有 dynamic_agent
```

### 安全边界

- 模型不能选择任意 Agent、模型或执行器，只能从配置的工具集中选择子集
- `dynamic_agent` 和 `transfer_to_agent` 会自动从子 Agent 的工具面中移除，防止递归
- 子 Agent 默认隔离（`HistoryScopeIsolated`），看不到父级对话

### bounded 模式的优势

```go
agenttool.WithCapabilityTools(workspaceTools)
```

- **渐进式工具披露**：父模型只看到工具名称枚举，完整的参数 schema 仅在子 Agent 内部暴露
- **最小权限委派**：编排器不能直接调用工作空间工具，必须通过子 Agent
- **代码定义边界**：可选工具面在代码中固定，模型只能选择子集

## 运行方式

```bash
cd examples/dynamicagenttool
export OPENAI_API_KEY="your-key"

# minimal 模式（默认）
go run .

# bounded 模式（推荐用于生产）
go run . -mode=bounded
```

示例提示：
```
Use a sub-agent to compute (123 * 456) + 789. Grant it only the calculator.
Use one sub-agent to compute 50 * 12, and a separate sub-agent to count words in "hello world".
```

## 总结

- `NewDynamicTool` 适用于工具池大、组合多的场景，避免为每种组合预定义一个 Agent
- bounded 模式是生产环境推荐的结构，实现最小权限和渐进披露
- 子 Agent 的工具选择和指令由模型决定，但安全边界由代码控制
- 与 [agenttool](./agenttool.md) 的区别在于灵活性：固定 Agent vs 动态组装
