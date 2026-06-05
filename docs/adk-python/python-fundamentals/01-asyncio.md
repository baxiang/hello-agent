# Python asyncio — ADK-Python 的异步引擎

> ADK-Python 是**全异步**框架。Agent、Runner、Workflow、Tool 全部基于 `async/await` 构建。不理解 asyncio，源码寸步难行。

## 1. 为什么 ADK 必须用异步

一次典型的 Agent 调用涉及多个 I/O 密集操作：

```
用户输入 → LLM API 调用(3秒) → 工具调用(1秒) → LLM API 调用(2秒) → 返回
```

如果同步执行，以上 6 秒全部阻塞线程。异步模式下，等待 I/O 时可以处理其他请求。ADK-Python 选择 `asyncio` 作为唯一并发模型——所有公开 API 都是 `async` 的。

## 2. async/await 基础

```python
import asyncio

# 定义协程函数（async def）
async def fetch_data(url: str) -> str:
    print(f"开始请求 {url}")
    await asyncio.sleep(1)  # 模拟 I/O
    print(f"完成请求 {url}")
    return f"data from {url}"

# 运行协程
async def main():
    result = await fetch_data("https://api.example.com")
    print(result)

asyncio.run(main())
```

关键区别：
- `def` → 普通函数，调用即执行，返回结果
- `async def` → 协程函数，调用返回 coroutine 对象，需要 `await` 或 `asyncio.run()` 才能执行
- `await` → 挂起当前协程，等待另一个协程完成后恢复

## 3. 并发执行：gather vs create_task

这是 ADK 源码中最常见的模式：

```python
async def fetch_all():
    # 并发执行三个请求（2秒完成，不是6秒）
    results = await asyncio.gather(
        fetch_data("url1"),
        fetch_data("url2"),
        fetch_data("url3"),
    )
    return results

async def with_tasks():
    # create_task 创建后台任务，不阻塞当前协程
    task = asyncio.create_task(fetch_data("url1"))
    # 这里可以做其他事情
    result = await task  # 需要结果时再 await
```

ADK-Python 中 ParallelAgent 和 Workflow 并行节点就是用 `asyncio.gather` / `create_task` 实现的。

## 4. AsyncGenerator：ADK 的流式基础

ADK-Python 中 `Agent._run_async_impl()` 返回 `AsyncGenerator[Event, None]`——这是整个流式事件系统的基础：

```python
from typing import AsyncGenerator

async def event_stream() -> AsyncGenerator[str, None]:
    """逐步产出事件的异步生成器"""
    yield "event_1"
    await asyncio.sleep(0.5)
    yield "event_2"
    await asyncio.sleep(0.5)
    yield "event_3"

# 消费：async for
async def consume():
    async for event in event_stream():
        print(f"收到: {event}")
```

`AsyncGenerator` 的本质是一个协程对象，支持 `async for` 消费。`yield` 产出值后挂起，消费者调用 `anext()` 时恢复：

```
Producer:  yield("event_1") → 挂起等待
Consumer:  async for → 收到 "event_1" → 请求下一个
Producer:  await sleep(0.5) → yield("event_2") → 挂起
Consumer:  async for → 收到 "event_2" → 请求下一个
...
```

在 ADK 中就是：
```python
# Runner.run_async() 内部
async for event in agent._run_async_impl(ctx):
    await session_service.append_event(session, event)
    yield event  # 转发给调用方
```

## 5. 上下文管理器：async with

ADK 使用异步上下文管理器管理资源生命周期：

```python
# 自定义异步上下文管理器
class Connection:
    async def __aenter__(self):
        print("连接中...")
        await asyncio.sleep(0.1)
        return self

    async def __aexit__(self, *args):
        print("关闭连接...")

# 使用
async def use_connection():
    async with Connection() as conn:
        # 做事情
        pass
    # 自动关闭
```

ADK 源码中的实际使用（`source/src/google/adk/runners.py`）：
```python
from contextlib import aclosing

async for event in runner.run_async(...):
    # aclosing 确保生成器结束时调用 aclose()
    pass
```

## 6. 事件循环与主线程

```python
# asyncio.run() 创建新事件循环，运行结束后关闭
asyncio.run(main())

# 在已有循环中运行（Jupyter、FastAPI 等）
await main()

# 获取当前事件循环
loop = asyncio.get_running_loop()
```

**⚠️ 常见陷阱**：
- 不要在异步函数中调用 `time.sleep()`（阻塞整个线程）——用 `await asyncio.sleep()`
- 不要在异步函数中调用同步 IO（`requests.get()` 等）——用 `aiohttp` 或 `run_in_executor`
- 不要混用 `asyncio.run()` 和已有的 event loop

## 7. ADK-Python 中的实战模式

### Runner 的执行流程（简化版）

```python
class Runner:
    async def run_async(self, user_id, session_id, new_message):
        session = await self.session_service.get_session(...)
        ctx = InvocationContext(session=session, ...)

        # 核心：消费 Agent 的 AsyncGenerator
        async for event in self._node._run_async_impl(ctx):
            # 非 partial 事件持久化
            if not event.partial:
                await self.session_service.append_event(session, event)
            yield event
```

### Workflow 的并行执行

```python
# 简化版：并行调度所有就绪节点
tasks = [
    asyncio.create_task(node._run_async_impl(ctx))
    for node in ready_nodes
]
for completed in asyncio.as_completed(tasks):
    result = await completed
    # 处理结果，可能触发新的就绪节点
```

### LLM 调用的底层

```python
# 调用 Gemini / LiteLLM 模型
response = await model.generate_content_async(contents, config)
# generate_content_async 内部：
#   await aiohttp.post(url, json=body)  # 异步 HTTP
```

## 8. 速查表

| 语法 | 用途 | ADK 使用场景 |
|------|------|-------------|
| `async def` | 定义协程 | 所有公开 API 方法 |
| `await` | 等待协程 | 调用模型、工具、IO |
| `async for` | 消费异步迭代器 | Runner 消费 Agent 事件流 |
| `AsyncGenerator[T, None]` | 异步生成器类型 | `Agent._run_async_impl()` 返回类型 |
| `asyncio.gather()` | 并发执行多个协程 | ParallelAgent、Workflow 并行 |
| `asyncio.create_task()` | 创建后台任务 | Workflow 节点调度 |
| `asyncio.as_completed()` | 按完成顺序处理 | Workflow 动态调度 |
| `async with` | 异步上下文管理器 | 资源管理、aclosing |
| `asyncio.run()` | 运行顶层协程 | 入口点 |
| `asyncio.sleep()` | 异步等待（不阻塞） | 测试、重试延迟 |
