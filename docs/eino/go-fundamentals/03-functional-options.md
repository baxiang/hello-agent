# 函数选项模式（Functional Options）— Eino 配置的统一范式

## 1. 为什么需要 Functional Options

在 Go 中设计可配置的 API 时，我们常面临一个问题：如何优雅地传递可选参数？假设你要设计一个 LLM 调用接口，用户可能想设置 Temperature、TopP、MaxTokens 中的任意组合。让我们看看几种常见方案的优劣。

### Config 结构体方案

```go
// 最直观的方式：传一个配置结构体
type Config struct {
    Temperature *float32
    TopP        *float32
    MaxTokens   *int
}

func Generate(ctx context.Context, input string, cfg *Config) (string, error) { ... }

// 调用：必须构造结构体，即使只改一个字段
result, err := Generate(ctx, "hello", &Config{Temperature: ptrFloat32(0.7)})
```

**缺点**：
- 每次调用都要构造结构体，哪怕只设置一个字段
- 新增字段是破坏性变更——所有调用方都可能受影响
- 无法区分"零值"和"未设置"（需要用指针）
- 不支持运行时动态追加选项

### Builder 模式方案

```go
// 链式调用
result, err := NewGenerator().
    WithTemperature(0.7).
    WithMaxTokens(1024).
    Generate(ctx, "hello")
```

**缺点**：
- 需要一个可变的 Builder 对象，不是并发安全的
- API 膨胀：每个配置项需要一个方法，加上 Build/Generate 终结方法
- 难以在运行时组合选项——你不能把"一组选项"当作值传递

### Functional Options 的优势

Functional Options 模式将每个配置项封装为一个函数值，利用 Go 的一等公民函数特性，实现了：

- **零值可用**：不传任何选项也能正常工作
- **可组合**：选项可以自由叠加、打包、传递
- **向前兼容**：新增选项不影响已有调用
- **类型安全**：编译期检查参数类型

这正是 Eino 框架选择该模式的原因——在一个需要同时支持通用选项和实现特定选项的框架中，Functional Options 是最灵活的选择。

## 2. 模式定义

Functional Options 的核心思想很简单：**用一个函数类型表示"对配置的修改"**。

```go
// 配置结构体，所有字段都有合理的零值
type Options struct {
    Name        string
    MaxRetries  int
    Timeout     time.Duration
}

// Option 是一个函数类型，它接收 *Options 并修改它
type Option func(*Options)

// 每个 WithXxx 函数返回一个 Option
func WithName(name string) Option {
    return func(o *Options) {
        o.Name = name
    }
}

func WithMaxRetries(n int) Option {
    return func(o *Options) {
        o.MaxRetries = n
    }
}

func WithTimeout(d time.Duration) Option {
    return func(o *Options) {
        o.Timeout = d
    }
}

// 应用选项的核心函数
func applyOptions(defaults *Options, opts ...Option) *Options {
    if defaults == nil {
        defaults = &Options{}
    }
    for _, opt := range opts {
        opt(defaults)
    }
    return defaults
}
```

调用方只需：

```go
// 不传选项——使用默认值
result := applyOptions(nil)

// 只设置需要的选项
result := applyOptions(nil, WithName("my-service"), WithTimeout(5*time.Second))

// 选项可以打包复用
commonOpts := []Option{WithMaxRetries(3), WithTimeout(10 * time.Second)}
result := applyOptions(nil, append(commonOpts, WithName("special"))...)
```

关键点在于 `...Option` 可变参数——调用方可以传零个、一个或任意多个选项，完全按需组合。

## 3. Eino 中的完整实例

Eino 框架全面采用 Functional Options 模式，几乎所有组件的配置都通过该模式实现。下面我们逐一分析。

### 3.1 `model.Option` — LLM 模型的通用选项

`components/model/option.go:22-58` 定义了模型调用的通用选项结构体：

```go
// components/model/option.go:22-58
type Options struct {
    Temperature *float32   // 温度，控制随机性
    Model       *string    // 模型名称
    TopP        *float32   // TopP，控制多样性
    Tools       []*schema.ToolInfo  // 可调用的工具列表
    MaxTokens   *int       // 最大 token 数
    Stop        []string   // 停止词
    ToolChoice  *schema.ToolChoice  // 工具选择策略
}
```

注意一个细节：**所有数值字段都用指针类型**。这是因为需要区分"用户未设置"和"用户设置了零值"。例如 `Temperature` 为 `nil` 表示使用模型默认温度，而 `*Temperature == 0` 表示明确设置温度为 0（确定性输出）。

`components/model/option.go:64-68` 定义了 Option 类型：

```go
// components/model/option.go:64-68
type Option struct {
    apply func(opts *Options)            // 通用选项的修改函数
    implSpecificOptFn any                // 实现特定选项的修改函数
}
```

Eino 的 `model.Option` 不是一个简单的 `func(*Options)`，而是一个**结构体**，同时携带通用选项和实现特定选项。这允许一个 `Option` 值同时参与两套选项系统的分派。

典型的 `WithXxx` 工厂函数（`components/model/option.go:71-77`）：

```go
// components/model/option.go:71-77
func WithTemperature(temperature float32) Option {
    return Option{
        apply: func(opts *Options) {
            opts.Temperature = &temperature  // 取地址存入指针
        },
    }
}
```

`WithTools` 还展示了防御性编程（`components/model/option.go:116-125`）：

```go
// components/model/option.go:116-125
func WithTools(tools []*schema.ToolInfo) Option {
    if tools == nil {
        tools = []*schema.ToolInfo{}  // nil 安全：统一为空切片
    }
    return Option{
        apply: func(opts *Options) {
            opts.Tools = tools
        },
    }
}
```

`GetCommonOptions` 是应用选项的核心（`components/model/option.go:211-224`）：

```go
// components/model/option.go:211-224
func GetCommonOptions(base *Options, opts ...Option) *Options {
    if base == nil {
        base = &Options{}  // 零值可用：nil base 也能工作
    }
    for i := range opts {
        opt := opts[i]
        if opt.apply != nil {       // 只应用通用选项
            opt.apply(base)
        }
    }
    return base
}
```

### 3.2 实现特定选项 — `WrapImplSpecificOptFn` 与泛型分派

Eino 的精妙之处在于：同一个 `Option` 列表中可以混合通用选项和实现特定选项。

`components/model/option.go:196-200`：

```go
// components/model/option.go:196-200
func WrapImplSpecificOptFn[T any](optFn func(*T)) Option {
    return Option{
        implSpecificOptFn: optFn,   // 只设 implSpecificOptFn，apply 为 nil
    }
}
```

当实现者调用 `GetImplSpecificOptions`（`components/model/option.go:239-254`）时：

```go
// components/model/option.go:239-254
func GetImplSpecificOptions[T any](base *T, opts ...Option) *T {
    if base == nil {
        base = new(T)
    }
    for i := range opts {
        opt := opts[i]
        if opt.implSpecificOptFn != nil {
            optFn, ok := opt.implSpecificOptFn.(func(*T))  // 类型断言
            if ok {                   // 只有类型匹配才应用
                optFn(base)
            }
        }
    }
    return base
}
```

这里利用了 Go 的**类型断言**做运行时分派：不同实现传入不同泛型参数 `T`，只有类型匹配的 `implSpecificOptFn` 才会被应用。这意味着多个不同实现的选项可以安全地共存于同一列表中。

典型使用方式：

```go
// 在 OpenAI 实现包中
type openaiOptions struct {
    BaseURL    string
    APIVersion string
}

func WithBaseURL(url string) model.Option {
    return model.WrapImplSpecificOptFn(func(o *openaiOptions) {
        o.BaseURL = url
    })
}

// 调用方：混合标准选项和实现特定选项
result, err := model.Generate(ctx, msgs,
    model.WithTemperature(0.7),      // 标准选项
    openai.WithBaseURL("https://..."),  // 实现特定选项
)
```

### 3.3 `retriever.Option` — 检索器选项

`components/retriever/option.go:22-37`：

```go
// components/retriever/option.go:22-37
type Options struct {
    Index          *string          // 索引名
    SubIndex       *string          // 子索引名
    TopK           *int             // 返回文档数
    ScoreThreshold *float64         // 相似度阈值
    Embedding      embedding.Embedder  // 嵌入器（接口类型，无需指针）
    DSLInfo        map[string]any   // 后端特定查询表达式
}
```

`WithTopK` 和 `WithScoreThreshold`（`components/retriever/option.go:58-73`）是检索器最常用的选项：

```go
// components/retriever/option.go:58-73
func WithTopK(topK int) Option {
    return Option{
        apply: func(opts *Options) {
            opts.TopK = &topK
        },
    }
}

func WithScoreThreshold(threshold float64) Option {
    return Option{
        apply: func(opts *Options) {
            opts.ScoreThreshold = &threshold
        },
    }
}
```

### 3.4 `GraphCompileOption` — 图编译选项

`compose/graph_compile_options.go` 展示了**最简形式的 Functional Options**——Option 直接定义为 `func(*Options)`，没有实现特定选项的扩展：

```go
// compose/graph_compile_options.go:51
type GraphCompileOption func(*graphCompileOptions)
```

`graphCompileOptions` 结构体（`compose/graph_compile_options.go:19-36`）包含了图编译时的各种配置：

```go
// compose/graph_compile_options.go:19-36
type graphCompileOptions struct {
    maxRunSteps     int              // 最大运行步数，防无限循环
    graphName       string           // 图名称，用于调试
    nodeTriggerMode NodeTriggerMode  // 节点触发模式
    callbacks       []GraphCompileCallback
    checkPointStore CheckPointStore  // 检查点存储
    // ...
}
```

工厂函数示例（`compose/graph_compile_options.go:56-60`）：

```go
// compose/graph_compile_options.go:56-60
func WithMaxRunSteps(maxSteps int) GraphCompileOption {
    return func(o *graphCompileOptions) {
        o.maxRunSteps = maxSteps
    }
}
```

应用选项（`compose/graph_compile_options.go:38-48`）：

```go
// compose/graph_compile_options.go:38-48
func newGraphCompileOptions(opts ...GraphCompileOption) *graphCompileOptions {
    option := &graphCompileOptions{}      // 零值默认
    for _, o := range opts {
        o(option)
    }
    option.origOpts = opts                // 保留原始选项，用于子图传递
    return option
}
```

注意 `origOpts` 字段——它保留了原始选项列表，使得子图编译时可以继承父图的选项。这是 Functional Options 的一个高级用法：**选项不仅是配置，还可以被序列化和重新应用**。

### 3.5 `ToolsNodeOption` — 工具节点选项

`compose/tool_node.go:46-69` 展示了选项的嵌套组合：

```go
// compose/tool_node.go:46
type ToolsNodeOption func(o *toolsNodeOptions)

// compose/tool_node.go:38-43
type toolsNodeOptions struct {
    ToolOptions []tool.Option              // 嵌套：传递给底层工具的选项
    ToolList    []tool.BaseTool            // 动态覆盖工具列表
    ToolAliases map[string]ToolAliasConfig // 工具别名配置
}
```

`WithToolOption`（`compose/tool_node.go:49-53`）实现了**选项的嵌套传递**：

```go
// compose/tool_node.go:49-53
func WithToolOption(opts ...tool.Option) ToolsNodeOption {
    return func(o *toolsNodeOptions) {
        o.ToolOptions = append(o.ToolOptions, opts...)
    }
}
```

这是一个重要的模式：外层选项可以携带内层选项。`ToolsNodeOption` 携带了 `tool.Option`，实现了配置的分层传递。调用时：

```go
// 同时设置工具节点级别和工具级别的选项
messages, err := toolsNode.Invoke(ctx, msg,
    WithToolOption(tool.WithConf("debug")),  // 传递到工具实现
    WithToolList(customTool),                // 覆盖工具列表
)
```

`getToolsNodeOptions`（`compose/tool_node.go:1278-1286`）展示了合理默认值的设置：

```go
// compose/tool_node.go:1278-1286
func getToolsNodeOptions(opts ...ToolsNodeOption) *toolsNodeOptions {
    o := &toolsNodeOptions{
        ToolOptions: make([]tool.Option, 0),  // 空切片而非 nil
    }
    for _, opt := range opts {
        opt(o)
    }
    return o
}
```

### 3.6 `AgentRunOption` — Agent 运行选项

`adk/call_option.go:31-36` 展示了**纯实现特定选项**的设计：

```go
// adk/call_option.go:31-36
type AgentRunOption struct {
    implSpecificOptFn any
    agentNames        []string  // 选项的目标 Agent 名
}
```

Agent 选项没有通用 `apply` 字段，全部通过 `implSpecificOptFn` 实现。同时增加了 `agentNames` 字段，支持**选项路由**——只让特定 Agent 看到特定选项。

`DesignateAgent` 方法（`adk/call_option.go:38-41`）：

```go
// adk/call_option.go:38-41
func (o AgentRunOption) DesignateAgent(name ...string) AgentRunOption {
    o.agentNames = append(o.agentNames, name...)
    return o  // 值拷贝，不修改原始选项
}
```

`filterOptions`（`adk/call_option.go:192-211`）实现了选项过滤：

```go
// adk/call_option.go:192-211
func filterOptions(agentName string, opts []AgentRunOption) []AgentRunOption {
    var filteredOpts []AgentRunOption
    for i := range opts {
        opt := opts[i]
        if len(opt.agentNames) == 0 {   // 无指定 = 全局选项
            filteredOpts = append(filteredOpts, opt)
            continue
        }
        for j := range opt.agentNames {
            if opt.agentNames[j] == agentName {
                filteredOpts = append(filteredOpts, opt)
                break
            }
        }
    }
    return filteredOpts
}
```

这意味着在一个多 Agent 系统中，你可以精确控制哪些选项只对特定 Agent 生效：

```go
result, err := agent.Run(ctx, input,
    adk.WithCallbacks(handler),                              // 全局选项
    adk.WithSessionValues(vals).DesignateAgent("planner"),   // 只给 planner
)
```

## 4. 零值可用原则

Eino 中所有 Options 结构体都遵循零值可用原则：

```go
// 不传任何选项时，Options 的零值就是合理的默认值
opts := model.GetCommonOptions(nil)  // 所有字段为零值/nil
// Temperature 为 nil -> 使用模型默认温度
// TopK 为 nil -> 使用检索器默认返回数
// ToolOptions 为空切片 -> 不传额外选项
```

这得益于两个设计选择：
1. **指针字段**：`*float32`、`*int` 等指针类型区分"未设置"和"零值"
2. **初始化函数中的默认值**：如 `getToolsNodeOptions` 中 `ToolOptions: make([]tool.Option, 0)`

实现特定选项的 `GetImplSpecificOptions` 也遵循相同原则（`components/model/option.go:240-241`）：

```go
if base == nil {
    base = new(T)  // 零值可用
}
```

## 5. 选项组合

Functional Options 的一个重要特性是**可组合性**——多个选项可以自由叠加，后设置的选项覆盖先设置的：

```go
// 基础选项包
baseOpts := []model.Option{
    model.WithTemperature(0.7),
    model.WithMaxTokens(2048),
}

// 不同场景追加不同选项
creativeOpts := append(baseOpts, model.WithTopP(0.9))
preciseOpts := append(baseOpts, model.WithTemperature(0.1))  // 覆盖温度
```

在 Eino 内部，`GraphCompileOption` 的 `origOpts` 机制（`compose/graph_compile_options.go:45`）利用了这种组合性，使得子图可以继承并扩展父图的编译选项。

`WithToolChoice`（`components/model/option.go:157-164`）展示了**一个选项设置多个字段**：

```go
// components/model/option.go:157-164
func WithToolChoice(toolChoice schema.ToolChoice, allowedToolNames ...string) Option {
    return Option{
        apply: func(opts *Options) {
            opts.ToolChoice = &toolChoice
            opts.AllowedToolNames = allowedToolNames  // 同时设置两个字段
        },
    }
}
```

## 6. 高级模式

### 6.1 选项验证

`WithTools`（`components/model/option.go:116-118`）展示了在构造选项时进行参数验证：

```go
func WithTools(tools []*schema.ToolInfo) Option {
    if tools == nil {
        tools = []*schema.ToolInfo{}  // 保证非 nil
    }
    // ...
}
```

你可以扩展这种模式，在选项函数中加入更复杂的验证逻辑：

```go
func WithPort(port int) Option {
    return func(o *Options) {
        if port < 0 || port > 65535 {
            panic(fmt.Sprintf("invalid port: %d", port))  // 快速失败
        }
        o.Port = port
    }
}
```

### 6.2 必填选项

Functional Options 本身不支持编译期的必填检查，但可以通过运行时验证实现：

```go
func Build(opts ...Option) (*Service, error) {
    o := applyOptions(nil, opts...)
    if o.Name == "" {
        return nil, errors.New("name is required")
    }
    return &Service{Name: o.Name}, nil
}
```

Eino 中 `model.Option` 通过指针字段间接实现：如果调用者未设置 `Temperature`，实现代码可以判断 `opts.Temperature == nil` 来使用默认值，无需强制要求。

### 6.3 选项冲突检测

`AgentRunOption` 中的 `filterCallbackHandlersForNestedAgents`（`adk/call_option.go:130-163`）展示了运行时选项冲突检测——避免回调处理器在嵌套 Agent 中被重复应用。它通过类型断言识别特定类型的选项，并基于 `agentNames` 做过滤。

## 7. 与其他模式对比

| 特性 | Config Struct | Builder | Functional Options |
|------|--------------|---------|-------------------|
| 零值可用 | 需要判空 | 需要 New() | 天然支持 |
| 可组合性 | 差 | 差 | 优秀 |
| 向前兼容 | 差 | 中等 | 优秀 |
| 实现特定扩展 | 难 | 中等 | 优秀（泛型分派） |
| 并发安全 | 结构体只读即安全 | Builder 可变，不安全 | 选项函数不可变，安全 |
| 代码量 | 少 | 多 | 中等 |

Eino 选择 Functional Options 的核心理由是**实现特定选项的扩展能力**——通过 `implSpecificOptFn + 类型断言`，同一个选项列表可以同时服务框架层和实现层，这是 Config Struct 和 Builder 都难以优雅实现的。

## 8. 常见陷阱

### 8.1 闭包捕获变量

```go
// 错误：所有选项修改同一个变量
temps := []float32{0.1, 0.5, 0.9}
var opts []Option
for _, t := range temps {
    // t 是循环变量，Go 1.22 前会被覆盖
    opts = append(opts, model.WithTemperature(t))
}

// Go 1.22+ 循环变量每次迭代创建新副本，无此问题
// Go 1.21 及更早版本需要显式拷贝
```

### 8.2 指针逃逸

`WithTemperature` 中 `&temperature` 导致变量逃逸到堆上——这是故意的，确保指针在函数返回后仍然有效。但要注意，**每个 WithXxx 调用都会产生一次堆分配**。

### 8.3 implSpecificOptFn 类型不匹配被静默忽略

`GetImplSpecificOptions` 中的类型断言失败时不会报错，只是静默跳过。如果实现者传错了泛型参数 `T`，选项会被无声丢弃，难以调试。

## 9. 练习

1. **基础**：为 `retriever.Option` 添加一个 `WithEmbeddingModel` 选项，支持在调用时动态指定嵌入模型。

2. **进阶**：实现一个 `WithValidate` 高阶选项函数，它接收一个验证函数，在选项应用时执行验证：

```go
func WithValidate(v func(*Options) error) Option {
    return func(o *Options) {
        if err := v(o); err != nil {
            panic(err)  // 或使用 error 返回
        }
    }
}
```

3. **挑战**：参考 Eino 的 `WrapImplSpecificOptFn` 模式，设计一个支持多种实现特定选项的 `Cache Option` 系统，要求同一个 `Option` 列表能同时配置 Redis 缓存和本地内存缓存的特有参数。
