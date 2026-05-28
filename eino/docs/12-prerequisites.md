# Eino 前置知识：Go 语言技术能力清单

阅读 Eino 源码和使用框架需要掌握以下 Go 语言技术知识。本文按**必要程度**分级，帮助开发者快速评估知识储备缺口。

---

## 1. 必须掌握（Eino 的基础设施）

### 1.1 泛型（Generics）

Eino 大量使用 Go 1.18+ 泛型，是其类型安全的根基。几乎每个核心类型都带类型参数。

**源码中的体现：**

```go
// StreamReader[T] - 流式读取器，T 是每个 chunk 的类型
// schema/stream.go:168
type StreamReader[T any] struct { ... }

// BaseModel[M] - 模型接口，M 是消息类型
// components/model/interface.go:36
type BaseModel[M messageType] interface {
    Generate(ctx context.Context, input []M, opts ...Option) (M, error)
    Stream(ctx context.Context, input []M, opts ...Option) (*schema.StreamReader[M], error)
}

// NewChain[I, O] - 链编排，I 是输入类型，O 是输出类型
// compose/chain.go:37
func NewChain[I, O any](opts ...NewGraphOption) *Chain[I, O]

// Pipe[T] - 创建流式管道
// schema/stream.go:99
func Pipe[T any](cap int) (*StreamReader[T], *StreamWriter[T])
```

**需要理解的知识点：**

| 知识点 | 说明 | Eino 示例 |
|--------|------|-----------|
| 类型参数 `[T any]` | 泛型类型定义 | `StreamReader[T]` |
| 类型约束 `interface` | 限制类型参数的范围 | `messageType` 约束（`*schema.Message \| *schema.AgenticMessage`） |
| 泛型函数 | 函数级别泛型 | `Pipe[T](cap)` |
| 泛型方法 | 方法级别泛型（Go 不支持，Eino 用包级函数绕过） | `StreamReaderWithConvert[T, D]()` |
| 类型推断 | 编译器自动推导类型参数 | `compose.NewChain[map[string]any, *schema.Message]()` |

### 1.2 接口与类型系统

Eino 的组件抽象完全基于接口，理解接口组合、类型别名、空接口是必要前提。

**源码中的体现：**

```go
// 接口组合：InvokableTool = BaseTool + InvokableRun
// components/tool/interface.go:42
type InvokableTool interface {
    BaseTool
    InvokableRun(ctx context.Context, argumentsInJSON string, opts ...Option) (string, error)
}

// 类型别名：BaseChatModel 是 BaseModel 的特化
// components/model/interface.go:71
type BaseChatModel = BaseModel[*schema.Message]

// Agent 也是 TypedAgent 的特化
// adk/interface.go:467
type Agent = TypedAgent[*schema.Message]

// 密封类型约束（Sealed Interface）：限制实现者
// components/model/interface.go:27
type messageType interface {
    *schema.Message | *schema.AgenticMessage
}
```

**需要理解的知识点：**

| 知识点 | 说明 | Eino 示例 |
|--------|------|-----------|
| 接口嵌入 | 接口组合 | `InvokableTool` 嵌入 `BaseTool` |
| 类型别名 `=` vs 类型定义 | 别名可互换，定义不可 | `BaseChatModel = BaseModel[*Message]`（别名） |
| 空接口 `any` | 动态类型容器 | `map[string]any`（MetaData、Extra） |
| 接口断言 `.(Type)` | 运行时类型检查 | `ConvCallbackInput(in)` 模式 |
| 联合类型约束 | Go 1.18+ 限制类型参数 | `*schema.Message \| *schema.AgenticMessage` |

### 1.3 函数选项模式（Functional Options）

Eino 中每个组件的配置都采用 Functional Options 模式，这是 Go 生态中最常用的 API 设计模式。

**源码中的体现：**

```go
// Option 定义（每个组件包都有）
// components/model/option.go
type Option func(*Options)

// WithTools 返回一个 Option
// components/model/option.go
func WithTools(tools []*schema.ToolInfo) Option {
    return func(o *Options) {
        o.Tools = tools
    }
}

// 使用
result, err := model.Generate(ctx, messages,
    model.WithTools(tools),
    model.WithTemperature(0.7),
)
```

**需要理解的知识点：**

| 知识点 | 说明 |
|--------|------|
| `func(*Options)` 模式 | 闭包修改配置结构体 |
| 可变参数 `opts ...Option` | 灵活传参 |
| 零值可用 | Options 结构体有合理默认值 |

### 1.4 Channel 与并发原语

Eino 的 `StreamReader/StreamWriter` 底层基于 channel 实现，理解 channel 是理解流式处理的前提。

**源码中的体现：**

```go
// stream 底层结构
// schema/stream.go:375
type stream[T any] struct {
    items chan streamItem[T]   // 带 buffer 的 channel
    closed chan struct{}        // 关闭信号
}

// Pipe 创建 reader/writer 对
// schema/stream.go:99
func Pipe[T any](cap int) (*StreamReader[T], *StreamWriter[T]) {
    stm := newStream[T](cap)  // 创建带缓冲的 channel
    return stm.asReader(), &StreamWriter[T]{stm: stm}
}

// Send 写入 channel
func (s *stream[T]) send(chunk T, err error) (closed bool) {
    select {
    case <-s.closed:          // 接收端已关闭
        return true
    case s.items <- item:     // 写入缓冲
        return false
    }
}

// Recv 读取 channel
func (s *stream[T]) recv() (chunk T, err error) {
    item, ok := <-s.items     // 阻塞等待
    if !ok {
        return item.chunk, io.EOF  // channel 关闭 = 流结束
    }
    return item.chunk, item.err
}
```

**需要理解的知识点：**

| 知识点 | 说明 | Eino 示例 |
|--------|------|-----------|
| 带缓冲 channel | `make(chan T, cap)` | `Pipe[T](3)` 创建容量为 3 的流 |
| `select` 多路复用 | 同时监听多个 channel | `MergeStreamReaders` 合并多个流 |
| channel 关闭 | `close(ch)` 触发 `io.EOF` | `StreamWriter.Close()` → `closeSend()` |
| `io.EOF` 语义 | 流正常结束信号 | `StreamReader.Recv()` 返回 `io.EOF` |
| `sync.Once` | 并发安全的一次性初始化 | `copyStreamReaders` 的惰性求值 |
| `sync.Mutex` | 互斥锁 | `ProcessState` 的并发安全状态访问 |
| `sync/atomic` | 原子操作 | `closedFlag` 的无锁关闭检测 |
| goroutine | 轻量级并发 | `toStream` 启动 goroutine 转换流 |

---

## 2. 强烈建议掌握（提升开发效率）

### 2.1 Context 传播机制

Eino 通过 `context.Context` 传播状态、回调、取消信号，不理解 context 就无法正确使用框架。

**源码中的体现：**

```go
// State 通过 context 传播
// compose/state.go:176
func getState[S any](ctx context.Context) (S, *sync.Mutex, error) {
    state := ctx.Value(stateKey{})
    ...
}

// Callback 上下文传播
// callbacks/interface.go
// Handler 的每个方法接收上一个方法返回的 ctx

// 取消信号通过 context 传播
// adk/cancel.go
// cancelContext 监听 ctx.Done()
```

**需要理解的知识点：**

| 知识点 | 说明 | Eino 示例 |
|--------|------|-----------|
| `context.WithValue` | 携带键值数据 | State、Callback、Session |
| `ctx.Value(key)` | 取出数据 | `getState[S](ctx)` |
| `context.WithCancel` | 取消传播 | Agent 执行超时 |
| `context.WithTimeout` | 超时控制 | Runner 执行限时 |
| `ctx.Err()` | 检查取消原因 | 流式处理中断检测 |

### 2.2 io.Reader / io.Writer 模式

Eino 的 `StreamReader/StreamWriter` 灵感来自标准库的 `io.Reader/io.Writer`，理解此模式有助于快速上手流式 API。

**对照关系：**

| 标准库 | Eino | 说明 |
|--------|------|------|
| `io.Reader.Read(p []byte)` | `StreamReader[T].Recv() (T, error)` | 读取下一个元素 |
| `io.Writer.Write(p []byte)` | `StreamWriter[T].Send(chunk T, err error)` | 写入一个元素 |
| `io.EOF` | `io.EOF` | 流结束信号 |
| `io.Pipe()` | `schema.Pipe[T](cap)` | 创建读写对 |
| `io.MultiReader` | `MergeStreamReaders` | 合并多个源 |
| `io.TeeReader` | `StreamReader.Copy(n)` | 扇出到多消费者 |

### 2.3 反射（reflect）

Eino 的 Graph 编译阶段大量使用反射来实现类型检查和字段映射。

**源码中的体现：**

```go
// compose/generic_graph.go - Graph 编译时类型检查
// compose/field_mapping.go - 字段映射依赖反射提取结构体字段

// internal/generic/type.go
func TypeOf[T any]() reflect.Type {
    var zero T
    return reflect.TypeOf(zero)
}
```

**需要理解的知识点：**

| 知识点 | 说明 | Eino 使用场景 |
|--------|------|---------------|
| `reflect.TypeOf` | 获取类型信息 | Graph 编译时类型检查 |
| `reflect.Value` | 运行时值操作 | 字段映射赋值 |
| `reflect.Kind` | 类型分类 | 判断 interface vs struct |
| `reflect.Select` | 动态 select | 超过 64 路流的 MergeStreamReaders |

### 2.4 错误处理与哨兵错误

Eino 定义了多个哨兵错误值，用于流式处理中的控制流。

**源码中的体现：**

```go
// schema/stream.go:47 - 跳过元素的哨兵错误
var ErrNoValue = errors.New("no value")

// schema/stream.go:51 - 流关闭后读取
var ErrRecvAfterClosed = errors.New("recv after stream closed")

// schema/stream.go:56 - 多源流中某个源结束
type SourceEOF struct { sourceName string }

// adk/react.go:33 - 超出最大迭代
var ErrExceedMaxIterations = errors.New("exceeds max iterations")

// 使用 errors.Is 而非 == 比较
if errors.Is(err, io.EOF) { break }
if errors.Is(err, schema.ErrNoValue) { continue }  // 跳过空 chunk
```

**需要理解的知识点：**

| 知识点 | 说明 |
|--------|------|
| `errors.New` | 创建哨兵错误 |
| `errors.Is` | 错误链比较（推荐，非 `==`） |
| `errors.As` | 提取包装的错误类型 |
| 自定义错误类型 | 实现 `error` 接口的 struct |

---

## 3. 建议了解（深入源码需要）

### 3.1 encoding/gob 序列化

Eino 的 Checkpoint 持久化使用 gob 编码，自定义类型需要注册。

```go
// schema/serialization.go
func RegisterName[T any](name string) { ... }

// 使用示例
schema.RegisterName[*MyState]("_my_app_state")
```

### 3.2 encoding/json + 结构体标签

Message 的序列化和工具参数推断依赖 JSON 结构体标签。

```go
type WeatherInput struct {
    City string `json:"city" jsonschema:"description=城市名称"`
}
```

Eino 使用 `github.com/eino-contrib/jsonschema` 从结构体标签推断 JSON Schema（`utils.InferTool`）。

### 3.3 模板引擎

Eino 的 `MessagesTemplate.Format` 支持三种模板语法：

| 格式 | 引擎 | 说明 |
|------|------|------|
| `FString` | `pyfmt` | Python 风格格式化：`{variable}` |
| `GoTemplate` | `text/template` | Go 标准库模板 |
| `Jinja2` | `gonja` | Jinja2 模板语法 |

### 3.4 结构体嵌入（Embedding）

Eino 使用结构体嵌入实现配置复用。

```go
// adk/chatmodel.go:136
type ToolsConfig struct {
    compose.ToolsNodeConfig  // 嵌入，继承 Tools 字段
    ReturnDirectly map[string]bool
    EmitInternalEvents bool
}
```

### 3.5 Builder 模式

回调 Handler 的构造使用 Builder 模式。

```go
// callbacks/handler_builder.go
handler := callbacks.NewHandlerBuilder().
    WithOnStart(func(ctx context.Context, info *callbacks.RunInfo, input callbacks.CallbackInput) context.Context {
        return ctx
    }).
    WithOnEnd(func(ctx context.Context, info *callbacks.RunInfo, output callbacks.CallbackOutput) context.Context {
        return ctx
    }).
    Build()
```

### 3.6 Method Chaining

Chain 编排采用方法链 API。

```go
chain := compose.NewChain[I, O]()
chain.
    AppendChatTemplate(template).
    AppendChatModel(model).
    AppendToolsNode(toolsNode)
```

---

## 4. Go 版本要求与特性对应

| Go 版本 | 特性 | Eino 使用 |
|---------|------|-----------|
| 1.18 | 泛型、类型约束 | `StreamReader[T]`、`BaseModel[M]`、联合类型 |
| 1.19 | 文档注释规范 | 源码注释风格 |
| 1.21 | `min/max` 内置函数 | 工具调用逻辑 |
| 1.22 | 增强的类型推断 | `NewChain[map[string]any, *Message]()` 无需显式类型参数 |
| 1.23 | `iter.Seq2`（ADK-Go 使用，Eino 使用 StreamReader 替代） | Eino 用 `StreamReader` 实现迭代 |

---

## 5. 能力自检清单

阅读 Eino 源码前，确认以下能力：

| # | 能力 | 自检问题 | 答案 |
|---|------|---------|------|
| 1 | 泛型 | 能否解释 `type StreamReader[T any] struct{}` 的含义？ | 定义一个参数化类型，T 是元素类型 |
| 2 | 类型约束 | `interface { *Message \| *AgenticMessage }` 限制什么？ | 类型参数只能是指针类型 |
| 3 | 接口组合 | `InvokableTool` 嵌入 `BaseTool` 意味着什么？ | 必须同时实现两个接口的方法 |
| 4 | 类型别名 | `type Agent = TypedAgent[*Message]` 与 `type Agent TypedAgent[*Message]` 区别？ | 前者可互换，后者是新类型 |
| 5 | Channel | `make(chan T, 3)` 创建的 channel 缓冲区多大？ | 3 个元素 |
| 6 | Context | `ctx.Value(key)` 如何取出值？ | 需要 key 类型匹配 |
| 7 | 错误处理 | `errors.Is(err, io.EOF)` vs `err == io.EOF`？ | 前者检查错误链，后者只检查顶层 |
| 8 | Functional Options | `func(*Options)` 模式为什么优于配置结构体？ | 零值可用、可扩展、向后兼容 |
| 9 | 反射 | `reflect.TypeOf(zero)` 在泛型函数中做什么？ | 获取类型参数的反射类型 |
| 10 | io.Reader | `StreamReader.Recv()` 与 `io.Reader.Read()` 有何相似？ | 都返回 (数据, error)，EOF 表示结束 |

---

## 6. 推荐学习资源

| 主题 | 资源 | 说明 |
|------|------|------|
| Go 泛型 | [Go Generics Tutorial](https://go.dev/doc/tutorial/generics) | 官方泛型教程 |
| Go 接口 | [Effective Go - Interfaces](https://go.dev/doc/effective_go#interfaces) | 接口设计哲学 |
| Channel | [Go Concurrency Patterns](https://go.dev/talks/2012/concurrency.slide) | Rob Pike 经典演讲 |
| Context | [Go Context Blog](https://go.dev/blog/context) | 官方 context 指南 |
| Functional Options | [Self-referential functions](https://commandcenter.blogspot.com/2014/01/self-referential-functions-and-design.html) | Rob Pike 原文 |
| io.Reader | [io.Reader pattern](https://go.dev/doc/effective_go#interfaces) | 标准库流式抽象 |
| Reflect | [Laws of Reflection](https://go.dev/blog/laws-of-reflection) | 官方反射博客 |
