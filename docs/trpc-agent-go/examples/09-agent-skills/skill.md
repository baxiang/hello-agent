# Skill（GAIA 基准测试） - 综合展示 Agent Skills 在实际评测任务中的应用

## 概述

本示例以 GAIA 基准测试为背景，展示如何在 trpc-agent-go 中将 Agent Skills 与文件工具、Web 搜索、代码执行器等能力组合使用。它是框架中最完整的 Skill 实战案例，涵盖了音频转录（whisper skill）、图片 OCR（ocr skill）以及 `workspace://` 文件引用等高级用法。

## 核心概念

### Skill 仓库与代码执行器

示例通过 `skill.NewFSRepository` 从本地 `skills/` 目录加载技能仓库，并使用 `localexec.New()` 创建本地代码执行器。两者共同构成 Skill 执行的基础设施：

```go
skillRepo, err = skill.NewFSRepository(skillsRoot)
codeExec = localexec.New(
    localexec.WithWorkDir(filepath.Join(absDataDir, "..", "skill_workspaces")),
    localexec.WithWorkspaceInputsHostBase(absDataDir),
)
```

### Skill Tool Profile

示例使用 `llmagent.SkillToolProfileFull`，注册完整的 Skill 工具集（`skill_load`、`skill_run` 等），这是因为 GAIA 任务需要实际执行脚本来处理音频和图像文件。

### 工作区引用机制

Skill 脚本在隔离的工作区中执行，输出文件不会自动对普通文件工具可见。示例通过 `workspace://` 引用和 `tryReadFileRef` 函数实现跨工具的文件传递，支持 `workspace://`、`artifact://` 两种 URI 协议。

## 代码解析

**Agent 构建（`createGAIAAgent`）**：组装模型、搜索工具（DuckDuckGo、Wikipedia、arXiv）、文件工具和 Skill 配置。关键配置包括：

```go
agentOpts = append(agentOpts,
    llmagent.WithSkills(skillRepo),
    llmagent.WithSkillToolProfile(llmagent.SkillToolProfileFull),
    llmagent.WithCodeExecutor(codeExec),
    llmagent.WithEnableCodeExecutionResponseProcessor(false),
)
```

`WithEnableCodeExecutionResponseProcessor(false)` 确保只通过工具调用执行代码，而非自动解析 assistant 回复中的代码块。

**任务执行（`runSingleTask`）**：为每个任务构建提示词，根据文件类型自动添加 Skill 使用提示（音频文件引导使用 whisper skill，图像文件引导使用 ocr skill），然后通过 Runner 驱动 Agent 完成问答。

## 运行方式

```bash
cd examples/skill
export OPENAI_API_KEY="your-key"
export OPENAI_BASE_URL="https://your-endpoint/v1"

# 运行单个任务
go run . -data-dir ./data -dataset ./data/gaia_2023_level1_validation.json -model "your-model" -task-id 31
```

需要提前准备 GAIA 数据集（JSON 文件和附件），以及 Python 环境（whisper、pytesseract）。

## 总结

本示例是框架 Skill 能力的集大成者，展示了从 Skill 仓库加载、隔离工作区执行到跨工具文件引用的完整链路。建议先学习后续的独立示例（skillrun、skilltoolprofile 等）掌握各子功能，再回来研究本示例的综合用法。
