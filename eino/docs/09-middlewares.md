# ADK Middlewares

ADK Middlewares 是可插拔的中间件系统，用于扩展 Agent 的行为。所有中间件都通过 `ChatModelAgentMiddleware` 接口集成到 `ChatModelAgent` 中。

## 1. AgentsMD（adk/middlewares/agentsmd/）

将 `.md` 文件内容注入 Agent 的指令中，用于加载 AGENTS.md 等规范文件。

### 配置（adk/middlewares/agentsmd/agentsmd.go）

```go
type Config struct {
    Backend Backend     // 后端类型
    BaseDir string      // 基础目录
}

type Backend string

const (
    AgentsMDFiles Backend = "files"  // 从文件系统读取
)
```

### 使用方式

```go
middleware, err := agentsmd.NewTyped[*schema.Message](ctx, &agentsmd.Config{
    Backend: agentsmd.AgentsMDFiles,
    BaseDir: "/path/to/project",
})
```

### 工作原理

1. 在 `BeforeAgent` 阶段，读取指定目录下的 `.md` 文件
2. 将文件内容追加到 Agent 的 `Instruction` 中
3. Agent 执行时可参考这些规范文档

## 2. DynamicTool / ToolSearch（adk/middlewares/dynamictool/toolsearch/）

动态工具发现与注册中间件，允许 Agent 在运行时搜索和加载新工具。

### 配置（adk/middlewares/dynamictool/toolsearch/toolsearch.go）

```go
type Config struct {
    Tools []tool.BaseTool   // 可供搜索的工具池
}

func UseModelToolSearch(ctx context.Context, conf *Config) (adk.ChatModelAgentMiddleware, error)
func DynamicTools(tools ...tool.BaseTool) adk.ChatModelAgentMiddleware
```

### 工作原理

- `DynamicTools`：将工具池注册到 Agent，但不在初始工具列表中暴露
- `UseModelToolSearch`：为 Agent 添加一个"搜索工具"的能力，模型可按需发现和加载工具
- Agent 仅在需要时才加载特定工具，减少提示词噪音

## 3. FileSystem（adk/middlewares/filesystem/）

为 Agent 提供文件系统操作能力。

### 工具列表（adk/middlewares/filesystem/filesystem.go）

| 工具名 | 功能 |
|--------|------|
| `ls` | 列出目录内容 |
| `read_file` | 读取文件内容 |
| `write_file` | 写入文件 |
| `edit_file` | 编辑文件（搜索替换） |
| `glob` | 按模式匹配文件 |
| `grep` | 搜索文件内容 |
| `execute` | 执行命令 |

### 配置

```go
type ToolConfig struct {
    RootDir string   // 根目录，限制文件操作范围
}
```

### 使用方式

```go
middleware, err := filesystem.NewTyped[*schema.Message](ctx, &filesystem.ToolConfig{
    RootDir: "/path/to/workspace",
})
```

> **安全提示**：务必设置 `RootDir` 限制 Agent 的文件操作范围，避免越权访问。

## 4. PatchToolCalls（adk/middlewares/patchtoolcalls/）

修补模型生成的工具调用参数，处理模型输出不符合工具 Schema 的情况。

### 配置（adk/middlewares/patchtoolcalls/patchtoolcalls.go）

```go
type Config struct {
    // 配置项
}

func NewTyped[M adk.MessageType](ctx context.Context, conf *Config) (adk.ChatModelAgentMiddleware, error)
```

### 工作原理

1. 在 `WrapModel` 阶段拦截模型输出
2. 检测工具调用参数是否匹配工具 Schema
3. 对不匹配的参数进行修补（如类型转换、缺失字段填充）
4. 通过 `PatchedContentGenerator` 包装模型，确保输出合规

## 5. PlanTask（adk/middlewares/plantask/）

为 Agent 添加任务规划能力，在执行前先生成计划。

### 配置（adk/middlewares/plantask/plantask.go）

```go
type Config struct {
    Backend Backend     // 后端类型
    BaseDir string      // 基础目录
}

type Backend string
```

### 使用方式

```go
middleware, err := plantask.NewTyped[*schema.Message](ctx, &plantask.Config{
    Backend: plantask.Backend("default"),
    BaseDir: "/path/to/plans",
})
```

## 6. Reduction（adk/middlewares/reduction/）

上下文缩减中间件，当对话历史过长时自动压缩，避免超出模型上下文窗口。

### 配置（adk/middlewares/reduction/reduction.go）

```go
type TypedConfig[M MessageType] struct {
    // 截断阶段配置
    // 清除阶段配置
}
```

### 工作原理

Reduction 分两个阶段工作：

1. **截断阶段**（Truncation）：移除较早的对话轮次，保留最近的交互
2. **清除阶段**（Clear）：当截断不足以释放足够空间时，清除所有历史

通过 `BeforeModelRewriteState` 钩子在每次模型调用前检查上下文长度，必要时触发缩减。

## 7. Skill（adk/middlewares/skill/）

技能加载中间件，将外部技能定义注入 Agent。

### 配置（adk/middlewares/skill/skill.go）

```go
type Config struct {
    ContextMode ContextMode   // 上下文模式
}

type ContextMode string

type FrontMatter struct {
    // 技能元数据
}

type Skill struct {
    // 技能定义
}
```

### 工作原理

1. 加载技能定义文件
2. 解析 FrontMatter 获取元数据
3. 在 `BeforeAgent` 阶段将技能内容注入 Agent 上下文

## 8. Summarization（adk/middlewares/summarization/）

对话摘要中间件，通过生成摘要来压缩长对话历史。

### 配置（adk/middlewares/summarization/summarization.go）

```go
type TypedTokenCounterFunc[M MessageType] func(messages []M) (int, error)

type TypedGenModelInputFunc[M MessageType] func(ctx context.Context, messages []M) ([]M, error)
```

### 工作原理

1. `TypedTokenCounterFunc`：计算当前对话的 Token 数量
2. 当 Token 数超过阈值时，使用 `TypedGenModelInputFunc` 生成摘要
3. 摘要替换旧的对话历史，保留最近的重要上下文

与 `Reduction` 的区别：Summarization 通过模型生成语义摘要，保留关键信息；Reduction 则是简单截断或清除。

## 9. 中间件选择指南

| 场景 | 推荐中间件 |
|------|-----------|
| 加载项目规范 | AgentsMD |
| 按需加载工具 | DynamicTool / ToolSearch |
| 文件操作 | FileSystem |
| 修补工具调用 | PatchToolCalls |
| 任务规划 | PlanTask |
| 控制上下文长度 | Reduction（截断） / Summarization（摘要） |
| 加载外部技能 | Skill |
