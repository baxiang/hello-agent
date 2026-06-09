# Server、可观测性与生态

本文涵盖 tRPC-Agent-Go 的 HTTP 服务层、可观测性体系、以及 Skill/Artifact/Planner 等辅助模块。

---

## 一、Server 服务层

### 1. Gateway

```go
import "trpc.group/trpc-go/trpc-agent-go/server/gateway"

gateway.NewServer(
    gateway.WithRunner(runner),
    gateway.WithPort(8080),
    gateway.WithHost("0.0.0.0"),
)
```

提供基础的 HTTP API 网关，将 Agent 能力对外暴露。

### 2. AG-UI（Agent-User Interaction）

基于 SSE 的实时交互协议：

| 路由 | 功能 | 说明 |
|------|------|------|
| `/agui/chat` | 实时对话 | SSE 流式推送，支持 tool call 可视化 |
| `/agui/history` | 消息快照 | 获取完整对话历史 |
| `/agui/cancel` | 取消运行 | 取消当前正在执行的对话 |

```go
import "trpc.group/trpc-go/trpc-agent-go/server/agui"

agui.NewServer(
    agui.WithRunner(runner),
    agui.WithPort(8081),
)
```

**客户端集成**：支持 CopilotKit 和 TDesign Chat 组件。

**事件转换**：Node EventEmitter 发射的自定义事件会自动转换为 AG-UI 协议事件：

| Node Event | AG-UI Event |
|------------|-------------|
| CustomEvent | `CustomEvent` |
| ProgressEvent | `CustomEvent`（含 progress/message） |
| TextEvent（消息上下文内） | `TextMessageContentEvent` |
| TextEvent（消息上下文外） | `CustomEvent`（含 nodeId/content） |

### 3. A2A（Agent-to-Agent）

跨框架 Agent 互操作协议：

```go
import "trpc.group/trpc-go/trpc-agent-go/agent/a2aagent"

a2aAgent := a2aagent.New(
    a2aagent.WithA2AClient(a2aClient),
)
```

### 4. OpenClaw Runtime

类似 OpenClaw 的 Gateway 实现，支持 Telegram + Gateway 集成：

```go
import "trpc.group/trpc-go/trpc-agent-go/openclaw-runtime"

// 稳定 Session IDs，持久化序列化
// 安全控制：allowlist + mention 门控
```

---

## 二、可观测性

### 1. OpenTelemetry

```go
import "trpc.group/trpc-go/trpc-agent-go/telemetry"

// OTLP 导出
cleanup, _ := telemetry.SetupOTLP(ctx,
    telemetry.WithEndpoint("localhost:4317"),
    telemetry.WithServiceName("my-agent-service"),
)
defer cleanup(ctx)
```

自动采集：
- Agent Run 调用链
- Model 调用耗时
- Tool 执行追踪
- Session 操作记录

### 2. Langfuse 集成

```go
import "trpc.group/trpc-go/trpc-agent-go/telemetry/langfuse"

clean, _ := langfuse.Start(ctx)
defer clean(ctx)

runner := runner.NewRunner("app", agent)
events, _ := runner.Run(ctx, "user-1", "session-1", message,
    agent.WithSpanAttributes(
        attribute.String("langfuse.user.id", "user-1"),
        attribute.String("langfuse.session.id", "session-1"),
    ))
```

### 3. 执行 Trace

```go
import "trpc.group/trpc-go/trpc-agent-go/agent/trace"

trace := agent.GetExecutionTrace(invocation)
```

记录每次调用的完整执行路径。

### 4. Debug Server

框架内置调试服务器，提供可视化调试界面和实时监控。

---

## 三、Skill 技能系统

Agent Skills 遵循 Anthropic Agent Skills 规范：

```go
import (
    "trpc.group/trpc-go/trpc-agent-go/skill"
    "trpc.group/trpc-go/trpc-agent-go/tool/skilltool"
    "trpc.group/trpc-go/trpc-agent-go/codeexecutor/local"
)

// 从本地目录加载 Skills
repo, _ := skill.NewFSRepository("./skills")

// 也支持 HTTP(S) URL、多个根目录
// repo, _ := skill.NewFSRepository("./shared-skills", "./user-skills")
// repo, _ := skill.NewFSRepository("https://example.com/skills.zip")

tools := []tool.Tool{
    skilltool.NewLoadTool(repo),    // skill_load：加载技能
    skilltool.NewRunTool(repo, localexec.New()), // skill_run：在隔离工作区执行
}

agent := llmagent.New("skilled-assistant",
    llmagent.WithModel(modelInstance),
    llmagent.WithTools(tools),
    llmagent.WithCodeExecutor(localexec.New()),
    // 禁用代码块自动执行（skill_run 负责命令执行）
    llmagent.WithEnableCodeExecutionResponseProcessor(false),
)
```

### 完整 Skill 工具列表

| 工具 | 说明 |
|------|------|
| `skill_load` | 加载指定 skill 的 SKILL.md |
| `skill_list_docs` | 列出 skill 的文档文件 |
| `skill_select_docs` | 选择 skill 的文档子集 |
| `skill_run` | 在隔离工作区执行命令（默认单次） |
| `skill_exec` | 交互式程序运行 |
| `skill_write_stdin` | 向交互式程序写入 stdin |
| `skill_poll_session` | 轮询交互式会话状态 |
| `skill_kill_session` | 终止交互式会话 |

### 热更新

```go
// 在长生命周期进程中，安装/删除/重命名 Skill 后调用
repo.Refresh()
```

### 安全检查

- 执行隔离在 Workspace 中
- `skill_run` 命令策略模式可限制可执行的命令
- 环境变量清洗（policy mode 下移除敏感变量）

---

## 四、Artifact 制品存储

版本化的文件制品存储，用于保存 Agent 和工具生成的图片、文本、报告等。

```go
import (
    "trpc.group/trpc-go/trpc-agent-go/artifact"
    artifactinmemory "trpc.group/trpc-go/trpc-agent-go/artifact/inmemory"
    "trpc.group/trpc-go/trpc-agent-go/artifact/cos"
    "trpc.group/trpc-go/trpc-agent-go/artifact/s3"
)

// In-Memory（开发测试）
artifactService := artifactinmemory.NewService()

// 腾讯云 COS
artifactService, _ := cos.NewService(
    cos.WithBucket("my-bucket"),
    cos.WithRegion("ap-guangzhou"),
)

// AWS S3
artifactService, _ := s3.NewService(
    s3.WithBucket("my-bucket"),
    s3.WithRegion("us-east-1"),
)

agent := llmagent.New("artifact-agent",
    llmagent.WithModel(modelInstance),
)

r := runner.NewRunner("app", agent,
    runner.WithArtifactService(artifactService),
)
```

### API

| 操作 | 说明 |
|------|------|
| `SaveArtifact` | 保存制品（自动版本化） |
| `LoadArtifact` | 加载指定版本 |
| `ListArtifacts` | 列出所有版本 |
| `DeleteArtifact` | 删除指定版本 |

---

## 五、Planner 规划器

Planner 提供 Agent 规划和推理能力，帮助 Agent 确定最优策略和工具选择。

```go
import "trpc.group/trpc-go/trpc-agent-go/planner"

agent := llmagent.New("planning-agent",
    llmagent.WithModel(modelInstance),
    llmagent.WithPlanner(planner.NewBuiltinPlanner()),
)
```

内置 Planner 支持：
- 任务分解（将复杂任务拆分为子任务）
- 工具选择（根据任务需求选择合适工具）
- 执行顺序规划

---

## 六、Code Executor 代码执行器

支持多种执行环境：

| 执行器 | 包路径 | 场景 |
|--------|--------|------|
| **Local** | `codeexecutor/local` | 本地进程执行 |
| **E2B** | `codeexecutor/e2b` | 云端安全沙箱 |
| **Container** | `codeexecutor/container` | Docker 容器 |
| **Jupyter** | `codeexecutor/jupyter` | Jupyter Notebook |

```go
import "trpc.group/trpc-go/trpc-agent-go/codeexecutor/local"

executor := localexec.New(
    localexec.WithWorkDir("/tmp/agent-workspace"),
    localexec.WithTimeout(30*time.Second),
)

agent := llmagent.New("coder",
    llmagent.WithModel(modelInstance),
    llmagent.WithCodeExecutor(executor),
)
```

---

## 七、Evaluation 评测框架

```go
import "trpc.group/trpc-go/trpc-agent-go/evaluation"

evaluator, _ := evaluation.New("app", runner,
    evaluation.WithNumRuns(3),
)
defer evaluator.Close()

result, _ := evaluator.Evaluate(ctx, "math-basic")
fmt.Println(result.OverallStatus) // "passed" / "failed"
```

特性：
- 可重复的评测集
- 可插拔的评估指标
- 本地文件 / 内存运行
- 结果持久化

---

## 八、PromptIter 提示词迭代

自动化 Prompt 迭代和优化：

```go
import "trpc.group/trpc-go/trpc-agent-go/promptiter"

iter := promptiter.New(
    promptiter.WithEvaluator(evaluator),
    promptiter.WithMaxIterations(10),
)

optimizedPrompt, _ := iter.Optimize(ctx, basePrompt)
```

---

## 九、Error Handling 错误处理

### 错误类型

| 类型 | 说明 |
|------|------|
| `StopError` | 停止当前执行（正常终止） |
| `InterruptError` | 中断等待外部输入（Graph） |
| `FlowError` | 流程级错误 |

### 错误处理最佳实践

```go
for event := range events {
    if event.Error != nil {
        switch event.Error.Type {
        case "stop_agent_error":
            // 正常停止，break
        case "flow_error":
            // 流程错误，可重试
        default:
            // 未知错误
        }
    }
}
```

---

## 十、生态总结

```
tRPC-Agent-Go 生态全景：

  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐
  │  tRPC-A2A-Go │  │ tRPC-MCP-Go  │  │ tRPC-Agent-Go│
  │  跨框架互操作  │  │  工具协议     │  │  智能 Agent   │
  └──────┬───────┘  └──────┬───────┘  └──────┬───────┘
         │                 │                 │
         └─────────────────┼─────────────────┘
                           │
              ┌────────────┼────────────┐
              ▼            ▼            ▼
         ┌────────┐  ┌─────────┐  ┌─────────┐
         │ AG-UI  │  │ Gateway │  │OpenClaw │
         │ 用户UI  │  │ HTTP API│  │ IM 网关  │
         └────────┘  └─────────┘  └─────────┘
              │            │            │
              └────────────┼────────────┘
                           ▼
              ┌────────────────────────┐
              │   可观测性              │
              │ OpenTelemetry + Langfuse│
              └────────────────────────┘
```
