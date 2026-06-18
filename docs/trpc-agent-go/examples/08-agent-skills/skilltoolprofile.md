# SkillToolProfile - 控制 Skill 内置工具的注册范围

## 概述

本示例演示了 `WithSkillToolProfile` 选项如何控制框架注册哪些内置 Skill 工具。通过切换 `full` 和 `knowledge_only` 两种 Profile，观察注册的工具列表和执行流程的差异。本示例使用 Mock 模型，无需 API Key。

## 核心概念

### 两种 Skill Tool Profile

| Profile | 注册工具 | 说明 |
|---------|----------|------|
| `full` | `skill_load`、`skill_list_docs`、`skill_select_docs`、`skill_run` 等 | 完整功能，可执行脚本 |
| `knowledge_only`（默认） | `skill_load`、`skill_list_docs`、`skill_select_docs` | 仅加载知识，不可执行代码 |

`knowledge_only` 是安全默认选择，适用于只需要 Skill 知识内容而不需要执行脚本的场景。`full` Profile 需要配合 `WithCodeExecutor` 使用。

### 渐进式信息披露

`knowledge_only` Profile 支持一种渐进式的信息获取模式：

1. `skill_load`：加载 SKILL.md 核心内容
2. `skill_list_docs`：列出可选的补充文档
3. `skill_select_docs`：选择性加载特定文档

这种模式节约 Token 开销，只在需要时加载详细文档。

## 代码解析

**Agent 构建**：根据 Profile 决定是否附加代码执行器：

```go
func newProfileAgent(profile llmagent.SkillToolProfile, repo skill.Repository) (*llmagent.LLMAgent, string) {
    opts := []llmagent.Option{
        llmagent.WithSkills(repo),
        llmagent.WithSkillToolProfile(profile),
    }
    if profile == llmagent.SkillToolProfileFull {
        opts = append(opts,
            llmagent.WithCodeExecutor(localexec.New()),
            llmagent.WithEnableCodeExecutionResponseProcessor(false),
        )
    }
    return llmagent.New(agentName, opts...), executorLabel
}
```

**Mock 模型**：`profileModel` 根据 Profile 输出不同的工具调用序列：

- `full`：`skill_load` -> `skill_run`
- `knowledge_only`：`skill_load` -> `skill_list_docs` -> `skill_select_docs`

**工具列表打印**：启动时通过 `listSkillToolNames` 函数列出所有以 `skill_` 开头的已注册工具，直观展示两种 Profile 的差异。

## 运行方式

```bash
cd examples/skilltoolprofile

# Full Profile（包含 skill_run）
go run . -profile full

# Knowledge Only Profile（不包含 skill_run）
go run . -profile knowledge_only
```

输出将显示注册的工具列表和对应的工具调用流程。

## 总结

`SkillToolProfile` 是 Agent Skills 的安全和性能配置。新项目建议从默认的 `knowledge_only` 开始，只在确实需要执行 Skill 脚本时切换到 `full`。注意在推荐的新架构中，大多数情况下无需显式设置此选项——框架会根据是否提供 `CodeExecutor` 自动配置合适的工具。建议与 skillrun 示例对比，理解推荐配置与显式 Profile 配置的关系。
