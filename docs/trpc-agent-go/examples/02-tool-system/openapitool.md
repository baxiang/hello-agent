# OpenAPI 工具 - 从 OpenAPI 规范自动生成工具

## 概述

`openapitool` 示例演示如何使用 `openapi.NewToolSet` 从 OpenAPI（Swagger）规范文件自动生成一组工具。开发者只需提供一个 OpenAPI YAML/JSON 文件，框架就能将其中定义的每个 API 端点转化为 Agent 可调用的工具，无需手动编写工具代码。

## 核心概念

OpenAPI 工具集（`openapi.ToolSet`）通过解析 OpenAPI 规范文件，将每个 API 操作（路径 + 方法）自动转化为一个工具。工具的名称、描述、输入参数等信息直接从规范文件中提取。当 LLM 调用这些工具时，框架会自动构造 HTTP 请求并发送到目标服务器。

## 代码解析

### 加载 OpenAPI 规范

通过 `openapi.NewFileLoader` 从本地文件加载规范：

```go
loader, err := openapi.NewFileLoader("./petstore3.yaml")
```

### 创建工具集

使用加载器创建工具集：

```go
openAPIToolSet, err := openapi.NewToolSet(
    context.Background(),
    openapi.WithSpecLoader(loader),
)
```

### 注册到 Agent

OpenAPI 工具集通过 `WithToolSets`（注意是 ToolSets 而非 Tools）注册：

```go
llmAgent := llmagent.New(
    "chat-assistant",
    llmagent.WithModel(modelInstance),
    llmagent.WithToolSets([]tool.ToolSet{openAPIToolSet}),
)
```

### 示例中的 Petstore API

示例使用经典的 Petstore3 API 规范，自动生成的工具可能包括：
- `findPetsByStatus`：按状态查找宠物
- `getPetById`：按 ID 获取宠物信息
- `addPet`：添加新宠物
- `updatePet`：更新宠物信息

这些工具名称和参数完全由 OpenAPI 规范文件定义。

### 完整的 Agent 设置

```go
llmAgent := llmagent.New(
    "chat-assistant",
    llmagent.WithModel(modelInstance),
    llmagent.WithDescription("A helpful AI assistant"),
    llmagent.WithInstruction("You are a helpful AI assistant..."),
    llmagent.WithGenerationConfig(model.GenerationConfig{
        MaxTokens:   intPtr(1000),
        Temperature: floatPtr(0.7),
        Stream:      true,
    }),
    llmagent.WithToolSets([]tool.ToolSet{openAPIToolSet}),
)
```

## 运行方式

```bash
cd examples/openapitool
export OPENAI_API_KEY="your-key"

# 使用默认的 petstore3.yaml
go run .

# 指定自定义 OpenAPI 规范文件
go run . -openapi_spec=./my-api.yaml

# 指定 API 服务地址和认证
go run . -base_url=http://localhost:8080 -api_token=my-token
```

示例目录下包含 `petstore3.yaml` 和 `petstore3.json` 两种格式的规范文件，以及一个 `mockserver/` 目录用于本地测试。

## 总结

- `openapi.NewToolSet` 从 OpenAPI 规范自动生成工具集，无需手动编码
- 支持 YAML 和 JSON 格式的 OpenAPI 规范文件
- 使用 `WithToolSets` 注册工具集，与手动创建的 `WithTools` 并列使用
- 适合快速将已有的 REST API 服务接入 Agent 系统
- 可以与 [toolfilter](./toolfilter.md) 结合，按需过滤自动生成的 API 工具
