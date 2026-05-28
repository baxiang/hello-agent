# LangChainGo 技术工程代码学习文档

本文档系列基于 [tmc/langchaingo](https://github.com/tmc/langchaingo) 源码编写，旨在帮助 Go 开发者系统性地学习和掌握 LangChainGo 这一开源 LLM 应用开发框架。

源码位置：`../source/`（已克隆到本目录同级位置）

## 文档目录

### 一、入门篇

| 文件 | 标题 | 说明 |
|------|------|------|
| [00-overview.md](00-overview.md) | 项目总览 | 设计哲学、核心概念、与 Python LangChain 对比 |
| [01-architecture.md](01-architecture.md) | 整体架构 | 分层架构、数据流、模块依赖 |
| [02-quickstart.md](02-quickstart.md) | 快速入门 | 环境搭建、最简示例、Chain/Agent/RAG |

### 二、核心模块

| 文件 | 标题 | 说明 |
|------|------|------|
| [package-docs/llms.md](package-docs/llms.md) | LLM 模型层 | Model 接口、16+ 提供商、ChatMessage 体系 |
| [package-docs/chains.md](package-docs/chains.md) | Chain 编排 | LLMChain、Sequential、API、RetrievalQA |
| [package-docs/agents.md](package-docs/agents.md) | Agent 体系 | Executor、OneShotAgent、MRKL |
| [package-docs/tools.md](package-docs/tools.md) | 工具系统 | Tool 接口、内置工具、自定义工具 |
| [package-docs/memory.md](package-docs/memory.md) | 记忆系统 | Buffer/Window/Summary、ChatMessageHistory |
| [package-docs/prompts.md](package-docs/prompts.md) | Prompt 模板 | PromptTemplate、ChatPromptTemplate、FewShot |

### 三、扩展模块

| 文件 | 标题 | 说明 |
|------|------|------|
| [package-docs/embeddings-vectorstores.md](package-docs/embeddings-vectorstores.md) | 向量存储与嵌入 | Embedder、VectorStore、DocumentLoader、TextSplitter |
| [package-docs/callbacks.md](package-docs/callbacks.md) | Callback 回调 | CallbackHandler、LogHandler |
| [package-docs/outputparser.md](package-docs/outputparser.md) | OutputParser | 泛型解析、JSON/String/Combining |

### 四、Go 前置知识

| 文件 | 标题 | 说明 |
|------|------|------|
| go-fundamentals/ | 待补充 | langchaingo 特有的 Go 知识点 |

## 版本信息

- langchaingo 源码版本：最新 main 分支
- Go 版本要求：1.24+
