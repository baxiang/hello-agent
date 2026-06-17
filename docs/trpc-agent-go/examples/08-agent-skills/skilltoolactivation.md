# SkillToolActivation - Skill 触发的工具集动态激活

## 概述

本示例演示了 Skill 加载后自动激活额外工具集（ToolSet）的机制。在 `skill_load` 之前，模型只能看到基础工具；加载指定 Skill 之后，新的工具集被动态注入，模型立即获得新增工具的访问权限。这是实现"按需加载工具"的优雅方案。

## 核心概念

### 可激活工具集（Activatable ToolSets）

通过 `WithActivatableToolSets` 注册的工具集在初始状态下不会对模型可见，只有当关联的 Skill 被加载后才会激活：

```go
agt := llmagent.New(agentName,
    llmagent.WithTools([]tool.Tool{calculatorTool()}),
    llmagent.WithActivatableToolSets([]tool.ToolSet{releaseDocs}),
    llmagent.WithToolActivationOnSkillLoad(
        skillName,                          // 触发 Skill 名称
        []string{toolSetName},              // 要激活的 ToolSet 名称
        llmagent.WithToolActivationMode(mode),
        llmagent.WithToolActivationLifetime(lifetime),
    ),
)
```

### 激活模式（Mode）

| 模式 | 行为 |
|------|------|
| `include` | 保留现有用户工具，追加激活的工具集 |
| `only` | 替换现有用户工具，只保留激活的工具集（框架工具如 `skill_load` 始终保留） |

### 激活生命周期（Lifetime）

| 生命周期 | 行为 |
|----------|------|
| `invocation`（默认） | 激活仅在当前调用内有效 |
| `session` | 激活在整个 Session 中持续有效 |

### 工具可见性追踪

示例通过 `BeforeModel` 回调打印每次模型请求前可见的工具名称，直观展示激活前后的工具集变化。

## 代码解析

**ToolSet 创建**：使用 `file.NewToolSet` 创建基于文件系统的工具集，命名为 `release_docs`：

```go
releaseDocs, err := file.NewToolSet(
    file.WithName(toolSetName),
    file.WithBaseDir(root),
    file.WithSaveFileEnabled(false),
)
```

激活后，模型将获得 `release_docs_read_file` 等文件操作工具。

**执行流程**：
1. 模型看到 `calculator`（用户工具）和 `skill_load`（框架工具）
2. 模型调用 `skill_load` 加载 `release-notes` Skill
3. 框架自动激活 `release_docs` 工具集
4. 模型在下一次请求中看到 `release_docs_read_file` 等新工具
5. 模型使用新工具读取 `release_notes.md` 并回答

**SKILL.md 设计**：`release-notes` Skill 的 `SKILL.md` 中描述了何时使用该技能以及如何使用激活后的文件工具，指导模型正确调用。

## 运行方式

```bash
cd examples/skilltoolactivation
export OPENAI_API_KEY="your-key"

# Include 模式（保留 calculator + 追加 release_docs）
go run . -mode include

# Only 模式（替换为 release_docs）
go run . -mode only

# Session 级别持久化
go run . -lifetime session
```

## 总结

Skill 触发的工具激活是框架的高级特性，适用于需要按需加载重型工具集的场景。通过将工具集与 Skill 关联，可以减少初始工具数量、降低 Token 消耗，同时保持灵活性。建议与 skilltoolprofile 对比学习，两者分别从"工具集动态激活"和"内置 Skill 工具 Profile"两个角度管理工具可见性。
