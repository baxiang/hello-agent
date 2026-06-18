# 插件系统 - 通过Plugin扩展Runner的全生命周期行为

## 概述

`plugin` 示例演示了 trpc-agent-go 的插件系统，通过 `plugin.Plugin` 接口在 Runner 的各个生命周期阶段（Agent 前后、Model 前后、Tool 前后、事件处理）注入自定义逻辑。示例包含一个主交互入口和三个子示例（errormessage、identity、messagemerger），覆盖了常见的插件使用模式。

## 核心概念

**Plugin** 是 Runner 级别的扩展机制，一个插件实现 `plugin.Plugin` 接口，通过 `Register(*plugin.Registry)` 方法注册各阶段的回调：

- `BeforeAgent` / `AfterAgent` - Agent 调用前后
- `BeforeModel` - 模型调用前（可短路返回自定义响应）
- `BeforeTool` / `AfterTool` - 工具调用前后
- `OnEvent` - 事件输出前（可修改事件内容）

框架内置了两个常用插件：
- `plugin.NewLogging()` - 日志记录
- `plugin.NewGlobalInstruction(text)` - 全局指令注入

## 代码解析

**自定义插件注册：**

```go
func (p *demoPlugin) Register(r *plugin.Registry) {
    r.BeforeAgent(p.beforeAgent)
    r.AfterAgent(p.afterAgent)
    r.BeforeModel(p.beforeModel)
    r.BeforeTool(p.beforeTool)
    r.AfterTool(p.afterTool)
    r.OnEvent(p.onEvent)
}
```

**BeforeModel 短路示例**——当用户输入包含 `/deny` 时直接返回拒绝响应，跳过模型调用：

```go
func (p *demoPlugin) beforeModel(ctx context.Context, args *model.BeforeModelArgs) (*model.BeforeModelResult, error) {
    if requestHasUserKeyword(args.Request, denyKeyword) {
        return &model.BeforeModelResult{
            CustomResponse: denyResponse(),
        }, nil
    }
    return nil, nil
}
```

**OnEvent 回调**修改输出事件，添加标签和内容前缀：

```go
func (p *demoPlugin) onEvent(_ context.Context, _ *agent.Invocation, e *event.Event) (*event.Event, error) {
    addTag(e, demoTag)
    addAssistantPrefix(e, "[plugin] ")
    return nil, nil
}
```

**Runner 配置中注册插件：**

```go
a.runner = runner.NewRunner(appName, llmAgent,
    runner.WithPlugins(
        plugin.NewLogging(),
        plugin.NewGlobalInstruction(globalInstruction),
        newDemoPlugin(a.debug),
    ),
)
```

## 运行方式

```bash
cd examples

export OPENAI_API_KEY="your-key"

# 主示例
go run ./plugin -model=deepseek-v4-flash -debug

# 子示例
go run ./plugin/errormessage
go run ./plugin/identity
go run ./plugin/messagemerger
```

交互时输入 `/deny` 可观察 BeforeModel 短路效果，输入数学问题可观察工具调用的前后回调日志。

## 总结

插件系统是框架最灵活的扩展机制，可用于实现安全策略（内容过滤）、可观测性（日志/追踪）、成本控制（请求限流）、内容注入（全局指令）等横切关注点。多个插件按注册顺序依次执行，形成类似中间件的管道。与 `max_limits` 的硬限制不同，插件提供了更精细的业务级控制能力。
