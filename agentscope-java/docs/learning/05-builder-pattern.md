# Builder 模式

agentscope-java 使用 Builder 模式构建所有复杂对象，提供流式 API 和清晰的配置方式。

## Builder 模式概览

| 组件 | Builder 类 | 使用场景 |
|---|---|---|
| `ReActAgent` | `ReActAgent.builder()` | 构建 Agent |
| `Msg` | `Msg.builder()` | 构建消息 |
| `DashScopeChatModel` | `DashScopeChatModel.builder()` | 构建模型 |
| `Toolkit` | 直接构造 + `registration()` | 配置工具 |
| `SequentialPipeline` | `SequentialPipeline.builder()` | 构建管道 |

## 1. 传统构造 vs Builder

### 传统构造方式的问题

```java
// 问题1：参数过多，难以理解
ReActAgent agent = new ReActAgent(
    "Assistant",           // name
    "Helpful AI",          // description  
    model,                 // model
    toolkit,               // toolkit
    memory,                // memory
    null,                  // hooks (传 null?)
    10,                    // maxIters
    null,                  // longTermMemory
    null,                  // knowledge
    ...                    // 更多参数
);

// 问题2：可选参数难以处理
ReActAgent agent = new ReActAgent("Assistant", model);
// 如果只要 name 和 model，其他参数怎么办？

// 问题3：参数顺序易错
ReActAgent agent = new ReActAgent(
    model,      // 错误：应该是 name
    "Assistant" // 错误：应该是 model
);
```

### Builder 方式的优势

```java
ReActAgent agent = ReActAgent.builder()
    .name("Assistant")                 // 清晰的参数名
    .sysPrompt("You are a helpful AI") // 可选参数，不传有默认值
    .model(model)
    .toolkit(toolkit)
    .memory(new InMemoryMemory())
    .maxIters(10)                      // 顺序不重要
    .build();                          // 最终构建

// 简化版本：只配置必要参数
ReActAgent agent = ReActAgent.builder()
    .name("Assistant")
    .model(model)
    .build();  // 其他参数有默认值
```

## 2. Builder 实现方式

### 手动 Builder (项目主要方式)

查看 `ReActAgent.java` 的 Builder：

```java
public class ReActAgent extends AgentBase {
    // Builder 类 (内部静态类)
    public static class Builder {
        private String name = "UnnamedAgent";
        private String description = "";
        private String sysPrompt = "";
        private Model model;
        private Toolkit toolkit = new Toolkit();
        private Memory memory = new InMemoryMemory();
        private List<Hook> hooks = new ArrayList<>();
        private int maxIters = 10;
        private LongTermMemory longTermMemory;
        private Knowledge knowledge;
        
        // 每个 setter 返回 Builder (链式调用)
        public Builder name(String name) {
            this.name = name;
            return this;
        }
        
        public Builder sysPrompt(String sysPrompt) {
            this.sysPrompt = sysPrompt;
            return this;
        }
        
        public Builder model(Model model) {
            this.model = model;
            return this;
        }
        
        // build() 创建最终对象
        public ReActAgent build() {
            if (model == null) {
                throw new IllegalStateException("Model is required");
            }
            return new ReActAgent(this);
        }
    }
    
    // 提供 builder() 静态方法
    public static Builder builder() {
        return new Builder();
    }
    
    // 私有构造器 (只能通过 Builder 创建)
    private ReActAgent(Builder builder) {
        super(builder.name, builder.description, true, builder.hooks);
        this.model = builder.model;
        this.toolkit = builder.toolkit;
        this.memory = builder.memory;
        this.maxIters = builder.maxIters;
        // ...
    }
}
```

### Builder 设计要点

| 要点 | 说明 |
|---|---|
| **内部静态类** | Builder 是外部类的静态内部类 |
| **链式返回** | 每个 setter 返回 `this`，支持 `.a().b().c()` |
| **默认值** | Builder 字段有默认值，可选参数不传有默认 |
| **私有构造器** | 外部类构造器私有，强制使用 Builder |
| **校验逻辑** | `build()` 中校验必填参数 |
| **静态工厂** | `builder()` 静态方法创建 Builder |

## 3. 项目中的 Builder 示例

### Msg.builder()

```java
// message/Msg.java
public record Msg(
    String id,
    MsgRole role,
    List<ContentBlock> content,
    Map<String, Object> metadata
) {
    public static Builder builder() {
        return new Builder();
    }
    
    public static class Builder {
        private String id = UUID.randomUUID().toString();
        private MsgRole role = MsgRole.USER;
        private List<ContentBlock> content = new ArrayList<>();
        private Map<String, Object> metadata = new HashMap<>();
        
        public Builder id(String id) {
            this.id = id;
            return this;
        }
        
        public Builder role(MsgRole role) {
            this.role = role;
            return this;
        }
        
        // content 可以多次添加
        public Builder content(ContentBlock block) {
            this.content.add(block);
            return this;
        }
        
        // content 可以一次性设置
        public Builder content(List<ContentBlock> blocks) {
            this.content = blocks;
            return this;
        }
        
        // 便捷方法：添加文本块
        public Builder text(String text) {
            return content(TextBlock.of(text));
        }
        
        public Builder metadata(String key, Object value) {
            this.metadata.put(key, value);
            return this;
        }
        
        public Msg build() {
            return new Msg(id, role, content, metadata);
        }
    }
}

// 使用
Msg msg = Msg.builder()
    .role(MsgRole.USER)
    .text("Hello")
    .text("How are you?")
    .metadata("source", "chat")
    .build();
```

### Model Builder

```java
// model/DashScopeChatModel.java
public class DashScopeChatModel implements Model {
    public static Builder builder() {
        return new Builder();
    }
    
    public static class Builder {
        private String apiKey;
        private String modelName = "qwen-plus";
        private GenerateOptions defaultOptions = GenerateOptions.defaultOptions();
        
        public Builder apiKey(String apiKey) {
            this.apiKey = apiKey;
            return this;
        }
        
        public Builder modelName(String modelName) {
            this.modelName = modelName;
            return this;
        }
        
        public Builder temperature(double temperature) {
            this.defaultOptions = GenerateOptions.builder()
                .temperature(temperature)
                .build();
            return this;
        }
        
        public DashScopeChatModel build() {
            if (apiKey == null || apiKey.isEmpty()) {
                throw new IllegalArgumentException("API key is required");
            }
            return new DashScopeChatModel(this);
        }
    }
}

// 使用
Model model = DashScopeChatModel.builder()
    .apiKey(System.getenv("DASHSCOPE_API_KEY"))
    .modelName("qwen-max")
    .temperature(0.7)
    .build();
```

### 嵌套 Builder

```java
// 外层 Builder + 内层 Builder
ReActAgent agent = ReActAgent.builder()
    .name("Assistant")
    .model(
        DashScopeChatModel.builder()    // 内层 Builder
            .apiKey(key)
            .modelName("qwen-plus")
            .temperature(0.7)
            .build()
    )
    .memory(
        InMemoryMemory.builder()        // 内层 Builder
            .maxMessages(100)
            .build()
    )
    .build();
```

## 4. 流式配置 API

### Toolkit 的 registration() 模式

```java
// 不是 Builder，但提供类似流式配置
Toolkit toolkit = new Toolkit();

toolkit.registration()
    .tool(new WeatherTools())       // 注册工具对象
    .group("weather")               // 设置分组
    .presetParameters(Map.of(       // 预设参数
        "get_weather", Map.of("unit", "celsius")
    ))
    .apply();                       // 最终应用

// 链式注册多个工具
toolkit.registration()
    .tool(new WeatherTools())
    .group("weather")
    .apply();

toolkit.registration()
    .tool(new CalculatorTools())
    .group("math")
    .apply();

// MCP 客户端注册
toolkit.registration()
    .mcpClient(mcpClientWrapper)
    .enableTools(List.of("read_file", "write_file"))
    .group("filesystem")
    .apply();
```

## 5. Builder 模式的好处

| 好处 | 说明 |
|---|---|
| **可读性** | 参数名清晰，一目了然 |
| **灵活性** | 可选参数有默认值，不必全部指定 |
| **顺序无关** | `.a().b().c()` 和 `.c().b().a()` 结果相同 |
| **不可变** | `build()` 创建后不可修改 (配合 record) |
| **校验集中** | `build()` 中统一校验，不在构造器分散 |

## 源码对照

| 文件 | Builder | 行号 |
|---|---|---|
| `ReActAgent.java` | `Builder` 内部类 | 搜索 "public static class Builder" |
| `Msg.java` | `Builder` 内部类 | 同上 |
| `DashScopeChatModel.java` | `Builder` 内部类 | 同上 |
| `Toolkit.java` | `ToolRegistration` | `registration()` 方法 |

## 自检问题

1. Builder 模式的核心组成部分是什么？
2. 为什么 Builder 的 setter 方法返回 `this`？
3. Builder 模式解决了传统构造器的哪些问题？
4. 如何实现嵌套 Builder (外层 Builder 内嵌内层 Builder)?

## 动手实践

```java
// 1. 实现简单 Builder
public class Config {
    private final String host;
    private final int port;
    private final boolean ssl;
    
    public static class Builder {
        private String host = "localhost";
        private int port = 8080;
        private boolean ssl = false;
        
        public Builder host(String host) {
            this.host = host;
            return this;
        }
        
        public Builder port(int port) {
            this.port = port;
            return this;
        }
        
        public Builder ssl(boolean ssl) {
            this.ssl = ssl;
            return this;
        }
        
        public Config build() {
            return new Config(this);
        }
    }
    
    private Config(Builder builder) {
        this.host = builder.host;
        this.port = builder.port;
        this.ssl = builder.ssl;
    }
    
    public static Builder builder() {
        return new Builder();
    }
}

// 2. 使用 Builder
Config config = Config.builder()
    .host("api.example.com")
    .port(443)
    .ssl(true)
    .build();

// 3. 只设置部分参数 (其他有默认值)
Config config = Config.builder()
    .host("api.example.com")
    .build();  // port=8080, ssl=false (默认值)
```

---

**下一步**：阅读 [06-functional.md](06-functional.md)