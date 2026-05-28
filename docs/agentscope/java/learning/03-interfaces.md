# 接口与抽象类

agentscope-java 使用接口和抽象类构建层次化的类型系统，理解这两种机制是阅读源码的基础。

## 核心区别

| 特性 | 接口 | 抽象类 |
|---|---|---|
| **继承** | 可实现多个接口 | 只能继承一个抽象类 |
| **方法** | Java 8 前只能抽象方法 | 可有抽象和具体方法 |
| **字段** | 只能是 static final | 可有任意字段 |
| **构造器** | 无构造器 | 有构造器 |
| **设计目的** | 定义契约/行为 | 共享代码/状态 |

## 1. 接口设计模式

### 项目中的接口层次

```
Agent (接口)
  ├── CallableAgent    — call(msgs) → Mono<Msg>
  ├── StreamableAgent  — stream(msgs, options) → Flux<Event>
  └── ObservableAgent  — observe(msg) → Mono<Void>
      │
      ▼
AgentBase (抽象类) — 实现所有 Agent 接口
  ├── ReActAgent
  ├── UserAgent
  └── (其他 Agent 实现)
```

### 多接口实现

查看 `agent/AgentBase.java`：

```java
// AgentBase 实现了多个接口
public abstract class AgentBase 
    implements StateModule, Agent {  // 多接口
    
    // StateModule 接口方法
    @Override
    public void saveTo(Session session, SessionKey key) { ... }
    
    @Override
    public void loadFrom(Session session, SessionKey key) { ... }
    
    // Agent 接口方法
    @Override
    public Mono<Msg> call(List<Msg> msgs) { ... }
}
```

### 接口隔离原则

项目将 Agent 功能拆分为多个接口：

```java
// agent/Agent.java
public interface Agent {
    String agentId();
    String name();
    String description();
}

// agent/CallableAgent.java — 可调用的 Agent
public interface CallableAgent extends Agent {
    Mono<Msg> call(List<Msg> msgs);
}

// agent/StreamableAgent.java — 可流式输出的 Agent  
public interface StreamableAgent extends Agent {
    Flux<Event> stream(List<Msg> msgs, StreamOptions options);
}

// agent/ObservableAgent.java — 可观察消息的 Agent
public interface ObservableAgent extends Agent {
    Mono<Void> observe(Msg msg);
}
```

**好处**：每个接口职责单一，AgentBase 可以选择性实现。

## 2. 抽象类设计模式

### AgentBase 的职责

```java
public abstract class AgentBase implements StateModule, Agent {
    // 字段 — 抽象类可以定义状态
    private final String agentId;
    private final String name;
    private final AtomicBoolean running = new AtomicBoolean(false);
    private final List<Hook> hooks;
    private final AtomicBoolean interruptFlag = new AtomicBoolean(false);
    
    // 构造器 — 抽象类可以定义构造器
    public AgentBase(String name, String description, boolean checkRunning, List<Hook> hooks) {
        this.agentId = UUID.randomUUID().toString();
        this.name = name;
        this.description = description;
        this.hooks = new CopyOnWriteArrayList<>(hooks);
    }
    
    // 具体方法 — 共享逻辑
    public final void addHook(Hook hook) {
        hooks.add(hook);
        hooks.sort(HOOK_COMPARATOR);
    }
    
    // 抽象方法 — 子类必须实现
    protected abstract Mono<Msg> doCall(List<Msg> msgs);
    protected abstract Mono<Msg> handleInterrupt(InterruptContext ctx, Msg... msgs);
    
    // 模板方法 — 定义执行框架
    public Mono<Msg> call(List<Msg> msgs) {
        return Mono.using(
            this::acquireExecution,
            agent -> doCall(msgs),
            this::releaseExecution
        );
    }
}
```

### ReActAgent 继承 AgentBase

```java
public class ReActAgent extends AgentBase {
    // ReActAgent 自己的字段
    private final Model model;
    private final Toolkit toolkit;
    private final Memory memory;
    
    // 实现抽象方法
    @Override
    protected Mono<Msg> doCall(List<Msg> msgs) {
        // ReAct 循环逻辑
        return reasoning()
            .flatMap(msg -> {
                if (isFinished(msg)) return Mono.just(msg);
                return acting().then(reasoning());
            });
    }
    
    @Override
    protected Mono<Msg> handleInterrupt(InterruptContext ctx, Msg... msgs) {
        // 中断恢复逻辑
        return Mono.just(buildInterruptResponse(ctx));
    }
}
```

## 3. 模板方法模式

AgentBase 使用模板方法模式定义执行框架：

```java
public abstract class AgentBase {
    // 模板方法 — 定义执行流程
    public Mono<Msg> call(List<Msg> msgs) {
        return Mono.using(
            this::acquireExecution,     // 步骤1：获取执行权
            agent -> {
                return checkInterruptedAsync()           // 步骤2：检查中断
                    .then(preCall(msgs))                  // 步骤3：前置Hook
                    .flatMap(m -> doCall(m))              // 步骤4：子类实现
                    .flatMap(m -> postCall(m))            // 步骤5：后置Hook
                    .onErrorResume(this::handleError);    // 步骤6：错误处理
            },
            this::releaseExecution      // 步骤7：释放执行权
        );
    }
    
    // 子类实现的具体方法
    protected abstract Mono<Msg> doCall(List<Msg> msgs);
}
```

**好处**：
- 父类定义流程框架
- 子类只需关注核心逻辑
- 公共逻辑（Hook、中断、错误）自动继承

## 4. 接口的默认方法

Java 8 引入默认方法，接口可以有实现：

```java
public interface Hook {
    // 抽象方法 — 子类必须实现
    <T extends HookEvent> Mono<T> onEvent(T event);
    
    // 默认方法 — 子类可直接使用或覆盖
    default int priority() { 
        return 100;  // 默认优先级
    }
    
    default List<Object> tools() {
        return Collections.emptyList();  // 默认不提供工具
    }
}
```

### 项目中的默认方法

```java
// agent/Agent.java
public interface Agent {
    String agentId();
    String name();
    String description();
    
    // 默认方法
    default String sysPrompt() {
        return "";  // 默认空系统提示
    }
}

// state/StateModule.java
public interface StateModule {
    void saveTo(Session session, SessionKey key);
    void loadFrom(Session session, SessionKey key);
    
    // 默认方法
    default boolean hasState() {
        return true;  // 默认有状态
    }
}
```

## 5. 接口 vs 抽象类决策

###何时用接口？

| 场景 | 原因 |
|---|---|
| 定义行为契约 | `Agent`, `Model`, `Hook` 定义"能做什么" |
| 多继承需求 | 类需要实现多个角色 (`StateModule + Agent`) |
| 无状态定义 | 不需要共享字段 |

### 何时用抽象类？

| 场景 | 原因 |
|---|---|
| 共享代码 | `AgentBase` 提供 Hook、中断、状态管理 |
| 共享状态 | `running`, `interruptFlag` 等字段 |
| 模板方法 | 定义执行框架，子类填空 |

### 项目中的选择

```
接口层 — 定义能力
├── Agent          — Agent 的基本属性
├── CallableAgent  — 可调用
├── Model          — 可推理
├── Hook           — 可拦截
├── Memory         — 可存储消息
└── Toolkit        — 可执行工具

抽象类层 — 共享实现
├── AgentBase      — 所有 Agent 共享的基础设施
└── AbstractBaseSandbox  — 所有沙箱共享的基础逻辑
```

## 源码对照

| 文件 | 类型 | 关键内容 |
|---|---|---|
| `agent/Agent.java` | 接口 | Agent 基本属性 |
| `agent/CallableAgent.java` | 接口 | call() 方法 |
| `agent/AgentBase.java` | 抽象类 | 模板方法、共享状态 |
| `hook/Hook.java` | 接口 | 默认方法 priority() |
| `memory/Memory.java` | 接口 | addMessage(), getMessages() |
| `model/Model.java` | 接口 | stream() 方法 |

## 自检问题

1. 接口和抽象类的主要区别是什么？
2. 为什么 AgentBase 是抽象类而不是接口？
3. Java 8 的默认方法解决了什么问题？
4. 模板方法模式的优点是什么？

## 动手实践

```java
// 1. 定义接口层次
interface Worker {
    String name();
    default boolean isActive() { return true; }
}

interface CallableWorker extends Worker {
    Result call(Input input);
}

// 2. 定义抽象类
abstract class BaseWorker implements CallableWorker {
    protected final String name;
    protected final AtomicBoolean active = new AtomicBoolean(true);
    
    public BaseWorker(String name) {
        this.name = name;
    }
    
    // 模板方法
    public final Result call(Input input) {
        if (!active.get()) throw new IllegalStateException("Worker inactive");
        return doCall(input);
    }
    
    // 子类实现
    protected abstract Result doCall(Input input);
}

// 3. 具体实现
class MyWorker extends BaseWorker {
    public MyWorker(String name) { super(name); }
    
    @Override
    protected Result doCall(Input input) {
        return new Result("processed: " + input);
    }
}
```

---

**下一步**：阅读 [04-annotations.md](04-annotations.md)