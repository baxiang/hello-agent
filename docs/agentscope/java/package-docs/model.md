# io.agentscope.core.model — 模型接入层详解

## 概述

`model` 包是 AgentScope 与大语言模型（LLM）交互的核心层，提供统一的模型调用接口、多供应商适配、生成参数控制、执行策略（超时/重试）以及 TTS 语音合成支持。所有模型实现均基于 Project Reactor 的 `Flux`/`Mono` 响应式编程模型，天然支持流式输出。

---

## 1. Model 接口

`Model` 是所有模型实现的顶层接口（`Model.java:22`），定义了唯一的流式调用方法：

```java
// Model.java:33
Flux<ChatResponse> stream(List<Msg> messages, List<ToolSchema> tools, GenerateOptions options);
```

以及用于日志和标识的 `getModelName()` 方法（`Model.java:40`）。

参数说明：
- `messages`：AgentScope 统一消息列表，由 `Msg` 对象组成
- `tools`：可选的工具 Schema 列表，为 `null` 或空表示不使用工具
- `options`：可选的生成选项，为 `null` 则使用模型默认配置

---

## 2. ChatModelBase 抽象基类

`ChatModelBase`（`ChatModelBase.java:29`）实现了 `Model` 接口，提供两个关键设计：

### 2.1 Tracing 包装

`stream()` 方法被标记为 `final`（`ChatModelBase.java:43`），内部通过 `TracerRegistry` 包装调用，自动采集遥测数据：

```java
// ChatModelBase.java:43-48
public final Flux<ChatResponse> stream(...) {
    return TracerRegistry.get()
            .callModel(this, messages, tools, options, () -> doStream(messages, tools, options));
}
```

### 2.2 模板方法模式

子类实现 `doStream()` 抽象方法（`ChatModelBase.java:59`）完成具体的 API 调用逻辑，`stream()` 负责统一的 Tracing 切面：

```java
// ChatModelBase.java:59-60
protected abstract Flux<ChatResponse> doStream(
        List<Msg> messages, List<ToolSchema> tools, GenerateOptions options);
```

---

## 3. 五种模型实现

### 3.1 OpenAIChatModel

**源文件**：`OpenAIChatModel.java:58`

使用原生 HTTP API 与 OpenAI 兼容的 API 通信。核心特性：

- **Formatter 架构**：通过 `Formatter<OpenAIMessage, OpenAIResponse, OpenAIRequest>` 处理消息格式转换（`OpenAIChatModel.java:63`），支持多种 OpenAI 兼容提供商：
  - `OpenAIChatFormatter` — 标准 GPT 模型
  - `DeepSeekFormatter` — DeepSeek 模型
  - `GLMFormatter` — 智谱 GLM 模型
- **流式/非流式双模式**：根据 `stream` 参数切换（`OpenAIChatModel.java:153-178`）
- **Cache Control 支持**：启用后自动在系统消息和最后一条消息添加 `cache_control` 标记（`OpenAIChatModel.java:147-150`）
- **自定义端点路径**：通过 `endpointPath` 支持 OpenAI 兼容 API 的不同端点（如 `/v4/chat/completions`）

Builder 关键配置项（`OpenAIChatModel.java:206-356`）：

| 方法 | 说明 |
|------|------|
| `apiKey(String)` | API 密钥 |
| `modelName(String)` | 模型名称（必填） |
| `baseUrl(String)` | 自定义 API 基础 URL |
| `endpointPath(String)` | 自定义端点路径 |
| `stream(boolean)` | 是否启用流式（默认 true） |
| `formatter(Formatter)` | 自定义消息格式化器 |
| `httpTransport(HttpTransport)` | 自定义 HTTP 传输层 |
| `generateOptions(GenerateOptions)` | 默认生成选项 |

```java
// 配置 OpenAI 模型
OpenAIChatModel model = OpenAIChatModel.builder()
        .apiKey("sk-xxx")
        .modelName("gpt-4o")
        .baseUrl("https://api.openai.com")
        .stream(true)
        .build();
```

### 3.2 AnthropicChatModel

**源文件**：`AnthropicChatModel.java:53`

使用 Anthropic 官方 Java SDK，核心特性：

- **官方 SDK 集成**：通过 `AnthropicOkHttpClient` 构建（`AnthropicChatModel.java:94-104`）
- **系统消息特殊处理**：Anthropic 要求系统消息通过 `system` 参数传递，而非消息列表（`AnthropicChatModel.java:146`），由 Formatter 自动处理
- **扩展思维（Extended Thinking）**：支持 Claude 的深度推理模式
- **异步/同步双模式**：非流式模式使用 `CompletableFuture`（`AnthropicChatModel.java:191`）

默认模型名：`claude-sonnet-4-5-20250929`（`AnthropicChatModel.java:236`）

```java
// 配置 Anthropic 模型
AnthropicChatModel model = AnthropicChatModel.builder()
        .apiKey("sk-ant-xxx")
        .modelName("claude-sonnet-4-5-20250929")
        .stream(true)
        .build();
```

### 3.3 DashScopeChatModel

**源文件**：`DashScopeChatModel.java:52`

通过原生 HTTP API 与阿里云 DashScope 通信，不依赖 DashScope Java SDK。核心特性：

- **多端点路由**：通过 `EndpointType` 枚举（`EndpointType.java:33`）控制端点选择：
  - `AUTO`（默认）— 根据模型名自动检测
  - `TEXT` — 强制使用文本生成 API
  - `MULTIMODAL` — 强制使用多模态 API
- **思维模式**：`enableThinking` 开启后自动启用流式并显示推理过程（`DashScopeChatModel.java:142-148`）
- **搜索增强**：`enableSearch` 允许模型访问互联网搜索（`DashScopeChatModel.java:59`）
- **加密支持**：`enableEncrypt` 通过 RSA+AES-GCM 加密请求/响应（`DashScopeChatModel.java:539`）
- **多种 Formatter**：支持 `DashScopeChatFormatter` 和 `DashScopeMultiAgentFormatter`

Builder 关键配置项（`DashScopeChatModel.java:357-587`）：

| 方法 | 说明 |
|------|------|
| `apiKey(String)` | DashScope API 密钥 |
| `modelName(String)` | 模型名称（如 `qwen-max`） |
| `enableThinking(Boolean)` | 启用思维模式 |
| `enableSearch(Boolean)` | 启用搜索增强 |
| `endpointType(EndpointType)` | 端点类型 |
| `enableEncrypt(boolean)` | 启用加密 |

```java
// 配置 DashScope 模型（带思维模式）
DashScopeChatModel model = DashScopeChatModel.builder()
        .apiKey("sk-xxx")
        .modelName("qwen-max")
        .enableThinking(true)
        .enableSearch(true)
        .build();

// 配置 DashScope 模型（带加密）
DashScopeChatModel encryptedModel = DashScopeChatModel.builder()
        .apiKey("sk-xxx")
        .modelName("qwen-max")
        .enableEncrypt(true)
        .build();
```

### 3.4 GeminiChatModel

**源文件**：`GeminiChatModel.java:55`

使用 Google 官方 GenAI Java SDK，核心特性：

- **双 API 支持**：同时支持 Gemini API 和 Vertex AI（通过 `vertexAI` 参数切换）
- **Google 认证**：支持 `GoogleCredentials`（Vertex AI 场景）
- **视觉能力**：支持图片、音频、视频输入
- **思维模式**：支持扩展推理
- **多 Agent 会话**：通过 Formatter 支持历史消息合并

Builder 关键配置项（`GeminiChatModel.java:343-512`）：

| 方法 | 说明 |
|------|------|
| `apiKey(String)` | Gemini API 密钥 |
| `project(String)` | Google Cloud 项目 ID（Vertex AI） |
| `location(String)` | Google Cloud 区域（如 `us-central1`） |
| `vertexAI(boolean)` | 使用 Vertex AI |
| `credentials(GoogleCredentials)` | Google 凭证 |

```java
// 配置 Gemini API 模型
GeminiChatModel model = GeminiChatModel.builder()
        .apiKey("AIzaxxx")
        .modelName("gemini-2.5-flash")
        .streamEnabled(true)
        .build();

// 配置 Vertex AI 模型
GeminiChatModel vertexModel = GeminiChatModel.builder()
        .project("my-project")
        .location("us-central1")
        .vertexAI(true)
        .credentials(googleCredentials)
        .modelName("gemini-2.5-flash")
        .build();
```

### 3.5 OllamaChatModel

**源文件**：`OllamaChatModel.java:53`

与本地 Ollama 实例通过 HTTP API 通信，核心特性：

- **本地部署**：默认连接 `http://localhost:11434`（可通过 `OLLAMA_BASE_URL` 环境变量覆盖）
- **Ollama 专属选项**：支持 `OllamaOptions` 子类，提供 Ollama 特有参数
- **双选项融合**：`OllamaOptions.fromGenerateOptions()` 将通用选项转换为 Ollama 选项（`OllamaChatModel.java:142`）
- **简洁 API**：提供 `chat()` 方法用于同步调用（`OllamaChatModel.java:120-133`）

```java
// 配置 Ollama 模型
OllamaChatModel model = OllamaChatModel.builder()
        .modelName("llama3.1")
        .baseUrl("http://localhost:11434")
        .build();
```

---

## 4. GenerateOptions 生成选项

**源文件**：`GenerateOptions.java:31`（873 行）

不可变的生成选项类，通过 Builder 模式构建。字段按类别组织：

### 4.1 连接配置

| 字段 | 类型 | 行号 | 说明 |
|------|------|------|------|
| `apiKey` | `String` | :33 | API 密钥 |
| `baseUrl` | `String` | :34 | API 基础 URL |
| `endpointPath` | `String` | :35 | 自定义端点路径 |
| `modelName` | `String` | :36 | 模型名称 |
| `stream` | `Boolean` | :37 | 是否启用流式 |

### 4.2 采样参数

| 字段 | 类型 | 行号 | 说明 |
|------|------|------|------|
| `temperature` | `Double` | :40 | 温度（0-2），越高越随机 |
| `topP` | `Double` | :41 | 核采样参数（0-1） |
| `topK` | `Integer` | :50 | Top-K 采样，限制候选 token 数 |
| `seed` | `Long` | :51 | 随机种子，用于确定性生成 |

### 4.3 输出控制

| 字段 | 类型 | 行号 | 说明 |
|------|------|------|------|
| `maxTokens` | `Integer` | :42 | 最大生成 token 数 |
| `maxCompletionTokens` | `Integer` | :43 | 最大完成 token 数 |
| `frequencyPenalty` | `Double` | :44 | 频率惩罚（-2 到 2） |
| `presencePenalty` | `Double` | :45 | 存在惩罚（-2 到 2） |

### 4.4 工具相关

| 字段 | 类型 | 行号 | 说明 |
|------|------|------|------|
| `toolChoice` | `ToolChoice` | :49 | 工具选择策略 |
| `parallelToolCalls` | `Boolean` | :53 | 是否允许并行工具调用 |

### 4.5 高级选项

| 字段 | 类型 | 行号 | 说明 |
|------|------|------|------|
| `thinkingBudget` | `Integer` | :46 | 思维模式 token 预算（DashScope） |
| `reasoningEffort` | `String` | :47 | 推理力度（low/medium/high，OpenAI o1） |
| `executionConfig` | `ExecutionConfig` | :48 | 超时和重试配置 |
| `cacheControl` | `Boolean` | :52 | 提示缓存控制 |

### 4.6 扩展参数

| 字段 | 类型 | 行号 | 说明 |
|------|------|------|------|
| `additionalHeaders` | `Map<String, String>` | :54 | 额外 HTTP 头 |
| `additionalBodyParams` | `Map<String, Object>` | :55 | 额外请求体参数 |
| `additionalQueryParams` | `Map<String, String>` | :56 | 额外查询参数 |

### 4.7 选项合并

`mergeOptions()` 静态方法（`GenerateOptions.java:423`）实现了参数逐字段合并，primary 优先于 fallback。Map 类型字段采用合并策略（fallback 先，primary 覆盖）。

---

## 5. ToolChoice 工具选择

**源文件**：`ToolChoice.java:45`

`sealed interface`，定义模型如何处理工具调用，通过 `permits` 限制为四种 record：

| Record | 行号 | 说明 |
|--------|------|------|
| `Auto` | :52 | 由模型决定是否调用工具（默认行为） |
| `None` | :58 | 禁止调用任何工具 |
| `Required` | :64 | 强制至少调用一个工具（模型选择哪个） |
| `Specific(String toolName)` | :71 | 强制调用指定名称的工具 |

`Specific` record 包含参数校验：toolName 不可为 null 或空（`ToolChoice.java:78-81`）。

```java
// 强制调用特定工具
GenerateOptions opts = GenerateOptions.builder()
        .toolChoice(new ToolChoice.Specific("generate_response"))
        .build();

// 禁止工具调用
GenerateOptions opts = GenerateOptions.builder()
        .toolChoice(new ToolChoice.None())
        .build();
```

---

## 6. ModelRegistry 模型注册表

**源文件**：`ModelRegistry.java:35`

全局模型注册表，支持从字符串标识符解析 `Model` 实例。解析优先级：

1. 命名注册 -> 2. 缓存的工厂实例 -> 3. 用户工厂（最新优先） -> 4. 内置工厂

### 6.1 内置 Provider 正则模式

| 正则模式 | 行号 | 环境变量 | 说明 |
|----------|------|----------|------|
| `openai:(.+)` | :44 | `OPENAI_API_KEY` | OpenAI 模型 |
| `dashscope:(.+)` | :59 | `DASHSCOPE_API_KEY` | DashScope 模型 |
| `qwen-.+` | :69 | `DASHSCOPE_API_KEY` | DashScope 短格式（qwen-*） |
| `anthropic:(.+)` | :76 | `ANTHROPIC_API_KEY` | Anthropic 模型 |
| `gemini:(.+)` | :86 | `GEMINI_API_KEY` | Gemini 模型 |
| `ollama:(.+)` | :96 | `OLLAMA_BASE_URL` | Ollama 模型 |

### 6.2 核心 API

| 方法 | 行号 | 说明 |
|------|------|------|
| `register(String name, Model model)` | :114 | 注册命名模型 |
| `registerFactory(String regex, ModelFactory factory)` | :129 | 注册工厂（正则匹配，优先于内置） |
| `resolve(String modelId)` | :142 | 解析模型（按优先级查找） |
| `canResolve(String modelId)` | :179 | 检查是否可解析（不创建实例） |
| `reset()` | :197 | 清空命名模型、用户工厂和缓存 |

```java
// 命名注册
ModelRegistry.register("my-model", openAIModel);
Model model = ModelRegistry.resolve("my-model");

// Provider 格式
Model model = ModelRegistry.resolve("openai:gpt-4o");
Model model = ModelRegistry.resolve("dashscope:qwen-max");
Model model = ModelRegistry.resolve("qwen-plus");  // 短格式

// 自定义 Provider
ModelRegistry.registerFactory("my-provider:(.+)", modelId -> {
    String modelName = modelId.substring("my-provider:".length());
    return OpenAIChatModel.builder()
            .apiKey("xxx")
            .baseUrl("https://my-api.example.com")
            .modelName(modelName)
            .build();
});
```

---

## 7. ChatResponse / ChatUsage

### 7.1 ChatResponse

**源文件**：`ChatResponse.java:29`

不可变响应类，包含模型返回的完整信息：

| 字段 | 类型 | 行号 | 说明 |
|------|------|------|------|
| `id` | `String` | :31 | 响应唯一标识（未设置时自动生成 UUID，:201） |
| `content` | `List<ContentBlock>` | :32 | 内容块列表（文本、工具调用等） |
| `usage` | `ChatUsage` | :33 | Token 使用统计 |
| `metadata` | `Map<String, Object>` | :34 | 模型提供商附加元数据 |
| `finishReason` | `String` | :35 | 停止原因（如 stop、tool_calls） |

`withId(String)` 方法（`ChatResponse.java:111`）支持创建带新 ID 的副本。

### 7.2 ChatUsage

**源文件**：`ChatUsage.java:24`

Token 使用统计：

| 字段 | 类型 | 行号 | 说明 |
|------|------|------|------|
| `inputTokens` | `int` | :26 | 输入 token 数 |
| `outputTokens` | `int` | :27 | 输出 token 数 |
| `time` | `double` | :28 | 执行时间（秒） |

计算属性 `getTotalTokens()`（`ChatUsage.java:66`）返回 inputTokens + outputTokens。

---

## 8. ToolSchema 工具 Schema

**源文件**：`ToolSchema.java:28`

不可变工具 Schema 定义，用于向模型描述工具接口：

| 字段 | 类型 | 行号 | 说明 |
|------|------|------|------|
| `name` | `String` | :29 | 工具名称（必填） |
| `description` | `String` | :30 | 工具描述（必填） |
| `parameters` | `Map<String, Object>` | :31 | JSON Schema 参数定义 |
| `outputSchema` | `Map<String, Object>` | :32 | 输出 Schema（可选） |
| `strict` | `Boolean` | :33 | 严格模式标志 |

```java
ToolSchema schema = ToolSchema.builder()
        .name("get_weather")
        .description("获取指定城市的天气信息")
        .parameters(Map.of(
                "type", "object",
                "properties", Map.of(
                        "city", Map.of("type", "string", "description", "城市名称")
                ),
                "required", List.of("city")
        ))
        .strict(true)
        .build();
```

---

## 9. ExecutionConfig 执行配置

**源文件**：`ExecutionConfig.java:56`

统一控制超时和重试行为。

### 9.1 字段

| 字段 | 类型 | 行号 | 说明 |
|------|------|------|------|
| `timeout` | `Duration` | :58 | 单次执行超时时长 |
| `maxAttempts` | `Integer` | :61 | 最大尝试次数（含首次） |
| `initialBackoff` | `Duration` | :64 | 首次重试退避时间 |
| `maxBackoff` | `Duration` | :67 | 最大退避时间 |
| `backoffMultiplier` | `Double` | :70 | 退避倍数（指数退避） |
| `retryOn` | `Predicate<Throwable>` | :73 | 重试条件判断 |

### 9.2 预定义配置

| 常量 | 行号 | 说明 |
|------|------|------|
| `MODEL_DEFAULTS` | :151 | 模型调用默认：5min 超时，3 次重试，2s 初始退避，2.0 倍数 |
| `TOOL_DEFAULTS` | :169 | 工具执行默认：5min 超时，1 次尝试（不重试） |

### 9.3 可重试错误

`RETRYABLE_ERRORS` 谓词（`ExecutionConfig.java:93`）定义了可重试的错误类型：

- HTTP 429（限流）和 5xx（服务器错误）-- 可重试
- 超时（TimeoutException）-- 可重试
- 网络 IO 错误（IOException）-- 可重试
- HTTP 400（参数错误）、401/403（认证错误）-- 不可重试

---

## 10. EndpointType 端点类型

**源文件**：`EndpointType.java:33`

DashScope 模型专用枚举，控制 API 端点选择：

| 枚举值 | 行号 | 说明 |
|--------|------|------|
| `AUTO` | :41 | 根据模型名自动检测（默认） |
| `TEXT` | :46 | 强制使用文本生成 API |
| `MULTIMODAL` | :51 | 强制使用多模态 API |

---

## 11. Transport 传输层

`transport` 子包提供 HTTP 传输抽象层：

### 11.1 HttpTransport 接口

**源文件**：`transport/HttpTransport.java:33`

| 方法 | 行号 | 说明 |
|------|------|------|
| `execute(HttpRequest)` | :42 | 同步 HTTP 请求 |
| `stream(HttpRequest)` | :54 | 流式（SSE）HTTP 请求 |
| `close()` | :61 | 关闭传输层，释放资源 |

### 11.2 内置实现

| 类 | 说明 |
|----|------|
| `OkHttpTransport` | 基于 OkHttp 的实现（推荐） |
| `JdkHttpTransport` | 基于 JDK HttpClient 的实现 |
| `WebSocketTransport` | WebSocket 传输（用于实时场景） |

---

## 12. TTS 子包

`tts` 子包提供文本转语音（Text-to-Speech）支持：

### 12.1 TTSModel 接口

**源文件**：`tts/TTSModel.java:39`

```java
// tts/TTSModel.java:48
Mono<TTSResponse> synthesize(String text, TTSOptions options);
```

### 12.2 核心类

| 类 | 说明 |
|----|------|
| `DashScopeTTSModel` | DashScope TTS 实现（如 qwen3-tts-flash） |
| `DashScopeRealtimeTTSModel` | DashScope 实时 TTS（WebSocket） |
| `TTSOptions` | TTS 选项（语音、格式、采样率等） |
| `Qwen3TTSFlashVoice` | Qwen3 TTS Flash 预设音色 |
| `AudioPlayer` | 音频播放器 |
| `SessionConfig` | 会话配置（用于实时 TTS） |

---

## 13. Exception 体系

### 13.1 ModelException

**源文件**：`ModelException.java:22`

统一模型异常，携带 modelName 和 provider 信息：

| 构造器 | 行号 | 说明 |
|--------|------|------|
| `ModelException(String)` | :35 | 通用错误 |
| `ModelException(String, Throwable)` | :49 | 包装异常 |
| `ModelException(String, String, String)` | :65 | 携带模型和供应商信息 |
| `ModelException(String, Throwable, String, String)` | :82 | 完整信息 |

### 13.2 OpenAIException 层级

**源文件**：`exception/OpenAIException.java:24`

基于 HTTP 状态码的异常层级，`create()` 工厂方法（:73）根据状态码自动创建子类：

| HTTP 状态码 | 异常类 | 说明 |
|-------------|--------|------|
| 400 | `BadRequestException` | 参数错误（不可重试） |
| 401 | `AuthenticationException` | 认证失败 |
| 403 | `PermissionDeniedException` | 权限不足 |
| 404 | `NotFoundException` | 资源不存在 |
| 422 | `UnprocessableEntityException` | 无法处理的实体 |
| 429 | `RateLimitException` | 限流（可重试） |
| 5xx | `InternalServerException` | 服务器错误（可重试） |

---

## 14. 代码示例

### 14.1 通过 ModelRegistry 快速使用

```java
// 使用内置 Provider（自动从环境变量读取 API Key）
Model model = ModelRegistry.resolve("openai:gpt-4o");
Model model = ModelRegistry.resolve("dashscope:qwen-max");
Model model = ModelRegistry.resolve("anthropic:claude-sonnet-4-5-20250929");
Model model = ModelRegistry.resolve("gemini:gemini-2.5-flash");
Model model = ModelRegistry.resolve("ollama:llama3.1");
```

### 14.2 带执行配置的模型调用

```java
ExecutionConfig execConfig = ExecutionConfig.builder()
        .timeout(Duration.ofMinutes(2))
        .maxAttempts(3)
        .initialBackoff(Duration.ofSeconds(2))
        .backoffMultiplier(2.0)
        .build();

GenerateOptions options = GenerateOptions.builder()
        .modelName("qwen-max")
        .apiKey("sk-xxx")
        .temperature(0.7)
        .maxTokens(4096)
        .executionConfig(execConfig)
        .cacheControl(true)
        .build();

Flux<ChatResponse> responses = model.stream(messages, toolSchemas, options);
```

### 14.3 自定义 Provider 注册

```java
ModelRegistry.registerFactory("my-llm:(.+)", modelId -> {
    String modelName = modelId.substring("my-llm:".length());
    return OpenAIChatModel.builder()
            .apiKey(System.getenv("MY_LLM_API_KEY"))
            .baseUrl("https://llm.example.com/v1")
            .modelName(modelName)
            .stream(true)
            .build();
});

Model model = ModelRegistry.resolve("my-llm:my-model-v2");
```

---

## 相关文档

- [核心包](../core.md)
- [工具包](tool.md)
