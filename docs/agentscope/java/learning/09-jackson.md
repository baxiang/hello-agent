# Jackson JSON 序列化

agentscope-java 使用 Jackson 处理所有 JSON 序列化，理解 Jackson 机制是阅读消息系统和工具参数处理的关键。

## Jackson 核心概念

| 概念 | 说明 | 项目应用 |
|---|---|---|
| `ObjectMapper` | JSON 解析器 | 全局 JsonCodec |
| `@JsonTypeInfo` | 多态类型识别 | `ContentBlock` 7 种类型 |
| `@JsonProperty` | 字段名映射 | JSON 字段名 ↔ Java 字段名 |
| `@JsonSubTypes` | 子类型声明 | sealed class 子类列表 |
| `@JsonIgnore` | 忽略字段 | 内部状态不序列化 |

## 1. ObjectMapper 基础

### 基本序列化/反序列化

```java
ObjectMapper mapper = new ObjectMapper();

// 序列化：对象 → JSON
User user = new User("Alice", 25);
String json = mapper.writeValueAsString(user);
// {"name":"Alice","age":25}

// 反序列化：JSON → 对象
User user2 = mapper.readValue(json, User.class);
```

### 项目中的 ObjectMapper

```java
// util/JacksonJsonCodec.java
public class JacksonJsonCodec implements JsonCodec {
    private final ObjectMapper mapper;
    
    public JacksonJsonCodec() {
        this.mapper = new ObjectMapper()
            .registerModule(new JavaTimeModule())   // 支持 Java 8 日期
            .disable(SerializationFeature.FAIL_ON_EMPTY_BEANS)
            .disable(DeserializationFeature.FAIL_ON_UNKNOWN_PROPERTIES);
    }
    
    @Override
    public String encode(Object obj) {
        return mapper.writeValueAsString(obj);
    }
    
    @Override
    public <T> T decode(String json, Class<T> clazz) {
        return mapper.readValue(json, clazz);
    }
    
    @Override
    public <T> T decode(JsonNode node, Class<T> clazz) {
        return mapper.treeToValue(node, clazz);
    }
}
```

## 2. 多态序列化 (@JsonTypeInfo)

### 问题：如何反序列化父类？

```java
// 问题场景
public interface ContentBlock {}
public record TextBlock(String text) implements ContentBlock {}
public record ImageBlock(String url) implements ContentBlock {}

// JSON 中只有内容，不知道具体类型
String json = '{"text":"hello"}';  // 是 TextBlock 还是别的？
ContentBlock block = mapper.readValue(json, ContentBlock.class);  // 错误！不知道类型
```

### 解决方案：@JsonTypeInfo + @JsonSubTypes

```java
// message/ContentBlock.java
@JsonTypeInfo(
    use = JsonTypeInfo.Id.NAME,         // 使用类型名称识别
    include = JsonTypeInfo.As.PROPERTY, // 作为属性包含
    property = "type"                   // 属性名为 "type"
)
@JsonSubTypes({
    @JsonSubTypes.Type(value = TextBlock.class, name = "text"),
    @JsonSubTypes.Type(value = ImageBlock.class, name = "image"),
    @JsonSubTypes.Type(value = ToolUseBlock.class, name = "tool_use"),
    @JsonSubTypes.Type(value = ToolResultBlock.class, name = "tool_result"),
    @JsonSubTypes.Type(value = ThinkingBlock.class, name = "thinking"),
    @JsonSubTypes.Type(value = AudioBlock.class, name = "audio"),
    @JsonSubTypes.Type(value = VideoBlock.class, name = "video")
})
public sealed class ContentBlock implements State permits ... {}
```

### 效果：序列化自动添加 "type"

```java
// 序列化 TextBlock
TextBlock text = new TextBlock("Hello");
String json = mapper.writeValueAsString(text);
// {"type":"text","text":"Hello"}  ← 自动添加 type

// 序列化 ToolUseBlock
ToolUseBlock tool = new ToolUseBlock("id123", "get_weather", inputNode);
String json = mapper.writeValueAsString(tool);
// {"type":"tool_use","id":"id123","name":"get_weather","input":{...}}

// 反序列化：根据 "type" 选择正确类型
String json = '{"type":"text","text":"Hello"}';
ContentBlock block = mapper.readValue(json, ContentBlock.class);
// block 实际类型是 TextBlock
```

## 3. 字段映射 (@JsonProperty)

### 字段名不同时映射

```java
// Java 字段名和 JSON 字段名不同
public record Config(
    @JsonProperty("api_key") String apiKey,      // JSON: "api_key", Java: apiKey
    @JsonProperty("model_name") String modelName // JSON: "model_name", Java: modelName
) {}

// 序列化
Config config = new Config("secret", "qwen-plus");
String json = mapper.writeValueAsString(config);
// {"api_key":"secret","model_name":"qwen-plus"}

// 反序列化
String json = '{"api_key":"secret","model_name":"qwen-plus"}';
Config config2 = mapper.readValue(json, Config.class);
```

### 项目中的 @JsonProperty

```java
// message/ToolUseBlock.java
public record ToolUseBlock(
    @JsonProperty("id") String id,
    @JsonProperty("name") String name,
    @JsonProperty("input") JsonNode input
) implements ContentBlock {
    public String type() { return "tool_use"; }
}

// tool/ToolSchema.java
public record ToolSchema(
    @JsonProperty("name") String name,
    @JsonProperty("description") String description,
    @JsonProperty("parameters") JsonNode parameters
) {}
```

## 4. 忽略字段 (@JsonIgnore)

### 不序列化某些字段

```java
public record Msg(
    String id,
    MsgRole role,
    List<ContentBlock> content,
    
    @JsonIgnore                    // 不序列化
    boolean internal,
    
    @JsonInclude(Include.NON_EMPTY) // 空时不序列化
    Map<String, Object> metadata
) {}

// 序列化
Msg msg = new Msg("id1", USER, blocks, false, Map.of());
String json = mapper.writeValueAsString(msg);
// {"id":"id1","role":"USER","content":[...]}
// 没有 "internal" 和 "metadata" (metadata 空被忽略)
```

## 5. JsonNode (动态 JSON)

### JsonNode 类型

| 类型 | 说明 | 示例 |
|---|---|---|
| `ObjectNode` | JSON 对象 | `{"key":"value"}` |
| `ArrayNode` | JSON 数组 | `[1, 2, 3]` |
| `TextNode` | JSON 字符串 | `"hello"` |
| `IntNode` | JSON 数字 | `42` |
| `BooleanNode` | JSON 布尔 | `true` |
| `NullNode` | JSON null | `null` |

### 读取 JsonNode

```java
ObjectMapper mapper = new ObjectMapper();
JsonNode root = mapper.readTree(json);

// 读取字段
String name = root.get("name").asText();        // 字符串字段
int age = root.get("age").asInt();              // 整数字段
boolean active = root.get("active").asBoolean(); // 布尔字段

// 读取嵌套字段
String city = root.get("address").get("city").asText();

// 读取数组
JsonNode items = root.get("items");
for (JsonNode item : items) {
    String value = item.asText();
}

// 检查字段是否存在
if (root.has("optional")) {
    String opt = root.get("optional").asText();
}
```

### 创建 JsonNode

```java
ObjectMapper mapper = new ObjectMapper();

// 创建对象
ObjectNode obj = mapper.createObjectNode();
obj.put("name", "Alice");
obj.put("age", 25);
obj.put("active", true);

// 创建数组
ArrayNode arr = mapper.createArrayNode();
arr.add("item1");
arr.add("item2");
arr.add(42);

// 嵌套对象
ObjectNode nested = mapper.createObjectNode();
nested.put("city", "Beijing");
obj.set("address", nested);  // 添加嵌套对象

// 转为 JSON 字符串
String json = mapper.writeValueAsString(obj);
```

### 项目中的 JsonNode 使用

```java
// tool/ToolMethodInvoker.java — 工具参数解析
public Object[] parseArguments(Method method, JsonNode input) {
    Parameter[] params = method.getParameters();
    Object[] args = new Object[params.length];
    
    for (int i = 0; i < params.length; i++) {
        String paramName = params[i].getAnnotation(ToolParam.class).name();
        JsonNode valueNode = input.get(paramName);
        
        // 根据参数类型转换
        Class<?> paramType = params[i].getType();
        args[i] = mapper.treeToValue(valueNode, paramType);
    }
    
    return args;
}

// 使用示例
// input = {"city":"北京","unit":"celsius"}
// method 参数: String city, String unit
// args = ["北京", "celsius"]
```

## 6. 自定义序列化器

### 自定义序列化器

```java
// 自定义序列化器
public class MsgSerializer extends StdSerializer<Msg> {
    public MsgSerializer() {
        super(Msg.class);
    }
    
    @Override
    public void serialize(Msg msg, JsonGenerator gen, SerializerProvider provider) {
        gen.writeStartObject();
        gen.writeStringField("id", msg.id());
        gen.writeStringField("role", msg.role().name().toLowerCase());
        gen.writeObjectField("content", msg.content());
        gen.writeEndObject();
    }
}

// 注册序列化器
@JsonSerialize(using = MsgSerializer.class)
public record Msg(...) {}
```

### 自定义反序列化器

```java
public class MsgDeserializer extends StdDeserializer<Msg> {
    public MsgDeserializer() {
        super(Msg.class);
    }
    
    @Override
    public Msg deserialize(JsonParser p, DeserializationContext ctxt) {
        JsonNode node = p.getCodec().readTree(p);
        String id = node.get("id").asText();
        MsgRole role = MsgRole.valueOf(node.get("role").asText().toUpperCase());
        List<ContentBlock> content = parseContent(node.get("content"));
        return new Msg(id, role, content);
    }
}
```

## 7. JSON Schema 生成

### 项目中的 JSON Schema

```java
// tool/ToolSchemaGenerator.java — 工具参数 Schema
public ToolSchema generateSchema(Method method) {
    // 使用 victools jsonschema-generator
    SchemaGeneratorConfigBuilder configBuilder = new SchemaGeneratorConfigBuilder(
        SchemaVersion.DRAFT_2020_12, 
        OptionPreset.PLAIN_JSON
    );
    
    configBuilder.forMethods()
        .withDescriptionResolver(method -> {
            ToolParam tp = method.getAnnotation(ToolParam.class);
            return tp != null ? tp.description() : null;
        });
    
    SchemaGenerator generator = new SchemaGenerator(configBuilder.build());
    JsonNode schema = generator.generateSchema(method.getReturnType());
    
    return new ToolSchema(schema);
}
```

### 生成的 Schema 示例

```java
// 工具方法
@Tool(name = "get_weather")
public String getWeather(
    @ToolParam(name = "city", description = "城市名称", required = true) String city,
    @ToolParam(name = "unit", description = "温度单位", defaultValue = "celsius") String unit
) {}

// 生成的 Schema
{
    "name": "get_weather",
    "description": "获取天气",
    "parameters": {
        "type": "object",
        "properties": {
            "city": {
                "type": "string",
                "description": "城市名称"
            },
            "unit": {
                "type": "string",
                "description": "温度单位",
                "default": "celsius"
            }
        },
        "required": ["city"]
    }
}
```

## 源码对照

| 文件 | Jackson 使用 | 说明 |
|---|---|---|
| `message/ContentBlock.java` | @JsonTypeInfo, @JsonSubTypes | 多态序列化 |
| `message/ToolUseBlock.java` | @JsonProperty | 字段映射 |
| `util/JacksonJsonCodec.java` | ObjectMapper | 全局 JSON 处理 |
| `tool/ToolSchemaGenerator.java` | JSON Schema 生成 | 工具参数 Schema |

## 自检问题

1. `@JsonTypeInfo` 的作用是什么？
2. 如何反序列化一个父类，让 Jackson 自动选择正确的子类？
3. `JsonNode` 如何读取 JSON 字段？
4. 如何自定义序列化器？

## 动手实践

```java
// 1. 基本序列化
ObjectMapper mapper = new ObjectMapper();

User user = new User("Alice", 25);
String json = mapper.writeValueAsString(user);
User user2 = mapper.readValue(json, User.class);

// 2. 多态序列化
@JsonTypeInfo(use = JsonTypeInfo.Id.NAME, property = "type")
@JsonSubTypes({
    @Type(value = Dog.class, name = "dog"),
    @Type(value = Cat.class, name = "cat")
})
interface Animal {}

record Dog(String name) implements Animal {}
record Cat(String name) implements Animal {}

Animal animal = new Dog("Buddy");
String json = mapper.writeValueAsString(animal);
// {"type":"dog","name":"Buddy"}

Animal animal2 = mapper.readValue(json, Animal.class);
// animal2 实际类型是 Dog

// 3. JsonNode 操作
JsonNode node = mapper.readTree(json);
String name = node.get("name").asText();
```

---

**下一步**：阅读 [10-design-patterns.md](10-design-patterns.md)