# Go 接口与类型系统 — Eino 组件抽象的基石

## 1. 接口基础

### 隐式实现

Go 接口是**隐式实现**的：只要一个类型拥有接口要求的所有方法，它就自动满足该接口，无需 `implements` 声明。这是 Go 与 Java/C# 的根本区别。

```go
// 定义接口
type Writer interface {
    Write(p []byte) (n int, err error)
}

// 隐式实现：只要实现了 Write 方法，就满足 Writer
type BufferedWriter struct { buf []byte }
func (b *BufferedWriter) Write(p []byte) (int, error) {
    b.buf = append(b.buf, p...)
    return len(p), nil
}

// BufferedWriter 自动满足 Writer，无需声明
var w Writer = &BufferedWriter{}
```

### 方法集与指针接收者

Go 的方法集规则：**值类型只能调用值接收者方法，指针类型可以调用值接收者和指针接收者方法**。

```go
type Foo struct{ X int }
func (f Foo) ValueMethod() int   { return f.X }
func (f *Foo) PointerMethod() int { return f.X + 1 }

var f Foo = Foo{X: 1}
f.ValueMethod()    // OK
f.PointerMethod()   // OK：编译器自动取地址

var iface interface{ ValueMethod() int } = Foo{X: 1}  // OK
// var iface2 interface{ PointerMethod() int } = Foo{X: 1}  // 编译错误！
var iface3 interface{ PointerMethod() int } = &Foo{X: 1} // OK
```

### nil 接口 vs nil 值

这是 Go 接口最易出错的点。接口值在内部由 `(type, value)` 两个部分组成，只有两者都为 nil 时，接口值才 `== nil`：

```go
var p *int = nil
var i interface{} = p
fmt.Println(i == nil)  // false！i 的 type 是 *int，value 是 nil

var j interface{} = nil
fmt.Println(j == nil)  // true：type 和 value 都是 nil
```

在 Eino 中，这个问题大量出现在泛型消息类型的 nil 判断上，详见第 4 节。

---

## 2. 接口组合（Eino 大量使用）

Go 不支持类继承，但通过**接口组合**（interface embedding）实现类似功能。Eino 几乎所有组件接口都是通过组合构建的。

### InvokableTool = BaseTool + InvokableRun

```go
// components/tool/interface.go:42-47
type InvokableTool interface {
    BaseTool
    InvokableRun(ctx context.Context, argumentsInJSON string, opts ...Option) (string, error)
}
```

`InvokableTool` 嵌入了 `BaseTool`，意味着任何实现 `InvokableTool` 的类型必须同时实现 `Info()` 方法（来自 `BaseTool`）和 `InvokableRun()` 方法。这比把 `Info` 直接写在 `InvokableTool` 里更灵活——可以独立地定义 `StreamableTool` 也嵌入 `BaseTool`。

### StreamableTool = BaseTool + StreamableRun

```go
// components/tool/interface.go:53-57
type StreamableTool interface {
    BaseTool
    StreamableRun(ctx context.Context, argumentsInJSON string, opts ...Option) (*schema.StreamReader[string], error)
}
```

`StreamableTool` 与 `InvokableTool` 共享 `BaseTool`，但各自有独立的运行方法。一个类型可以同时实现两者。

### EnhancedInvokableTool = BaseTool + InvokableRun(enhanced)

```go
// components/tool/interface.go:67-70
type EnhancedInvokableTool interface {
    BaseTool
    InvokableRun(ctx context.Context, toolArgument *schema.ToolArgument, opts ...Option) (*schema.ToolResult, error)
}
```

注意 `EnhancedInvokableTool` 的 `InvokableRun` 签名与 `InvokableTool` 不同（参数是 `*schema.ToolArgument` 而非 `string`，返回 `*schema.ToolResult` 而非 `string`），因此两个接口**不兼容**，不能互相赋值。但它们共享 `BaseTool` 的 `Info` 方法。

### ToolCallingChatModel = BaseChatModel + WithTools

```go
// components/model/interface.go:99-103
type ToolCallingChatModel interface {
    BaseChatModel
    WithTools(tools []*schema.ToolInfo) (ToolCallingChatModel, error)
}
```

这是接口组合在模型层的典型应用：`BaseChatModel` 提供 `Generate` 和 `Stream`，`ToolCallingChatModel` 额外要求 `WithTools`。注意 `WithTools` 返回新的 `ToolCallingChatModel` 实例（不可变模式），而非修改原对象。

---

## 3. 类型别名 vs 类型定义

Go 有两种类型声明方式，行为截然不同：

```go
// 类型别名（type alias）：两种类型完全可互换
type BaseChatModel = BaseModel[*schema.Message]

// 类型定义（type definition）：创建新类型，与原类型不可互换
type MyInt int  // MyInt 和 int 是不同类型
```

### Eino 中的类型别名

Eino 大量使用**类型别名**来提供向后兼容的简写：

```go
// components/model/interface.go:71
type BaseChatModel = BaseModel[*schema.Message]

// adk/interface.go:467
type Agent = TypedAgent[*schema.Message]

// adk/chatmodel.go:417
type ChatModelAgentConfig = TypedChatModelAgentConfig[*schema.Message]
```

因为用的是 `=`（类型别名），`BaseChatModel` 和 `BaseModel[*schema.Message]` 是**同一个类型**，可以互相赋值、比较，没有任何运行时开销。这不同于类型定义。

### 何时用别名，何时用定义

| 场景 | 使用 | 原因 |
|------|------|------|
| 泛型特化的简写 | 类型别名 `=` | 保持可互换性，零开销 |
| 添加新方法 | 类型定义 | Go 不允许给别名添加方法 |
| 隐藏实现细节 | 类型定义 | 不暴露底层类型 |

---

## 4. 密封类型约束（Sealed Interface）

密封类型约束是 Eino 类型系统中最重要的设计模式。它通过泛型联合约束，将允许的类型限定在一个封闭集合内。

### messageType 的定义

```go
// components/model/interface.go:27-29
type messageType interface {
    *schema.Message | *schema.AgenticMessage
}
```

这个约束的含义：只有 `*schema.Message` 和 `*schema.AgenticMessage` 两种类型可以作为 `BaseModel[M messageType]` 的类型参数。**任何第三方包都无法添加新的消息类型**——联合约束是编译期强制密封的。

### 为什么 Eino 这样设计

Eino 支持两种消息路径：

1. **标准路径**（`*schema.Message`）：传统 ChatModel，工具调用在对话消息中流转。
2. **Agentic 路径**（`*schema.AgenticMessage`）：Agentic Model，工具调用内化在消息的 ContentBlock 中。

两种路径的 API 语义不同，但共享同一套 `Generate/Stream` 接口签名。密封约束确保：

- 编译期类型安全：不会意外混用两种消息类型。
- 穷尽式处理：泛型函数可以用 type switch 穷尽所有可能，编译器保证不会有遗漏。
- 防止扩展：外部包无法添加第三种消息类型，保证框架行为的确定性。

### isNilMessage 的 `any(msg) == any(zero)` 技巧

```go
// adk/interface.go:56-59
func isNilMessage[M MessageType](msg M) bool {
    var zero M
    return any(msg) == any(zero)
}
```

在泛型代码中，`msg == nil` 无法编译（因为 `M` 不满足 `comparable`），但 `M` 是指针类型时我们确实需要判断 nil。Eino 的解法：

1. `var zero M` 声明 `M` 的零值（对于指针类型就是 `nil`）。
2. `any(msg)` 和 `any(zero)` 将泛型值转为 `any`（空接口）。
3. 在 `any` 层面用 `==` 比较——`any` 支持比较，且两个持有 nil 指针的 `any` 值相等。

这比 `reflect.ValueOf(msg).IsNil()` 更高效，也不需要引入 `reflect` 包。

---

## 5. 空接口 any 与 map[string]any

### Eino 中的 map[string]any

Eino 在需要存储异构元数据的场景中使用 `map[string]any`：

```go
// schema/message.go:530
Extra map[string]any `json:"extra,omitempty"`

// schema/document.go:46
MetaData map[string]any `json:"meta_data"`
```

`Message.Extra` 可以存放模型特定的扩展信息（如原始响应头、token 使用量等），`Document.MetaData` 可以存放分数、向量等。这些字段的值类型在编译期不确定，因此使用 `any`。

### 类型断言安全模式

从 `map[string]any` 取值时，必须使用类型断言。推荐两种安全模式：

```go
// 模式 1：comma-ok 断言
if score, ok := doc.MetaData["_score"].(float64); ok {
    fmt.Println(score)
}

// 模式 2：Eino 的封装方法（schema/document.go:99-110）
func (d *Document) Score() float64 {
    if d.MetaData == nil {
        return 0
    }
    score, ok := d.MetaData["_score"].(float64)
    if ok {
        return score
    }
    return 0
}
```

Eino 的 `Document.Score()` 等方法是类型安全封装的范例——它们隐藏了 `map[string]any` 的类型断言细节，提供零值安全的访问接口。

---

## 6. Typer 接口 — 运行时类型标识

```go
// components/types.go:29-31
type Typer interface {
    GetType() string
}
```

`Typer` 提供组件的人类可读类型名称。当组件实现了 `Typer`，DevOps 工具（可视化调试器、IDE 插件）显示的名称变为 `{GetType()}{ComponentKind}`，如 `OpenAIChatModel`。

Eino 还提供了包级辅助函数（components/types.go:34-40）：

```go
func GetType(component any) (string, bool) {
    if typer, ok := component.(Typer); ok {
        return typer.GetType(), true
    }
    return "", false
}
```

这里用到了**接口断言**：`component.(Typer)` 检查运行时 `component` 是否实现了 `Typer`，如果是则提取出来使用。这是 Go 中"可选能力"的惯用模式——不是所有组件都有 `GetType`，但框架可以安全地检查和调用。

---

## 7. Checker 接口 — 回调控制

```go
// components/types.go:50-52
type Checker interface {
    IsCallbacksEnabled() bool
}
```

`Checker` 控制框架的自动回调仪器是否激活。当 `IsCallbacksEnabled` 返回 `true` 时，框架跳过默认的 OnStart/OnEnd 包装，信任组件自己在正确时机调用回调。

这是**选择性参与**模式：组件可以选择性地实现 `Checker` 来精确控制回调行为，不实现的组件则使用框架默认行为。

包级辅助函数同样使用接口断言（components/types.go:55-61）：

```go
func IsCallbacksEnabled(i any) bool {
    if checker, ok := i.(Checker); ok {
        return checker.IsCallbacksEnabled()
    }
    return false
}
```

---

## 8. 接口断言与类型开关

### 类型断言（Type Assertion）

类型断言从接口值中提取具体类型的值：

```go
var i interface{} = "hello"
s := i.(string)     // 不安全：如果 i 不是 string，panic
s, ok := i.(string) // 安全：ok 为 false 时不会 panic
```

在 Eino 中，类型断言常用于以下场景：

1. **可选能力检查**：`component.(Typer)` 检查组件是否实现了 `Typer`。
2. **泛型 type switch**：在泛型函数中，通过 `any()` 中转后使用类型断言。

### 类型开关（Type Switch）

类型开关是处理多种可能类型的惯用方式。Eino 大量使用此模式处理密封类型约束：

```go
// adk/interface.go:489-498
func concatMessageStream[M MessageType](stream *schema.StreamReader[M]) (M, error) {
    var zero M
    switch s := any(stream).(type) {
    case *schema.StreamReader[*schema.Message]:
        result, err := schema.ConcatMessageStream(s)
        if err != nil {
            return zero, err
        }
        return any(result).(M), nil
    case *schema.StreamReader[*schema.AgenticMessage]:
        defer s.Close()
        var msgs []*schema.AgenticMessage
        for {
            frame, err := s.Recv()
            if err == io.EOF {
                break
            }
            if err != nil {
                return zero, err
            }
            msgs = append(msgs, frame)
        }
        result, err := schema.ConcatAgenticMessages(msgs)
        if err != nil {
            return zero, err
        }
        return any(result).(M), nil
    default:
        panic("unreachable: unknown MessageType")
    }
}
```

这个函数展示了 Eino 中 type switch 的完整模式：

1. `any(stream).(type)` — 将泛型值转为 `any` 后做 type switch。
2. 每个 `case` 分支处理一种密封类型，编译器保证穷尽所有可能。
3. `any(result).(M)` — 将具体类型的返回值转回泛型类型。
4. `default: panic("unreachable")` — 密封约束保证此分支不可达，但 Go 编译器要求 `default`。

### GobEncode 中的双重断言

```go
// adk/interface.go:127-134
func (mv *TypedMessageVariant[M]) GobEncode() ([]byte, error) {
    if mvMsg, ok := any(mv).(*TypedMessageVariant[*schema.Message]); ok {
        return gobEncodeMessageVariant(mvMsg)
    }
    if mvAgentic, ok := any(mv).(*TypedMessageVariant[*schema.AgenticMessage]); ok {
        return gobEncodeAgenticMessageVariant(mvAgentic)
    }
    return nil, fmt.Errorf("gob encoding not supported for this message type")
}
```

这里 `mv` 的类型是 `*TypedMessageVariant[M]`，在泛型方法中无法直接做 type switch。Eino 的做法是先用 `any(mv)` 转为空接口，然后依次断言两种可能的具化类型。

---

## 9. 常见陷阱

### 陷阱 1：nil 接口值

最常见的 Go 接口陷阱：一个持有 nil 指针的接口值不等于 nil：

```go
type MyWriter struct{}
func (w *MyWriter) Write(p []byte) (int, error) { return 0, nil }

func getWriter() io.Writer {
    var w *MyWriter = nil
    return w  // 返回的接口值不为 nil！
}

var writer io.Writer = getWriter()
fmt.Println(writer == nil)  // false
```

接口值在内部是 `(type, value)` 二元组。`writer` 的 type 是 `*MyWriter`，value 是 nil，所以 `writer != nil`。正确做法是显式返回 nil：

```go
func getWriter() io.Writer {
    var w *MyWriter = nil
    if w == nil {
        return nil  // 返回真正的 nil 接口
    }
    return w
}
```

在 Eino 中，`isNilMessage` 函数就是为了在泛型上下文中安全检测这种情况。

### 陷阱 2：接口值比较

接口值可以使用 `==` 比较，但只有当底层具体类型是 `comparable` 时才安全：

```go
type S struct{ X int }
var a, b interface{} = S{1}, S{1}
fmt.Println(a == b)  // true：S 是 comparable

type NotComparable struct{ Ch chan int }
var c, d interface{} = NotComparable{}, NotComparable{}
// c == d  // panic：chan 不可比较
```

Eino 使用 `any(msg) == any(zero)` 比较泛型指针值，是因为指针类型总是 `comparable`。

### 陷阱 3：方法集与指针接收者

值类型不满足只有指针接收者方法的接口：

```go
type Closer interface { Close() error }

type File struct{}
func (f *File) Close() error { return nil }  // 指针接收者

// var c Closer = File{}    // 编译错误！File 值没有 Close 方法
var c Closer = &File{}      // OK：*File 有 Close 方法
```

在 Eino 中，所有组件接口（如 `BaseModel`、`InvokableTool`）的方法都用指针接收者实现，因此总是传递指针。

---

## 10. 练习题

### 练习 1：实现接口组合

仿照 Eino 的 Tool 接口组合，定义以下接口层次：

```go
type BaseReader interface {
    Read(ctx context.Context, key string) (string, error)
}

type CachingReader interface {
    BaseReader
    ReadFromCache(ctx context.Context, key string) (string, error)
}

type StreamingReader interface {
    BaseReader
    Stream(ctx context.Context, key string) (*StreamReader[string], error)
}
```

然后实现一个 `MultiReader` 类型，同时满足 `CachingReader` 和 `StreamingReader`。

<details>
<summary>参考答案</summary>

```go
type MultiReader struct {
    cache map[string]string
}

func (m *MultiReader) Read(ctx context.Context, key string) (string, error) {
    if v, ok := m.cache[key]; ok {
        return v, nil
    }
    return "", fmt.Errorf("not found")
}

func (m *MultiReader) ReadFromCache(ctx context.Context, key string) (string, error) {
    if v, ok := m.cache[key]; ok {
        return v, nil
    }
    return "", fmt.Errorf("not in cache")
}

func (m *MultiReader) Stream(ctx context.Context, key string) (*StreamReader[string], error) {
    v, err := m.Read(ctx, key)
    if err != nil {
        return nil, err
    }
    return StreamReaderFromArray([]string{v}), nil
}

// MultiReader 同时满足 CachingReader 和 StreamingReader
var _ CachingReader = (*MultiReader)(nil)
var _ StreamingReader = (*MultiReader)(nil)
```

</details>

### 练习 2：实现密封类型约束 + type switch

定义一个 `PaymentMethod` 密封约束，只允许 `*CreditCard` 和 `*BankTransfer`，然后写一个泛型函数 `ProcessPayment[P PaymentMethod](p P)` 用 type switch 处理两种支付方式。

<details>
<summary>参考答案</summary>

```go
type CreditCard struct { Number string; CVV string }
type BankTransfer struct { Account string; Routing string }

type PaymentMethod interface {
    *CreditCard | *BankTransfer
}

func ProcessPayment[P PaymentMethod](p P) error {
    switch v := any(p).(type) {
    case *CreditCard:
        fmt.Printf("Processing credit card ending in %s\n", v.Number[len(v.Number)-4:])
        return nil
    case *BankTransfer:
        fmt.Printf("Processing bank transfer to %s\n", v.Account)
        return nil
    default:
        panic("unreachable")
    }
}
```

</details>

### 练习 3：安全类型断言封装

仿照 Eino 的 `GetType` 和 `IsCallbacksEnabled`，写一个泛型辅助函数 `As[T any](v any) (T, bool)`，安全地从 `any` 中提取指定类型的值。

<details>
<summary>参考答案</summary>

```go
func As[T any](v any) (T, bool) {
    t, ok := v.(T)
    return t, ok
}

// 使用
var i any = "hello"
s, ok := As[string](i)   // s = "hello", ok = true
n, ok := As[int](i)      // n = 0, ok = false
```

</details>

### 练习 4：nil 接口值陷阱排查

以下代码有什么 bug？如何修复？

```go
type Handler interface {
    Handle(ctx context.Context, msg *schema.Message) error
}

type MyHandler struct{}
func (h *MyHandler) Handle(ctx context.Context, msg *schema.Message) error { return nil }

func GetHandler(name string) Handler {
    var h *MyHandler
    if name == "" {
        h = nil
    } else {
        h = &MyHandler{}
    }
    return h
}

func main() {
    h := GetHandler("")
    if h == nil {
        fmt.Println("no handler")  // 这行会执行吗？
    }
}
```

<details>
<summary>参考答案</summary>

`h == nil` 判断为 `false`，因为 `GetHandler` 返回的是 `(*MyHandler, nil)` 接口值，不是 nil 接口。修复方式：

```go
func GetHandler(name string) Handler {
    var h *MyHandler
    if name == "" {
        return nil  // 返回真正的 nil 接口
    }
    h = &MyHandler{}
    return h
}
```

</details>
