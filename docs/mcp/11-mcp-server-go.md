# Go MCP Server 实战 — 基于 tRPC-MCP-Go

> 利用 tRPC-MCP-Go 构建生产级 MCP Server，与 tRPC-Agent-Go 无缝集成。

## 1. 环境搭建

```bash
go mod init my-mcp-server
go get trpc.group/trpc-go/trpc-mcp-go
```

## 2. 最简 Server

```go
package main

import (
    "context"
    "fmt"
    mcp "trpc.group/trpc-go/trpc-mcp-go"
)

func main() {
    server := mcp.NewServer("my-go-server", "1.0.0")

    server.RegisterTool(mcp.Tool{
        Name:        "hello",
        Description: "Say hello to someone",
        InputSchema: mcp.ToolInputSchema{
            Type: "object",
            Properties: map[string]mcp.ToolProperty{
                "name": {Type: "string", Description: "Name to greet"},
            },
            Required: []string{"name"},
        },
    }, func(ctx context.Context, args map[string]any) (*mcp.CallToolResult, error) {
        name, _ := args["name"].(string)
        return mcp.NewTextResult(fmt.Sprintf("Hello, %s!", name)), nil
    })

    if err := server.Run(mcp.NewStdioTransport()); err != nil {
        panic(err)
    }
}
```

## 3. 生产级 Server：文件 + 数据库 + HTTP

```go
package main

import (
    "context"
    "database/sql"
    "encoding/json"
    "fmt"
    "io"
    "net/http"
    "os"
    "path/filepath"
    "strings"
    "time"

    _ "github.com/mattn/go-sqlite3"
    mcp "trpc.group/trpc-go/trpc-mcp-go"
)

var (
    workDir string
    db      *sql.DB
)

func main() {
    workDir = os.Getenv("WORK_DIR")
    if workDir == "" {
        workDir = "./workspace"
    }
    os.MkdirAll(workDir, 0755)

    dbPath := os.Getenv("DB_PATH")
    if dbPath == "" {
        dbPath = "data.db"
    }
    var err error
    db, err = sql.Open("sqlite3", dbPath)
    if err != nil {
        panic(err)
    }
    defer db.Close()

    server := mcp.NewServer("developer-toolkit-go", "1.0.0")
    registerTools(server)

    if err := server.Run(mcp.NewStdioTransport()); err != nil {
        panic(err)
    }
}

func registerTools(server *mcp.Server) {
    server.RegisterTool(mcp.Tool{
        Name: "read_file", Description: "读取工作目录下的文件内容",
        InputSchema: mcp.ToolInputSchema{
            Type: "object",
            Properties: map[string]mcp.ToolProperty{
                "path": {Type: "string", Description: "文件路径（相对于工作目录）"},
            },
            Required: []string{"path"},
        },
    }, handleReadFile)

    server.RegisterTool(mcp.Tool{
        Name: "write_file", Description: "写入内容到文件（原子写入）",
        InputSchema: mcp.ToolInputSchema{
            Type: "object",
            Properties: map[string]mcp.ToolProperty{
                "path":    {Type: "string", Description: "文件路径"},
                "content": {Type: "string", Description: "文件内容"},
            },
            Required: []string{"path", "content"},
        },
    }, handleWriteFile)

    server.RegisterTool(mcp.Tool{
        Name: "search_files", Description: "在工作目录中搜索文件",
        InputSchema: mcp.ToolInputSchema{
            Type: "object",
            Properties: map[string]mcp.ToolProperty{
                "pattern":     {Type: "string", Description: "文件名匹配模式，如 *.go"},
                "content":     {Type: "string", Description: "文件内容搜索关键词"},
                "max_results": {Type: "integer", Description: "最大结果数", Default: json.Number("10")},
            },
        },
    }, handleSearchFiles)

    server.RegisterTool(mcp.Tool{
        Name: "query_database", Description: "执行只读 SQL 查询",
        InputSchema: mcp.ToolInputSchema{
            Type: "object",
            Properties: map[string]mcp.ToolProperty{
                "query": {Type: "string", Description: "SELECT SQL 查询"},
            },
            Required: []string{"query"},
        },
    }, handleQueryDB)

    server.RegisterTool(mcp.Tool{
        Name: "http_request", Description: "执行 HTTP GET/POST 请求",
        InputSchema: mcp.ToolInputSchema{
            Type: "object",
            Properties: map[string]mcp.ToolProperty{
                "url":             {Type: "string", Description: "请求 URL"},
                "method":          {Type: "string", Description: "HTTP 方法", Enum: []string{"GET", "POST"}},
                "body":            {Type: "string", Description: "请求体（JSON，仅 POST）"},
                "timeout_seconds": {Type: "integer", Description: "超时（秒）", Default: json.Number("10")},
            },
            Required: []string{"url"},
        },
    }, handleHTTPRequest)
}

func safePath(userPath string) (string, error) {
    workDirAbs, _ := filepath.Abs(workDir)
    fullPath, _ := filepath.Abs(filepath.Join(workDir, userPath))
    if !strings.HasPrefix(fullPath, workDirAbs) {
        return "", fmt.Errorf("路径遍历被阻止: %s", userPath)
    }
    return fullPath, nil
}

func handleReadFile(ctx context.Context, args map[string]any) (*mcp.CallToolResult, error) {
    path := args["path"].(string)
    fullPath, err := safePath(path)
    if err != nil {
        return mcp.NewErrorResult(err.Error()), nil
    }
    info, err := os.Stat(fullPath)
    if err != nil {
        return mcp.NewErrorResult("文件不存在"), nil
    }
    if info.Size() > 10*1024*1024 {
        return mcp.NewErrorResult("文件过大 (>10MB)"), nil
    }
    content, _ := os.ReadFile(fullPath)
    if len(content) > 100_000 {
        content = append(content[:100_000], []byte("\n\n...(已截断)")...)
    }
    return mcp.NewTextResult(string(content)), nil
}

func handleWriteFile(ctx context.Context, args map[string]any) (*mcp.CallToolResult, error) {
    path := args["path"].(string)
    fullPath, err := safePath(path)
    if err != nil {
        return mcp.NewErrorResult(err.Error()), nil
    }
    os.MkdirAll(filepath.Dir(fullPath), 0755)
    tmp := fullPath + ".tmp"
    os.WriteFile(tmp, []byte(args["content"].(string)), 0644)
    os.Rename(tmp, fullPath)
    info, _ := os.Stat(fullPath)
    return mcp.NewTextResult(fmt.Sprintf("✅ 已写入: %s (%d bytes)", path, info.Size())), nil
}

func handleSearchFiles(ctx context.Context, args map[string]any) (*mcp.CallToolResult, error) {
    pattern, _ := args["pattern"].(string)
    content, _ := args["content"].(string)
    maxResults := 10

    var results []string
    filepath.Walk(workDir, func(path string, info os.FileInfo, err error) error {
        if err != nil || info.IsDir() || len(results) >= maxResults || strings.HasSuffix(path, ".tmp") {
            return nil
        }
        relPath, _ := filepath.Rel(workDir, path)

        nameMatch := pattern == ""
        if !nameMatch {
            matched, _ := filepath.Match(pattern, filepath.Base(path))
            nameMatch = matched
        }
        contentMatch := content == ""
        if !contentMatch && info.Size() < 1*1024*1024 {
            data, _ := os.ReadFile(path)
            if strings.Contains(string(data), content) {
                contentMatch = true
            }
        }
        if nameMatch || contentMatch {
            results = append(results, fmt.Sprintf("  %s (%s, %d bytes)", relPath, info.ModTime().Format("2006-01-02"), info.Size()))
        }
        return nil
    })

    if len(results) == 0 {
        return mcp.NewTextResult("🔍 未找到匹配文件"), nil
    }
    return mcp.NewTextResult(fmt.Sprintf("🔍 %d 个文件:\n%s", len(results), strings.Join(results, "\n"))), nil
}

func handleQueryDB(ctx context.Context, args map[string]any) (*mcp.CallToolResult, error) {
    query := strings.TrimSpace(args["query"].(string))
    if !strings.HasPrefix(strings.ToUpper(query), "SELECT") {
        return mcp.NewErrorResult("仅允许 SELECT"), nil
    }
    dangerous := []string{"DROP", "DELETE", "UPDATE", "INSERT", "ALTER", "CREATE", "TRUNCATE"}
    for _, kw := range dangerous {
        if strings.Contains(strings.ToUpper(query), kw) {
            return mcp.NewErrorResult(fmt.Sprintf("禁止操作: %s", kw)), nil
        }
    }
    rows, err := db.QueryContext(ctx, query)
    if err != nil {
        return mcp.NewErrorResult(fmt.Sprintf("查询错误: %v", err)), nil
    }
    defer rows.Close()

    columns, _ := rows.Columns()
    var result strings.Builder
    result.WriteString(strings.Join(columns, " | ") + "\n")
    result.WriteString(strings.Repeat("-", len(strings.Join(columns, " | "))) + "\n")

    values := make([]any, len(columns))
    valuePtrs := make([]any, len(columns))
    for i := range columns {
        valuePtrs[i] = &values[i]
    }

    lineCount := 0
    for rows.Next() && lineCount < 50 {
        rows.Scan(valuePtrs...)
        var rowVals []string
        for _, v := range values {
            switch val := v.(type) {
            case nil:
                rowVals = append(rowVals, "NULL")
            case []byte:
                rowVals = append(rowVals, string(val))
            default:
                rowVals = append(rowVals, fmt.Sprintf("%v", val))
            }
        }
        result.WriteString(strings.Join(rowVals, " | ") + "\n")
        lineCount++
    }
    return mcp.NewTextResult(result.String()), nil
}

func handleHTTPRequest(ctx context.Context, args map[string]any) (*mcp.CallToolResult, error) {
    url := args["url"].(string)
    method := "GET"
    if m, ok := args["method"].(string); ok && m == "POST" {
        method = "POST"
    }
    timeout := 10

    client := &http.Client{Timeout: time.Duration(timeout) * time.Second}
    var body io.Reader
    if method == "POST" {
        if b, ok := args["body"].(string); ok {
            body = strings.NewReader(b)
        }
    }
    req, _ := http.NewRequestWithContext(ctx, method, url, body)
    req.Header.Set("Content-Type", "application/json")
    resp, err := client.Do(req)
    if err != nil {
        return mcp.NewErrorResult(fmt.Sprintf("请求失败: %v", err)), nil
    }
    defer resp.Body.Close()
    respBody, _ := io.ReadAll(io.LimitReader(resp.Body, 50*1024))
    return mcp.NewTextResult(fmt.Sprintf("📡 %s %s\n状态: %d\n%s", method, url, resp.StatusCode, string(respBody))), nil
}
```

## 4. 与 tRPC-Agent-Go 集成

```go
toolSet := mcp.NewMCPToolSet(mcp.ConnectionConfig{
    Transport: "stdio",
    Command:   "go",
    Args:      []string{"run", "./server.go"},
    Env:       []string{"WORK_DIR=./workspace"},
})
defer toolSet.Close()

agent := llmagent.New("go-assistant",
    llmagent.WithModel(openai.New("deepseek-chat")),
    llmagent.WithToolSets([]tool.ToolSet{toolSet}),
)
```
