# 后台任务运行 - 从应用代码启动异步Agent任务

## 概述

`taskrun` 示例演示了如何使用 `taskrun` 包从应用代码中启动后台 Agent 任务。这种模式适用于不需要实时交互的委派任务，如报告生成、数据分析、截图审查等。任务在独立 goroutine 中执行，应用代码可以异步等待结果。

## 核心概念

**Task Run** 系统由以下组件构成：

- `inprocess.Service` - 进程内任务服务，管理任务的生命周期
- `taskrun.SpawnRequest` - 任务生成请求，包含用户ID、父Session、任务描述和超时时间
- `inprocess.FileStore` - 可选的 JSON 文件持久化存储

核心工作流为：`Spawn` 创建任务 → `Start` 启动服务 → `Wait` 等待完成。

## 代码解析

**创建任务服务并生成任务：**

```go
r := runner.NewRunner(appName, &reportAgent{name: agentName})
defer r.Close()

svc, err := inprocess.NewService(r, opts...)
svc.Start(ctx)
defer svc.Close()

run, err := svc.Spawn(ctx, taskrun.SpawnRequest{
    OwnerUserID:     defaultUserID,
    ParentSessionID: parentSession,
    Task:            "review the generated frontend screenshot",
    Timeout:         time.Minute,
})
fmt.Printf("spawned run: %s\n", run.ID)

final, err := svc.Wait(ctx, run.ID)
fmt.Printf("status: %s\nresult: %s\n", final.Status, final.Result)
```

**自定义 Agent 实现**——示例使用了一个轻量级的 `reportAgent` 而非 LLMAgent，直接在 `Run` 方法中生成结果：

```go
func (a *reportAgent) Run(ctx context.Context, inv *agent.Invocation) (<-chan *event.Event, error) {
    out := make(chan *event.Event, 1)
    go func() {
        defer close(out)
        out <- responseEvent(inv, a.name)
    }()
    return out, nil
}
```

可选的 `FileStore` 支持任务状态持久化：

```go
store, _ := inprocess.NewFileStore(path)
opts := []inprocess.Option{inprocess.WithStore(store)}
```

## 运行方式

```bash
cd examples/taskrun

# 无持久化
go run .

# 启用 JSON 文件持久化
go run . -store=./task_state.json
```

预期输出：
```
spawned run: <run-id>
status: completed
result: completed delegated task: review the generated frontend screenshot
```

## 总结

Task Run 模式将 Agent 的使用从同步交互扩展到异步任务场景。它适合批处理、定时任务、从其他 Agent 委派子任务等场景。`inprocess.Service` 是轻量级实现，生产环境可替换为分布式任务队列。此模式与 `todo` 示例中的任务追踪互补——Todo 管理的是 Agent 内部的任务规划，Task Run 管理的是应用层面的 Agent 任务调度。
