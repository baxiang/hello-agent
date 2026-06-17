# tRPC-Agent-Go 示例教程

> 基于 [tRPC-Agent-Go](https://github.com/trpc-group/trpc-agent-go) 框架 examples 目录的完整教学系列，面向熟悉 Go 语言、对 AI Agent 有基本了解的中级开发者。

## 目录

### 01 - Agent 基础

| 示例 | 文章 | 说明 |
|------|------|------|
| `llmagent` | [LLM Agent 入门](01-agent-basics/llmagent.md) | 最小可运行的 LLM Agent |
| `customagent` | [自定义 Agent](01-agent-basics/customagent.md) | 实现 Agent 接口 |
| `debugagent` | [调试 Agent](01-agent-basics/debugagent.md) | Agent 调试技巧 |
| `runner` | [Runner 运行器](01-agent-basics/runner.md) | Runner 的配置与使用 |
| `managedrunner` | [托管 Runner](01-agent-basics/managedrunner.md) | ManagedRunner 模式 |
| `cancelrun` | [取消运行](01-agent-basics/cancelrun.md) | Context 取消与优雅退出 |
| `runwithmessages` | [消息运行](01-agent-basics/runwithmessages.md) | 带历史消息运行 |
| `ralphloop` | [Ralph 循环](01-agent-basics/ralphloop.md) | RALPH 交互循环 |

### 02 - 工具系统

| 示例 | 文章 | 说明 |
|------|------|------|
| `tool` | [工具基础](02-tool-system/tool.md) | Function Tool 的创建与使用 |
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

| 示例 | 文章 | 说明 |
|------|------|------|
| `mcptool` | [MCP 工具集成](03-mcp-tools/mcptool.md) | MCP 协议工具接入 |
| `mcpbroker` | [MCP Broker](03-mcp-tools/mcpbroker.md) | MCP 工具代理 |

### 04 - Graph 工作流

| 示例 | 文章 | 说明 |
|------|------|------|
| `graph` | [Graph 工作流](04-graph-workflow/graph.md) | StateGraph 图工作流引擎 |

### 05 - 多 Agent 协作

| 示例 | 文章 | 说明 |
|------|------|------|
| `multiagent` | [多 Agent 编排](05-multi-agent/multiagent.md) | Chain/Parallel/Cycle 模式 |
| `team` | [Team 协作](05-multi-agent/team.md) | Coordinator/Swarm 团队模式 |
| `transfer` | [Agent 转移](05-multi-agent/transfer.md) | Agent 间任务转移 |

### 06 - Memory 系统

| 示例 | 文章 | 说明 |
|------|------|------|
| `memory` | [Memory 系统](06-memory-system/memory.md) | 持久化记忆系统 |

### 07 - Session 管理

| 示例 | 文章 | 说明 |
|------|------|------|
| `session` | [Session 管理](07-session-management/session.md) | 多后端 Session 管理 |

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

| 示例 | 文章 | 说明 |
|------|------|------|
| `knowledge` | [知识库](12-knowledge-rag/knowledge.md) | RAG 知识检索 |
| `arxivsearch` | [ArXiv 搜索](12-knowledge-rag/arxivsearch.md) | 学术论文搜索 |
| `wiki` | [Wiki 搜索](12-knowledge-rag/wiki.md) | Wikipedia 搜索 |
| `weknora` | [WeKnora](12-knowledge-rag/weknora.md) | WeKnora 知识平台 |

### 13 - 模型与提供商

| 示例 | 文章 | 说明 |
|------|------|------|
| `model` | [模型配置](13-model-provider/model.md) | 模型选择与配置 |
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

| 示例 | 文章 | 说明 |
|------|------|------|
| `evaluation` | [评测系统](15-evaluation/evaluation.md) | Agent 质量评测 |
| `evolution` | [进化优化](15-evaluation/evolution.md) | Agent 迭代进化 |

### 16 - 可观测性

| 示例 | 文章 | 说明 |
|------|------|------|
| `telemetry` | [遥测](16-observability/telemetry.md) | OpenTelemetry 集成 |
| `tokentracker` | [Token 追踪](16-observability/tokentracker.md) | Token 用量追踪 |
| `callbacks` | [回调系统](16-observability/callbacks.md) | Agent/Model/Tool 回调 |

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
