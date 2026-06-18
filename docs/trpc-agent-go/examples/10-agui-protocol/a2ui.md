# A2UI 协议示例 - 基于 AG-UI 的富交互 UI 渲染

## 概述

A2UI（Agent-to-UI）是 tRPC-Agent-Go 在 AG-UI 协议基础上扩展的 UI 渲染协议。该示例演示了如何将 LLM Agent 的输出通过 A2UI 翻译器转换为结构化的 UI 组件，并在浏览器中实时渲染。适用于需要 Agent 动态生成交互式界面的场景，如表单填写、问卷调查和数据展示面板。

## 核心概念

**A2UI 翻译器（Translator）**：A2UI 在 AG-UI 的事件流之上增加了一层翻译层。AG-UI 负责 Agent 运行生命周期事件（`run_started`、`run_finished`），而 A2UI 翻译器将 Agent 的文本输出转换为 `surfaceUpdate`、`beginRendering`、`dataModelUpdate` 等 UI 渲染指令。

**Surface 与组件树**：A2UI 采用声明式 UI 模型。每个 Surface 拥有唯一 ID，包含一棵由 `Text`、`Row`、`Column`、`Card`、`Button`、`TextField`、`MultipleChoice` 等组件节点构成的组件树。组件之间通过 ID 引用建立父子关系。

**数据模型绑定**：表单组件可通过 `path` 绑定到 Surface 的数据模型。用户在浏览器中修改输入时，数据模型在本地同步更新；点击 Button 等显式操作组件时，才会将当前数据状态回传给 Agent。

## 代码解析

### 服务端：创建 A2UI Server

```go
// server/default/main.go
agent := newAgent()
sessionService := inmemory.NewSessionService()
r := runner.NewRunner(agent.Info().Name, agent, runner.WithSessionService(sessionService))

innerTranslatorFactory := translator.NewFactory()
a2uiTranslatorFactory := a2uitranslator.NewFactory(innerTranslatorFactory, nil)
server, err := agui.New(
    r,
    agui.WithPath(*path),
    agui.WithSessionService(sessionService),
    agui.WithAGUIRunnerOptions(
        aguirunner.WithTranslatorFactory(a2uiTranslatorFactory),
    ),
)
```

关键步骤：先创建标准的 AG-UI `translator.NewFactory()`，再用 `a2uitranslator.NewFactory()` 包装，使服务端在输出 AG-UI 事件的同时注入 A2UI 渲染指令。Session Service 用于跨请求保持会话状态。

### 服务端：Agent 配置与 A2UI Planner

```go
// server/default/agent.go
return llmagent.New(
    "a2ui-agent",
    llmagent.WithTools([]tool.Tool{calculatorTool}),
    llmagent.WithModel(modelInstance),
    llmagent.WithPlanner(a2ui.New()),
)
```

`llmagent.WithPlanner(a2ui.New())` 为 Agent 注入 A2UI Planner，使 LLM 的输出自动映射为 A2UI 组件树结构，而非纯文本流。

### 客户端：SSE 事件消费与 UI 渲染

浏览器客户端通过 `POST` 请求建立 SSE 连接，解析每一帧事件。当收到 `type: "raw"` 的 AG-UI 事件时，提取其中的 A2UI 载荷：

```javascript
if (eventType.toLowerCase() === "raw") {
    const message = extractRawPayload(rawPayload);
    renderA2UIMessage(message || rawPayload);
}
```

`renderA2UIMessage` 根据载荷类型分发到对应处理函数：`surfaceUpdate` 触发全量组件树渲染，`dataModelUpdate` 触发增量数据刷新，`deleteSurface` 移除指定 Surface。

## 运行方式

**环境准备**：

```bash
export OPENAI_API_KEY="your-api-key"
export OPENAI_BASE_URL="https://api.openai.com/v1"
```

**启动服务端**：

```bash
cd examples/a2ui/server/default
go run . -model gpt-5.4
```

**启动客户端**：

```bash
cd examples/a2ui/client
python3 -m http.server 4173
# 浏览器访问 http://127.0.0.1:4173
```

在浏览器输入提示词（如"build a restaurant menu with title, divider and two cards"），右侧面板将实时渲染 A2UI 组件。左侧面板可切换查看 AG-UI 原始事件流和 A2UI 解析事件流。

## 总结

本示例展示了 A2UI 协议的完整链路：从 Agent 输出到翻译器转换，再到浏览器渲染。核心收获包括：A2UI Planner 如何驱动 LLM 生成结构化 UI；Translator 工厂模式如何在不修改 Agent 逻辑的前提下注入 UI 能力；以及声明式组件树配合数据模型绑定的交互模式。该示例与 `agui` 示例形成互补——`agui` 聚焦标准 AG-UI 文本流协议，而 `a2ui` 扩展到富交互 UI 场景。
