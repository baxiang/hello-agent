# Memory 系统 - 为 AI Agent 赋予长期记忆能力

## 概述

Memory 系统让 AI Agent 能够跨会话记住用户信息，实现个性化和上下文感知的交互体验。trpc-agent-go 提供了两种核心记忆模式：**Agentic 模式**（手动工具调用）和 **Auto 模式**（自动后台提取），并支持从内存到 PostgreSQL 在内的 8 种存储后端，满足从开发到生产的全场景需求。

## 核心概念

### 记忆模式对比

框架提供两种截然不同的记忆管理策略：

| 特性 | Agentic 模式 (simple/) | Auto 模式 (auto/) |
|------|----------------------|------------------|
| 工具注册 | 手动 `WithTools` | 自动 `WithExtractor` |
| 记忆提取 | Agent 主动调用工具 | 后台异步提取 |
| 可用工具 | 6 个（4 个默认启用） | `memory_search` 默认暴露 |
| 控制粒度 | 高（显式控制） | 中（透明运行） |
| 适用场景 | 需要精细控制的应用 | 追求无感知记忆的应用 |

### Memory Service 架构

记忆系统遵循三层架构：

```
Memory Service（记忆服务）
    ├── Memory Tools（工具层：add/update/search/load/delete/clear）
    ├── Memory Extractor（提取层：Auto 模式专用，LLM 驱动）
    └── Storage Backend（存储层：inmemory/sqlite/redis/mysql/postgres 等）
```

### 存储后端

框架内置 8 种存储后端，通过命令行参数 `-memory` 切换：

- `inmemory` - 内存存储（默认，适合开发测试）
- `sqlite` / `sqlitevec` - 本地文件存储（sqlitevec 支持向量搜索）
- `redis` - Redis 存储（适合高并发场景）
- `mysql` / `mysqlvec` - MySQL 存储（mysqlvec 支持向量搜索）
- `postgres` / `pgvector` - PostgreSQL 存储（pgvector 支持向量搜索）

## 代码解析

### Agentic 模式（simple/main.go）

Agentic 模式的核心是将 Memory 工具显式注册到 Agent，由 LLM 自主决定何时调用记忆工具。

**第一步：创建 Memory Service**

```go
memoryService, err := util.NewMemoryServiceByType(memoryType, util.MemoryServiceConfig{
    SoftDelete: *softDelete,
})
```

`NewMemoryServiceByType` 是一个工厂函数，根据传入的类型创建对应后端的 Service 实例。`SoftDelete` 选项控制 SQL 类后端是否使用软删除。

**第二步：创建 Agent 并注册工具**

```go
llmAgent := llmagent.New(
    agentName,
    llmagent.WithModel(modelInstance),
    llmagent.WithGenerationConfig(genConfig),
    llmagent.WithTools(memoryService.Tools()),  // 关键：注册记忆工具
)
```

`memoryService.Tools()` 返回默认启用的 4 个工具：`memory_add`、`memory_update`、`memory_search`、`memory_load`。LLM 会根据对话上下文自主决定调用哪个工具。

**第三步：创建 Runner 并绑定 Memory Service**

```go
c.runner = runner.NewRunner(
    appName,
    llmAgent,
    runner.WithSessionService(sessioninmemory.NewSessionService()),
    runner.WithMemoryService(memoryService),  // 关键：绑定记忆服务
)
```

Runner 负责编排 Agent 的运行流程，`WithMemoryService` 确保记忆上下文在每次请求中正确传递。

**事件处理流程**

simple 模式通过事件通道处理响应，能够区分普通文本输出和工具调用：

```go
for event := range eventChan {
    if c.hasToolCalls(event) {     // 检测工具调用
        c.handleToolCalls(event, assistantStarted)
    } else if c.hasToolResponses(event) {  // 检测工具响应
        c.handleToolResponses(event)
    } else if content := c.extractContent(event); content != "" {
        fmt.Print(content)          // 输出文本内容
    }
}
```

### Auto 模式（auto/main.go）

Auto 模式的核心差异在于引入了 **Extractor**（提取器），由独立的 LLM 在后台分析对话并自动提取记忆。

**创建 Extractor**

```go
memExtractor := extractor.NewExtractor(
    extractModel,
    // 可选：配置提取检查器控制提取频率
    // extractor.WithCheckersAny(
    //     extractor.CheckMessageThreshold(5),    // 消息数 > 5 时触发
    //     extractor.CheckTimeInterval(3*time.Minute), // 每 3 分钟触发
    // ),
)
```

Extractor 支持两种检查器组合逻辑：`WithCheckersAny`（OR 逻辑，任一满足即触发）和链式 `WithChecker`（AND 逻辑，全部满足才触发）。

**创建带 Extractor 的 Memory Service**

```go
c.memoryService, err = util.NewMemoryServiceByType(c.memoryType, util.MemoryServiceConfig{
    Extractor:        memExtractor,     // 启用 Auto 模式
    AsyncMemoryNum:   3,                // 3 个异步 Worker
    MemoryQueueSize:  100,              // 任务队列大小
    MemoryJobTimeout: 30 * time.Second, // 单任务超时
})
```

**Memory 预加载**

Auto 模式支持将记忆预加载到系统提示词中：

```go
llmAgent := llmagent.New(
    agentName,
    llmagent.WithTools(c.memoryService.Tools()),
    llmagent.WithPreloadMemory(-1),  // -1 表示加载全部记忆
)
```

`WithPreloadMemory(N)` 支持自适应预加载：当记忆数量 <= N 时全部加载，否则使用搜索结果填充前 N 条。

### 工具启用与自定义

框架允许灵活配置工具的启用状态和自定义实现：

```go
// 启用默认禁用的 delete/clear 工具
memoryService := memoryinmemory.NewMemoryService(
    memoryinmemory.WithToolEnabled(memory.DeleteToolName, true),
    memoryinmemory.WithToolEnabled(memory.ClearToolName, true),
)

// 自定义工具实现
memoryService := memoryinmemory.NewMemoryService(
    memoryinmemory.WithCustomTool(memory.ClearToolName, customClearMemoryTool),
)
```

### 多后端统一工厂

`util.go` 中的 `NewMemoryServiceByType` 封装了所有后端的初始化逻辑，通过环境变量配置连接参数：

```go
func NewMemoryServiceByType(memoryType MemoryType, cfg MemoryServiceConfig) (memory.Service, error) {
    switch memoryType {
    case MemorySQLite:
        return newSQLiteMemoryService(cfg)
    case MemoryRedis:
        return newRedisMemoryService(cfg)
    // ... 支持 8 种后端
    default:
        return newInMemoryMemoryService(cfg), nil
    }
}
```

每种后端都统一支持 Extractor 配置，通过相同的 `WithExtractor` / `WithAsyncMemoryNum` 等选项注入。

## 运行方式

### 环境准备

```bash
export OPENAI_API_KEY="your-api-key"
# 可选：自定义模型端点
export OPENAI_BASE_URL="https://your-api-endpoint/v1"
```

### 运行 Agentic 模式

```bash
cd examples/memory/simple
go run main.go                    # 默认 inmemory 后端
go run main.go -memory=sqlite     # SQLite 后端
go run main.go -memory=redis      # Redis 后端
go run main.go -streaming=false   # 关闭流式输出
```

### 运行 Auto 模式

```bash
cd examples/memory/auto
go run main.go                       # 默认配置
go run main.go -ext-model=gpt-4o     # 指定提取模型
go run main.go -memory=postgres      # PostgreSQL 后端
go run main.go -debug                # 调试模式（显示发送给模型的消息）
```

### 交互命令

两种模式都提供统一的交互命令：

- 直接输入文本进行对话
- `/memory` - 查看存储的记忆
- `/new` - 开始新会话（记忆跨会话保留）
- `/exit` - 退出

### 预期输出示例

```
You: 我叫张三，是一名 Go 开发工程师
Assistant: 你好张三！很高兴认识你...
   [工具调用] memory_add: {"memory": "用户叫张三，是 Go 开发工程师"}

You: /new
   (会话历史已重置，记忆被保留)

You: 你还记得我是谁吗？
Assistant: 你好张三！你是一名 Go 开发工程师。
   [工具调用] memory_search: {"query": "用户身份"}
```

## 总结

Memory 系统的关键设计要点：

1. **双模式架构**：Agentic 模式提供精细控制，Auto 模式实现无感知记忆，两者可按需选择
2. **存储解耦**：统一的 `memory.Service` 接口屏蔽了后端差异，从 inmemory 到 pgvector 可无缝切换
3. **异步提取**：Auto 模式通过 Worker 池和任务队列实现高效的后台记忆提取
4. **工具可扩展**：支持启用/禁用默认工具和注入自定义工具实现

Memory 系统与 Session 管理（`session/` 示例）紧密配合：Session 负责单次会话的上下文管理，Memory 负责跨会话的长期信息存储。在生产环境中，建议将两者结合使用，并根据数据规模选择合适的存储后端。
