# MCP Broker - 按需发现与调用的工具代理模式

## 概述

MCP Broker 解决了传统 MCP 集成中的"工具膨胀"问题：当远程 MCP 服务器提供大量工具时，全部展开到 Agent 的工具列表会消耗过多 token 并降低模型决策质量。Broker 模式将 MCP 工具暴露为四个元工具（`mcp_list_servers`、`mcp_list_tools`、`mcp_inspect_tools`、`mcp_call`），让模型按需发现、检查和调用具体工具。

## 核心概念

### Broker 元工具

| 元工具 | 作用 |
|--------|------|
| `mcp_list_servers` | 列出已注册的命名 MCP 服务器 |
| `mcp_list_tools` | 获取指定服务器的工具轻量摘要（名称、签名、描述） |
| `mcp_inspect_tools` | 展开指定工具的完整 JSON Schema |
| `mcp_call` | 通过 selector（如 `server.tool_name`）调用具体工具 |

### Ad-Hoc HTTP 支持

启用 `WithAllowAdHocHTTP(true)` 后，模型可以直接使用 URL 作为 selector 连接未预注册的 HTTP MCP 服务，结合 Skill 系统实现动态端点发现。

### Auth Hook

`authhooks` 子示例展示了两个安全扩展点：

- **HTTPHeaderInjector**：从 `context.Context` 提取用户凭证并注入 Authorization 头
- **ErrorInterceptor**：拦截并包装认证错误，向模型返回业务语义明确的提示

## 代码解析

### 1. 创建 Broker（basic 示例）

```go
broker := mcpbroker.New(
    mcpbroker.WithServers(map[string]mcpcfg.ConnectionConfig{
        "local_stdio_code": {
            Transport: "stdio",
            Command:   "go",
            Args:      []string{"run", serverPath},
            Timeout:   10 * time.Second,
            Description: "Project management and documentation tools.",
        },
    }),
    mcpbroker.WithAllowAdHocHTTP(true),
)
```

Broker 注册一个名为 `local_stdio_code` 的 STDIO MCP 服务器，该服务器提供 echo、add、issue 管理、文档搜索、日历、会议等 10+ 工具。

### 2. 结合 Skill 系统发现远程端点

```go
repo, _ := skill.NewFSRepository(skillsDir)
llmAgent := llmagent.New(agentName,
    llmagent.WithTools(broker.Tools()),
    llmagent.WithSkills(repo),
    llmagent.WithSkillToolProfile(llmagent.SkillToolProfileKnowledgeOnly),
)
```

示例在进程内启动一个 Streamable HTTP MCP 服务器，并通过 Skill 文件告知模型该端点的 URL。模型加载 Skill 后，使用 `mcp_list_tools` 对该 URL 进行工具发现，再通过 `mcp_call` 调用。

### 3. Auth Hook 实现（authhooks 示例）

```go
broker := mcpbroker.New(
    mcpbroker.WithHTTPHeaderInjector(func(ctx context.Context, req *mcpbroker.HeaderInjectRequest) (map[string]string, error) {
        value, _ := ctx.Value(userTokenKey).(string)
        if value == "" { return nil, nil }
        return map[string]string{"Authorization": "Bearer " + value}, nil
    }),
    mcpbroker.WithErrorInterceptor(func(ctx context.Context, req *mcpbroker.BrokerErrorRequest) (*mcpbroker.BrokerErrorDecision, error) {
        if strings.Contains(strings.ToLower(req.Err.Error()), "unauthorized") {
            return &mcpbroker.BrokerErrorDecision{
                Handled:   true,
                WrapError: fmt.Errorf("authorization required for %s", req.BaseURL),
            }, nil
        }
        return nil, nil
    }),
)
```

认证信息通过 `context.Context` 传递而非模型可见参数，确保凭证不会泄露到提示词中。

### 4. 模型交互流程

典型的 Broker 调用链：

```
用户: 创建一个标题为"Demo"的日历事件
模型: mcp_list_servers → 发现 local_stdio_code
模型: mcp_list_tools(selector="local_stdio_code") → 获取工具列表
模型: mcp_inspect_tools(selector="local_stdio_code", tools=["calendar_create"]) → 获取 Schema
模型: mcp_call(selector="local_stdio_code.calendar_create", arguments={...}) → 执行
```

## 运行方式

```bash
# basic 示例：交互式对话
cd examples/mcpbroker/basic
export OPENAI_API_KEY="your-key"
go run .

# authhooks 示例：直接调用（无需 LLM）
cd examples/mcpbroker/authhooks
go run .                    # 命名服务器模式
go run . -mode adhoc        # Ad-Hoc URL 模式
```

basic 示例中输入 `/tips` 可查看推荐提示词，如 "Use local_stdio_code to add 12 and 30"。

## 总结

MCP Broker 模式的核心优势在于将 MCP 工具目录从"全量展开"变为"按需探索"，显著减少了 Agent 上下文中的工具数量。结合 Skill 系统，可以实现完全动态的 MCP 端点发现，而 Auth Hook 机制确保了安全凭证与模型上下文的隔离。这种模式特别适合工具数量庞大或需要跨团队集成的生产场景，是 mcptool 示例中直接集成方式的进阶替代方案。
