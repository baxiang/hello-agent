# LLM Chat Completion 基础 — trpc-agent-go 的对话引擎

> trpc-agent-go 的所有 Agent 本质都在驱动 LLM Chat Completion——不懂 token/temperature/角色，调任何 `llmagent.New` 都像念咒。

## 核心概念

LLM Chat Completion 指把一段「对话历史」发给模型，模型返回「下一条回复」。它的输入输出格式被 OpenAI Chat Completions API 事实标准化，几乎所有 provider（DeepSeek、Claude、Gemini、Hunyuan）都兼容这一协议。trpc-agent-go 在此之上做的封装，本质就是构造请求、解析响应。下面四点必须先吃透：

1. **token**：模型计费和上下文长度的最小单位，由 tokenizer 把文本切成 token 序列。经验上 1 token ≈ 0.75 个英文单词；中文每个字通常占 1～2 token。`max_tokens` 限制的是**输出**长度，不是输入。
2. **角色（role）**：每条 message 必须带 role，模型按角色理解对话结构：

   | Role | 含义 | 典型用途 |
   |------|------|----------|
   | `system` | 系统指令，最高优先级 | 设定人设、风格、硬规则 |
   | `user` | 用户输入 | 当前轮提问 |
   | `assistant` | 模型上一轮回复 | 维持多轮上下文 |
   | `tool` | 工具执行结果 | 把 function call 的返回值喂回模型 |

3. **请求结构**：一次 Chat Completion 请求 ≈ `messages[]` + 采样参数 + 流式开关。伪 JSON：

   ```json
   {
     "model": "deepseek-v4-flash",
     "messages": [
       {"role": "system",    "content": "你是一个简洁的助手。"},
       {"role": "user",      "content": "1+1=?"},
       {"role": "assistant", "content": "2"},
       {"role": "user",      "content": "再加3呢？"}
     ],
     "temperature": 0.7,
     "max_tokens": 2000,
     "stream": true
   }
   ```

   `messages` 是**有序**数组，模型按顺序读完整段历史再续写；多轮对话靠的就是把历史原样塞回 messages。

4. **采样参数**：决定模型如何「挑选」下一个 token。

   | 参数 | 范围 | 作用 |
   |------|------|------|
   | `temperature` | 0.0 ~ 2.0 | 0 = 几乎确定（greedy），越高越发散，>1.5 容易出乱码 |
   | `top_p` | 0.0 ~ 1.0 | nucleus sampling，只在累计概率 top_p 的候选里挑，常与 temperature 二选一 |
   | `max_tokens` | 整数 | 输出上限，**不设就是放任成本** |
   | `stream` | bool | true 走 SSE 流式逐 token 推送；false 一次性返回完整 response |

   口诀：`temperature` 管「敢不敢乱说」，`max_tokens` 管「能说多久」，`stream` 管「要不要边说边给」。

## 在 trpc-agent-go 里

### Message 结构

`model/request.go:64` 定义了对应 messages[] 里每一条的结构：

```go
// model/request.go:64
type Message struct {
    Role    Role   `json:"role"`              // system / user / assistant / tool
    Content string `json:"content,omitempty"` // 文本内容
    // 多模态、工具调用、reasoning 等字段略
    ToolCalls []ToolCall `json:"tool_calls,omitempty"`
    ToolID    string     `json:"tool_id,omitempty"`
    ToolName  string     `json:"tool_name,omitempty"`
    // ...
}
```

`Role` 是字符串类型别名，`model/request.go:28-32` 给出四个常量：

```go
// model/request.go:28
const (
    RoleSystem    Role = "system"
    RoleUser      Role = "user"
    RoleAssistant Role = "assistant"
    RoleTool      Role = "tool"
)
```

框架提供 `model.NewUserMessage(s)` / `NewSystemMessage(s)` / `NewAssistantMessage(s)` 等工厂函数（见 `request.go:360`），构造消息时优先用它们而不是手写字面量。

### GenerationConfig 结构

`model/request.go:369` 把上面那一堆采样参数收敛成一个 struct：

```go
// model/request.go:369
type GenerationConfig struct {
    MaxTokens   *int     `json:"max_tokens,omitempty"`
    Temperature *float64 `json:"temperature,omitempty"`
    TopP        *float64 `json:"top_p,omitempty"`
    Stream      bool     `json:"stream"`
    Stop        []string `json:"stop,omitempty"`
    // presence_penalty / frequency_penalty / logprobs / reasoning_effort 等略
}
```

注意 `MaxTokens` / `Temperature` / `TopP` 都是**指针**——这样能区分「未设置（nil，用 provider 默认）」和「显式设为 0」。这也是为什么示例里要写 `intPtr(2000)` 而不是直接 `2000`。

### 真实用法

`examples/runner/main.go:108-122` 是官方推荐写法：

```go
// examples/runner/main.go:108
genConfig := model.GenerationConfig{
    MaxTokens:   intPtr(2000),   // 输出上限 2000 token
    Temperature: floatPtr(0.7),  // 适度发散
    Stream:      c.streaming,    // 由 flag 控制
}

llmAgent := llmagent.New(
    agentName,
    llmagent.WithModel(modelInstance),
    llmagent.WithDescription("A helpful AI assistant with calculator and time tools."),
    llmagent.WithInstruction("Use tools when helpful for calculations or time queries."),
    llmagent.WithGenerationConfig(genConfig),  // ← 注入采样参数
    llmagent.WithTools([]tool.Tool{calculatorTool, timeTool}),
)
```

`intPtr` / `floatPtr` 是 `examples/runner/tools.go:112` 里的两个小工具函数，本质就是 `return &i`。Agent 跑起来后，trpc-agent-go 会把 `genConfig`、Instruction（框架放到 system 位置）、tools、当前 user message 拼成 Chat Completion 请求发给 provider，再把响应包成 `*event.Event` 推到 channel——也就是上一篇 [01-concurrency-channel](./01-concurrency-channel) 讲的那条 `<-chan *event.Event`。

## 常见陷阱

### 陷阱 1：temperature 拉到 2.0 追求「创意」→ 输出乱码

❌ 把 `Temperature: floatPtr(2.0)` 当默认值，期望模型更有创造力。2.0 是 API 允许的上限，概率分布被拉得极平，模型会随机挑低概率 token，结果常常是不可读的字符 salad、跑题甚至乱码。

✅ 修复：通用对话 0.7 起步；写代码/做数学/调工具用 0.0～0.3；创意写作最高到 1.0～1.2 就够。需要确定性输出（如 function call 选工具）一律 ≤ 0.2。

```go
// ❌ 乱码温
genConfig := model.GenerationConfig{Temperature: floatPtr(2.0)}

// ✅ 工具调用场景的保守温度
genConfig := model.GenerationConfig{Temperature: floatPtr(0.0)}
```

### 陷阱 2：system message 放在 user 之后 → 被忽略或权重暴跌

❌ messages 顺序写成 `[user, system, user]`，指望中途插一句规则改变模型行为。多数 provider 只认**第一条** system（或把后续 system 大幅降权），对话中部的 system 几乎没有约束力。

✅ 修复：system 永远在 messages[0]。trpc-agent-go 里用 `llmagent.WithInstruction(...)` 让框架统一处理 system 位置，别再手动往 messages 头部插 system。

```go
// ❌ system 错位
messages := []model.Message{
    model.NewUserMessage("帮我算账"),
    model.NewSystemMessage("你只能用整数"),  // 几乎无效
}

// ✅ 让框架管 system
llmagent.New(name,
    llmagent.WithInstruction("你只能用整数"),  // 框架放 messages[0]
    // ...
)
```

### 陷阱 3：不设 max_tokens → 成本失控

❌ `GenerationConfig{Temperature: floatPtr(0.7)}` 省略 `MaxTokens`，模型一次输出几千 token，单次调用费用暴涨；某些 provider 默认上限就是上下文窗口，一次能烧掉几万 token。

✅ 修复：业务侧永远显式设 `MaxTokens`，按场景定：闲聊 500、长文总结 2000、代码生成 4000。nil 只在你明确想用 provider 默认值时才用。

```go
// ❌ 放任
genConfig := model.GenerationConfig{Temperature: floatPtr(0.7)}

// ✅ 上限明确
genConfig := model.GenerationConfig{
    MaxTokens:   intPtr(2000),
    Temperature: floatPtr(0.7),
}
```

### 陷阱 4：开 tool calling 却用高 temperature → 工具选择不稳定

❌ Agent 同时挂了 calculator 和 current_time 两个工具，temperature 设 1.2，结果模型一会儿调对工具一会儿调错，同一个问题两次回复选不同工具。function call 的「选哪个函数」本质是个分类任务，高温度直接破坏稳定性。

✅ 修复：只要 Agent 装了工具，temperature 压到 0.0～0.3；如果还需要文字发散，拆成两个 Agent（低温的负责选工具+执行，高温的负责润色回复），而不是在一个 config 里既要又要。

```go
// ❌ 工具乱跳
genConfig := model.GenerationConfig{
    Temperature: floatPtr(1.2),
    Stream:      true,
}

// ✅ 带 tools 就压温度
genConfig := model.GenerationConfig{
    Temperature: floatPtr(0.2),
    MaxTokens:   intPtr(2000),
    Stream:      true,
}
```

## 小结

- Chat Completion 的输入就是「messages[] + 采样参数」，messages 用 role 区分 system/user/assistant/tool，顺序敏感。
- `temperature`（发散度）、`max_tokens`（输出上限）、`stream`（流式）是三个最常调的旋钮；`top_p` 与 temperature 二选一。
- trpc-agent-go 用 `model.Message`（`request.go:64`）对应单条 message，用 `model.GenerationConfig`（`request.go:369`）收敛采样参数，指针字段区分「未设」和「0」。
- 实战姿势见 `examples/runner/main.go:108`：构造 `GenerationConfig` → `llmagent.WithGenerationConfig` 注入 → 框架自动拼请求、drain 响应到 event channel。

**延伸阅读：**

- [模型与提供商](../examples/13-model-provider/model.md)
- [OpenAI API 文档](https://platform.openai.com/docs/api-reference/chat)
- [Tool Calling 工作机制](./08-tool-calling)
