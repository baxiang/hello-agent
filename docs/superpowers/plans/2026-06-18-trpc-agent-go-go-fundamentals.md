# tRPC-Agent-Go「Go 前置知识」模块 — 实施计划

> **For agentic workers:** 本计划用并行 agent 执行文档写作。每个任务是独立 subagent dispatch，产出是 1-2 篇 .md 文章 + 侧边栏接入。验证靠 `vitepress build` + 链接检查。

**Goal:** 在 `docs/trpc-agent-go/go-fundamentals/` 创建 9 篇新文章（Go 模式 5 + Agent 概念 4），侧边栏新增「Go 前置知识」分组（含 10 条目，第 6 条引用 `/go-iterators/`）。

**Architecture:** 每篇文章遵循统一 5 节结构（开篇 quote → 核心概念 → 在 trpc-agent-go 里 → 常见陷阱 → 小结）。分 3 批实施，每批一个独立 commit。每批完成后 `vitepress build` 验证。

**Tech Stack:** Markdown / VitePress / 并行 subagent

**Spec:** `docs/superpowers/specs/2026-06-18-trpc-agent-go-go-fundamentals-design.md`

---

## 通用 Agent 指令模板

每个 agent 收到统一结构：
1. **Exemplar**：先读 `docs/adk-go/go-fundamentals/04-genai-content.md` 看 ADK-Go 同类文章风格
2. **源码引用**：每篇「在 trpc-agent-go 里」节必须引用真实源码（路径 + 行号），用反引号包代码块
3. **目标长度**：150-250 行
4. **禁止**：写 Go 基础语法（变量/控制流）；写 trpc-agent-go 实操（那是示例教程的职责）；触碰非目标文件；提交 git
5. **统一结构**：每篇严格按 5 节：开篇 quote → 核心概念（含最小可运行 Go/伪代码）→ 在 trpc-agent-go 里 → 常见陷阱 → 小结+延伸
6. **源码位置**：`trpc-agent-go/` 目录（被 hello-agent gitignore 的子仓库，但可读）

---

## 批次 1：Go 模式核心 3 篇（试点，建立模板）

### Task 1: 创建 01-concurrency-channel.md

**Files:**
- Read: `trpc-agent-go/agent/agent.go:62-75`（Agent 接口签名）、`trpc-agent-go/event/event.go:96-130`（Event 结构）
- Read Exemplar: `docs/adk-go/go-fundamentals/04-genai-content.md`
- Create: `docs/trpc-agent-go/go-fundamentals/01-concurrency-channel.md`

**文章要点：**

开篇 quote：trpc-agent-go 把 `<-chan *event.Event` 作为 Agent 通信标准方式，不懂 channel 就读不懂框架任何示例。

### 1. 核心概念（最小可运行代码）

```go
// 最小 channel 事件流示例（不依赖 trpc-agent-go）
func producer(ctx context.Context) <-chan string {
    ch := make(chan string)
    go func() {
        defer close(ch) // 发送端关闭 channel
        for i := 0; i < 3; i++ {
            select {
            case <-ctx.Done():
                return // ctx 取消，提前退出，避免 goroutine 泄漏
            case ch <- fmt.Sprintf("event-%d", i):
            }
        }
    }()
    return ch
}

// 消费端必须 drain 到 close
func main() {
    ctx, cancel := context.WithCancel(context.Background())
    defer cancel()
    for evt := range producer(ctx) {
        fmt.Println(evt)
    }
}
```

要讲：goroutine 启动、channel 创建、`defer close(ch)` 为什么必须、`for range chan` 自动在 close 后退出、`select` + `ctx.Done()` 防泄漏。

### 2. 在 trpc-agent-go 里

引用 `agent/agent.go:62-66`：
```go
type Agent interface {
    Run(ctx context.Context, invocation *Invocation) (
        <-chan *event.Event, error,
    )
    // ...
}
```
讲：`Run` 返回 `<-chan *event.Event`，调用方 `for event := range eventChan` 消费。指出示例 `examples/runner/main.go` 里的 drain 写法。引用 `event/event.go:96` 的 `Event` 结构（含 `*model.Response`、`RequestID` 等）。

### 3. 常见陷阱
- ❌ 提前 break 而不 drain → 写端阻塞 goroutine 泄漏
- ✅ 用 `ctx cancel` + drain 到 close
- ❌ 把 `make(chan T)` 无缓冲当队列用 → 死锁
- ✅ 无缓冲用于「同步握手」，缓冲用于「削峰」

### 4. 小结
- 链接到：trpc-agent-go examples/02-runner-executor、Go 官方 https://go.dev/blog/pipelines、`04-context-lifecycle.md`（下一篇）

---

### Task 2: 创建 03-functional-options.md

**Files:**
- Read: `trpc-agent-go/agent/llmagent/option.go:210-220`（Option 类型定义）、`:689-740`（WithModel/WithInstruction 等）
- Create: `docs/trpc-agent-go/go-fundamentals/03-functional-options.md`

**文章要点：**

开篇 quote：trpc-agent-go 所有构造函数都用 `NewXxx(name, opts ...Option)` + `WithXxx` 模式，不懂这个模式就看不懂任何 `llmagent.New`、`runner.NewRunner` 调用。

### 1. 核心概念

```go
// 函数选项模式最小实现
type Server struct {
    host string
    port int
    tls  bool
}
type Option func(*Server)

func WithPort(p int) Option      { return func(s *Server) { s.port = p } }
func WithTLS() Option             { return func(s *Server) { s.tls = true } }

func New(opts ...Option) *Server {
    s := &Server{host: "0.0.0.0", port: 80} // 默认值
    for _, opt := range opts { opt(s) }
    return s
}

// 调用方
s := New(WithPort(8443), WithTLS())
```

讲：为什么不用 Builder（链式 `.SetXxx` 失败用例）、为什么不用 config struct（顺序敏感/可空字段难处理）、函数选项的好处（顺序无关、组合友好、可扩展）。

### 2. 在 trpc-agent-go 里

引用 `agent/llmagent/option.go:210,689,727`：
```go
type Option func(*Options)
// ...
func WithModel(model model.Model) Option { /* ... */ }
func WithInstruction(instruction string) Option { /* ... */ }
```
给出真实调用：
```go
a := llmagent.New("assistant",
    llmagent.WithModel(llmModel),
    llmagent.WithInstruction("你是助手"),
    llmagent.WithGenerationConfig(model.GenerationConfig{Stream: true}),
)
```

### 3. 常见陷阱
- ❌ 自己 new Options 而不通过 New → 跳过默认值初始化
- ❌ 顺序依赖（WithModels 后用 WithModel 互相覆盖）—— 选项是按顺序叠加
- ✅ 写自定义 Agent 时也要暴露 Option 而非公开 struct 字段

### 4. 小结
- 链接到：trpc-agent-go examples/01-agent-basics/llmagent.md、Go 官方 Dave Cheney 的 Functional options 讲解

---

### Task 3: 创建 04-context-lifecycle.md

**Files:**
- Read: `trpc-agent-go/runner/runner.go`（Run 方法签名 + ctx 处理）、`trpc-agent-go/docs/mkdocs/zh/runner.md`（DetachedCancel、ManagedRunner 章节）
- Create: `docs/trpc-agent-go/go-fundamentals/04-context-lifecycle.md`

**文章要点：**

开篇 quote：trpc-agent-go Runner 的 ctx 取消会停止整轮 run，ManagedRunner.Cancel 能跨 goroutine 取消——不懂 Context 就用不好取消/超时/多租户隔离。

### 1. 核心概念

```go
ctx, cancel := context.WithCancel(context.Background())
defer cancel() // 习惯：拿到 cancel 立刻 defer

go func() {
    <-ctx.Done()
    fmt.Println("被取消:", ctx.Err()) // 输出 context.Canceled
}()

time.Sleep(100 * time.Millisecond)
cancel() // 通知所有派生 goroutine
time.Sleep(100 * time.Millisecond)
```

讲四大派生：`WithCancel`/`WithTimeout`/`WithDeadline`/`WithValue`，父子传播规则（父取消则所有子取消），`ctx.Err()` 区分 Canceled vs DeadlineExceeded。

### 2. 在 trpc-agent-go 里

引用 runner 签名：
```go
eventChan, err := r.Run(ctx, userID, sessionID, message, agent.WithRequestID(id))
```
讲三种取消场景：
- ctx 直接 cancel（命令行 Ctrl+C）
- `ManagedRunner.Cancel(requestID)` 跨 goroutine 取消
- `agent.WithDetachedCancel(true)` 让父 ctx 不影响 run（仅靠 MaxRunDuration 限超时）

### 3. 常见陷阱
- ❌ 启动 goroutine 不传 ctx → 取消信号收不到，goroutine 泄漏
- ❌ Runner.Run 拿到 eventChan 后 ctx 就 cancel，但不 drain → 写端阻塞
- ✅ ctx 用完立刻 cancel 释放资源（即使函数提前 return）
- ✅ ctx.Value 只传「跨 API 边界的请求级元数据」，不当参数传递

### 4. 小结
- 链接到：trpc-agent-go examples/02-runner-executor/cancelrun.md、Go blog context

---

### Task 4: 批次 1 验证 + 侧边栏接入 + commit

**Files:**
- Modify: `docs/.vitepress/config.ts`（在「示例教程」组之后新增「Go 前置知识」组，先放这 3 条）
- Test: `cd docs && npx vitepress build .`

**侧边栏新增（先放批次 1 的 3 条）：**

在 `'/trpc-agent-go/':` 块的「示例教程」items 数组结束后（找 `20 - 高级特性` 组之后），追加：

```typescript
{
  text: 'Go 前置知识',
  collapsed: true,
  items: [
    { text: '并发模型与 Channel 事件流', link: '/trpc-agent-go/go-fundamentals/01-concurrency-channel' },
    { text: '函数选项模式', link: '/trpc-agent-go/go-fundamentals/03-functional-options' },
    { text: 'Context 生命周期与取消', link: '/trpc-agent-go/go-fundamentals/04-context-lifecycle' },
  ]
},
```

**验证步骤：**
- [ ] `cd docs && npx vitepress build .` 通过，无 error
- [ ] 浏览器打开 `/trpc-agent-go/go-fundamentals/01-concurrency-channel` 可访问
- [ ] 侧边栏「Go 前置知识」分组可见，3 个条目
- [ ] 3 篇文章都遵循 5 节结构
- [ ] 每篇「在 trpc-agent-go 里」节都有真实源码引用（路径+行号）

**Commit：**
```bash
git add docs/trpc-agent-go/go-fundamentals/ docs/.vitepress/config.ts
git commit -m "docs(go-fundamentals): 批次1 新增 3 篇 Go 模式核心（并发/选项/Context）"
```

---

## 批次 2：Go 模式补充 2 篇 + 迭代器引用

### Task 5: 创建 02-interfaces-pluggable.md

**Files:**
- Read: `trpc-agent-go/agent/agent.go:62-80`（Agent 接口）、`trpc-agent-go/knowledge/embedder/embedder.go:44`、`trpc-agent-go/knowledge/vectorstore/vectorstore.go:22`（多接口示例）
- Create: `docs/trpc-agent-go/go-fundamentals/02-interfaces-pluggable.md`

**文章要点：**

开篇 quote：trpc-agent-go 的 Agent/Model/Tool/Session/Memory/Knowledge 全是接口——这是「可插拔」哲学的基础，接口理解错了就换不了后端。

### 1. 核心概念

```go
// 隐式实现
type Speaker interface { Speak() string }
type Dog struct{}
func (Dog) Speak() string { return "woof" } // Dog 自动实现 Speaker

// 小接口组合
type ReadWriter interface {
    Reader
    Writer
}
```

讲：隐式实现（无 implements 关键字）、接口即契约、小接口组合优于大接口、依赖注入（构造函数接收 interface 而非 struct）。

### 2. 在 trpc-agent-go 里

引用 `agent/agent.go:62`：
```go
type Agent interface {
    Run(ctx context.Context, invocation *Invocation) (<-chan *event.Event, error)
    Tools() []tool.Tool
    Info() Info
}
```
讲：LLMAgent/ChainAgent/GraphAgent 都实现这个接口，可互换。再引用 `knowledge/embedder/embedder.go:44` 的 `Embedder` 接口、`knowledge/vectorstore/vectorstore.go:22` 的 `VectorStore` 接口——同一抽象下可换 OpenAI/本地、pgvector/Milvus。

### 3. 常见陷阱
- ❌ new 具体类型而非接收 interface → 无法 mock 测试、无法换实现
- ❌ 把所有方法塞一个大接口（违反 ISP）→ 实现方被迫写空方法
- ✅ 接口定义在「消费方」包，不在「实现方」包（Go 风格）

### 4. 小结
- 链接到：examples/13-model-provider、examples/12-knowledge-rag、Go Proverbs "Interfaces"

---

### Task 6: 创建 05-generics-types.md

**Files:**
- Read: `trpc-agent-go/tool/function/function_tool.go:117`（`NewFunctionTool[I, O any]` 泛型签名）
- Create: `docs/trpc-agent-go/go-fundamentals/05-generics-types.md`

**文章要点：**

开篇 quote：trpc-agent-go 的 `NewFunctionTool[I, O any]` 用泛型让你写一个工具就自动生成 schema，不懂泛型就只能复制粘贴。

### 1. 核心概念

```go
// 泛型函数
func Map[T, U any](in []T, f func(T) U) []U {
    out := make([]U, len(in))
    for i, v := range in { out[i] = f(v) }
    return out
}

// 类型约束
type Number interface { int | int64 | float64 }
func Sum[T Number](nums []T) T { /* ... */ }

// 泛型类型
type Stack[T any] struct { items []T }
func (s *Stack[T]) Push(v T) { s.items = append(s.items, v) }
```

讲：类型参数 `[T any]`、约束（`any` / `comparable` / 自定义）、泛型函数 vs 泛型类型、什么时候该用泛型（重复同构代码）什么时候不该（YAGNI）。

### 2. 在 trpc-agent-go 里

引用 `tool/function/function_tool.go:117`：
```go
func NewFunctionTool[I, O any](fn func(context.Context, I) (O, error), opts ...Option) *FunctionTool[I, O]
```
讲：I（输入）O（输出）由泛型承载，框架通过 reflect 读 I 的结构体 tag 自动生成 JSON schema 给 LLM。给出真实调用：
```go
type CalculatorInput struct{ A, B float64 }
func calc(ctx context.Context, in CalculatorInput) (string, error) { /* ... */ }
tool := function.NewFunctionTool(calc, function.WithName("calculator"))
```
顺便讲框架大量用 `any`（如 `model.Message.Content any`）是「显式留扩展口」的约定。

### 3. 常见陷阱
- ❌ 为单一类型用泛型（过度抽象）
- ❌ 泛型方法不能在方法体里 switch 类型参数的底层类型（reflect 才行）
- ✅ Go 泛型不支持方法泛型（只有函数/类型），遇到方法泛型要改成顶层函数

### 4. 小结
- 链接到：examples/03-tool-system/tool-codeexec.md、Go 泛型教程

---

### Task 7: 批次 2 验证 + 侧边栏补条目 + commit

**Files:**
- Modify: `docs/.vitepress/config.ts`（在「Go 前置知识」组追加 02、05 条目，并新增第 6 条「迭代器」link 到 `/go-iterators/`）
- Test: `cd docs && npx vitepress build .`

**侧边栏追加（按编号排序插入，06 引用共享页）：**

「Go 前置知识」组 items 改为：
```typescript
items: [
    { text: '并发模型与 Channel 事件流', link: '/trpc-agent-go/go-fundamentals/01-concurrency-channel' },
    { text: '接口抽象与可插拔设计', link: '/trpc-agent-go/go-fundamentals/02-interfaces-pluggable' },
    { text: '函数选项模式', link: '/trpc-agent-go/go-fundamentals/03-functional-options' },
    { text: 'Context 生命周期与取消', link: '/trpc-agent-go/go-fundamentals/04-context-lifecycle' },
    { text: '泛型与类型安全', link: '/trpc-agent-go/go-fundamentals/05-generics-types' },
    { text: '迭代器', link: '/go-iterators/' },
],
```

**验证步骤：**
- [ ] `npx vitepress build` 通过
- [ ] 侧边栏「Go 前置知识」现含 6 条目（5 文件 + 1 引用）
- [ ] 点击「迭代器」跳转到 `/go-iterators/` 不 404

**Commit：**
```bash
git add docs/trpc-agent-go/go-fundamentals/ docs/.vitepress/config.ts
git commit -m "docs(go-fundamentals): 批次2 新增 2 篇 Go 模式（接口/泛型）+ 迭代器引用"
```

---

## 批次 3：Agent 领域概念 4 篇

### Task 8: 创建 07-llm-chat-completion.md

**Files:**
- Read: `trpc-agent-go/model/request.go:64`（Message 结构）、`:369`（GenerationConfig）
- Create: `docs/trpc-agent-go/go-fundamentals/07-llm-chat-completion.md`

**文章要点：**

开篇 quote：trpc-agent-go 的所有 Agent 本质都在驱动 LLM Chat Completion，不懂 token/temperature/角色，调任何 `llmagent.New` 都像念咒。

### 1. 核心概念（领域概念，非 Go 代码）

讲清这些概念（用表格 + 伪代码，不依赖具体 Provider）：
- **token**：LLM 计费/上下文的最小单位，≈ 0.75 个英文单词
- **角色（role）**：system（人设/规则）、user（用户输入）、assistant（模型回复）、tool（工具结果）
- **Chat Completion 请求结构**（伪 JSON）：`messages: [{role, content}], temperature, max_tokens, stream`
- **GenerationConfig 关键参数**：
  - `temperature`：0=确定，1+=发散
  - `max_tokens`：回复上限
  - `top_p`：核采样
  - `stream`：是否流式

### 2. 在 trpc-agent-go 里

引用 `model/request.go:64` 的 `Message struct`（Role/Content/ToolCalls 字段）、`:369` 的 `GenerationConfig`：
```go
genConfig := model.GenerationConfig{
    MaxTokens:   intPtr(2000),
    Temperature: floatPtr(0.7),
    Stream:      true,
}
a := llmagent.New("assistant",
    llmagent.WithModel(llmModel),
    llmagent.WithGenerationConfig(genConfig),
)
```

### 3. 常见陷阱
- ❌ temperature 调到 2 期望"更有创意" → 输出乱码
- ❌ system message 放在 user 之后 → 被忽略
- ✅ 长任务设 `max_tokens` 防止成本失控
- ✅ 工具调用场景 temperature 建议调低（0-0.3）

### 4. 小结
- 链接到：examples/14-model-provider、OpenAI API 文档

---

### Task 9: 创建 08-tool-calling.md

**Files:**
- Read: `trpc-agent-go/model/message_compare_test.go:52`（ToolCall 结构示例）、`trpc-agent-go/tool/function/function_tool.go:117`
- Create: `docs/trpc-agent-go/go-fundamentals/08-tool-calling.md`

**文章要点：**

开篇 quote：trpc-agent-go 的招牌能力是 Tool Calling——让 LLM 自主决定调哪个工具。不懂 tool_call → tool_response 循环，就看不懂任何带工具的示例。

### 1. 核心概念

讲清机制（用序列图思路，文字描述）：
- 模型不能"执行"，只能"决定要调什么"
- 一次工具调用的完整循环：
  1. 用户问 "北京天气"
  2. 模型回复 `assistant` 消息，带 `tool_calls: [{name: "get_weather", args: {city: "北京"}}]`
  3. 框架执行 `get_weather("北京")`，得到结果
  4. 把结果作为 `role: tool` 消息发回模型
  5. 模型基于工具结果生成最终自然语言回复
- 工具 schema：JSON Schema 形式描述参数，让模型知道"这个工具叫什么、要什么参数"

### 2. 在 trpc-agent-go 里

引用 ToolCall 结构（来自 test 文件示例）：
```go
Message{Role: RoleAssistant, ToolCalls: []ToolCall{{
    Type: "function",
    ID:   "t1",
    Function: FunctionDefinitionParam{Name: "echo", Arguments: args},
}}}
```
讲：`NewFunctionTool[I, O any]` 自动生成 schema，框架在 Agent 循环里检测 `ToolCalls` 自动执行并回填 `role: tool` 消息。

### 3. 常见陷阱
- ❌ 工具名含中文或特殊字符 → 模型识别率下降
- ❌ 参数 schema 模糊（缺 description）→ 模型乱填
- ❌ 工具返回超长文本塞回模型 → 上下文爆炸
- ✅ 工具命名用 snake_case 动词短语，description 写清"什么时候用"

### 4. 小结
- 链接到：examples/03-tool-system、examples/04-mcp-tools

---

### Task 10: 创建 09-streaming-sse.md

**Files:**
- Read: `trpc-agent-go/event/event.go:96-130`（Event 结构）、`:375`（IsRunnerCompletion）、`trpc-agent-go/model/request.go`（Stream 字段、partial/delta）
- Create: `docs/trpc-agent-go/go-fundamentals/09-streaming-sse.md`

**文章要点：**

开篇 quote：trpc-agent-go 全程用 channel 传事件、默认流式——这背后是 LLM 流式响应 + SSE 协议。不懂 partial/Done/delta，写出来的代码会丢字符或卡死。

### 1. 核心概念

讲清：
- **流式 vs 批量**：批量等 30 秒一次性返回；流式每生成一个 token 就推一个 chunk
- **SSE 协议**：Server-Sent Events，HTTP 长连接 + `data: ...\n\n` 帧格式
- **chunk/delta**：每个 chunk 携带本次增量（delta），而非完整内容
- **partial vs final**：partial 事件 `Done=false`（增量），final 事件 `Done=true`（完整消息）

### 2. 在 trpc-agent-go 里

引用 `event/event.go:96`：
```go
type Event struct {
    *model.Response  // 含 Choices[].Delta（增量）/ Choices[].Message（完整）
    // ...
}
```
给出 drain 写法：
```go
for event := range eventChan {
    if len(event.Response.Choices) > 0 {
        fmt.Print(event.Response.Choices[0].Delta.Content) // 逐 token 打印
    }
    if event.IsRunnerCompletion() { break } // 整轮结束
}
```
讲：`Stream: true` 在 GenerationConfig 开启流式，框架把 chunk 转 partial event，最后发 final + runner.completion。

### 3. 常见陷阱
- ❌ 只读 `Message.Content`（final 才有）漏掉流式增量 → 用户看不到实时输出
- ❌ 不处理 `IsRunnerCompletion` → 多 Agent 场景提前退出
- ❌ HTTP handler 里直接 return 不 drain → 写端 goroutine 阻塞（详见 01 篇）

### 4. 小结
- 链接到：examples/02-runner-executor/runner.md、examples/11-agui-protocol、SSE MDN

---

### Task 11: 创建 10-rag-embedding.md

**Files:**
- Read: `trpc-agent-go/knowledge/embedder/embedder.go:44`、`trpc-agent-go/knowledge/vectorstore/vectorstore.go:22`
- Create: `docs/trpc-agent-go/go-fundamentals/10-rag-embedding.md`

**文章要点：**

开篇 quote：trpc-agent-go 的 Knowledge 模块是 RAG 框架。不懂 Embedding/向量库/重排，example 里的「检索增强」就是黑盒。

### 1. 核心概念

讲清完整 RAG 链路（文字流程图）：
1. **入库**：文档 → chunking（切片）→ Embedding（向量化）→ 存入 VectorStore
2. **查询**：用户问题 → Embedding → 在 VectorStore 做相似度检索 →（可选）Rerank 重排 → 取 top-k → 作为 context 喂给 LLM
3. 关键概念：
   - **Embedding**：把文本映射成高维向量（如 1536 维），语义相近的文本向量也近
   - **相似度**：余弦相似度 / 点积，衡量两向量"含义有多近"
   - **VectorStore**：专门存向量、做相似度检索的库（pgvector/Milvus/Qdrant）
   - **chunking**：把长文档切成小片，策略影响检索质量（fixed/recursive）
   - **Reranker**：cross-encoder 对召回结果二次精排，提升准确率

### 2. 在 trpc-agent-go 里

引用接口：
```go
// embedder/embedder.go:44
type Embedder interface { /* Embed / EmbedQuery 方法 */ }
// vectorstore/vectorstore.go:22
type VectorStore interface { /* AddDocuments / Search 方法 */ }
```
讲：trpc-agent-go 把整条 RAG 链路抽象成可插拔接口——Embedder 可换 OpenAI/本地、VectorStore 可换 pgvector/Milvus，框架自动串起来。引用 `examples/13-knowledge-rag/basic` 的最小流程。

### 3. 常见陷阱
- ❌ chunk 切太大 → 检索召回不准，上下文浪费 token
- ❌ 不用 Rerank，纯靠向量相似度 → top-k 里混入无关项
- ❌ Embedding 模型和 LLM 混为一谈 → 它们是两个独立模型
- ✅ 元数据（metadata）过滤先于向量检索，缩小搜索范围

### 4. 小结
- 链接到：examples/13-knowledge-rag/knowledge-basic.md、OpenAI Embedding 文档

---

### Task 12: 批次 3 验证 + 侧边栏补全 + 最终 commit

**Files:**
- Modify: `docs/.vitepress/config.ts`（在「Go 前置知识」组追加 07-10 条目）
- Test: `cd docs && npx vitepress build .`

**侧边栏最终结构（10 条目）：**

「Go 前置知识」组 items 完整为：
```typescript
items: [
    { text: '并发模型与 Channel 事件流', link: '/trpc-agent-go/go-fundamentals/01-concurrency-channel' },
    { text: '接口抽象与可插拔设计', link: '/trpc-agent-go/go-fundamentals/02-interfaces-pluggable' },
    { text: '函数选项模式', link: '/trpc-agent-go/go-fundamentals/03-functional-options' },
    { text: 'Context 生命周期与取消', link: '/trpc-agent-go/go-fundamentals/04-context-lifecycle' },
    { text: '泛型与类型安全', link: '/trpc-agent-go/go-fundamentals/05-generics-types' },
    { text: '迭代器', link: '/go-iterators/' },
    { text: 'LLM 与 Chat Completion', link: '/trpc-agent-go/go-fundamentals/07-llm-chat-completion' },
    { text: 'Tool Calling 工作机制', link: '/trpc-agent-go/go-fundamentals/08-tool-calling' },
    { text: '流式响应、SSE 与事件', link: '/trpc-agent-go/go-fundamentals/09-streaming-sse' },
    { text: '向量检索与 RAG', link: '/trpc-agent-go/go-fundamentals/10-rag-embedding' },
],
```

**最终验证（对照 spec 验收标准）：**
- [ ] 9 篇 .md 在 `docs/trpc-agent-go/go-fundamentals/`
- [ ] 侧边栏「Go 前置知识」分组在「示例教程」之后，10 条目（9 文件 + 1 引用）
- [ ] `npx vitepress build` 通过
- [ ] 每篇遵循 5 节结构
- [ ] 每篇至少 1 个可运行示例
- [ ] 每篇「在 trpc-agent-go 里」节有真实源码引用
- [ ] 文章间交叉链接用相对路径

**Commit：**
```bash
git add docs/trpc-agent-go/go-fundamentals/ docs/.vitepress/config.ts
git commit -m "docs(go-fundamentals): 批次3 新增 4 篇 Agent 领域概念（LLM/Tool/流式/RAG），模块完结"
git push origin main
```

---

## 自审记录

**1. Spec 覆盖度**：
- ✅ Go 模式 5 篇 → Task 1/2/3/5/6
- ✅ Agent 概念 4 篇 → Task 8/9/10/11
- ✅ 迭代器引用（不新建文件）→ Task 7
- ✅ 侧边栏置于示例教程之后 → Task 4/7/12
- ✅ 分 3 批 → 批次 1（Task 1-4）、批次 2（Task 5-7）、批次 3（Task 8-12）
- ✅ 每篇 5 节结构 → 通用指令模板 + 每篇要点列出
- ✅ 验收标准 → Task 12 对照 spec 第 7 节

**2. 占位符扫描**：无 TBD/TODO/"add validation"。每篇的代码块、源码引用、章节标题都已具体化。

**3. 类型/路径一致性**：
- 文件路径统一 `docs/trpc-agent-go/go-fundamentals/NN-name.md` ✅
- 侧边栏 link 路径 `/trpc-agent-go/go-fundamentals/NN-name`（无 .md 后缀，VitePress 约定）✅
- 源码引用统一指向 `trpc-agent-go/` 子仓库 ✅
