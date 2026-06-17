# 沙箱代码执行示例 - 安全隔离下的 Agent 代码执行

## 概述

本示例深入演示了 `codeexecutor/sandbox` 沙箱执行器的安全能力，涵盖了工作空间隔离、环境变量脱敏、文件访问控制、网络策略、超时限制、输出截断等 30 多个场景。它既包含 LLM Agent 集成场景（通过 `workspace_exec` 工具调用），也包含确定性的运行时行为验证，是理解框架安全模型的核心参考。

## 核心概念

**Sandbox Runtime**：沙箱运行时负责创建隔离的工作空间并在其中执行程序。在 Linux 上基于 `bwrap`（bubblewrap）实现用户命名空间隔离，在 macOS 上提供基础的文件系统隔离。

**Permission Profile（权限配置）**：通过 `sandbox.WorkspaceWriteProfile()` 创建基础可写权限配置，再通过 `.WithNoAccessPaths()` 等方法叠加 no-access 规则。权限模型支持四种访问级别：可写（write）、只读（read）、无访问（no-access）和元数据保护（metadata protection）。

**Workspace Isolation（工作空间隔离）**：每个 Session 拥有独立的工作空间目录，不同 Session 之间的文件系统完全隔离。同一 Session 内多次执行共享工作空间，实现状态持久化。

**Shell Environment Policy（Shell 环境策略）**：控制沙箱进程能继承哪些宿主环境变量。提供 `InheritAll`（继承全部）、`InheritCore`（仅继承 Shell 启动变量）、`None`（清空）、`IncludeOnly`（白名单）和 `Exclude`（黑名单）五种策略。

**workspace_exec 工具**：框架内置的 Agent 工具，允许 LLM 通过函数调用在沙箱中执行命令，配合 Tool Callbacks 可追踪每次调用的输入输出。

## 代码解析

### 基础场景：Agent + 沙箱执行

```go
exec := sandbox.New(commonOptions(cfg, sandbox.WorkspaceWriteProfile(), 1<<20, 10*time.Second)...)
agent := llmagent.New(
    "sandbox_code_agent",
    llmagent.WithModel(openai.New(cfg.modelName)),
    llmagent.WithInstruction("Use code execution for arithmetic..."),
    llmagent.WithCodeExecutor(exec),
)
r := runner.NewRunner("sandbox_code_agent", agent)
defer r.Close()
```

`sandbox.New()` 接收一组 Option，包括工作空间根目录、权限配置、输出上限和默认超时。作为 `CodeExecutor` 注入 Agent 后，LLM 生成的代码块会自动在沙箱中执行。

### Session 隔离验证

```go
s1, _ := rt.CreateWorkspace(ctx, "s1", codeexecutor.WorkspacePolicy{})
rt.RunProgram(ctx, s1, codeexecutor.RunProgramSpec{
    Cmd: "bash", Args: []string{"-c", "printf s1 > marker.txt"},
})
s2, _ := rt.CreateWorkspace(ctx, "s2", codeexecutor.WorkspacePolicy{})
res, _ := rt.RunProgram(ctx, s2, codeexecutor.RunProgramSpec{
    Cmd: "bash", Args: []string{"-c", "test ! -f marker.txt && echo isolated"},
})
expectContains(res.Stdout, "isolated")
```

在 Session `s1` 中创建文件，然后在 Session `s2` 中验证该文件不可见，确认工作空间之间的完全隔离。

### 环境变量脱敏

```go
rt := newRuntime(cfg, sandbox.WorkspaceWriteProfile(), 1<<20, 3*time.Second,
    sandbox.WithShellEnvironmentPolicy(sandbox.ShellEnvironmentPolicy{
        Inherit: sandbox.ShellEnvironmentPolicyInheritCore,
    }),
)
res, _ := rt.RunProgram(ctx, ws, codeexecutor.RunProgramSpec{
    Cmd: "bash", Args: []string{"-c", `if [ -z "$OPENAI_API_KEY" ]; then echo hidden; fi`},
})
```

使用 `InheritCore` 策略后，沙箱进程不会继承 `OPENAI_API_KEY` 等敏感环境变量，防止 Agent 生成的代码泄露密钥。

### Agent Tool 场景：安全性验证

```go
h, _ := newAgentToolHarness(ctx, cfg, profile, manifest,
    withAgentToolSandboxOptions(sandbox.WithShellEnvironmentPolicy(...)),
)
final, _ := h.runTurn(ctx, "agent-tool-security",
    `Use workspace_exec to verify: 1. OPENAI_API_KEY is empty. 2. Reading work/secret.env is denied.`)
```

`agentToolHarness` 封装了完整的 Agent 测试框架，通过 `tool.Callbacks` 记录每次工具调用的输入输出，验证 Agent 在沙箱约束下的行为符合预期。

## 运行方式

**环境准备**：

```bash
export OPENAI_API_KEY="your-api-key"
export OPENAI_BASE_URL="https://api.openai.com/v1"
```

**运行全部场景**：

```bash
cd examples
go run ./sandboxcodeexecution -scenario all -model glm-4.7-flash
```

**运行单个场景**：

```bash
go run ./sandboxcodeexecution -scenario session-isolation
go run ./sandboxcodeexecution -scenario env-redaction
go run ./sandboxcodeexecution -scenario agent-tool-security
```

**关键参数**：
- `-scenario`：场景名称，支持 `all` 或具体场景名
- `-model`：模型名称（Agent 场景需要）
- `-workspace-root`：自定义沙箱工作空间根目录
- `-keep-workspace`：保留生成的工作空间文件
- `-require-os-sandbox`：是否要求 OS 级沙箱（默认 true）

**预期输出**：每个场景输出 `PASS`（通过）、`SKIP`（跳过，如未设置 API Key）或失败信息。未设置 `OPENAI_API_KEY` 时，LLM 相关场景会自动跳过，确定性验证场景仍可执行。

## 总结

本示例是 tRPC-Agent-Go 安全模型的全面演示。核心收获：沙箱权限配置的分层设计（Profile + NoAccess + Policy）实现了灵活且严格的访问控制；环境变量策略有效防止了密钥泄露；工作空间隔离确保了多用户/多会话的数据安全。与 `codeexecution` 示例的关系是：后者展示基础代码执行能力，本示例则聚焦生产环境所需的安全隔离和策略管控。Artifact 相关场景（stage/save/pin）还展示了沙箱与制品服务的集成模式，适用于需要在沙箱内消费或产出持久化文件的工作流。
