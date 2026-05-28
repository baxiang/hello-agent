# 07-DeepAgents篇

> 构建能规划、使用子代理（subagent）、管理文件系统的深度 Agent

## 学习路径

```
01-概述与快速入门 → 02-模型与工具配置 → 03-虚拟文件系统与后端
(了解是什么)        (学会配置模型/工具)   (理解存储方案)
        ↓
04-子代理架构 → 05-上下文工程 → 06-Skills技能系统
(隔离工作)        (管理上下文)     (按需扩展)
        ↓
07-权限控制与安全 → 08-沙箱执行环境 → 09-人类审核 → 10-生产部署
(安全管理)          (安全执行)        (人工审批)     (上线)
```

## 章节目录

| 子章节 | 内容 | 核心概念 |
|--------|------|---------|
| 01-概述与快速入门 | Deep Agents 定位、安装、create_deep_agent 参数 | Agent Harness、内置中间件 |
| 02-模型与工具配置 | 模型选择、工具定义、中间件、系统提示词 | 动态模型、ToolRuntime |
| 03-虚拟文件系统与后端 | 6 种后端类型、自定义后端、路由组合 | State/Store/Composite |
| 04-子代理架构 | 子代理配置、通用子代理、上下文传播 | 上下文隔离、Skills 继承 |
| 05-上下文工程 | 输入/运行时上下文、自动卸载、自动摘要 | 上下文压缩、长期记忆 |
| 06-Skills技能系统 | SKILL.md 格式、渐进式加载、多源优先级 | 按需加载、子代理 Skills |
| 07-权限控制与安全 | 声明式权限、子代理权限、后端策略钩子 | First-Match-Wins |
| 08-沙箱执行环境 | 沙箱提供商、生命周期、文件传输、安全 | execute、隔离边界 |
| 09-人类审核 | 审核配置、决策类型、多工具中断、子代理审核 | approve/edit/reject |
| 10-生产部署 | FastAPI、PostgreSQL、LangSmith、Docker | 可观测性、监控 |

## 参考资源

- [LangChain 官方文档](https://docs.langchain.com/oss/python/langchain/overview)
- [LangGraph 官方文档](https://docs.langchain.com/oss/python/langgraph/overview)
- [Deep Agents 官方文档](https://docs.langchain.com/oss/python/deepagents/overview)
- [Agent Skills 规范](https://agentskills.io/specification)
