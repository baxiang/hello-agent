# A2A 子 Agent 协作示例 - 协调者模式实现多 Agent 任务分发

## 概述

本示例演示基于 A2A 协议的多 Agent 协作系统。系统采用协调者（Coordinator）模式，通过一个中心协调 Agent 管理多个远程专业子 Agent，根据用户请求智能分发任务。包含计算器 Agent（数学计算）和代码检查 Agent（Go 代码规范分析）两个远程子 Agent。

## 核心概念

### 协调者模式（Coordinator Pattern）

协调者 Agent 作为系统入口，接收用户请求并决定由哪个子 Agent 处理：

```
用户 → 协调者 Agent → Calculator Agent (远程 A2A, 端口 8087)
                    → CodeCheck Agent  (远程 A2A, 端口 8088)
```

协调者通过 `transfer_to_agent` 工具实现 Agent 间转移，框架自动处理转移事件和响应流的切换。

### 远程子 Agent 注册

远程 A2A Agent 通过 `a2aagent.New()` 创建后，可以作为子 Agent 注入到 LLMAgent 中。协调者 Agent 通过 `llmagent.WithSubAgents()` 注册所有子 Agent，框架自动生成 `transfer_to_agent` 工具供 LLM 调用。

### Agent 转移事件

当协调者决定将任务转移到子 Agent 时，事件流中会出现 `model.ObjectTypeTransfer` 类型的事件。客户端可以监听此事件实现 UI 上的 Agent 切换提示。

## 代码解析

**1. 创建远程子 Agent**

```go
remoteAgents := make([]agent.Agent, 0)
for _, url := range agentURLS {
    agent, err := a2aagent.New(a2aagent.WithAgentCardURL(url))
    remoteAgents = append(remoteAgents, agent)
}
```

遍历远程 Agent 的 URL 列表，为每个远程服务创建 A2A Agent 代理。`a2aagent` 自动从 `/.well-known/agent.json` 获取 Agent Card 信息。

**2. 创建协调者 Agent**

```go
coordinatorAgent := llmagent.New(
    "agent_coordinator",
    llmagent.WithModel(modelInstance),
    llmagent.WithDescription(desc),
    llmagent.WithInstruction(desc),
    llmagent.WithGenerationConfig(genConfig),
    llmagent.WithSubAgents(subAgents),
)
```

`WithSubAgents(subAgents)` 是关键配置，框架会根据子 Agent 列表自动生成 `transfer_to_agent` 工具，LLM 可以根据用户意图选择合适的子 Agent。

**3. 处理 Agent 转移事件**

```go
func handleTransfer(event *event.Event, currentAgent *string, assistantStarted *bool) bool {
    if event.Object == model.ObjectTypeTransfer {
        fmt.Printf("🔄 Transfer Event: %s\n", event.Response.Choices[0].Message.Content)
        *currentAgent = getAgentFromTransfer(event)
        *assistantStarted = false
        return true
    }
    return false
}
```

通过检查 `event.Object == model.ObjectTypeTransfer` 判断是否为转移事件，并从事件内容中解析目标 Agent 名称，更新当前 Agent 标识用于 UI 展示。

**4. 子 Agent 服务端（以 CodeCheck Agent 为例）**

```go
codeCheckAgent := llmagent.New(
    "CodeCheckAgent",
    llmagent.WithModel(modelInstance),
    llmagent.WithTools([]tool.Tool{readSpecTool}),
)

server, err := a2a.New(
    a2a.WithHost(*host),
    a2a.WithAgent(codeCheckAgent, true),
    a2a.WithAgentCard(agentCard),
)
```

CodeCheck Agent 配备了 `ReadGolangStandardSpec` 工具，可以读取本地的 Go 语言规范文件。通过 `WithAgentCard` 自定义 Agent Card，声明 Agent 的能力、技能标签等元信息。

## 运行方式

**环境准备：**

```bash
export OPENAI_API_KEY="your-api-key"
export OPENAI_BASE_URL="https://api.deepseek.com/v1"
export OPENAI_MODEL="deepseek-v4-flash"
```

**一键启动：**

```bash
cd examples/a2asubagent
chmod +x start.sh
./start.sh
```

**手动启动：**

```bash
# 终端 1：启动计算器 Agent
cd examples/a2asubagent/agents/calculator
go run calculate_agent.go -host 0.0.0.0:8087

# 终端 2：启动代码检查 Agent
cd examples/a2asubagent/agents/codecheck
go run codecc_agent.go -host 0.0.0.0:8088

# 终端 3：启动客户端
cd examples/a2asubagent/client
go run client.go
```

**预期输出：**

```
User: calculate 123 + 456
🎯 Coordinator: I'll transfer you to the calculator agent.
🔄 Transfer Event: Transferring control to agent: calculator
🧮 Calculator: 123 + 456 = 579

User: query golang spec
🎯 Coordinator: I'll transfer you to the CodeCheckAgent.
🔄 Transfer Event: Transferring control to agent: CodeCheckAgent
🔍 Code Checker: Here are the Go language standards...
```

## 总结

本示例展示了基于 A2A 协议的多 Agent 协作编排模式。关键收获：

- `WithSubAgents` 自动为协调者生成 Agent 转移工具，LLM 智能决定任务分发
- 远程 A2A Agent 与本地 Agent 可统一作为子 Agent 注册，架构上无差异
- Agent 转移事件（`ObjectTypeTransfer`）支持客户端实现丰富的交互体验
- `start.sh` 脚本提供了生产级的服务编排参考，包含健康检查和优雅停机

进一步学习可参考 **a2amultipath** 示例了解单端口多 Agent 部署，以及 **a2aagent** 示例了解 A2A 协议的消息钩子和自定义 HTTP 头等高级功能。
