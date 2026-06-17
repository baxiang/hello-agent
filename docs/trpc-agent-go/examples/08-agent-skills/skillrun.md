# SkillRun - 交互式 Skill 执行聊天

## 概述

本示例是一个功能完整的交互式聊天应用，展示了推荐的 Agent Skills 执行路径：`skill_load` + `workspace_exec`。支持流式输出、文件上传、Artifact 存储和多种工作区执行器（local、container、e2b），是新项目集成 Skill 功能的最佳参考。

## 核心概念

### 推荐的 Skill 执行路径

本示例使用框架推荐的执行模式，而非旧版 `skill_run`：

- `skill_load`：加载 Skill 知识到上下文
- `workspace_exec`：在隔离工作区中执行命令
- `workspace_save_artifact`：持久化输出文件

这些工具通过配置 `WithSkills(repo)` + `WithCodeExecutor(exec)` 自动注册，无需指定 `SkillToolProfileFull`。

### 多种执行器

示例支持三种工作区执行器，通过 `-executor` 参数切换：

```go
switch strings.ToLower(*flagExec) {
case "e2b":
    we, err = e2bexec.New()
case "container":
    opts := []containerexec.Option{
        containerexec.WithBindMount(c.skillsRoot, "/opt/trpc-agent/skills", "ro"),
        containerexec.WithAutoInputs(true),
    }
    we = containerexec.New(opts...)
default:
    we = localexec.New(lopts...)
}
```

- `local`：本地直接执行，最简单
- `container`：Docker 容器隔离，支持只读绑定挂载
- `e2b`：云端沙箱执行

### Artifact 服务

通过 `runner.WithArtifactService(svc)` 注入 Artifact 服务（示例使用内存实现），支持将工作区中的输出文件保存为可引用的 Artifact，并通过 `/artifacts` 和 `/pull` 命令管理。

### 用户文件上传

支持三种上传方式：
- `/upload <path>`：内联字节附加
- `/upload_id <path>`：通过模型提供商的 file API 上传
- `/upload_artifact <path>`：上传到 Artifact 服务

上传的文件会被暂存到工作区的 `work/inputs/` 目录，供 Skill 脚本读取。

## 代码解析

**Agent 构建（`buildAgentOptions`）**：

```go
opts := []llmagent.Option{
    llmagent.WithSkills(repo),
    llmagent.WithCodeExecutor(exec),
    llmagent.WithEnableCodeExecutionResponseProcessor(false),
}
```

注意这里没有设置 `WithSkillToolProfile`，使用默认的 `knowledge_only` 配置。框架会根据是否提供了 `CodeExecutor` 自动注册 `workspace_exec` 和 `workspace_save_artifact`。

**工作区环境变量**：脚本执行时可使用以下环境变量：
- `$SKILLS_DIR/<name>`：Skill 工作副本
- `$WORK_DIR`：共享工作目录
- `$OUTPUT_DIR`：统一输出目录（`out/`）

## 运行方式

```bash
cd examples/skillrun
export OPENAI_API_KEY="your-key"

# 基本用法
go run .

# 使用容器执行器
go run . -executor container

# 使用外部 Skills 仓库
export SKILLS_ROOT="../../openclaw/skills"
go run .
```

## 总结

本示例是新项目集成 Agent Skills 的推荐起点。它展示了框架推荐的 `workspace_exec` 执行路径，支持多种执行器和文件管理方式。与 skilltoolprofile 示例对比，可以理解默认配置和显式 Profile 配置的区别。
