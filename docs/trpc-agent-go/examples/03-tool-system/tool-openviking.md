# OpenViking 知识库工具集 - 先搜索后读取的检索范式

> **源码路径**：[`trpc-agent-go/examples/tool/openviking/`](../../../../trpc-agent-go/examples/tool/openviking)
> **示例类型**：外部服务 ToolSet（检索 + Profile 分级） · **难度**：进阶

## 概述

`openviking/` 演示如何把 [OpenViking](https://github.com/volcengine/OpenViking) 上下文数据库作为一组工具暴露给 LLM。它和 [`hostexec`](./tool-hostexec.md) 一样走 `WithToolSets` 路径，但对接的是**外部检索服务**而不是本地 shell，并引入了两个新概念：**"search then read" 检索范式**和 **Profile 分级工具暴露**。

适合需要让 Agent 查询大型文档库、代码库、知识库的场景。

## 核心概念

### Search then Read 范式

OpenViking 不让模型一次性"读完所有文档"，而是强制两步走：

1. **搜索定位**：用 `viking_search` / `viking_find` 获取相关 `viking://` URI 的**短摘要**（不是全文）
2. **按需读取**：模型自己判断哪些 URI 最相关，再调用 `viking_read` 拉取**L2 全文**

这是为了**控制 token 消耗**——示例的 Instruction 明确要求模型先读 `content_mode=overview`，确实需要时再升级到 `content_mode=read`，并避免 `viking_browse` 的递归模式。

### Profile 分级暴露

OpenViking 把工具按权限分成三档，**Profile 决定模型能看到哪些工具**：

| Profile | 暴露的工具 |
|---------|-----------|
| `retrieval` | `viking_find`、`viking_search`、`viking_browse`、`viking_read`、`viking_grep`、`viking_health`（只读） |
| `agent`（默认） | retrieval 全部 + `viking_store`、`viking_add_resource`、`viking_add_skill`（可写） |
| `admin` | agent 全部 + `viking_forget`（**破坏性删除**） |

`admin` 额外暴露的 `viking_forget` 是危险操作，所以 Profile 校验在启动时**fail-fast**：

```go
func parseProfile(s string) (openviking.Profile, error) {
    switch openviking.Profile(s) {
    case openviking.ProfileRetrieval, openviking.ProfileAgent, openviking.ProfileAdmin:
        return openviking.Profile(s), nil
    default:
        return "", fmt.Errorf("invalid -profile %q: must be retrieval, agent, or admin", s)
    }
}
```

> **安全提示**：Profile 校验必须在创建 ToolSet 之前完成，避免拼写错误把 `admin` 模式误开。

## 代码解析

### 启动配置

示例在 `main()` 里集中解析 flag 并校验 Profile：

```go
modelName := flag.String("model", "deepseek-v4-flash", "Name of the model to use")
ovURL := flag.String("openviking", "http://localhost:1933", "OpenViking server URL")
apiKey := flag.String("openviking-key", os.Getenv("OPENVIKING_API_KEY"), "OpenViking API key")
account := flag.String("account", envOr("OPENVIKING_ACCOUNT", "default"), "OpenViking account identity (X-OpenViking-Account)")
user := flag.String("user", envOr("OPENVIKING_USER", "default"), "OpenViking user identity (X-OpenViking-User)")
profile := flag.String("profile", "agent", "Tool profile: retrieval | agent | admin")
flag.Parse()

selectedProfile, err := parseProfile(*profile)
if err != nil {
    log.Fatalf("%v", err)
}
```

注意 `envOr` 辅助函数：环境变量未设置时回退到默认值，避免空字符串被当成显式入参。

### 构建 ToolSet

`NewToolSet` 接收五个链式 Option，分别覆盖服务地址、鉴权、身份、Profile：

```go
ts, err := openviking.NewToolSet(
    openviking.WithBaseURL(*ovURL),
    openviking.WithAPIKey(*apiKey),
    openviking.WithAccount(*account),
    openviking.WithUser(*user),
    openviking.WithProfile(selectedProfile),
)
if err != nil {
    log.Fatalf("failed to create OpenViking tool set: %v", err)
}
defer ts.Close()
```

ToolSet 内部维护到 OpenViking server 的连接，因此同样需要 `defer ts.Close()`。

### Instruction 教模型省 token

这部分 system prompt 是整个示例的"灵魂"——它把 token 控制策略写进模型行为：

```go
llmagent.WithInstruction("Use viking_search or viking_find to locate relevant viking:// URIs; they return "+
    "short summaries only. Then call viking_read on just the few most relevant URIs to read full content "+
    "before answering. To stay within the context window, keep token usage low: read content_mode=overview "+
    "(or abstract) first and only escalate to content_mode=read for the specific URIs you truly need. "+
    "Avoid viking_browse with recursive=true and avoid reading many large files at once; prefer targeted "+
    "search over broad directory listings."),
```

### 事件流可视化

事件处理循环同时打印 **tool 调用**、**tool 结果**、**流式文本**，把 "search → read" 的两段式流程完整暴露给用户：

```go
for ev := range eventChan {
    if ev.Error != nil { /* 打印错误 */ continue }
    if len(ev.Response.Choices) > 0 {
        for _, choice := range ev.Response.Choices {
            if choice.Message.Role == model.RoleTool && choice.Message.ToolID != "" {
                fmt.Printf("\n[result] %s -> %s\n",
                    choice.Message.ToolID,
                    truncateForDisplay(strings.TrimSpace(choice.Message.Content), 800))
            }
        }
        choice := ev.Response.Choices[0]
        for _, tc := range choice.Message.ToolCalls {
            fmt.Printf("\n[tool] %s %s\n", tc.Function.Name, string(tc.Function.Arguments))
        }
        if choice.Delta.Content != "" {
            fmt.Print(choice.Delta.Content)
        }
    }
    if ev.IsFinalResponse() { break }
}
```

`truncateForDisplay` 按 **rune** 截断（不是按字节），避免中文/emoji 被截一半。

## 运行方式

### 前置依赖：启动 OpenViking Server

```bash
pip install openviking
openviking-server init    # 配置 embedding + VLM provider
openviking-server         # 默认监听 http://localhost:1933

ov add-resource https://github.com/volcengine/OpenViking --wait  # 可选：灌入测试数据
```

### 环境变量

| 变量 | 必需 | 说明 |
|------|------|------|
| `OPENAI_API_KEY` | 是 | 对话模型 API Key |
| `OPENAI_BASE_URL` | 否 | 模型端点 |
| `OPENVIKING_API_KEY` | 否 | OpenViking API Key（也可用 `-openviking-key` 传入） |
| `OPENVIKING_ACCOUNT` | 否 | OpenViking account 身份（默认 `default`） |
| `OPENVIKING_USER` | 否 | OpenViking user 身份（默认 `default`） |

### 命令行参数

| 参数 | 说明 | 默认值 |
|------|------|--------|
| `-model` | 模型名 | `deepseek-v4-flash` |
| `-openviking` | OpenViking server URL | `http://localhost:1933` |
| `-openviking-key` | OpenViking API Key | `$OPENVIKING_API_KEY` |
| `-account` | account 身份头 | `$OPENVIKING_ACCOUNT` 或 `default` |
| `-user` | user 身份头 | `$OPENVIKING_USER` 或 `default` |
| `-profile` | 工具暴露档位：`retrieval` / `agent` / `admin` | `agent` |

### 运行命令

```bash
cd examples/tool/openviking
export OPENAI_API_KEY="your-key"

go run . -model deepseek-v4-flash -openviking http://localhost:1933 -profile agent
go run . -profile retrieval       # 只读模式（最安全）
go run . -profile admin           # 含 viking_forget，慎用
```

### 预期输出

```
OpenViking Tools Chat Demo
Model: deepseek-v4-flash | OpenViking: http://localhost:1933 | Profile: agent
==================================================
Ready. Session: openviking-session-1703123456 (type 'exit' to quit)

You: What is OpenViking?

Assistant:
[tool] viking_search {"query":"OpenViking overview"}
[result] call_xxx -> {"hits":[{"uri":"viking://...","summary":"..."}]}
[tool] viking_read {"uri":"viking://...","content_mode":"overview"}
[result] call_yyy -> OpenViking is a context database...
Assistant: Based on the docs, OpenViking is ...
```

## 适用场景与对比

**选 openviking 当：**
- 需要查询**结构化文档库**（代码仓库、技术文档、知识库）
- 数据已经在 OpenViking 里（或愿意灌入）
- 希望模型**自己控制读取深度**以节省 token

**选 [`webfetch`](./tool-webfetch.md) 当：**
- 要查的是**开放网页**（无 OpenViking 索引）
- 不想部署额外服务

| 维度 | openviking | hostexec | codeexec | webfetch |
|------|-----------|----------|----------|----------|
| 注册方式 | `WithToolSets` | `WithToolSets` | `WithTools` | `WithTools` |
| 数据源 | OpenViking 服务 | 宿主机 | 代码沙箱 | 互联网 |
| 工具分级 | ✅ Profile | ❌ | ❌ | ❌ |
| 写入能力 | agent/admin Profile | exec_command | execute_code | ❌（只读） |
| 外部依赖 | openviking-server | 无 | 无（local）/ e2b 服务 | 无 |

## 关键要点

1. **Search then Read 是 token 控制范式**：先搜短摘要定位 URI，再按需 `viking_read` 全文，避免一次性灌爆上下文
2. **Profile 决定工具暴露面**：`retrieval`（只读）→ `agent`（可写）→ `admin`（破坏性），启动时必须 fail-fast 校验
3. **多身份头透传**：`-account` / `-user` 直接映射到 OpenViking 的 `X-OpenViking-Account` / `X-OpenViking-User` 头，用于多租户隔离
4. **Instruction 是工具行为的一部分**：示例把"先用 overview、避免递归 browse、不要批量读"等策略写进 system prompt，工具好不好用很大程度取决于此
5. **按 rune 截断**：`truncateForDisplay` 用 `[]rune` 而非字节切片，处理多字节字符更安全

## 总结

`openviking` 把 Tool 系统从"调用本机能力"扩展到"对接外部检索服务"，并引入了 Profile 分级和 search-then-read 两个新概念。结合 [`codeexec`](./tool-codeexec.md)（计算）、[`hostexec`](./tool-hostexec.md)（本机作业）、[`webfetch`](./tool-webfetch.md)（开放网页），四者构成了覆盖"算、执行、查私库、查公网"的完整工具光谱。当你需要让 Agent 接入企业内部知识库时，openviking 的模式是最直接的参考。
