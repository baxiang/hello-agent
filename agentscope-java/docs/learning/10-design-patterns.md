# Java 设计模式

agentscope-java 使用多种设计模式构建架构，识别这些模式有助于理解代码结构。

## 设计模式概览

| 模式 | 项目应用 | 文件 |
|---|---|---|
| **Builder** | 构建复杂对象 | `ReActAgent.builder()` |
| **Template Method** | 定义执行框架 | `AgentBase.call()` |
| **Strategy** | 可替换的算法 | `Model` 接口实现 |
| **Observer** | Hook 事件通知 | `Hook.onEvent()` |
| **Facade** | 简化复杂系统 | `Toolkit` 外观 |
| **Factory** | 创建对象 | `MetaToolFactory` |
| **Decorator** | 动态添加功能 | `StreamingHook` |
| **State** | 状态管理 | `StateModule` |

## 1. Builder 模式 (构建器)

已在 [05-builder-pattern.md](05-builder-pattern.md) 详细讲解。

## 2. Template Method 模式 (模板方法)

### 定义执行框架，子类填空

```java
// AgentBase.java — 模板方法
public abstract class AgentBase {
    // 模板方法：定义执行流程
    public Mono<Msg> call(List<Msg> msgs) {
        return Mono.using(
            this::acquireExecution,        // 步骤1：获取执行权
            agent -> {
                return checkInterruptedAsync()     // 步骤2：检查中断
                    .then(preCall(msgs))            // 步骤3：前置 Hook
                    .flatMap(m -> doCall(m))        // 步骤4：子类实现 (钩子方法)
                    .flatMap(m -> postCall(m))      // 步骤5：后置 Hook
                    .onErrorResume(this::handleError); // 步骤6：错误处理
            },
            this::releaseExecution         // 步骤7：释放执行权
        );
    }
    
    // 钩子方法：子类必须实现
    protected abstract Mono<Msg> doCall(List<Msg> msgs);
    
    // 钩子方法：子类可选实现
    protected Mono<Msg> handleInterrupt(InterruptContext ctx, Msg... msgs) {
        return Mono.just(defaultInterruptResponse());
    }
}

// ReActAgent.java — 子类实现
public class ReActAgent extends AgentBase {
    @Override
    protected Mono<Msg> doCall(List<Msg> msgs) {
        return reasoning()
            .flatMap(msg -> {
                if (isFinished(msg)) return Mono.just(msg);
                return acting().then(reasoning());
            });
    }
    
    @Override
    protected Mono<Msg> handleInterrupt(InterruptContext ctx, Msg... msgs) {
        return saveState().thenReturn(interruptResponse);
    }
}
```

### Template Method 的好处

| 好处 | 说明 |
|---|---|---|
| **代码复用** | 公共逻辑在父类，子类只关注核心 |
| **一致性** | 所有 Agent 执行流程一致 |
| **可扩展** | 新 Agent 只需填空，不需重写流程 |

## 3. Strategy 模式 (策略)

### 可替换的算法实现

```java
// Model.java — 策略接口
public interface Model {
    Flux<ChatResponse> stream(List<Msg> messages, List<ToolSchema> tools, GenerateOptions options);
}

// 多种策略实现
public class DashScopeChatModel implements Model {
    @Override
    public Flux<ChatResponse> stream(...) {
        // 通义千问实现
    }
}

public class OpenAIChatModel implements Model {
    @Override
    public Flux<ChatResponse> stream(...) {
        // OpenAI 实现
    }
}

public class GeminiChatModel implements Model {
    @Override
    public Flux<ChatResponse> stream(...) {
        // Gemini 实现
    }
}

// 使用：可随时切换策略
ReActAgent agent = ReActAgent.builder()
    .model(new DashScopeChatModel(...))  // 策略1
    .build();

agent = ReActAgent.builder()
    .model(new OpenAIChatModel(...))     // 策略2
    .build();
```

### Strategy 的好处

| 好处 | 说明 |
|---|---|---|
| **可替换** | 不同 Model 可随时切换 |
| **易扩展** | 新 Model 只需实现接口 |
| **解耦** | ReActAgent 不关心具体 Model |

## 4. Observer 模式 (观察者)

### Hook 事件通知

```java
// Hook.java — 观察者接口
public interface Hook {
    <T extends HookEvent> Mono<T> onEvent(T event);  // 处理事件
    default int priority() { return 100; }
}

// AgentBase.java — 主题 (被观察)
public abstract class AgentBase {
    private final List<Hook> hooks;  // 观察者列表
    
    public void addHook(Hook hook) {
        hooks.add(hook);
    }
    
    // 通知所有观察者
    private Mono<List<Msg>> notifyHooks(HookEvent event) {
        return Flux.fromIterable(hooks)
            .flatMap(hook -> hook.onEvent(event))
            .then(Mono.just(event.getInputMessages()));
    }
    
    // 在执行流程中触发事件
    public Mono<Msg> call(List<Msg> msgs) {
        return Mono.just(new PreCallEvent(msgs))
            .flatMap(this::notifyHooks)  // 通知 PreCall
            .flatMap(m -> doCall(m))
            .flatMap(m -> {
                PostCallEvent post = new PostCallEvent(m);
                return notifyHooks(post).thenReturn(m);
            });
    }
}

// 自定义 Hook (观察者)
public class LoggingHook implements Hook {
    @Override
    public <T extends HookEvent> Mono<T> onEvent(T event) {
        if (event instanceof PreCallEvent pre) {
            log.info("Agent call started: {}", pre.getInputMessages());
        } else if (event instanceof PostCallEvent post) {
            log.info("Agent call finished: {}", post.getOutputMessage());
        }
        return Mono.just(event);
    }
}
```

### Observer 的好处

| 好处 | 说明 |
|---|---|---|
| **解耦** | Agent 和 Hook 互不依赖 |
| **可插拔** | Hook 可随时添加/移除 |
| **扩展性** | 新功能只需添加新 Hook |

## 5. Facade 模式 (外观)

### Toolkit 简化复杂系统

```java
// Toolkit.java — 外观类
public class Toolkit {
    // 内部复杂组件
    private final ToolRegistry registry;
    private final ToolGroupManager groupManager;
    private final ToolSchemaProvider schemaProvider;
    private final McpClientManager mcpClientManager;
    private final ToolExecutor executor;
    
    // 简化的外观方法
    public void registerTool(Object toolObject) {
        registry.register(...);
        schemaProvider.update(...);
    }
    
    public void registerAgentTool(AgentTool tool) {
        registry.register(tool);
    }
    
    public ToolRegistration registration() {
        return new ToolRegistration(this);
    }
    
    public Mono<ToolResultBlock> execute(ToolUseBlock toolUse) {
        return executor.execute(toolUse);
    }
}

// 使用：简单的外观接口
Toolkit toolkit = new Toolkit();
toolkit.registerTool(new WeatherTools());
toolkit.registration().mcpClient(client).apply();
```

### Facade 的好处

| 好处 | 说明 |
|---|---|---|
| **简化** | 隐藏内部复杂组件 |
| **解耦** | 客户端不依赖内部实现 |
| **易用** | 一行代码完成复杂操作 |

## 6. Factory 模式 (工厂)

### 创建工具对象

```java
// MetaToolFactory.java — 工厂
public class MetaToolFactory {
    private final ToolGroupManager groupManager;
    private final ToolRegistry registry;
    
    public AgentTool createResetEquippedToolsTool() {
        return new AgentTool() {
            @Override
            public String name() {
                return "reset_equipped_tools";
            }
            
            @Override
            public Mono<JsonNode> execute(JsonNode input, ToolExecutionContext ctx) {
                List<String> groups = parseGroups(input);
                boolean activate = parseActivate(input);
                groupManager.updateGroups(groups, activate);
                return Mono.just(successResult());
            }
        };
    }
}
```

## 7. State 模式 (状态)

### 状态持久化

```java
// StateModule.java — 状态接口
public interface StateModule {
    void saveTo(Session session, SessionKey key);
    void loadFrom(Session session, SessionKey key);
    default boolean hasState() { return true; }
}

// 多种状态实现
public class ReActAgent extends AgentBase implements StateModule {
    @Override
    public void saveTo(Session session, SessionKey key) {
        AgentMetaState state = new AgentMetaState(agentId, name, sysPrompt);
        session.save(key, "agent_meta", state);
        
        memory.saveTo(session, key);
        toolkit.saveTo(session, key);
    }
    
    @Override
    public void loadFrom(Session session, SessionKey key) {
        AgentMetaState state = session.get(key, "agent_meta", AgentMetaState.class);
        this.sysPrompt = state.sysPrompt();
        
        memory.loadFrom(session, key);
        toolkit.loadFrom(session, key);
    }
}
```

## 8. Decorator 模式 (装饰器)

### 动态添加功能

```java
// StreamingHook.java — 装饰器
public class StreamingHook implements Hook {
    private final Hook delegate;  // 被装饰的 Hook
    
    public StreamingHook(Hook delegate) {
        this.delegate = delegate;
    }
    
    @Override
    public <T extends HookEvent> Mono<T> onEvent(T event) {
        // 装饰：添加流式输出功能
        if (event instanceof ReasoningChunkEvent chunk) {
            emitStreamChunk(chunk);
        }
        
        // 调用原始 Hook
        return delegate.onEvent(event);
    }
}

// 使用装饰器
Hook originalHook = new LoggingHook();
Hook streamingHook = new StreamingHook(originalHook);

agent.addHook(streamingHook);
```

## 源码对照

| 模式 | 文件 | 关键代码 |
|---|---|---|
| Builder | `ReActAgent.java` | `Builder` 内部类 |
| Template Method | `AgentBase.java` | `call()` 方法 |
| Strategy | `Model.java` | 接口 + 多实现 |
| Observer | `Hook.java`, `AgentBase.java` | `onEvent()`, `notifyHooks()` |
| Facade | `Toolkit.java` | 外观方法 |
| Factory | `MetaToolFactory.java` | `create...Tool()` |
| State | `StateModule.java` | `saveTo/loadFrom` |

## 自检问题

1. Template Method 模式的核心思想是什么？
2. Strategy 模式如何实现可替换的算法？
3. Observer 模式在 Hook 系统中的作用是什么？
4. Facade 模式如何简化 Toolkit 的使用？

---

**下一步**：阅读 [11-llm-concepts.md](11-llm-concepts.md)