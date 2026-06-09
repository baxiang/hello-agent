# 生态与进阶 — Skill·Artifact·Planner·Evaluation

本文串联 tRPC-Agent-Go 的辅助模块：Agent Skills 规范实现、Artifact 制品存储、Planner 任务规划、Evaluation 评测框架、Code Executor 代码执行、以及 PromptIter 提示词迭代。

## 1. Agent Skills

### 1.1 设计来源

Agent Skills 遵循 [Anthropic Agent Skills 规范](https://docs.anthropic.com/en/docs/agents-and-tools/agent-skills)。每个 Skill 是一个包含 `SKILL.md` 的文件夹，定义可复用的工作流。

### 1.2 Skill 结构

```
skills/
├── pdf-processing/
│   ├── SKILL.md           # 技能描述（LLM 读取）
│   ├── scripts/
│   │   └── extract.py     # 执行脚本
│   └── docs/
│       └── usage.md       # 使用文档
└── data-analysis/
    ├── SKILL.md
    └── scripts/
        └── analyze.py
```

### 1.3 集成

```go
import (
    "trpc.group/trpc-go/trpc-agent-go/skill"
    "trpc.group/trpc-go/trpc-agent-go/tool/skilltool"
    "trpc.group/trpc-go/trpc-agent-go/codeexecutor/local"
)

// 从本地或远程加载 Skills
repo, _ := skill.NewFSRepository(
    "./skills",                              // 本地目录
    "https://example.com/skills-extra.zip",  // 远程压缩包（自动缓存）
)

tools := []tool.Tool{
    skilltool.NewLoadTool(repo),
    skilltool.NewRunTool(repo, localexec.New()),
}

agent := llmagent.New("skilled-agent",
    llmagent.WithModel(model),
    llmagent.WithTools(tools),
    llmagent.WithCodeExecutor(localexec.New()),
    llmagent.WithEnableCodeExecutionResponseProcessor(false),
)
```

### 1.4 Skill 工具生态

| 工具 | 说明 | 场景 |
|------|------|------|
| `skill_load` | 加载技能描述（含文档列表） | LLM 理解技能能力 |
| `skill_list_docs` | 列出技能文档 | LLM 选择需要的文档 |
| `skill_select_docs` | 选择文档子集 | 避免上下文膨胀 |
| `skill_run` | 在隔离工作区执行命令 | 默认单次执行 |
| `skill_exec` | 启动交互式程序 | 需要 stdin 交互 |
| `skill_write_stdin` | 向交互式程序写入 | 对话式 CLI |
| `skill_poll_session` | 轮询会话状态 | 异步任务进度 |
| `skill_kill_session` | 终止交互式会话 | 超时/取消 |

### 1.5 热更新

```go
// 在长生命周期进程中安装/删除/重命名 Skill 后
repo.Refresh() // 下次调用 skill_load 时看到最新 Skills
```

### 1.6 安全模型

```
skill_run 执行
    │
    ├─ 隔离工作区（临时目录，执行完成后清理）
    ├─ 策略模式（限制可执行命令）
    ├─ 环境变量清洗（移除敏感 env var）
    └─ 超时控制
```

---

## 2. Artifact 制品存储

### 2.1 概念

Artifact 提供版本化的文件存储，用于保存 Agent 和工具生成的图片、文本、报告等制品。

### 2.2 API

```go
import "trpc.group/trpc-go/trpc-agent-go/artifact"

// 保存制品
artifactID, _ := artifactService.SaveArtifact(ctx, artifact.SaveRequest{
    AppName:  "my-app",
    UserID:   "user-1",
    Filename: "report.pdf",
    Data:     pdfBytes,
    Metadata: map[string]string{"page_count": "42"},
})

// 加载制品
artifact, _ := artifactService.LoadArtifact(ctx, artifactID)

// 列出所有版本
versions, _ := artifactService.ListArtifacts(ctx, artifact.ListRequest{
    AppName:  "my-app",
    UserID:   "user-1",
    Filename: "report.pdf",
})
```

### 2.3 后端选择

| 后端 | 场景 |
|------|------|
| `inmemory` | 开发测试 |
| `s3` | AWS 生产环境 |
| `cos` | 腾讯云生产环境 |

---

## 3. Planner 规划器

### 3.1 概念

Planner 在 LLM 调用前介入，帮助 Agent 分解复杂任务和选择工具。

### 3.2 使用

```go
import "trpc.group/trpc-go/trpc-agent-go/planner"

agent := llmagent.New("planning-agent",
    llmagent.WithModel(model),
    llmagent.WithPlanner(planner.NewBuiltinPlanner()),
)
```

**Planner 的两种模式**：
1. **Builtin Planner**：框架内置，基于 prompt engineering 实现
2. **Custom Planner**：实现 `planner.Planner` 接口

### 3.3 Planner 接口

```go
type Planner interface {
    Plan(ctx context.Context, inv *Invocation) (*Plan, error)
}

type Plan struct {
    Steps     []Step
    Reasoning string
}
```

---

## 4. Code Executor 代码执行器

### 4.1 执行器类型

```go
// 本地执行
import "trpc.group/trpc-go/trpc-agent-go/codeexecutor/local"
executor := localexec.New(
    localexec.WithWorkDir("/tmp/agent-workspace"),
    localexec.WithTimeout(30*time.Second),
)

// E2B 云沙箱
import "trpc.group/trpc-go/trpc-agent-go/codeexecutor/e2b"
executor, _ := e2b.New(
    e2b.WithAPIKey(os.Getenv("E2B_API_KEY")),
    e2b.WithTemplate("base"),
)

// Docker 容器
import "trpc.group/trpc-go/trpc-agent-go/codeexecutor/container"
executor, _ := container.New(
    container.WithImage("python:3.11-slim"),
)

// Jupyter
import "trpc.group/trpc-go/trpc-agent-go/codeexecutor/jupyter"
executor, _ := jupyter.New(
    jupyter.WithKernel("python3"),
)
```

### 4.2 安全层级

```
本地执行     → fast, unsafe（可访问宿主机）
Docker       → isolated, safe（容器隔离）
E2B          → cloud sandbox, safest（云端隔离+审计）
Jupyter      → interactive, educational（教学/演示）
```

---

## 5. Evaluation 评测框架

### 5.1 使用

```go
import "trpc.group/trpc-go/trpc-agent-go/evaluation"

evaluator, _ := evaluation.New("my-app", runner,
    evaluation.WithNumRuns(3),         // 每个 case 跑 3 次取平均
    evaluation.WithEvalSet("math"),    // 使用 "math" 评测集
)
defer evaluator.Close()

result, _ := evaluator.Evaluate(ctx, "math-basic")

fmt.Printf("Status: %s\n", result.OverallStatus)  // "passed" / "failed"
fmt.Printf("Score: %.2f\n", result.Score)
for _, metric := range result.Metrics {
    fmt.Printf("  %s: %.2f\n", metric.Name, metric.Value)
}
```

### 5.2 评测架构

```
EvalSet（评测集）
    ├─ Case 1: {input: "2+3", expected: "5"}
    ├─ Case 2: {input: "10*5", expected: "50"}
    └─ Case 3: ...

        │ Repeat × N (WithNumRuns)
        ▼
Runner.Run(case.input)
        │
        ▼
Metrics（评估指标）
    ├─ Accuracy: output == expected?
    ├─ Latency: response time
    └─ TokenUsage: cost analysis
```

---

## 6. PromptIter 提示词迭代

### 6.1 概念

自动迭代优化 prompt，基于评测结果调整指令。

```go
import "trpc.group/trpc-go/trpc-agent-go/promptiter"

iter := promptiter.New(
    promptiter.WithEvaluator(evaluator),
    promptiter.WithMaxIterations(10),
    promptiter.WithImprovementModel(openai.New("gpt-4o")), // 用更强模型做优化
)

optimizedPrompt, _ := iter.Optimize(ctx, "You are a helpful assistant.")
```

---

## 7. 生态全景图

```
                        tRPC-Agent-Go
                              │
        ┌─────────────────────┼─────────────────────┐
        │                     │                     │
   ┌────▼────┐          ┌────▼────┐          ┌────▼────┐
   │tRPC-A2A-Go│        │tRPC-MCP-Go│         │  Go 生态  │
   │跨框架互操作│        │  工具协议  │         │  高并发   │
   └─────────┘          └─────────┘          └─────────┘
        │                     │                     │
        └─────────────────────┼─────────────────────┘
                              │
        ┌─────────────────────┼─────────────────────┐
        │                     │                     │
   ┌────▼────┐          ┌────▼────┐          ┌────▼────┐
   │  AG-UI  │          │ Gateway │          │OpenClaw │
   │ 用户UI   │          │ HTTP API│          │ IM 网关  │
   └─────────┘          └─────────┘          └─────────┘
                              │
        ┌─────────────────────┼─────────────────────┐
        │                     │                     │
   ┌────▼────┐          ┌────▼────┐          ┌────▼────┐
   │OpenTelemetry│      │Langfuse │          │ Debug   │
   │  链路追踪   │      │ LLM分析 │          │ Server  │
   └─────────┘          └─────────┘          └─────────┘
```

---

## 8. 学习路线回顾

完成全部 15 篇文章后，建议的 deep-dive 顺序：

1. **基础**：Agent → Model → Tool（理解核心三角）
2. **编排**：Runner → Multi-Agent → Graph（理解执行与编排）
3. **状态**：Session → Memory → Knowledge（理解状态管理）
4. **生产**：Server → Observability → Ecosystem（理解部署与监控）
