# Python 前置知识详解

ADK-Python 基于现代 Python 特性构建。以下文档覆盖阅读源码所需的核心前置知识，每篇都会连接到 ADK 源码中的实际使用位置。

| # | 文档 | 说明 |
|---|------|------|
| 01 | [asyncio 异步编程](./01-asyncio.md) | async/await、AsyncGenerator、事件循环、ADK 全异步架构 |
| 02 | [Pydantic v2](./02-pydantic.md) | BaseModel、Field、嵌套模型、序列化、ADK 配置系统基石 |
| 03 | [类型提示](./03-type-hints.md) | TypeAlias、Annotated、泛型、Callable、ADK 接口定义 |
| 04 | [装饰器与数据类](./04-decorators-dataclasses.md) | @tool 注册、异步装饰器、aclosing、dataclass、ADK 内部模式 |

## 学习路径建议

**已有 Python 基础，想快速读懂 ADK 源码**：
1. 01 asyncio → 理解 `_run_async_impl()` 和 `AsyncGenerator`
2. 02 Pydantic → 理解 Agent/Event/Config 的字段定义
3. 03 类型提示 → 识别 `TypeAlias`、`NodeLike` 等自定义类型
4. 04 装饰器 → 理解 `aclosing` 和工具注册机制

**Python 经验较少的初学者**：
- 按 01 → 04 顺序阅读，每篇末尾的"ADK 实测位置"用 `grep` 命令可在源码中定位
