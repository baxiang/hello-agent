# GraphRAG Viewer 示例 - AGE 图可视化 Web 界面

> **源码路径**：[`trpc-agent-go/examples/knowledge/features/graphrag/viewer/`](../../../../trpc-agent-go/examples/knowledge/features/graphrag/viewer)
> **示例类型**：调试工具 · **难度**：进阶

## 概述

`features/graphrag/viewer/` 是 [`graphrag`](./knowledge-features-graphrag.md) 的配套可视化工具：一个嵌入式 Web 服务，读取 Apache AGE 里的图数据，提供节点搜索、邻居展开、路径查找、元数据过滤等只读 API 和前端页面。专为**本地调试** GraphRAG 数据设计，不用于生产。

## 核心概念

### 只读 + 本地定位

viewer 明确**只读**——所有 API 都是 SELECT，不会修改图数据。同时定位为本地调试工具：

```go
// viewer/main.go
log.Printf("AGE graph viewer listening on http://%s", *addr)
```

绑定地址默认 `127.0.0.1:3012`，不对外暴露。

### 嵌入式静态资源

```go
//go:embed index.html
var content embed.FS
```

前端页面用 `go:embed` 打进二进制，部署时单文件即可，无需额外静态资源目录。

### AGE 连接池 + Session 初始化

AGE 的特殊之处：每条连接都要执行 `LOAD 'age'` + `SET search_path` 才能用 Cypher。viewer 在连接池里每次 checkout 都做这套初始化：

```go
func (s *server) ageConn(ctx context.Context) (*sql.Conn, error) {
    conn, err := s.db.Conn(ctx)
    if err != nil { return nil, err }
    if _, err := conn.ExecContext(ctx, ageLoadSQL); err != nil { ... }       // LOAD 'age'
    if _, err := conn.ExecContext(ctx, ageSearchPathSQL); err != nil { ... } // SET search_path
    return conn, nil
}
```

连接池上限 4（`maxPoolConns = 4`），因为每个连接都要独立初始化 AGE session。

## 代码解析

### 四个核心 API

```go
mux.Handle("/", http.FileServer(http.FS(static)))     // 静态页面
mux.HandleFunc("/api/graph", s.handleGraph)            // 加载图（支持搜索/过滤）
mux.HandleFunc("/api/neighbors", s.handleNeighbors)    // 节点邻居
mux.HandleFunc("/api/path", s.handlePath)              // 两点路径
mux.HandleFunc("/api/summary", s.handleSummary)        // 边类型统计
mux.HandleFunc("/api/health", s.handleHealth)          // 健康检查
```

| API | 功能 | 关键参数 |
|-----|------|---------|
| `/api/graph` | 加载图（可搜索种子） | `query`、`query_field`、`metadata`、`edge_type`、`node_limit` |
| `/api/neighbors` | 某节点的一跳邻居 | `id`（节点属性 id）、`edge_type` |
| `/api/path` | 两节点间路径 | `from_id`、`to_id`（max_depth=4） |
| `/api/summary` | 边类型计数统计 | 无 |

### 元数据过滤语法

`metadata` 参数支持 `key=value` 的 glob 匹配，多个条件用 `;` AND 组合：

```
trpc_ast_package=knowledge*
trpc_ast_file_path=*graph*
trpc_ast_type=Method
trpc_ast_package=knowledge*;trpc_ast_type=Function    ← AND
```

`*` 是通配符。这让 viewer 能按"包名前缀 + 类型"等条件快速聚焦子图。

### 种子搜索的字段选择

`query_field` 控制在哪个字段做 substring 匹配：

| query_field | 搜索字段 | limit 调整 |
|-------------|---------|-----------|
| `id` | 节点 id 属性 | 默认 |
| `name` | 节点 name（默认） | 默认 |
| `content` | 节点 content（全文） | ≤5（避免慢查询） |
| `metadata.<key>` | 元数据字段 | 看字段（comment 也限 5） |

全文字段（content / trpc_ast_comment）强制 limit ≤5，避免 AGE 全表扫描超时。

### Cypher 查询构造

viewer 用 `cypherSQL` 把 Cypher 包成 SQL：

```go
func (s *server) cypherSQL(cypher, columns string) string {
    return fmt.Sprintf("SELECT * FROM cypher(%s, %s) AS (%s)",
        sqlString(s.graphName), dollarQuote(cypher), columns)
}
```

`dollarQuote` 用 `$$` 风格引用 Cypher 文本，避免单引号转义地狱。

## 运行方式

### 前置：已有 AGE 图数据

viewer 不创建图，只读取。先用 [`graphrag`](./knowledge-features-graphrag.md) `-recreate=true` 加载一次仓库。

### 环境变量

与 graphrag 共用 AGE 配置：

| 变量 | 说明 | 默认值 |
|------|------|--------|
| `AGE_HOST` / `AGE_PORT` / `AGE_USER` / `AGE_PASSWORD` / `AGE_DATABASE` | AGE 连接 | `127.0.0.1:5432/root/123/contextengine` |
| `AGE_GRAPH_NAME` | 图名 | `knowledge_graph` |
| `AGE_DSN` | 整 DSN（最高优先级） | — |
| `GRAPH_VIEWER_ADDR` | 监听地址 | `127.0.0.1:3012` |

### 命令行参数

| 参数 | 说明 | 默认值 |
|------|------|--------|
| `-addr` | HTTP 监听地址 | `GRAPH_VIEWER_ADDR` 或 `127.0.0.1:3012` |
| `-graph` | 图名 | `AGE_GRAPH_NAME` 或 `knowledge_graph` |
| `-node-limit` | 默认节点上限 | `100` |
| `-edge-limit` | 默认边上限 | `1000` |
| `-seed-limit` | 种子搜索上限 | `12` |
| `-search-timeout` | 语句超时 | `8s` |

### 运行命令

```bash
cd examples/knowledge/features/graphrag

# 启动 viewer（与 graphrag chat 共用 AGE 数据）
go run ./viewer

# 自定义端口和限制
go run ./viewer -addr=127.0.0.1:3012 -node-limit=200 -edge-limit=2000

# 远程访问（绑定 0.0.0.0）
go run ./viewer -addr=0.0.0.0:3012
```

打开 `http://127.0.0.1:3012`。

### 页面交互

- 顶部搜索框：输入关键字 + 选字段（id/name/content/metadata.*）
- 元数据过滤：填 `key=value`（支持 `*` 通配，`;` AND）
- 边类型过滤：勾选要显示的边类型（CALLS / IMPLEMENTS / METHOD / FIELD 等）
- 节点点击：展开邻居（调 `/api/neighbors`）
- 路径查找：选两个节点查连接路径

## 适用场景与对比

**用 viewer 当：**
- 调试 GraphRAG 加载结果（节点数对不对、边类型分布）
- 验证 Agent 的 traverse 结果是否合理
- 给同事演示代码图结构
- 排查"为什么 Agent 没找到 X"（手动 search 看种子是否命中）

**对比 graphrag chat：**

| 维度 | graphrag chat | viewer |
|------|---------------|--------|
| 交互 | 自然语言 | 表单 + 点击 |
| 自动化 | LLM 自主 | 人工驱动 |
| 适合 | 问答 | 调试/探索 |
| 改数据 | ❌ | ❌（只读） |

## 关键要点

1. **只读调试工具**：所有 API 都是 SELECT，安全。
2. **嵌入式部署**：`go:embed` 打包前端，单二进制。
3. **AGE session 初始化**：连接池每次 checkout 都 `LOAD 'age'` + `SET search_path`。
4. **元数据 glob 过滤**：`key=value` + `*` 通配 + `;` AND。
5. **全文字段限速**：content/comment 强制 limit ≤5 防 AGE 超时。

## 总结

viewer 是 GraphRAG 的"调试眼睛"——让你看见 AGE 里到底存了什么、Agent 的 traverse 走到了哪里。开发期必备，配合 [`graphrag`](./knowledge-features-graphrag.md) chat 形成"可视探索 + 自然语言问答"的双轨调试。生产环境不建议对外暴露（默认绑 127.0.0.1）。
