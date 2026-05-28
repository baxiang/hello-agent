# Java 函数式编程

agentscope-java 大量使用 Lambda 表达式和函数式接口，是响应式编程的基础。

## 函数式编程概览

| 概念 | 项目应用 | 说明 |
|---|---|---|
| Lambda 表达式 | `.map(x -> x.toString())` | 简洁的匿名函数 |
| 函数式接口 | `Function<T,R>`, `Consumer<T>` | 只有一个抽象方法的接口 |
| 方法引用 | `.map(Msg::getContent)` | Lambda 的简化形式 |
| Stream API | `hooks.stream().sorted()` | 集合的函数式操作 |

## 1. Lambda 表达式

### Lambda 语法

```java
// 基本语法
(parameters) -> expression

// 或多行代码块
(parameters) -> {
    statements;
    return result;
}
```

### 项目中的 Lambda

```java
// ReActAgent.java — 排序 Hook
hooks.sort((h1, h2) -> Integer.compare(h1.priority(), h2.priority()));

// 简化为方法引用
hooks.sort(Comparator.comparingInt(Hook::priority));

// AgentBase.java — Mono 链式操作
return Mono.using(
    this::acquireExecution,          // Lambda: () -> acquireExecution()
    agent -> doCall(msgs),           // Lambda: agent -> doCall(msgs)
    this::releaseExecution           // Lambda: () -> releaseExecution()
);

// Toolkit.java — 创建工具组
groups.stream()
    .filter(g -> g.isActive())       // Lambda: g -> g.isActive()
    .map(g -> g.getName())           // Lambda: g -> g.getName()
    .collect(Collectors.toList());   // 收集结果
```

### Lambda 类型推断

```java
// 编译器推断 Lambda 参数类型
List<String> names = List.of("Alice", "Bob", "Charlie");

// 不需要写 (String name) -> name.length()
names.stream()
    .filter(name -> name.length() > 3)  // name 类型推断为 String
    .forEach(name -> System.out.println(name));
```

## 2. 函数式接口

### Java 内置函数式接口

| 接口 | 方法签名 | 用途 | 项目应用 |
|---|---|---|---|
| `Function<T,R>` | `R apply(T t)` | 输入 → 输出 | `.map(Function)` |
| `Consumer<T>` | `void accept(T t)` | 消费输入 | `.forEach(Consumer)` |
| `Supplier<T>` | `T get()` | 提供输出 | `Mono.fromSupplier(Supplier)` |
| `Predicate<T>` | `boolean test(T t)` | 判断条件 | `.filter(Predicate)` |
| `BiFunction<T,U,R>` | `R apply(T t, U u)` | 双输入 → 输出 | `reduce()` |
| `UnaryOperator<T>` | `T apply(T t)` | 同类型转换 | `.map()` 类型不变 |

### 项目中的函数式接口使用

```java
// Mono.map() 参数是 Function<T, R>
public final <R> Mono<R> map(Function<? super T, ? extends R> mapper) {
    // mapper.apply(value) 转换值
}

// 使用
Mono<Msg> mono = ...;
Mono<String> textMono = mono.map(msg -> msg.getContent().get(0).text());
// Function<Msg, String>: msg -> msg.getContent()...text()

// Mono.filter() 参数是 Predicate<T>
public final Mono<T> filter(Predicate<? super T> tester) {
    // tester.test(value) 判断是否保留
}

// 使用
mono.filter(msg -> msg.getContent().size() > 0);
// Predicate<Msg>: msg -> msg.getContent().size() > 0

// Mono.subscribe() 参数是 Consumer<T>
public final Disposable subscribe(Consumer<? super T> consumer) {
    // consumer.accept(value) 消费值
}

// 使用
mono.subscribe(msg -> System.out.println(msg));
// Consumer<Msg>: msg -> System.out.println(msg)
```

### 自定义函数式接口

```java
// @FunctionalInterface 标记 (可选，编译器会检查)
@FunctionalInterface
public interface HookProcessor {
    Mono<HookEvent> process(HookEvent event);
}

// 可以用 Lambda 创建实例
HookProcessor processor = event -> Mono.just(event);

// 项目中的 Hook 接口
public interface Hook {
    <T extends HookEvent> Mono<T> onEvent(T event);  // 泛型方法
    
    default int priority() { return 100; }
}

// 用 Lambda 实现 Hook (简化版)
Hook simpleHook = event -> {
    if (event instanceof PreReasoningEvent pre) {
        pre.appendSystemContent("额外提示");
    }
    return Mono.just(event);
};
```

## 3. 方法引用

### 四种方法引用

| 类型 | 语法 | 示例 |
|---|---|---|
| 静态方法引用 | `ClassName::staticMethod` | `Integer::parseInt` |
| 实例方法引用 | `instance::method` | `this::doCall` |
| 类型方法引用 | `ClassName::method` | `String::length` |
| 构造器引用 | `ClassName::new` | `ArrayList::new` |

### 项目中的方法引用

```java
// 静态方法引用
hooks.sort(Comparator.comparingInt(Hook::priority));
// Hook::priority 等价于 h -> h.priority()

// 类型方法引用
List<Msg> msgs = ...;
msgs.stream()
    .map(Msg::getContent)     // 等价于 msg -> msg.getContent()
    .forEach(System.out::println);  // 等价于 x -> System.out.println(x)

// 实例方法引用
return Mono.using(
    this::acquireExecution,    // 等价于 () -> this.acquireExecution()
    agent -> doCall(msgs),
    this::releaseExecution    // 等价于 () -> this.releaseExecution()
);

// 构造器引用
List<Hook> hooks = events.stream()
    .map(PreCallEvent::new)    // 等价于 e -> new PreCallEvent(e)
    .collect(Collectors.toList());
```

### 方法引用 vs Lambda

```java
// Lambda 形式
names.stream()
    .filter(name -> name.isEmpty())
    .map(name -> name.toUpperCase())
    .forEach(name -> System.out.println(name));

// 方法引用形式 (更简洁)
names.stream()
    .filter(String::isEmpty)           // 类型方法引用
    .map(String::toUpperCase)          // 类型方法引用
    .forEach(System.out::println);     // 实例方法引用
```

## 4. Stream API

### Stream 操作分类

| 类型 | 操作 | 说明 |
|---|---|---|
| **中间操作** | `filter`, `map`, `flatMap`, `sorted`, `distinct` | 返回新 Stream，可链式 |
| **终端操作** | `collect`, `forEach`, `reduce`, `count`, `findFirst` | 产生结果，结束流 |

### 项目中的 Stream 使用

```java
// AgentBase.java — Hook 排序
private static final Comparator<Hook> HOOK_COMPARATOR = 
    Comparator.comparingInt(Hook::priority);

hooks.sort(HOOK_COMPARATOR);
// 或
hooks = hooks.stream()
    .sorted(Comparator.comparingInt(Hook::priority))
    .collect(Collectors.toList());

// Toolkit.java — 工具过滤
List<AgentTool> activeTools = tools.stream()
    .filter(tool -> tool.isEnabled())          // 中间操作
    .filter(tool -> groupManager.isToolActive(tool.name()))  // 中间操作
    .collect(Collectors.toList());             // 终端操作

// ReActAgent.java — 消息处理
List<ContentBlock> toolUses = response.getContent().stream()
    .filter(block -> block instanceof ToolUseBlock)  // 过滤
    .map(block -> (ToolUseBlock) block)              // 类型转换
    .collect(Collectors.toList());
```

### 常用 Stream 操作

```java
// filter — 过滤
hooks.stream()
    .filter(h -> h.priority() < 100)
    .collect(Collectors.toList());

// map — 转换
names.stream()
    .map(String::toUpperCase)
    .collect(Collectors.toList());

// flatMap — 展平 (一对一多)
msgs.stream()
    .flatMap(msg -> msg.getContent().stream())  // Msg → List<ContentBlock> → Stream<ContentBlock>
    .collect(Collectors.toList());

// sorted — 排序
hooks.stream()
    .sorted(Comparator.comparingInt(Hook::priority).reversed())
    .collect(Collectors.toList());

// reduce — 聚合
int totalPriority = hooks.stream()
    .map(Hook::priority)
    .reduce(0, (a, b) -> a + b);

// collect — 收集
List<Hook> list = hooks.stream().collect(Collectors.toList());
Set<String> set = names.stream().collect(Collectors.toSet());
Map<String, Hook> map = hooks.stream().collect(Collectors.toMap(Hook::name, h -> h));
```

## 5. Lambda 闭包

### 捕获外部变量

```java
// Lambda 可以捕获外部变量 (必须是 final 或等效 final)
String prefix = "Agent: ";

hooks.forEach(h -> {
    System.out.println(prefix + h.priority());  // 捕获 prefix
});

// 修改捕获变量 ❌ 不允许
String prefix = "Agent: ";
hooks.forEach(h -> {
    prefix = "New: ";  // 编译错误
    System.out.println(prefix + h.priority());
});
```

### 项目中的闭包

```java
// ReActAgent.java — 捕获局部变量
int iteration = 0;  // 等效 final

return reasoning(iteration)
    .flatMap(response -> {
        // Lambda 捕获 iteration
        if (isFinished(response)) {
            return Mono.just(response);
        }
        iteration++;  // ❌ 编译错误，不能修改捕获变量
        return acting(iteration).then(reasoning(iteration + 1));
    });

// 正确方式：使用 AtomicReference
AtomicReference<Integer> iterRef = new AtomicReference<>(0);

return reasoning(iterRef.get())
    .flatMap(response -> {
        if (isFinished(response)) {
            return Mono.just(response);
        }
        iterRef.updateAndGet(i -> i + 1);  // 可以修改 AtomicReference
        return acting(iterRef.get()).then(reasoning(iterRef.get()));
    });
```

## 源码对照

| 文件 | Lambda/函数式接口 | 行号示例 |
|---|---|---|
| `AgentBase.java` | `Mono.using(...)` | 搜索 "Mono.using" |
| `ReActAgent.java` | `.flatMap(msg -> ...)` | 搜索 "flatMap" |
| `Toolkit.java` | `.filter(tool -> ...)` | 搜索 "filter" |
| `ToolSchemaGenerator.java` | `stream().map()` | 搜索 "stream()" |

## 自检问题

1. `Function<T,R>` 和 `Consumer<T>` 的区别是什么？
2. 方法引用的四种类型分别是什么？
3. Lambda 能捕获外部变量吗？有什么限制？
4. Stream 的中间操作和终端操作有什么区别？

## 动手实践

```java
// 1. 使用函数式接口
Function<String, Integer> stringToInt = s -> Integer.parseInt(s);
Consumer<String> printer = s -> System.out.println(s);
Supplier<String> greeting = () -> "Hello";
Predicate<String> isEmpty = s -> s.isEmpty();

// 2. 方法引用
Function<String, Integer> parseInt = Integer::parseInt;
Consumer<String> print = System.out::println;
Predicate<String> empty = String::isEmpty;

// 3. Stream 操作
List<String> names = List.of("Alice", "Bob", "Charlie", "David");

List<String> filtered = names.stream()
    .filter(name -> name.length() > 3)
    .map(String::toUpperCase)
    .sorted()
    .collect(Collectors.toList());

// 4. 自定义函数式接口
@FunctionalInterface
interface StringProcessor {
    String process(String input);
}

// Lambda 实现
StringProcessor trimmer = s -> s.trim();
StringProcessor upper = s -> s.toUpperCase();

// 组合使用
String result = upper.process(trimmer.process("  hello  "));
```

---

**下一步**：阅读 [07-concurrent.md](07-concurrent.md)