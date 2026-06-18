# A2A 多路径示例 - 单端口暴露多个 Agent 服务

## 概述

本示例演示如何在单个 HTTP 端口上通过不同的 URL 路径暴露多个 A2A Agent。每个 Agent 拥有独立的 base path，客户端通过选择不同的 URL 来访问目标 Agent，无需额外的路由参数。这是生产环境中部署多 Agent 服务的推荐模式。

## 核心概念

### 路径路由（Path-based Routing）

与传统的通过参数区分 Agent 不同，A2A 多路径模式为每个 Agent 分配独立的 URL 路径前缀：

- Math Agent: `http://localhost:8888/agents/math`
- Weather Agent: `http://localhost:8888/agents/weather`

每个 Agent 的 Agent Card 也对应独立路径：
- `http://localhost:8888/agents/math/.well-known/agent-card.json`
- `http://localhost:8888/agents/weather/.well-known/agent-card.json`

### Handler 挂载

核心思路是为每个 Agent 创建独立的 A2A Server 实例，然后将各自的 `Handler()` 挂载到共享的 `http.ServeMux` 上，最终由一个 `http.Server` 统一监听。

## 代码解析

**1. 创建多个 A2A Server 实例**

```go
mathServer, err := a2a.New(
    a2a.WithHost(baseURL+mathBasePath),    // http://localhost:8888/agents/math
    a2a.WithAgent(mathAgent, false),
)

weatherServer, err := a2a.New(
    a2a.WithHost(baseURL+weatherBasePath), // http://localhost:8888/agents/weather
    a2a.WithAgent(weatherAgent, false),
)
```

`WithHost` 接收完整的 URL（含路径前缀），框架据此生成对应路径下的 Agent Card 和 A2A 端点。

**2. 挂载到共享 HTTP Mux**

```go
mux := http.NewServeMux()
mux.Handle("/agents/math/", mathServer.Handler())
mux.Handle("/agents/weather/", weatherServer.Handler())
mux.HandleFunc("/", handleIndex(baseURL))

server := &http.Server{
    Addr:    *listenAddr,
    Handler: mux,
}
server.ListenAndServe()
```

每个 A2A Server 的 `Handler()` 方法返回一个标准的 `http.Handler`，可以直接挂载到任意路由模式下。注意路由模式需要以 `/` 结尾以匹配子路径。

**3. 自定义 Echo Agent**

```go
type echoAgent struct {
    name        string
    description string
}

func (a *echoAgent) Run(ctx context.Context, invocation *agent.Invocation) (<-chan *event.Event, error) {
    out := make(chan *event.Event, 8)
    go func() {
        defer close(out)
        content := "Hello from " + a.name + ". You said: " + invocation.Message.Content
        rsp := &model.Response{
            Choices: []model.Choice{{
                Message: model.NewAssistantMessage(content),
                FinishReason: strPtr("stop"),
            }},
            Done: true,
        }
        evt := event.NewResponseEvent(invocation.InvocationID, a.name, rsp)
        _ = agent.EmitEvent(ctx, invocation, out, evt)
    }()
    return out, nil
}
```

示例使用简单的 Echo Agent 来验证路由功能。它实现了 `agent.Agent` 接口，将用户消息原样回显，附带 Agent 名称标识。注意使用 `agent.EmitEvent` 发送事件的规范方式。

**4. 客户端直接使用 A2A 原生协议**

```go
c, err := client.NewA2AClient(*agentURL)
msg := protocol.NewMessage(protocol.MessageRoleUser, []protocol.Part{
    protocol.NewTextPart(*message),
})
rsp, err := c.SendMessage(ctx, protocol.SendMessageParams{Message: msg})
```

客户端直接使用 `trpc-a2a-go/client` 包的原生 A2A 客户端，通过 `-url` 参数指定目标 Agent 的完整路径，实现路由选择。

## 运行方式

**启动服务端：**

```bash
cd examples/a2amultipath
go run ./server
```

**发送请求：**

```bash
# 访问 Math Agent
go run ./client -url http://localhost:8888/agents/math -msg "2+2"

# 访问 Weather Agent
go run ./client -url http://localhost:8888/agents/weather -msg "How is it?"

# 查看 Agent Card
curl http://localhost:8888/agents/math/.well-known/agent-card.json
curl http://localhost:8888/agents/weather/.well-known/agent-card.json
```

**预期输出：**

```
Hello from math-agent. You said: 2+2
```

## 总结

本示例展示了生产环境中多 Agent 部署的推荐模式。关键收获：

- 通过 `a2a.WithHost(url+path)` 为每个 Agent 指定独立的 URL 前缀
- `server.Handler()` 返回标准 `http.Handler`，可灵活挂载到任意路由框架
- 单端口多 Agent 模式简化了运维部署，客户端通过 URL 路径自然选择目标 Agent

进一步学习可参考 **a2aagent** 示例了解 A2A 服务器的完整配置选项，以及 **a2asubagent** 示例了解多 Agent 协作调度。
