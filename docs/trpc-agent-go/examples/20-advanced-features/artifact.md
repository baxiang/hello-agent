# Artifact服务 - Agent工具产物的存储与检索

## 概述

`artifact` 示例演示了如何使用 Artifact 服务在工具调用中保存和检索结构化产物。包含两个子示例：`savetext` 展示文本产物的保存与列举，`image` 展示图片生成场景中的产物管理。Artifact 服务为 Agent 的工具链提供了持久化存储层。

## 核心概念

**Artifact** 是工具调用过程中产生的持久化数据对象，包含：

- `Data` - 二进制数据内容
- `MimeType` - MIME 类型（如 "text/plain"、"image/png"）

核心 API：

- `agent.NewToolContext(ctx)` - 在工具函数中获取工具上下文
- `toolCtx.SaveArtifact(key, artifact)` - 保存产物（按 key 关联到当前 Session）
- `service.ListArtifactKeys(ctx, sessionInfo)` - 列出 Session 下所有产物 key
- `service.LoadArtifact(ctx, sessionInfo, key, opts)` - 按 key 加载产物

框架提供 `inmemory.NewService()` 作为内存实现，生产环境可替换为数据库或对象存储。

## 代码解析

**savetext 子示例——在工具中保存文本产物：**

```go
func logQuery(ctx context.Context, query logQueryInput) (logQueryOutput, error) {
    a := &artifact.Artifact{
        Data:     []byte(query.Query),
        MimeType: "text/plain",
    }
    toolCtx, err := agent.NewToolContext(ctx)
    if err != nil {
        return logQueryOutput{}, err
    }
    _, err = toolCtx.SaveArtifact("query", a)
    return logQueryOutput{}, err
}
```

**Runner 配置中注入 Artifact 服务：**

```go
a.artifactService = inmemory.NewService()
a.runner = runner.NewRunner(appName, llmAgent,
    runner.WithArtifactService(a.artifactService),
)
```

**运行后检索产物：**

```go
keys, _ := a.artifactService.ListArtifactKeys(ctx,
    artifact.SessionInfo{AppName: a.appName, UserID: a.userID, SessionID: a.sessionID})
for _, key := range keys {
    art, _ := a.artifactService.LoadArtifact(ctx, sessionInfo, key, nil)
    log.Infof("MimeType: %s, Data: %s", art.MimeType, art.Data)
}
```

**image 子示例**则展示了更复杂的场景：Agent 先调用 `text-to-image` 工具生成图片，再调用 `display-image` 工具展示，图片数据通过 Artifact 服务在工具间传递。

## 运行方式

```bash
cd examples

export OPENAI_API_KEY="your-key"

# 文本产物保存
go run ./artifact/savetext -model=deepseek-v4-flash

# 图片生成场景
go run ./artifact/image -model=deepseek-v4-flash
```

`savetext` 运行后会输出保存的产物 key 列表及每个产物的 MIME 类型和数据内容。

## 总结

Artifact 服务为 Agent 工具链中的数据持久化提供了标准化方案。与直接在工具间传递数据相比，Artifact 的优势在于：数据与 Session 关联、支持跨工具访问、可独立于对话历史管理。适用于文件生成、代码产出、图片处理等需要保留工具中间产物的场景。此功能与 `workspace_io` 示例中的文件同步互补——Workspace IO 面向文件系统，Artifact 面向结构化数据存储。
