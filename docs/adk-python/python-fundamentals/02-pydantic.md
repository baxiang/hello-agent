# Pydantic v2 — ADK-Python 的类型基石

> ADK-Python 全面基于 Pydantic v2 构建：Agent 配置、Workflow 节点、Event 事件、State 状态、Tool 参数——几乎每一个类都是 `BaseModel` 的子类。

## 1. BaseModel 基础

ADK 中到处是这种模式：

```python
from pydantic import BaseModel, Field

class AgentConfig(BaseModel):
    """对应 ADK 中 agents/llm_agent_config.py"""
    name: str = Field(description="Agent 唯一标识")
    model: str = Field(default="gemini-2.5-flash")
    instruction: str = ""
    tools: list = Field(default_factory=list)
    temperature: float = Field(default=0.7, ge=0, le=2)
```

`BaseModel` 提供：
- **自动类型校验**：传入错误类型直接报错
- **默认值**：不在 `__init__` 里写一堆参数默认值
- **JSON 序列化/反序列化**：`.model_dump()` / `.model_validate()`
- **嵌套模型**：子类型自动校验

## 2. Field 常用参数

```python
from pydantic import BaseModel, Field
from typing import Optional

class ToolConfig(BaseModel):
    # description: 文档字符串 + IDE 提示
    name: str = Field(description="工具名称，LLM 通过此名称调用")

    # default: 默认值
    is_long_running: bool = Field(default=False)

    # default_factory: 可变类型的默认值（list/dict/set）
    tools: list[str] = Field(default_factory=list)

    # ge/le/gt/lt: 数值范围校验
    max_retries: int = Field(default=3, ge=0, le=10)

    # min_length/max_length: 字符串长度校验
    api_key: str = Field(min_length=10)

    # pattern: 正则校验
    version: str = Field(pattern=r"^\d+\.\d+\.\d+$")

    # alias: JSON 字段名映射
    openai_key: str = Field(alias="openai_api_key")
```

## 3. 嵌套模型

ADK 的 Config 结构大量使用嵌套模型：

```python
class LLMConfig(BaseModel):
    temperature: float = Field(default=0.7)
    max_tokens: int = Field(default=4096)

class AgentConfig(BaseModel):
    name: str
    model: str
    llm_config: LLMConfig | None = None  # 可选嵌套

# 创建时可以传字典，自动转换
agent = AgentConfig(
    name="assistant",
    model="gemini-2.5-flash",
    llm_config={"temperature": 0.8, "max_tokens": 2048},
)
# agent.llm_config 自动转为 LLMConfig 实例
```

## 4. model_config 全局配置

```python
class Workflow(BaseNode):
    model_config = ConfigDict(
        arbitrary_types_allowed=True,  # 允许非标准类型（如 fn、class）
        extra="forbid",                # 禁止额外字段
        use_enum_values=True,          # 枚举类型用值而非名称
    )

    edges: list[tuple] = Field(default_factory=list)
```

ADK 中最常用 `arbitrary_types_allowed=True`——因为 Agent 的工具列表中包含 Python 函数对象，需要绕过 Pydantic 的严格类型检查。

## 5. 序列化与反序列化

```python
# 序列化：model → dict/JSON
config = AgentConfig(name="test", model="gpt-4")
d = config.model_dump()           # {"name": "test", "model": "gpt-4", ...}
json_str = config.model_dump_json()  # JSON 字符串

# 反序列化：dict/JSON → model
config = AgentConfig.model_validate(d)
config = AgentConfig.model_validate_json(json_str)

# 排除默认值
d = config.model_dump(exclude_defaults=True)  # 只序列化非默认值
```

## 6. 在 ADK 源码中的实际应用

### Event 定义（`events/event.py`）

```python
class Event(BaseModel):
    author: str
    invocation_id: str
    content: Content | None = None
    partial: bool = False
    actions: EventActions = Field(default_factory=EventActions)
```

### Workflow 节点定义（`workflow/_base_node.py`）

```python
class BaseNode(BaseModel):
    """所有节点的基类——Agent、FunctionNode、Workflow 都继承它"""
    model_config = ConfigDict(arbitrary_types_allowed=True)

    name: str = Field(...)
    description: str = ""
    sub_nodes: list[BaseNode] = Field(default_factory=list)
```

### Agent 配置（`agents/llm_agent_config.py`）

```python
class LlmAgentConfig(BaseModel):
    name: str
    model: str | None = None
    instruction: str = ""
    tools: list = Field(default_factory=list)
    sub_agents: list = Field(default_factory=list)
    generate_content_config: GenerateContentConfig | None = None
```

## 7. 类型校验实战

```python
from pydantic import ValidationError

class WeatherTool(BaseModel):
    city: str = Field(min_length=1)
    days: int = Field(ge=1, le=14)

try:
    WeatherTool(city="", days=30)
except ValidationError as e:
    print(e.errors())
    # [
    #   {'type': 'string_too_short', 'loc': ('city',), ...},
    #   {'type': 'less_than_equal', 'loc': ('days',), ...}
    # ]
```

## 8. 与 dataclass 的对比

| 特性 | Pydantic BaseModel | dataclass |
|------|-------------------|-----------|
| 类型校验 | ✅ 自动 | ❌ 无 |
| 序列化 | ✅ `model_dump()` | 需要手动 |
| 嵌套转换 | ✅ 自动 | ❌ |
| JSON Schema | ✅ `model_json_schema()` | ❌ |
| 性能 | 较慢（有校验开销） | 快 |
| ADK 使用 | Agent/Event/Config 等 | 内部轻量数据结构 |

ADK 的选择：公开 API 用 Pydantic，内部性能敏感的临时数据结构用 `dataclass`。

## 9. 速查表

| 语法 | 说明 |
|------|------|
| `BaseModel` | Pydantic 模型基类 |
| `Field(default=..., description=...)` | 字段配置 |
| `Field(default_factory=list)` | 可变类型默认值 |
| `Field(ge=0, le=10)` | 数值范围约束 |
| `Field(alias="...")` | JSON 字段名映射 |
| `ConfigDict(arbitrary_types_allowed=True)` | 允许非标准类型 |
| `model_dump()` | 序列化为 dict |
| `model_validate(dict)` | 从 dict 反序列化 |
| `model_json_schema()` | 生成 JSON Schema |
