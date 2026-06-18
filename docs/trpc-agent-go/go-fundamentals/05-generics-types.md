# Go 泛型与类型系统 — trpc-agent-go 的工具基石

> trpc-agent-go 的 `NewFunctionTool[I, O any]` 用泛型让你写一个工具就自动生成 schema——不懂泛型就只能复制粘贴，更读不懂框架里 `[I, O any]` 这类签名到底把什么类型信息传给了编译器。

## 核心概念

Go 1.18 引入泛型后，函数和类型可以带 **type parameter**（类型参数），用方括号声明：`func F[T any](v T)`、`type Stack[T any] []T`。类型参数受 **constraint**（约束）限制，约束本身是 interface。必须吃透下面五点：

1. **`[T any]`**：`any` 是 `interface{}` 的别名，最宽松的约束，任意类型都满足。这是 trpc-agent-go 里最常见的写法。
2. **`comparable`**：预置约束，允许 `==` / `!=`，做 map key 或查找时必用。
3. **自定义 constraint**：把允许的底层类型列成 interface，例如 `type Number interface { ~int | ~float64 }`（`~` 表示「底层类型是」），约束里就能用算术运算。
4. **泛型函数 vs 泛型类型**：函数把类型参数用在参数/返回值上（`Map[T, U any]`）；类型把它用在字段/方法上（`Stack[T]`）。Go 1.22+ **不允许方法自己再带新的类型参数**——只能复用类型上声明的那批。
5. **什么时候不用**：只用一次的类型、或逻辑里要 `switch` 具体 type 的场景，强行抽泛型只会让代码更难读（YAGNI）。Go 官方建议：先看到 3+ 处同构重复代码再考虑抽泛型。

下面是一段**纯 Go** 示例（不涉及 trpc-agent-go），同时演示泛型函数 `Map`、泛型类型 `Stack`、自定义 `Number` 约束：

```go
package main

import "fmt"

// Number 是自定义 constraint：底层类型为 int 或 float64 的类型都满足。
type Number interface {
	~int | ~float64
}

// Map 是泛型函数：把 []T 转成 []U，T/U 由调用点自动推断。
func Map[T, U any](in []T, f func(T) U) []U {
	out := make([]U, len(in))
	for i, v := range in {
		out[i] = f(v)
	}
	return out
}

// Stack 是泛型类型：T 作为底层 slice 的元素类型。
type Stack[T any] struct {
	data []T
}

func (s *Stack[T]) Push(v T) { s.data = append(s.data, v) }
func (s *Stack[T]) Pop() (T, bool) {
	var zero T
	n := len(s.data)
	if n == 0 {
		return zero, false
	}
	v := s.data[n-1]
	s.data = s.data[:n-1]
	return v, true
}

// Sum 用 Number 约束，方法体内可以合法地用 + 运算符。
func Sum[T Number](xs []T) T {
	var total T
	for _, x := range xs {
		total += x
	}
	return total
}

func main() {
	nums := []int{1, 2, 3}
	doubled := Map(nums, func(v int) int { return v * 2 }) // 类型推断：T=U=int
	fmt.Println(doubled, Sum(nums))                        // [2 4 6] 6

	var s Stack[string]
	s.Push("hello")
	v, ok := s.Pop()
	fmt.Println(v, ok) // hello true
}
```

逐行解读：`Map[T, U any]` 的两个类型参数在调用 `Map(nums, ...)` 时被编译器从实参推断出来，**不需要手写 `Map[int, int](...)`**；`Stack[T]` 是泛型类型，其方法 `Push`/`Pop` 的 receiver 写成 `*Stack[T]`，方法签名里直接复用 `T`——**注意方法本身不能再引入新的类型参数**（详见陷阱 3）；`Sum[T Number]` 用了自定义 constraint，方法体里的 `total += x` 之所以能编译过，是因为 `Number` 把允许的底层类型限定在 `~int | ~float64`，编译器据此知道 `+` 合法。trpc-agent-go 的 `NewFunctionTool[I, O any]` 用的就是同一套语法，只是把 `T` 拆成输入 `I` 和输出 `O` 两个参数。

## 在 trpc-agent-go 里

### FunctionTool 的泛型签名

`NewFunctionTool` 在 `tool/function/function_tool.go:117` 直接把输入/输出类型作为类型参数：

```go
// tool/function/function_tool.go:117
func NewFunctionTool[I, O any](
	fn func(context.Context, I) (O, error),
	opts ...Option,
) *FunctionTool[I, O]
```

`I`（input）和 `O`（output）是两个独立的类型参数，被 `FunctionTool[I, O]` 结构体（`function_tool.go:27`）在字段层面携带：`fn func(context.Context, I) (O, error)`。**类型本身在编译期就钉死了「这个工具吃什么、吐什么」**，调用方传错类型直接编译失败，不用等运行时。

### 反射 + 泛型 = 自动 schema

关键魔法在 `function_tool.go:134-151`：构造器拿到 `I`、`O` 的零值，对它们做 `reflect.TypeOf(emptyI)`，再丢给 `itool.GenerateJSONSchema`（`internal/tool/tool.go:27`）生成 JSON Schema 给 LLM 看：

```go
// tool/function/function_tool.go:134
var (
	emptyI I
	emptyO O
)
iSchema := itool.GenerateJSONSchema(reflect.TypeOf(emptyI)) // 读 struct tag → JSON Schema
```

也就是说：**类型参数把类型信息一路带到运行时**，泛型本身不读字段，但配合 `reflect` 就能把 struct tag（`json:"..."`、`jsonschema:"..."`）翻译成 LLM 可识别的入参 schema。这正是「为什么写一个普通 Go 函数就能被 LLM 调用」的根因。

### 真实用法

```go
type CalculatorInput struct {
	A, B float64 `json:"a,b"`
}

func calc(ctx context.Context, in CalculatorInput) (string, error) {
	return fmt.Sprintf("%v", in.A+in.B), nil
}

tool := function.NewFunctionTool(calc, function.WithName("calculator"))
```

不需要手写一份 JSON Schema，框架自动从 `CalculatorInput` 的字段和 tag 生成。`StreamableFunctionTool[I, O any]`（`function_tool.go:240`）是流式版本，签名同构。

### `any` 作为显式扩展点

trpc-agent-go 还有一类用法：**字段类型直接用 `any` 留扩展位**。典型是 `model.Request.ExtraFields map[string]any`（`model/request.go:522`）和 `model.ToolCall.ExtraFields map[string]any`（`model/request.go:576`），用于把 provider 专有的、框架未预定义的顶层字段透传给上游 API。这里的 `any` 不是「懒得设计」，而是**显式声明「这块结构由调用方按 provider 协议自行负责」**——是和泛型 `[T any]` 互补的另一种「类型开放」手段。

## 常见陷阱

### 陷阱 1：为了一个类型硬抽泛型（YAGNI）

❌ 只有一种调用场景，却写 `func Parse[T any](s string) (T, error)`，每个调用点都要 `var v int; Parse[int](...)`，反而比直接写 `ParseInt` 更绕。

✅ 修复：**至少看到 3 处同构重复**再抽。Go 官方明确建议：泛型是为「写一份代码服务多个同构类型」准备的，不是为了「看起来通用」。

```go
// ❌ 只服务一种类型，过度抽象
func ParseInt[T int | int64](s string) (T, error) { /* ... */ }

// ✅ 直接写两个具名函数，更清楚
func ParseInt(s string) (int, error)        { /* ... */ }
func ParseInt64(s string) (int64, error)    { /* ... */ }
```

### 陷阱 2：想在方法体里 `switch` 类型参数的具体类型

❌ 在 `func F[T any](v T)` 里直接 `switch v.(type)`——编译错误，因为 `T` 不是 interface，没有动态类型可分派；想根据 T 是 struct 还是 map 走不同分支也无法直接写。

✅ 修复：要拿 T 的运行时类型信息，必须 `reflect.TypeOf(v)` 或 `any(v).(type)` 转一手。trpc-agent-go 的 schema 生成正是走 `reflect`——泛型负责把类型「带到」运行时，reflect 负责「拆开」它。

```go
// ❌ 编译错误：cannot type switch on non-interface value
func SchemaOf[T any](v T) string {
	switch v.(type) { // T 不是 interface，编译失败
	case struct{}:
		return "object"
	}
	return "?"
}

// ✅ 用 reflect 拆类型
func SchemaOf[T any](v T) string {
	switch reflect.TypeOf(v).Kind() {
	case reflect.Struct:
		return "object"
	case reflect.Map:
		return "map"
	}
	return "?"
}
```

### 陷阱 3：给方法加新的类型参数

❌ Go 不允许方法自带类型参数，写 `func (s *Stack[T]) Map[U any](f func(T) U) []U` 会直接编译失败——这是语言规范的硬性限制（截至 Go 1.22+）。

✅ 修复：把泛型逻辑**抽成顶层泛型函数**，方法内部调用它；或把那个操作改成包级 `func MapStack[T, U any](s *Stack[T], f func(T) U) []U`。

```go
// ❌ 编译错误：method cannot have type parameters
func (s *Stack[T]) Map[U any](f func(T) U) []U { /* ... */ }

// ✅ 抽成顶层泛型函数
func MapStack[T, U any](s *Stack[T], f func(T) U) []U {
	out := make([]U, len(s.data))
	for i, v := range s.data {
		out[i] = f(v)
	}
	return out
}
```

### 陷阱 4：在 `[T any]` 上用算术/比较运算符

❌ `func Add[T any](a, b T) T { return a + b }` 编译失败：`any` 约束不承诺 `+` 有定义。同理 `<`、`>` 也不行。

✅ 修复：用 `comparable` 做 `==`，自定义 constraint（`~int | ~float64`）做算术，或标准库 `constraints.Ordered`（golang.org/x/exp 内）做排序比较。约束越宽，方法体能用的运算符越少。

```go
// ❌ 编译错误：operator + not defined on T (constraint is any)
func Add[T any](a, b T) T { return a + b }

// ✅ 用 Number 约束收窄类型集，+ 即合法
type Number interface{ ~int | ~float64 | ~float32 }
func Add[T Number](a, b T) T { return a + b }
```

## 小结

- trpc-agent-go 用 `[I, O any]` 把工具的输入/输出类型钉在编译期，调用方传错类型直接编译失败；类型参数还把类型信息带到运行时，供 `reflect` 生成 JSON Schema。
- 泛型 + 反射是「写一份函数即得 schema」的组合拳：泛型负责类型安全，reflect 负责 schema 拆解，二者职责互补。
- 字段层面的 `any`（如 `ExtraFields map[string]any`）是另一种「类型开放」手段——显式声明该结构留给 provider 协议自行扩展，和 `[T any]` 不要混用。
- 抽泛型前先确认有 3+ 处同构重复；方法不能自带类型参数；`any` 约束下不能用算术/比较运算符——这三个坑是 Go 泛型最高频的踩雷点。

**延伸阅读：**

- [工具系统](../examples/02-tool-system/tool.md)
- [Go 官方泛型教程](https://go.dev/doc/tutorial/generics)
- [函数选项模式](./03-functional-options)
