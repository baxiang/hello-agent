# 内置Explorer - 使用框架预置的探索型子Agent

## 概述

`builtinexplorer` 示例演示了如何使用框架内置的 `Explorer` Agent 预设。Explorer 是一个预配置的子 Agent，可以作为工具挂载到主 Agent 上，用于自主搜索和读取文档库中的信息，减少主 Agent 需要直接管理的工具数量。

## 核心概念

**Built-in Explorer** 是 `agent/llmagent/builtin` 包提供的预制 Agent。它封装了文档检索的通用模式，主 Agent 通过工具调用的方式委托 Explorer 去搜索和阅读文档。

将子 Agent 作为工具使用的方式：

```go
explorer := builtin.NewExplorer()
explorerTool := agenttool.NewTool(explorer)
```

`agenttool.NewTool` 将任何实现了 `agent.Agent` 接口的对象包装为 `tool.Tool`，这样主 Agent 就可以通过工具调用机制委派任务给子 Agent。

## 代码解析

**完整的 Agent 配置：**

```go
func (d *demo) setup() error {
    m := openai.New(d.modelName)
    explorer := builtin.NewExplorer()
    explorerTool := agenttool.NewTool(explorer)

    agentOpts := []llmagent.Option{
        llmagent.WithModel(m),
        llmagent.WithInstruction(
            "You are a documentation assistant. When you need to look up "+
            "details, always call the explorer tool."),
        llmagent.WithTools([]tool.Tool{
            d.searchDocsTool(),
            d.readDocTool(),
            explorerTool,
        }),
    }
    root := llmagent.New("doc-assistant", agentOpts...)
    d.runner = runner.NewRunner("builtin-explorer-example", root)
    return nil
}
```

示例维护了一个内存中的 `knowledgeBase`，包含事故响应手册、发布策略、客户升级说明三份文档。`search_docs` 支持关键词搜索返回匹配文档 ID 和标题，`read_doc` 根据 ID 返回完整内容。

主 Agent 被指示优先使用 Explorer 工具而非直接调用底层的 search/read 工具，展示了子 Agent 作为能力封装层的设计模式。

## 运行方式

```bash
cd examples

export OPENAI_API_KEY="your-key"

go run ./builtinexplorer -model=deepseek-v4-flash
```

交互示例：
- "查找事故响应手册并总结关键步骤"
- "搜索发布策略文档，说明什么情况需要回滚"

## 总结

Built-in Explorer 展示了将子 Agent 封装为工具的设计模式。这种模式的好处是：主 Agent 的工具列表更简洁、子 Agent 可以独立管理其内部的工具链和推理逻辑。对于需要多层级 Agent 协作的复杂系统，这是一种优雅的组合方式。
