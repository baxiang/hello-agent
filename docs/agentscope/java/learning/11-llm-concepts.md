# LLM/Agent 核心概念

agentscope-java 是一个 LLM Agent 框架，理解 LLM 和 Agent 的核心概念是使用和扩展框架的前提。

## LLM/Agent 概念概览

| 概念 | 说明 | 项目实现 |
|---|---|---|
| **LLM (大语言模型)** | 生成文本的 AI 模型 | `Model` 接口 |
| **Prompt** | 输入给 LLM 的指令 | `Msg` 系统消息 |
| **ReAct** | 推理-执行循环模式 | `ReActAgent.reasoning/acting` |
| **Tool Calling** | LLM 调用外部工具 | `ToolUseBlock`, `Toolkit` |
| **Context/Memory** | 对话历史 | `Memory`, `Msg` 列表 |
| **RAG** | 检索增强生成 | `Knowledge`, `RAGHook` |
| **MCP** | Model Context Protocol | `McpClientWrapper` |

## 1. LLM (大语言模型)

### 什么是 LLM？

LLM (Large Language Model) 是能理解和生成人类语言的大型神经网络模型。

| 模型 | 提供商 | 项目支持 |
|---|---|---|
| GPT-4 | OpenAI | `OpenAIChatModel` |
| Claude | Anthropic | `AnthropicChatModel` |
| Gemini | Google | `GeminiChatModel` |
| Qwen (通义千问) | 阿里云 DashScope | `DashScopeChatModel` |
| 本地模型 | Ollama | `OllamaChatModel` |

### LLM 的输入输出

```
输入 (Prompt):
[
    {"role": "system", "content": "You are a helpful assistant."},
    {"role": "user", "content": "What is the weather in Beijing?"},
    {"role": "assistant", "content": "Let me check..."},
    {"role": "tool", "content": '{"result":"Sunny, 25°C"}'}
]

输出:
{"role": "assistant", "content": "北京今天晴天，气温25°C。"}
```

### 项目中的 LLM 抽象

```java
// Model.java — LLM 抽象接口
public interface Model {
    Flux<ChatResponse> stream(
        List<Msg> messages,
        List<ToolSchema> tools,
        GenerateOptions options
    );
}

Model model = DashScopeChatModel.builder()
    .apiKey("your-api-key")
    .modelName("qwen-plus")
    .temperature(0.7)
    .build();

Flux<ChatResponse> stream = model.stream(messages, tools, options);
```

## 2. ReAct 模式

### 什么是 ReAct？

**ReAct = Reasoning + Acting**

一种 Agent 设计模式，交替进行推理 (思考) 和执行 (工具调用)。

```
ReAct 循环:
  │
  ├─► 1. Reasoning (推理)
  │     ├─ 输入：用户问题 + 对话历史
  │     ├─ 输出：思考过程 + 工具调用请求 (或回答)
  │     └─ LLM: "我需要查询天气...调用 get_weather"
  │
  ├─► 2. Acting (执行)
  │     ├─ 输入：工具调用请求
  │     ├─ 执行：调用工具，获取结果
  │     └─ 输出：工具返回结果
  │
  ├─► 3. Reasoning (再次推理)
  │     ├─ 输入：工具结果
  │     ├─ 输出：整合工具结果，生成回答
  │     └─ LLM: "根据天气数据，北京今天晴天25°C"
  │
  └─► 循环直到：任务完成 / 达到最大迭代次数 / 需要人机协同
```

### 项目中的 ReAct 实现

```java
// ReActAgent.java
public class ReActAgent extends AgentBase {
    private final Model model;
    private final Toolkit toolkit;
    private final Memory memory;
    private final int maxIters;
    
    @Override
    protected Mono<Msg> doCall(List<Msg> msgs) {
        memory.addMessages(msgs);
        
        return reasoning(0)
            .flatMap(response -> {
                if (isFinished(response)) {
                    return Mono.just(response);
                }
                return acting(response).then(reasoning(1));
            });
    }
    
    private Mono<Msg> reasoning(int iteration) {
        List<Msg> history = memory.getMessages();
        List<ToolSchema> tools = toolkit.getToolSchemas();
        
        return model.stream(history, tools, options)
            .collectList()
            .map(responses -> buildMsg(responses));
    }
    
    private Mono<Void> acting(Msg response) {
        List<ToolUseBlock> toolUses = response.getContent().stream()
            .filter(b -> b instanceof ToolUseBlock)
            .map(b -> (ToolUseBlock) b)
            .collect(Collectors.toList());
        
        return Flux.fromIterable(toolUses)
            .flatMap(toolUse -> toolkit.execute(toolUse))
            .flatMap(result -> {
                memory.addMessage(Msg.builder()
                    .role(MsgRole.TOOL)
                    .content(result)
                    .build());
                return Mono.empty();
            })
            .then();
    }
}
```

## 3. Tool Calling

### 什么是 Tool Calling？

LLM 可以"调用"外部工具获取信息或执行操作。

```
用户: "北京今天天气如何?"

LLM 思考: "我需要查询天气，调用 get_weather 工具"
LLM 输出: 
{
    "type": "tool_use",
    "name": "get_weather",
    "input": {"city": "北京"}
}

工具执行: get_weather({"city": "北京"}) → "晴天, 25°C"

工具返回:
{
    "type": "tool_result",
    "tool_use_id": "call_123",
    "content": "晴天, 25°C"
}

LLM 再次推理: 整合工具结果
LLM 最终回答: "北京今天晴天，气温25°C。"
```

### 项目中的 Tool Calling

```java
// 定义工具
public class WeatherTools {
    @Tool(name = "get_weather", description = "获取城市天气")
    public String getWeather(
        @ToolParam(name = "city", description = "城市名称") String city
    ) {
        return fetchWeather(city);
    }
}

Toolkit toolkit = new Toolkit();
toolkit.registerTool(new WeatherTools());

ReActAgent agent = ReActAgent.builder()
    .model(model)
    .toolkit(toolkit)
    .build();

Msg response = agent.call(userMsg).block();
```

## 4. Memory/Context

### 什么是 Memory？

Memory 存储 Agent 的对话历史，让 Agent 能记住之前的内容。

```
Memory 内容:
[
    {role: "user", content: "你好"},
    {role: "assistant", content: "你好！有什么可以帮你的？"},
    {role: "user", content: "北京天气如何？"},
    {role: "assistant", content: "让我查询...", tool_use: get_weather},
    {role: "tool", content: "晴天, 25°C"},
    {role: "assistant", content: "北京晴天25°C"},
    {role: "user", content: "上海呢？"}  ← Agent 能记住之前讨论的是天气
]
```

### 项目中的 Memory

```java
public interface Memory {
    void addMessage(Msg message);
    List<Msg> getMessages();
    void deleteMessage(int index);
    void clear();
}

public class InMemoryMemory implements Memory, StateModule {
    private final CopyOnWriteArrayList<Msg> messages = new CopyOnWriteArrayList<>();
    
    @Override
    public void addMessage(Msg message) {
        messages.add(message);
    }
    
    @Override
    public List<Msg> getMessages() {
        return new ArrayList<>(messages);
    }
}

LongTermMemory ltm = Mem0LongTermMemory.builder()
    .apiKey("mem0-api-key")
    .userId("user123")
    .build();

ReActAgent agent = ReActAgent.builder()
    .memory(new InMemoryMemory())
    .longTermMemory(ltm)
    .build();
```

## 5. RAG (检索增强生成)

### 什么是 RAG？

**RAG = Retrieval-Augmented Generation**

在 LLM 推理前，先检索相关知识，增强 LLM 的回答质量。

```
用户: "公司的退款政策是什么?"

RAG 流程:
  │
  ├─► 1. 检索: 从知识库搜索 "退款政策"
  │     找到: "退款政策文档.pdf 第10页"
  │
  ├─► 2. 注入: 将文档内容加入 Prompt
  │
  ├─► 3. 推理: LLM 根据文档回答
  │

最终 Prompt:
"根据以下知识回答用户问题：
[知识] 退款政策：购买7天内可全额退款...
[用户问题] 公司的退款政策是什么?"
```

### 项目中的 RAG

```java
public interface Knowledge {
    void addDocuments(List<Document> documents);
    Mono<List<Document>> retrieve(String query, RetrieveConfig config);
}

Knowledge knowledge = new SimpleKnowledge(Path.of("knowledge-base"));

ReActAgent agent = ReActAgent.builder()
    .knowledge(knowledge)
    .ragMode(RAGMode.GENERIC)
    .build();

Msg response = agent.call(userMsg).block();
```

## 6. MCP (Model Context Protocol)

### 什么是 MCP？

**MCP = Model Context Protocol**

一种标准化协议，让 LLM Agent 能连接外部工具和数据源。

```
MCP Server (工具提供者)
├── filesystem-server  — 文件操作工具
├── database-server    — 数据库查询工具
├── web-search-server  — 网络搜索工具

MCP Client (Agent)
├── 连接 MCP Server
├── 发现可用工具
├── 调用工具
```

### 项目中的 MCP

```java
McpClientWrapper client = McpClientBuilder.stdio()
    .command("npx")
    .args("-y", "@modelcontextprotocol/server-filesystem", "/workspace")
    .build();

Toolkit toolkit = new Toolkit();
toolkit.registration()
    .mcpClient(client)
    .enableTools(List.of("read_file", "write_file", "list_directory"))
    .apply();

ReActAgent agent = ReActAgent.builder()
    .toolkit(toolkit)
    .build();

Msg response = agent.call(Msg.builder()
    .text("读取 /workspace/readme.md 的内容")
    .build()).block();
```

## 7. Pipeline (多 Agent 编排)

### Sequential Pipeline (链式)

```
Input → Agent1 → Agent2 → Agent3 → Output

示例：研究 → 总结 → 审核
```

```java
SequentialPipeline pipeline = SequentialPipeline.builder()
    .addAgent(researcher)
    .addAgent(summarizer)
    .addAgent(reviewer)
    .build();

Msg result = pipeline.execute(input).block();
```

### Fanout Pipeline (并行)

```
Input → [Agent1, Agent2, Agent3] → [Result1, Result2, Result3]

示例：多角度分析
```

```java
FanoutPipeline pipeline = FanoutPipeline.builder()
    .addAgent(techAnalyst)
    .addAgent(businessAnalyst)
    .addAgent(ethicsAnalyst)
    .concurrent()
    .build();

List<Msg> results = pipeline.execute(input).block();
```

## 源码对照

| 概念 | 文件 | 关键代码 |
|---|---|---|
| LLM | `Model.java` | `stream()` 方法 |
| ReAct | `ReActAgent.java` | `reasoning()`, `acting()` |
| Tool Calling | `Toolkit.java`, `ToolUseBlock.java` | `execute()` |
| Memory | `Memory.java`, `InMemoryMemory.java` | `addMessage()`, `getMessages()` |
| RAG | `Knowledge.java`, `GenericRAGHook.java` | `retrieve()` |
| MCP | `McpClientWrapper.java` | MCP 集成 |

## 自检问题

1. ReAct 模式的核心思想是什么？
2. Tool Calling 的流程是什么？
3. Memory 的作用是什么？
4. RAG 如何增强 LLM 的回答？

---

**完成所有文档阅读后**，开始阅读源码：`ReActAgent.java` → `AgentBase.java` → `Toolkit.java`