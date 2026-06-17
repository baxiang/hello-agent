# SkillDynamicSchema - 运行时动态切换结构化输出 JSON Schema

## 概述

本示例展示了一种由 Skill 驱动的模式：在运行时根据用户输入选择不同的 JSON Schema，将其应用到当前调用，最终返回符合该 Schema 的结构化 JSON 响应。Agent 启动时没有固定的输出 Schema，而是通过 Skill 内容动态确定。

## 核心概念

### 动态 Schema 切换

传统的结构化输出在 Agent 创建时就固定了 Schema。本示例打破了这一限制：模型先加载 Skill，从 `SKILL.md` 中提取 JSON Schema，然后通过自定义工具 `set_output_schema` 将其设置到当前 invocation 的 `StructuredOutput` 字段上。后续的模型调用会受到该 Schema 约束。

### 自定义工具：set_output_schema

这是本示例的核心创新。该工具实现了 `tool.CallableTool` 接口，在 `Call` 方法中通过 `agent.InvocationFromContext(ctx)` 获取当前调用上下文，直接修改 `inv.StructuredOutput`：

```go
inv.StructuredOutput = &model.StructuredOutput{
    Type: model.StructuredOutputJSONSchema,
    JSONSchema: &model.JSONSchemaConfig{
        Name:   "output",
        Schema: schema,
        Strict: true,
    },
}
```

### OutputResponseProcessor

通过 `llmagent.WithOutputKey(outputKey)` 安装 OutputResponseProcessor，使框架自动将最终的 JSON 响应提取到 `event.StructuredOutput` 字段中，无需修改框架代码。

## 代码解析

**Agent 构建**：注册模型、Skill 仓库、代码执行器和自定义的 `set_output_schema` 工具：

```go
a := llmagent.New("skill-dynamic-schema",
    llmagent.WithSkills(repo),
    llmagent.WithSkillToolProfile(llmagent.SkillToolProfileFull),
    llmagent.WithCodeExecutor(exec),
    llmagent.WithTools([]tool.Tool{&setOutputSchemaTool{}}),
    llmagent.WithOutputKey(outputKey),
)
```

**执行流程**：模型根据用户输入选择 `plan_route` 或 `recommend_poi` 技能 -> 调用 `skill_load` 加载 -> 从 SKILL.md 中提取 JSON Schema -> 调用 `set_output_schema` 设置约束 -> 调用 `skill_run` 获取结果 -> 返回符合 Schema 的 JSON。

**事件处理**：遍历事件流，追踪工具调用过程，最终从 `ev.StructuredOutput` 中获取类型化的结构化输出。

## 运行方式

```bash
cd examples/skilldynamicschema
export OPENAI_API_KEY="your-key"
go run . -model gpt-5

# 示例输入
> Plan a route from A to B and return distance and ETA. (Use plan_route for the output format.)
> Recommend a coffee shop POI in Shenzhen. (Use recommend_poi for the output format.)
```

## 总结

本示例展示了 Skill 系统的高级扩展模式。通过将 JSON Schema 嵌入 SKILL.md 并配合自定义工具动态注入，可以实现一个 Agent 在运行时支持多种输出格式的灵活架构。这一模式与 Skill 执行本身正交，可以叠加到任何标准 Skill 配置之上。
