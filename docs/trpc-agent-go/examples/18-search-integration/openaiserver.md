# OpenAI Server - 将 Agent 暴露为 OpenAI 兼容 API

## 概述

OpenAI Server 示例演示了如何使用 tRPC-Agent-Go 的 `server/openai` 包将 Agent 系统暴露为与 OpenAI Chat Completions API 兼容的 HTTP 服务。任何支持 OpenAI API 协议的客户端（如 ChatGPT 前端、OpenAI SDK、各种 AI 应用）都可以直接对接该服务。该模式适用于将内部 Agent 能力标准化输出、构建 AI 网关等场景。

## 核心概念

### OpenAI 兼容服务器

`server/openai` 包将 Agent 封装为标准的 `/v1/chat/completions` 端点，自动处理请求解析、流式 SSE 响应、工具调用协议等 OpenAI API 规范细节。开发者只需关注 Agent 和工具的业务逻辑。

### 函数工具（Function Tool）

示例使用 `tool/function` 包通过 Go 函数直接创建工具，框架自动从函数签名和 struct tag 生成 JSON Schema：

```go
type calculatorArgs struct {
    Operation string  `json:"operation" jsonschema:"description=The operation to perform,enum=add,..."`
    A         float64 `json:"a" jsonschema:"description=First number operand,required"`
    B         float64 `json:"b" jsonschema:"description=Second number operand,required"`
}

calculatorTool := function.NewFunctionTool(calculate,
    function.WithName("calculator"),
    function.WithDescription("Perform basic mathematical calculations"),
)
```

## 代码解析

### 工具实现（tools.go）

两个示例工具展示了不同的函数签名模式：

**计算器工具**——纯计算逻辑：

```go
func calculate(ctx context.Context, args calculatorArgs) (calculatorResult, error) {
    switch strings.ToLower(args.Operation) {
    case "add":    result = args.A + args.B
    case "divide":
        if args.B != 0 { result = args.A / args.B }
    }
    return calculatorResult{Operation: args.Operation, Result: result}, nil
}
```

**时间查询工具**——涉及系统调用：

```go
func getCurrentTime(ctx context.Context, args timeArgs) (timeResult, error) {
    loc, err := time.LoadLocation(args.Timezone)
    now := time.Now().In(loc)
    return timeResult{
        Timezone: loc.String(),
        Time:     now.Format("15:04:05"),
    }, nil
}
```

### 服务器配置（main.go）

三步完成服务器搭建：

```go
// 1. 创建带工具的 Agent
llmAgent := llmagent.New(agentName,
    llmagent.WithModel(modelInstance),
    llmagent.WithTools([]tool.Tool{calculatorTool, timeTool}),
    llmagent.WithGenerationConfig(model.GenerationConfig{Stream: true}),
)

// 2. 创建 OpenAI 兼容服务器
server, _ := openaiserver.New(
    openaiserver.WithAgent(llmAgent),
    openaiserver.WithBasePath("/v1"),
    openaiserver.WithModelName(*modelName),
)
defer server.Close()

// 3. 启动 HTTP 服务
http.ListenAndServe(*addr, server.Handler())
```

`WithBasePath("/v1")` 设置 API 路径前缀，`WithModelName` 设置返回给客户端的模型名称。

### 客户端调用

启动后可用任何 OpenAI 兼容客户端调用：

```bash
curl http://localhost:8080/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{"model":"deepseek-v4-flash","messages":[{"role":"user","content":"What is 42 * 17?"}],"stream":true}'
```

## 运行方式

**环境准备**：

```bash
export OPENAI_API_KEY="your-api-key"
```

**运行命令**：

```bash
go run ./examples/openaiserver/ --model deepseek-v4-flash --addr :8080
```

**预期输出**：

```
OpenAI-compatible server listening on :8080 (model: deepseek-v4-flash, endpoint: /v1/chat/completions)
```

服务启动后，通过 `curl` 或任何 OpenAI SDK 客户端即可交互。

## 总结

OpenAI Server 示例展示了框架"Agent 即服务"的能力——将内部 Agent 系统标准化为行业通用的 API 协议。这是连接 Agent 后端与各种前端应用的关键桥梁。结合 `function.NewFunctionTool` 的自动 Schema 生成，可以快速将任意 Go 函数暴露为 AI 可调用的工具。该示例与 Dify、n8n 示例形成互补：前者是"将外部平台引入 Agent"，OpenAI Server 则是"将 Agent 输出到外部"。
