# 会话与记忆

OpenAI Agents SDK 提供三种会话持久化方案，自动管理对话历史，让 Agent 在多次调用间保持上下文。

## 1. 基础用法

```python
from agents import Agent, Runner

agent = Agent(name="assistant", model="gpt-4o")

# 同一 session_id 的多次调用自动管理历史
result1 = await Runner.run(agent, "My name is Alice", session_id="user-123")
result2 = await Runner.run(agent, "What's my name?", session_id="user-123")
print(result2.final_output)  # "Your name is Alice."
```

## 2. 三种 Session 后端

| 后端 | 持久化 | 适用场景 |
|------|--------|----------|
| InMemory | ❌ 进程内 | 开发测试 |
| SQLite | ✅ 本地文件 | 单机部署 |
| OpenAI-Managed | ✅ 云端 | 生产环境 |

## 3. InMemory（默认）

```python
from agents import Runner

# 默认就是 InMemory — 无需配置
result = await Runner.run(agent, "Hello", session_id="s1")
```

进程重启后历史丢失，仅适合开发调试。

## 4. SQLite

```python
import sqlite3
from agents import SQLiteSession, Runner

conn = sqlite3.connect("sessions.db")
session = SQLiteSession(conn)

result = await Runner.run(
    agent, "Hello",
    session_id="user-123",
    session=session,
)
```

SQLite 文件持久化，适合单机生产部署。schema 自动创建。

## 5. OpenAI-Managed

```python
from agents import OpenAISession, Runner

session = OpenAISession()

result = await Runner.run(
    agent, "Hello",
    session_id="user-123",
    session=session,
)
```

由 OpenAI 托管存储，适合云端部署。需要 OpenAI API Key。

## 6. 会话历史访问

```python
from agents import Runner

result = await Runner.run(agent, "Hello", session_id="s1")

# 获取会话完整历史
history = result.to_input_list()
for item in history:
    if item.type == "message_output_item":
        print(f"[{item.role}] {item.content[:50]}...")
```

## 7. 会话管理

```python
# 创建新会话
result = await Runner.run(agent, "Start", session_id="new-session")

# 查看会话 ID
print(result.session_id)

# 清除会话历史（开始新对话）
# 只需使用新的 session_id
result = await Runner.run(agent, "New conversation", session_id="another-session")
```

## 8. 记忆压缩

对话过长时，SDK 自动截断历史（保留最近 N 轮）：

```python
from agents import Agent, ModelSettings

agent = Agent(
    name="assistant",
    model="gpt-4o",
    model_settings=ModelSettings(
        # 部分模型支持自动上下文压缩
    ),
)
```

对于不支持自动压缩的模型，可用 `input_filter` 控制历史长度：

```python
from agents import handoff

handoff(
    agent,
    input_filter=lambda history: history[-10:],  # 只保留最近 10 轮
)
```

## 9. 自定义 Session 后端

```python
from agents import Session

class RedisSession(Session):
    """自定义 Redis 会话存储"""
    def __init__(self, redis_client):
        self.redis = redis_client

    async def get_items(self, session_id: str):
        data = await self.redis.get(f"session:{session_id}")
        return json.loads(data) if data else []

    async def add_items(self, session_id: str, items):
        existing = await self.get_items(session_id)
        existing.extend(items)
        await self.redis.set(f"session:{session_id}", json.dumps(existing))
```

## 10. 常见问题

**Q：会话数据包含哪些内容？**

A：用户消息、Agent 响应、工具调用/结果、handoff 事件——完整的对话记录。

**Q：会话有过期时间吗？**

A：SQLite 和 OpenAI-Managed 由存储层决定；InMemory 在进程退出时清除。

**Q：如何在生产中选择 Session 后端？**

A：小型部署用 SQLite（零运维）；大规模部署用 OpenAI-Managed（免运维）或自定义 Redis/PostgreSQL。
