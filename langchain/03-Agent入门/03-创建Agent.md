# 03-创建Agent

> create_agent：LangChain 的生产级 Agent 工厂函数

## 为什么需要 create_agent

手动构建 Agent 的复杂性：

```
手动构建 Agent：
┌────────────────────────────────────────────┐
│  1. 创建状态图                              │
│  2. 定义消息状态                            │
│  3. 添加 LLM 节点                          │
│  4. 添加工具节点                            │
│  5. 定义条件边（是否继续）                  │
│  6. 绑定工具到模型                          │
│  7. 处理错误                                │
│  8. 编译图                                  │
│                                             │
│  → 约 50+ 行代码                           │
└────────────────────────────────────────────┘

使用 create_agent：
┌────────────────────────────────────────────┐
│  agent = create_agent(model, tools)        │
│                                             │
│  → 1 行代码                                │
└────────────────────────────────────────────┘
```

## 安装

```bash
uv add "langchain[openai]" "langgraph"
```

## create_agent 基础用法

### 最简单的 Agent

```python
from langchain.agents import create_agent
from langchain.tools import tool

@tool
def get_weather(city: str) -> str:
    """获取城市天气"""
    return f"{city} 天气晴朗"

agent = create_agent(
    model="moonshot:moonshot-v1-8k",
    tools=[get_weather],
)

result = agent.invoke({
    "messages": [{"role": "user", "content": "北京天气怎么样？"}]
})

print(result["messages"][-1].content)
```

---

### 多个工具

```python
@tool
def search(query: str) -> str:
    """搜索互联网信息"""
    return f"搜索结果: {query}"

@tool
def calculate(expression: str) -> str:
    """计算数学表达式"""
    return str(eval(expression))

@tool
def get_time() -> str:
    """获取当前时间"""
    from datetime import datetime
    return datetime.now().strftime("%H:%M:%S")

agent = create_agent(
    model="moonshot:moonshot-v1-8k",
    tools=[get_weather, search, calculate, get_time],
)
```

---

### 调用 Agent

```python
# invoke: 单次调用，等待完成
result = agent.invoke({
    "messages": [{"role": "user", "content": "北京天气？"}]
})

# 获取最终回答
print(result["messages"][-1].content)
```

---

## 核心参数

| 参数 | 类型 | 必需 | 说明 |
|------|------|------|------|
| `model` | `str` 或 `BaseChatModel` | 是 | 语言模型（静态或动态） |
| `tools` | `list[BaseTool]` | 否 | 工具列表（静态或动态） |
| `system_prompt` | `str` 或 `SystemMessage` | 否 | 系统提示词 |
| `name` | `str` | 否 | Agent 名称（多 Agent 场景） |
| `response_format` | `BaseModel` 或 `Strategy` | 否 | 结构化输出 |
| `context_schema` | `Type` | 否 | 运行时上下文 Schema |
| `store` | `BaseStore` | 否 | 长期存储 |
| `middleware` | `list` | 否 | 中间件列表 |

---

## Model：模型配置

### 字符串标识符

最简单的模型配置：

```python
agent = create_agent(
    model="moonshot:moonshot-v1-8k",
    tools=[get_weather],
)
```

**支持的格式：**

| 格式 | 示例 | 说明 |
|------|------|------|
| `provider:model` | `"moonshot:moonshot-v1-8k"` | 完整格式 |
| `model` | `"moonshot-v1-8k"` | 自动推断提供商 |

**自动推断规则：**

```python
# 这些会自动推断为 moonshot 提供商
"moonshot-v1-8k"     → "moonshot:moonshot-v1-8k"
"moonshot-v1-32k"    → "moonshot:moonshot-v1-32k"
"moonshot-v1-128k"   → "moonshot:moonshot-v1-128k"

# 这些会自动推断为 deepseek 提供商
"deepseek-chat"      → "deepseek:deepseek-chat"
"deepseek-reasoner"  → "deepseek:deepseek-reasoner"

# 这些会自动推断为 openai 提供商
"gpt-4o"             → "openai:gpt-4o"
"gpt-4o-mini"        → "openai:gpt-4o-mini"
```

---

### 模型实例

需要更多控制时使用：

```python
from langchain_openai import ChatOpenAI

model = ChatOpenAI(
    model="moonshot-v1-8k",
    openai_api_base="https://api.moonshot.cn/v1",
    temperature=0.1,      # 确定性输出
    max_tokens=2000,      # 最大输出长度
    timeout=30,           # 超时秒数
    max_retries=3,        # 重试次数
)

agent = create_agent(
    model=model,
    tools=[get_weather],
)
```

---

### 模型对比

| 方式 | 优点 | 缺点 | 适用场景 |
|------|------|------|----------|
| 字符串 | 简洁，自动配置 | 控制有限 | 快速原型 |
| 实例 | 完全控制参数 | 代码较多 | 生产环境 |

---

## 动态模型

运行时根据状态切换模型：

```python
from langchain.agents.middleware import wrap_model_call
from langchain_openai import ChatOpenAI

# 定义两个模型
basic_model = ChatOpenAI(
    model="moonshot-v1-8k",
    openai_api_base="https://api.moonshot.cn/v1",
)
advanced_model = ChatOpenAI(
    model="moonshot-v1-32k",
    openai_api_base="https://api.moonshot.cn/v1",
)

# 创建中间件
@wrap_model_call
def model_selector(request, handler):
    """根据消息数量选择模型"""
    message_count = len(request.state["messages"])
    
    if message_count > 10:
        model = advanced_model  # 长对话用大模型
    else:
        model = basic_model
    
    return handler(request.override(model=model))

# 创建 Agent
agent = create_agent(
    model=basic_model,  # 默认模型
    tools=[get_weather],
    middleware=[model_selector],
)
```

---

### 动态模型场景

| 场景 | 策略 |
|------|------|
| 简单问题 | 使用小模型（快、便宜） |
| 复杂推理 | 使用大模型（准确） |
| 长对话 | 切换大模型（上下文理解） |
| 代码生成 | 使用代码专用模型 |
| 多语言 | 切换到对应语言优化的模型 |

---

## 静态工具

定义时固定工具列表：

```python
from langchain.tools import tool

@tool
def search(query: str) -> str:
    """搜索信息"""
    return f"搜索: {query}"

@tool
def get_weather(city: str) -> str:
    """获取天气"""
    return f"{city} 晴天"

agent = create_agent(
    model="moonshot:moonshot-v1-8k",
    tools=[search, get_weather],
)
```

---

## 动态工具

运行时根据状态过滤或修改工具：

### 基于状态过滤

```python
from langchain.agents.middleware import wrap_model_call

@wrap_model_call
def dynamic_tools(request, handler):
    """根据认证状态过滤工具"""
    state = request.state
    is_authenticated = state.get("authenticated", False)
    
    if not is_authenticated:
        # 未认证：只暴露公开工具
        tools = [
            t for t in request.tools
            if t.name.startswith("public_")
        ]
        request = request.override(tools=tools)
    
    return handler(request)

agent = create_agent(
    model="moonshot:moonshot-v1-8k",
    tools=[
        public_search,      # public_* 总是可用
        public_weather,     # public_* 总是可用
        private_data,       # 仅认证后可用
        admin_delete,       # 仅认证后可用
    ],
    middleware=[dynamic_tools],
)
```

---

### 基于上下文过滤

```python
from dataclasses import dataclass
from langchain.agents.middleware import wrap_model_call

@dataclass
class UserContext:
    role: str  # "admin", "editor", "viewer"

@wrap_model_call
def role_based_tools(request, handler):
    """根据用户角色过滤工具"""
    ctx = request.runtime.context
    role = ctx.role if ctx else "viewer"
    
    tools = request.tools
    
    if role == "viewer":
        # 只读
        tools = [t for t in tools if t.name.startswith("read_")]
    elif role == "editor":
        # 读写
        tools = [t for t in tools if t.name != "delete_item"]
    # admin: 所有工具
    
    request = request.override(tools=tools)
    return handler(request)

agent = create_agent(
    model="moonshot:moonshot-v1-8k",
    tools=[read_data, write_data, delete_item],
    context_schema=UserContext,
    middleware=[role_based_tools],
)
```

---

### 动态添加工具

```python
@wrap_model_call
def add_contextual_tools(request, handler):
    """根据对话上下文添加工具"""
    messages = request.state["messages"]
    
    # 如果对话涉及代码，添加代码执行工具
    last_message = messages[-1].content if messages else ""
    if "代码" in last_message or "python" in last_message.lower():
        from langchain_core.tools import BaseTool
        # 添加代码执行工具
        request = request.override(
            tools=request.tools + [execute_code]
        )
    
    return handler(request)
```

---

## 模型标识符字符串详解

### 格式

```
"provider:model_name"
```

### 常见提供商

| 提供商 | 标识符前缀 | 示例 |
|--------|-----------|------|
| Moonshot | `moonshot:` | `"moonshot:moonshot-v1-8k"` |
| DeepSeek | `deepseek:` | `"deepseek:deepseek-chat"` |
| OpenAI | `openai:` | `"openai:gpt-4o"` |
| Anthropic | `anthropic:` | `"anthropic:claude-sonnet-4-20250514"` |
| Google | `google_genai:` | `"google_genai:gemini-2.0-flash"` |

---

### 环境变量配置

不同提供商需要不同的环境变量：

```bash
# Moonshot / OpenAI 兼容
export MOONSHOT_API_KEY="your-key"

# DeepSeek
export DEEPSEEK_API_KEY="your-key"

# Anthropic
export ANTHROPIC_API_KEY="your-key"

# Google
export GOOGLE_API_KEY="your-key"
```

---

## 常见错误

### 错误1：模型标识符格式错误

```python
# ❌ 错误：缺少提供商
agent = create_agent(model="moonshot-v1-8k", tools=tools)
# 可能工作（自动推断），但不推荐

# ✅ 正确：完整格式
agent = create_agent(model="moonshot:moonshot-v1-8k", tools=tools)
```

---

### 错误2：工具未正确定义

```python
# ❌ 错误：普通函数不是工具
def get_weather(city: str) -> str:
    return f"{city} 天气"

agent = create_agent(model, tools=[get_weather])
# TypeError: get_weather 不是有效的工具

# ✅ 正确：使用 @tool 装饰器
@tool
def get_weather(city: str) -> str:
    """获取天气"""
    return f"{city} 天气"

agent = create_agent(model, tools=[get_weather])
```

---

### 错误3：空工具列表

```python
# ⚠️ 警告：没有工具的 Agent 退化为普通对话
agent = create_agent(model="moonshot:moonshot-v1-8k", tools=[])

# 这完全可以，但不会触发工具调用
result = agent.invoke({"messages": [{"role": "user", "content": "你好"}]})
```

---

## 练习题

### 练习1：创建多工具 Agent

创建一个 Agent，包含天气、搜索、计算三个工具：

```python
from langchain.agents import create_agent

# 定义工具
@tool
def get_weather(city: str) -> str:
    """获取天气"""
    ...

@tool
def search(query: str) -> str:
    """搜索"""
    ...

@tool
def calculate(expression: str) -> str:
    """计算"""
    ...

# 创建 Agent
agent = create_agent(
    # 你的代码
)
```

---

### 练习2：创建动态模型 Agent

根据问题复杂度切换模型：

```python
# 提示：根据消息长度或关键词判断复杂度
@wrap_model_call
def smart_model(request, handler):
    last_msg = request.state["messages"][-1].content
    # 你的代码
```

---

## 小结

| 要点 | 说明 |
|------|------|
| create_agent | 一行代码创建生产级 Agent |
| 模型配置 | 字符串标识符或模型实例 |
| 标识符格式 | `"provider:model_name"` |
| 静态工具 | 定义时固定 |
| 动态工具 | 运行时通过中间件过滤/添加 |
| 动态模型 | 运行时通过中间件切换 |
| 中间件 | `wrap_model_call` 实现动态逻辑 |
