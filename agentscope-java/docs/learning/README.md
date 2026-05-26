# AgentScope Java 学习路径

本目录包含学习 agentscope-java 源码所需的核心 Java 知识点，每个知识点结合项目源码实例讲解。

## 学习路径图

```
第一阶段：基础准备 (1-2周)
├── 01-java17-features.md    ← record, sealed, var (必读)
├── 02-generics.md           ← 泛型基础 (必读)
├── 03-interfaces.md         ← 接口与抽象类 (必读)
├── 04-annotations.md        ← @Tool, Jackson 注解 (必读)
├── 05-builder-pattern.md    ← 流式 Builder API (必读)
└── 06-functional.md         ← Lambda, Function<T,R> (必读)

第二阶段：核心技术栈 (2-3周)
├── 07-concurrent.md         ← 线程安全, Atomic* (重点)
├── 08-reactive.md           ← Mono/Flux 响应式 (核心，最重要)
└── 09-jackson.md            ← JSON 序列化, 多态类型 (重点)

第三阶段：进阶知识 (持续)
├── 10-design-patterns.md    ← 设计模式识别
└── 11-llm-concepts.md       ← ReAct, Tool Calling, MCP
```

## 必读顺序

| 顺序 | 文档 | 重要性 | 预计时间 | 源码关联 |
|---|---|---|---|---|
| 1 | [Java 17 新特性](01-java17-features.md) | ⭐⭐⭐⭐⭐ | 2小时 | `Msg`, `ContentBlock`, `HookEvent` |
| 2 | [泛型](02-generics.md) | ⭐⭐⭐⭐⭐ | 2小时 | `Mono<T>`, `Flux<T>`, `AgentTool<T>` |
| 3 | [响应式编程](08-reactive.md) | ⭐⭐⭐⭐⭐ | 8小时 | `ReActAgent.call()`, 所有 I/O |
| 4 | [函数式编程](06-functional.md) | ⭐⭐⭐⭐ | 3小时 | `.map()`, `.flatMap()`, Lambda |
| 5 | [并发编程](07-concurrent.md) | ⭐⭐⭐⭐ | 4小时 | `AtomicBoolean`, `CopyOnWriteArrayList` |
| 6 | [注解](04-annotations.md) | ⭐⭐⭐⭐ | 2小时 | `@Tool`, `@ToolParam`, `@JsonTypeInfo` |
| 7 | [Jackson JSON](09-jackson.md) | ⭐⭐⭐⭐ | 3小时 | `Msg` 序列化, 多态 ContentBlock |
| 8 | [Builder 模式](05-builder-pattern.md) | ⭐⭐⭐ | 1小时 | `ReActAgent.builder()`, `Msg.builder()` |
| 9 | [接口与抽象类](03-interfaces.md) | ⭐⭐⭐ | 2小时 | `Agent`, `Model`, `Hook`, `Memory` |
| 10 | [设计模式](10-design-patterns.md) | ⭐⭐⭐ | 2小时 | 整体架构识别 |
| 11 | [LLM 概念](11-llm-concepts.md) | ⭐⭐⭐ | 3小时 | ReAct 循环, Tool Calling |

## 学习建议

### 快速入门路径 (3天)

如果时间有限，优先阅读这 4 个文档：

```
Day 1: 01-java17-features + 02-generics
Day 2: 08-reactive (最重要，花更多时间)
Day 3: 06-functional + 04-annotations
```

然后直接阅读 `ReActAgent.java` 源码。

### 完整学习路径 (2周)

按顺序阅读全部文档，每读完一个文档，对照源码验证：

```
读完 01-java17-features → 查看 message/Msg.java
读完 02-generics → 查看 agent/Agent.java 接口定义
读完 08-reactive → 查看 ReActAgent.reasoning() 方法
读完 07-concurrent → 查看 AgentBase.running 字段
```

## 源码入口点推荐

| 学习阶段 | 推荐阅读源码 | 说明 |
|---|---|---|
| 入门 | `ReActAgent.java:93-200` | Builder 构建流程 |
| 进阶 | `ReActAgent.java:400-600` | reasoning-acting 循环 |
| 高级 | `AgentBase.java:49-92` | 中断机制、Hook 集成 |
| 工具系统 | `Toolkit.java:37-65` | 工具管理架构 |
| 消息系统 | `Msg.java`, `ContentBlock.java` | 消息结构定义 |

## 实践练习

每个文档末尾包含：
- **自检问题** — 检验是否理解核心概念
- **源码对照** — 在项目中找到对应代码
- **动手实践** — 编写简单代码验证理解

## 相关资源

| 类型 | 资源 | 链接 |
|---|---|---|
| 官方文档 | Project Reactor | https://projectreactor.io/docs |
| 官方文档 | Jackson Wiki | https://github.com/FasterXML/jackson/wiki |
| 教程 | Baeldung Java | https://www.baeldung.com |
| 书籍 | 《Effective Java》第3版 | Joshua Bloch |
| 书籍 | 《Java并发编程实战》 | Brian Goetz |

## 学习检查点

完成所有文档学习后，应能读懂以下代码：

```java
public Mono<Msg> handleUserMessage(Msg input) {
    return Mono.just(input)                    // 创建 Mono
        .flatMap(msg -> validate(msg))         // flatMap 链式
        .map(this::transform)                  // map + 方法引用
        .filter(Msg::isValid)                  // filter + Lambda
        .onErrorResume(e -> fallback())        // 错误处理
        .subscribeOn(Schedulers.boundedElastic());  // 调度器
}
```

并能回答：
1. 为什么返回 `Mono<Msg>` 而不是 `Msg`？
2. `flatMap` 和 `map` 有什么区别？
3. 为什么不能在业务代码中调用 `.block()`？
4. `subscribeOn` 的作用是什么？

---

**下一步**：开始阅读 [01-java17-features.md](01-java17-features.md)