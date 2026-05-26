# io.agentscope.core.tool — 工具包文档

## 定义工具

工具是带 `@Tool` 注解的 Java 方法：

```java
public class WeatherTools {
    @Tool(name = "get_weather", description = "Get current weather for a city")
    public String getWeather(
            @ToolParam(name = "city", description = "City name") String city) {
        return "Sunny, 25°C";
    }
}
```

**返回类型**：`String`（同步）、`Mono<String>`（异步）、`Mono<ToolResultBlock>`（复杂结果）。

## 注册方式

| 方式 | 说明 |
|---|---|
| `toolkit.registerTool(new MyTools())` | 扫描 `@Tool` 方法 |
| `toolkit.registerAgentTool(customAgentTool)` | 直接注册 `AgentTool` 实例 |
| `toolkit.registration().tool(obj).group("g").presetParameters(map).apply()` | 带选项的流式 API |
| `toolkit.registration().mcpClient(wrapper).enableTools(list).apply()` | MCP 集成 |
| `toolkit.registration().subAgent(provider, config).apply()` | 子 Agent 作为工具 |

## 工具组

工具可组织为组用于动态激活：

```java
toolkit.createToolGroup("research", "Research tools", false); // 初始不活跃
toolkit.registration().tool(new ResearchTools()).group("research").apply();
toolkit.updateToolGroups(List.of("research"), true); // 激活
```

元工具 `reset_equipped_tools` 允许 Agent 自主管理组。

## 执行流程

1. LLM 在推理输出中返回 `ToolUseBlock`
2. `ToolExecutor` 验证并通过 `ToolMethodInvoker` 执行工具
3. 结果通过 `ToolResultConverter` 转为 `ToolResultBlock`
4. 结果作为 `ToolResultBlock` 内容添加到内存
5. 下一次推理迭代处理工具结果

## MCP 集成

`McpClientManager` 管理 MCP（Model Context Protocol）客户端生命周期：

```java
McpClientWrapper client = McpClientBuilder.stdio()
    .command("npx").args("-y", "@modelcontextprotocol/server-filesystem@0.6.2", "/path")
    .build();
toolkit.registration().mcpClient(client).enableTools(List.of("read_file", "write_file")).apply();
```

## 线程安全

`Toolkit` 是线程安全的。工具注册使用内部的 `CopyOnWriteArrayList`。工具执行可配置为并行或顺序。

## 相关文档

- [核心包](../core.md)
- [模型包](model.md)
