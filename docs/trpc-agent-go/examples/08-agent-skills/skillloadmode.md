# SkillLoadMode - 控制 Skill 加载内容的生命周期

## 概述

本示例演示了 `SkillLoadMode` 选项如何控制已加载 Skill 的 `SKILL.md` 内容在模型提示词中的留存时间。通过运行两轮对话并打印 Skill 状态键的变化，直观展示三种模式（`turn`、`once`、`session`）的行为差异。本示例使用 Mock 模型，无需 API Key。

## 核心概念

### 三种加载模式

当模型调用 `skill_load` 后，框架在 Session 状态中写入标记键，Skill 请求处理器读取这些键并将内容注入到下一次模型请求中。`SkillLoadMode` 控制这些键的清理时机：

| 模式 | 行为 |
|------|------|
| `turn`（默认） | 加载内容在当前轮次（一次 `Runner.Run`）内有效，下一轮开始前自动清除 |
| `once` | 加载内容仅注入到**下一次**模型请求，之后立即清除 |
| `session` | 加载内容在整个 Session 生命周期内持续有效 |

### 状态键结构

框架使用多层状态键管理 Skill 加载状态：

```
temp:skill:loaded_by_agent:<agent>/<name>     - 标记加载状态
temp:skill:docs_by_agent:<agent>/<name>       - 选中的文档
temp:skill:loaded_order_by_agent:<agent>      - 加载顺序（JSON 数组）
```

加载顺序键用于配合 `WithMaxLoadedSkills(N)` 实现滑动窗口，保留最近 N 个技能。

### 内容物化位置

默认情况下，加载的 Skill 内容追加到系统提示词中。也可以通过 `WithSkillsLoadedContentInToolResults(true)` 将内容物化到对应的工具结果消息（`skill_load` 的返回值）中。

## 代码解析

**Mock 模型**：`stepModel` 是一个确定性模型，第一步调用 `skill_load`，第二步返回 assistant 消息：

```go
func (m *stepModel) GenerateContent(ctx context.Context, _ *model.Request) (<-chan *model.Response, error) {
    m.step++
    switch m.step {
    case 1:
        return toolCallResponse("call-1", "skill_load", ...)
    case 2:
        return assistantResponse("loaded and ready")
    default:
        return assistantResponse("done")
    }
}
```

**两轮执行**：第一轮中模型调用 `skill_load`，第二轮中没有工具调用。通过对比两轮后的状态键，可以观察不同模式下的清理行为。

**状态打印**：`printSkillState` 函数查询 Session 中所有 Skill 相关的状态键并输出其值（`1` 表示已加载，`<cleared>` 表示已清除）。

## 运行方式

```bash
cd examples/skillloadmode

# 默认 turn 模式
go run .

# 尝试不同模式
go run . -mode turn
go run . -mode once
go run . -mode session

# 启用工具结果物化
go run . -tool-results=true
```

在 `turn` 模式下，第一轮后状态键存在，第二轮开始时被清除。

## 总结

`SkillLoadMode` 是优化 Skill 使用体验的关键配置。`turn` 模式适合大多数场景，`once` 适合一次性查询类技能以节约 Token，`session` 适合需要持续参考的知识类技能。本示例与 skillisolation 共同构成了 Skill 状态管理的完整知识体系。
