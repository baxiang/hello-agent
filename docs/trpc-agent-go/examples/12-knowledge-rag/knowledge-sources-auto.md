# Auto Source 示例 - 自动判别文本/文件/URL 的混合源

> **源码路径**：[`trpc-agent-go/examples/knowledge/sources/auto-source/`](../../../../trpc-agent-go/examples/knowledge/sources/auto-source)
> **示例类型**：数据源 · **难度**：入门

## 概述

`sources/auto-source/` 用 `auto.New` 接收一个**混合字符串数组**，框架自动判别每条输入是纯文本、本地文件路径还是 URL，然后分发到对应的底层 reader。它是 [`file`](./knowledge-sources-file.md)、[`dir`](./knowledge-sources-directory.md)、[`url`](./knowledge-sources-url.md) 三者的"自动挡"版本——不用手动分类。

## 核心概念

### 一个 source，三种内容

```go
src := auto.New(
    []string{
        // 1. 纯文本（直接当文档内容）
        "Quantum computing uses quantum bits (qubits) to perform computations exponentially faster...",
        // 2. 本地文件路径
        util.ExampleDataPath("file/llm.md"),
        // 3. URL
        "https://en.wikipedia.org/wiki/N-gram",
    },
    auto.WithName("Mixed Content"),
    auto.WithMetadataValue("source_type", "auto"),
)
```

### 判别规则

`auto` 按以下优先级判别每条字符串：

| 输入特征 | 判别为 | 处理方式 |
|---------|--------|---------|
| 以 `http://` / `https://` 开头 | URL | HTTP 抓取 + HTML 解析 |
| 文件路径（存在） | 本地文件 | reader 按扩展名分发 |
| 其它 | 纯文本 | 直接当文档内容 |

这种判别让用户能用同一个数组把"一段备忘 + 一份手册 + 一个网页"塞进同一个 source。

### 与三种专用源的对比

| 维度 | file / dir / url | auto |
|------|------------------|------|
| 输入类型 | 单一（文件 or URL） | 混合 |
| 判别 | 用户手动分类 | 框架自动 |
| 元数据粒度 | 每 source 独立 | 全部共享同一组 |
| 适用 | 类型明确的批量数据 | 类型杂乱的原型/快速接入 |

> 注意：auto 的元数据是 source 级别共享的，无法给"文本部分"和"URL 部分"分别打不同标签。需要分别打标签时还是要拆成多个 source。

## 代码解析

### 三个查询验证三种内容

示例用三个查询分别验证三种内容是否都被正确入库：

```go
queries := []string{
    "What are qubits?",                       // 应命中纯文本
    "Tell me about n-grams",                  // 应命中 URL 抓取内容
    "What is a Large Language Model?",        // 应命中本地文件 llm.md
}

for i, q := range queries {
    eventChan, _ := r.Run(ctx, "user", fmt.Sprintf("session-%d", i),
        model.NewUserMessage(q))
    // 消费事件流
}
```

每轮用不同 sessionID（这些是独立问题，不需要共享上下文）。

## 运行方式

### 环境变量

| 变量 | 必需 | 说明 | 默认值 |
|------|------|------|--------|
| `OPENAI_API_KEY` | 是 | LLM + embedding Key | — |
| `OPENAI_BASE_URL` | 否 | 端点 | `https://api.openai.com/v1` |
| `MODEL_NAME` | 否 | 模型 | `deepseek-v4-flash` |
| 网络 | 是 | 能访问 URL 输入 | — |

### 命令行参数

| 参数 | 说明 | 默认值 |
|------|------|--------|
| `-vectorstore` | 同其它源 | `inmemory` |

### 运行命令

```bash
cd examples/knowledge/sources/auto-source
export OPENAI_API_KEY="sk-xxxx"
go run main.go
```

### 预期输出

```
🔮 Auto Source Demo
===================
Vector Store: inmemory

📥 Loading mixed content (text, file, URL)...
Loading source Mixed Content: 3/3 documents

1. 🔍 Query: What are qubits?
   🤖 Response: Qubits are quantum bits that can exist in superposition...

2. 🔍 Query: Tell me about n-grams
   🤖 Response: An n-gram is a contiguous sequence of n items from a given text...

3. 🔍 Query: What is a Large Language Model?
   🤖 Response: A Large Language Model (LLM) is...
```

## 适用场景与对比

**选 auto-source 当：**
- 快速原型，不想预先分类数据
- 数据来源真的混杂（用户输入 + 本地缓存 + 在线抓取）
- 一次性脚本/演示

**回到专用源当：**
- 需要给不同来源打不同元数据（拆成多个 file/url source）
- 数据量大且类型统一（专用源更高效，少一层判别）
- 需要精细控制（如 URL 配置 extractor、dir 配置 OCR）

## 关键要点

1. **一数组三类型**：auto 接收混合字符串，自动分发到 file/url/text reader。
2. **判别靠特征**：URL scheme → 路径存在性 → 兜底当文本。
3. **元数据共享**：source 级元数据无法按输入条目区分。
4. **适合原型**：快速验证"这些乱七八糟的数据能不能检索"。

## 总结

auto-source 是"自动挡"的数据源——丢进去一坨混合内容，框架帮你分类处理。生产环境如果数据类型稳定，建议还是用专用源（[`file`](./knowledge-sources-file.md) / [`dir`](./knowledge-sources-directory.md) / [`url`](./knowledge-sources-url.md)）以获得更精细的控制；原型阶段用 auto 快速试错。
