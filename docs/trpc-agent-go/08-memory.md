# Memory 长期记忆 — 源码·实战·原理

Memory 管理跨对话的用户信息。本文深入 Extractor 内部实现、Agentic vs Auto 两种模式的选择逻辑、以及向量存储集成的原理。

## 1. 概念概述

### 1.1 Memory vs Session

| | Memory | Session |
|----|----|----|
| **隔离维度** | `{appName, userID}` | `{appName, userID, sessionID}` |
| **生命周期** | 跨对话持久 | 单次对话 |
| **内容** | 用户画像、偏好、事实 | 消息历史、工具调用记录 |
| **典型数据** | "John 是后端工程师" | "用户问了天气" |
| **搜索能力** | 关键词 + 向量（可选） | 语义召回（PGVector） |

### 1.2 Memory 数据结构

```go
// memory/memory.go
type Memory struct {
    ID        string    // 内容 hash（同内容同 ID）
    AppName   string
    UserID    string
    Memory    string    // 记忆内容
    Topics    []string  // 话题标签
    CreatedAt time.Time
    UpdatedAt time.Time
}
```

### 1.3 Service 接口

```go
type Service interface {
    AddMemory(ctx, userKey, memory, topics) error
    UpdateMemory(ctx, memoryKey, memory, topics) error
    DeleteMemory(ctx, memoryKey) error
    ClearMemories(ctx, userKey) error
    SearchMemories(ctx, userKey, query) ([]*Memory, error)
    ReadMemories(ctx, userKey, limit) ([]*Memory, error)
    Tools() []tool.Tool       // 返回 Agent 可见的工具
    Close() error
}
```

---

## 2. 两种模式深度对比

### 2.1 Agentic 模式（Agent 主动管理）

```
用户: "My name is John and I like coffee"
  │
  ▼
LLM 分析：这是个人信息，应该记住
  │
  ▼
LLM 调用 tool: memory_add("John likes coffee", ["preferences"])
  │
  ▼
框架执行 memory_add → 存储到后端
```

**Agentic 模式下的工具默认状态**：

| 工具 | 默认 | 说明 |
|------|:---:|------|
| `memory_add` | ✅ 暴露 | Agent 主动添加 |
| `memory_update` | ✅ 暴露 | Agent 主动更新 |
| `memory_search` | ✅ 暴露 | Agent 主动查询 |
| `memory_load` | ✅ 暴露 | Agent 主动加载最近 |
| `memory_delete` | ❌ 可启用 | 危险操作，需显示开启 |
| `memory_clear` | ❌ 可启用 | 更危险，需显示开启 |

### 2.2 Auto 模式（Extractor 后台提取）

```
用户: "My name is John and I like coffee, I work at TechCorp"
  │
  ▼
LLM 回复: "Nice to meet you, John! ..."
  │
  ▼ (异步, 不阻塞用户)
Extractor LLM 分析对话:
  ├─ 新事实: "User name is John" → memory_add
  ├─ 新偏好: "User likes coffee" → memory_add
  └─ 新信息: "User works at TechCorp" → memory_add
```

**Auto 模式下的工具默认状态**：

| 工具 | Extractor 可用 | Agent 可见 | 说明 |
|------|:---:|:---:|------|
| `memory_add` | ✅ | ❌ | Extractor 写入，Agent 不可调用 |
| `memory_update` | ✅ | ❌ | 同上 |
| `memory_delete` | ✅ | ❌ | Extractor 可以删除过时记忆 |
| `memory_search` | ✅ | ✅ | Agent 可以搜索 |
| `memory_load` | ❌ | ❌ 可启用 | 需要时显式开启 |
| `memory_clear` | ❌ | ❌ | 极度危险 |

**暴露写工具的混合模式**：
```go
memoryService := memoryinmemory.NewMemoryService(
    memoryinmemory.WithExtractor(memExtractor),
    // 让 Agent 也能调用 memory_add（Extractor + Agent 双写）
    memoryinmemory.WithAutoMemoryExposedTools(memory.AddToolName),
)
```

---

## 3. 源码走读：Extractor

### 3.1 Extractor 结构

```go
// memory/extractor/extractor.go
type Extractor struct {
    model    model.Model           // 用于分析的 LLM（可独立于 Agent 的模型）
    checks   []ExtractCheck        // 提取检查器链
    prompt   string                // 提取 prompt 模板
}

// ExtractCheck：判断是否应该提取记忆
type ExtractCheck func(ctx context.Context, ec *ExtractionContext) bool

type ExtractionContext struct {
    Session  *session.Session
    Messages []model.Message       // 最近几轮对话
    Existing []*memory.Memory      // 已有记忆（避免重复）
}
```

### 3.2 提取流程

```go
func (e *Extractor) Extract(ctx context.Context, ec *ExtractionContext) ([]*MemoryOp, error) {
    // 1. 检查是否满足提取条件
    for _, check := range e.checks {
        if !check(ctx, ec) {
            return nil, nil // 跳过此次提取
        }
    }

    // 2. 构建 Prompt
    prompt := e.buildPrompt(ec.Messages, ec.Existing)

    // 3. 调用分析 LLM
    request := &model.Request{
        Messages: []model.Message{model.NewUserMessage(prompt)},
    }
    responseCh, _ := e.model.GenerateContent(ctx, request)
    // ... 收集完整响应

    // 4. 解析 LLM 输出 → MemoryOp 列表
    var ops []*MemoryOp
    json.Unmarshal([]byte(response), &ops)

    return ops, nil
}

type MemoryOp struct {
    Action string // "add" / "update" / "delete"
    Memory string
    Topics []string
    OldID  string // update/delete 时需要
}
```

### 3.3 异步 Worker 池

```go
// memory/inmemory/service.go（简化）
func (s *InMemoryService) enqueueExtraction(sess *session.Session) {
    // 提交到 channel
    select {
    case s.extractQueue <- sess:
    default:
        // 队列满 → 丢弃（非关键路径，下一轮会重试）
    }
}

func (s *InMemoryService) extractionWorker() {
    for sess := range s.extractQueue {
        ctx, cancel := context.WithTimeout(context.Background(), s.jobTimeout)
        ops, err := s.extractor.Extract(ctx, sess)
        cancel()
        if err != nil { continue }

        for _, op := range ops {
            switch op.Action {
            case "add":    s.AddMemory(...)
            case "update": s.UpdateMemory(...)
            case "delete": s.DeleteMemory(...)
            }
        }
    }
}
```

**为什么异步提取？**
- 不阻塞用户的 Agent 响应——提取 LLM 调用可能耗时 2-5s
- 提取失败不影响主流程——下次对话会重新触发
- 队列满时丢弃（非关键路径）——下一轮 Extraction 会再次评估

---

## 4. 实战

### 4.1 Auto 模式完整配置

```go
// 提取用模型（可用更便宜/更快的模型）
extractorModel := openai.New("gpt-4o-mini")
extractor := extractor.NewExtractor(extractorModel,
    extractor.WithChecks(
        extractor.CheckUserMessageOnly(),          // 仅 user 消息时提取
        extractor.CheckTurnCount(3),               // 每 3 轮提取一次
        extractor.CheckNoToolCallInProgress(),     // 工具调用中不提取
    ),
    extractor.WithPrompt("""
        Analyze the conversation and extract key facts about the user.
        For each fact, decide: ADD (new), UPDATE (changed), DELETE (outdated).
        Return JSON array of operations.
    """),
)

memoryService := memoryinmemory.NewMemoryService(
    memoryinmemory.WithExtractor(extractor),
    memoryinmemory.WithAsyncMemoryNum(3),
    memoryinmemory.WithMemoryQueueSize(100),
    memoryinmemory.WithMemoryJobTimeout(30*time.Second),
)
defer memoryService.Close()

agent := llmagent.New("assistant",
    llmagent.WithModel(model),
    llmagent.WithTools(memoryService.Tools()), // 仅 search 暴露
    // 预加载最近记忆到 system prompt
    llmagent.WithMemoryPreload(true),
    llmagent.WithMemoryPreloadLimit(5),
)

r := runner.NewRunner("app", agent,
    runner.WithSessionService(sessionService),
    runner.WithMemoryService(memoryService),
)
```

### 4.2 PGVector 记忆（向量搜索）

```go
import "trpc.group/trpc-go/trpc-agent-go/memory/pgvector"

memoryService, _ := pgvector.NewService(
    pgvector.WithPostgresClientDSN("postgres://..."),
    pgvector.WithEmbedder(openaiembedder.New()),
    pgvector.WithVectorDimensions(1536),
    pgvector.WithTopK(10),
)
```

向量搜索使 Query 不限于关键词匹配："用户喜欢什么类型的音乐？" 能找到 "喜欢古典乐和爵士" 的记忆，即使没有共同关键词。

### 4.3 记忆去重机制

```go
// Memory ID = hash(memoryContent + appName + userID + metadata)
// 相同的记忆内容 → 相同的 ID → 覆盖（UpdatedAt 刷新）
// Topics 不参与 hash —— 单独修改标签不会创建新记录
```

---

## 5. 设计原理

### 5.1 为什么有两种模式而非合成一种？

Agentic 和 Auto 解决了不同场景下的信任问题：

- **Agentic 模式**：信任 LLM 的判断——"LLM 知道什么该记住"
- **Auto 模式**：不信任 LLM 的判断——"分开一个专门的 LLM 来分析对话"

Auto 模式的 Extractor 可以用：
- 更精确的 prompt（专注记忆提取）
- 不同的模型（更便宜的 LLM）
- 更严格的验证（结构化的提取输出）

### 5.2 Memory Preload 的设计

Memory 预加载在 system message 中注入用户记忆：

```
System: You are a helpful assistant.
System: [User information]:
  - Name: John
  - Occupation: Backend engineer at TechCorp
  - Preferences: concise answers, coffee enthusiast
User: Recommend a tech conference.
```

设计考量：
- 预加载条数限制（`WithMemoryPreloadLimit`）防止 prompt 膨胀
- 按 `UpdatedAt` 排序，最新记忆优先
- 与 `memory_search` 互补——预加载是被动注入，`memory_search` 是 Agent 主动查询

### 5.3 记忆的覆盖语义

Memory ID 基于内容 hash（不含 topics），这意味着：
- 相同内容 + 不同 topics → 覆盖（更新标签）
- 相同内容 + 相同 topics → 幂等（刷新 UpdatedAt）
- 如需 append 语义，需要自定义策略
