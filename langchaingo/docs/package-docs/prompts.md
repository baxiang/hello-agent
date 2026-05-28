# Prompt 模板详解

LangChainGo 的 prompts 包提供了灵活的模板系统，支持多种模板语法和消息类型，用于构建结构化的 LLM 输入。

---

## 1. FormatPrompter 接口

`FormatPrompter` 是所有模板的核心接口，定义于 `prompts/prompts.go:18`：

```go
type FormatPrompter interface {
    FormatPrompt(values map[string]any) (llms.PromptValue, error)
    GetInputVariables() []string
}
```

### 辅助接口

`prompts/prompts.go` 还定义了两个辅助接口：

```go
// Formatter 将值映射格式化为字符串（prompts/prompts.go:6）
type Formatter interface {
    Format(values map[string]any) (string, error)
}

// MessageFormatter 将值映射格式化为消息列表（prompts/prompts.go:12）
type MessageFormatter interface {
    FormatMessages(values map[string]any) ([]llms.ChatMessage, error)
    GetInputVariables() []string
}
```

### PromptValue 类型

模板渲染后返回 `llms.PromptValue` 接口，有两个实现：

1. **StringPromptValue**（`prompts/string_prompt.go:8`）：纯文本提示值
   ```go
   type StringPromptValue string
   ```
   - `String()` 返回原始字符串
   - `Messages()` 将字符串包装为 `HumanChatMessage` 返回

2. **ChatPromptValue**（`prompts/chat_prompt.go:12`）：聊天消息列表提示值
   ```go
   type ChatPromptValue []llms.ChatMessage
   ```
   - `String()` 将消息列表格式化为字符串
   - `Messages()` 直接返回消息列表

---

## 2. PromptTemplate

`PromptTemplate` 是最基础的模板实现，用于单文本提示。定义于 `prompts/prompt_template.go:30`：

```go
type PromptTemplate struct {
    Template        string           // 模板字符串
    InputVariables  []string        // 期望的输入变量列表
    TemplateFormat  TemplateFormat  // 模板语法格式
    OutputParser    schema.OutputParser[any]  // 输出解析器
    PartialVariables map[string]any // 预填充的变量
}
```

### 模板语法格式

定义于 `prompts/templates.go:53`：

```go
type TemplateFormat string

const (
    TemplateFormatGoTemplate TemplateFormat = "go-template"  // Go 模板语法（默认，推荐）
    TemplateFormatJinja2     TemplateFormat = "jinja2"       // Jinja2 风格语法
    TemplateFormatFString    TemplateFormat = "f-string"     // Python f-string 风格
)
```

### 创建与使用

推荐使用 `NewPromptTemplate`（`prompts/prompt_template.go:53`），默认使用 Go 模板语法：

```go
template := prompts.NewPromptTemplate(
    "请用{{.style}}风格总结以下内容：{{.content}}",
    []string{"content", "style"},
)

result, err := template.Format(map[string]any{
    "content": "LangChainGo 是一个 Go 语言的 LLM 应用框架",
    "style":   "简洁",
})
// 输出: "请用简洁风格总结以下内容：LangChainGo 是一个 Go 语言的 LLM 应用框架"
```

### Format 与 FormatPrompt

`PromptTemplate` 同时实现了 `Formatter` 和 `FormatPrompter`：

- `Format`（`prompts/prompt_template.go:67`）：返回格式化后的字符串
- `FormatPrompt`（`prompts/prompt_template.go:77`）：返回 `StringPromptValue`，可直接传给 LLM

### PartialVariables 预填充

`PartialVariables`（`prompts/prompt_template.go:47`）允许预填充常用值，支持静态值和动态函数：

```go
template := prompts.PromptTemplate{
    Template:       "当前时间：{{.time}}，问题：{{.question}}",
    InputVariables: []string{"question"},
    TemplateFormat: prompts.TemplateFormatGoTemplate,
    PartialVariables: map[string]any{
        "time": func() string { return time.Now().Format("15:04:05") },
    },
}
```

`resolvePartialValues`（`prompts/prompt_template.go:94`）在渲染时解析 PartialVariables，支持 `string`、`int`、`float64`、`bool` 以及对应的函数类型。

### 模板渲染

核心渲染函数定义于 `prompts/templates.go:151`：

```go
func RenderTemplate(tmpl string, tmplFormat TemplateFormat, values map[string]any, opts ...RenderOption) (string, error)
```

- Go 模板：使用 `text/template` + sprig 函数库（`prompts/templates.go:78`）
- Jinja2：支持 include/extends 等高级特性
- F-string：Python 风格变量替换

安全选项 `WithSanitization()`（`prompts/render_options.go:15`）可启用 HTML 转义防止 XSS 攻击。

---

## 3. ChatPromptTemplate

`ChatPromptTemplate` 用于构建多轮对话模板。定义于 `prompts/chat_prompt_template.go:6`：

```go
type ChatPromptTemplate struct {
    Messages        []MessageFormatter  // 消息格式化器列表
    PartialVariables map[string]any     // 预填充变量
}
```

### 创建与使用

```go
chatPrompt := prompts.NewChatPromptTemplate([]prompts.MessageFormatter{
    prompts.NewSystemMessagePromptTemplate(
        "你是一个{{.role}}专家", []string{"role"},
    ),
    prompts.MessagesPlaceholder{VariableName: "history"},
    prompts.NewHumanMessagePromptTemplate(
        "{{.question}}", []string{"question"},
    ),
})

promptValue, err := chatPrompt.FormatPrompt(map[string]any{
    "role":     "Go 语言",
    "history":  []llms.ChatMessage{...},
    "question": "如何使用 goroutine？",
})
```

### 工作原理

1. **FormatPrompt**（`prompts/chat_prompt_template.go:23`）：
   - 先解析 `PartialVariables`
   - 遍历所有 `MessageFormatter`，调用各自的 `FormatMessages`
   - 将所有消息合并为 `ChatPromptValue` 返回

2. **GetInputVariables**（`prompts/chat_prompt_template.go:58`）：
   - 收集所有子模板的输入变量并去重

3. **Format**（`prompts/chat_prompt_template.go:43`）：先调用 `FormatPrompt`，再调用 `String()` 返回字符串形式

---

## 4. MessagePromptTemplate

`MessagePromptTemplate` 是单条消息的模板，定义于 `prompts/message_prompt_template.go`。共有四种类型：

### 4.1 SystemMessagePromptTemplate（`prompts/message_prompt_template.go:10`）

```go
type SystemMessagePromptTemplate struct {
    Prompt PromptTemplate
}
```

格式化后生成 `llms.SystemChatMessage`：

```go
systemMsg := prompts.NewSystemMessagePromptTemplate(
    "你是一个{{.domain}}领域的助手", []string{"domain"},
)
```

### 4.2 HumanMessagePromptTemplate（`prompts/message_prompt_template.go:66`）

```go
type HumanMessagePromptTemplate struct {
    Prompt PromptTemplate
}
```

格式化后生成 `llms.HumanChatMessage`：

```go
humanMsg := prompts.NewHumanMessagePromptTemplate(
    "{{.input}}", []string{"input"},
)
```

### 4.3 AIMessagePromptTemplate（`prompts/message_prompt_template.go:38`）

```go
type AIMessagePromptTemplate struct {
    Prompt PromptTemplate
}
```

格式化后生成 `llms.AIChatMessage`，用于预设 AI 的回复。

### 4.4 GenericMessagePromptTemplate（`prompts/message_prompt_template.go:94`）

```go
type GenericMessagePromptTemplate struct {
    Prompt PromptTemplate
    Role   string
}
```

格式化后生成 `llms.GenericChatMessage`，可通过 `Role` 指定任意角色。

### 4.5 MessagesPlaceholder（`prompts/message_prompt_template.go:123`）

```go
type MessagesPlaceholder struct {
    VariableName string
}
```

占位符，用于在模板中插入动态的消息列表（如对话历史）：

```go
placeholder := prompts.MessagesPlaceholder{VariableName: "chat_history"}
```

`FormatMessages`（`prompts/message_prompt_template.go:128`）从 values 中按 `VariableName` 提取 `[]llms.ChatMessage`。

---

## 5. FewShotPromptTemplate

`FewShotPromptTemplate` 用于构建包含示例的提示模板。定义于 `prompts/few_shot.go:20`：

```go
type FewShotPrompt struct {
    Examples         []map[string]string  // 示例列表
    ExampleSelector  ExampleSelector      // 动态示例选择器
    ExamplePrompt    PromptTemplate       // 单个示例的格式化模板
    Prefix           string               // 示例前的提示文本
    Suffix           string               // 示例后的提示文本
    InputVariables   []string             // 输入变量
    PartialVariables map[string]any       // 预填充变量
    ExampleSeparator string               // 示例间的分隔符
    TemplateFormat   TemplateFormat       // 模板格式
    ValidateTemplate bool                 // 是否验证模板
}
```

### 创建与使用

```go
examplePrompt := prompts.NewPromptTemplate(
    "问题：{{.question}}\n答案：{{.answer}}",
    []string{"question", "answer"},
)

fewShotPrompt, err := prompts.NewFewShotPrompt(
    examplePrompt,
    []map[string]string{
        {"question": "2+2等于几？", "answer": "4"},
        {"question": "3*3等于几？", "answer": "9"},
    },
    nil,                       // ExampleSelector
    "请根据示例回答以下问题：",  // Prefix
    "问题：{{.input}}\n答案：", // Suffix
    []string{"input"},         // InputVariables
    nil,                       // PartialVariables
    "\n\n",                  // ExampleSeparator
    prompts.TemplateFormatGoTemplate,
    true,                      // ValidateTemplate
)
```

### 工作原理

1. **NewFewShotPrompt**（`prompts/few_shot.go:46`）：验证示例配置并创建模板
2. **Format**（`prompts/few_shot.go:103`）：
   - 解析 `PartialVariables`
   - 获取示例（静态 `Examples` 或动态 `ExampleSelector`）
   - 用 `ExamplePrompt` 格式化每个示例
   - 调用 `AssemblePieces` 组装 Prefix + 示例 + Suffix
3. **AssemblePieces**（`prompts/few_shot.go:154`）：用 `ExampleSeparator` 连接各部分

### ExampleSelector 接口

定义于 `prompts/example_selector.go:5`：

```go
type ExampleSelector interface {
    AddExample(example map[string]string) string
    SelectExamples(inputVariables map[string]string) []map[string]string
}
```

用于根据输入动态选择最相关的示例，而非使用全部示例。

### 错误处理

| 错误 | 行号 | 触发条件 |
|------|------|----------|
| `ErrNoExample` | `prompts/few_shot.go:13` | 未提供 Examples 和 ExampleSelector |
| `ErrExamplesAndExampleSelectorProvided` | `prompts/few_shot.go:15` | 同时提供了 Examples 和 ExampleSelector |

### 完整聊天模板示例

```go
package main

import (
    "fmt"
    "github.com/tmc/langchaingo/prompts"
)

func main() {
    chatPrompt := prompts.NewChatPromptTemplate([]prompts.MessageFormatter{
        prompts.NewSystemMessagePromptTemplate(
            "你是一个{{.domain}}专家，请用中文回答", []string{"domain"},
        ),
        prompts.MessagesPlaceholder{VariableName: "history"},
        prompts.NewHumanMessagePromptTemplate(
            "{{.question}}", []string{"question"},
        ),
    })

    promptValue, _ := chatPrompt.FormatPrompt(map[string]any{
        "domain":   "Go 语言",
        "history":  []interface{}{},
        "question": "goroutine 和 channel 的关系是什么？",
    })

    fmt.Println(promptValue.String())
}
```
