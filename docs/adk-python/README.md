# ADK-Python 技术工程学习文档

ADK-Python（Agent Development Kit for Python）是 Google 开源的 Python AI Agent 开发工具包，当前版本 v2.0 Beta，采用 Apache 2.0 许可证。

源码位置：`../source/`

## 文档目录

### 入门篇

| # | 文档 | 说明 |
|---|------|------|
| 00 | [项目总览](./00-overview.md) | 项目简介、设计哲学、与 ADK-Go 对比、核心概念 |

### Python 前置知识详解（python-fundamentals/）

| # | 文档 | 说明 |
|---|------|------|
| 01 | [asyncio 异步编程](./python-fundamentals/01-asyncio.md) | async/await、AsyncGenerator、事件循环、ADK 全异步架构 |
| 02 | [Pydantic v2](./python-fundamentals/02-pydantic.md) | BaseModel、Field、嵌套模型、序列化、ADK 配置系统基石 |
| 03 | [类型提示](./python-fundamentals/03-type-hints.md) | TypeAlias、Annotated、泛型、Callable、ADK 接口定义 |
| 04 | [装饰器与数据类](./python-fundamentals/04-decorators-dataclasses.md) | @tool 注册、异步装饰器、aclosing、dataclass、ADK 内部模式 |

## 版本说明

- ADK-Python 版本：v2.0 Beta
- Python 模块：`google-adk`
- 许可证：Apache 2.0
- 文档编写日期：2026-06-05

## 相关链接

- 官方仓库：<https://github.com/google/adk-python>
- 官方文档：<https://google.github.io/adk-docs/>
- Go 版本：<https://github.com/google/adk-go>
- Java 版本：<https://github.com/google/adk-java>
- ADK Web：<https://github.com/google/adk-web>
