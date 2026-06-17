# SkillIsolation - 多 Agent 场景下的 Skill 加载隔离

## 概述

本示例演示了多 Agent 架构中的一个关键问题：当子 Agent 调用 `skill_load` 时，加载的 Skill 内容不应泄漏到父级协调者 Agent 的提示词中。trpc-agent-go 通过按 Agent 名称作用域化 Skill 状态键来解决这一问题。

## 核心概念

### Skill 状态键作用域

当 `skill_load` 被调用时，框架在 Session 状态中写入键值对来标记哪些 Skill 已加载。在旧版本中，这些键是无作用域的，导致子 Agent 加载的 Skill 会被注入到共享同一 Session 的父 Agent 提示词中。

新版本使用带 Agent 名称前缀的键：

```
temp:skill:loaded_by_agent:skillisolation-child/demo-skill
```

而非全局的：

```
temp:skill:loaded:demo-skill
```

### 协调者 + 子 Agent 模式

示例使用 `agenttool.NewTool(child)` 将子 Agent 包装为工具，供协调者调用：

```go
child := llmagent.New(childAgentName,
    llmagent.WithModel(mdl),
    llmagent.WithSkills(repo),
    llmagent.WithInstruction(childInstruction()),
)
childTool := agenttool.NewTool(child)

coordinator := llmagent.New(coordinatorAgentName,
    llmagent.WithSkills(repo),
    llmagent.WithTools([]tool.Tool{childTool}),
    llmagent.WithModelCallbacks(coordinatorCallbacks()),
)
```

### BeforeModel 回调观测

通过 `model.Callbacks` 注册 `BeforeModel` 钩子，在每次模型请求前检查系统消息中是否包含 `[Loaded] demo-skill` 标记，从而验证隔离效果。

## 代码解析

**验证逻辑**：协调者的 `BeforeModel` 回调在两个关键时间点触发：

1. 模型决定调用子 Agent 工具之前
2. 子 Agent 工具返回之后

在第二个检查点，应该能观察到：
- Session 中存在子 Agent 的加载键 `temp:skill:loaded_by_agent:skillisolation-child/demo-skill`
- 协调者的系统消息中**不包含** `[Loaded] demo-skill`

**状态检查函数**：

```go
func loadedSkillNames(inv *agent.Invocation, agentName string) []string {
    prefix := skill.LoadedPrefix(agentName)
    for k, v := range state {
        if strings.HasPrefix(k, prefix) {
            out = append(out, strings.TrimPrefix(k, prefix))
        }
    }
    return out
}
```

通过指定不同的 `agentName` 参数，可以分别查询协调者和子 Agent 各自加载了哪些技能。

## 运行方式

```bash
cd examples/skillisolation
export OPENAI_API_KEY="your-key"
go run . -model gpt-5
```

输出中关注两个关键行：
- `has "[Loaded] demo-skill" in system: false` — 确认协调者未被注入
- `child loaded key present: true` — 确认子 Agent 的加载状态存在

## 总结

Skill 隔离是构建多 Agent 系统时的重要安全考量。本示例清晰地展示了框架如何通过作用域化状态键实现隔离，避免子 Agent 的 Skill 内容污染父 Agent 的上下文。建议与 skillloadmode 示例对比学习，理解 Skill 状态的完整生命周期管理。
