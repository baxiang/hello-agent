# Eino 快速入门

本指南帮助你在 10 分钟内从零开始构建第一个 Eino LLM 应用，涵盖从环境搭建到 Agent 开发的完整链路。

---

## 1. 环境准备

### 1.1 Go 版本要求

Eino 大量使用 Go 1.18+ 泛型，要求 **Go 1.22 及以上**版本：

```bash
go version
# go version go1.22.x darwin/arm64
```

### 1.2 安装依赖

```bash
go get github.com/cloudwego/eino@latest
```

如需使用 OpenAI 兼容模型，引入对应实现包：

```bash
go get github.com/cloudwego/eino-ext/components/model/openai@latest
```

---

## 2. 最简示例：ChatModel 调用

最直接的用法是通过 `model.BaseChatModel` 接口与 LLM 交互。该接口定义于 `components/model/interface.go:36`，提供 `Generate` 和 `Stream` 两种调用方式。

```go
package main

import (
    "context"
    "fmt"

    "github.com/cloudwego/eino-ext/components/model/openai"
    "github.com/cloudwego/eino/schema"
)

func main() {
    ctx := context.Background()

    // 创建 ChatModel 实例
    model, err := openai.NewChatModel(ctx, &openai.ChatModelConfig{
        ByAzure: false,
        Model:   "gpt-4o",
    })
    if err != nil {
        panic(err)
    }

    // 调用 Generate 获取完整响应
    // 接口签名：Generate(ctx, []Message, ...Option) (Message, error)
    result, err := model.Generate(ctx, []*schema.Message{
        schema.SystemMessage("你是一个有帮助的助手"),
        schema.UserMessage("什么是 Eino?"),
    })
    if err != nil {
        panic(err)
    }

    fmt.Println(result.Content)
    // 输出：Eino 是字节跳动 CloudWeGo 团队开源的 Go 语言 LLM 应用开发框架...
}
```

> `schema.SystemMessage`、`schema.UserMessage` 是消息构造的快捷函数，定义在 `schema/message.go` 中。

---

## 3. 流式调用

LLM 的推理通常是逐 Token 生成的，流式调用可以实时获取增量输出，显著改善用户体验。`model.BaseChatModel.Stream` 返回 `*schema.StreamReader[*schema.Message]`，定义在 `schema/stream.go:168`。

```go
import (
    "errors"
    "io"
)

// 流式调用：逐 chunk 输出
stream, err := model.Stream(ctx, []*schema.Message{
    schema.UserMessage("用三句话介绍 Go 语言"),
})
if err != nil {
    panic(err)
}
defer stream.Close()

for {
    // Recv 阻塞等待下一个 chunk
    chunk, err := stream.Recv()
    if errors.Is(err, io.EOF) {
        break // 流结束
    }
    if err != nil {
        panic(err)
    }
    fmt.Print(chunk.Content)
}
```

关键要点：

- **必须调用 `stream.Close()`**：通过 `defer stream.Close()` 确保资源释放
- **StreamReader 只能读取一次**：如需多消费者，须先 `stream.Copy(n)` 拷贝
- **io.EOF 标记流结束**：这是正常的终止信号，不是错误

---

## 4. Chain 编排

单独调用模型无法处理复杂流程。Eino 的 `compose.Chain` 提供线性管道编排，将多个组件串联。Chain 定义在 `compose/chain.go:37`。

```go
import (
    "github.com/cloudwego/eino/compose"
    "github.com/cloudwego/eino/components/prompt"
)

// 创建 ChatTemplate，定义变量槽位
template, err := prompt.FromMessages(schema.FString,
    schema.SystemMessage("你是一个{role}，请用{style}风格回答"),
    schema.UserMessage("{query}"),
)
if err != nil {
    panic(err)
}

// 构建链：模板 -> 模型
chain := compose.NewChain[map[string]any, *schema.Message]()
chain.AppendChatTemplate(template).AppendChatModel(model)

// 编译链（编译后不可修改）
runnable, err := chain.Compile(ctx)
if err != nil {
    panic(err)
}

// 执行
result, err := runnable.Invoke(ctx, map[string]any{
    "role":  "技术专家",
    "style": "简洁专业",
    "query": "什么是流式处理？",
})
if err != nil {
    panic(err)
}
fmt.Println(result.Content)
```

Chain 支持的 Append 方法（定义在 `compose/chain.go`）：

| 方法 | 说明 |
|------|------|
| `AppendChatTemplate` | 添加提示词模板节点 |
| `AppendChatModel` | 添加大模型节点 |
| `AppendToolsNode` | 添加工具执行节点 |
| `AppendRetrieverNode` | 添加检索节点 |
| `AppendLambda` | 添加自定义函数节点 |
| `AppendParallel` | 添加并行分支 |
| `AppendBranch` | 添加条件分支 |
| `AppendGraph` | 嵌套子图 |

---

## 5. Tool 使用

工具调用是 Agent 的核心能力。Eino 提供了 `utils.InferTool` 从 Go 结构体自动推断工具 schema，定义在 `components/tool/utils/invokable_func.go:46`。

### 5.1 定义工具

```go
import (
    "github.com/cloudwego/eino/components/tool/utils"
    "github.com/cloudwego/eino/components/tool"
)

// 工具输入结构体：字段标签定义 JSON Schema
type WeatherInput struct {
    City string `json:"city" jsonschema:"description=城市名称"`
}

// 从结构体推断工具定义
weatherTool, err := utils.InferTool[WeatherInput, string](
    "get_weather",                        // 工具名称
    "获取指定城市的天气信息",              // 工具描述
    func(ctx context.Context, input *WeatherInput) (string, error) {
        // 实际业务逻辑
        return fmt.Sprintf("%s天气: 晴, 25°C", input.City), nil
    },
)
if err != nil {
    panic(err)
}
```

`InferTool` 会自动：
1. 从 `WeatherInput` 的字段标签生成 `*schema.ToolInfo`
2. JSON 解码模型参数为 `WeatherInput`
3. 调用函数并将返回值 JSON 编码为 `string`

### 5.2 绑定工具到模型

```go
// 获取工具元信息
toolInfo, err := weatherTool.Info(ctx)
if err != nil {
    panic(err)
}

// 方式一：ToolCallingChatModel.WithTools（推荐，线程安全）
// 定义在 components/model/interface.go:99
// model 需实现 ToolCallingChatModel 接口
toolModel, err := model.(model.ToolCallingChatModel).WithTools([]*schema.ToolInfo{toolInfo})

// 方式二：作为 Option 传递给 Generate/Stream
result, err := model.Generate(ctx, messages,
    model.WithTools([]*schema.ToolInfo{toolInfo}),
)
```

> **注意**：推荐使用 `ToolCallingChatModel.WithTools`（`components/model/interface.go:99`），它返回新实例，是并发安全的。已废弃的 `ChatModel.BindTools` 会修改原实例，存在竞态风险。

---

## 6. Graph 编排 RAG 流程

对于更复杂的流程（如 RAG），需要使用 `compose.Graph` 来构建有向图。Graph 定义在 `compose/graph.go`。

```go
import (
    "github.com/cloudwego/eino/compose"
    "github.com/cloudwego/eino/components/retriever"
)

// 假设已有以下组件实例
// var retriever retriever.Retriever
// var model model.BaseChatModel
// var template prompt.ChatTemplate

graph := compose.NewGraph[map[string]any, *schema.Message]()

// 添加节点
graph.AddRetrieverNode("retrieve", retriever)
graph.AddChatTemplateNode("prompt", template)
graph.AddChatModelNode("model", model)

// 添加边
graph.AddEdge(compose.START, "retrieve")
graph.AddEdge("retrieve", "prompt")
graph.AddEdge("prompt", "model")
graph.AddEdge("model", compose.END)

// 编译并执行
runnable, err := graph.Compile(ctx)
if err != nil {
    panic(err)
}

result, err := runnable.Invoke(ctx, map[string]any{
    "query": "Eino 的流式处理机制",
})
```

Graph 的核心概念（`compose/graph.go:37-38`）：

| 概念 | 说明 |
|------|------|
| `START` | 图入口节点 |
| `END` | 图出口节点 |
| `AddEdge(from, to)` | 添加数据边 |
| `AddBranch(node, branch)` | 添加条件分支 |

---

## 7. ChatModelAgent 构建

`adk.ChatModelAgent` 是 Eino 的最高层抽象，封装了完整的 ReAct 循环（模型推理 → 工具调用 → 观察结果 → 再推理）。定义在 `adk/chatmodel.go:457`。

### 7.1 创建 Agent

```go
import (
    "github.com/cloudwego/eino/adk"
)

// 创建带工具的 Agent
agent, err := adk.NewChatModelAgent(ctx, &adk.ChatModelAgentConfig{
    Name:        "weather_agent",
    Description: "天气查询助手",
    Instruction: "你是一个有帮助的助手，可以查询天气信息",
    Model:       model,     // 实现 model.BaseChatModel
    ToolsConfig: adk.ToolsConfig{
        Tools: []tool.BaseTool{weatherTool},
    },
    MaxIterations: 10, // 最大 ReAct 循环次数，默认 20
})
if err != nil {
    panic(err)
}
```

`ChatModelAgentConfig` 核心字段（`adk/chatmodel.go:260-415`）：

| 字段 | 类型 | 说明 |
|------|------|------|
| `Name` | `string` | Agent 名称，用于 AgentTool 协作 |
| `Description` | `string` | Agent 描述，其他 Agent 据此判断是否移交任务 |
| `Instruction` | `string` | 系统提示词，支持 f-string 模板变量 |
| `Model` | `model.BaseModel[M]` | 底层大模型，**必填** |
| `ToolsConfig` | `ToolsConfig` | 工具配置 |
| `MaxIterations` | `int` | 最大 ReAct 迭代次数，默认 20 |
| `Handlers` | `[]ChatModelAgentMiddleware` | 接口式中间件 |

### 7.2 使用 Runner 执行

`adk.Runner` 管理 Agent 的完整生命周期，包括执行、流式输出和检查点。定义在 `adk/runner.go:55`。

```go
// 创建 Runner
runner := adk.NewRunner(ctx, adk.RunnerConfig{
    Agent:           agent,
    EnableStreaming:  true,
})

// 通过 Query 快速执行
iter := runner.Query(ctx, "北京天气如何？")

// 迭代消费事件
for {
    event, ok := iter.Next()
    if !ok {
        break
    }
    if event.Err != nil {
        fmt.Printf("错误: %v\n", event.Err)
        continue
    }
    if event.Output != nil && event.Output.MessageOutput != nil {
        mv := event.Output.MessageOutput
        if mv.IsStreaming {
            // 流式输出：逐 chunk 消费
            chunk, err := mv.MessageStream.Recv()
            if err == io.EOF {
                continue
            }
            if err != nil {
                panic(err)
            }
            fmt.Print(chunk.Content)
        } else {
            // 完整输出
            fmt.Println(mv.Message.Content)
        }
    }
}
```

Runner 的核心方法（`adk/runner.go:88-154`）：

| 方法 | 说明 |
|------|------|
| `Query(ctx, query)` | 便捷方法，从字符串发起对话 |
| `Run(ctx, messages)` | 从消息列表发起对话 |
| `Resume(ctx, checkpointID)` | 从中断点恢复执行 |
| `ResumeWithParams(ctx, checkpointID, params)` | 带参数恢复执行 |

### 7.3 多 Agent 协作

通过 `adk.NewAgentTool` 将 Agent 包装为工具，实现多 Agent 协作。定义在 `adk/agent_tool.go:69`。

```go
// 将搜索 Agent 包装为工具
searchAgentTool, err := adk.NewAgentTool(ctx, searchAgent)
if err != nil {
    panic(err)
}

// 在主 Agent 中使用
mainAgent, err := adk.NewChatModelAgent(ctx, &adk.ChatModelAgentConfig{
    Name:        "main_agent",
    Instruction: "你是主助手，可以调用搜索子助手",
    Model:       model,
    ToolsConfig: adk.ToolsConfig{
        Tools:              []tool.BaseTool{searchAgentTool},
        EmitInternalEvents: true, // 转发子 Agent 事件
    },
})
```

> **推荐**：对于多 Agent 场景，优先使用 `AgentTool` 或 `DeepAgent`（`adk/prebuilt/deep/`），而非 Supervisor/Agent Transfer 模式。

---

## 8. 常见问题

### Q1: `go get` 报泛型相关编译错误？

确保 Go 版本 >= 1.22。Eino 使用了 Go 1.22 引入的泛型类型推断增强特性。

### Q2: `StreamReader` 如何在多个消费者间共享？

StreamReader 只能读取一次。使用 `stream.Copy(n)` 创建 n 份副本：

```go
copies := stream.Copy(2)
// copies[0] 和 copies[1] 是独立的读取器
```

### Q3: Agent 执行超时怎么办？

使用 context 超时控制：

```go
ctx, cancel := context.WithTimeout(ctx, 30*time.Second)
defer cancel()
iter := runner.Query(ctx, "查询天气")
```

或使用 ADK 的取消机制（`adk/cancel.go`），支持在 ReAct 循环的安全点取消。

### Q4: 如何实现带人工确认的 Agent？

使用 ADK 的中断/恢复机制（`adk/interrupt.go`）：

```go
// 在工具中触发中断
func (t *ConfirmTool) InvokableRun(ctx context.Context, args string, opts ...tool.Option) (string, error) {
    return "", adk.Interrupt(ctx, "需要用户确认：是否继续执行？")
}

// 恢复执行
iter, err := runner.Resume(ctx, checkpointID)
```

### Q5: 如何自定义 Agent 的模型调用行为？

通过 `ChatModelAgentMiddleware`（`adk/handler.go`）：

```go
agent, _ := adk.NewChatModelAgent(ctx, &adk.ChatModelAgentConfig{
    Handlers: []adk.ChatModelAgentMiddleware{
        // BeforeModelRewriteState：在模型调用前修改状态
        // AfterModelRewriteState：在模型调用后修改状态
        // WrapModel：包装模型调用
        // WrapToolCall：包装工具调用
        myCustomHandler,
    },
})
```

### Q6: Chain 和 Graph 如何选择？

| 场景 | 推荐方式 |
|------|---------|
| 线性流程（Prompt → Model → Output） | Chain |
| 有分支/循环的复杂流程 | Graph |
| 需要自动推导执行顺序 | Workflow |
| Agent 开发 | ADK ChatModelAgent |

### Q7: 如何设置 ADK 的中文提示？

```go
// 配置 ADK 内置提示为中文（adk/config.go:33）
err := adk.SetLanguage(adk.LanguageChinese)
```

这会影响 Agent Transfer 等内置工具的提示语言。
