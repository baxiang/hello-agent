# Java 17 新特性

agentscope-java 使用 Java 17 作为基础版本，源码中大量使用了 Java 17 的新特性。

## 核心特性概览

| 特性 | 项目应用 | 文档位置 |
|---|---|---|
| **record** | `Msg`, `ContentBlock` 子类 | message/Msg.java |
| **sealed class** | `HookEvent` 类型层次 | hook/HookEvent.java |
| **var 类型推断** | 局部变量简化 | 全项目 |
| **增强 switch** | 状态判断 | plan/SubTaskState.java |

## 1. Record (记录类)

### 什么是 record？

`record` 是 Java 14 引入、Java 16 正式化的不可变数据载体类。自动生成：
- 所有字段的 getter
- `equals()`, `hashCode()`, `toString()`
- 构造器

### 传统类 vs record

```java
// 传统方式 (需要手动编写 getter/equals/hashCode/toString)
public final class TextBlockOld {
    private final String text;
    
    public TextBlockOld(String text) {
        this.text = text;
    }
    
    public String getText() { return text; }
    
    @Override
    public boolean equals(Object o) { ... }  // 20+ 行
    
    @Override
    public int hashCode() { ... }  // 10+ 行
    
    @Override
    public String toString() { ... }  // 5+ 行
}

// record 方式 (一行代码，自动生成所有方法)
public record TextBlock(String text) implements ContentBlock {}
```

### 项目中的 record

查看 `src/agentscope-core/src/main/java/io/agentscope/core/message/ContentBlock.java`：

```java
public sealed class ContentBlock implements State permits 
    TextBlock, ThinkingBlock, ImageBlock, AudioBlock, VideoBlock, 
    ToolUseBlock, ToolResultBlock {
    
    // 7 种实现都是 final class（非 record）
}

// TextBlock 是 record
public record TextBlock(String text) implements ContentBlock {
    public String type() { return "text"; }
}

// ToolUseBlock 是 record  
public record ToolUseBlock(
    String id,
    String name,
    JsonNode input
) implements ContentBlock {
    public String type() { return "tool_use"; }
}
```

### record 的特点

| 特点 | 说明 |
|---|---|
| **不可变** | 所有字段 final，无法修改 |
| **紧凑** | 一行定义，自动生成方法 |
| **线程安全** | 不可变 = 天然线程安全 |
| **适合 DTO** | 数据传输对象、消息载体 |

### 实践：创建 record

```java
// 定义简单的消息记录
public record UserMessage(String userId, String content, long timestamp) {}

// 使用
UserMessage msg = new UserMessage("user1", "Hello", System.currentTimeMillis());
System.out.println(msg.content());      // getter: content() 不是 getContent()
System.out.println(msg);                 // toString: UserMessage[userId=user1, content=Hello, timestamp=...]

// record 可以有额外方法
public record Point(int x, int y) {
    public double distance() {
        return Math.sqrt(x * x + y * y);
    }
}
```

## 2. Sealed Class (密封类)

### 什么是 sealed？

`sealed` 关键字限制哪些类可以继承或实现某个接口/类。

```java
// 只允许这 7 种类型继承 ContentBlock
public sealed class ContentBlock implements State permits 
    TextBlock, ThinkingBlock, ImageBlock, AudioBlock, 
    VideoBlock, ToolUseBlock, ToolResultBlock {
}
```

### sealed 的三种子类修饰符

| 修饰符 | 说明 |
|---|---|
| `final` | 不能再被继承 |
| `sealed` | 继续限制继承者 (需声明 permits) |
| `non-sealed` | 打开继承限制，任何人可继承 |

### 项目中的 sealed

查看 `hook/HookEvent.java`：

```java
public abstract sealed class HookEvent permits
    PreCallEvent, PostCallEvent, ErrorEvent,
    ReasoningEvent, ActingEvent, SummaryEvent {
    
    // 每种事件都是 record 或 final class
    // 编译器保证只有这 12 种事件类型存在
}
```

### sealed 的好处

1. **类型安全** — 编译器知道所有可能的子类
2. **穷举检查** — switch 语句可以检查是否覆盖所有情况
3. **防止滥用** — 限制继承，保持架构清晰

### 实践：sealed + switch

```java
sealed interface Shape permits Circle, Rectangle, Square {}

record Circle(double radius) implements Shape {}
record Rectangle(double width, double height) implements Shape {}
record Square(double side) implements Shape {}

// 编译器检查：是否覆盖所有 Shape 子类？
double area(Shape shape) {
    return switch (shape) {
        case Circle c    -> Math.PI * c.radius() * c.radius();
        case Rectangle r -> r.width() * r.height();
        case Square s    -> s.side() * s.side();
        // 如果漏掉任何子类，编译器报错
    };
}
```

## 3. var 类型推断

### 什么是 var？

`var` 让编译器自动推断局部变量类型（不是 JavaScript 的 var，类型仍然静态）。

```java
// 传统方式
DashScopeChatModel model = DashScopeChatModel.builder()
    .apiKey("key")
    .modelName("qwen-plus")
    .build();

// var 方式
var model = DashScopeChatModel.builder()
    .apiKey("key")
    .modelName("qwen-plus")
    .build();
// 编译器推断出 model 的类型是 DashScopeChatModel
```

### 项目中的 var

在 `ReActAgent.java` 中大量使用：

```java
// ReActAgent.java:500 左右
var inputMsgs = new ArrayList<Msg>();
var systemPrompt = buildSystemPrompt();
var reasoningContext = ReasoningContext.create();
```

### var 的限制

| 限制 | 说明 |
|---|---|
| 只能用于局部变量 | 不能用于字段、参数、返回类型 |
| 必须有初始值 | 编译器需要推断类型 |
| 不能用于 null | `var x = null;` ❌ 编译器无法推断 |

### 最佳实践

```java
// 好的使用场景：类型明显
var list = new ArrayList<String>();  // 类型明显是 ArrayList<String>
var msg = Msg.builder().role(USER).build();  // 类型明显

// 不好的使用场景：类型不明显
var result = someComplexMethod();  // 需要查看方法返回类型才知道
// 建议显式写明类型
Msg result = someComplexMethod();  // 更清晰
```

## 4. 增强 switch

### 传统 switch vs 新 switch

```java
// 传统 switch (容易漏掉 case，没有返回值)
String type;
switch (block.type()) {
    case "text":
        type = "文本";
        break;
    case "image":
        type = "图片";
        break;
    default:
        type = "其他";
}

// 新 switch (表达式形式，可以直接返回)
String type = switch (block.type()) {
    case "text"   -> "文本";
    case "image"  -> "图片";
    default       -> "其他";
};
```

### 模式匹配 switch (Java 17 预览，Java 21 正式)

```java
// 根据类型执行不同逻辑
String process(ContentBlock block) {
    return switch (block) {
        case TextBlock t      -> "文本: " + t.text();
        case ToolUseBlock tu  -> "工具调用: " + tu.name();
        case ImageBlock i     -> "图片: " + i.url();
        default               -> "未知类型";
    };
}
```

## 源码对照

阅读以下源码文件，找到 record/sealed/var 的使用：

| 文件 | 特性 | 行号范围 |
|---|---|---|
| `message/ContentBlock.java` | sealed class + 7种 final class | 1-60 |
| `message/TextBlock.java` | record 定义 | 全文件 |
| `message/ToolUseBlock.java` | record 定义 | 全文件 |
| `hook/HookEvent.java` | sealed class | 1-30 |
| `ReActAgent.java` | var 使用 | 搜索 `var` 关键字 |

## 自检问题

1. `record` 自动生成哪些方法？
2. `sealed` 的三种子类修饰符是什么？各有什么含义？
3. `var` 能用于类字段吗？为什么？
4. sealed class + switch 模式匹配有什么好处？

## 动手实践

创建一个简单的 record 和 sealed 接口：

```java
// 1. 创建 sealed 接口
sealed interface PaymentMethod permits CreditCard, PayPal, BankTransfer {}

// 2. 创建 record 实现
record CreditCard(String number, String holder) implements PaymentMethod {}
record PayPal(String email) implements PaymentMethod {}
record BankTransfer(String account, String bank) implements PaymentMethod {}

// 3. 使用 switch 处理
String describe(PaymentMethod method) {
    return switch (method) {
        case CreditCard cc -> "信用卡: " + cc.number();
        case PayPal pp     -> "PayPal: " + pp.email();
        case BankTransfer bt -> "银行转账: " + bt.account();
    };
}
```

---

**下一步**：阅读 [02-generics.md](02-generics.md)