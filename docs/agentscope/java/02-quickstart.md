# AgentScope Java 快速入门

## 1. 环境准备

### 1.1 基本要求

- **JDK 17+**：框架使用 sealed class、switch 模式匹配等 Java 17+ 特性
- **Maven 3.8+**：项目构建工具

### 1.2 添加依赖

在 `pom.xml` 中添加 AgentScope 依赖：

```xml
<dependency>
    <groupId>io.agentscope</groupId>
    <artifactId>agentscope-core</artifactId>
    <version>最新版本</version>
</dependency>
```

### 1.3 配置模型 API Key

AgentScope 通过环境变量自动读取 API Key（`ModelRegistry.java:43-106`）：

```bash
# 根据使用的模型供应商设置对应的环境变量
export OPENAI_API_KEY="sk-..."
export DASHSCOPE_API_KEY="sk-..."
export GEMINI_API_KEY="..."
export ANTHROPIC_API_KEY="sk-ant-..."
# Ollama 可选，默认 http://localhost:11434
export OLLAMA_BASE_URL="http://localhost:11434"
```

## 2. 最简 Agent

创建一个最基本的 ReAct Agent（`ReActAgent.java:140`）：

```java
import io.agentscope.core.ReActAgent;
import io.agentscope.core.memory.InMemoryMemory;
import io.agentscope.core.message.Msg;
import io.agentscope.core.message.MsgRole;
import io.agentscope.core.message.TextBlock;
import io.agentscope.core.model.ModelRegistry;

// 通过 ModelRegistry 解析模型（ModelRegistry.java:142）
// 格式："provider:model-name"
ReActAgent agent = ReActAgent.builder()
        .name("my_agent")                          // Agent 名称
        .description("A helpful assistant")         // Agent 描述
        .sysPrompt("你是一个有帮助的AI助手。")       // 系统提示词
        .model(ModelRegistry.resolve("openai:gpt-4o"))  // 模型解析
        .memory(new InMemoryMemory())               // 短期记忆
        .maxIters(10)                               // 最大迭代次数
        .build();

// 构造用户消息（Msg.java:53）
Msg userMsg = Msg.builder()
        .name("user")
        .role(MsgRole.USER)
        .content(TextBlock.builder().text("你好！").build())
        .build();

// 同步调用（CallableAgent.java:114）
Msg response = agent.call(userMsg).block();

// 获取文本内容（Msg.java:382-388）
System.out.println(response.getTextContent());
```

**Builder 参数说明**（`ReActAgent.java:172-194`）：

| 参数 | 类型 | 说明 |
|------|------|------|
| `name` | String | Agent 名称（必填） |
| `description` | String | Agent 描述 |
| `sysPrompt` | String | 系统提示词 |
| `model` | Model | LLM 模型实例（必填） |
| `toolkit` | Toolkit | 工具集 |
| `memory` | Memory | 短期记忆实现 |
| `maxIters` | int | 最大迭代次数，默认 10 |
| `hooks` | List\<Hook\> | Hook 列表 |
| `modelExecutionConfig` | ExecutionConfig | 模型执行配置 |
| `toolExecutionConfig` | ExecutionConfig | 工具执行配置 |
| `generateOptions` | GenerateOptions | 生成选项 |

## 3. 流式调用

流式调用允许实时接收 Agent 执行过程中的事件（`StreamableAgent.java:131`）：

```java
import io.agentscope.core.agent.Event;
import io.agentscope.core.agent.EventType;
import io.agentscope.core.agent.StreamOptions;

// 默认流式选项
Flux<Event> events = agent.stream(userMsg);

// 自定义流式选项：指定要接收的事件类型
StreamOptions options = StreamOptions.builder()
        .eventTypes(EnumSet.of(EventType.REASONING, EventType.TOOL_RESULT))
        .build();

Flux<Event> events = agent.stream(userMsg, options);

// 订阅事件流
events.subscribe(event -> {
    switch (event.getType()) {
        case REASONING -> {
            // 推理事件（EventType.java:35）
            String text = event.getMessage().getTextContent();
            if (event.isLast()) {
                System.out.println("\n[推理完成]");
            } else {
                System.out.print(text);  // 流式输出
            }
        }
        case TOOL_RESULT -> {
            // 工具结果事件（EventType.java:47）
            System.out.println("[工具结果] " + event.getMessage().getTextContent());
        }
        case AGENT_RESULT -> {
            // 最终结果事件（EventType.java:74）
            System.out.println("[最终结果] " + event.getMessage().getTextContent());
        }
        default -> {}
    }
});
```

**Event 结构**（`Event.java:51`）：

| 字段 | 类型 | 说明 |
|------|------|------|
| `type` | EventType | 事件类型 |
| `message` | Msg | 消息内容 |
| `isLast` | boolean | 是否为该消息的最后一块 |
| `source` | EventSource | 来源子 Agent（可为 null） |

## 4. 自定义 @Tool

### 4.1 基本工具定义

使用 `@Tool` 和 `@ToolParam` 注解定义工具（`Tool.java:60`，`ToolParam.java:62`）：

```java
import io.agentscope.core.tool.Tool;
import io.agentscope.core.tool.ToolParam;
import io.agentscope.core.tool.Toolkit;

public class WeatherTools {

    @Tool(name = "get_weather", description = "获取指定城市的天气信息")
    public String getWeather(
            @ToolParam(name = "city", description = "城市名称", required = true)
            String city,
            @ToolParam(name = "unit", description = "温度单位：celsius 或 fahrenheit", required = false)
            String unit) {
        // 实际实现中应调用天气 API
        return city + "天气: 晴, 25°C";
    }

    @Tool(name = "get_forecast", description = "获取未来几天的天气预报")
    public String getForecast(
            @ToolParam(name = "city", description = "城市名称", required = true)
            String city,
            @ToolParam(name = "days", description = "预报天数，1-7", required = true)
            int days) {
        return city + "未来" + days + "天: 持续晴好";
    }
}
```

### 4.2 注册工具

```java
// 创建 Toolkit（Toolkit.java:66）
Toolkit toolkit = new Toolkit();

// 方式一：直接注册工具对象（Toolkit.java:154）
toolkit.registerTool(new WeatherTools());

// 方式二：使用流式 Builder 注册（Toolkit.java:146-148）
toolkit.registration()
        .tool(new WeatherTools())
        .group("weather")       // 可选：指定工具组
        .apply();

// 创建带工具的 Agent
ReActAgent agent = ReActAgent.builder()
        .name("weather_agent")
        .sysPrompt("你是一个天气助手，使用工具查询天气信息。")
        .model(ModelRegistry.resolve("openai:gpt-4o"))
        .toolkit(toolkit)
        .memory(new InMemoryMemory())
        .maxIters(5)
        .build();
```

### 4.3 工具分组管理

Toolkit 支持工具分组，Agent 可在运行时动态切换激活的工具组（`Toolkit.java:561-574`）：

```java
// 创建工具组
toolkit.createToolGroup("basic", "基础工具", true);    // 默认激活
toolkit.createToolGroup("advanced", "高级工具", false);  // 默认不激活

// 注册工具到指定分组
toolkit.registration()
        .tool(new BasicTools())
        .group("basic")
        .apply();

toolkit.registration()
        .tool(new AdvancedTools())
        .group("advanced")
        .apply();

// 运行时切换工具组
toolkit.updateToolGroups(List.of("advanced"), true);   // 激活
toolkit.updateToolGroups(List.of("basic"), false);      // 停用
```

### 4.4 MCP 工具集成

通过 MCP 协议集成外部工具（`McpTool.java:57`，`Toolkit.java:537-539`）：

```java
import io.agentscope.core.tool.mcp.McpClientBuilder;
import io.agentscope.core.tool.mcp.McpClientWrapper;

// 创建 MCP 客户端
McpClientWrapper mcpClient = McpClientBuilder.builder()
        .name("my-mcp-server")
        .baseUrl("http://localhost:3000")
        .build();

// 注册 MCP 客户端的所有工具
toolkit.registerMcpClient(mcpClient).block();

// 或使用 Builder 方式，选择性注册
toolkit.registration()
        .mcpClient(mcpClient)
        .enableTools(List.of("search", "read"))   // 仅启用指定工具
        .group("mcp")
        .presetParameters(Map.of(                   // 预设参数
                "search", Map.of("api_key", "xxx")
        ))
        .apply();
```

### 4.5 子 Agent 工具

将 Agent 注册为工具，实现 Agent 间委托（`Toolkit.java:816-864`）：

```java
toolkit.registration()
        .subAgent(() -> ReActAgent.builder()
                .name("ResearchAgent")
                .model(ModelRegistry.resolve("openai:gpt-4o"))
                .memory(new InMemoryMemory())
                .maxIters(5)
                .build())
        .group("subagents")
        .apply();
```

## 5. Pipeline 编排

### 5.1 SequentialPipeline 顺序编排

将多个 Agent 串联执行，前一个的输出作为后一个的输入（`SequentialPipeline.java:39`）：

```java
import io.agentscope.core.pipeline.SequentialPipeline;

// 构建顺序管道（SequentialPipeline.java:140-142）
SequentialPipeline pipeline = SequentialPipeline.builder()
        .addAgent(analystAgent)      // 第一步：分析
        .addAgent(writerAgent)       // 第二步：撰写
        .addAgent(reviewerAgent)     // 第三步：审核
        .build();

// 执行管道（Pipeline.java:37）
Msg input = Msg.builder()
        .name("user")
        .role(MsgRole.USER)
        .content(TextBlock.builder().text("请分析这份报告并生成摘要").build())
        .build();

Msg result = pipeline.execute(input).block();
```

### 5.2 FanoutPipeline 扇出编排

将同一输入分发到多个 Agent 并行执行（`FanoutPipeline.java:49`）：

```java
import io.agentscope.core.pipeline.FanoutPipeline;

// 构建扇出管道（FanoutPipeline.java:371-373）
FanoutPipeline pipeline = FanoutPipeline.builder()
        .addAgent(techExpert)        // 技术专家
        .addAgent(bizExpert)         // 业务专家
        .addAgent(legalExpert)       // 法律专家
        .concurrent()                // 并行执行（默认）
        .build();

// 执行管道，返回所有 Agent 的结果列表（Pipeline.java:46）
List<Msg> results = pipeline.execute(input).block();

// 也支持串行模式
FanoutPipeline seqPipeline = FanoutPipeline.builder()
        .addAgent(techExpert)
        .addAgent(bizExpert)
        .sequential()                // 串行执行
        .build();
```

### 5.3 MsgHub 多 Agent 对话

MsgHub 实现参与者之间的自动消息广播（`MsgHub.java:100`）：

```java
import io.agentscope.core.pipeline.MsgHub;

// 创建 Agent
ReActAgent alice = ReActAgent.builder()
        .name("Alice")
        .sysPrompt("你是一位创意策划师。")
        .model(ModelRegistry.resolve("openai:gpt-4o"))
        .memory(new InMemoryMemory())
        .maxIters(3)
        .build();

ReActAgent bob = ReActAgent.builder()
        .name("Bob")
        .sysPrompt("你是一位评论家。")
        .model(ModelRegistry.resolve("openai:gpt-4o"))
        .memory(new InMemoryMemory())
        .maxIters(3)
        .build();

// 使用 MsgHub 进行多 Agent 对话（MsgHub.java:340-342）
Msg announcement = Msg.builder()
        .name("system")
        .role(MsgRole.SYSTEM)
        .content(TextBlock.builder().text("讨论主题：AI的未来").build())
        .build();

try (MsgHub hub = MsgHub.builder()
        .participants(alice, bob)
        .announcement(announcement)
        .enableAutoBroadcast(true)   // 自动广播（默认开启）
        .build()) {

    hub.enter().block();             // 进入 Hub（MsgHub.java:158）

    // Alice 的回复会自动广播给 Bob
    alice.call().block();

    // Bob 的回复会自动广播给 Alice
    bob.call().block();

    // 手动广播消息
    hub.broadcast(Msg.builder()
            .name("moderator")
            .role(MsgRole.USER)
            .content(TextBlock.builder().text("请总结你们的观点").build())
            .build()).block();
}  // 自动调用 close() → exit()（MsgHub.java:200）
```

## 6. Hook 使用

### 6.1 基本 Hook

```java
import io.agentscope.core.hook.Hook;
import io.agentscope.core.hook.HookEvent;
import io.agentscope.core.hook.PreReasoningEvent;
import io.agentscope.core.hook.ReasoningChunkEvent;
import reactor.core.publisher.Mono;

// 创建日志 Hook（Hook.java:117）
Hook loggingHook = new Hook() {
    @Override
    public <T extends HookEvent> Mono<T> onEvent(T event) {
        return switch (event) {
            case PreReasoningEvent e -> {
                System.out.println("[推理开始] 模型: " + e.getModelName());
                yield Mono.just(e);
            }
            case ReasoningChunkEvent e -> {
                // 流式输出增量文本（只通知，不可修改）
                System.out.print(e.getIncrementalChunk().getTextContent());
                yield Mono.just(e);
            }
            default -> Mono.just(event);
        };
    }
};

// 注册到 Agent
ReActAgent agent = ReActAgent.builder()
        .name("logged_agent")
        .model(model)
        .hooks(List.of(loggingHook))
        .build();
```

### 6.2 修改型 Hook

通过事件 setter 修改 Agent 行为（`Hook.java:127-134`）：

```java
// 在推理前注入提示词
Hook hintInjector = new Hook() {
    @Override
    public <T extends HookEvent> Mono<T> onEvent(T event) {
        if (event instanceof PreReasoningEvent e) {
            // 追加系统消息内容（HookEvent.java:174-177）
            e.appendSystemContent("请用中文回答，并给出详细步骤。");
        }
        return Mono.just(event);
    }

    @Override
    public int priority() {
        return 50;  // 高优先级，在其他 Hook 之前执行
    }
};
```

## 7. 常见问题

### Q1: 如何选择 `call()` 还是 `stream()`？

- **`call()`**：适合批量处理、自动化场景。阻塞等待完整结果。
- **`stream()`**：适合交互式场景（聊天 UI），实时显示 Agent 的推理过程和工具调用。

### Q2: 模型解析失败怎么办？

检查 `ModelRegistry.resolve()` 的错误信息（`ModelRegistry.java:244-258`），常见原因：
- 未设置对应的环境变量（如 `OPENAI_API_KEY`）
- 模型 ID 格式错误（正确格式：`provider:model-name`，如 `openai:gpt-4o`）
- 未注册自定义模型工厂

### Q3: 工具未被调用？

1. 确认工具已注册到 Toolkit 并传递给 Agent
2. 确认系统提示词明确指示 Agent 可以使用工具
3. 检查工具是否在已激活的工具组中（`toolkit.getActiveGroups()`）
4. 某些模型可能需要更强的提示才能触发工具调用

### Q4: 如何实现 Agent 中断恢复？

Agent 的 `interrupt()` 方法（`Agent.java:72`）设置中断标志，ReAct 循环在检查点检测到中断后调用 `handleInterrupt()`（`ReActAgent.java:1158`）。中断后的 Memory 状态被保留，再次调用 `call()` 可从中断点继续。

### Q5: 如何持久化 Agent 状态？

ReActAgent 实现了 `StateModule` 接口，通过 Session 持久化（`ReActAgent.java:300-359`）：

```java
import io.agentscope.core.session.JsonSession;
import io.agentscope.core.state.SessionKey;

// 使用 JsonSession 持久化到文件系统
JsonSession session = new JsonSession(Path.of("./sessions"));
SessionKey key = SessionKey.of("agent-session-1");

// 保存状态
agent.saveTo(session, key);

// 恢复状态
agent.loadFrom(session, key);
```

### Q6: 如何使用结构化输出？

```java
// 通过 Class 指定输出结构（CallableAgent.java:126）
Msg response = agent.call(userMsg, MyOutputClass.class).block();
MyOutputClass data = response.getStructuredData(MyOutputClass.class);

// 通过 JsonNode 指定 JSON Schema（CallableAgent.java:138）
ObjectMapper mapper = new ObjectMapper();
JsonNode schema = mapper.readTree("{\"type\":\"object\",\"properties\":{...}}");
Msg response = agent.call(userMsg, schema).block();
Map<String, Object> data = response.getStructuredData(false);
```

### Q7: FanoutPipeline 并行执行时如何处理部分失败？

FanoutPipeline 收集所有错误信息并封装为 `CompositeAgentException`（`FanoutPipeline.java:130-168`），不会因单个 Agent 失败而中断其他 Agent 的执行。失败的 Agent 结果不在结果列表中，但错误信息保留在异常中。
