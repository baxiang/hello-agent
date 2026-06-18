# 流式响应与 SSE — trpc-agent-go 的事件流来源

> trpc-agent-go 全程用 channel 传事件、默认流式——这背后是 LLM 流式响应 + SSE 协议。不懂 partial/Done/delta，写出来的代码会丢字符或卡死。

## 核心概念

LLM 生成文本时是「一个 token 一个 token」吐出来的，而非一次性憋出整段。trpc-agent-go 把这个特性原样暴露给上层，所以必须先吃透四组概念：

1. **流式 vs 批量（streaming vs batch）**：批量模式下 HTTP 请求会**阻塞等模型把整段答完**（动辄 10~30 秒）才返回一个完整 JSON；流式模式下连接保持打开，模型一边生成一边把已经产出的小片段**持续推送**过来，首字延迟可以从 20 秒压到几百毫秒。代价是消费端必须有能力「边收边拼」。
2. **SSE 协议（Server-Sent Events）**：基于 HTTP 长连接的服务端推送协议。响应头带 `Content-Type: text/event-stream`，正文以纯文本帧（frame）组织，每帧形如 `data: {...}\n\n`——两个换行是帧分隔符，`data:` 前缀是字段名。客户端用一条连接就能持续读到任意多帧，直到服务端主动关闭。它比 WebSocket 简单（单向、文本、基于 HTTP），是 OpenAI/Anthropic 等模型 API 流式响应的事实标准。
3. **chunk 与 delta**：每一帧 SSE 推过来的就是一个 **chunk**（数据块）。chunk 里的正文**不是完整内容**，而是一个 **delta**（增量）：比如模型正生成「Hello, world」，你会依次收到 `Hel` → `lo,` → ` world` 三个 delta，永远收不到一个含完整字符串的 chunk。消费端要自己累加。
4. **partial vs final**：trpc-agent-go 把流式过程中每个 chunk 包成 **partial 事件**（`Done=false`，表示「这只是片段，本轮还没结束」）；当模型整段生成完，框架再补一个 **final 事件**（`Done=true`），它的 payload 通常是完整拼好的 `Message`。**partial 用 `Delta`、final 用 `Message`**——读错字段就是丢字符的根因。

一句话总结：流式 = 多个 partial chunk（带 delta）+ 一个 final（带完整 message）；消费端要么逐帧打印 delta，要么耐心等到 final 一次性拿 message，**不能在 partial 上读 message**。

## 在 trpc-agent-go 里

### Event 结构：partial/final 都装在同一个壳里

channel 里流转的每个 `*event.Event` 既是 partial 又可能是 final，区别在嵌入字段。`event/event.go:96`：

```go
// event/event.go:96
type Event struct {
	*model.Response              // 嵌入 LLM 响应：Choices、Done、Object、Error 等
	RequestID           string
	InvocationID        string
	Author              string   // 事件作者（user / agent name）
	ID                  string
	Timestamp           time.Time
	Branch              string   // 多 agent 执行链路
	// ...
}
```

其中嵌入的 `*model.Response` 携带真正的内容。关键三处：`Choices[i].Delta`（流式增量）、`Choices[i].Message`（完整消息）、`Done`（`response.go:205`，本事件是否为最终事件）。`Choice` 结构见 `model/response.go:58-71`：

```go
// model/response.go:58
type Choice struct {
	Index        int       `json:"index"`
	Message      Message   `json:"message,omitempty"` // 完整消息（final 才有内容）
	Delta        Message   `json:"delta,omitempty"`   // 增量片段（partial 才有内容）
	FinishReason *string   `json:"finish_reason,omitempty"`
	// ...
}
```

### 开启流式：GenerationConfig.Stream

模型默认是不是流式由 `GenerationConfig.Stream` 控制，`model/request.go:380`：

```go
// model/request.go:369
type GenerationConfig struct {
	// ...
	Stream bool `json:"stream"` // line 380
	// ...
}
```

`examples/runner/main.go:108-112` 演示了如何打开：

```go
// examples/runner/main.go:108
genConfig := model.GenerationConfig{
	MaxTokens:   intPtr(2000),
	Temperature: floatPtr(0.7),
	Stream:      c.streaming, // true → 模型以 SSE 推送 chunk
}
```

`Stream: true` 后，provider 把上游 SSE 帧逐个翻译成 partial Event 发到 channel，最后追加一个 final Event（`Done=true`）和 runner 终止事件（`Object == "runner.completion"`）。

### drain 模式：逐 delta 打印

最典型的消费姿势（与 `examples/runner/main.go:182` 一致）：

```go
// examples/runner/main.go:182 简化
for evt := range eventChan {
	if evt.Error != nil {
		return evt.Error
	}
	if evt.Response == nil || len(evt.Response.Choices) == 0 {
		continue
	}
	fmt.Print(evt.Response.Choices[0].Delta.Content) // ← partial：逐 token 打印
	if evt.IsRunnerCompletion() {                    // ← 整轮跑完了
		break
	}
}
```

`examples/runner/main.go:269-274` 的 `extractContent` 把「流式读 Delta、非流式读 Message」的差异收敛到一处：

```go
// examples/runner/main.go:269
func (c *multiTurnChat) extractContent(choice model.Choice) string {
	if c.streaming {
		return choice.Delta.Content   // 流式：拿增量
	}
	return choice.Message.Content    // 批量：拿完整消息
}
```

### runner.completion：唯一可信的「整轮结束」信号

partial/final 描述的是**单个 LLM 调用**是否结束，但 trpc-agent-go 一次 `Runner.Run` 可能串了多轮 LLM 调用（工具调用后再调一次模型）甚至多个 agent。**唯一能确认整轮 Run 彻底结束**的是 `IsRunnerCompletion()`，`event/event.go:375-384`：

```go
// event/event.go:375
func (e *Event) IsRunnerCompletion() bool {
	if e == nil || e.Response == nil {
		return false
	}
	return e.Done && e.Object == model.ObjectTypeRunnerCompletion // "runner.completion"
}
```

注意它要求 `Done == true` **且** `Object == "runner.completion"`——单看 `Done` 不够，因为每轮 LLM 调用的 final 事件 `Done` 也是 true。

## 常见陷阱

### 陷阱 1：在 partial 事件上读 `Message.Content` → 丢字符

❌ 流式模式下每个 partial chunk 的内容**只写在 `Delta` 字段**，`Message.Content` 是空的。直接 `fmt.Println(evt.Response.Choices[0].Message.Content)` 会逐帧打印空串，最终一个字都看不到。

✅ 修复：流式时读 `Delta.Content` 累加/打印；只有 final 才能读 `Message.Content`。或者干脆学 `examples/runner/main.go:269` 用一个 `extractContent` 把分支收敛。

```go
// ❌ 错误：partial 上读 Message，全程打空串
for evt := range eventChan {
	fmt.Print(evt.Response.Choices[0].Message.Content)
}

// ✅ 正确：流式读 Delta
for evt := range eventChan {
	if len(evt.Response.Choices) > 0 {
		fmt.Print(evt.Response.Choices[0].Delta.Content)
	}
}
```

### 陷阱 2：用 `IsFinalResponse` 提前 break → 多 agent 场景漏收后续事件

❌ 单 agent 单轮场景下，命中 `IsFinalResponse()` 就 `break` 没问题——因为后面只有一个 runner.completion。但在**工具调用 / 多 agent 转交**场景，一次 Run 里会出现多个 final（每个 LLM 调用各一个），第一次 final 就 break 会**漏掉工具执行结果和后续 agent 的输出**。

✅ 修复：要「整轮彻底结束」就用 `IsRunnerCompletion()`（`event/event.go:375`），它只在最末尾的 `runner.completion` 事件上为真。`IsFinalResponse` 适合「我只想拿首轮答复发个 ACK」的窄场景，不适合做 drain 终止条件。

```go
// ❌ 错误：多 agent / 带工具时第一次 final 就跑路
for evt := range eventChan {
	if evt.IsFinalResponse() { break } // 后面还有事件没消费
}

// ✅ 正确：以 runner.completion 为准
for evt := range eventChan {
	handle(evt)
	if evt.IsRunnerCompletion() { break }
}
```

### 陷阱 3：HTTP handler 不 drain 就 return → writer goroutine 阻塞 / 泄漏

❌ 把 trpc-agent-go 包成 HTTP 服务时，handler 收到 eventChan 后直接 `return nil`，没把 channel drain 完。Runner 内部的发送 goroutine 还在 `ch <- evt`，没人收 → 永久阻塞 → goroutine 泄漏（这本质就是 [01 并发与 Channel](./01-concurrency-channel) 里讲的「消费者跑路、生产者卡死」）。

✅ 修复：handler 必须**用 `for range` 把 channel drain 干净**，或在提前退出时调用 `cancel()` 让 Runner 走 `ctx.Done()` 分支。把每个 SSE 帧写回 `http.ResponseWriter` 后 `http.Flusher.Flush()`，循环到 `IsRunnerCompletion()` 再 return。

```go
// ❌ 错误：handler 提前 return，Runner goroutine 泄漏
func handler(w http.ResponseWriter, r *http.Request) {
	ch, _ := runner.Run(ctx, ...)
	writeFirstChunk(w, ch)
	return // channel 没 drain，生产者卡死
}

// ✅ 正确：drain 到 runner.completion，逐帧 flush
func handler(w http.ResponseWriter, r *http.Request) {
	flusher, _ := w.(http.Flusher)
	ch, _ := runner.Run(ctx, ...)
	for evt := range ch {
		writeSSEFrame(w, evt) // data: {...}\n\n
		flusher.Flush()
		if evt.IsRunnerCompletion() { break }
	}
}
```

### 陷阱 4：混淆 `Done=true` 与 `runner.completion`

❌ 看到 `evt.Done == true` 就以为「整个对话结束了」，直接关闭连接、清空会话。实际上 `Done=true` 只表示**当前这个事件是它那次 LLM 调用的 final**——工具调用后会再起一轮 LLM，那轮也有自己的 `Done=true`。

✅ 修复：牢记语义边界——`Done`（`response.go:205`）描述**单次 LLM 调用**，`IsRunnerCompletion()`（`event.go:375`）描述**整次 Run**。会话级别的清理只能放在 `IsRunnerCompletion()` 之后。

## 小结

- 流式 = 「partial chunk（带 `Delta`）逐帧推送 + 末尾一个 final（带完整 `Message`）+ 一个 runner.completion」，消费端要按这个时序处理。
- `GenerationConfig.Stream=true`（`request.go:380`）开启流式；框架把上游 SSE 帧翻译成 partial Event 注入 channel。
- 读内容时**流式取 `Choice.Delta.Content`、批量取 `Choice.Message.Content`**，混用就是丢字符。
- drain channel 的终止条件用 `evt.IsRunnerCompletion()`（`event.go:375`），而不是 `IsFinalResponse()` 或裸 `Done`，否则多 agent / 带工具场景必漏事件。
- HTTP 场景必须 drain 到 runner.completion 再 return，否则 Runner 发送 goroutine 阻塞泄漏——根因见 [01 并发与 Channel](./01-concurrency-channel)。

**延伸阅读：**

- [Runner 执行器](../examples/00-runner-executor/runner.md)
- [AG-UI 协议](../examples/10-agui-protocol/index.md)
- [SSE - MDN](https://developer.mozilla.org/en-US/docs/Web/API/Server-sent_events)
- [并发模型与 Channel 事件流](./01-concurrency-channel)
