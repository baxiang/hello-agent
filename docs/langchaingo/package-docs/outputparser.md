# OutputParser 输出解析详解

LangChainGo 的 OutputParser 系统负责将 LLM 的原始文本输出转换为结构化数据。通过解析器，开发者可以指定输出格式、自动提取结构化信息，并在解析失败时获得清晰的错误提示。

---

## 1. OutputParser[T] 泛型接口

`schema.OutputParser[T]` 是所有输出解析器的核心接口，定义于 `schema/output_parsers.go:6`：

```go
type OutputParser[T any] interface {
    Parse(text string) (T, error)
    ParseWithPrompt(text string, prompt llms.PromptValue) (T, error)
    GetFormatInstructions() string
    Type() string
}
```

### 方法详解

| 方法 | 行号 | 说明 |
|------|------|------|
| `Parse` | `schema/output_parsers.go:8` | 解析 LLM 的原始文本输出，返回类型 T |
| `ParseWithPrompt` | `schema/output_parsers.go:10` | 解析输出时可访问原始 Prompt，用于错误恢复 |
| `GetFormatInstructions` | `schema/output_parsers.go:12` | 返回格式说明字符串，可注入到 Prompt 中指导 LLM 按指定格式输出 |
| `Type` | `schema/output_parsers.go:14` | 返回解析器类型标识字符串 |

### Go 泛型的优势

`OutputParser[T any]` 使用 Go 1.18+ 的泛型特性，相比 `interface{}` 有以下优势：

1. **类型安全**：编译时确定返回类型，无需运行时类型断言
2. **IDE 支持**：自动补全和类型检查
3. **文档化**：泛型参数本身就是类型文档

例如 `CommaSeparatedList` 的声明（`outputparser/comma_seperated_list.go:20`）：

```go
var _ schema.OutputParser[[]string] = CommaSeparatedList{}
```

明确表示 `Parse` 返回 `[]string`，而非模糊的 `any`。

> 注意：由于 Go 泛型的限制，多数实现使用 `OutputParser[any]` 以满足接口约束。`CommaSeparatedList` 是少数使用具体泛型类型的实现。

---

## 2. StringOutputParser 纯文本解析

`outputparser/simple.go:11` 提供了最简单的解析器：

```go
type Simple struct{}

func (p Simple) Parse(text string) (any, error) {
    return strings.TrimSpace(text), nil
}
```

### 行为

- `Parse`：仅去除首尾空白字符
- `GetFormatInstructions`：返回空字符串（无格式要求）
- `Type`：返回 `"simple_parser"`

### 使用场景

作为 `LLMChain` 的默认解析器（`chains/llm.go:40`），适用于不需要结构化输出的场景。

```go
chain := chains.NewLLMChain(llm, prompt)
// chain.OutputParser 默认为 outputparser.NewSimple()
```

---

## 3. JSONOutputParser JSON 解析

langchaingo 提供了两种 JSON 解析器：`Structured` 和 `Defined`。

### 3.1 Structured 结构化解析

`outputparser/structured.go:45` 解析 JSON 格式的键值对：

```go
type Structured struct {
    ResponseSchemas []ResponseSchema
}

type ResponseSchema struct {
    Name        string  // 字段名
    Description string  // 字段描述
}
```

#### Parse 工作流程（`outputparser/structured.go:63`）

1. 去除 `` ```json `` 和 `` ``` `` 标记
2. `json.Unmarshal` 解析为 `map[string]string`
3. 验证所有 `ResponseSchemas` 中的字段都存在
4. 缺少字段时返回 `ParseError`

#### GetFormatInstructions（`:112`）

生成格式说明，指导 LLM 按指定格式输出：

```
The output should be a markdown code snippet formatted in the following schema:
```json
{
    "name": string // 名字描述
    "age": string // 年龄描述
}
```
```

#### 使用示例

```go
parser := outputparser.NewStructured([]outputparser.ResponseSchema{
    {Name: "name", Description: "人物姓名"},
    {Name: "age", Description: "人物年龄"},
})

// 获取格式说明，注入到 Prompt 中
instructions := parser.GetFormatInstructions()

// 解析 LLM 输出
result, err := parser.Parse(`\`\`\`json
{"name": "张三", "age": "25"}
\`\`\``)
// result = map[string]string{"name": "张三", "age": "25"}
```

#### ParseError 错误类型

`outputparser/structured.go:13` 定义了解析错误：

```go
type ParseError struct {
    Text   string  // 原始文本
    Reason string  // 失败原因
}
```

常见错误原因：
- 输出中没有 `` ```json `` 标记
- 输出中没有结束的 `` ``` `` 标记
- 缺少必要的字段

### 3.2 Defined 泛型结构体解析

`outputparser/defined.go:17` 使用 Go 泛型将 LLM 输出直接解析为 Go 结构体：

```go
type Defined[T any] struct {
    schema string
}
```

#### NewDefined 创建（`:26`）

接受一个结构体作为参数，自动生成 TypeScript 风格的接口描述：

```go
type Person struct {
    Name string `json:"name" describe:"人物姓名"`
    Age  int    `json:"age" describe:"人物年龄"`
}

parser, _ := outputparser.NewDefined(Person{})

// GetFormatInstructions 生成：
// Your output should be in JSON, structured according to this schema:
// ```json
// interface _Root {
//     name: string; // 人物姓名
//     age: int; // 人物年龄
// }
// ```
```

#### Parse 工作流程（`:61`）

1. 验证输出以 `` ```json `` 开头、`` ``` `` 结尾
2. 去除标记后 `json.Unmarshal` 到目标类型 `T`
3. 返回强类型的 Go 结构体

```go
result, err := parser.Parse(`\`\`\`json
{"name": "张三", "age": 25}
\`\`\``)
// result 的类型为 Person
```

#### 结构体标签

- `json:"field_name"`：指定 JSON 字段名
- `describe:"description"`：为 LLM 提供字段说明

嵌套结构体和数组类型也被支持，`marshalStruct`（`:89`）递归生成接口描述。

### 3.3 其他解析器

#### RegexParser 正则解析

`outputparser/regex_parser.go:12` 使用正则表达式提取命名捕获组：

```go
type RegexParser struct {
    Expression *regexp.Regexp
    OutputKeys []string
}

parser := outputparser.NewRegexParser(`action:\s*(?P<action>\w+).*input:\s*(?P<input>.+)`)
result, _ := parser.Parse("action: search input: 天气预报")
// result = map[string]string{"action": "search", "input": "天气预报"}
```

#### RegexDict 字典正则解析

`outputparser/regex_dict.go:12` 为每个输出键指定独立的正则模式：

```go
type RegexDict struct {
    OutputKeyToFormat map[string]string
    NoUpdateValue     string
}

parser := outputparser.NewRegexDict(
    map[string]string{
        "action": "Action",
        "input":  "Action Input",
    },
    "N/A",
)
```

使用模式 `(?:key):\s?(?P<value>(?:[^.'\n']*)\.?)` 匹配每个键值对。

#### CommaSeparatedList 逗号分隔列表

`outputparser/comma_seperated_list.go:12` 解析逗号分隔的列表：

```go
type CommaSeparatedList struct{}

parser := outputparser.NewCommaSeparatedList()
result, _ := parser.Parse("foo, bar, baz")
// result = []string{"foo", "bar", "baz"}
```

`GetFormatInstructions`（`:23`）返回：`Your response should be a list of comma separated values, eg: \`foo, bar, baz\``

#### BooleanParser 布尔解析

`outputparser/boolean_parser.go:13` 解析布尔值：

```go
type BooleanParser struct {
    TrueStrings  []string  // 默认 ["YES", "TRUE"]
    FalseStrings []string  // 默认 ["NO", "FALSE"]
}

parser := outputparser.NewBooleanParser()
result, _ := parser.Parse("yes")
// result = true
```

输入先经过 `normalize`（`:51`）处理：去除空白和引号，转为大写。

---

## 4. CombiningOutputParser 组合解析

`outputparser/combining.go:12` 将多个解析器组合为一个：

```go
type Combining struct {
    Parsers []schema.OutputParser[any]
}
```

### 工作原理

1. **GetFormatInstructions**（`:31`）：合并所有解析器的格式说明
2. **Parse**（`:87`）：
   - 将文本按双换行 `\n\n` 分割为多个块
   - 每个块分别用对应的解析器解析
   - 合并所有解析结果到一个 `map[string]any`

### 使用示例

```go
parser1 := outputparser.NewStructured([]outputparser.ResponseSchema{
    {Name: "sentiment", Description: "情感倾向"},
})
parser2 := outputparser.NewStructured([]outputparser.ResponseSchema{
    {Name: "topic", Description: "主题"},
})

combining := outputparser.NewCombining([]schema.OutputParser[any]{parser1, parser2})

result, _ := combining.Parse(`\`\`\`json
{"sentiment": "正面"}
\`\`\`

\`\`\`json
{"topic": "技术"}
\`\`\``)
// result = map[string]any{"sentiment": "正面", "topic": "技术"}
```

### 约束

- 至少需要 2 个解析器（`:47`）
- 文本块数必须与解析器数匹配（`:54`）
- 每个子解析器必须返回 `map[string]string`（`:70`）

---

## 5. 泛型 vs interface{} 对比

### 当前实现的泛型使用

| 解析器 | 泛型类型 | 说明 |
|--------|----------|------|
| `Simple` | `OutputParser[any]` | 返回 trimmed 字符串 |
| `Structured` | `OutputParser[any]` | 返回 `map[string]string` |
| `Defined[T]` | `OutputParser[T]` | 真正的泛型，返回强类型 T |
| `Combining` | `OutputParser[any]` | 返回 `map[string]any` |
| `RegexParser` | `OutputParser[any]` | 返回 `map[string]string` |
| `RegexDict` | `OutputParser[any]` | 返回 `map[string]string` |
| `CommaSeparatedList` | `OutputParser[[]string]` | 返回字符串切片 |
| `BooleanParser` | `OutputParser[any]` | 返回 bool |

### 泛型的优势场景

`Defined[T]` 是泛型优势的最佳体现：

```go
// 不使用泛型 - 需要手动类型断言
result, _ := structuredParser.Parse(output)
name := result.(map[string]string)["name"]  // 运行时可能 panic

// 使用泛型 - 编译时类型安全
var parser outputparser.Defined[Person]
result, _ := parser.Parse(output)
fmt.Println(result.Name)  // 直接访问字段，编译时检查
```

### interface{} 的局限

由于 `LLMChain.OutputParser` 字段类型为 `schema.OutputParser[any]`（`chains/llm.go:21`），在 Chain 中使用具体泛型类型的解析器时需要适配。这是 Go 泛型与接口系统交互的固有局限。

### 选择建议

| 场景 | 推荐解析器 | 理由 |
|------|------------|------|
| 纯文本输出 | `Simple` | 无需结构化 |
| 简单键值对 | `Structured` | 灵活，无需定义结构体 |
| 复杂嵌套结构 | `Defined[T]` | 类型安全，嵌套支持 |
| 提取特定模式 | `RegexParser` | 正则表达式精确匹配 |
| 列表输出 | `CommaSeparatedList` | 简单的逗号分隔 |
| 是/否判断 | `BooleanParser` | 布尔值提取 |
| 多种格式混合 | `Combining` | 组合多个解析器 |
