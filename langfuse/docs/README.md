# Langfuse 技术工程代码学习文档

本文档系列基于 [langfuse/langfuse](https://github.com/langfuse/langfuse) 源码编写，旨在帮助开发者深入理解 Langfuse 这一开源 LLM 工程平台的内部架构与设计决策。

源码位置：`../source/`（已克隆到本目录同级位置）

## 文档目录

### 一、入门篇

| 文件 | 标题 | 说明 |
|------|------|------|
| [00-overview.md](00-overview.md) | 项目总览 | 设计哲学、核心概念、技术栈 |
| [01-architecture.md](01-architecture.md) | 整体架构 | 双容器架构、数据流、队列系统 |
| [02-quickstart.md](02-quickstart.md) | 快速入门 | Docker 启动、Tracing、SDK 集成 |

### 二、核心模块

| 文件 | 标题 | 说明 |
|------|------|------|
| [package-docs/data-model.md](package-docs/data-model.md) | 数据模型 | Trace/Span/Generation/Score/Prompt/Dataset |
| [package-docs/ingestion-pipeline.md](package-docs/ingestion-pipeline.md) | 摄取管道 | SDK→API→S3→Queue→Worker→ClickHouse |
| [package-docs/evaluation.md](package-docs/evaluation.md) | 评估系统 | LLM-as-Judge、Code Eval、Annotation |
| [package-docs/prompt-management.md](package-docs/prompt-management.md) | Prompt 管理 | 版本化、标签、依赖解析 |

### 三、集成与部署

| 文件 | 标题 | 说明 |
|------|------|------|
| [package-docs/sdk-integration.md](package-docs/sdk-integration.md) | SDK 集成 | Python/JS/LangChain/OTel |
| [package-docs/infrastructure.md](package-docs/infrastructure.md) | 基础设施 | Docker/PostgreSQL/ClickHouse/Redis/S3 |

## 版本信息

- Langfuse 源码版本：最新 main 分支
- 技术栈：Next.js 15 + tRPC + Prisma + ClickHouse + Redis(BullMQ) + S3
