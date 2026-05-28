# io.agentscope.core.tool — 工具系统详解

## 概述

`tool` 包是 AgentScope 工具系统的核心实现，提供从工具定义、注册、Schema 生成到执行的全链路支持。框架通过 `@Tool` 注解实现声明式工具定义，通过 `Toolkit` 门面类统一管理注册、分组、Schema 生成和执行，并内置 MCP 协议集成、子 Agent 工具、文件操作和 Shell 命令等开箱即用的工具实现。

---

## 1. @Tool 注解

**源文件**：`Tool.java:60`

标记方法为可被 AI Agent 调用的工具，框架通过反射发现 `@Tool` 方法并生成 JSON Schema。

| 属性 | 类型 | 行号 | 说明 |
|------|------|------|------|
| `name` | `String` | :70 | 工具名称，空字符串时使用方法名（建议 snake_case） |
| `description` | `String` | :87 | 工具描述，空字符串时自动生成 |
| `strict` | `boolean` | :97 | 是否启用严格 Schema 模式（默认 false） |
| `converter` | `Class<? extends ToolResultConverter>` | :132 | 自定义结果转换器（默认 DefaultToolResultConverter） |

```java
public class WeatherTools {
    @Tool(name = "get_weather", description = "获取指定城市的天气信息")
    public String getWeather(
            @ToolParam(name = "city", description = "城市名称") String city,
            @ToolParam(name = "unit", description = "温度单位", required = false) String unit) {
        return "晴天, 25" + (unit != null ? unit : "C");
    }
}
```

---

## 2. @ToolParam 注解

**源文件**：`ToolParam.java:62`

描述工具方法的参数，所有参数（除 ToolEmitter 外）必须标注。

| 属性 | 类型 | 行号 | 说明 |
|------|------|------|------|
| `name` | `String` | :76 | 参数名（必填，Java 运行时不保留参数名） |
| `required` | `boolean` | :87 | 是否必填（默认 true） |
| `description` | `String` | :103 | 参数描述，帮助 LLM 理解期望值 |

参数名建议使用 snake_case 以兼容各 LLM 提供商。

---

## 3. AgentTool 接口

**源文件**：`AgentTool.java:40`

所有工具实现的顶层接口，定义工具的基本契约：

| 方法 | 返回类型 | 行号 | 说明 |
|------|----------|------|------|
| `getName()` | `String` | :50 | 工具名称（snake_case） |
| `getDescription()` | `String` | :60 | 工具描述 |
| `getParameters()` | `Map<String, Object>` | :75 | JSON Schema 参数定义 |
| `getStrict()` | `Boolean` | :86 | 严格模式（默认 null） |
| `getOutputSchema()` | `Map<String, Object>` | :99 | 输出 Schema（默认 null，MCP 工具可覆盖） |
| `callAsync(ToolCallParam)` | `Mono<ToolResultBlock>` | :117 | 异步执行工具调用 |

`ToolCallParam` 包含：toolUseBlock（工具调用 ID 和名称）、input（输入参数）、agent（调用方 Agent，可为 null）。

---

## 4. Toolkit 门面

**源文件**：`Toolkit.java:66`（984 行）

工具系统的核心门面类，委托给 6 个内部组件：

| 组件 | 字段 | 行号 | 职责 |
|------|------|------|------|
| `ToolRegistry` | toolRegistry | :71 | 工具注册和查找 |
| `ToolGroupManager` | groupManager | :70 | 工具分组 CRUD 和活跃状态管理 |
| `ToolSchemaProvider` | schemaProvider | :72 | 带 group 过滤的 Schema 生成 |
| `McpClientManager` | mcpClientManager | :74 | MCP 客户端生命周期管理 |
| `MetaToolFactory` | metaToolFactory | :73 | 元工具（reset_equipped_tools）创建 |
| `ToolExecutor` | executor | :78 | 工具执行（并行/顺序、超时、重试） |

### 4.1 注册方式

| 方法 | 行号 | 说明 |
|------|------|------|
| `registerTool(Object)` | :154 | 扫描 @Tool 方法 |
| `registerAgentTool(AgentTool)` | :203 | 直接注册 AgentTool 实例 |
| `registerSchema(ToolSchema)` | :294 | 注册 SchemaOnlyTool（外部工具） |
| `registration()` | :146 | 流式 Builder API（推荐） |

### 4.2 ToolRegistration Builder

**源文件**：`Toolkit.java:746`

流式注册 API，支持所有注册场景：

| 方法 | 行号 | 说明 |
|------|------|------|
| `tool(Object)` | :769 | 注册 @Tool 方法对象 |
| `agentTool(AgentTool)` | :780 | 注册 AgentTool 实例 |
| `mcpClient(McpClientWrapper)` | :791 | 注册 MCP 客户端 |
| `subAgent(SubAgentProvider)` | :816 | 注册子 Agent 工具 |
| `group(String)` | :898 | 设置分组名 |
| `presetParameters(Map)` | :919 | 设置预设参数（不暴露给 LLM） |
| `enableTools(List)` | :874 | MCP 工具白名单 |
| `disableTools(List)` | :887 | MCP 工具黑名单 |
| `apply()` | :942 | 执行注册 |

```java
// 注册 @Tool 对象到分组
toolkit.registration()
        .tool(new MyTools())
        .group("analytics")
        .presetParameters(Map.of("myTool", Map.of("apiKey", "secret")))
        .apply();

// 注册 MCP 客户端
toolkit.registration()
        .mcpClient(mcpClient)
        .enableTools(List.of("read_file", "write_file"))
        .group("filesystem")
        .apply();

// 注册子 Agent
toolkit.registration()
        .subAgent(() -> ReActAgent.builder().name("ResearchAgent").model(model).build())
        .apply();
```

### 4.3 工具执行

| 方法 | 行号 | 说明 |
|------|------|------|
| `callTool(ToolCallParam)` | :489 | 单工具调用 |
| `callTools(List, ExecutionConfig, Agent, ToolExecutionContext)` | :510 | 批量调用（自动并行/顺序） |
| `setChunkCallback(BiConsumer)` | :445 | 设置流式响应回调 |
| `getToolSchemas()` | :332 | 获取活跃工具的 Schema 列表 |

### 4.4 工具组管理

| 方法 | 行号 | 说明 |
|------|------|------|
| `createToolGroup(String, String)` | :572 | 创建分组（默认活跃） |
| `createToolGroup(String, String, boolean)` | :561 | 创建分组（指定初始状态） |
| `updateToolGroups(List, boolean)` | :586 | 激活/停用分组 |
| `removeToolGroups(List)` | :632 | 删除分组及其工具 |
| `getActiveGroups()` | :652 | 获取活跃分组列表 |
| `registerMetaTool()` | :685 | 注册元工具（Agent 自主管理分组） |

### 4.5 深拷贝

`copy()` 方法（:725）创建 Toolkit 的深拷贝，保留用户回调。ReActAgent 内部使用此方法确保隔离。

---

## 5. ToolRegistry 工具注册表

**源文件**：`ToolRegistry.java:40`（包级私有）

线程安全的工具注册表，使用 `ConcurrentHashMap` 存储：

| 方法 | 行号 | 说明 |
|------|------|------|
| `registerTool(String, AgentTool, RegisteredToolFunction)` | :52 | 注册工具和元数据 |
| `getTool(String)` | :66 | 按名称查找工具 |
| `getRegisteredTool(String)` | :79 | 按名称查找注册信息 |
| `removeTool(String)` | :109 | 删除工具 |
| `removeToolIfSame(String, AgentTool)` | :125 | 原子性条件删除（避免 TOCTOU 竞争） |
| `copyTo(ToolRegistry)` | :147 | 复制所有工具到目标注册表 |

---

## 6. ToolGroupManager 分组管理器

**源文件**：`ToolGroupManager.java:31`（包级私有）

管理工具分组和激活状态。核心规则：

- **未分组工具**始终可用
- **分组工具**仅在所属分组活跃时可调用
- 工具可属于多个分组（任一活跃即可）

| 方法 | 行号 | 说明 |
|------|------|------|
| `createToolGroup(String, String, boolean)` | :47 | 创建分组 |
| `updateToolGroups(List, boolean)` | :83 | 更新分组激活状态 |
| `removeToolGroups(List)` | :112 | 删除分组，返回受影响的工具名 |
| `isActiveTool(String)` | :231 | 检查工具是否可用（未分组或活跃分组内） |
| `addToolToGroup(String, String)` | :282 | 添加工具到分组 |
| `getActiveToolNames()` | :266 | 获取所有活跃工具名 |

---

## 7. ToolSchemaProvider Schema 提供者

**源文件**：`ToolSchemaProvider.java:44`（包级私有）

生成工具 Schema 并根据分组状态过滤。过滤逻辑（:77）：

- 未分组工具 -- 始终包含
- 分组工具 -- 仅在活跃分组时包含

---

## 8. ToolSchemaGenerator Schema 生成器

**源文件**：`ToolSchemaGenerator.java:34`（包级私有）

将 Java 方法签名转换为 JSON Schema：

1. 遍历方法参数，只处理带 `@ToolParam` 注解的参数（:61）
2. 使用 `JsonSchemaUtils` 根据参数化类型生成 Schema（:128）
3. 支持排除预设参数（presetParameters 不暴露给 LLM，:69）
4. 自动提升 `$defs` 到根级别（:75）

---

## 9. ToolExecutor 工具执行器

**源文件**：`ToolExecutor.java:57`（包级私有，420 行）

统一的工具执行基础设施：

### 9.1 执行流程

1. 工具查找和验证（:185）
2. 分组激活检查（:193）
3. Schema 验证（:202）
4. 上下文合并（:215）
5. 预设参数合并（:224）
6. 工具调用（:244）
7. 异常处理（ToolSuspendException、通用错误）

### 9.2 批量执行

`executeAll()` 方法（:278）支持并行和顺序模式：

- **并行**：`Flux.mergeSequential(monos).collectList()`
- **顺序**：`Flux.concat(monos).collectList()`

### 9.3 基础设施层

每个工具调用依次经过：

1. `applyScheduling()` -- 线程调度（:345）
2. `applyTimeout()` -- 超时控制（:352）
3. `applyRetry()` -- 重试策略（:366）
4. `applyShutdownGuard()` -- 优雅停机保护（:409）

---

## 10. MCP 集成（tool/mcp/）

### 10.1 McpClientWrapper

**源文件**：`mcp/McpClientWrapper.java:40`

MCP 客户端抽象基类，管理连接生命周期：

| 方法 | 行号 | 说明 |
|------|------|------|
| `getName()` | :66 | 客户端唯一标识 |
| `initialize()` | :85 | 初始化连接并缓存工具 |
| `listTools()` | :92 | 列出可用工具 |
| `callTool(String, Map)` | :101 | 调用 MCP 工具 |
| `close()` | :119 | 关闭连接（幂等） |

两个实现：`McpAsyncClientWrapper`（异步，基于 McpAsyncClient）和 `McpSyncClientWrapper`（同步，基于 McpSyncClient）。

### 10.2 McpClientBuilder

**源文件**：`mcp/McpClientBuilder.java:94`（790 行）

MCP 客户端 Builder，支持三种传输协议：

| 传输类型 | 方法 | 说明 |
|----------|------|------|
| **StdIO** | `stdioTransport(String, String...)` | 本地进程通信 |
| **SSE** | `sseTransport(String)` | HTTP Server-Sent Events（有状态） |
| **StreamableHTTP** | `streamableHttpTransport(String)` | HTTP 流式（无状态） |

其他配置：

| 方法 | 说明 |
|------|------|
| `header(String, String)` | 添加 HTTP 头 |
| `queryParam(String, String)` | 添加查询参数 |
| `timeout(Duration)` | 请求超时（默认 120s） |
| `protocolVersions(String...)` | MCP 协议版本 |
| `buildAsync()` | 构建异步客户端 |
| `buildSync()` | 构建同步客户端 |

```java
// StdIO 传输
McpClientWrapper client = McpClientBuilder.create("git-mcp")
        .stdioTransport("python", "-m", "mcp_server_git")
        .buildAsync()
        .block();

// SSE 传输
McpClientWrapper client = McpClientBuilder.create("remote-mcp")
        .sseTransport("https://mcp.example.com/sse")
        .header("Authorization", "Bearer " + token)
        .buildAsync()
        .block();
```

### 10.3 McpTool

**源文件**：`mcp/McpTool.java:57`

将 MCP 工具桥接到 AgentScope AgentTool 接口：

- 自动合并 presetArguments 和 input（input 优先，:219）
- 调用 `clientWrapper.callTool()` 执行（:179）
- 支持 `outputSchema`（MCP 服务器提供的输出 Schema，:158）

### 10.4 McpContentConverter

**源文件**：`mcp/McpContentConverter.java:30`

将 MCP 协议的 `Content` 对象转换为 AgentScope 的 `ToolResultBlock`：

| 方法 | 行号 | 说明 |
|------|------|------|
| `convertText(TextContent)` | :44 | 文本内容转换 |
| `convertImage(ImageContent)` | :64 | 图片内容转换（Base64） |
| `convertResource(ResourceContent)` | :88 | 资源内容转换 |
| `convertContents(List<Content>)` | :108 | 批量转换，合并为单个 ToolResultBlock |

---

## 11. 子 Agent 工具（tool/subagent/）

### 11.1 SubAgentTool

**源文件**：`subagent/SubAgentTool.java:57`（549 行）

将子 Agent 封装为工具，支持 LLM 自主调度子 Agent 执行任务：

- 构造函数（:88）创建 Builder 模式的 SubAgentTool
- `callAsync()`（:179）将输入参数序列化为子 Agent 的消息
- 自动将子 Agent 的最终响应封装为 `ToolResultBlock`
- 支持 `ToolEmitter` 参数实现流式进度回调（:215）

### 11.2 SubAgentConfig

**源文件**：`subagent/SubAgentConfig.java:31`

子 Agent 工具的配置：

| 字段 | 类型 | 行号 | 说明 |
|------|------|------|------|
| `name` | `String` | :40 | 子 Agent 名称（同时作为工具名） |
| `description` | `String` | :50 | 子 Agent 工具描述 |
| `subAgentProvider` | `SubAgentProvider` | :60 | 子 Agent 提供者（延迟创建） |

### 11.3 SubAgentProvider

**源文件**：`subagent/SubAgentProvider.java:28`

函数式接口，每次调用时创建新的子 Agent 实例，确保状态隔离：

```java
@FunctionalInterface
public interface SubAgentProvider {
    Agent provide();
}

// 使用示例
SubAgentProvider provider = () -> ReActAgent.builder()
        .name("research_agent")
        .model(model)
        .toolkit(Toolkit.create().registration().tool(new SearchTools()).apply().getToolkit())
        .build();
```

---

## 12. 文件操作工具（tool/file/）

### 12.1 ReadFileTool

**源文件**：`file/ReadFileTool.java:46`

读取文件内容，支持以下参数：

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `path` | `String` | 是 | 文件路径 |
| `offset` | `int` | 否 | 起始行号（0-based，默认 0） |
| `limit` | `int` | 否 | 最大读取行数（默认 2000） |

自动截断超长行（:118），返回带行号的内容。

### 12.2 WriteFileTool

**源文件**：`file/WriteFileTool.java:44`

写入文件内容，自动创建不存在的父目录：

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `path` | `String` | 是 | 文件路径 |
| `content` | `String` | 是 | 写入内容（覆盖写入） |

### 12.3 FileToolUtils

**源文件**：`file/FileToolUtils.java:30`

文件工具的共享工具类：

- `resolveAndValidate()`（:41）-- 路径解析和安全校验
- `isTextFile()`（:89）-- 判断文件是否为文本文件

---

## 13. Shell 命令工具（tool/coding/）

### 13.1 ShellCommandTool

**源文件**：`coding/ShellCommandTool.java:68`（799 行）

执行 Shell 命令，内置安全校验和资源限制：

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `command` | `String` | 是 | 要执行的命令 |
| `workingDirectory` | `String` | 否 | 工作目录 |
| `timeout` | `int` | 否 | 超时秒数（默认 120） |

核心安全机制：

- 命令校验（:289）-- 通过 `CommandValidator` 拦截危险命令
- 超时控制（:312）-- 防止命令挂起
- 工作目录限制（:258）-- 防止越权访问
- 输出截断（:345）-- 防止内存溢出

```java
ShellCommandTool shellTool = ShellCommandTool.builder()
        .commandValidator(new UnixCommandValidator())
        .defaultTimeout(60)
        .maxOutputLength(50000)
        .build();
```

### 13.2 CommandValidator 接口

**源文件**：`coding/CommandValidator.java:28`

命令校验接口：

| 方法 | 说明 |
|------|------|
| `validate(String)` | 校验命令，返回空或抛异常 |

### 13.3 UnixCommandValidator

**源文件**：`coding/UnixCommandValidator.java:35`

Unix/Linux 命令校验器，拦截以下危险命令：

- `rm -rf /`、`mkfs`、`dd` 等破坏性命令
- `chmod 777`、`chown` 等权限修改
- `sudo`、`su` 等提权命令
- `curl`/`wget` 到敏感路径

### 13.4 WindowsCommandValidator

**源文件**：`coding/WindowsCommandValidator.java:35`

Windows 命令校验器，拦截 `format`、`del /s /q`、`rd /s /q` 等危险命令。

---

## 14. ToolResultConverter 结果转换器

**源文件**：`ToolResultConverter.java:28`

工具执行结果到 `ToolResultBlock` 的转换策略接口：

| 实现类 | 行号 | 说明 |
|--------|------|------|
| `DefaultToolResultConverter` | :36 | 默认实现，toString() 后封装 |
| `JsonToolResultConverter` | :55 | JSON 序列化后封装 |

可在 `@Tool` 注解的 `converter` 属性中指定自定义转换器。

---

## 15. SchemaOnlyTool

**源文件**：`SchemaOnlyTool.java:38`

仅有 Schema 定义的工具（无实际执行逻辑），适用于：

- 外部 API 端点（由中间件拦截执行）
- 占位工具（仅用于 Schema 生成）
- 测试和模拟场景

```java
ToolSchema schema = ToolSchema.builder()
        .name("external_api")
        .description("调用外部API")
        .parameters(Map.of("type", "object",
                "properties", Map.of(
                        "endpoint", Map.of("type", "string", "description", "API端点"))))
        .build();
toolkit.registration().registerSchema(schema).apply();
```

---

## 16. ToolSchema 数据结构

**源文件**：`ToolSchema.java:31`

工具 Schema 的不可变数据类：

| 字段 | 类型 | 行号 | 说明 |
|------|------|------|------|
| `name` | `String` | :40 | 工具名称 |
| `description` | `String` | :50 | 工具描述 |
| `parameters` | `Map<String, Object>` | :60 | JSON Schema 参数定义 |
| `strict` | `Boolean` | :70 | 严格模式标记 |
| `outputSchema` | `Map<String, Object>` | :80 | 输出 Schema（可选） |

通过 `ToolSchema.builder()` 创建，各字段均有校验逻辑。

---

## 17. ExecutionConfig 执行配置

**源文件**：`ExecutionConfig.java:34`

批量工具调用的执行配置：

| 字段 | 类型 | 行号 | 说明 |
|------|------|------|------|
| `parallel` | `boolean` | :43 | 是否并行执行（默认 true） |
| `maxConcurrency` | `int` | :53 | 最大并发数（默认 10） |
| `timeoutPerTool` | `Duration` | :63 | 单工具超时 |
| `retryCount` | `int` | :73 | 重试次数 |
| `retryDelay` | `Duration` | :83 | 重试间隔 |

```java
ExecutionConfig config = ExecutionConfig.builder()
        .parallel(true)
        .maxConcurrency(5)
        .timeoutPerTool(Duration.ofSeconds(30))
        .retryCount(2)
        .retryDelay(Duration.ofMillis(500))
        .build();
List<ToolResultBlock> results = toolkit.callTools(toolCalls, config, agent, context).block();
```

---

## 18. 完整使用示例

### 18.1 基础工具注册与调用

```java
// 1. 创建 Toolkit
Toolkit toolkit = Toolkit.create();

// 2. 注册 @Tool 方法对象
toolkit.registration()
        .tool(new WeatherTools())
        .group("weather")       // 可选：分配到分组
        .apply();

// 3. 获取 Schema（传递给 LLM）
List<ToolSchema> schemas = toolkit.getToolSchemas();

// 4. 执行工具调用
ToolCallParam param = new ToolCallParam(toolUseBlock, inputMap, agent);
ToolResultBlock result = toolkit.callTool(param).block();
```

### 18.2 多分组动态切换

```java
toolkit.createToolGroup("basic", "基础工具");
toolkit.createToolGroup("advanced", "高级工具");

// 注册工具到不同分组
toolkit.registration().tool(new BasicTools()).group("basic").apply();
toolkit.registration().tool(new AdvancedTools()).group("advanced").apply();

// 默认仅激活 basic 分组
toolkit.updateToolGroups(List.of("advanced"), false);  // 停用 advanced

// Agent 运行时动态激活
toolkit.updateToolGroups(List.of("advanced"), true);   // 激活 advanced
```

### 18.3 MCP 工具集成

```java
// 构建 MCP 客户端
McpClientWrapper mcpClient = McpClientBuilder.create("filesystem")
        .stdioTransport("npx", "-y", "@modelcontextprotocol/server-filesystem", "/tmp")
        .buildAsync()
        .block();

// 注册到 Toolkit（带工具过滤）
toolkit.registration()
        .mcpClient(mcpClient)
        .enableTools(List.of("read_file", "write_file"))  // 白名单
        .group("fs")
        .apply();
```

### 18.4 子 Agent 工具

```java
// 创建子 Agent 提供者
SubAgentProvider researcher = () -> ReActAgent.builder()
        .name("researcher")
        .model(model)
        .toolkit(Toolkit.create().registration().tool(new SearchTools()).apply().getToolkit())
        .maxIterations(5)
        .build();

// 注册为工具
toolkit.registration().subAgent(researcher).apply();
```

---

## 19. 架构关系图

```
┌─────────────────────────────────────────────────────────┐
│                       Toolkit (门面)                      │
│  ┌──────────────┐  ┌──────────────┐  ┌───────────────┐  │
│  │ ToolRegistry  │  │ GroupManager │  │ SchemaProvider │  │
│  └──────────────┘  └──────────────┘  └───────────────┘  │
│  ┌──────────────┐  ┌──────────────┐  ┌───────────────┐  │
│  │ McpClientMgr │  │ MetaToolFact │  │  ToolExecutor  │  │
│  └──────────────┘  └──────────────┘  └───────────────┘  │
└─────────────────────────────────────────────────────────┘
                          │
           ┌──────────────┼──────────────┐
           │              │              │
    ┌──────▼──────┐ ┌─────▼─────┐ ┌─────▼──────┐
    │  @Tool 方法  │ │  McpTool   │ │ SubAgentTool│
    │  (反射调用)  │ │ (MCP协议)  │ │ (子Agent)   │
    └─────────────┘ └───────────┘ └────────────┘
           │              │              │
    ┌──────▼──────┐ ┌─────▼─────┐ ┌─────▼──────┐
    │ Java 方法   │ │ MCP Server│ │ 子Agent执行 │
    └─────────────┘ └───────────┘ └────────────┘
```
