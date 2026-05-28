# 反射（reflect）— Eino Graph 编译的幕后功臣

## 1. 反射基础

Go 的 `reflect` 包允许程序在运行时检查和操作类型信息。核心概念有两个：

- **`reflect.Type`**：类型的元信息。通过 `reflect.TypeOf(v)` 获取。
- **`reflect.Value`**：值的动态表示。通过 `reflect.ValueOf(v)` 获取，可以读取、设置值。

```go
type User struct {
    Name string
    Age  int
}

u := User{Name: "Alice", Age: 30}
t := reflect.TypeOf(u)   // main.User
v := reflect.ValueOf(u)  // {Alice 30}

fmt.Println(t.Kind())            // struct
fmt.Println(t.NumField())        // 2
fmt.Println(t.Field(0).Name)     // Name
fmt.Println(v.FieldByName("Name").String()) // Alice
```

反射是 Go 泛型出现前实现通用逻辑的主要手段，在 Eino 中依然扮演关键角色——尤其是 Graph 编译时的类型检查和字段映射。

## 2. Eino 中的反射使用

Eino 在以下几个核心场景中使用反射，它们都发生在 Graph 编译阶段（`Compile` 调用时），而非请求执行阶段。

### 2.1 Graph 编译时类型检查

当创建 `Graph[I, O]` 时，Eino 需要记住输入输出的类型信息，用于编译时验证节点之间的连接是否类型兼容。`internal/generic/type.go:56-58` 提供了从泛型参数提取 `reflect.Type` 的关键函数：

```go
func TypeOf[T any]() reflect.Type {
    return reflect.TypeOf((*T)(nil)).Elem()
}
```

这个巧妙的技巧通过创建 `*T` 类型的 nil 指针，再取其元素类型，避免了必须持有 `T` 的实例值。在 `compose/graph.go:107-108` 中，Graph 构建时利用此函数记录类型：

```go
func newGraphFromGeneric[I, O any](...) *graph {
    return newGraph(&newGraphConfig{
        inputType:  generic.TypeOf[I](),   // 提取 I 的 reflect.Type
        outputType: generic.TypeOf[O](),   // 提取 O 的 reflect.Type
        gh:         newGenericHelper[I, O](),
    })
}
```

编译时，Graph 会检查每条边的上下游节点类型是否兼容（compose/graph.go:200-225），例如前置节点的输出类型是否与后置节点的输入类型一致、状态处理器类型是否匹配等。

### 2.2 字段映射（Field Mapping）

Eino 的字段映射功能允许将前置节点的特定字段映射到后置节点的特定字段，这是实现灵活数据流的关键。整个映射系统深度依赖反射。

`compose/field_mapping.go` 中的核心逻辑：

**提取源字段**（compose/field_mapping.go:398-409）：通过 `reflect.Value.FieldByName` 从结构体中提取指定字段：

```go
func checkAndExtractFromField(fromField string, input reflect.Value) (reflect.Value, error) {
    f := input.FieldByName(fromField)
    if !f.IsValid() {
        return reflect.Value{}, fmt.Errorf("field not found. field=%v, inputType=%v", fromField, input.Type())
    }
    if !f.CanInterface() {
        return reflect.Value{}, fmt.Errorf("field not exported. field=%v, inputType=%v", fromField, input.Type())
    }
    return f, nil
}
```

**验证字段路径**（compose/field_mapping.go:442-480）：`checkAndExtractFieldType` 沿路径逐层检查类型，验证字段存在且已导出：

```go
func checkAndExtractFieldType(paths []string, typ reflect.Type) (extracted reflect.Type, remainingPaths FieldPath, err error) {
    extracted = typ
    for i, field := range paths {
        for extracted.Kind() == reflect.Ptr {
            extracted = extracted.Elem()
        }
        if extracted.Kind() == reflect.Struct {
            f, ok := extracted.FieldByName(field)
            if !ok {
                return nil, nil, fmt.Errorf("type[%v] has no field[%s]", extracted, field)
            }
            if !f.IsExported() {
                return nil, nil, fmt.Errorf("type[%v] has an unexported field[%s]", extracted.String(), field)
            }
            extracted = f.Type
            continue
        }
        // ... 处理 map、interface 等类型
    }
    return extracted, nil, nil
}
```

**赋值到目标字段**（compose/field_mapping.go:250-364）：`assignOne` 使用反射将值设置到目标结构体的指定字段路径，支持嵌套结构体和 map：

```go
func assignOne(destValue reflect.Value, taken any, to string) reflect.Value {
    // ... 沿 to 路径逐层定位目标字段
    field := destValue.FieldByName(path)
    field.Set(toSet) // 反射赋值
}
```

### 2.3 TypeOf[T] — 泛型参数类型提取

`internal/generic/generic.go` 中的 `TypeOf[T]` 是 Eino 反射体系的基础设施，被广泛使用：

- `compose/generic_graph.go:42`：`WithGenLocalState` 使用 `generic.TypeOf[S]()` 获取状态类型
- `compose/field_mapping.go:219`：`buildFieldMappingConverter` 使用 `generic.TypeOf[I]()` 构建字段映射转换器
- `components/tool/utils/invokable_func.go:129`：`goStruct2ParamsOneOf` 使用 `generic.NewInstance[T]()` 创建实例以推断 JSON Schema

`NewInstance[T]()`（internal/generic/generic.go:27-51）通过反射创建泛型类型的零值实例：

```go
func NewInstance[T any]() T {
    typ := TypeOf[T]()
    switch typ.Kind() {
    case reflect.Map:
        return reflect.MakeMap(typ).Interface().(T)
    case reflect.Slice, reflect.Array:
        return reflect.MakeSlice(typ, 0, 0).Interface().(T)
    case reflect.Ptr:
        // 递归创建指针指向的类型实例
    default:
        var t T
        return t
    }
}
```

### 2.4 MergeStreamReaders 与 reflect.Select

Go 的 `select` 语句最多支持 64 个 case（编译时限制）。当 Eino 需要合并超过 64 个流时，静态 `select` 不可行。Eino 使用 `reflect.Select` 突破此限制（schema/stream.go:514-524）：

```go
func newMultiStreamReader[T any](sts []*stream[T]) *multiStreamReader[T] {
    var itemsCases []reflect.SelectCase
    if len(sts) > maxSelectNum {  // maxSelectNum = 5（schema/select.go:19）
        itemsCases = make([]reflect.SelectCase, len(sts))
        for i, st := range sts {
            itemsCases[i] = reflect.SelectCase{
                Dir:  reflect.SelectRecv,       // 接收方向
                Chan: reflect.ValueOf(st.items), // 目标 channel
            }
        }
    }
    // ...
}
```

在 `recv` 方法中（schema/stream.go:538-574），当活跃流数量超过 `maxSelectNum` 时，调用 `reflect.Select`：

```go
if len(msr.nonClosed) > maxSelectNum {
    var recv reflect.Value
    chosen, recv, ok = reflect.Select(msr.itemsCases) // 动态 select
    if ok {
        item := recv.Interface().(streamItem[T])
        return item.chunk, item.err
    }
    msr.itemsCases[chosen].Chan = reflect.Value{} // 标记已关闭的流
}
```

`reflect.Select` 接受 `[]reflect.SelectCase`，返回哪个 case 就绪及其接收的值。这允许在运行时动态构建任意数量的 select case。

对于不超过 5 个流的情况，Eino 使用预编译的静态 `select`（schema/select.go:21-73），性能更好。

## 3. reflect.Type 常用操作

| 方法 | 说明 | 示例 |
|------|------|------|
| `Kind()` | 返回底层种类 | `reflect.Struct`、`reflect.Ptr`、`reflect.Map` |
| `Name()` | 返回类型名 | `"User"` |
| `NumField()` | 结构体字段数 | `2` |
| `Field(i)` | 第 i 个字段的 `StructField` | `{Name: "Age", Type: int, ...}` |
| `Elem()` | 指针/slice/channel 的元素类型 | `*User` → `User` |
| `Key()` | map 的键类型 | `map[string]int` → `string` |

## 4. reflect.Value 常用操作

| 方法 | 说明 | 示例 |
|------|------|------|
| `Interface()` | 转回 `any` | `v.Interface().(string)` |
| `FieldByName(name)` | 按名称获取结构体字段 | `v.FieldByName("Name")` |
| `Set(val)` | 设置值（需要可寻址） | `v.FieldByName("Name").Set(reflect.ValueOf("Bob"))` |
| `CanInterface()` | 是否可以调用 Interface | 未导出字段返回 false |
| `IsValid()` | 是否持有有效值 | nil 检查 |
| `Elem()` | 解引用指针 | `*User` 的 Value → `User` 的 Value |

## 5. reflect.Select — 动态 select

Go 的 `select` 语句是编译时结构，case 数量在编译期固定，最多 64 个。`reflect.Select` 是其运行时等价物：

```go
cases := []reflect.SelectCase{
    {Dir: reflect.SelectRecv, Chan: reflect.ValueOf(ch1)},
    {Dir: reflect.SelectRecv, Chan: reflect.ValueOf(ch2)},
    {Dir: reflect.SelectSend, Chan: reflect.ValueOf(ch3), Send: reflect.ValueOf(42)},
    {Dir: reflect.SelectDefault},
}
chosen, value, ok := reflect.Select(cases)
```

返回值：`chosen` 是就绪的 case 索引，`value` 和 `ok` 的含义与普通 channel 接收一致。

Eino 利用 `reflect.Select` 的关键模式：当某个流关闭时，将其对应的 `SelectCase.Chan` 设为零值（`reflect.Value{}`），这样该 case 在后续 select 中永远不会再就绪（schema/stream.go:549）。

## 6. 性能考量

反射比直接代码慢 10-100 倍，但在 Eino 中这不是问题，因为：

1. **反射只在编译时执行**：`Graph.Compile()` 调用时执行类型检查和字段映射验证，之后生成的 `Runnable` 在请求处理阶段不使用反射。
2. **编译一次，运行多次**：一个编译好的 Graph 可以处理成千上万的请求，编译时的反射开销被均摊到接近零。
3. **热路径无反射**：请求执行路径（Invoke/Stream/Collect/Transform）通过泛型单态化直接调用，没有反射开销。

## 7. 常见陷阱

### 7.1 未导出字段

反射无法设置未导出字段（小写字母开头的字段）。`FieldByName` 能获取到字段，但 `CanInterface()` 返回 false，`Set` 会 panic。Eino 在编译时就会检查并报错（compose/field_mapping.go:404-406）：

```go
if !f.CanInterface() {
    return reflect.Value{}, fmt.Errorf("field not exported. field=%v", fromField)
}
```

### 7.2 Panic 风险

反射操作在类型不匹配时会 panic，而非返回 error。例如对非结构体类型调用 `FieldByName`、对非指针值调用 `Elem` 等。Eino 通过编译时类型检查提前发现问题，避免运行时 panic。但在 `assignOne` 等函数中仍保留了 `panic` 作为不可达路径的保护（compose/field_mapping.go:599）：

```go
panic("when take one value from source, value not map or struct, and type not interface")
```

### 7.3 接口类型的运行时检查

当字段类型为 `interface{}` 时，编译时无法确定其实际类型。Eino 将这类检查推迟到请求时（compose/field_mapping.go:679-712），通过 `reflect.TypeOf(a).AssignableTo(successorFieldType)` 在运行时验证类型兼容性。这意味着某些字段映射错误只能在运行时被发现，而非编译时。
