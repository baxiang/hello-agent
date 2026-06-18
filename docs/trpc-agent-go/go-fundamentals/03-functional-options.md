# Functional Options — trpc-agent-go 所有构造函数的统一姿势

> trpc-agent-go 所有构造函数都用 `NewXxx(name, opts ...Option)` + `WithXxx` 模式，不懂这个模式就看不懂任何 `llmagent.New`、`runner.NewRunner`、`function.NewFunctionTool` 调用，更别提自己扩展 Agent 或 Tool 时如何对外暴露配置。

## 核心概念

Functional Options 是 Go 社区（Dave Cheney 等人）推广的一种构造对象的模式。核心三件套：

1. 一个**配置结构体**承载所有可配置字段；
2. 一个**函数类型** `type Option func(*Config)`，把"对配置的一次修改"编码成一个函数值；
3. 一个**可变参数构造函数** `New(opts ...Option)`，先填默认值，再依次应用传入的 Option。

一个最小可运行示例（纯 Go，与 trpc-agent-go 无关）：

```go
package main

import "fmt"

// 1. 配置结构体
type Server struct {
    Addr string
    Port int
    TLS  bool
}

// 2. Option 函数类型：接收 *Server，做一次修改
type Option func(*Server)

// 3. 一组 WithXxx，各自返回一个闭包
func WithPort(port int) Option {
    return func(s *Server) { s.Port = port }
}

func WithTLS() Option {
    return func(s *Server) { s.TLS = true }
}

// 4. 构造函数：先写默认值，再依次 apply
func NewServer(opts ...Option) *Server {
    s := &Server{
        Addr: "0.0.0.0",
        Port: 8080, // 默认值集中在这里
        TLS:  false,
    }
    for _, o := range opts {
        o(s)
    }
    return s
}

func main() {
    s := NewServer(WithPort(443), WithTLS())
    fmt.Printf("%+v\n", s) // &{Addr:0.0.0.0 Port:443 TLS:true}
}
```

调用点天然自文档：`NewServer(WithPort(443), WithTLS())` 一眼就能读出意图，而且新增字段只需追加 `WithXxx`，**老调用方零改动**。

### 为什么不用其他方式

| 方式 | 主要痛点 |
|------|----------|
| **Config 结构体直传** `New(Config{Port:443,TLS:false})` | 字段是否为零值是"没设"还是"显式设为 0"无法区分；新增字段后老代码语义漂移；调用点没有字段名提示 |
| **Builder 链** `NewBuilder().Port(443).TLS().Build()` | 需要额外一层 Builder 类型；忘记 `.Build()` 或链中途 panic 较常见；Go 社区不主流 |
| **一堆重载 `New`/`NewWithTLS`** | Go 不支持重载，组合爆炸 |

Functional Options 同时解决了：**默认值、可选参数、命名参数、向前兼容、可组合**。这正是 trpc-agent-go 把它作为构造 API 唯一约定样式的原因。

## 在 trpc-agent-go 里

`llmagent` 包是这个模式的教科书级实现。在 `agent/llmagent/option.go` 中：

```go
// agent/llmagent/option.go:210
type Option func(*Options)

// agent/llmagent/option.go:213
type Options struct {
    Name              string
    Model             model.Model
    Models            map[string]model.Model
    Instruction       string
    GlobalInstruction string
    Tools             []tool.Tool
    SubAgents         []agent.Agent
    // ... 约 40+ 个字段
}
```

每个可配置字段都对应一个 `WithXxx` 函数，签名高度一致——接收值，返回一个写入 `opts` 的闭包：

```go
// agent/llmagent/option.go:689
func WithModel(model model.Model) Option {
    return func(opts *Options) {
        opts.Model = model
    }
}

// agent/llmagent/option.go:727
func WithInstruction(instruction string) Option {
    return func(opts *Options) {
        opts.Instruction = instruction
    }
}
```

构造函数 `New` 在 `agent/llmagent/llm_agent.go:96`，先把一整份 `defaultOptions`（`option.go:162-206`，含 `ChannelBufferSize`、`EnableContextCompaction`、`skillRunRequireSkillLoaded` 等关键默认）拷贝进 Options，再 apply 用户传入的 Option：

```go
// agent/llmagent/llm_agent.go:96
func New(name string, opts ...Option) *LLMAgent
```

注意第一个参数 `name` 是**强制的位置参数**（agent 名字是运行时必需的），其余全部走 Option。这是整个框架的统一约定：必填项用位置参数，可选项用 `WithXxx`。

真实调用示例，来自 `examples/runner/main.go:114-122`：

```go
llmAgent := llmagent.New(
    agentName,                                                   // 必填：位置参数
    llmagent.WithModel(modelInstance),                           // 选哪个模型
    llmagent.WithDescription("A helpful AI assistant ..."),      // agent 描述
    llmagent.WithInstruction("Use tools when helpful ..."),      // 系统指令模板
    llmagent.WithGenerationConfig(genConfig),                    // 生成参数
    llmagent.WithTools([]tool.Tool{calculatorTool, timeTool}),   // 注册工具
    llmagent.WithEnableParallelTools(*enableParallel),           // 并行工具开关
)
```

同样的写法在 `runner.NewRunner`、`function.NewFunctionTool`、`openai.New` 中重复出现——一旦掌握，整个框架的构造 API 都能"按图索骥"。

## 常见陷阱

### 4.1 手动 new Options 丢失默认值

`defaultOptions` 里藏着不少关键默认（`ChannelBufferSize: 256`、`skillRunRequireSkillLoaded: true`、`EndInvocationAfterTransfer: true` 等）。绕过 `New` 直接构造 Options，等于丢掉这些默认。

```go
// ❌ 绕过 New，所有默认值丢失，agent 行为不可预期
opts := &llmagent.Options{Name: "assistant"}
agent := llmagent.NewFromOptions(opts) // 框架并不提供这种 API

// ✅ 永远走 New，默认值由框架注入
agent := llmagent.New("assistant", llmagent.WithModel(m))
```

记住：`Options` 结构体对你可见是为了**读懂字段**，不是为了**直接 new**。

### 4.2 WithModel 与 WithModels 混用，误以为"顺序决定谁生效"

`option.go:697-699` 的注释明确写了：两者同时存在时，`WithModel` 指定**初始模型**，`WithModels` 注册可运行时切换的**模型池**。这不是"后写的覆盖前写的"。

```go
// ❌ 误以为把 WithModel 放在 WithModels 之后就能"覆盖"模型池
agent := llmagent.New("a",
    llmagent.WithModels(map[string]model.Model{"gpt": gpt, "claude": claude}),
    llmagent.WithModel(gpt), // 想覆盖？并不会清掉上面的 map
)

// ✅ 理解语义：WithModel=初始，WithModels=可切换池
agent := llmagent.New("a",
    llmagent.WithModel(gpt),                 // 启动用 gpt
    llmagent.WithModels(map[string]model.Model{ // 运行时可按名切到 claude
        "gpt":    gpt,
        "claude": claude,
    }),
)
```

Functional Options 的 apply 顺序就是调用顺序，但"顺序"不等于"覆盖语义"——具体行为要看每个 `WithXxx` 的文档。

### 4.3 自己写 Agent/Tool 时暴露 struct 字段，而非提供 With 函数

扩展框架时（自定义 Agent、Tool、Memory 等），如果你对外暴露一个 `Config` 结构体让用户填，就破坏了整个框架的调用一致性。

```go
// ❌ 让调用方填结构体，与框架风格割裂
type MyAgentConfig struct{ Repo string; Limit int }
func NewMyAgent(c MyAgentConfig) *MyAgent

// ✅ 提供函数式的 WithXxx，融入框架
type Option func(*myAgentOptions)
func WithRepo(r string) Option { return func(o *myAgentOptions) { o.Repo = r } }
func WithLimit(n int) Option   { return func(o *myAgentOptions) { o.Limit = n } }
func NewMyAgent(name string, opts ...Option) *MyAgent
```

这样你的组件就能和 `llmagent.New(...)` 一样被用户自然使用。

### 4.4 重复同名 Option 静默覆盖，难排查

Functional Options 没有"幂等"或"唯一性"保证——同一个 `WithModel` 调两次，后者静默覆盖前者，没有任何报错。

```go
// ❌ 两次 WithModel，只有 deepseek 生效；gpt 被无声丢弃，排查困难
agent := llmagent.New("a",
    llmagent.WithModel(gpt),
    someWrapperThatAlsoCallsWithModel(deepseek), // 隐式追加了一次 WithModel
)

// ✅ 对"覆盖型"配置保持单一来源；封装 helper 时避免替用户做主
agent := llmagent.New("a",
    llmagent.WithModel(resolveModel(cfg)), // 只在一处决定
)
```

把 Option 调用集中在**一个构造点**，别让多层封装各自偷偷 `WithXxx`。

## 小结

- **三件套**：`type Option func(*Options)` + 一组 `WithXxx` 闭包 + `New(name, opts ...Option)` 先填默认再 apply。
- **默认值集中在 `defaultOptions`**，永远走 `New`，别手动 new Options。
- **必填项是位置参数，可选项是 `WithXxx`**——这是 trpc-agent-go 全框架的统一约定。
- **Option 的 apply 顺序即调用顺序**，但"覆盖语义"由每个 `WithXxx` 自己定义，看文档而非靠猜。

### 延伸阅读

- [trpc-agent-go LLM Agent 入门](../examples/01-agent-basics/llmagent.md) — 在真实 Agent 构造里看 Options 的实战用法
- [并发模型与 Channel 事件流](./01-concurrency-channel) — Options 中的 `ChannelBufferSize` 如何影响事件流
- [Context 生命周期与取消](./04-context-lifecycle) — 构造时配置的 Agent 如何与运行时 Context 协作
