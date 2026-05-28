# 05-LangGraph进阶

本章介绍 LangGraph 的进阶功能：记忆管理、长期记忆、中断审核、多中断、持久化、子图、Map-Reduce、图迁移与缓存。

## 学习目标

- 掌握短期记忆（MessagesState、add_messages、消息裁剪）
- 理解长期记忆（Store、namespace、语义搜索）
- 实现 Human-in-the-loop（interrupt、Command）
- 处理多中断场景（并行、串行、工具中断）
- 配置持久化（MemorySaver、SqliteSaver、PostgresSaver）
- 构建子图架构（嵌套图、父子通信）
- 实现 Map-Reduce 模式（Send API、扇出扇入）
- 管理图迁移与缓存

## 章节内容

| 序号 | 标题 | 内容 |
|------|------|------|
| 01 | 记忆管理 | MessagesState 预置状态、add_messages reducer（追加/更新/删除）、trim_messages 截断策略、摘要压缩、滑动窗口、自定义 Reducer |
| 02 | 长期记忆 | BaseStore 接口、InMemoryStore / PostgresStore、namespace 层次化管理、语义搜索（embeddings + 过滤）、三种记忆类型（Semantic / Episodic / Procedural）、Profile vs Collection 模式、热路径与后台写入策略 |
| 03 | 中断与审核 | interrupt() 函数、Command(resume=) 恢复、审批模式（approve/reject/modify）、编辑模式、工具中断、验证输入循环、v2 格式、HumanInTheLoopMiddleware、中断规则（幂等、JSON 序列化） |
| 04 | 多中断处理 | 并行节点同时中断、中断 ID 映射恢复、串行中断逐个处理、工具多中断、验证循环（while + interrupt）、带超时处理、中断优先级排序、批量中断 UI |
| 05 | 持久化 | MemorySaver（开发）、SqliteSaver（本地）、PostgresSaver（生产）、异步 checkpointers（AsyncSqliteSaver / AsyncPostgresSaver）、加密序列化（EncryptedSerializer + AES）、状态历史查询、Time Travel 重放、状态更新 |
| 06 | 子图架构 | 嵌套 StateGraph、子图作为节点、状态映射、父子通信（Command.GOTO / Command.PARENT）、多层嵌套、子图独立/共享 Checkpointer、子图流式输出（subgraphs=True）、清晰边界和最小接口 |
| 07 | Map-Reduce 模式 | Send API 扇出、并行处理、扇入聚合、动态图构建（条件扇出）、嵌套 Map-Reduce、容错处理（成功/失败分离）、有序聚合、进度追踪 |
| 08 | 图迁移与缓存 | CachePolicy（TTL / LRU）、InMemoryCache、状态模式演进（V1 → V2 → V3）、自动迁移函数、图版本管理（多版本共存、灰度发布）、缓存 + 持久化两层架构、迁移测试 |
| 09 | 进阶实战 | 智能审批工作流：自动审核子图（格式检查 → 规则验证 → 风险评估）+ 人工审核中断 + PostgresSaver 持久化 + PostgresStore 长期记忆 + FastAPI SSE 流式部署 |

## 示例项目

`langgraph_advanced/` - Human-in-the-loop 审批流程

## 关键概念

### 记忆系统

```
短期记忆（State）          长期记忆（Store）
├─ MessagesState           ├─ namespace 层次
├─ add_messages            ├─ 语义搜索
├─ trim_messages           ├─ Profile / Collection
├─ 滑动窗口                └─ 热路径 / 后台写入
└─ Checkpointer
```

### 中断流程

```
执行 → interrupt() → 暂停 → Command(resume) → 继续
```

### 子图架构

```
父图 → 子图A → 子图B → 聚合
```
