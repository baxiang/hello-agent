# Placeholder 示例 - 基于会话状态的指令变量替换

## 概述

本示例演示如何在 Agent 指令中使用占位符（Placeholder），通过与 Session State 集成实现动态变量替换。占位符在 Agent 每次运行时自动从会话状态中解析并替换为实际值，适用于需要根据用户偏好、上下文环境等动态调整 Agent 行为的场景。

## 核心概念

### Placeholder 语法

tRPC-Agent-Go 支持在 Agent 的 `Instruction` 中使用花括号语法定义占位符：

- **会话级变量**：`{research_topics}` — 从 Session State 中读取
- **用户级变量**：`{user:topics}` — 从 User State 中读取，`user:` 前缀标识命名空间
- **应用级变量**：`{app:banner}` — 从 App State 中读取，`app:` 前缀标识命名空间
- **可选变量**：`{user:topics?}` — 末尾 `?` 表示该变量可选，缺失时不报错

### Session State 三级存储

框架提供三个层级的状态存储，Placeholder 可从中解析值：

| 层级 | API | 作用域 | 示例 |
|------|-----|--------|------|
| Session | `UpdateSessionState` | 单次会话 | 研究主题 |
| User | `UpdateUserState` | 同一用户的所有会话 | 用户兴趣偏好 |
| App | `UpdateAppState` | 应用全局 | 应用标语/配置 |

### 运行时解析

Placeholder 的解析发生在 Agent 每次运行前。框架会从 Session Service 中获取当前会话的合并状态，将 `{key}` 替换为对应的 `state[key]` 值。这意味着在运行期间通过命令修改状态后，下一次对话就会使用新的值。

## 代码解析

**1. 创建带 Placeholder 的 Agent**

```go
researchAgent := llmagent.New(
    "research-agent",
    llmagent.WithInstruction("You are a specialized research assistant. "+
        "Focus on session topics: {research_topics}. "+
        "Also consider user interests: {user:topics?}. "+
        "If an app banner is provided, show it briefly: {app:banner?}. "+
        "Provide comprehensive analysis..."),
)
```

指令中包含三个占位符，分别来自会话、用户和应用三个层级。`?` 后缀标记 `user:topics` 和 `app:banner` 为可选。

**2. 初始化 Session State**

```go
sessionService.CreateSession(ctx, session.Key{
    AppName: appName, UserID: d.userID, SessionID: d.sessionID,
}, session.StateMap{
    "research_topics": []byte("artificial intelligence, machine learning, deep learning"),
    "user:topics":     []byte("quantum computing, cryptography"),
    "app:banner":      []byte("Research Mode"),
})
```

创建会话时预设初始状态值，Agent 首次运行时 `{research_topics}` 会被替换为 "artificial intelligence, machine learning, deep learning"。

**3. 运行时动态更新状态**

```go
// 更新会话级主题
d.sessionService.UpdateSessionState(ctx, session.Key{...}, session.StateMap{
    "research_topics": []byte(topics),
})

// 更新用户级兴趣
d.sessionService.UpdateUserState(ctx, session.UserKey{...}, session.StateMap{
    "topics": []byte(topics),
})

// 更新应用级标语
d.sessionService.UpdateAppState(ctx, d.appName, session.StateMap{
    "banner": []byte(banner),
})
```

通过 `/set-session-topics`、`/set-user-topics`、`/set-app-banner` 命令分别更新三个层级的状态。更新后下一次对话立即生效。

## 运行方式

**环境准备：**

```bash
export OPENAI_API_KEY="your-api-key"
export OPENAI_BASE_URL="https://api.deepseek.com/v1"  # 可选
```

**运行命令：**

```bash
cd examples/placeholder
go run . -model deepseek-v4-flash
```

**预期输出：**

```
🔑 Placeholder Demo - Session State Integration
✅ Placeholder Demo initialized! Session: placeholder-demo-1234567890
🔗 Placeholders: {research_topics} (readonly), {user:topics?}, {app:banner?}

👤 You: What are the latest developments?
🔬 Research Agent: Based on current research topics (AI, ML, deep learning)...

👤 You: /set-session-topics blockchain, web3, NFT
✅ Session research topics updated to: blockchain, web3, NFT

👤 You: Explain recent breakthroughs
🔬 Research Agent: In the blockchain and Web3 space...  ← 主题已切换
```

## 总结

Placeholder 机制将 Agent 指令与运行时状态解耦，实现了 **同一 Agent 在不同会话/用户/应用环境下展现不同行为** 的能力。三级状态存储提供了灵活的作用域控制。与 **outputkey** 示例结合可以实现链式 Agent 间的数据传递，与 **prompt** 示例的 Langfuse 集成可以实现更复杂的模板管理。
