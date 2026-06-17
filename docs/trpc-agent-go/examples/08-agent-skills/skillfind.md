# SkillFind - 从 GitHub 发现、安装和加载公开 Agent Skills

## 概述

本示例展示了一个完整的 Skill 发现流程：通过内置的 `skill-find` 技能，Agent 能够在 GitHub 上搜索公开的 Skill 仓库，将其安装到本地用户目录，并在同一对话中立即加载使用。这是框架中唯一涉及动态 Skill 安装的实战示例。

## 核心概念

### 多根 Skill 仓库

本示例使用了 `skill.NewFSRepository` 的多目录特性，同时管理公共技能和用户私有技能：

```go
repo, err := skill.NewFSRepository(
    c.commonSkillsDir,  // 内置技能目录
    c.userSkillsDir,    // 用户安装的技能目录
)
```

新安装的技能写入 `userSkillsDir`，通过 `repo.Refresh()` 即时刷新仓库索引，使新技能在同一会话中可见。

### GitHub Skill 安装器

`skill_install_github` 是一个自定义工具，支持从 GitHub 的 tree URL、blob URL 和 raw URL 安装 Skill 目录。安装过程包括：

1. 解析 GitHub URL，提取 owner/repo/ref/path
2. 通过 GitHub Contents API 递归下载文件（失败时回退到 ZIP 归档下载）
3. 从 `SKILL.md` 的 YAML front matter 中读取技能名称
4. 将文件移入用户技能目录，刷新仓库

### Web 搜索集成

内置 `web_search` 工具使用 DuckDuckGo HTML 搜索，让模型能够主动在公网上查找包含 `SKILL.md` 的 GitHub 仓库。

## 代码解析

**Agent 配置**：根据 `-allow-skill-run` 标志决定 Skill Tool Profile：

```go
func skillToolProfile(allowSkillRun bool) llmagent.SkillToolProfile {
    if allowSkillRun {
        return llmagent.SkillToolProfileFull
    }
    return llmagent.SkillToolProfileKnowledgeOnly
}
```

默认使用 `KnowledgeOnly`，只允许搜索、安装和加载，不允许执行下载的代码。

**交互命令**：支持 `/skills`（列出已安装技能）、`/reset-skills`（清空用户技能目录）、`/new`（开启新会话）等命令。

**安全设计**：安装器内置了多项安全限制——最多 64 个文件、单文件不超过 256KB、总大小不超过 1MB，且不允许路径逃逸。

## 运行方式

```bash
cd examples/skillfind
export OPENAI_API_KEY="your-key"
export OPENAI_BASE_URL="https://your-endpoint/v1"

# 默认安全模式（不执行代码）
go run . -reset-user-skills \
  -prompt "Use the skill-find skill to find the public hello skill from the OpenClaw skill pack on GitHub, install it, and load it."

# 启用代码执行
go run . -allow-skill-run -reset-user-skills \
  -prompt "... install it, load it, and run it."
```

需要网络访问 GitHub 和 DuckDuckGo。

## 总结

本示例展示了 Skill 系统的动态扩展能力：不仅可以使用预置技能，还能在运行时从公共仓库发现和安装新技能。这对于构建可扩展的 Agent 应用特别有价值。与 skillisolation 示例结合学习，可以了解多 Agent 场景下技能隔离的重要性。
