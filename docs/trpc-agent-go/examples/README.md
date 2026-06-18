# tRPC-Agent-Go 示例教程

> 基于 [tRPC-Agent-Go](https://github.com/trpc-group/trpc-agent-go) 框架 examples 目录的完整教学系列，面向熟悉 Go 语言、对 AI Agent 有基本了解的中级开发者。

## 目录

### 01 - Agent 基础

| 示例 | 文章 | 说明 |
|------|------|------|
| `llmagent` | [LLM Agent 入门](01-agent-basics/llmagent.md) | 最小可运行的 LLM Agent |
| `customagent` | [自定义 Agent](01-agent-basics/customagent.md) | 实现 Agent 接口 |
| `debugagent` | [调试 Agent](01-agent-basics/debugagent.md) | Agent 调试技巧 |

### 00 - Runner 执行器

`00-runner-executor/` 目录包含 5 个运行时基础设施子示例。详见 [Runner 索引页](00-runner-executor/index.md)。

| 子示例 | 文章 | 说明 |
|--------|------|------|
| `runner` | [Runner 运行器](00-runner-executor/runner.md) | Runner 的配置与使用 |
| `managedrunner` | [托管 Runner](00-runner-executor/managedrunner.md) | ManagedRunner 模式 |
| `cancelrun` | [取消运行](00-runner-executor/cancelrun.md) | Context 取消与优雅退出 |
| `runwithmessages` | [消息运行](00-runner-executor/runwithmessages.md) | 带历史消息运行 |
| `ralphloop` | [Ralph 循环](00-runner-executor/ralphloop.md) | RALPH 交互循环 |

### 02 - 工具系统

`tool/` 目录包含 4 个独立子示例。详见 [Tool 索引页](02-tool-system/tool.md)。

| 子示例 | 文章 | 说明 |
|--------|------|------|
| `tool/codeexec` | [代码执行工具](02-tool-system/tool-codeexec.md) | LLM 自主执行 Python/Bash，local/jupyter/e2b 后端 |
| `tool/hostexec` | [宿主执行工具](02-tool-system/tool-hostexec.md) | ToolSet 暴露 shell，支持长任务轮询 |
| `tool/openviking` | [OpenViking 工具](02-tool-system/tool-openviking.md) | 对接 OpenViking 知识库，三档 Profile 控制 |
| `tool/webfetch` | [Web 抓取工具](02-tool-system/tool-webfetch.md) | 本地 HTTP 直抓 vs Gemini URL Context 服务端抓取 |
| `multitools` | [多工具](02-tool-system/multitools.md) | 多工具并行调用 |
| `agenttool` | [Agent 工具](02-tool-system/agenttool.md) | 将 Agent 作为工具 |
| `dynamicagenttool` | [动态 Agent 工具](02-tool-system/dynamicagenttool.md) | 动态注册 Agent 工具 |
| `toolcallid` | [工具调用 ID](02-tool-system/toolcallid.md) | 工具调用 ID 追踪 |
| `toolfilter` | [工具过滤](02-tool-system/toolfilter.md) | 按条件过滤可用工具 |
| `toolinterrupt` | [工具中断](02-tool-system/toolinterrupt.md) | 工具执行中断机制 |
| `toolpipe` | [工具管道](02-tool-system/toolpipe.md) | 工具间的管道传递 |
| `toolpolicy` | [工具策略](02-tool-system/toolpolicy.md) | 工具执行策略控制 |
| `openapitool` | [OpenAPI 工具](02-tool-system/openapitool.md) | 从 OpenAPI Spec 生成工具 |
| `llmagent_tool_call_retry` | [工具调用重试](02-tool-system/llmagent_tool_call_retry.md) | 工具调用失败重试 |

### 03 - MCP 工具

`mcptool/` 目录包含主示例 + 4 个传输模式子示例。详见 [MCP 索引页](03-mcp-tools/mcptool.md)。

| 子示例 | 文章 | 说明 |
|--------|------|------|
| `mcptool`（主） | [MCP 主示例](03-mcp-tools/mcptool-main.md) | 一个 Agent 消费 stdio+sse+streamable MCP |
| `mcptool/stdioserver` | [STDIO 服务端](03-mcp-tools/mcptool-stdioserver.md) | 子进程 stdio 通信，最简服务端 |
| `mcptool/sseserver` | [SSE 服务端](03-mcp-tools/mcptool-sseserver.md) | HTTP SSE + 信号优雅退出 |
| `mcptool/streamableserver` | [Streamable 服务端](03-mcp-tools/mcptool-streamableserver.md) | 现代写法，struct-first + OutputSchema |
| `mcptool/http_headers` | [动态 HTTP 头](03-mcp-tools/mcptool-httpheaders.md) | per-request 认证/追踪注入 |
| `mcpbroker` | [MCP Broker](03-mcp-tools/mcpbroker.md) | MCP 工具代理 |

### 04 - Graph 工作流

`graph/` 目录包含 50+ 子示例，按主题归为 6 篇专题文章。详见 [Graph 索引页](04-graph-workflow/graph.md)。

| 主题 | 文章 | 覆盖子示例 |
|------|------|-----------|
| 基础拓扑与编排 | [Graph 拓扑模式](04-graph-workflow/graph-topology.md) | basic/diamond/parallel/multiends/fanout/join_edge/mapreduce |
| 执行引擎与检查点 | [Graph 执行控制](04-graph-workflow/graph-execution.md) | dag_engine/concurrency_race/error_handling/execution_trace/retry/nodecache/tool_call_retry/checkpoint/time_travel_edit_state |
| 中断与恢复 | [Graph 中断机制](04-graph-workflow/graph-interrupt.md) | interrupt/static_interrupt/external_interrupt/dag_interrupt/nested_interrupt/a2a_interrupt/agentnode_llmagent_externaltool/externaltool/userinputonce |
| 子图与子 Agent | [Graph 子图组合](04-graph-workflow/graph-subagent.md) | subgraph/isolated_subagent/a2asubagent/a2a_agent/subagent_runtime_state/agent_state_handoff/react |
| 流式与 IO 约定 | [Graph 流式与 IO](04-graph-workflow/graph-streaming-io.md) | stream_mode/streaming_node_consumer/oneshot*/multiturn/terminal_messages_only/io_conventions*/placeholder* |
| 高级特性 | [Graph 高级特性](04-graph-workflow/graph-advanced.md) | mcptool/per_node_callbacks/runner_plugin_node_callbacks/structure_export/visualization/call_options_generation_config |

### 05 - 多 Agent 协作

| 示例 | 文章 | 说明 |
|------|------|------|
| `multiagent` | [多 Agent 编排](05-multi-agent/multiagent.md) | Chain/Parallel/Cycle 模式 |
| `team` | [Team 协作](05-multi-agent/team.md) | Coordinator/Swarm 团队模式 |
| `transfer` | [Agent 转移](05-multi-agent/transfer.md) | Agent 间任务转移 |

### 06 - Memory 系统

`memory/` 目录包含 5 个独立子示例，覆盖从手动工具调用到外部平台集成的完整光谱。详见 [Memory 索引页](06-memory-system/memory.md)。

| 子示例 | 文章 | 模式 | 说明 |
|--------|------|------|------|
| `memory/simple` | [简单模式（Agentic）](06-memory-system/memory-simple.md) | 手动工具 | LLM 显式调用记忆工具 |
| `memory/auto` | [自动模式（Auto）](06-memory-system/memory-auto.md) | 后台提取 | Extractor 透明提取，用户无感 |
| `memory/mem0` | [Mem0 集成](06-memory-system/memory-mem0.md) | 外部平台 | ingest-first，只读工具 |
| `memory/tencentdb` | [TencentDB 集成](06-memory-system/memory-tencentdb.md) | 外部平台 | sidecar + recall 插件 |
| `memory/compare` | [检索对比](06-memory-system/memory-compare.md) | 基准 | SQLite 关键词 vs SQLiteVec 向量 |

### 07 - Session 管理

`session/` 目录包含 7 个独立子示例。详见 [Session 索引页](07-session-management/session.md)。

| 子示例 | 文章 | 说明 |
|--------|------|------|
| `session/simple` | [基础 Session](07-session-management/session-simple.md) | 多后端多会话切换 + pgvector 语义召回 |
| `session/appendevent` | [追加事件](07-session-management/session-appendevent.md) | 绕过模型直写任意角色事件 |
| `session/eventlimit` | [事件限制](07-session-management/session-eventlimit.md) | 滑动窗口限制每会话事件条数 |
| `session/ttl` | [TTL 过期](07-session-management/session-ttl.md) | 会话 TTL 过期与重建 |
| `session/hook` | [Session 钩子](07-session-management/session-hook.md) | AppendEventHook/GetSessionHook 内容过滤 |
| `session/persona` | [人格管理](07-session-management/session-persona.md) | 用 session.State 存每会话独立人格 |
| `session/graph` | [Graph 集成](07-session-management/session-graph.md) | Graph Agent 与 Session 协作 |

### 08 - Agent Skills

| 示例 | 文章 | 说明 |
|------|------|------|
| `skill` | [Skill 基础](08-agent-skills/skill.md) | SKILL.md 工作流 |
| `skilldynamicschema` | [动态 Schema](08-agent-skills/skilldynamicschema.md) | Skill 动态 Schema |
| `skillfind` | [Skill 发现](08-agent-skills/skillfind.md) | 自动发现与安装 Skill |
| `skillisolation` | [Skill 隔离](08-agent-skills/skillisolation.md) | Skill 执行隔离 |
| `skillloadmode` | [Skill 加载模式](08-agent-skills/skillloadmode.md) | Skill 加载策略 |
| `skillrun` | [Skill 运行](08-agent-skills/skillrun.md) | Skill 独立运行 |
| `skilltoolactivation` | [Skill 工具激活](08-agent-skills/skilltoolactivation.md) | Skill 内工具激活 |
| `skilltoolprofile` | [Skill 工具配置](08-agent-skills/skilltoolprofile.md) | Skill 工具 Profile |
| `structuredoutputskills` | [结构化输出 Skill](08-agent-skills/structuredoutputskills.md) | 带结构化输出的 Skill |

### 09 - A2A 协议

| 示例 | 文章 | 说明 |
|------|------|------|
| `a2aadk` | [A2A ADK](09-a2a-protocol/a2aadk.md) | A2A 与 ADK 互通 |
| `a2aagent` | [A2A Agent](09-a2a-protocol/a2aagent.md) | Agent-to-Agent 通信 |
| `a2acodeexecution` | [A2A 代码执行](09-a2a-protocol/a2acodeexecution.md) | A2A 远程代码执行 |
| `a2amultipath` | [A2A 多路径](09-a2a-protocol/a2amultipath.md) | A2A 多路径路由 |
| `a2asubagent` | [A2A 子 Agent](09-a2a-protocol/a2asubagent.md) | A2A 子 Agent 编排 |

### 10 - AG-UI 协议

| 示例 | 文章 | 说明 |
|------|------|------|
| `a2ui` | [A2UI 协议](10-agui-protocol/a2ui.md) | Agent-to-UI 前端集成 |
| `agui` | [AG-UI 协议](10-agui-protocol/agui.md) | AG-UI 前端集成 |

### 11 - 代码执行

| 示例 | 文章 | 说明 |
|------|------|------|
| `codeexecution` | [代码执行](11-code-execution/codeexecution.md) | 本地/容器代码执行 |
| `sandboxcodeexecution` | [沙箱代码执行](11-code-execution/sandboxcodeexecution.md) | 安全沙箱执行 |

### 12 - 知识检索 RAG

`knowledge/` 目录包含 24 个子示例（含嵌套），覆盖 RAG 数据源、向量库、重排、特征。详见 [Knowledge 索引页](12-knowledge-rag/knowledge.md)。

#### 基础与查询

| 子示例 | 文章 | 说明 |
|--------|------|------|
| `knowledge/basic` | [基础 RAG](12-knowledge-rag/knowledge-basic.md) | 文件+目录+内存向量库的最小 RAG |
| `knowledge/query-enhancer` | [查询增强](12-knowledge-rag/knowledge-query-enhancer.md) | LLM 改写多轮代词，补全 query |

#### 重排

| 子示例 | 文章 | 说明 |
|--------|------|------|
| `knowledge/reranker/cohere` | [Cohere 重排](12-knowledge-rag/knowledge-reranker-cohere.md) | Cohere cross-encoder 重排 |
| `knowledge/reranker/infinity` | [Infinity 重排](12-knowledge-rag/knowledge-reranker-infinity.md) | 自托管 bge-reranker，数据不出本地 |

#### 数据源

| 子示例 | 文章 | 说明 |
|--------|------|------|
| `knowledge/sources/file` | [文件源](12-knowledge-rag/knowledge-sources-file.md) | 多文件 + 元数据 |
| `knowledge/sources/directory` | [目录源](12-knowledge-rag/knowledge-sources-directory.md) | 递归扫目录批量入库 |
| `knowledge/sources/url` | [URL 源](12-knowledge-rag/knowledge-sources-url.md) | 抓网页建库 |
| `knowledge/sources/auto` | [自动源](12-knowledge-rag/knowledge-sources-auto.md) | 自动判别混合源 |
| `knowledge/sources/fixed-chunking` | [定长切分](12-knowledge-rag/knowledge-sources-fixed-chunking.md) | FixedSizeChunking |
| `knowledge/sources/recursive-chunking` | [递归切分](12-knowledge-rag/knowledge-sources-recursive-chunking.md) | 按语义边界切分 |
| `knowledge/sources/ast` | [AST 源](12-knowledge-rag/knowledge-sources-ast.md) | 源码 AST 解析，代码 RAG |

#### 特性

| 子示例 | 文章 | 说明 |
|--------|------|------|
| `knowledge/features/agentic-filter` | [智能过滤](12-knowledge-rag/knowledge-features-agentic-filter.md) | LLM 自动生成元数据 filter |
| `knowledge/features/metadata-filter` | [元数据过滤](12-knowledge-rag/knowledge-features-metadata-filter.md) | 程序化 AND/OR/NOT 复合过滤 |
| `knowledge/features/management` | [动态管理](12-knowledge-rag/knowledge-features-management.md) | AddSource/Remove/Reload |
| `knowledge/features/extractor` | [文档提取](12-knowledge-rag/knowledge-features-extractor.md) | Docling 转 PDF/HTML 为 Markdown |
| `knowledge/features/transform` | [字符清洗](12-knowledge-rag/knowledge-features-transform.md) | CharFilter/CharDedup |
| `knowledge/features/graphrag` | [GraphRAG](12-knowledge-rag/knowledge-features-graphrag.md) | Apache AGE + pgvector 关系检索 |
| `knowledge/features/graphrag/viewer` | [图可视化](12-knowledge-rag/knowledge-features-graphrag-viewer.md) | AGE 图可视化调试界面 |
| `knowledge/features/code-context-engine` | [代码上下文引擎](12-knowledge-rag/knowledge-features-code-context-engine.md) | code_search 经 MCP 暴露 |
| `knowledge/features/ocr` | [OCR](12-knowledge-rag/knowledge-features-ocr.md) | Tesseract 处理图片型 PDF |

#### 向量库

| 子示例 | 文章 | 说明 |
|--------|------|------|
| `knowledge/vectorstores/postgres` | [pgvector](12-knowledge-rag/knowledge-vectorstores-postgres.md) | 生产首选（ACID+全文+UPDATE） |
| `knowledge/vectorstores/elasticsearch` | [Elasticsearch](12-knowledge-rag/knowledge-vectorstores-elasticsearch.md) | 关键词+向量混合检索 |
| `knowledge/vectorstores/tcvector` | [腾讯 VectorDB](12-knowledge-rag/knowledge-vectorstores-tcvector.md) | 零运维云托管 |
| `knowledge/vectorstores/milvus` | [Milvus](12-knowledge-rag/knowledge-vectorstores-milvus.md) | 十亿级专用向量库 |

#### 其它知识集成

| 示例 | 文章 | 说明 |
|------|------|------|
| `arxivsearch` | [ArXiv 搜索](12-knowledge-rag/arxivsearch.md) | 学术论文搜索 |
| `wiki` | [Wiki 搜索](12-knowledge-rag/wiki.md) | Wikipedia 搜索 |
| `weknora` | [WeKnora](12-knowledge-rag/weknora.md) | WeKnora 知识平台 |

### 13 - 模型与提供商

`model/` 目录包含 7 个可靠性/路由策略子示例。详见 [Model 索引页](13-model-provider/model.md)。

| 子示例 | 文章 | 说明 |
|--------|------|------|
| `model/retry` | [重试](13-model-provider/model-retry.md) | SDK 级 HTTP 自动重试（408/429/5xx） |
| `model/failover` | [故障转移](13-model-provider/model-failover.md) | 主备串行，仅首 chunk 前切换 |
| `model/hedge` | [对冲请求](13-model-provider/model-hedge.md) | 并行赛跑，延迟后启备份 |
| `model/switch` | [模型切换](13-model-provider/model-switch.md) | 用户驱动 SetModelByName / WithModelName |
| `model/selector` | [模型选择器](13-model-provider/model-selector.md) | 回调按 Invocation 状态选模型 |
| `model/promptmap` | [Prompt 映射](13-model-provider/model-promptmap.md) | 按当前模型自动切换系统提示 |
| `model/batch` | [批处理](13-model-provider/model-batch.md) | OpenAI Batch API 离线批量推理 |
| `provider` | [提供商](13-model-provider/provider.md) | 自定义 Provider |

### 14 - Prompt 与输出

| 示例 | 文章 | 说明 |
|------|------|------|
| `prompt` | [Prompt 管理](14-prompt-output/prompt.md) | Prompt 模板与管理 |
| `promptcache` | [Prompt 缓存](14-prompt-output/promptcache.md) | Prompt 缓存优化 |
| `placeholder` | [占位符](14-prompt-output/placeholder.md) | 动态占位符替换 |
| `structuredoutput` | [结构化输出](14-prompt-output/structuredoutput.md) | JSON Schema 输出 |
| `outputkey` | [输出 Key](14-prompt-output/outputkey.md) | 输出键提取 |
| `outputkeystate` | [输出 Key 状态](14-prompt-output/outputkeystate.md) | 输出键状态管理 |
| `outputschema` | [输出 Schema](14-prompt-output/outputschema.md) | 输出 Schema 定义 |

### 15 - 评测与进化

`evaluation/` 目录包含 19 个子示例，覆盖评测器、记录器、轨迹、集成。详见 [Evaluation 索引页](15-evaluation/evaluation.md)。

#### 评测器

| 子示例 | 文章 | 说明 |
|--------|------|------|
| `evaluation/llm` | [LLM 裁判](15-evaluation/evaluation-llm.md) | 6 个 LLM 裁判变体总览 |
| `evaluation/llmverifier` | [LLM 验证](15-evaluation/evaluation-llmverifier.md) | Best-of-N 多采样选优 |
| `evaluation/rouge` | [ROUGE](15-evaluation/evaluation-rouge.md) | 确定性字面匹配，零成本回归 |
| `evaluation/jieba` | [结巴分词](15-evaluation/evaluation-jieba.md) | 中文分词器 ROUGE |
| `evaluation/tooltrajectory` | [工具轨迹](15-evaluation/evaluation-tooltrajectory.md) | 工具调用顺序校验 |
| `evaluation/trace` | [Trace 评测](15-evaluation/evaluation-trace.md) | 预录 trace 离线评测 |
| `evaluation/contextmessage` | [上下文消息](15-evaluation/evaluation-contextmessage.md) | 注入上下文不污染 Session |

#### 记录器

| 子示例 | 文章 | 说明 |
|--------|------|------|
| `evaluation/evalsetrecorder` | [EvalSet 录制](15-evaluation/evaluation-evalsetrecorder.md) | Runner 插件录制真实流量 |
| `evaluation/inmemory` | [内存记录器](15-evaluation/evaluation-inmemory.md) | 内存用例/指标，适合单测 |
| `evaluation/local` | [本地记录器](15-evaluation/evaluation-local.md) | 本地文件存储评测骨架 |
| `evaluation/mysql` | [MySQL 记录器](15-evaluation/evaluation-mysql.md) | 全入库，多人协作 |
| `evaluation/langfuse` | [Langfuse](15-evaluation/evaluation-langfuse.md) | 远程实验，本地推理回写 |

#### 集成与编排

| 子示例 | 文章 | 说明 |
|--------|------|------|
| `evaluation/callbacks` | [回调评测](15-evaluation/evaluation-callbacks.md) | 8 个生命周期钩子的可观测性 |
| `evaluation/usersimulation` | [用户模拟](15-evaluation/evaluation-usersimulation.md) | 模拟用户驱动多轮对话 |
| `evaluation/usersimulation_expectedrunner` | [期望 Runner](15-evaluation/evaluation-usersimulation-expectedrunner.md) | 逐轮对比 expected Runner |
| `evaluation/claudecode` | [Claude Code](15-evaluation/evaluation-claudecode.md) | 评测 Claude Code 的 MCP/Skill/Subagent |
| `evaluation/skill` | [Skill 评测](15-evaluation/evaluation-skill.md) | 校验 Skills 加载+执行轨迹 |
| `evaluation/server` | [评测服务](15-evaluation/evaluation-server.md) | 评测暴露为 REST API |
| `evaluation/promptiter` | [Prompt 迭代](15-evaluation/evaluation-promptiter.md) | 评测驱动的 Prompt 自动优化 |
| `evolution` | [进化优化](15-evaluation/evolution.md) | Agent 迭代进化 |

### 16 - 可观测性

`callbacks/` 目录包含主示例 + 3 个子示例。详见 [Callbacks 索引页](16-observability/callbacks.md)。

| 子示例 | 文章 | 说明 |
|--------|------|------|
| `callbacks`（主） | [回调基础](16-observability/callbacks-basic.md) | 三层 Before/After 钩子 + 四种干预手段 |
| `callbacks/auth` | [鉴权回调](16-observability/callbacks-auth.md) | 工具级权限校验 + 审计日志 |
| `callbacks/imagetool` | [图片工具回调](16-observability/callbacks-imagetool.md) | PNG 字节转多模态消息 |
| `callbacks/timer` | [计时回调](16-observability/callbacks-timer.md) | 三级计时 + OpenTelemetry |
| `telemetry` | [遥测](16-observability/telemetry.md) | OpenTelemetry 集成 |
| `tokentracker` | [Token 追踪](16-observability/tokentracker.md) | Token 用量追踪 |

### 17 - 安全防护

| 示例 | 文章 | 说明 |
|------|------|------|
| `guardrail` | [Guardrail 防护](17-safety-guardrails/guardrail.md) | 审批/注入检测/意图检测 |
| `humaninloop` | [人机协作](17-safety-guardrails/humaninloop.md) | Human-in-the-Loop |
| `todoenforcer` | [任务强制](17-safety-guardrails/todoenforcer.md) | Todo 强制执行 |

### 18 - 搜索与外部集成

| 示例 | 文章 | 说明 |
|------|------|------|
| `duckduckgo` | [DuckDuckGo 搜索](18-search-integration/duckduckgo.md) | DuckDuckGo 搜索集成 |
| `google` | [Google 搜索](18-search-integration/google.md) | Google 搜索集成 |
| `dify` | [Dify 集成](18-search-integration/dify.md) | Dify 平台集成 |
| `n8n` | [n8n 集成](18-search-integration/n8n.md) | n8n 工作流集成 |
| `claudecode` | [Claude Code](18-search-integration/claudecode.md) | Claude Code Agent |
| `codex` | [Codex](18-search-integration/codex.md) | OpenAI Codex Agent |
| `email` | [Email](18-search-integration/email.md) | 邮件发送集成 |
| `openaiserver` | [OpenAI Server](18-search-integration/openaiserver.md) | OpenAI 兼容服务 |

### 19 - 高级特性

| 示例 | 文章 | 说明 |
|------|------|------|
| `context_compaction` | [上下文压缩](19-advanced-features/context_compaction.md) | 上下文自动压缩 |
| `context_compaction_recovery` | [压缩恢复](19-advanced-features/context_compaction_recovery.md) | 压缩后恢复 |
| `steer` | [引导控制](19-advanced-features/steer.md) | Agent 行为引导 |
| `thinking` | [思考模式](19-advanced-features/thinking.md) | Chain-of-Thought |
| `timeaware` | [时间感知](19-advanced-features/timeaware.md) | 时间感知 Agent |
| `summary` | [摘要](19-advanced-features/summary.md) | 对话摘要 |
| `tailor` | [裁剪](19-advanced-features/tailor.md) | 消息裁剪 |
| `react` | [ReAct 推理](19-advanced-features/react.md) | ReAct 推理模式 |
| `max_limits` | [限制配置](19-advanced-features/max_limits.md) | 最大限制配置 |
| `fileinput` | [文件输入](19-advanced-features/fileinput.md) | 文件输入处理 |
| `workspace_io` | [工作空间 IO](19-advanced-features/workspace_io.md) | 工作空间输入输出 |
| `builtinexplorer` | [内置浏览器](19-advanced-features/builtinexplorer.md) | 内置工具浏览器 |
| `usermessagerewriter` | [消息重写](19-advanced-features/usermessagerewriter.md) | 用户消息重写 |
| `plugin` | [插件系统](19-advanced-features/plugin.md) | 插件机制 |
| `taskrun` | [任务运行](19-advanced-features/taskrun.md) | 任务模式运行 |
| `todo` | [Todo](19-advanced-features/todo.md) | Todo 示例 |
| `artifact` | [Artifact](19-advanced-features/artifact.md) | 制品管理 |

---

## 协议服务端总览

> 本节源自原「核心组件」深度文（12-server.md），整合 Server 架构与三协议服务端设计。具体实操示例见 `09-a2a-protocol/`、`10-agui-protocol/`、`03-mcp-tools/` 下的子文章。

### Server 架构

Server 是 Agent 对外的部署入口，通过 Runner 承载 Agent，并将执行过程以 SSE 流式响应推送出去。

```
HTTP Request
    │
    ▼
Gateway Handler
    │
    ├─ 路由匹配
    ├─ 会话管理（Session Service）
    ├─ 调用 Runner.Run()
    ├─ SSE 流式推送（实时）
    └─ 错误转换与返回
```

**关键设计**：

- **Runner 承载 Agent**：Server 不直接持有 Agent，而是通过 `WithRunner(r)` 注入 Runner，由 Runner 驱动 Agent 执行。
- **SSE 流式推送**：Agent 的执行过程（文本增量、工具调用、工具结果）以 Server-Sent Events 实时推送到客户端，无需轮询。
- **会话管理**：内置 Session Service 负责多会话切换与历史维护。
- **OpenClaw 安全运行时**：在基础网关之上叠加安全控制：
  - **Allowlist**：白名单用户才能使用
  - **Mention Gating**：群聊中需要 @机器人 才回复
  - **Stable Session IDs**：跨重启的稳定会话标识
  - **Per-Session 序列化**：同一会话串行处理，避免竞态

### 三协议服务端对比

| 协议 | 适用场景 | 传输方式 | 状态管理 |
|------|---------|---------|---------|
| **AG-UI** | Agent-to-User 实时前端交互 | HTTP + SSE | 会话历史快照 + 取消 |
| **A2A** | Agent-to-Agent 跨框架互操作 | HTTP POST + SSE | Task 模型 + 任务 ID |
| **MCP** | Agent-to-Tool 工具能力暴露 | stdio / SSE / Streamable HTTP | 无状态工具调用 |

**AG-UI（Agent-User Interaction）**：基于 SSE 的实时交互协议，三大路由 `/agui/chat`、`/agui/history`、`/agui/cancel`。SSE 事件类型覆盖 `text_message_content`、`tool_call`、`tool_result`、`run_finished`，兼容 CopilotKit 与 TDesign Chat 前端。Graph 节点的 EventEmitter 事件可经 Translator 自动转换为 AG-UI 协议事件。

**A2A（Agent-to-Agent）**：Google 提出的跨框架 Agent 互操作标准。以 Task 为核心模型（task_id + message + context），通过 HTTP POST `/tasks` 发起，SSE 流式推送结果。支持跨语言互调，远程 Agent 可当作本地 Agent 使用，独立部署、强解耦。

**MCP（Model Context Protocol）**：将工具能力标准化暴露给 Agent 消费。服务端有三种传输模式：stdio（子进程通信，最简）、SSE（HTTP + 信号优雅退出）、Streamable HTTP（现代写法，struct-first + OutputSchema）。

### 协议选择建议

| 需求 | 推荐协议 | 理由 |
|------|---------|------|
| 前端实时聊天交互 | AG-UI | SSE 事件流，原生兼容 CopilotKit/TDesign |
| 跨框架/跨语言 Agent 互调 | A2A | 标准协议，独立部署，强解耦 |
| 暴露工具能力给 Agent | MCP | stdio 本地 / SSE 远程 / streamable 现代三档可选 |
| 通用 HTTP 网关部署 | Gateway | 最简部署，内置 Session + SSE |

> A2A 与 AgentTool 的取舍：A2A 走 HTTP/SSE 远程调用，跨语言、强解耦但有网络延迟；AgentTool 走进程内调用，低延迟但仅限 Go 同进程。

### 配置速查

**Server 构造选项**：

| Server 类型 | 关键配置项 | 说明 |
|------------|-----------|------|
| Gateway | `WithRunner` / `WithPort` / `WithHost` | 基础 HTTP 网关 |
| OpenClaw | `WithSessionStore` / `WithAllowlist` / `WithMentionGating` | 安全运行时 |
| AG-UI | `WithRunner` / `WithPort` / `WithPath` | AG-UI 服务 |
| A2A（客户端） | `WithA2AClient` / `WithStreaming` | 将远程 A2A Agent 当本地用 |

**生产部署清单**：

| 维度 | 生产配置 | 开发默认 |
|------|---------|---------|
| Session 持久化 | Redis / PostgreSQL | Memory |
| Memory 持久化 | Redis / PostgreSQL / PGVector | Memory |
| 可观测性 | OTel SDK → Collector → Jaeger/Prometheus | 关 |
| 安全 | ToolPermissionPolicy / MaxLLMCalls / MaxToolIterations / Allowlist / Mention Gating | 关 |
| 日志 | 结构化日志 + spanID 关联 | 标准输出 |
| 健康检查 | `/health` endpoint + 就绪探针 | 无 |
