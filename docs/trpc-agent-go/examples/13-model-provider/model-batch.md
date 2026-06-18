# 批量处理（Batch）- OpenAI Batch API 的异步任务管理

> **源码路径**：[`trpc-agent-go/examples/model/batch/`](../../../../trpc-agent-go/examples/model/batch)
> **示例类型**：规模化异步处理 · **难度**：进阶

## 概述

`batch/` 演示 OpenAI **Batch API**：把成百上千条请求打包成一个批处理作业，**异步**执行后取回结果。相对逐条同步调用，Batch API 通常**更便宜**（OpenAI 官方半价）、**无速率限制**，适合离线大规模推理任务。

与兄弟示例的核心区别：batch 是**异步批处理**，其他示例（[`retry`](./model-retry.md) / [`failover`](./model-failover.md) / [`switch`](./model-switch.md) 等）都是**同步交互式**调用。Batch 处理的对象是"一批请求"，不是一次对话。

## 核心概念

### 四个核心操作

| 操作 | API | 作用 |
|------|-----|------|
| Create | `llm.CreateBatch(ctx, requests, opts...)` | 创建批处理作业 |
| Retrieve | `llm.RetrieveBatch(ctx, id)` | 查询某个作业详情 |
| Cancel | `llm.CancelBatch(ctx, id)` | 取消运行中的作业 |
| List | `llm.ListBatches(ctx, after, limit)` | 分页列出作业 |

加上文件相关辅助 API：

| 操作 | API | 作用 |
|------|-----|------|
| Download | `llm.DownloadFileContent(ctx, fileID)` | 下载结果文件内容 |
| Parse | `llm.ParseBatchOutput(text)` | 把 JSONL 结果解析成结构体 |

### BatchRequestInput 结构

每个批处理条目是一个 `openai.BatchRequestInput`：

```go
out = append(out, &openai.BatchRequestInput{
    CustomID: "001",                            // 自定义 ID，用于结果对应
    Method:   "POST",
    URL:      string(openaisdk.BatchNewParamsEndpointV1ChatCompletions),
    Body:     req,                              // openai.BatchRequest，含 Messages
})
```

`CustomID` 是用户给的标识，**结果文件里会带着这个 ID 返回**，方便把请求和响应对应起来。

### 文本规范格式（spec）

为了让命令行演示方便，示例定义了一套极简的文本格式：

```
role: content || role: content /// role: content || role: content
        ↑ messages 间分隔           ↑ requests 间分隔
```

- `///` 分隔**不同的请求**
- `||` 分隔**同一请求内的多条消息**
- 每条消息形如 `role: content`，role 可以是 `system`/`user`/`assistant`

### 完成窗口（Completion Window）

```go
const defaultWindow = "24h"

batch, err := llm.CreateBatch(ctx, requests,
    openai.WithBatchCreateCompletionWindow(defaultWindow),
)
```

`WithBatchCreateCompletionWindow` 指定服务端必须在多久内处理完，目前 OpenAI 支持 `24h`。

## 代码解析

示例是单文件 `main.go`（360 行），按 `-action` 派发到 4 个处理函数：

```go
switch *action {
case "create":  err = runCreate(ctx, llm, *requestsInline, *requestsFile)
case "get":     err = runGet(ctx, llm, *batchID)
case "cancel":  err = runCancel(ctx, llm, *batchID)
case "list":    err = runList(ctx, llm, *after, *limit)
}
```

### Create：解析 spec → 上传 → 创建

```go
func runCreate(ctx context.Context, llm *openai.Model, inlineSpec, filePath string) error {
    if inlineSpec == "" && filePath == "" {
        return errors.New("provide -requests or -file for create")
    }
    spec := inlineSpec
    if spec == "" {
        b, err := os.ReadFile(filePath)
        // ...
        spec = strings.TrimSpace(string(b))
    }
    requests, err := parseRequestsSpec(spec)
    // ...
    batch, err := llm.CreateBatch(ctx, requests,
        openai.WithBatchCreateCompletionWindow(defaultWindow),
    )
    printBatch("🆕 Batch created.", batch)
    return nil
}
```

`parseRequestsSpec` 把 `system: ... || user: ... /// ...` 这种文本拆成 `[]*openai.BatchRequestInput`，自动给每个请求分配 `CustomID`（如 `001`、`002`）。

### Get：查询 + 自动下载结果

```go
batch, err := llm.RetrieveBatch(ctx, id)
// ...
if batch.OutputFileID != "" {
    text, err := llm.DownloadFileContent(ctx, batch.OutputFileID)
    entries, err := llm.ParseBatchOutput(text)
    for _, e := range entries {
        fmt.Printf("[%s] status=%d\n", e.CustomID, e.Response.StatusCode)
        if len(e.Response.Body.Choices) > 0 {
            fmt.Printf("  content: %s\n", e.Response.Body.Choices[0].Message.Content)
        }
    }
}
```

`RetrieveBatch` 返回的 `batch.OutputFileID` 在作业完成后非空，示例自动下载并解析每条结果。

### List：分页

```go
page, err := llm.ListBatches(ctx, after, limit)
for i, item := range page.Data {
    printBatchListItem(i+1, item)
}
if page.HasMore && len(page.Data) > 0 {
    last := page.Data[len(page.Data)-1]
    fmt.Printf("➡️  More available. Use --after=%s for next page.\n", last.ID)
}
```

`ListBatches` 返回 `HasMore` 标记和最后一条 ID，配合 `-after` 实现翻页。

### 详细打印

`printBatchListItem` 把每个 batch 的状态、时间戳、统计都打出来：

```go
fmt.Printf("%2d. id=%s status=%s created=%s requests(total=%d,ok=%d,fail=%d)\n",
    index, item.ID, string(item.Status), ts(item.CreatedAt),
    item.RequestCounts.Total, item.RequestCounts.Completed, item.RequestCounts.Failed)
```

## 运行方式

### 环境变量

| 变量 | 必需 | 说明 | 默认值 |
|------|------|------|--------|
| `OPENAI_API_KEY` | 是 | API Key | — |
| `OPENAI_BASE_URL` | 否 | 端点（兼容 OpenAI/Venus 等平台） | `https://api.openai.com/v1` |

### 命令行参数

| 参数 | 说明 | 默认值 |
|------|------|--------|
| `-action` | `create` / `get` / `cancel` / `list` | `list` |
| `-model` | 模型名 | `gpt-4o-mini` |
| `-requests` | 内联请求规范 | 空 |
| `-file` | 请求规范文件路径 | 空 |
| `-id` | Batch ID（用于 `get`/`cancel`） | 空 |
| `-after` | 分页游标（用于 `list`） | 空 |
| `-limit` | 列出数量上限（1-100） | `5` |

### 运行命令

```bash
cd examples/model/batch
export OPENAI_API_KEY="your-key"

# 1. 列出已有 batch（默认）
go run main.go

# 2. 创建新 batch（内联）
go run main.go -action create \
  -requests "system: You are helpful. || user: Hello /// system: You are helpful. || user: How are you?"

# 3. 创建新 batch（文件）
echo "user: Hello /// user: World" > requests.txt
go run main.go -action create -file requests.txt

# 4. 查询某个 batch（会自动下载并解析结果）
go run main.go -action get -id batch_abc123

# 5. 取消 batch
go run main.go -action cancel -id batch_abc123

# 6. 分页列出
go run main.go -action list -limit 10 -after batch_abc123
```

### 预期输出

**创建**：

```
🚀 Using configuration:
   📝 Model Name: gpt-4o-mini
   🎛️  Action: create
   🔑 OpenAI SDK reads OPENAI_API_KEY and OPENAI_BASE_URL from env

🆕 Batch created.
   🆔 ID: batch_abc123
   🔗 Endpoint: /v1/chat/completions
   🕐 Created: 2025-01-27T10:30:00Z
   🧭 Status: validating
   📥 Input File: file_abc123
   📊 Requests: total=2 ok=0 fail=0
🎉 Done.
```

**列出**：

```
📃 Listing up to 5 batches.
 1. id=batch_abc123 status=completed created=2025-01-27T10:30:00Z requests(total=2,ok=2,fail=0)
     📤 Output: file_def456
     ⏰ Window: 24h
     ✅ Completed: 2025-01-27T10:35:00Z
🎉 Done.
```

## 适用场景与对比

**选 batch 当：**
- 有大量离线推理需求（数据标注、批量摘要、批量分类）
- 不要求实时响应，可接受 24h 内完成
- 想享受 Batch API 的折扣（OpenAI 官方约 50%）
- 想绕开逐条调用的速率限制

**不应选 batch 当：**
- 用户在等待实时响应 → 用 [`retry`](./model-retry.md) + [`failover`](./model-failover.md)
- 任务量很小（< 100 条） → 直接同步调用更简单
- 需要交互式多轮 → 用 [`switch`](./model-switch.md) 等示例

### 与同步调用的对比

| 维度 | Batch | 同步调用 |
|------|-------|---------|
| 时效 | 异步（分钟~小时级） | 实时（秒级） |
| 成本 | 折扣（约 50%） | 全价 |
| 并发限制 | 无（按作业排队） | 受 RPM/TPM 限制 |
| 失败重试 | 平台自动 | 自行配置 retry |
| 适合场景 | 离线批处理 | 在线交互 |

## 关键要点

1. **四操作一文件**：Create/Get/Cancel/List + DownloadFileContent
2. **CustomID 是关键**：用户给的 ID 会原样回到结果里，用于请求-响应映射
3. **JSONL 输入输出**：底层是文件上传/下载，ParseBatchOutput 解析 JSONL
4. **`24h` 完成窗口**：目前 OpenAI 仅支持这一档
5. **跨平台兼容**：凡 OpenAI 兼容端点（含 Venus）都可使用
6. **spec 文本格式是示例糖**：`///` + `||` 仅为本示例简化输入，生产可直接构造 `BatchRequestInput`

## 总结

batch 是规模化推理的标配：用半价成本、无并发限制地处理大量请求。开发阶段先用 [`retry`](./model-retry.md) / [`failover`](./model-failover.md) 验证单条逻辑，再切到 batch 做规模化部署，是典型的生产落地路径。
