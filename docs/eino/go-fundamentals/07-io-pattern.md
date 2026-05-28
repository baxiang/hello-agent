# io.Reader/Writer 模式 — 理解 Eino 流式抽象的钥匙

## 1. io.Reader 接口

Go 标准库通过 `io.Reader` 定义了统一的数据读取抽象：

```go
type Reader interface {
    Read(p []byte) (n int, err error)
}
```

调用者提供一个字节切片 `p`，`Read` 将数据填入 `p` 并返回读取的字节数。当没有更多数据时，返回 `io.EOF`。所有实现了该接口的类型（`os.File`、`bytes.Buffer`、`net.Conn` 等）都可以被任何接受 `io.Reader` 的函数处理——这是 Go 中最经典的面向接口编程。

## 2. io.Writer 接口

与 Reader 对称，`io.Writer` 定义了数据写入抽象：

```go
type Writer interface {
    Write(p []byte) (n int, err error)
}
```

`Write` 将 `p` 中的数据写入底层目标，返回写入的字节数。标准库中的 `io.Copy(dst, src)` 正是连接 Reader 和 Writer 的桥梁，实现数据的自动搬运。

## 3. io.EOF 语义 — 流的正常结束

`io.EOF` 是 Go 流式处理中最重要的哨兵错误。它不是"异常"，而是"信号"——表示数据已全部读取完毕。调用者通过 `errors.Is(err, io.EOF)` 判断流是否结束，而非将其视为错误：

```go
for {
    n, err := reader.Read(buf)
    if errors.Is(err, io.EOF) {
        break // 正常结束，不是错误
    }
    if err != nil {
        return err // 这才是真正的错误
    }
    process(buf[:n])
}
```

关键点：`io.EOF` 是可预期的控制流信号，与不可预期的错误（如网络断开、文件损坏）有本质区别。

## 4. io.Pipe() — 创建读写对

`io.Pipe()` 创建一对同步连接的 Reader 和 Writer：

```go
pr, pw := io.Pipe()

go func() {
    defer pw.Close()
    pw.Write([]byte("hello"))
}()

io.Copy(os.Stdout, pr) // 输出: hello
```

写入端 (`pw`) 写入的数据可以被读取端 (`pr`) 立即读到。Pipe 是无缓冲的同步管道——写入会阻塞直到读取端消费，反之亦然。这种模式在连接生产者和消费者时非常有用。

## 5. 标准库 vs Eino 对比

Eino 的流式抽象在设计理念上与 `io.Reader/Writer` 一脉相承，但用泛型取代了字节切片，实现了类型安全的流式传输：

| 标准库 | Eino | 说明 |
|--------|------|------|
| `io.Reader.Read(p []byte)` | `StreamReader[T].Recv() (T, error)` | Read 每次读字节到缓冲区；Recv 直接返回类型化的值 |
| `io.Writer.Write(p []byte)` | `StreamWriter[T].Send(chunk T, err error) bool` | Write 写入字节；Send 发送类型化的 chunk + 可选错误 |
| `io.Pipe()` | `schema.Pipe[T](cap int)` | Pipe 无缓冲同步；Eino Pipe 带缓冲区容量参数 |
| `io.MultiReader` | `MergeStreamReaders[T]` | MultiReader 顺序拼接；MergeStreamReaders 并发合并多个流 |
| `io.TeeReader` | `StreamReader[T].Copy(n int)` | TeeReader 一读两写；Copy 创建 n 个独立消费者 |

### 5.1 schema.Pipe — 泛型管道

Eino 的 `Pipe` 函数（schema/stream.go:99-102）是理解其流式模型的入口：

```go
func Pipe[T any](cap int) (*StreamReader[T], *StreamWriter[T]) {
    stm := newStream[T](cap)
    return stm.asReader(), &StreamWriter[T]{stm: stm}
}
```

使用示例：

```go
sr, sw := schema.Pipe[string](3) // 缓冲区容量为 3

go func() {
    defer sw.Close()          // 发送完毕后必须 Close
    for i := 0; i < 10; i++ {
        sw.Send(fmt.Sprintf("chunk_%d", i), nil)
    }
}()

defer sr.Close()              // 消费完毕后必须 Close
for {
    chunk, err := sr.Recv()
    if errors.Is(err, io.EOF) {
        break
    }
    if err != nil {
        panic(err)
    }
    fmt.Println(chunk)
}
```

### 5.2 StreamReader — 泛型读取器

`StreamReader[T]`（schema/stream.go:168-180）是 Eino 的核心读取抽象。它的 `Recv` 方法（schema/stream.go:195-210）根据内部类型分派到不同的读取实现：

```go
func (sr *StreamReader[T]) Recv() (T, error) {
    switch sr.typ {
    case readerTypeStream:
        return sr.st.recv()       // 从 channel 读取
    case readerTypeArray:
        return sr.ar.recv()       // 从数组读取
    case readerTypeMultiStream:
        return sr.msr.recv()      // 从多个流合并读取
    case readerTypeWithConvert:
        return sr.srw.recv()      // 带类型转换的读取
    case readerTypeChild:
        return sr.csr.recv()      // 从 Copy 产生的子流读取
    }
}
```

### 5.3 StreamWriter — 泛型写入器

`StreamWriter[T]`（schema/stream.go:115-117）提供 `Send` 和 `Close` 两个核心方法。`Send`（schema/stream.go:126-128）向 channel 发送数据，返回 `closed` 布尔值表示接收端是否已关闭：

```go
func (sw *StreamWriter[T]) Send(chunk T, err error) (closed bool) {
    return sw.stm.send(chunk, err)
}
```

`Close`（schema/stream.go:139-141）关闭发送端 channel，使接收端的 `Recv` 返回 `io.EOF`：

```go
func (sw *StreamWriter[T]) Close() {
    sw.stm.closeSend() // 关闭底层 channel
}
```

### 5.4 MergeStreamReaders — 多流合并

`MergeStreamReaders[T]`（schema/stream.go:912-960）将多个 StreamReader 合并为一个，所有流的数据按到达顺序交错输出。对于命名流，可使用 `MergeNamedStreamReaders`（schema/stream.go:990-1006），它在某个源流结束时返回 `SourceEOF` 错误，标识具体哪个源完成了。

### 5.5 StreamReader.Copy — 流扇出

`Copy`（schema/stream.go:261-275）将一个流复制为 n 个独立消费者。每个消费者都能独立读取完整数据。典型场景：同一个流需要同时送往回调处理器和下游节点：

```go
copies := sr.Copy(2)
sr1, sr2 := copies[0], copies[1]
defer sr1.Close()
defer sr2.Close()
```

## 6. 关键差异：泛型与类型安全

`io.Reader` 在字节层面操作，所有数据都是 `[]byte`。Eino 的 `StreamReader[T]` 通过泛型在类型层面操作：

- **编译时类型检查**：`StreamReader[*schema.Message]` 只能传递 `*schema.Message`，不会误传 `string`
- **零拷贝语义**：无需在 `[]byte` 和业务类型之间反复序列化/反序列化
- **类型安全的组合**：`StreamReaderWithConvert[T, D]`（schema/stream.go:691-697）提供类型安全的流转换

```go
// 将 int 流转换为 string 流，跳过 0 值
intReader := schema.StreamReaderFromArray([]int{0, 1, 2, 3})
strReader := schema.StreamReaderWithConvert(intReader,
    func(i int) (string, error) {
        if i == 0 {
            return "", schema.ErrNoValue // 跳过零值
        }
        return fmt.Sprintf("val_%d", i), nil
    })
```

`ErrNoValue`（schema/stream.go:47）是特殊的哨兵错误，告诉转换器跳过当前元素而非报错。

## 7. 流式编程模式

### 7.1 defer Close 模式

无论是 StreamReader 还是 StreamWriter，使用后都必须 Close。使用 `defer` 确保异常路径也能正确关闭：

```go
sr, sw := schema.Pipe[string](5)
go func() {
    defer sw.Close() // 生产者：发送完毕后关闭
    // ... Send 逻辑
}()
defer sr.Close()     // 消费者：读取完毕后关闭
// ... Recv 逻辑
```

### 7.2 for + Recv + EOF 循环

这是 Eino 中消费流的标准模式，与标准库的 `for + Read + EOF` 完全一致：

```go
defer sr.Close()
for {
    chunk, err := sr.Recv()
    if errors.Is(err, io.EOF) {
        break
    }
    if err != nil {
        return err
    }
    process(chunk)
}
```

### 7.3 Copy — 流扇出模式

当多个消费者需要独立读取同一份数据时：

```go
copies := sr.Copy(2)
// copies[0] 和 copies[1] 独立读取相同数据
```

## 8. 常见陷阱：忘记 Close 导致 Goroutine 泄漏

这是 Eino 流式编程中最常见也最隐蔽的问题。底层 `stream[T]`（schema/stream.go:375-382）通过 channel + closed channel 实现读写协调：

```go
type stream[T any] struct {
    items  chan streamItem[T] // 数据通道
    closed chan struct{}      // 接收端关闭信号
}
```

`Send` 方法（schema/stream.go:410-426）会在写入前检查 `closed` channel。如果接收端未 Close，发送端的 `Send` 将永远阻塞在 channel 写入上，导致 goroutine 泄漏：

```go
sr, sw := schema.Pipe[string](0) // 无缓冲
go func() {
    sw.Send("data", nil) // 永远阻塞！因为没有消费者
    sw.Close()           // 永远不会执行
}()
// 忘记 sr.Close() 或从未调用 sr.Recv()
// goroutine 泄漏！
```

**正确做法**：

1. StreamWriter 端：始终 `defer sw.Close()`
2. StreamReader 端：始终 `defer sr.Close()`，即使流已读到 `io.EOF`
3. 提前退出循环时（`break`/`return`），`defer` 会保证 Close 被调用

对于可能遗忘的场景，可以调用 `sr.SetAutomaticClose()`（schema/stream.go:279-310），让 GC 在 StreamReader 不可达时自动关闭。但这不应作为常规手段，仅作为安全网。
