# Output Key State 示例 - 通过工具访问链式 Agent 的状态数据

## 概述

本示例是 `outputkey` 示例的进阶版本，同样使用 `WithOutputKey` 存储研究 Agent 的输出，但写作 Agent 通过 **自定义工具**（`get_session_state`）主动查询 Session State 中的数据，而非通过 Placeholder 被动注入。这种模式提供了更灵活的数据访问控制，适用于需要条件查询或多键访问的场景。

## 核心概念

### 工具方式 vs Placeholder 方式

两种数据传递方式的对比：

| 特性 | Placeholder（outputkey 示例） | 工具访问（本示例） |
|------|-------------------------------|-------------------|
| 数据注入时机 | Agent 运行前自动替换 | Agent 运行时主动调用工具查询 |
| 灵活性 | 固定引用指定键 | 可根据需要查询任意键 |
| Agent 感知 | Agent 不知道数据来源 | Agent 明确知道是从 State 获取 |
| 适用场景 | 简单单键传递 | 复杂条件查询、多键访问 |

### StateAccessTool

自定义工具实现 `tool.Tool` 接口，通过 `Declaration()` 声明工具的名称、描述和输入 Schema，通过 `Call()` 执行具体的状态查询逻辑。

## 代码解析

**1. 实现 StateAccessTool**

```go
type StateAccessTool struct {
    sessionService session.Service
    appName, userID, sessionID string
}

func (t *StateAccessTool) Declaration() *tool.Declaration {
    return &tool.Declaration{
        Name:        "get_session_state",
        Description: "Retrieve data from the current session state...",
        InputSchema: &tool.Schema{
            Type: "object",
            Properties: map[string]*tool.Schema{
                "key": {Type: "string", Description: "The key to retrieve"},
            },
            Required: []string{"key"},
        },
    }
}
```

工具声明定义了名称、描述和输入参数 Schema。模型会根据这些信息决定何时调用工具以及传递什么参数。

**2. 实现工具调用逻辑**

```go
func (t *StateAccessTool) Call(ctx context.Context, jsonArgs []byte) (any, error) {
    var params map[string]any
    json.Unmarshal(jsonArgs, &params)
    key := params["key"].(string)

    sessionData, _ := t.sessionService.GetSession(ctx, session.Key{...})
    if data, exists := sessionData.GetState(key); exists {
        return map[string]any{
            "result": fmt.Sprintf("Found data for key '%s': %s", key, string(data)),
        }, nil
    }
    // 返回可用键列表
    return map[string]any{"result": fmt.Sprintf("Available keys: %v", availableKeys)}, nil
}
```

工具通过 `sessionService.GetSession()` 获取会话状态，再通过 `GetState(key)` 查找指定键。如果键不存在，返回所有可用键帮助 Agent 自我修正。

**3. 配置写作 Agent 使用工具**

```go
writerAgent := llmagent.New(
    "writer-agent",
    llmagent.WithInstruction("First, use the get_session_state tool to retrieve "+
        "the research data using the key 'research_findings'. Then, create an "+
        "engaging summary..."),
    llmagent.WithTools([]tool.Tool{stateTool}),
)
```

通过 `WithTools` 将状态访问工具注入写作 Agent，并在指令中明确引导 Agent 先调用工具获取数据再开始写作。

**4. 链式 Agent 的数据流**

```go
// 研究 Agent 存储输出
researchAgent := llmagent.New("research-agent",
    llmagent.WithOutputKey("research_findings"),
)

// 链式组装
chainAgent := chainagent.New("output-key-state-chain",
    chainagent.WithSubAgents([]agent.Agent{researchAgent, writerAgent}),
)
```

研究 Agent 通过 `OutputKey` 将输出存入 State → 写作 Agent 通过工具调用读取 State。整个数据流通过 Session State 串联。

## 运行方式

**环境准备：**

```bash
export OPENAI_API_KEY="your-api-key"
export OPENAI_BASE_URL="https://api.deepseek.com/v1"  # 可选
```

**运行命令：**

```bash
cd examples/outputkeystate
go run . -model deepseek-v4-flash
```

**预期输出：**

```
🔑 Research & Content Creation Pipeline Demo
Chain: Research Agent → Content Writer Agent
Method: State-based data access with tool integration
✅ Output Key State Chain ready!
🔗 Data Flow: Research Agent (output_key) → Session State → Writer Agent (tool access)

👤 You: What are the emerging trends in renewable energy?
🔬 Research Agent: Renewable energy is experiencing rapid growth...
✍️  Writer Agent: [调用 get_session_state 工具，key="research_findings"]
  The renewable energy sector is undergoing a transformation...
```

## 总结

本示例展示了通过工具访问 Session State 实现链式 Agent 数据传递的高级模式。与 **outputkey** 示例的 Placeholder 方式相比，工具方式赋予了 Agent **主动查询数据的能力**，适合需要动态决定读取哪些数据、或需要在工具返回后进行二次推理的复杂场景。两种模式可以在同一链式 Agent 中混合使用，根据各环节的复杂度灵活选择。
