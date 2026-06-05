# Python 类型提示 — ADK-Python 的静态安全网

> ADK-Python 大量使用现代 Python 类型系统：`Annotated`、`TypeAlias`、`Protocol`、泛型、联合类型等。理解这些是读懂 ADK 接口定义的关键。

## 1. 基础类型注解

```python
# 变量注解
name: str = "hello"
count: int = 42
data: dict[str, int] = {"a": 1, "b": 2}

# 函数注解
def greet(name: str) -> str:
    return f"Hello, {name}"

# 可选类型 (3.10+ 用 | None，旧版用 Optional)
def find_user(user_id: int) -> dict | None:
    if user_id > 0:
        return {"id": user_id, "name": "Alice"}
    return None
```

## 2. 联合类型 `|`

ADK 大量使用联合类型表达"可能是 A 或 B"：

```python
# 3.10+ 语法
ModelName = str | None
Response = str | dict | list[str]

# ADK 实际使用：
node: BaseNode | BaseTool | Callable | Literal["START"]
route: bool | int | str
```

## 3. TypeAlias：类型别名

ADK-Python 在 `workflow/_graph.py` 和 `runners.py` 中大量定义 TypeAlias：

```python
from typing import TypeAlias

RouteValue: TypeAlias = bool | int | str
"""路由值：用于 Workflow 条件边"""

NodeLike: TypeAlias = BaseNode | BaseTool | Callable | Literal["START"]
"""可转换为 Workflow 节点的对象"""

RoutingMap: TypeAlias = dict[RouteValue, NodeLike | tuple[NodeLike, ...]]
"""源节点 → 路由值 → 目标节点的映射"""
```

使用 TypeAlias 的优势：
- 复杂类型有名称，代码可读
- IDE 推导时显示别名而非展开的复杂类型
- 修改类型定义时只需改一处

## 4. Annotated：带元数据的类型

ADK 的 Workflow 边定义中使用：

```python
from typing import Annotated
from pydantic import SerializeAsAny

# 基础用法：给类型附加元数据
Edge = tuple[Annotated[BaseNode, SerializeAsAny()], BaseNode]

# 等价于：类型仍是 BaseNode，但 Pydantic 序列化时有额外标记
# SerializeAsAny() 告诉 Pydantic：序列化时保留具体类型而非转为 BaseNode
```

## 5. 泛型（Python 3.12+ 语法）

```python
# 泛型函数
def first[T](items: list[T]) -> T | None:
    return items[0] if items else None

# 泛型类
class Stack[T]:
    def __init__(self) -> None:
        self._items: list[T] = []

    def push(self, item: T) -> None:
        self._items.append(item)

    def pop(self) -> T | None:
        return self._items.pop() if self._items else None
```

ADK 中泛型的实际使用（`tools/function_tool.py` 类似模式）：
```python
async def run_tool[T](tool: BaseTool, args: dict) -> T:
    """泛型工具执行，返回类型由调用方推导"""
    result = await tool.run_async(args)
    return result  # type: T
```

## 6. Callable：函数类型

```python
from typing import Callable

# 函数工具的核心签名
ToolFunction = Callable[..., Any]  # 任意函数
Handler = Callable[[str, int], dict]  # 接收 str, int，返回 dict

# ADK 中使用
def register_tool(fn: Callable[..., Any]) -> BaseTool:
    """将任意函数注册为工具"""
    pass
```

## 7. Literal：精确字符串值

ADK 中用于定义有限选项：

```python
from typing import Literal

# Agent 模式
AgentMode = Literal["chat", "task"]
# Workflow 路由
RouteValue = bool | int | str

# 使用
def create_agent(mode: AgentMode) -> Agent:
    if mode == "chat":
        return ChatAgent()
    elif mode == "task":
        return TaskAgent()
```

## 8. Final / ClassVar

```python
from typing import Final, ClassVar

# Final: 值不可修改
MAX_RETRIES: Final = 5
API_VERSION: Final[str] = "2.2.0"

# ClassVar: 类变量（不被 Pydantic 当作实例字段）
class AgentConfig(BaseModel):
    DEFAULT_MODEL: ClassVar[str] = "gemini-2.5-flash"
    name: str
    model: str = Field(default=DEFAULT_MODEL)
```

## 9. 在 ADK 源码中的位置

快速定位关键类型定义：

```bash
# TypeAlias 定义
grep -rn 'TypeAlias' source/src/google/adk/ --include='*.py'

# 关键位置：
# workflow/_graph.py:38 — RouteValue
# workflow/_graph.py:41 — NodeLike
# workflow/_graph.py:46 — RoutingMap

# Annotated 使用
grep -rn 'Annotated' source/src/google/adk/ --include='*.py'

# 泛型函数
grep -rn 'def.*\[T' source/src/google/adk/ --include='*.py'
```

## 10. 速查表

| 语法 | 说明 | ADK 使用位置 |
|------|------|-------------|
| `str \| None` | 可选联合 | 全项目 |
| `TypeAlias` | 类型别名 | `workflow/_graph.py` |
| `Annotated[T, Meta]` | 带元数据 | `workflow/_graph.py` Edge |
| `Callable[[A], R]` | 函数类型 | `tools/` |
| `Literal["a", "b"]` | 精确值 | `agents/` mode |
| `Final` | 不可变常量 | 配置常量 |
| `ClassVar` | 类变量 | Config 模型 |
| `Protocol` | 结构化子类型 | 接口定义 |
| `Generic[T]` | 泛型基类 | 工具系统 |
| `Self` (3.11+) | 返回自身类型 | Builder 模式 |
