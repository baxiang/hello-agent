# Java 注解

agentscope-java 使用注解定义工具、配置序列化、管理依赖注入。理解注解机制是使用和扩展框架的关键。

## 注解类型概览

| 注解 | 位置 | 用途 |
|---|---|---|
| `@Tool` | 方法 | 定义 Agent 可调用的工具 |
| `@ToolParam` | 参数 | 描述工具参数 |
| `@JsonTypeInfo` | 类 | 多态序列化类型识别 |
| `@JsonProperty` | 字段 | JSON 字段名映射 |
| `@Override` | 方法 | 标记覆盖父类方法 |

## 1. 工具注解 @Tool

### 定义工具

```java
public class WeatherTools {
    @Tool(name = "get_weather", description = "获取指定城市的天气信息")
    public String getWeather(
        @ToolParam(name = "city", description = "城市名称", required = true) 
        String city,
        
        @ToolParam(name = "unit", description = "温度单位", defaultValue = "celsius") 
        String unit
    ) {
        return "北京: 晴天, 25°C";
    }
}
```

### @Tool 注解定义

查看 `tool/Tool.java`：

```java
@Retention(RetentionPolicy.RUNTIME)  // 运行时保留
@Target(ElementType.METHOD)          // 只能用于方法
public @interface Tool {
    String name();                    // 工具名称
    String description();             // 工具描述
    String group() default "";        // 所属分组
    boolean enabled() default true;   // 是否启用
}
```

### @ToolParam 注解定义

查看 `tool/ToolParam.java`：

```java
@Retention(RetentionPolicy.RUNTIME)
@Target(ElementType.PARAMETER)       // 只能用于参数
public @interface ToolParam {
    String name();                    // 参数名称
    String description();             // 参数描述
    boolean required() default true;  // 是否必填
    String defaultValue() default ""; // 默认值
    String type() default "string";   // 参数类型
}
```

### 注解处理流程

```java
// 1. 注册工具对象
Toolkit toolkit = new Toolkit();
toolkit.registerTool(new WeatherTools());

// 2. Toolkit 内部扫描 @Tool 注解
public void registerTool(Object toolObject) {
    // 反射获取所有方法
    for (Method method : toolObject.getClass().getDeclaredMethods()) {
        // 检查是否有 @Tool 注解
        Tool toolAnnotation = method.getAnnotation(Tool.class);
        if (toolAnnotation != null) {
            // 解析注解信息，创建 AgentTool
            String name = toolAnnotation.name();
            String desc = toolAnnotation.description();
            
            // 解析参数注解
            List<ToolParamInfo> params = parseToolParams(method);
            
            // 注册到工具表
            register(name, desc, params, method, toolObject);
        }
    }
}
```

## 2. Jackson 注解

### 多态类型识别 @JsonTypeInfo

查看 `message/ContentBlock.java`：

```java
@JsonTypeInfo(
    use = JsonTypeInfo.Id.NAME,       // 使用名称识别类型
    include = JsonTypeInfo.As.PROPERTY, // 作为属性包含
    property = "type"                  // 属性名为 "type"
)
@JsonSubTypes({
    @JsonSubTypes.Type(value = TextBlock.class, name = "text"),
    @JsonSubTypes.Type(value = ToolUseBlock.class, name = "tool_use"),
    @JsonSubTypes.Type(value = ToolResultBlock.class, name = "tool_result"),
    @JsonSubTypes.Type(value = ThinkingBlock.class, name = "thinking"),
    @JsonSubTypes.Type(value = ImageBlock.class, name = "image"),
    @JsonSubTypes.Type(value = AudioBlock.class, name = "audio"),
    @JsonSubTypes.Type(value = VideoBlock.class, name = "video")
})
public sealed interface ContentBlock permits ... {}
```

**效果**：序列化时自动添加 `"type"` 属性，反序列化时根据 `"type"` 值选择正确的子类。

```json
// 序列化 TextBlock
{
    "type": "text",
    "text": "Hello World"
}

// 序列化 ToolUseBlock  
{
    "type": "tool_use",
    "id": "call_123",
    "name": "get_weather",
    "input": {"city": "北京"}
}

// 反序列化时，Jackson 根据 "type" 选择正确的类
ContentBlock block = jsonCodec.decode(json, ContentBlock.class);
// block 实际类型是 TextBlock 或 ToolUseBlock
```

### 字段映射 @JsonProperty

```java
public record ToolUseBlock(
    @JsonProperty("id") String id,
    @JsonProperty("name") String name,
    @JsonProperty("input") JsonNode input
) implements ContentBlock {}
```

**用途**：当 Java 字段名和 JSON 字段名不同时，用 `@JsonProperty` 映射。

```java
// Java 字段名和 JSON 名不同
public record Config(
    @JsonProperty("api_key") String apiKey,  // JSON: "api_key", Java: apiKey
    @JsonProperty("model_name") String modelName
) {}
```

### 序列化控制

| 注解 | 用途 |
|---|---|
| `@JsonIgnore` | 忽略字段，不序列化 |
| `@JsonInclude` | 条件序列化（非空、非默认等） |
| `@JsonFormat` | 日期格式化 |
| `@JsonCreator` | 指定反序列化构造器 |

```java
public record Msg(
    String id,
    MsgRole role,
    List<ContentBlock> content,
    
    @JsonIgnore           // 不序列化内部状态
    boolean internal,
    
    @JsonInclude(Include.NON_EMPTY)  // 空时不序列化
    Map<String, Object> metadata
) {}
```

## 3. 元注解 (定义注解的注解)

### @Retention — 保留策略

| 值 | 说明 | 项目应用 |
|---|---|---|
| `SOURCE` | 编译后丢弃 | `@Override` (编译检查) |
| `CLASS` | 保留在 class 文件，但 JVM 不可见 | 少用 |
| `RUNTIME` | 运行时可通过反射读取 | `@Tool`, `@ToolParam`, Jackson 注解 |

### @Target — 适用位置

| 值 | 说明 | 项目应用 |
|---|---|---|
| `METHOD` | 方法 | `@Tool` |
| `PARAMETER` | 参数 | `@ToolParam` |
| `FIELD` | 字段 | `@JsonProperty` |
| `TYPE` | 类/接口 | `@JsonTypeInfo` |
| `PACKAGE` | 包 | package-info.java |

### 定义自定义注解

```java
// 1. 定义注解
@Retention(RetentionPolicy.RUNTIME)  // 运行时保留
@Target(ElementType.METHOD)          // 用于方法
public @interface LogExecution {
    String level() default "INFO";
    boolean includeParams() default true;
}

// 2. 使用注解
public class MyService {
    @LogExecution(level = "DEBUG", includeParams = false)
    public void process(String input) {
        // ...
    }
}

// 3. 处理注解 (通常通过 AOP 或反射)
public class LogInterceptor {
    public void intercept(Method method, Object[] args) {
        LogExecution log = method.getAnnotation(LogExecution.class);
        if (log != null) {
            String level = log.level();
            // 根据 level 记录日志
        }
    }
}
```

## 4. 注解处理机制

### 反射读取注解

```java
// 获取方法上的注解
Method method = MyClass.class.getMethod("myMethod");
Tool tool = method.getAnnotation(Tool.class);
if (tool != null) {
    System.out.println(tool.name());
    System.out.println(tool.description());
}

// 获取参数上的注解
Parameter[] params = method.getParameters();
for (Parameter param : params) {
    ToolParam tp = param.getAnnotation(ToolParam.class);
    if (tp != null) {
        System.out.println(tp.name() + ": " + tp.description());
    }
}

// 获取类上的注解
JsonTypeInfo jti = ContentBlock.class.getAnnotation(JsonTypeInfo.class);
System.out.println(jti.property());  // 输出: "type"
```

### 项目中的注解处理

```java
// tool/ToolSchemaGenerator.java
public ToolSchema generateSchema(Method method) {
    Tool tool = method.getAnnotation(Tool.class);
    
    // 构建 JSON Schema
    JsonObject schema = new JsonObject();
    schema.addProperty("name", tool.name());
    schema.addProperty("description", tool.description());
    
    // 解析参数
    JsonObject properties = new JsonObject();
    for (Parameter param : method.getParameters()) {
        ToolParam tp = param.getAnnotation(ToolParam.class);
        if (tp != null) {
            JsonObject paramSchema = new JsonObject();
            paramSchema.addProperty("type", tp.type());
            paramSchema.addProperty("description", tp.description());
            properties.add(tp.name(), paramSchema);
        }
    }
    schema.add("parameters", properties);
    
    return new ToolSchema(schema);
}
```

## 源码对照

| 文件 | 注解 | 用途 |
|---|---|---|
| `tool/Tool.java` | @Retention, @Target | 定义工具注解 |
| `tool/ToolParam.java` | @Retention, @Target | 定义参数注解 |
| `message/ContentBlock.java` | @JsonTypeInfo, @JsonSubTypes | 多态序列化 |
| `tool/ToolSchemaGenerator.java` | 反射处理 | 解析 @Tool 注解 |

## 自检问题

1. `@Retention(RUNTIME)` 和 `@Retention(SOURCE)` 有什么区别？
2. 如何通过反射获取方法上的注解？
3. `@JsonTypeInfo` 的作用是什么？
4. 定义一个注解需要哪些元注解？

## 动手实践

```java
// 1. 定义自定义注解
@Retention(RetentionPolicy.RUNTIME)
@Target(ElementType.METHOD)
public @interface Cacheable {
    String key();
    int ttl() default 3600;
}

// 2. 使用注解
public class DataService {
    @Cacheable(key = "user:${id}", ttl = 1800)
    public User getUser(String id) {
        return fetchFromDatabase(id);
    }
}

// 3. 反射处理注解
Method method = DataService.class.getMethod("getUser", String.class);
Cacheable cache = method.getAnnotation(Cacheable.class);
System.out.println("Cache key: " + cache.key());
System.out.println("TTL: " + cache.ttl());
```

---

**下一步**：阅读 [05-builder-pattern.md](05-builder-pattern.md)