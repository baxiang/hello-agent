# Memory 自动模式（Auto）- 后台透明提取的长期记忆

> **源码路径**：[`trpc-agent-go/examples/memory/auto/`](../../../../trpc-agent-go/examples/memory/auto)
> **示例类型**：Auto 模式（LLM Extractor 后台提取） · **难度**：进阶

## 概述

`auto/` 演示 **Auto 模式**：用一个独立的 LLM Extractor 在后台分析对话，自动提取值得长期记住的信息，**用户完全感知不到工具调用**。与 [`simple/`](./memory-simple.md) 的"Agent 主动调工具"相反，auto 模式让对话保持自然流畅，记忆管理由框架透明完成。

典型对比：

```
# simple（Agentic）：用户能看到工具调用
👤 You: My name is John.
🤖 🔧 Tool call: memory_add {"memory": "User's name is John"}
🤖 I've saved your name.

# auto：完全自然对话，后台静默提取
👤 You: My name is John.
🤖 Nice to meet you, John! How can I help you today?
（后台：Extractor 自动分析并存储记忆）
```

## 核心概念

### Extractor —— Auto 模式的心脏

Extractor 是一个用 LLM 做记忆分析的组件，通过 `memoryinmemory.WithExtractor(...)` 注入 Memory Service。一旦设置了 Extractor，Service 就进入 Auto 模式：

```go
// 用独立模型创建 Extractor（可与对话模型不同）
extractorModel := openai.New("deepseek-v4-flash")
memExtractor := extractor.NewExtractor(extractorModel)

memoryService := memoryinmemory.NewMemoryService(
    memoryinmemory.WithExtractor(memExtractor),
    memoryinmemory.WithAsyncMemoryNum(3),         // 后台 worker 数
    memoryinmemory.WithMemoryQueueSize(100),      // 任务队列容量
    memoryinmemory.WithMemoryJobTimeout(30*time.Second), // 单任务超时
)
```

### 异步提取流程

```
User Input → Agent Response → Runner → Async Worker → Extractor → Memory Service
                                                       ↓
                                            LLM 分析对话，识别值得记住的信息
                                                       ↓
                                            自动 add/update 记忆
```

关键点：**提取发生在 Agent 响应完成之后**，由后台 worker 池异步执行，不阻塞对话。

### 提取检查器（Checkers，>= 1.3.0）

默认每轮对话都会触发提取。用 Checker 可控制频率、降低 LLM 成本：

| Checker | 作用 | 示例 |
|---------|------|------|
| `CheckMessageThreshold(n)` | 累计消息数 > n 时触发 | `CheckMessageThreshold(5)` |
| `CheckTimeInterval(d)` | 距上次提取超过 d 时触发 | `CheckTimeInterval(3*time.Minute)` |
| `ChecksAll` | AND 组合（全部满足才触发） | — |
| `ChecksAny` | OR 组合（任一满足即触发） | — |

```go
// 消息数 > 5 或 每 3 分钟触发一次（OR 逻辑）
memExtractor := extractor.NewExtractor(
    extractorModel,
    extractor.WithCheckersAny(
        extractor.CheckMessageThreshold(5),
        extractor.CheckTimeInterval(3*time.Minute),
    ),
)
```

> **重要**：Checker 返回 `false` 时，当前消息会**累积**到下次提取，不会丢失上下文。

### 工具可见性：前端 vs 后端

Auto 模式把工具分成两类，这是与 simple 最大的设计差异：

**前端工具**（通过 `Tools()` 暴露给 Agent 调用）：

| 工具 | 默认 | 说明 |
|------|------|------|
| `memory_search` | ✅ On | 按查询检索记忆 |
| `memory_load` | ❌ Off | 加载近期记忆（可启用） |

**后端工具**（Extractor 在后台使用）：

| 工具 | 默认 | 说明 |
|------|------|------|
| `memory_add` | ✅ On | Extractor 用它写入 |
| `memory_update` | ✅ On | Extractor 用它更新 |
| `memory_delete` | ✅ On | Extractor 用它删除 |
| `memory_clear` | ❌ Off | 危险操作，默认禁用 |

**混合模式**：用 `WithAutoMemoryExposedTools` 把部分写工具也暴露给前端 Agent，让用户既能显式保存重要提示，又能享受后台自动提取：

```go
memoryService := memoryinmemory.NewMemoryService(
    memoryinmemory.WithExtractor(memExtractor),
    memoryinmemory.WithToolEnabled(memory.LoadToolName, true),       // 前端启用 load
    memoryinmemory.WithAutoMemoryExposedTools(memory.AddToolName),   // 暴露 add 给前端
    memoryinmemory.WithToolEnabled(memory.DeleteToolName, false),    // 后端禁用 delete
)
```

## 代码解析

### 双模型配置

auto 示例支持对话模型和提取模型分离（`-model` vs `-ext-model`），让你用便宜模型做提取、强模型做对话：

```go
chatModel := openai.New(*modelName)
extractorModel := openai.New(*extModel)  // 默认与 chatModel 相同
memExtractor := extractor.NewExtractor(extractorModel)
```

### Memory 预加载（Preload）

通过 `WithPreloadMemory(N)` 把记忆预先注入系统提示词，让 Agent 不用调工具就能"想起"用户：

```go
llmAgent := llmagent.New(
    agentName,
    llmagent.WithModel(chatModel),
    llmagent.WithTools(memoryService.Tools()),
    llmagent.WithPreloadMemory(10),  // 自适应预加载
)
```

预加载策略（N 的语义）：
- `0`：禁用预加载（默认）
- `N > 0`：**自适应**——记忆数 ≤ N 时全量注入；否则注入与当前用户消息最相关的前 N 条搜索结果
- `-1`：强制全量加载

> 用 `-debug` flag 可以看到预加载到系统提示词里的实际内容，便于调试。

### Preload vs `memory_load` 工具

| 维度 | `WithPreloadMemory` | `memory_load` 工具 |
|------|---------------------|-------------------|
| 时机 | 每次请求前自动注入 | Agent 自主决定调用 |
| 控制 | 创建 Agent 时配置 | Agent 驱动、按需 |
| Token 占用 | 始终占用上下文 | 仅调用时占用 |
| Auto 模式 | 兼容（自适应） | 默认禁用，可启用 |

## 运行方式

### 命令行参数

| 参数 | 说明 | 默认值 |
|------|------|--------|
| `-model` | 对话模型 | `deepseek-v4-flash` |
| `-ext-model` | 提取模型（默认同 `-model`） | 同 `-model` |
| `-memory` | 后端类型 | `inmemory` |
| `-streaming` | 流式输出 | `true` |
| `-debug` | 打印发送给模型的消息（含预加载内容） | `false` |

### 运行命令

```bash
cd examples/memory/auto
export OPENAI_API_KEY="your-api-key"

go run .                                          # 默认配置
go run . -model gpt-4o -ext-model gpt-4o-mini     # 对话/提取用不同模型
go run . -memory postgres -debug                  # PG 后端 + 调试模式
go run . -streaming=false                         # 非流式
```

### 交互流程

```
🧠 Auto Memory Demo
Chat Model: deepseek-v4-flash
Extractor Model: deepseek-v4-flash

👤 You: Hi! My name is Alice and I work at TechCorp as a backend engineer.
🤖 Assistant: Hello Alice! Nice to meet you...
（后台：Extractor 自动分析对话并存储记忆）

👤 You: /memory
📚 Stored memories (1):
   1. [abc123] User's name is Alice, works at TechCorp as a backend engineer

👤 You: /new                    # 记忆跨会话保留
👤 You: What do you know about me?
🔧 memory_search (ID: call_xyz789)
🤖 Based on my memory: your name is Alice, backend engineer at TechCorp.
```

> **注意**：提取是异步的，如果 `/memory` 立即查看没有结果，等几秒再试。

## 适用场景

**选 auto 当：**
- 自然对话流很重要，不希望用户看到工具调用
- 用户不需要操心"记不记"
- 想被动地从对话中学习用户画像
- 可接受后台异步处理

**选 [`simple`](./memory-simple.md) 当：**
- 用户需要显式控制（"记住我喜欢..."）
- 需要对存储内容做精确决策
- 需要即时记忆操作

## 关键要点

1. **Extractor 是开关**：`WithExtractor(nil)` 即 Agentic 模式，非 nil 即 Auto 模式，同一套 Service 接口两种行为
2. **异步 worker 池**：通过 `WithAsyncMemoryNum` / `WithMemoryQueueSize` / `WithMemoryJobTimeout` 调优吞吐与延迟
3. **Checker 控成本**：生产环境务必配置 `CheckMessageThreshold` 或 `CheckTimeInterval`，避免每轮都调用提取模型
4. **优雅关闭**：`defer memoryService.Close()` 会等待队列里的提取任务完成，否则可能丢记忆
5. **混合模式**：`WithAutoMemoryExposedTools` 让 auto + agentic 共存，鱼和熊掌兼得

## 总结

auto 模式把"记住用户"这件事从 Agent 的显式职责中解放出来，让对话回归自然。代价是多了一个提取模型的开销和异步处理的复杂度。当你希望用户感觉"这个 Agent 真懂我"，又不想用工具调用打断对话节奏时，auto 是首选。下一步可以对比 [`mem0`](./memory-mem0.md)（把提取完全交给外部平台）和 [`tencentdb`](./memory-tencentdb.md)（sidecar 记忆引擎）这两种"更外包"的方案。
