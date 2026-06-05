# Python 装饰器与上下文管理器 — ADK-Python 的横切能力

> ADK-Python 使用装饰器注册工具和功能，使用上下文管理器管理资源和事件流。这两个模式在源码中无处不在。

## 1. 装饰器基础

```python
# 装饰器就是一个接受函数、返回新函数的函数
def log_call(func):
    def wrapper(*args, **kwargs):
        print(f"调用 {func.__name__}({args}, {kwargs})")
        result = func(*args, **kwargs)
        print(f"返回 {result}")
        return result
    return wrapper

@log_call
def add(a: int, b: int) -> int:
    return a + b

add(1, 2)
# 输出:
# 调用 add((1, 2), {})
# 返回 3
```

## 2. 带参数的装饰器

```python
def retry(max_attempts: int = 3):
    """带参数的装饰器：三层嵌套"""
    def decorator(func):
        def wrapper(*args, **kwargs):
            for i in range(max_attempts):
                try:
                    return func(*args, **kwargs)
                except Exception as e:
                    if i == max_attempts - 1:
                        raise
                    print(f"重试 {i+1}/{max_attempts}: {e}")
        return wrapper
    return decorator

@retry(max_attempts=3)
def unstable_api():
    ...
```

### ADK 实际使用：Feature 注册

```python
# 来自 features/ 模块的简化示例
class FeatureRegistry:
    def register(name: str):
        def decorator(fn):
            registry[name] = fn
            return fn  # 保持原函数可用
        return decorator

@feature_registry.register("code_executor")
def execute_python(code: str) -> str:
    ...
```

## 3. 异步装饰器

ADK 中几乎所有公开方法是 `async def`，装饰器也需要支持异步：

```python
import asyncio
from functools import wraps

def async_timed(func):
    @wraps(func)  # 保留原函数的元数据
    async def wrapper(*args, **kwargs):
        start = asyncio.get_event_loop().time()
        result = await func(*args, **kwargs)
        elapsed = asyncio.get_event_loop().time() - start
        print(f"{func.__name__} 耗时 {elapsed:.2f}s")
        return result
    return wrapper

@async_timed
async def call_llm(prompt: str) -> str:
    await asyncio.sleep(1)  # 模拟 LLM 调用
    return "response"
```

## 4. 上下文管理器基础

```python
# with 语句自动调用 __enter__ / __exit__
class FileWriter:
    def __init__(self, filename: str):
        self.filename = filename
        self.file = None

    def __enter__(self):
        print(f"打开 {self.filename}")
        self.file = open(self.filename, "w")
        return self.file

    def __exit__(self, exc_type, exc_val, exc_tb):
        print(f"关闭 {self.filename}")
        self.file.close()
        return False  # False = 不抑制异常

# 无论是否异常，都会执行 __exit__
with FileWriter("output.txt") as f:
    f.write("hello")
```

### contextlib 快捷方式

```python
from contextlib import contextmanager

# 用生成器写上下文管理器
@contextmanager
def file_writer(filename: str):
    print(f"打开 {filename}")
    f = open(filename, "w")
    try:
        yield f  # yield 之前 = __enter__，yield 之后 = __exit__
    finally:
        print(f"关闭 {filename}")
        f.close()
```

## 5. 异步上下文管理器

ADK 使用 `async with` 管理异步资源：

```python
class AsyncConnection:
    async def __aenter__(self):
        print("连接中...")
        await asyncio.sleep(0.1)
        return self

    async def __aexit__(self, *args):
        print("关闭中...")
        await asyncio.sleep(0.1)

async def use():
    async with AsyncConnection() as conn:
        # 这里操作 conn
        pass
```

### aclosing：确保生成器关闭

这是 ADK Runner 中最常见的模式（`source/src/google/adk/runners.py`）：

```python
from contextlib import aclosing

async def consume_events(agent):
    async with aclosing(agent.run_async(ctx)) as events:
        async for event in events:
            yield event
    # aclosing 确保生成器的 aclose() 被调用，释放资源
```

## 6. 装饰器实战：@tool

ADK-Python 中给函数加 `@tool` 装饰器即可将其暴露给 LLM：

```python
# ADK 内部实现原理（简化版）
def tool(func):
    """将普通函数转为 Agent 可调用的工具"""
    func._is_tool = True
    return func

# 使用
@tool
def get_weather(city: str) -> str:
    """获取城市天气"""
    return f"{city}: 晴朗, 25°C"

# LLM 看到的是：
# Tool: get_weather(city: str) -> str
# Description: 获取城市天气
```

## 7. Dataclass 基础

ADK 在 Workflow 内部状态等场景使用 `dataclass` 而非 Pydantic（更轻量、更快）：

```python
from dataclasses import dataclass, field

@dataclass
class NodeState:
    """Workflow 内部节点状态（不持久化）"""
    name: str
    status: str = "pending"
    output: list[str] = field(default_factory=list)
    run_count: int = 0

# 等价于手写：
class NodeState:
    def __init__(self, name, status="pending", output=None, run_count=0):
        self.name = name
        self.status = status
        self.output = output if output is not None else []
        self.run_count = run_count
```

`dataclass` 自动生成 `__init__`、`__repr__`、`__eq__`。

### KW_ONLY（3.10+）

```python
from dataclasses import dataclass, KW_ONLY, field

@dataclass
class Config:
    name: str
    _: KW_ONLY  # 之后的字段只能通过关键字参数传入
    timeout: int = 30
    retries: int = 3

Config("agent1", timeout=60)  # ✅
Config("agent1", 60)          # ❌ TypeError
```

## 8. 速查表

| 模式 | 语法 | ADK 使用场景 |
|------|------|-------------|
| 函数装饰器 | `@decorator` | `@tool`、`FeatureRegistry` |
| 带参数装饰器 | `@decorator(args)` | 重试次数、超时配置 |
| `@wraps(func)` | 保留元数据 | 始终跟在装饰器内部 |
| `with obj:` | 同步上下文管理器 | 文件操作 |
| `async with obj:` | 异步上下文管理器 | Runner 事件流 |
| `@contextmanager` | 生成器式上下文 | 简化资源管理 |
| `aclosing(gen)` | 确保异步生成器关闭 | Runner 事件包装 |
| `@dataclass` | 自动生成方法 | Workflow 内部状态 |
| `KW_ONLY` | 强制关键字参数 | 配置类 |
| `field(default_factory=list)` | 可变默认值 | dataclass 字段 |
