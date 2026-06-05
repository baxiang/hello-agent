# LLM 记忆层：四大热门项目深度对比

> 第一梯队项目：Mem0 (57.7k) · SuperMemory (25.6k) · Memori (15.2k) · memU (13.8k)

---

## 一句话区别

| 项目 | 一句话定位 |
|------|-----------|
| **Mem0** | 通用记忆层，LLM 提取事实 → 向量存储 → 混合检索，最成熟的 OSS 方案 |
| **SuperMemory** | 记忆 API 即服务，多模态摄入 + 记忆图谱 + 全方位 Agent 集成 |
| **Memori** | Agent-native 记忆，透明拦截 LLM 调用自动持久化，零代码入侵 |
| **memU** | 24/7 主动 Agent 记忆，文件系统隐喻 + 双系统架构，预测用户意图 |

## 核心差异对比

| 维度 | Mem0 | SuperMemory | Memori | memU |
|------|------|-------------|--------|------|
| **语言** | Python + TS | TypeScript 为主 | Python + Rust | Python + Rust |
| **集成方式** | 显式 API 调用 | SDK + 中间件 | 透明拦截 LLM | API + MCP |
| **记忆模型** | 扁平事实 | 版本化记忆 DAG + 文档 | 关系型 (Entity/Fact/KG) | 文件系统隐喻 (Category/Item/Resource) |
| **数据库** | Qdrant/Chroma + SQLite | PostgreSQL + CF KV | PostgreSQL/MySQL/SQLite/MongoDB | InMemory/SQLite/PostgreSQL |
| **检索方式** | 语义 + BM25 + 实体 | 混合 RAG+Memory | 向量 + 词法 (FAISS) | RAG 向量 + LLM 语义 双模 |
| **多模态** | 视觉支持 | 图片/PDF/视频/网页 | 图片/视频/音频 | 图片/视频/音频 |
| **Agent 支持** | API 手动调用 | MCP + Vercel AI SDK + OpenAI SDK + Mastra | 6+ LLM 自动拦截 + Agno/LangChain/PydanticAI | MCP Server + 后台 Bot |
| **部署** | pip install / Docker / Cloud | Cloud-first (CF Workers) | Cloud + BYODB 双模 | Cloud + 本地 |
| **多租户** | user_id/agent_id/run_id | containerTags + Spaces | entity_id/process_id/session | user_id (自定义模型合并) |
| **记忆提取** | LLM ADD-only (V3) | 服务端专用提取 | 高级增强 (事实+三元组+属性) | 结构化提取 (XML格式) |
| **特色能力** | 实体链接 + 反幻觉化 | 自动遗忘 + 版本控制 + 用户画像 | Agent 执行轨迹捕获 | 强化计数 + 衰退打分 + 意图预测 |

## 技术路线图谱

```
                      记忆来源
                         │
          ┌──────────────┼──────────────┐
          ▼              ▼              ▼
     对话文本         多模态内容      Agent执行轨迹
     (Mem0)       (SuperMemory)      (Memori)
          │              │              │
          └──────────────┴──────────────┘
                         │
                    LLM 提取层
                         │
          ┌──────────────┼──────────────┐
          ▼              ▼              ▼
     扁平事实        版本化记忆DAG     关系型结构
     (Mem0)       (SuperMemory)      (Memori/memU)
          │              │              │
          └──────────────┴──────────────┘
                         │
                    存储与检索
          ┌──────────────┼──────────────┐
          ▼              ▼              ▼
    向量+BM25+实体  混合RAG+Memory   向量+词法/LLM
     (Mem0)       (SuperMemory)      (Memori/memU)
                         │
                    Agent 集成
          ┌──────────────┼──────────────┐
          ▼              ▼              ▼
    显式API调用     多框架中间件      透明拦截
     (Mem0)       (SuperMemory)      (Memori)
                         │
                   主动/被动
          ┌──────────────┼──────────────┐
          ▼              ▼              ▼
     被动检索        被动检索        主动预测
     (Mem0)       (SuperMemory)      (memU)
```

## 适用场景

| 场景 | 推荐项目 |
|------|----------|
| 通用聊天机器人记忆 | Mem0 |
| 多模态内容知识库 | SuperMemory |
| 已有 Agent 框架，零改造接入 | Memori |
| 24/7 长时间运行 Agent | memU |
| 需要 MCP 协议集成 | SuperMemory / memU |
| 自托管 + 数据库可控 | Memori (BYODB) |
| 快速原型验证 | Mem0 (pip install 即用) |
| 生产级高并发 | SuperMemory (Cloudflare 边缘) |

## 按章节阅读

- [Mem0 源码深度学习笔记](./mem0.md) — 最成熟的通用方案
- [SuperMemory 源码深度学习笔记](./supermemory.md) — 多模态记忆 API 即服务
- [Memori 源码深度学习笔记](./memori.md) — Agent-native 透明记忆
- [memU 源码深度学习笔记](./memu.md) — 24/7 主动预测型 Agent 记忆
