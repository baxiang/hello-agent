# 结构体嵌入与标签 — Eino 配置复用与序列化

## 1. 结构体嵌入（Struct Embedding）

Go 允许将一个类型作为另一个类型的匿名字段，这称为嵌入。嵌入类型的字段和方法会被"提升"到外部类型上。

### 1.1 语法

```go
type Inner struct {
    Name  string
    Value int
}

type Outer struct {
    Inner          // 匿名嵌入，无字段名
    Label string   // 普通字段
}

o := Outer{Inner: Inner{Name: "test", Value: 42}, Label: "outer"}
fmt.Println(o.Name)  // "test" — Inner.Name 被提升到 Outer
fmt.Println(o.Inner.Name) // "test" — 也可以显式访问
```

### 1.2 Eino 示例：ToolsConfig 嵌入 ToolsNodeConfig

在 ADK 中，`ToolsConfig`（adk/chatmodel.go:136-156）嵌入了 `compose.ToolsNodeConfig`：

```go
type ToolsConfig struct {
    compose.ToolsNodeConfig  // 匿名嵌入

    ReturnDirectly    map[string]bool
    EmitInternalEvents bool
}
```

`compose.ToolsNodeConfig`（compose/tool_node.go:184-229）定义了工具节点的配置：

```go
type ToolsNodeConfig struct {
    Tools              []tool.BaseTool
    ToolAliases        map[string]ToolAliasConfig
    UnknownToolsHandler func(ctx context.Context, name, input string) (string, error)
    ExecuteSequentially bool
    ToolArgumentsHandler func(ctx context.Context, name, arguments string) (string, error)
    ToolCallMiddlewares []ToolMiddleware
}
```

通过嵌入，`ToolsConfig` 自动拥有 `ToolsNodeConfig` 的所有字段：

```go
cfg := ToolsConfig{}
cfg.Tools = []tool.BaseTool{myTool}         // 提升的字段
cfg.ReturnDirectly = map[string]bool{"exit": true} // 自有字段
```

这种设计使得 `ToolsConfig` 在复用 `ToolsNodeConfig` 的基础上，添加了 ADK 特有的 `ReturnDirectly` 和 `EmitInternalEvents` 配置。

### 1.3 方法提升

嵌入类型的方法也会被提升。如果 `ToolsNodeConfig` 有方法 `Validate()`，则 `ToolsConfig` 的实例也能直接调用 `cfg.Validate()`。在 Eino 中，嵌入主要用于字段复用，方法提升的场景较少。

### 1.4 字段提升规则

- 提升的字段可以像自有字段一样直接访问
- 如果外部类型定义了同名字段，外部字段优先，嵌入字段被"遮蔽"
- 嵌入多层时，如果两个嵌入类型有同名字段，必须显式指定中间类型名，否则编译器报歧义错误

## 2. JSON 结构体标签

Go 的 `encoding/json` 通过结构体标签控制序列化行为。标签格式为 `json:"name,omitempty"`：

- `name`：JSON 中的字段名
- `omitempty`：零值时省略该字段

### 2.1 Eino 示例：Message 结构体

`schema.Message`（schema/message.go:497-531）大量使用 JSON 标签：

```go
type Message struct {
    Role RoleType `json:"role"`

    Content string `json:"content"`

    MultiContent []ChatMessagePart `json:"multi_content,omitempty"`

    UserInputMultiContent []MessageInputPart `json:"user_input_multi_content,omitempty"`

    AssistantGenMultiContent []MessageOutputPart `json:"assistant_output_multi_content,omitempty"`

    Name string `json:"name,omitempty"`

    ToolCalls []ToolCall `json:"tool_calls,omitempty"`

    ToolCallID string `json:"tool_call_id,omitempty"`
    ToolName   string `json:"tool_name,omitempty"`

    ResponseMeta *ResponseMeta `json:"response_meta,omitempty"`

    ReasoningContent string `json:"reasoning_content,omitempty"`

    Extra map[string]any `json:"extra,omitempty"`
}
```

要点：
- `Role` 和 `Content` 没有 `omitempty`，始终序列化
- `ToolCalls` 等字段带 `omitempty`，为空时不出现在 JSON 中
- `ResponseMeta` 用指针类型，`nil` 时不序列化（指针 + omitempty 是处理可选结构体的惯用模式）
- `ToolCallID string json:"tool_call_id,omitempty"` — 仅 Tool 角色的消息才需要此字段

### 2.2 Eino 示例：ToolInfo 结构体

`schema.ToolInfo`（schema/tool.go:128-143）描述工具的元信息，其中的嵌入字段 `*ParamsOneOf` 既是嵌入也是指针：

```go
type ToolInfo struct {
    Name string
    Desc string
    Extra map[string]any
    *ParamsOneOf  // 嵌入指针，nil 表示无参数
}
```

## 3. jsonschema 标签与 InferTool

`utils.InferTool` 是 Eino 的工具创建快捷方式，它能从 Go 结构体标签自动推断 JSON Schema。

### 3.1 工作原理

`goStruct2ParamsOneOf`（components/tool/utils/invokable_func.go:120-135）使用 `jsonschema.Reflector` 反射结构体标签，生成 JSON Schema：

```go
func goStruct2ParamsOneOf[T any](opts ...Option) (*schema.ParamsOneOf, error) {
    options := getToolOptions(opts...)
    r := &jsonschema.Reflector{
        Anonymous:      true,
        DoNotReference: true,
        SchemaModifier: jsonschema.SchemaModifierFn(options.scModifier),
    }
    js := r.Reflect(generic.NewInstance[T]())  // 通过反射推断 Schema
    js.Version = ""
    return schema.NewParamsOneOfByJSONSchema(js), nil
}
```

### 3.2 jsonschema 标签

`jsonschema` 标签用于为字段添加 JSON Schema 约束：

```go
type SearchParams struct {
    Query string `json:"query" jsonschema:"description=搜索关键词,required"`
    Limit int    `json:"limit" jsonschema:"description=返回结果数量上限"`
}

// 自动推断出 ToolInfo，包含参数描述和必填标记
tool, err := utils.InferTool[SearchParams, string](
    "search", "搜索工具",
    func(ctx context.Context, input SearchParams) (string, error) {
        return fmt.Sprintf("搜索: %s, 上限: %d", input.Query, input.Limit), nil
    },
)
```

### 3.3 自定义 Schema 修改器

通过 `WithSchemaModifier`（components/tool/utils/create_options.go:67-70），可以在标签推断后进一步修改 JSON Schema：

```go
type SchemaModifierFn func(jsonTagName string, t reflect.Type, tag reflect.StructTag, schema *jsonschema.Schema)
```

这个函数接收每个字段的标签信息，允许添加 jsonschema 标签无法表达的约束（如 `anyOf`、`pattern` 等）。

## 4. gob 序列化（Checkpoint）

Eino 使用 Go 标准库的 `encoding/gob` 实现检查点（Checkpoint）序列化，用于 Graph 执行状态的持久化和恢复。

### 4.1 类型注册

gob 要求在编码/解码前注册接口值的具体类型。Eino 在 `schema/serialization.go` 的 `init` 函数中集中注册所有需要序列化的类型（schema/serialization.go:27-57）：

```go
func init() {
    RegisterName[*Message]("_eino_message")
    RegisterName[[]*Message]("_eino_message_slice")
    RegisterName[*AgenticMessage]("_eino_agentic_message")
    RegisterName[RoleType]("_eino_role_type")
    RegisterName[ToolCall]("_eino_tool_call")
    RegisterName[FunctionCall]("_eino_function_call")
    // ... 更多类型
}
```

`RegisterName[T]`（schema/serialization.go:83-90）同时完成 gob 注册和内部序列化注册：

```go
func RegisterName[T any](name string) {
    gob.RegisterName(name, generic.NewInstance[T]())
    err := serialization.GenericRegister[T](name)
    if err != nil {
        panic(err)
    }
}
```

自定义类型需要通过 `schema.Register[T]()` 或 `schema.RegisterName[T](name)` 在 `init()` 中注册，否则 gob 序列化时会 panic。

### 4.2 GobEncode/GobDecode 自定义序列化

当默认的 gob 序列化不满足需求时（如需要特殊处理流式数据），可以实现 `gob.GobEncoder` 和 `gob.GobDecoder` 接口。

ADK 的 `TypedMessageVariant`（adk/interface.go:126-244）是一个典型示例。它包含 `MessageStream *schema.StreamReader[M]`，而 StreamReader 本身不可序列化。`GobEncode` 的做法是先消费整个流，合并为一个完整的 Message，再序列化：

```go
func (mv *TypedMessageVariant[M]) GobEncode() ([]byte, error) {
    if mvMsg, ok := any(mv).(*TypedMessageVariant[*schema.Message]); ok {
        return gobEncodeMessageVariant(mvMsg)
    }
    // ...
}

func gobEncodeMessageVariant(mv *TypedMessageVariant[*schema.Message]) ([]byte, error) {
    s := &messageVariantSerialization{
        IsStreaming: mv.IsStreaming,
        Message:     mv.Message,
        Role:        mv.Role,
        ToolName:    mv.ToolName,
    }
    if mv.IsStreaming {
        var messages []Message
        for {
            frame, err := mv.MessageStream.Recv() // 消费整个流
            if err == io.EOF {
                break
            }
            if err != nil {
                return nil, fmt.Errorf("error receiving message stream: %w", err)
            }
            messages = append(messages, frame)
        }
        m, err := schema.ConcatMessages(messages) // 合并为完整消息
        // ...
        s.MessageStream = m
    }
    buf := &bytes.Buffer{}
    err := gob.NewEncoder(buf).Encode(s)
    return buf.Bytes(), nil
}
```

`GobDecode` 反序列化后，将合并后的消息包装为单元素的 `StreamReaderFromArray`（schema/stream.go:461-463），恢复流的形式：

```go
func gobDecodeMessageVariant(mv *TypedMessageVariant[*schema.Message], b []byte) error {
    s := &messageVariantSerialization{}
    err := gob.NewDecoder(bytes.NewReader(b)).Decode(s)
    // ...
    if s.MessageStream != nil {
        mv.MessageStream = schema.StreamReaderFromArray([]*schema.Message{s.MessageStream})
    }
    return nil
}
```

## 5. 模板语法

Eino 的 prompt 模板支持三种格式，由 `FormatType`（schema/message.go:96-105）控制：

### 5.1 FString — `{variable}` 格式

基于 Python PEP 3101，使用 `pyfmt` 库实现（schema/message.go:631）：

```go
template := "你好，{name}！今天是{day}。"
// Format 后: "你好，Eino！今天是星期一。"
```

FString 是 Eino 的默认模板格式，简单直观。

### 5.2 GoTemplate — `\{\{.variable}}` 格式

使用 Go 标准库 `text/template`（schema/message.go:633-645）：

```go
template := "你好，{{.name}}！今天是{{.day}}。"
```

支持条件判断、循环等完整模板语法：

```go
{{if .isVIP}}欢迎VIP用户{{else}}欢迎普通用户{{end}}
```

### 5.3 Jinja2 — `\{\{ variable }}` 格式

使用 `gonja` 库实现 Python Jinja2 模板引擎（schema/message.go:647-659）：

```go
template := "你好，{{ name }}！今天是{{ day }}。"
```

Jinja2 的优势是模板语法更强大（如过滤器、宏、继承），适合复杂的 prompt 构建。

### 5.4 格式选择

在 `formatContent`（schema/message.go:629-663）中，三种格式由 `FormatType` 枚举分派：

```go
func formatContent(content string, vs map[string]any, formatType FormatType) (string, error) {
    switch formatType {
    case FString:
        return pyfmt.Fmt(content, vs)
    case GoTemplate:
        parsedTmpl, _ := template.New("template").Option("missingkey=error").Parse(content)
        // ...
    case Jinja2:
        tpl, _ := env.FromString(content)
        return tpl.Execute(vs)
    }
}
```

## 6. 常见陷阱

### 6.1 未导出字段不序列化

`encoding/json` 和 `encoding/gob` 都只处理导出字段。如果结构体有小写字段，它们会被静默忽略，不会报错。这在调试序列化问题时非常隐蔽。

### 6.2 嵌入字段的 JSON 行为

嵌入类型的字段在 JSON 中默认按字段名扁平化：

```go
type ToolsConfig struct {
    compose.ToolsNodeConfig  // 嵌入
    ReturnDirectly map[string]bool `json:"return_directly,omitempty"`
}
```

`ToolsNodeConfig` 的 `Tools` 字段在 JSON 中会出现在顶层，而非嵌套在 `ToolsNodeConfig` 对象下。如果需要嵌套输出，应使用具名字段而非嵌入。

### 6.3 gob 类型注册必须在编码前

gob 解码时，所有接口值的具体类型必须已注册。如果解码端未注册对应类型，会返回错误。Eino 通过 `init()` 函数确保注册在程序启动时完成。自定义类型必须在 `init()` 中调用 `schema.Register[T]()` 或 `schema.RegisterName[T](name)`。

### 6.4 模板中的花括号冲突

FString 使用 `{variable}`，如果 prompt 内容本身包含 JSON 或花括号（如 `{"key": "value"}`），FString 会尝试解析并报错。此时应使用 GoTemplate 或 Jinja2 格式，或在 `GenModelInput` 中手动构建消息，避免模板解析。

### 6.5 嵌入与遮蔽

如果外部类型定义了与嵌入类型同名的字段，嵌入字段被遮蔽。在 Eino 的 `ToolsConfig` 中，`ReturnDirectly` 是自有字段，不与 `ToolsNodeConfig` 的字段冲突。设计嵌入时务必检查字段名冲突，否则会导致难以排查的 bug。
