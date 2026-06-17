# 工具调用重试 - 框架级别的工具执行失败重试

## 概述

`llmagent_tool_call_retry` 示例演示框架级别的工具调用重试机制。当工具执行因瞬态错误（如网络超时、服务暂时不可用）失败时，框架可以自动按照配置的重试策略重新执行工具，而无需将错误返回给 LLM 触发新一轮推理。这显著提高了 Agent 在不稳定环境下的可靠性。

## 核心概念

**工具调用重试**的作用范围是单次工具调用，而非整个 Agent 运行。框架在工具执行失败后：
1. 按照 `RetryPolicy` 配置的退避策略等待
2. 重新调用同一个工具（相同参数）
3. 重复直到成功或达到最大重试次数

关键配置项：
- `MaxAttempts`：最大尝试次数（包含首次调用）
- `InitialInterval`：首次重试前的等待时间
- `BackoffFactor`：退避倍数（每次重试等待时间乘以此因子）
- `MaxInterval`：最大等待时间上限

## 代码解析

### 创建故意失败的工具

示例使用一个"不稳定"的天气服务，前 N 次调用会失败：

```go
type flakyWeatherService struct {
    mu                sync.Mutex
    failuresRemaining int
    attempts          int
}

func (s *flakyWeatherService) getWeather(ctx context.Context, args weatherArgs) (map[string]any, error) {
    s.mu.Lock()
    s.attempts++
    shouldFail := s.failuresRemaining > 0
    if shouldFail {
        s.failuresRemaining--
    }
    s.mu.Unlock()

    if shouldFail {
        return nil, io.ErrUnexpectedEOF  // 模拟瞬态错误
    }
    return map[string]any{"forecast": "sunny"}, nil
}
```

### 配置重试策略

通过 `llmagent.WithToolCallRetryPolicy` 启用重试：

```go
policy := &tool.RetryPolicy{
    MaxAttempts:     2,                    // 最多尝试 2 次
    InitialInterval: 200 * time.Millisecond, // 首次重试等待 200ms
    BackoffFactor:   2.0,                  // 退避倍数
    MaxInterval:     2 * time.Second,      // 最大等待时间
}

agent := llmagent.New("demo",
    llmagent.WithTools([]tool.Tool{weatherTool}),
    llmagent.WithToolCallRetryPolicy(policy),
)
```

### A/B 对比运行

示例运行两个场景进行对比：

```go
func run() error {
    // 场景一：无重试策略 → 工具失败后直接返回错误
    runScenario("without_retry", *failCount, nil, false)

    // 场景二：有重试策略 → 工具失败后自动重试直到成功
    policy := &tool.RetryPolicy{MaxAttempts: *failCount + 1, ...}
    runScenario("with_retry", *failCount, policy, true)
}
```

### 预期输出

```
== without_retry ==
tool attempt 1 for Shenzhen
result: failed after 1 attempt(s): Error: unexpected EOF

== with_retry ==
tool attempt 1 for Shenzhen
tool attempt 2 for Shenzhen
result: succeeded after 2 attempt(s)
tool response: {"forecast":"sunny","location":"Shenzhen"}
```

## 运行方式

```bash
cd examples
export OPENAI_API_KEY="your-key"
go run ./llmagent_tool_call_retry -model deepseek-v4-flash

# 自定义参数
go run ./llmagent_tool_call_retry \
    -location Shanghai \
    -fail 2 \
    -backoff 300ms
```

## 总结

- 工具调用重试是框架级功能，无需修改工具实现代码
- 重试范围限定在单次工具调用，不会重复整个 Agent 运行
- 指数退避策略（`BackoffFactor`）避免对下游服务造成压力
- 默认仅重试返回 `error` 的工具调用；如需重试结果级别的失败（如 MCP 的 `isError=true`），可提供自定义的 `RetryOn` 函数
- 该机制与 [toolpolicy](./toolpolicy.md) 的权限控制互补：权限决定"能不能调"，重试解决"调不通怎么办"
