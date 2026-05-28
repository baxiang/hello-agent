# 制品/文件存储

制品服务（Artifact Service）为 Agent 提供文件级别的持久化能力。制品以文件为单位，通过应用名、用户 ID、会话 ID 和文件名进行标识，并支持版本管理。Agent 可以在工具执行过程中保存和加载制品，实现文件处理、数据交换等能力。

## 1. Artifact Service 接口

定义于 `source/artifact/service.go:31-47`：

```go
type Service interface {
    Save(ctx context.Context, req *SaveRequest) (*SaveResponse, error)
    Load(ctx context.Context, req *LoadRequest) (*LoadResponse, error)
    Delete(ctx context.Context, req *DeleteRequest) error
    List(ctx context.Context, req *ListRequest) (*ListResponse, error)
    Versions(ctx context.Context, req *VersionsRequest) (*VersionsResponse, error)
    GetArtifactVersion(ctx context.Context, req *GetArtifactVersionRequest) (*GetArtifactVersionResponse, error)
}
```

| 方法 | 说明 |
|------|------|
| `Save` | 保存制品，返回版本号 |
| `Load` | 加载制品（可指定版本，默认最新版） |
| `Delete` | 删除制品（可指定版本，默认删除全部版本） |
| `List` | 列出会话内所有制品文件名 |
| `Versions` | 列出制品的所有版本号 |
| `GetArtifactVersion` | 获取特定版本的元数据 |

### 请求/响应类型

所有请求类型均包含 `AppName`、`UserID`、`SessionID` 标识字段，并通过 `Validate()` 方法进行参数校验（检查必填字段、文件名不含路径分隔符等）。

**SaveRequest**：
```go
type SaveRequest struct {
    AppName, UserID, SessionID, FileName string
    Part    *genai.Part  // 制品内容（文本或二进制数据）
    Version int64        // 可选，指定版本号；为0时自动创建新版本
}
```

`Part` 必须包含 `Text` 或 `InlineData` 之一。`Validate()` 确保必填字段非空且 `FileName` 不含 `/` 或 `\`。

**SaveResponse** 返回新创建的版本号。

**LoadRequest** 可指定 `Version`，为 0 时加载最新版本。

**ArtifactVersion** 元数据结构：
```go
type ArtifactVersion struct {
    Version        int64
    CanonicalURI   string
    CustomMetadata map[string]any
    CreateTime     float64
    MimeType       string
}
```

### 版本管理

每次 `Save` 操作都会创建新版本（版本号从 1 开始递增）。`Load` 不指定版本时返回最新版本。`Delete` 可删除指定版本或全部版本。这种设计使得 Agent 可以追踪文件的历史变更。

### 用户作用域制品

文件名以 `user:` 为前缀的制品为用户级制品，存储在用户命名空间下，对同一用户的所有会话可见。例如，`user:profile.json` 可以跨会话共享用户配置信息。`List` 操作会同时返回会话级和用户级的制品文件名。

## 2. InMemory 实现

定义于 `source/artifact/inmemory.go`：

```go
func InMemoryService() Service
```

使用 `omap.Map`（有序映射）存储制品数据，键为 `artifactKey` 的编码字符串，值为 `*genai.Part`。线程安全（`sync.RWMutex`）。

`artifactKey` 包含 `AppName`、`UserID`、`SessionID`、`FileName` 和 `Version` 五个字段，通过 `ordered.Encode` 编码为可排序的字符串键，实现高效的范围扫描。

主要实现细节：
- **Save**：查找当前最大版本号，递增后存储新版本
- **Load**：指定版本时直接查找；否则扫描最新版本
- **List**：扫描会话前缀和用户前缀下的所有键，收集文件名
- **Versions**：扫描指定文件的所有版本号
- 用户作用域制品（`user:` 前缀）在存储时将 `SessionID` 替换为 `"user"` 常量

## 3. GCS 实现

定义于 `source/artifact/gcsartifact/`，基于 Google Cloud Storage 的制品服务：

```go
func NewService(ctx context.Context, bucketName string, opts ...option.ClientOption) (artifact.Service, error)
```

GCS 中的对象路径格式：
- 会话级：`{appName}/{userID}/{sessionID}/{fileName}/{version}`
- 用户级：`{appName}/{userID}/user/{fileName}/{version}`

主要实现细节：
- 使用 `storage.Client` 操作 GCS Bucket
- `Save`：先查询现有版本号，递增后写入新 Blob
- `Load`：使用 `resolveVersion()` 解析版本号，从 GCS 读取并返回 `genai.Part`
- `Delete`：支持单版本删除和全部版本删除（并行执行）
- `List`：列出会话和用户两个前缀下的文件名
- `GetArtifactVersion`：返回 Blob 的 `ContentType`、`MediaLink`（或 `gs://` URI）、创建时间等元数据

适用于生产部署，支持持久化存储和大规模文件处理。

## 4. Artifact 在 Agent 中的使用

### agent.Artifacts 接口

定义于 `source/agent/agent.go:111-116`：

```go
type Artifacts interface {
    Save(ctx context.Context, name string, data *genai.Part) (*artifact.SaveResponse, error)
    List(context.Context) (*artifact.ListResponse, error)
    Load(ctx context.Context, name string) (*artifact.LoadResponse, error)
    LoadVersion(ctx context.Context, name string, version int) (*artifact.LoadResponse, error)
}
```

与 `artifact.Service` 相比，`Artifacts` 接口省略了 `AppName`/`UserID`/`SessionID` 参数——这些信息由 Runner 自动从当前会话上下文注入。

Runner 在创建 `InvocationContext` 时，若配置了 `ArtifactService`，会将其包装为 `agent.Artifacts` 实现注入到上下文中。工具和回调函数通过 `tool.Context` 或 `agent.CallbackContext` 的 `Artifacts()` 方法即可操作制品。

## 5. SaveInputBlobsAsArtifacts

定义于 `source/agent/run_config.go:34`：

```go
type RunConfig struct {
    StreamingMode              StreamingMode
    SaveInputBlobsAsArtifacts  bool
}
```

当 `SaveInputBlobsAsArtifacts` 设置为 `true` 时，Runner 会自动将用户输入中的二进制数据（如图片、文件）保存为制品：

```go
r, _ := runner.New(runner.Config{...})
eventCh := r.Run(ctx, userID, sessionID, content, agent.RunConfig{
    SaveInputBlobsAsArtifacts: true,
})
```

此功能简化了文件处理场景——用户上传的文件会自动持久化，Agent 后续可通过制品系统访问。

## 6. Instruction 中引用 Artifact

Agent 的 `Instruction` 模板支持使用 `{artifact.key_name}` 占位符引用制品内容：

```
请根据以下文件内容回答用户问题：
{artifact.report_data}
```

规则：
- `key_name` 必须匹配 `^[a-zA-Z_][a-zA-Z0-9_]*$`，否则视为字面量
- 运行时 ADK 会加载名为 `key_name` 的制品并替换占位符
- 若制品不存在，Agent 会报错；追加 `?` 可忽略缺失错误：`{artifact.missing_file?}`

此模板语法由 `instructionutil.InjectSessionState()` 处理，在 `InstructionProvider` 类型的指令和全局指令中可用。它同时也支持 `{key_name}` 形式引用 Session State 中的变量。
