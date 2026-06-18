# 工作空间IO - Agent调用前后的文件同步与持久化

## 概述

`workspace_io` 示例演示了如何在 Agent 调用前后通过 `workspaceio.Workspace` 管理工作空间文件。通过 `BeforeAgent` 回调预置文件，`AfterAgent` 回调收集并持久化文件到外部存储，实现 Agent 工作产物的自动化管理。

## 核心概念

**Workspace** 是框架提供的文件操作抽象，与 `CodeExecutor`（代码执行器）配合工作。核心操作包括：

- `workspaceio.WorkspaceFromContext(ctx)` - 从上下文获取 Workspace 实例
- `ws.PutFiles(ctx, files...)` - 向工作空间写入文件
- `ws.Collect(ctx, pattern)` - 按 glob 模式收集文件

框架的设计理念是**将持久化策略交给调用方**——Agent 不自带 flush 选项，而是通过 `AgentCallbacks` 让开发者自行控制时机、错误处理和存储目标。

## 代码解析

**Agent 配置中注册回调并启用 LocalCodeExecutor：**

```go
cb := agent.NewCallbacks()
cb.RegisterBeforeAgent(seedWorkspaceProfile)
cb.RegisterAfterAgent(mirrorSkillsAfterAgent(sink))

a := llmagent.New("workspace-flush-demo",
    llmagent.WithCodeExecutor(localexec.New()),
    llmagent.WithAgentCallbacks(cb),
)
```

**BeforeAgent 回调预置文件：**

```go
func seedWorkspaceProfile(ctx context.Context, args *agent.BeforeAgentArgs) (*agent.BeforeAgentResult, error) {
    ws, ok := workspaceio.WorkspaceFromContext(ctx)
    if !ok {
        return nil, nil
    }
    return nil, ws.PutFiles(ctx,
        codeexecutor.PutFile{Path: "skills/echoer/SKILL.md", Content: []byte("# Echoer\n...")},
        codeexecutor.PutFile{Path: "skills/greeter/SKILL.md", Content: []byte("# Greeter\n...")},
    )
}
```

**AfterAgent 回调收集并持久化：**

```go
func mirrorSkillsAfterAgent(sink *directorySink) agent.AfterAgentCallbackStructured {
    return func(ctx context.Context, args *agent.AfterAgentArgs) (*agent.AfterAgentResult, error) {
        if args.Error != nil {
            return nil, nil  // Agent 失败时跳过
        }
        ws, _ := workspaceio.WorkspaceFromContext(ctx)
        files, _ := ws.Collect(ctx, "skills/*/SKILL.md")
        for _, f := range files {
            sink.Save(ctx, args.Invocation, f)
        }
        return nil, nil
    }
}
```

`directorySink` 将文件保存到本地目录，并包含路径安全检查（`filepath.IsLocal`），防止路径逃逸。

## 运行方式

```bash
cd examples

export OPENAI_API_KEY="your-key"

go run ./workspace_io -model=deepseek-v4-flash

# 自定义存储目录
go run ./workspace_io -store=./my_store -prompt="Hello!"
```

运行后 `./skills_store` 目录下会出现同步的 SKILL.md 文件。

## 总结

Workspace IO 模式为 Agent 的文件输入输出提供了标准化的管道。这种"回调驱动"的设计让持久化逻辑完全由业务层控制，可以轻松替换为数据库、对象存储或 HTTP 服务。在实际部署中，`LocalCodeExecutor` 可替换为容器化沙箱或远程执行环境。
