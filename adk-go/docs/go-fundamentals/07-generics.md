# Go 泛型 — ADK-Go 类型安全的基础

> ADK-Go 大量使用泛型来实现类型安全的 API。理解泛型是阅读和扩展 ADK-Go 源码的关键。

## 1. 为什么 Go 需要泛型

Go 1.18 之前，要写一个通用函数只能靠 `interface{}`：

```go
// ❌ 没有泛型的写法：类型不安全，需要类型断言
func MaxInt(a, b int) int {
    if a > b { return a }
    return b
}
func MaxFloat(a, b float64) float64 {
    if a > b { return a }
    return b
}
// 每种类型都要写一遍...
```

Go 1.18 引入泛型后：

```go
// ✅ 泛型版本：一个函数搞定所有可比较类型
func Max[T any](a, b T) T {
    // any 太宽泛，稍后改进
    // ...
}
```

## 2. 类型参数：基础语法

泛型的核心是**类型参数**（Type Parameter），放在函数名后面的方括号里：

```go
//          ┌── 类型参数名（惯例用大写字母 T、K、V 等）
//          │
func Print[T any](v T) {
//      ↑             ↑
//   类型参数     参数类型用 T
    fmt.Println(v)
}

Print[string]("hello")  // 显式指定类型
Print("hello")           // 类型推断，自动判定为 string
Print(42)                // 推断为 int
Print(3.14)              // 推断为 float64
```

### 多个类型参数

```go
// Map 函数：将 []T 转换为 []U
func Map[T, U any](slice []T, fn func(T) U) []U {
    result := make([]U, len(slice))
    for i, v := range slice {
        result[i] = fn(v)
    }
    return result
}

nums := []int{1, 2, 3}
strs := Map(nums, func(n int) string {
    return "num:" + strconv.Itoa(n)
})
// strs = ["num:1", "num:2", "num:3"]
```

## 3. 类型约束（Type Constraints）

`any` 太宽泛——几乎所有操作都不允许。你需要**类型约束**来告诉编译器"这个类型支持哪些操作"。

### 用接口定义约束

```go
// 约束：必须是整数或浮点数类型
type Number interface {
    int | int32 | int64 | float32 | float64
}

func Sum[T Number](nums []T) T {
    var total T
    for _, n := range nums {
        total += n    // 因为 T 约束为 Number，编译器知道 + 操作是合法的
    }
    return total
}

Sum([]int{1, 2, 3})       // T = int
Sum([]float64{1.1, 2.2})  // T = float64
// Sum([]string{"a"})      // 编译错误：string 不在 Number 约束内
```

### 标准库约束包：`golang.org/x/exp/constraints`

不要重复造轮子——标准扩展库已经定义好了常用约束：

```go
import "golang.org/x/exp/constraints"

func Max[T constraints.Ordered](a, b T) T {
    if a > b { return a }
    return b
}

Max(3, 5)       // 5
Max("a", "z")   // "z"
Max(3.14, 2.0)  // 3.14
```

常用内置约束：

| 约束 | 含义 | 包含类型 |
|------|------|----------|
| `any` | 任意类型 | 所有类型 |
| `comparable` | 可比较（`==` `!=`） | 不含 slice/map/func |
| `constraints.Ordered` | 可排序（`<` `>` `<=` `>=`） | 整数 + 浮点 + string |
| `constraints.Integer` | 整数 | 有符号和无符号整数 |
| `constraints.Float` | 浮点数 | float32, float64 |

## 4. 泛型结构体

类型参数可以作用在 struct 上：

```go
// 泛型栈：可以存储任意类型
type Stack[T any] struct {
    items []T
}

func (s *Stack[T]) Push(item T) {
    s.items = append(s.items, item)
}

func (s *Stack[T]) Pop() (T, bool) {
    if len(s.items) == 0 {
        var zero T  // 零值
        return zero, false
    }
    item := s.items[len(s.items)-1]
    s.items = s.items[:len(s.items)-1]
    return item, true
}

// 使用
intStack := Stack[int]{}
intStack.Push(1)
intStack.Push(2)
v, _ := intStack.Pop()  // v = 2, 类型为 int

strStack := Stack[string]{}
strStack.Push("hello")
```

### 方法可以有额外的类型参数

```go
func (s *Stack[T]) Transform[U any](fn func(T) U) *Stack[U] {
    result := &Stack[U]{items: make([]U, len(s.items))}
    for i, item := range s.items {
        result.items[i] = fn(item)
    }
    return result
}
```

## 5. 泛型类型别名与接口

```go
// 泛型函数类型
type Handler[T any] func(T) error

// 泛型接口
type Container[T any] interface {
    Get() T
    Set(v T)
}

// 泛型迭代器（Go 1.23+ 内置）
// type Seq[V any] func(yield func(V) bool)
// type Seq2[K, V any] func(yield func(K, V) bool)
```

## 6. ADK-Go 中的泛型实战

### 6.1 FunctionTool：最典型的泛型 API

`functiontool.New` 是 ADK-Go 中泛型使用最出彩的地方（`source/tool/functiontool/function.go:78`）：

```go
// 泛型函数类型
type Func[TArgs, TResults any] func(tool.Context, TArgs) (TResults, error)

// 泛型构造函数
func New[TArgs, TResults any](cfg Config, handler Func[TArgs, TResults]) (tool.Tool, error)
```

**为什么必须用泛型？** 因为需要同时知道工具的**输入类型**和**输出类型**才能生成 JSON Schema：

```go
// 带泛型：编译期类型安全 + 自动 Schema 推导
weatherTool, _ := functiontool.New(functiontool.Config{
    Name:        "get_weather",
    Description: "获取天气",
}, func(ctx tool.Context, args WeatherArgs) (WeatherResult, error) {
    // args 编译期就知道是 WeatherArgs
    // 返回值编译期就知道是 WeatherResult
    // JSON Schema 自动从结构体字段推导
    return WeatherResult{Temperature: 25.5}, nil
})
// weatherTool 类型是 tool.Tool

// ❌ 如果没有泛型，会变成：
func NewWithoutGenerics(cfg Config, handler interface{}) (Tool, error) {
    // 不知道 handler 的签名，只能用反射去猜参数类型
    // 运行时才发现参数类型错误，既不安全又低效
}
```

### 6.2 泛型结构体：内部实现

```go
// functionTool 本身也是泛型结构体（function.go:122）
type functionTool[TArgs, TResults any] struct {
    config   Config
    handler  Func[TArgs, TResults]
    ischema  *jsonschema.Schema
    oschema  *jsonschema.Schema
}

func (f *functionTool[TArgs, TResults]) Run(ctx tool.Context, args map[string]any) (map[string]any, error) {
    // 将 map 转为类型安全的 TArgs
    typedArgs, err := FromMapStructure[TArgs](args)
    // 调用 handler（类型安全）
    result, err := f.handler(ctx, *typedArgs)
    // 将 TResults 转为 map
    return ToMapStructure(result)
}
```

关键观察：泛型在**边界做类型转换**——从 LLM 来的数据是 `map[string]any`，在泛型层转为 `TArgs`；handler 返回的 `TResults` 再转回 `map[string]any`。泛型让这层转换**编译期就能校验类型正确性**。

### 6.3 类型推断的便利

调用 `functiontool.New` 时不需要显式指定类型参数，Go 会从 handler 的函数签名自动推断：

```go
// 显式指定（啰嗦）
functiontool.New[WeatherArgs, WeatherResult](cfg, handler)

// 类型推断（简洁）—— Go 从 handler 签名推导出 TArgs=WeatherArgs, TResults=WeatherResult
functiontool.New(cfg, handler)
```

### 6.4 iter.Seq2 的内置泛型

`iter.Seq2` 本身就是 Go 标准库定义的泛型类型：

```go
type Seq2[K, V any] func(yield func(K, V) bool)
```

Agent 接口的 `Run()` 方法返回 `iter.Seq2[*session.Event, error]`，等效于：

```go
func(yield func(*session.Event, error) bool)
```

### 6.5 内部辅助：FromMapStructure

```go
// internal/converters/map_structure.go:42
func FromMapStructure[T any](data map[string]any) (*T, error) {
    // 将 map 反序列化为指定类型的结构体
    // 泛型让调用方不需要做类型断言
}
```

这个函数的巧妙之处：接收 `map[string]any`，返回 `*T`，调用方拿到的是**具体的类型**而非 `any`。

## 7. 常见模式与最佳实践

### 模式 1：边界转换

在系统边界处用泛型做类型转换，内部用具体类型：

```go
// ✅ 好：泛型在 API 边界
func NewTool[T Input, U Output](handler func(T) U) Tool {
    return &toolImpl[T, U]{handler: handler}
}

// ✅ 好：内部实现
func (t *toolImpl[T, U]) Run(raw map[string]any) map[string]any {
    input := fromMap[T](raw)   // 边界转换
    output := t.handler(input) // 类型安全调用
    return toMap(output)        // 边界转换
}
```

### 模式 2：函数选项 + 泛型

ADK-Go 大量使用函数选项模式，有时泛型会出现在选项的返回值中：

```go
type RunOption func(*runOptions)  // 不需泛型

// 但有些场景需要泛型约束选项参数类型：
type Option[T any] func(*T)
```

### 模式 3：避免过度泛型化

不是所有东西都需要泛型。判断标准：

| 场景 | 需要泛型吗？ |
|------|------------|
| 容器（Stack、Set、Cache） | ✅ 典型泛型场景 |
| 算法（Sort、Filter、Map） | ✅ 操作与类型无关 |
| JSON Schema 推导 | ✅ 需从类型信息生成 Schema |
| Agent 配置 | ❌ 配置字段随业务变化，用 struct |
| 工具参数校验 | ❌ 运行时逻辑，反射或手动校验 |

### 常见陷阱

**⚠️ 不能对类型参数做类型断言**：

```go
func Bad[T any](v T) {
    switch v.(type) {  // ❌ 编译错误：不能用类型断言
    }
}

// 如果需要按类型分支，说明你不需要泛型，直接用 interface{}
```

**⚠️ `any` 约束下几乎什么都不能做**：

```go
func Bad[T any](a, b T) T {
    // return a + b  // ❌ 编译错误：any 不支持 + 操作
    // return a < b  // ❌ 编译错误：any 不支持比较
    return a
}
```

**⚠️ 零值用 `var zero T`**：

```go
func Find[T comparable](slice []T, target T) (int, T) {
    for i, v := range slice {
        if v == target { return i, v }
    }
    var zero T   // ✅ 正确：泛型的零值
    return -1, zero
}
```

## 8. 在 ADK-Go 源码中定位泛型

快速搜索 ADK-Go 中的所有泛型使用：

```bash
# 搜索泛型函数和类型定义
grep -rn '\[T\|\[TArgs\|\[K, V' source/ --include='*.go'

# 关键位置：
# source/tool/functiontool/function.go:78  — functiontool.New[TArgs, TResults]
# source/tool/functiontool/function.go:71  — Func[TArgs, TResults]
# source/tool/functiontool/function.go:122 — functionTool[TArgs, TResults] struct
# source/internal/converters/map_structure.go:42 — FromMapStructure[T]
```

## 9. 速查表

| 语法 | 示例 | 说明 |
|------|------|------|
| `[T any]` | `func Print[T any](v T)` | 单类型参数，无约束 |
| `[T Constraint]` | `func Max[T Ordered](a, b T) T` | 带约束的类型参数 |
| `[T, U any]` | `func Map[T, U any](s []T, fn func(T)U) []U` | 多类型参数 |
| `struct[T any]` | `type Stack[T any] struct { ... }` | 泛型结构体 |
| `func (s *S[T]) M()` | `func (s *Stack[T]) Push(v T)` | 泛型方法 |
| `var zero T` | 零值 | 获取泛型类型的零值 |
| 类型推断 | `Max(3, 5)` 不用写 `Max[int]` | Go 自动推断 |
