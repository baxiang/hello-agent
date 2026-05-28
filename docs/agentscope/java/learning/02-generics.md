# Java 泛型

泛型是 Java 类型系统的核心特性，agentscope-java 源码中大量使用泛型定义接口和类。

## 核心概念

| 概念 | 项目应用 | 说明 |
|---|---|---|
| `<T>` 类型参数 | `Mono<T>`, `Flux<T>`, `AgentTool<T>` | 泛型类/接口定义 |
| 泛型方法 | `msg.getStructuredData(Class<T>)` | 方法级别的泛型 |
| 类型边界 | `<T extends State>` | 限制类型参数范围 |
| 泛型通配符 | `List<? extends Hook>` | 限制未知类型范围 |

## 1. 泛型基础

### 什么是泛型？

泛型允许在定义类、接口、方法时使用类型参数，在运行时指定具体类型。

```java
// 没有泛型 (Java 5 之前)
List list = new ArrayList();
list.add("hello");
String s = (String) list.get(0);  // 需要强制转换，可能出错

// 有泛型
List<String> list = new ArrayList<>();
list.add("hello");
String s = list.get(0);  // 不需要转换，编译器保证类型安全
```

### 项目中的泛型类

查看 `model/Model.java`：

```java
public interface Model {
    // 返回 Flux<ChatResponse>，泛型指定元素类型
    Flux<ChatResponse> stream(
        List<Msg> messages,
        List<ToolSchema> tools,
        GenerateOptions options
    );
}
```

查看 `message/Msg.java`：

```java
// 泛型方法：传入 Class<T>，返回 T
public <T> T getStructuredData(Class<T> clazz) {
    // 从元数据中提取并转换为指定类型
    return metadata.get("structured_data", clazz);
}

// 使用
MyOutput output = msg.getStructuredData(MyOutput.class);
```

## 2. 类型参数命名约定

| 命名 | 用途 | 示例 |
|---|---|---|
| `T` | 任意类型 | `Mono<T>`, `List<T>` |
| `E` | 集合元素 | `List<E>`, `Set<E>` |
| `K` | Map 键 | `Map<K, V>` |
| `V` | Map 值 | `Map<K, V>` |
| `R` | 返回值 | `Function<T, R>` |
| `N` | 数字 | `Number<N>` |

## 3. 泛型类 vs 泛型接口

### 泛型类

```java
// reactor-core 的 Mono 类
public class Mono<T> implements Publisher<T> {
    // T 是类型参数，表示 Mono 包装的值类型
    
    public <R> Mono<R> map(Function<T, R> mapper) {
        // 泛型方法：从 T 转换到 R
    }
    
    public <R> Mono<R> flatMap(Function<T, Mono<R>> mapper) {
        // 泛型方法：从 T 转换到 Mono<R>
    }
}
```

### 泛型接口

```java
// 项目中的 AgentTool 接口
public interface AgentTool<T> {
    String name();
    String description();
    ToolSchema schema();
    
    // execute 返回 Mono<T>，T 是工具执行结果类型
    Mono<T> execute(JsonNode input, ToolExecutionContext context);
}

// 具体实现
public class WeatherTool implements AgentTool<String> {
    // T 被指定为 String，execute 返回 Mono<String>
    @Override
    public Mono<String> execute(JsonNode input, ToolExecutionContext ctx) {
        return Mono.just("Sunny, 25°C");
    }
}
```

## 4. 类型边界 (Bounds)

### 单边界

```java
// T 必须是 State 或其子类
public interface StateModule<T extends State> {
    void save(T state);
    T load();
}
```

### 多边界

```java
// T 必须同时满足多个条件
public class Composite<T extends Number & Comparable<T>> {
    // T 必须是 Number，且实现 Comparable
}
```

### 项目中的边界

```java
// state/StateModule.java
public interface StateModule {
    // State 是边界
    void saveTo(Session session, SessionKey key);
    void loadFrom(Session session, SessionKey key);
}

// 所有实现 StateModule 的类都可以被 Session 管理
// Memory, Toolkit, PlanNotebook 都实现了 StateModule
```

## 5. 泛型通配符

### 三种通配符

| 通配符 | 名称 | 用途 |
|---|---|---|
| `<?>` | 无界通配符 | 未知类型，只能读不能写 |
| `<? extends T>` | 上界通配符 | T 或 T 的子类 (生产者) |
| `<? super T>` | 下界通配符 | T 或 T 的父类 (消费者) |

### PECS 原则

**Producer Extends, Consumer Super**

```java
// 生产者 (只读) → extends
void processShapes(List<? extends Shape> shapes) {
    for (Shape s : shapes) {  // 只读，可以取出 Shape
        // shapes.add(new Circle()); // ❌ 不能写
    }
}

// 消费者 (只写) → super
void addShapes(List<? super Shape> shapes) {
    shapes.add(new Circle());  // 可以写
    // Shape s = shapes.get(0);  // ❌ 不能读（类型不确定）
}
```

### 项目中的通配符

```java
// AgentBase.java
public abstract class AgentBase implements StateModule, Agent {
    private final List<Hook> hooks;
    
    public void addHooks(List<? extends Hook> newHooks) {
        // 上界通配符：可以接受任何 Hook 子类的 List
        hooks.addAll(newHooks);
    }
}
```

## 6. 泛型方法

### 定义泛型方法

```java
// <T> 在方法返回类型之前声明类型参数
public <T> Mono<T> call(List<Msg> msgs, Class<T> outputType) {
    return model.stream(msgs, tools, options)
        .map(response -> parseOutput(response, outputType));
}

// 使用时指定具体类型
Mono<MyResult> result = agent.call(messages, MyResult.class);
```

### 项目中的泛型方法

```java
// hook/Hook.java
public interface Hook {
    // <T extends HookEvent> 泛型方法
    <T extends HookEvent> Mono<T> onEvent(T event);
    
    default int priority() { return 100; }
}

// 所有 HookEvent 子类都可以传入
// PreCallEvent, PostReasoningEvent, etc.
```

## 7. 类型擦除

### 什么是类型擦除？

Java 泛型在编译时检查类型，运行时泛型信息被"擦除"。

```java
List<String> strings = new ArrayList<>();
List<Integer> ints = new ArrayList<>();

// 运行时，两个 List 的类型都是 ArrayList (泛型信息擦除)
// strings.getClass() == ints.getClass()  → true
```

### 擦除的影响

```java
// 不能做的事：
public class Container<T> {
    // ❌ 不能用 T 创建对象
    T item = new T();
    
    // ❌ 不能用 T.class 获取类型
    Class<T> clazz = T.class;
    
    // ✅ 可以通过传入 Class<T> 解决
    public Container(Class<T> clazz) {
        this.clazz = clazz;
        T item = clazz.newInstance();
    }
}
```

### 项目如何解决擦除问题

```java
// Msg.java
public <T> T getStructuredData(Class<T> clazz) {
    // 通过传入 Class<T> 解决类型擦除
    JsonNode data = metadata.get("structured_data");
    return jsonCodec.decode(data, clazz);  // 使用 clazz 进行转换
}
```

## 源码对照

阅读以下源码，找到泛型使用：

| 文件 | 泛型应用 | 行号 |
|---|---|---|
| `agent/Agent.java` | `Mono<Msg> call()` | 接口定义 |
| `model/Model.java` | `Flux<ChatResponse> stream()` | 接口定义 |
| `tool/AgentTool.java` | `interface AgentTool<T>` | 接口定义 |
| `hook/Hook.java` | `<T extends HookEvent> onEvent(T)` | 泛型方法 |
| `Msg.java` | `<T> getStructuredData(Class<T>)` | 泛型方法 |

## 自检问题

1. 泛型通配符 `<?>`, `<? extends T>`, `<? super T>` 各有什么用途？
2. PECS 原则是什么？
3. 为什么不能用 `new T()` 创建泛型对象？
4. 泛型方法 `<T>` 声明位置在哪里？

## 动手实践

```java
// 1. 定义泛型接口
interface Processor<T, R> {
    R process(T input);
}

// 2. 实现泛型接口
class StringProcessor implements Processor<String, Integer> {
    @Override
    public Integer process(String input) {
        return input.length();
    }
}

// 3. 泛型方法实践
class Utils {
    // 泛型方法：类型参数 <T> 在返回类型之前
    public static <T> List<T> createList(T... elements) {
        return Arrays.asList(elements);
    }
}

// 使用
List<String> strings = Utils.createList("a", "b", "c");
List<Integer> ints = Utils.createList(1, 2, 3);
```

---

**下一步**：阅读 [03-interfaces.md](03-interfaces.md)