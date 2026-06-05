# Agent 转移（Handoffs）

Handoff 是 OpenAI Agents SDK 的多 Agent 协作机制——一个 Agent 将整个对话的控制权转移给另一个 Agent。

## 1. Handoff vs Agent-as-Tool

| 特性 | Handoff | Agent-as-Tool |
|------|---------|---------------|
| 控制权 | **完全转移**，父 Agent 不再参与 | 调用后**返回**父 Agent |
| 对话历史 | 子 Agent 接收完整历史 | 子 Agent 只看到单次调用的输入 |
| 适用场景 | 路由分发、专业化处理 | 子任务委托、翻译/摘要 |
| 配置方式 | `handoffs=[agent]` | `tools=[agent.as_tool()]` |

## 2. 基础 Handoff

```python
from agents import Agent, Runner, handoff

support_agent = Agent(
    name="support",
    instructions="Handle customer support inquiries.",
)
billing_agent = Agent(
    name="billing",
    instructions="Handle billing and payment issues.",
)

triage = Agent(
    name="triage",
    instructions="Route the user to the right department.",
    handoffs=[support_agent, billing_agent],
)
```

## 3. handoff() 函数详解

```python
from agents import handoff

handoff(
    agent,                              # 目标 Agent
    tool_name_override="transfer",      # 覆盖工具名
    tool_description_override=(
        "Transfer to support for help with account issues."
    ),
    input_filter=lambda history: history[-3:],  # 只传最近 3 轮对话
    on_handoff=lambda ctx: print("Handoff triggered!"),  # 回调
)
```

### 用 input_filter 控制历史

```python
# 只传递当前用户消息（不带历史）
handoff(agent, input_filter=lambda history: history[-1:])

# 传递最近 5 轮对话
handoff(agent, input_filter=lambda history: history[-5:])

# 自定义过滤逻辑
def filter_sensitive(history):
    return [msg for msg in history if "password" not in str(msg)]

handoff(agent, input_filter=filter_sensitive)
```

## 4. 动态 Handoff

```python
from agents import Agent, handoff, RunContextWrapper

def get_handoffs(ctx: RunContextWrapper[MyContext], agent: Agent):
    """根据用户类型动态决定可转移的 Agent"""
    user_type = ctx.context.user_type
    if user_type == "premium":
        return [
            handoff(premium_support),
            handoff(billing),
        ]
    else:
        return [
            handoff(basic_support),
        ]

triage = Agent(
    name="triage",
    handoffs=get_handoffs,
)
```

## 5. Handoff 历史追踪

```python
result = await Runner.run(triage_agent, "I need help with billing")

# 查看 handoff 链
for item in result.new_items:
    if item.type == "handoff_call_item":
        print(f"→ Transferred to {item.raw_item.name} agent")
    elif item.type == "handoff_output_item":
        print(f"← Got output from {item.source_agent.name}")
```

## 6. 多层 Handoff

```python
# 三层架构
front_desk = Agent(
    name="front_desk",
    handoffs=[technical_dept, billing_dept],
)

technical_dept = Agent(
    name="technical",
    handoffs=[network_team, database_team],  # 二级 handoff
)

network_team = Agent(name="network", ...)
database_team = Agent(name="database", ...)
```

## 7. Handoff 回调

```python
async def on_handoff_callback(ctx: RunContextWrapper, agent: Agent):
    """Handoff 发生时触发"""
    logger.info(f"Handoff from {ctx.agent.name} to {agent.name}")

async def after_handoff_callback(ctx: RunContextWrapper, agent: Agent):
    """Handoff 完成后触发"""
    logger.info(f"Handoff to {agent.name} completed")

handoff(
    target_agent,
    on_handoff=on_handoff_callback,
    on_after_handoff=after_handoff_callback,
)
```

## 8. 在流式模式中追踪 Handoff

```python
result = Runner.run_streamed(triage, "Billing question")

async for event in result.stream_events():
    if event.type == "agent_updated":
        new_agent = event.data.agent
        print(f"[Switched to {new_agent.name}]")
```

## 9. 常见模式

### 模式一：意图路由（Triage）

```python
triage = Agent(
    name="triage",
    instructions="Route to the right department based on user intent.",
    handoffs=[
        handoff(support, tool_description_override="For account, login, settings issues"),
        handoff(billing, tool_description_override="For payment, invoice, refund issues"),
        handoff(sales, tool_description_override="For new purchases, upgrades"),
    ],
)
```

### 模式二：升级链条（Escalation）

```python
tier1 = Agent(name="tier1", handoffs=[tier2])
tier2 = Agent(name="tier2", handoffs=[tier3])
tier3 = Agent(name="tier3")  # 最高级别，不再 handoff
```

### 模式三：专业化流水线

```python
researcher = Agent(name="researcher", handoffs=[analyst])
analyst = Agent(name="analyst", handoffs=[writer])
writer = Agent(name="writer")

# 用户 → researcher 搜索 → analyst 分析 → writer 撰写报告
```

## 10. 常见问题

**Q：Handoff 后历史会丢失吗？**

A：不会。默认传递完整对话历史。用 `input_filter` 可以控制传递多少。

**Q：一个 Agent 可以有多少个 Handoff 目标？**

A：没有硬性限制。但建议不超过 10 个，否则 LLM 路由准确率下降。

**Q：Handoff 和 LangGraph 的 Edge 有什么区别？**

A：Handoff 由 LLM **自主决策**何时转移；LangGraph Edge 是**代码定义**的固定路由。Handoff 更灵活但不可预测。
