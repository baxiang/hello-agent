# Go 接口与可插拔设计 — trpc-agent-go 的灵魂

> trpc-agent-go 的 Agent/Model/Tool/Session/Memory/Knowledge 全是 interface——这是「可插拔」（pluggable）哲学的基础，理解错了就换不了后端，写出来的代码也跑不了 mock 测试。

## 核心概念

Go 的 interface 与 Java/Python 截然不同：它**没有 `implements` 关键字**，类型只要「方法签名对得上」就自动满足接口，这叫**隐式实现**（implicit implementation / structural typing）。trpc-agent-go 把这条语言特性当成架构基石，必须吃透下面四点：

1. **隐式实现**：结构体不需要声明「我实现了 `Agent`」，只要定义了 `Run / Tools / Info / SubAgents / FindSubAgent` 这组方法，编译器就认。
2. **接口即契约**：接口只描述「能做什么」，不关心「怎么做」。调用方依赖契约，实现方自由替换——这就是 DI（依赖注入）的 Go 原生写法。
3. **小接口优先 / 组合大于继承**：标准库 `io.Reader`、`io.Writer` 都只有一个方法，靠**组合**拼成 `io.ReadWriter`。Go 社区把这条原则叫 ISP（Interface Segregation Principle）。
4. **接口定义在消费方**：谁用接口，谁就在自己的包里声明它。实现方包不该 import 自己的消费方，否则循环依赖。

下面是一段**纯 Go**示例（不涉及 trpc-agent-go），同时演示隐式实现和接口组合：

```go
package main

import (
	"context"
	"fmt"
)

// (1) 小接口：每个只暴露一个职责
type Embedder interface {
	Embed(ctx context.Context, text string) ([]float32, error)
}

type Store interface {
	Save(ctx context.Context, id string, vec []float32) error
}

// 组合两个小接口得到一个大契约——调用方只需要 EmbedStore
type EmbedStore interface {
	Embedder
	Store
}

// (2) 隐式实现：不写 implements，方法签名对上即满足
type openAIEmbedder struct{ apiKey string }

func (e *openAIEmbedder) Embed(ctx context.Context, text string) ([]float32, error) {
	return []float32{0.1, 0.2, 0.3}, nil // 假装调用了 OpenAI
}

type memoryStore struct{ data map[string][]float32 }

func (s *memoryStore) Save(_ context.Context, id string, vec []float32) error {
	s.data[id] = vec
	return nil
}

// (3) 依赖注入：构造函数收 interface，不收具体类型
type Indexer struct {
	emb   Embedder
	store Store
}

func NewIndexer(emb Embedder, store Store) *Indexer {
	return &Indexer{emb: emb, store: store}
}

func (i *Indexer) Index(ctx context.Context, id, text string) error {
	vec, err := i.emb.Embed(ctx, text)
	if err != nil {
		return err
	}
	return i.store.Save(ctx, id, vec)
}

func main() {
	// (4) 换后端只需改这一行：openAIEmbedder → localEmbedder
	idx := NewIndexer(&openAIEmbedder{apiKey: "sk-xxx"}, &memoryStore{data: map[string][]float32{}})
	_ = idx.Index(context.Background(), "doc-1", "hello")
	fmt.Println("indexed")
}
```

逐行解读：**(1)** 把能力切成 `Embedder` 和 `Store` 两个小接口，单一职责，谁需要谁就声明；**(2)** `openAIEmbedder` 和 `memoryStore` 都没写「我实现了 X」，编译器看方法签名自动判定——这是 Go 的 structural typing，换实现零成本；**(3)** `NewIndexer` 形参类型是 interface，这就是 Go 原生 DI：调用方决定注入哪个实现，`Indexer` 自己只认契约，明天要换成本地 embedder、pgvector store 都不动 `Indexer` 一行代码；**(4)** 测试时把 `&openAIEmbedder{}` 换成 `&fakeEmbedder{}` 就能 mock 掉网络调用，单测不用碰真实 API——trpc-agent-go 整个测试套件零 API key，靠的就是这种「到处收 interface」的设计。

## 在 trpc-agent-go 里

### Agent 接口签名

`agent/agent.go:62-83` 定义了框架的根接口，所有 agent 实现都满足它：

```go
// agent/agent.go:62
type Agent interface {
	// Run executes the provided invocation within the given context and returns
	// a channel of events that represent the progress and results of the execution.
	Run(ctx context.Context, invocation *Invocation) (
		<-chan *event.Event, error,
	)

	// Tools returns the list of tools that this agent has access to and can execute.
	Tools() []tool.Tool

	// Info returns the basic information about this agent.
	Info() Info

	// SubAgents returns the list of sub-agents available to this agent.
	// Returns empty slice if no sub-agents are available.
	SubAgents() []Agent

	// FindSubAgent finds a sub-agent by name.
	// Returns nil if no sub-agent with the given name is found.
	FindSubAgent(name string) Agent
}
```

框架自带的 `LLMAgent`、`ChainAgent`、`GraphAgent` 全部隐式实现这个接口——它们没写 `implements Agent`，只是各自把五个方法签名凑齐了。这意味着你**自定义 Agent** 只要把这五个方法签名凑齐，就能塞进 trpc-agent-go 的 Runner / Session / SubAgent 树里，跟内置 agent 混用。

### Embedder 与 VectorStore

知识库（Knowledge / RAG）那一侧也是同样的接口化设计。`knowledge/embedder/embedder.go:44` 的 `Embedder`：

```go
// knowledge/embedder/embedder.go:44
type Embedder interface {
	// GetEmbedding generates an embedding vector for the given text.
	GetEmbedding(ctx context.Context, text string) ([]float64, error)

	// GetEmbeddingWithUsage generates an embedding vector for the given text
	// and returns usage information if available.
	GetEmbeddingWithUsage(ctx context.Context, text string) ([]float64, map[string]any, error)

	// GetDimensions returns the dimensionality of the embeddings produced by this embedder.
	GetDimensions() int
}
```

`knowledge/vectorstore/vectorstore.go:22-55` 的 `VectorStore`：

```go
// knowledge/vectorstore/vectorstore.go:22
type VectorStore interface {
	Add(ctx context.Context, doc *document.Document, embedding []float64) error
	Get(ctx context.Context, id string) (*document.Document, []float64, error)
	Update(ctx context.Context, doc *document.Document, embedding []float64) error
	Delete(ctx context.Context, id string) error
	Search(ctx context.Context, query *SearchQuery) (*SearchResult, error)
	DeleteByFilter(ctx context.Context, opts ...DeleteOption) error
	UpdateByFilter(ctx context.Context, opts ...UpdateByFilterOption) (int64, error)
	Count(ctx context.Context, opts ...CountOption) (int, error)
	GetMetadata(ctx context.Context, opts ...GetMetadataOption) (map[string]DocumentMetadata, error)
	Close() error
}
```

同一组接口，框架提供了 OpenAI / 本地模型 多种 `Embedder` 实现，以及 pgvector / Milvus / Redis 等多种 `VectorStore` 实现。**业务代码只依赖这两个 interface**，换向量库或换 embedding 模型，就是改构造函数一行实参，调用方零改动。这是 trpc-agent-go 「可插拔」最直接的体现。

## 常见陷阱

### 陷阱 1：构造函数收具体类型 → 测不了、换不了

❌ 把具体 struct 类型写进构造函数和字段，依赖关系被钉死，mock 时发现没法替换。

✅ 修复：形参统一用 interface，让调用方决定注入谁。

```go
// ❌ 错：字段是 *openAIEmbedder，测试必须联网
type Indexer struct {
	emb *openAIEmbedder
}
func NewIndexer(emb *openAIEmbedder) *Indexer { return &Indexer{emb: emb} }

// ✅ 正确：字段是 Embedder interface
type Indexer struct {
	emb Embedder
}
func NewIndexer(emb Embedder) *Indexer { return &Indexer{emb: emb} }
```

### 陷阱 2：在实现方包里定义接口 → 循环依赖

❌ `mypkg/embedder.go` 里定义 `Embedder` 接口，然后 import 消费方包去用——或者反过来，实现方包因为「我有这个接口」而被迫依赖消费方。Go 没有 `implements` 关键字，这种耦合完全没必要存在。

✅ 修复：**接口定义在消费方包**。`trpc-agent-go/agent` 包需要 Agent 能力，所以 `Agent` 接口定义在 `agent/agent.go`；具体的 `LLMAgent` 在自己的实现包里，不需要 import `agent` 包就能满足接口。这是 Go 标准库 `io.Reader` 一直遵循的「consumer defines interface」原则。

```go
// ❌ 错：实现方包定义接口并试图让消费方 import 自己
package myembedder
type Embedder interface { ... }          // 多余，且容易造成循环依赖
type LocalEmbedder struct{}
func (l *LocalEmbedder) Embed(...) ... {}

// ✅ 正确：实现方包只暴露 struct，接口在消费方按需声明
package myembedder
type LocalEmbedder struct{}
func (l *LocalEmbedder) Embed(...) ... {} // 签名对上即满足任意 Embedder 接口
```

### 陷阱 3：巨型接口违反 ISP → 实现方被迫塞空方法

❌ 把所有能力塞进一个 fat interface，实现者为了凑数写一堆 `return nil` / `panic("not implemented")`，可替换性反而变差。

✅ 修复：拆成多个小接口，消费方按需组合。trpc-agent-go 的 `Agent`（5 方法）是相对大的接口，但 RAG 这边就拆成了 `Embedder`（3 方法）和 `VectorStore`（10 方法），各自只关心一件事。

```go
// ❌ 错：一个接口管所有，实现方要硬凑
type RAG interface {
	Embed(...)
	Save(...)
	Search(...)
	Chat(...)
	ManageSession(...)
} // 任何一个 RAG 实现都得塞满五个方法

// ✅ 正确：小接口 + 组合
type Embedder interface { ... }
type Store interface { ... }
type Retriever interface { Embedder; Store } // 需要的时候才组合
```

### 陷阱 4：以为「方法签名一样就一定等价」→ nil 接口陷阱

❌ 接口值有两部分（类型 + 值），`var a Agent` 不赋值时 `(nil, nil)`，但 `var p *LLMAgent; var a Agent = p` 得到的是 `(*LLMAgent, nil)`——接口本身**不为 nil**，调 `a.Run(...)` 依然会 nil pointer panic。

✅ 修复：返回 interface 之前显式判 nil，或用 `func X() Agent` 在错误路径返回真正的 `nil`（裸 nil 而不是 typed-nil）。

```go
// ❌ 错：typed-nil，调用方 if a == nil 判不出来
func NewAgent(cfg *Config) Agent {
	var p *LLMAgent // nil
	return p        // 接口值 = (*LLMAgent, nil)，!= nil
}

// ✅ 正确：显式 nil 路径
func NewAgent(cfg *Config) Agent {
	if cfg == nil {
		return nil // 真正的 nil interface
	}
	return NewLLMAgent(cfg)
}
```

## 小结

- trpc-agent-go 的 Agent / Embedder / VectorStore / Tool / Session / Memory / Knowledge **全是 interface**，这是「换后端不改业务代码」的根本原因，理解 Go 的**隐式实现**才能用好这套机制。
- 构造函数和字段统一收 interface、拒收具体 struct——这是 Go 原生 DI，也是 trpc-agent-go 测试套件零 API key 的前提。
- 接口定义在**消费方包**，小接口优先、按需组合，避免 fat interface 与循环依赖。
- 当心 typed-nil：返回 interface 值时显式走 nil 路径，否则调用方 `if err != nil` / `if a == nil` 判断会失效。

**延伸阅读：**

- [模型与提供商](../examples/13-model-provider/model.md)
- [知识检索 RAG](../examples/12-knowledge-rag/knowledge.md)
- [Go Proverbs](https://go-proverbs.github.io/)
- [并发模型与 Channel 事件流](./01-concurrency-channel)
