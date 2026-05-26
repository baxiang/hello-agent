# ADK-Go 快速入门

## 环境准备

开始使用 ADK-Go 之前，请确保你的开发环境满足以下要求：

- **Go 1.23+**：ADK-Go 使用了 Go 1.23 引入的 `iter.Seq2` 迭代器协议，需要较新的 Go 版本。
- **Google API Key**：用于访问 Gemini 模型。在 [Google AI Studio](https://aistudio.google.com/) 获取。
- **安装依赖**：

```bash
go get google.golang.org/adk@latest
```

设置环境变量：

```bash
export GOOGLE_API_KEY="your-api-key-here"
```

## 最简示例

以下是基于官方 quickstart 示例的完整代码，创建一个能够回答时间和天气问题的 Agent：

```go
package main

import (
    "context"
    "log"
    "os"

    "google.golang.org/genai"

    "google.golang.org/adk/agent"
    "google.golang.org/adk/agent/llmagent"
    "google.golang.org/adk/cmd/launcher"
    "google.golang.org/adk/cmd/launcher/full"
    "google.golang.org/adk/model/gemini"
    "google.golang.org/adk/tool"
    "google.golang.org/adk/tool/geminitool"
)

func main() {
    ctx := context.Background()

    // 创建 Gemini 模型实例
    model, err := gemini.NewModel(ctx, "gemini-2.5-flash", &genai.ClientConfig{
        APIKey: os.Getenv("GOOGLE_API_KEY"),
    })
    if err != nil {
        log.Fatalf("创建模型失败: %v", err)
    }

    // 创建 LLM Agent
    a, err := llmagent.New(llmagent.Config{
        Name:        "weather_time_agent",
        Model:       model,
        Description: "Agent to answer questions about the time and weather in a city.",
        Instruction: "Your SOLE purpose is to answer questions about the current time and weather in a specific city. You MUST refuse to answer any questions unrelated to time or weather.",
        Tools: []tool.Tool{
            geminitool.GoogleSearch{}, // 内置 Google 搜索工具
        },
    })
    if err != nil {
        log.Fatalf("创建 Agent 失败: %v", err)
    }

    // 配置 Launcher 并启动
    config := &launcher.Config{
        AgentLoader: agent.NewSingleLoader(a),
    }

    l := full.NewLauncher()
    if err = l.Execute(ctx, config, os.Args[1:]); err != nil {
        log.Fatalf("运行失败: %v\n\n%s", err, l.CommandLineSyntax())
    }
}
```

### 代码解析

1. **创建模型**：`gemini.NewModel()` 接受模型名称和客户端配置，返回实现了 `model.LLM` 接口的实例。
2. **创建 Agent**：`llmagent.New()` 是最常用的 Agent 构造器，需要指定名称、模型、描述和指令。
3. **配置工具**：`Tools` 字段接受 `[]tool.Tool` 切片，这里使用了内置的 `GoogleSearch`。
4. **启动运行**：`full.NewLauncher()` 创建一个支持多种运行模式的启动器，`Execute()` 根据命令行参数选择运行方式。

## 自定义 FunctionTool

`functiontool.New()` 允许你将任意 Go 函数封装为 Agent 可调用的工具，它会自动推导参数和返回值的 JSON Schema：

```go
package main

import (
    "context"
    "fmt"
    "log"
    "os"

    "google.golang.org/genai"

    "google.golang.org/adk/agent"
    "google.golang.org/adk/agent/llmagent"
    "google.golang.org/adk/cmd/launcher"
    "google.golang.org/adk/cmd/launcher/full"
    "google.golang.org/adk/model/gemini"
    "google.golang.org/adk/tool"
    "google.golang.org/adk/tool/functiontool"
    "google.golang.org/adk/tool/geminitool"
)

// 定义工具参数结构体，字段需要有 json tag
type getWeatherArgs struct {
    City string `json:"city"`
}

// 定义工具返回结构体
type weatherResult struct {
    Weather string `json:"weather"`
}

func main() {
    ctx := context.Background()

    model, err := gemini.NewModel(ctx, "gemini-2.5-flash", &genai.ClientConfig{
        APIKey: os.Getenv("GOOGLE_API_KEY"),
    })
    if err != nil {
        log.Fatalf("创建模型失败: %v", err)
    }

    // 创建自定义 FunctionTool
    weatherTool, err := functiontool.New(functiontool.Config{
        Name:        "get_weather",
        Description: "Gets the current weather for a city.",
    }, func(ctx tool.Context, args getWeatherArgs) (weatherResult, error) {
        // 在实际应用中，这里会调用天气 API
        return weatherResult{
            Weather: fmt.Sprintf("晴朗, %s 当前 25°C", args.City),
        }, nil
    })
    if err != nil {
        log.Fatalf("创建工具失败: %v", err)
    }

    a, err := llmagent.New(llmagent.Config{
        Name:        "weather_agent",
        Model:       model,
        Description: "Agent that can check the weather.",
        Instruction: "You help users check the weather in different cities.",
        Tools: []tool.Tool{
            weatherTool,
            geminitool.GoogleSearch{},
        },
    })
    if err != nil {
        log.Fatalf("创建 Agent 失败: %v", err)
    }

    config := &launcher.Config{
        AgentLoader: agent.NewSingleLoader(a),
    }

    l := full.NewLauncher()
    if err = l.Execute(ctx, config, os.Args[1:]); err != nil {
        log.Fatalf("运行失败: %v\n\n%s", err, l.CommandLineSyntax())
    }
}
```

### FunctionTool 要点

- **参数类型**：第一个参数必须是 `tool.Context`，第二个参数是自定义的参数结构体（需要 `json` tag）。
- **返回类型**：返回自定义结果结构体和 error，ADK 会自动将其序列化为 `map[string]any`。
- **Schema 推导**：`functiontool.New()` 会根据参数和返回值的结构体字段自动生成 JSON Schema，供 LLM 理解工具的输入输出格式。
- **工具上下文**：通过 `tool.Context` 可以访问会话状态（`ctx.State()`）、制品（`ctx.Artifacts()`）、记忆搜索（`ctx.SearchMemory()`）和人机确认（`ctx.RequestConfirmation()`）。

## 多 Agent 组合

ADK-Go 提供了三种工作流 Agent 来组合多个子 Agent：

### SequentialAgent（顺序执行）

子 Agent 按顺序依次执行，前一个 Agent 的输出可作为后一个的输入：

```go
package main

import (
    "context"
    "fmt"
    "iter"
    "log"
    "os"

    "google.golang.org/genai"

    "google.golang.org/adk/agent"
    "google.golang.org/adk/agent/workflowagents/sequentialagent"
    "google.golang.org/adk/cmd/launcher"
    "google.golang.org/adk/cmd/launcher/full"
    "google.golang.org/adk/model"
    "google.golang.org/adk/session"
)

// 自定义 Agent 类型
type myAgent struct {
    id int
}

func (a myAgent) Run(ctx agent.InvocationContext) iter.Seq2[*session.Event, error] {
    return func(yield func(*session.Event, error) bool) {
        yield(&session.Event{
            LLMResponse: model.LLMResponse{
                Content: &genai.Content{
                    Parts: []*genai.Part{{
                        Text: fmt.Sprintf("Hello from Agent %v!", a.id),
                    }},
                },
            },
        }, nil)
    }
}

func main() {
    ctx := context.Background()

    agent1, _ := agent.New(agent.Config{
        Name:        "step_1",
        Description: "第一步处理",
        Run:         myAgent{id: 1}.Run,
    })

    agent2, _ := agent.New(agent.Config{
        Name:        "step_2",
        Description: "第二步处理",
        Run:         myAgent{id: 2}.Run,
    })

    // 创建顺序执行 Agent
    seq, err := sequentialagent.New(sequentialagent.Config{
        AgentConfig: agent.Config{
            Name:        "pipeline",
            Description: "A sequential pipeline agent",
            SubAgents:   []agent.Agent{agent1, agent2},
        },
    })
    if err != nil {
        log.Fatalf("创建 SequentialAgent 失败: %v", err)
    }

    config := &launcher.Config{
        AgentLoader: agent.NewSingleLoader(seq),
    }

    l := full.NewLauncher()
    if err = l.Execute(ctx, config, os.Args[1:]); err != nil {
        log.Fatalf("运行失败: %v\n\n%s", err, l.CommandLineSyntax())
    }
}
```

### 其他工作流 Agent

- **ParallelAgent**：子 Agent 并行执行，事件交替输出。适用于需要同时获取多个独立结果的场景。
- **LoopAgent**：子 Agent 循环执行，直到满足退出条件。适用于迭代优化、代码修复等场景。
- **AgentTool**：通过 `agenttool.New()` 将一个 Agent 封装为另一个 Agent 的工具，实现更灵活的委托模式。

## 运行方式

ADK-Go 的 `full.Launcher` 支持多种运行模式，通过命令行参数选择：

### Console 模式（默认）

交互式终端对话，适合开发调试：

```bash
go run main.go
```

### REST API 模式

启动 HTTP 服务器，提供 RESTful API：

```bash
go run main.go --serve rest --port 8080
```

### A2A 模式

启动 Agent-to-Agent 协议服务，支持与其他 Agent 框架互操作：

```bash
go run main.go --serve a2a --port 8080
```

### Web UI 模式

启动带 Web 界面的服务，提供可视化对话体验：

```bash
go run main.go --serve web --port 8080
```

## 项目结构建议

推荐以下 Go 项目布局来组织 ADK-Go 应用：

```
my-agent/
├── cmd/
│   └── myagent/
│       └── main.go          # 入口，配置 Launcher
├── agent/
│   ├── root.go              # 根 Agent 定义
│   └── subagents/
│       ├── search.go        # 搜索子 Agent
│       └── analyzer.go      # 分析子 Agent
├── tools/
│   ├── weather.go           # 天气查询工具
│   ├── database.go          # 数据库查询工具
│   └── notification.go      # 通知工具
├── plugins/
│   └── audit.go             # 审计插件
├── services/
│   ├── session.go           # Session Service 实现
│   ├── memory.go            # Memory Service 实现
│   └── artifact.go          # Artifact Service 实现
├── go.mod
├── go.sum
└── README.md
```

这种布局遵循 Go 的标准项目组织方式，将 Agent 定义、工具、插件和服务层清晰分离，便于维护和测试。
