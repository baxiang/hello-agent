# LLM 记忆层实践 — 集成指南

> 如何在 Agent 项目中集成 Mem0、SuperMemory、Memori、memU 四种记忆系统。覆盖 Python、TypeScript 和 tRPC-Agent-Go 的完整接入示例。

## 1. Mem0 集成

### 1.1 Python Agent 集成

```python
from mem0 import Memory
from openai import OpenAI

# 初始化记忆层
memory = Memory()

llm = OpenAI()

def chat_with_memory(user_id: str, message: str):
    # 1. 搜索相关记忆
    relevant_memories = memory.search(message, user_id=user_id, limit=5)
    memory_context = "\n".join([
        f"- {m['memory']}" for m in relevant_memories.get("results", [])
    ])

    # 2. 构建 prompt
    system_prompt = f"""You are a helpful assistant.
User information from previous conversations:
{memory_context}

When the user shares new information, you will remember it."""
    messages = [
        {"role": "system", "content": system_prompt},
        {"role": "user", "content": message},
    ]

    # 3. 调用 LLM
    response = llm.chat.completions.create(
        model="gpt-4o-mini",
        messages=messages,
    )
    answer = response.choices[0].message.content

    # 4. 异步添加新记忆
    memory.add(f"User: {message}\nAssistant: {answer}", user_id=user_id)

    return answer

# 使用
print(chat_with_memory("user-1", "My name is John and I'm a Go developer."))
print(chat_with_memory("user-1", "What's my name and job?"))
# 输出: "Your name is John and you are a Go developer."
```

### 1.2 tRPC-Agent-Go 集成

Mem0 提供 REST API，可通过 MCP 或自定义 Tool 接入：

```go
package main

import (
    "bytes"
    "encoding/json"
    "fmt"
    "net/http"
)

type Mem0Client struct {
    baseURL string
    apiKey  string
    client  *http.Client
}

func NewMem0Client(baseURL, apiKey string) *Mem0Client {
    return &Mem0Client{
        baseURL: baseURL,
        apiKey:  apiKey,
        client:  &http.Client{},
    }
}

// Search 搜索记忆
func (c *Mem0Client) Search(query, userID string) ([]string, error) {
    body := map[string]any{
        "query":   query,
        "user_id": userID,
        "limit":   5,
    }
    data, _ := json.Marshal(body)

    req, _ := http.NewRequest("POST", c.baseURL+"/v2/memories/search/", bytes.NewReader(data))
    req.Header.Set("Authorization", "Token "+c.apiKey)
    req.Header.Set("Content-Type", "application/json")

    resp, err := c.client.Do(req)
    if err != nil {
        return nil, err
    }
    defer resp.Body.Close()

    var result map[string]any
    json.NewDecoder(resp.Body).Decode(&result)

    var memories []string
    for _, r := range result["results"].([]any) {
        m := r.(map[string]any)
        memories = append(memories, m["memory"].(string))
    }
    return memories, nil
}

// 在 LLMAgent 中作为 Memory Service 使用
// 实现 memory.Service 接口即可无缝接入 tRPC-Agent-Go
```

### 1.3 Mem0 多租户配置

```python
# 用户级隔离
memory.add("User prefers concise answers", user_id="user-1")
memory.add("User is a visual learner", user_id="user-2")

# Agent 级隔离（同一用户的不同 Agent 场景）
memory.add("Customer prefers email contact", user_id="user-1", agent_id="customer-service")
memory.add("Customer interested in upgrade", user_id="user-1", agent_id="sales")

# Run 级隔离（单次对话的临时记忆）
memory.add("User mentioned budget concern", user_id="user-1", run_id="conv-123")
```

---

## 2. SuperMemory 集成

### 2.1 Vercel AI SDK 集成

```typescript
import { createSuperMemory } from "@supermemory/ai-sdk";

const memory = createSuperMemory({
  apiKey: process.env.SUPERMEMORY_API_KEY!,
});

// 自动记忆注入
const { text } = await generateText({
  model: openai("gpt-4o-mini"),
  messages: [{ role: "user", content: "What's my preference?" }],
  experimental_context: await memory.getContext({
    userId: "user-1",
  }),
});
```

### 2.2 MCP Server 集成

```json
{
  "mcpServers": {
    "supermemory": {
      "command": "npx",
      "args": ["-y", "@supermemory/mcp"],
      "env": {
        "SUPERMEMORY_API_KEY": "sm_xxx"
      }
    }
  }
}
```

### 2.3 空间与标签管理

```typescript
// 创建记忆空间
await memory.createSpace({
  name: "Project Alpha",
  description: "Memories for Project Alpha development",
});

// 添加记忆并打标签
await memory.add({
  content: "The API rate limit is 100 requests per minute",
  spaceId: "space-1",
  tags: ["api", "rate-limit", "backend"],
  metadata: {
    source: "documentation",
    version: "v2.1",
  },
});

// 按标签查询
const docs = await memory.search({
  query: "rate limit configuration",
  tags: ["api", "rate-limit"],
});
```

---

## 3. Memori 集成

### 3.1 零代码 LLM 拦截模式

Memori 的核心理念是透明拦截——不修改 Agent 代码即可获得记忆能力：

```python
from memori import MemoriClient
from openai import OpenAI

# 创建 Memori 客户端
memori = MemoriClient(
    api_key="memori_xxx",
)

# 原始 OpenAI 客户端
llm = OpenAI()

# 通过 Memori 拦截 LLM 调用
# Memori 自动提取对话记忆，注入到后续调用中
llm = memori.wrap_openai(llm)

# 之后的 LLM 调用自动获得记忆能力
response = llm.chat.completions.create(
    model="gpt-4o-mini",
    messages=[{"role": "user", "content": "My name is Alice."}],
)
# Memori 自动记住 "用户名是 Alice"

response = llm.chat.completions.create(
    model="gpt-4o-mini",
    messages=[{"role": "user", "content": "What's my name?"}],
)
# LLM 看到注入的记忆，回答 "Alice"
```

### 3.2 LangChain 集成

```python
from memori import MemoriMemory
from langchain_openai import ChatOpenAI
from langchain.agents import create_openai_functions_agent

llm = ChatOpenAI(model="gpt-4o-mini")

# Memori 作为 LangChain Memory
memory = MemoriMemory(
    api_key="memori_xxx",
    entity_id="user-1",
    return_messages=True,
)

agent = create_openai_functions_agent(
    llm=llm,
    tools=tools,
    prompt=prompt,
)

# Memory 自动在每次调用时加载和保存
agent_executor = AgentExecutor(
    agent=agent,
    tools=tools,
    memory=memory,  # Memori memory
)
```

### 3.3 Agent 执行轨迹捕获

```python
# Memori 自动记录 Agent 的每一步操作
result = agent_executor.invoke({
    "input": "Search for recent Go articles and summarize them."
})

# 执行轨迹自动保存：
# Step 1: search_tool("Go articles 2026") → [results]
# Step 2: LLM 分析 → summary
# 这些轨迹可用于：
#   - 审计日志
#   - 错误回溯
#   - 知识图谱构建
#   - 后续对话的上下文增强
```

---

## 4. memU 集成

### 4.1 文件系统式记忆管理

memU 使用文件系统隐喻组织记忆（Category → Item → Resource）：

```python
from memu import MemU

mu = MemU()

# 创建分类和条目
category = mu.create_category("user_preferences")
item = mu.create_item(
    category_id=category.id,
    title="Communication Style",
    content="Prefers technical details over high-level summaries. Responds well to code examples.",
    tags=["communication", "style"],
)

# 添加资源（将对话片段附加到条目）
mu.add_resource(
    item_id=item.id,
    content="User asked for the exact Redis configuration parameters...",
    source="conversation_001",
)

# 搜索
results = mu.search("How does this user like to communicate?")
```

### 4.2 MCP Server 集成

```json
{
  "mcpServers": {
    "memu": {
      "command": "memu",
      "args": ["serve", "--transport", "stdio"]
    }
  }
}
```

### 4.3 记忆衰退与强化模型

```python
# memU 的衰退 + 强化机制
mu = MemU()

# 添加记忆（自动分配初始优先级 0.5）
mu.remember("user-1", "User is learning Rust")

# 强化记忆（用户再次提到 Rust）
mu.remember("user-1", "User asked about Rust async patterns")
# 优先级升至 0.8

# 数周后未提及 → 自动衰退至 0.3

# 搜索时低优先级记忆排序靠后
results = mu.search("user-1", "programming languages")
# Rust 出现在结果中但排序靠后
```

---

## 5. 四大记忆系统选型决策树

```
你的使用场景？
│
├─ 需要零代码入侵，Agent 透明记忆
│   └─ Memori（LLM 拦截模式）
│
├─ 需要成熟的 OSS 方案，生产稳定
│   ├─ Python 为主 → Mem0（57.7k stars）
│   └─ TypeScript 为主 → SuperMemory（25.6k stars）
│
├─ 需要记忆衰退 + 意图预测
│   └─ memU（双系统架构）
│
├─ 需要多模态记忆（图片/视频/PDF）
│   ├─ 完整多模态 → SuperMemory
│   └─ 部分多模态 → Mem0（视觉）/ Memori（图片+视频+音频）
│
├─ 需要知识图谱关联
│   ├─ 关系型 → Memori（Entity/Fact/KG）
│   └─ 版本化 DAG → SuperMemory
│
└─ 需要 tRPC-Agent-Go 集成
    ├─ 通过 MCP → SuperMemory / memU
    └─ 自定义 Tool → Mem0 / Memori / memU
```

## 6. 组合使用策略

不同记忆系统可以互补使用：

```python
# 例：Mem0（智能提取）+ memU（衰退管理）+ 自定义（业务记忆）

class HybridMemory:
    def __init__(self):
        self.mem0 = Memory()          # 通用事实提取
        self.memu = MemU()            # 衰退管理
        self.business_db = {}         # 业务数据

    def add(self, user_id, content, memory_type="general"):
        if memory_type == "general":
            self.mem0.add(content, user_id=user_id)
        elif memory_type == "preference":
            self.memu.remember(user_id, content)
        elif memory_type == "business":
            self.business_db[user_id] = content

    def search(self, user_id, query):
        results = []
        # 三种记忆源并行搜索
        results += self.mem0.search(query, user_id=user_id)["results"]
        results += self.memu.search(user_id, query)
        results += self._search_business(user_id, query)
        return self._rerank(results, query)
```
