# StructuredOutputSkills - 结构化输出与 Agent Skills 的结合

## 概述

本示例演示如何将结构化输出（Structured Output）与 Agent Skills 结合使用。Agent 在调用工具（包括 Skill 工具）的过程中自由交互，但最终必须返回一个符合预定义 JSON Schema 的类型化响应。这是构建需要稳定 API 输出格式的 Skill 应用的推荐模式。

## 核心概念

### 静态结构化输出

与 skilldynamicschema 示例的运行时动态 Schema 不同，本示例在 Agent 创建时就固定了输出 Schema：

```go
type helloResult struct {
    Skill  string `json:"skill"`
    Output string `json:"output"`
}

a := llmagent.New(agentName,
    llmagent.WithStructuredOutputJSON(
        new(helloResult),  // Go 结构体定义 Schema
        true,              // strict 模式
        "Run the hello skill and return its output",
    ),
)
```

框架从 Go 结构体自动生成 JSON Schema，并在最终模型调用时启用结构化输出约束。

### 工具调用与结构化输出共存

关键设计：Agent 可以先自由调用工具（`skill_load`、`skill_run`），只有最终回答需要匹配 Schema。中间的工具调用阶段不受 Schema 约束。

### 类型化事件输出

结构化输出通过 `event.StructuredOutput` 字段返回，并且已自动反序列化为注册的 Go 类型：

```go
if ev.StructuredOutput != nil {
    if out, ok := ev.StructuredOutput.(*helloResult); ok {
        // out.Skill 和 out.Output 已自动填充
    }
}
```

## 代码解析

**Agent 配置**：同时启用 Skills 和结构化输出：

```go
a := llmagent.New(agentName,
    llmagent.WithSkills(repo),
    llmagent.WithSkillToolProfile(llmagent.SkillToolProfileFull),
    llmagent.WithCodeExecutor(exec),
    llmagent.WithEnableCodeExecutionResponseProcessor(false),
    llmagent.WithStructuredOutputJSON(new(helloResult), true,
        "Run the hello skill and return its output"),
)
```

**指令设计**：系统提示词明确告知模型：可以调用工具，但最终必须返回匹配 Schema 的 JSON：

```
Rules:
- You MAY call tools when needed.
- While calling tools, do not provide a user-facing answer.
- For every user request, do the following:
  1) Call skill_load for the "hello" skill.
  2) Call skill_run to run: bash scripts/hello.sh
  3) Return the final answer as JSON matching the schema.
```

**事件处理**：同时处理流式内容和结构化输出。流式模式下，JSON 内容逐 chunk 输出，最终的 `ev.StructuredOutput` 包含解析后的完整对象。

## 运行方式

```bash
cd examples/structuredoutputskills
export OPENAI_API_KEY="your-key"
go run . -model deepseek-v4-flash

# 输入示例
> run the hello skill
```

预期输出：工具调用追踪 + 最终的类型化 JSON 响应。

## 总结

结构化输出让 Skill 的执行结果以可靠的、程序可消费的格式返回，非常适合需要将 Agent 输出集成到下游系统的场景。本模式与 Skill 执行正交，可以叠加到 skillrun 等任何标准配置之上。与 skilldynamicschema 对比：本示例适合固定输出格式，后者适合多格式动态切换。
