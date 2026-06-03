# Hermes Agent 研究

> 来源: https://github.com/NousResearch/hermes-agent
> 许可: MIT
> 语言: Python (核心) + TypeScript (TUI)
> 版本: v0.15.1 (截至 2026-05-29)
> Star: 172k+ | Fork: 29k+

## 项目简介

Hermes Agent 是由 Nous Research 开发的**自我改进型 AI Agent**。它的核心卖点：

- **闭环学习**：从经验中创建技能、使用中改进技能、自我推动持久化知识、搜索历史对话、跨会话构建用户模型
- **多平台接入**：CLI、Telegram、Discord、Slack、WhatsApp、Signal 等
- **多模型支持**：OpenAI、Anthropic、OpenRouter (200+ 模型)、NVIDIA、HuggingFace 等
- **可运行在任何地方**：$5 VPS、GPU 集群、或近乎零成本的 Serverless 基础设施

---

## 核心架构

### 目录结构

```
hermes-agent/
├── agent/               # Agent 核心逻辑 (从 run_agent.py 提取)
│   ├── conversation_loop.py    # 对话循环
│   ├── prompt_builder.py       # Prompt 组装
│   ├── system_prompt.py        # 系统提示词
│   ├── context_compressor.py   # 上下文压缩
│   ├── memory_manager.py       # 记忆管理
│   ├── memory_provider.py      # 记忆提供者 ABC
│   ├── skill_commands.py       # 技能命令系统
│   ├── tool_executor.py        # 工具执行器
│   ├── tool_guardrails.py      # 工具护栏
│   ├── delegate_tool.py 相关   # 子代理委派
│   ├── curator.py              # 技能生命周期管理
│   ├── auxiliary_client.py     # 辅助 LLM 任务客户端
│   └── ... (60+ 模块)
├── tools/               # 40+ 内置工具
│   ├── registry.py             # 工具注册中心
│   ├── terminal_tool.py        # 终端执行
│   ├── file_tools.py           # 文件操作
│   ├── web_tools.py            # Web 搜索/提取
│   ├── browser_tool.py         # 浏览器自动化
│   ├── delegate_tool.py        # 子代理委派
│   ├── mcp_tool.py             # MCP 协议集成
│   ├── vision_tools.py         # 视觉分析
│   ├── code_execution_tool.py  # 代码执行
│   └── ...
├── gateway/             # 消息网关 (Telegram, Discord, Slack...)
│   ├── run.py                  # 网关主循环
│   ├── config.py               # 网关配置
│   └── platforms/              # 各平台适配器
├── plugins/             # 插件系统
│   ├── memory/                 # 记忆后端 (honcho, mem0, supermemory...)
│   ├── model-providers/        # 模型提供者
│   ├── context_engine/         # 上下文引擎
│   ├── image_gen/              # 图像生成
│   ├── kanban/                 # 看板多代理系统
│   └── ...
├── skills/              # 内置技能 (按类别组织)
├── optional-skills/     # 可选技能 (较重/小众)
├── hermes_cli/          # CLI 框架
│   ├── commands.py              # 命令注册中心
│   ├── config.py                # 配置管理
│   ├── skin_engine.py           # 皮肤/主题系统
│   ├── plugins.py               # 插件管理器
│   └── ...
├── ui-tui/              # Ink (React) 终端 UI
├── tui_gateway/         # TUI 的 Python JSON-RPC 后端
├── acp_adapter/         # ACP 服务器 (IDE 集成)
├── cron/                # 定时任务调度器
├── providers/           # 模型提供者 (遗留路径)
├── run_agent.py         # AIAgent 主类 (~3600行)
├── cli.py               # 经典 CLI 入口
├── model_tools.py       # 工具发现 + schema 收集
└── toolsets.py          # 工具集定义
```

### Agent 循环 (核心)

```python
# run_agent.py 中的核心循环
while (api_call_count < self.max_iterations and self.iteration_budget.remaining > 0) \
        or self._budget_grace_call:
    if self._interrupt_requested: break
    
    response = client.chat.completions.create(
        model=model, 
        messages=messages, 
        tools=tool_schemas
    )
    
    if response.tool_calls:
        for tool_call in response.tool_calls:
            result = handle_function_call(tool_call.name, tool_call.args, task_id)
            messages.append(tool_result_message(result))
        api_call_count += 1
    else:
        return response.content
```

关键特性：
- 完全**同步**循环，支持中断检查和预算追踪
- 支持 `_budget_grace_call`：预算耗尽后的最后一次调用
- 消息格式遵循 OpenAI 标准：`{"role": "system/user/assistant/tool", ...}`

### AIAgent 类

```python
class AIAgent:
    def __init__(self,
        base_url, api_key, provider, api_mode, model,
        max_iterations=90,        # 工具调用迭代上限
        enabled_toolsets, disabled_toolsets,
        platform, session_id,
        credential_pool,          # 凭据池
        # ... ~60 个参数
    ): ...
    
    def chat(self, message: str) -> str:
        """简单接口 — 返回最终响应"""
    
    def run_conversation(self, user_message, system_message, 
                         conversation_history, task_id) -> dict:
        """完整接口 — 返回 dict 含 final_response + messages"""
```

---

## 关键设计模式

### 1. 工具注册模式 (Registry Pattern)

```python
# tools/registry.py — 零依赖，所有工具文件导入
from tools.registry import registry

def example_tool(param: str, task_id: str = None) -> str:
    return json.dumps({"success": True, "data": "..."})

registry.register(
    name="example_tool",
    toolset="example",
    schema={"name": "example_tool", "description": "...", "parameters": {...}},
    handler=lambda args, **kw: example_tool(param=args.get("param", "")),
    check_fn=check_requirements,     # 可用性检查
    requires_env=["EXAMPLE_API_KEY"], # 环境变量依赖
)
```

**自动发现**：任何 `tools/*.py` 中顶层 `registry.register()` 调用自动被导入。
**工具集隔离**：注册 ≠ 暴露。工具必须在 `toolsets.py` 中被显式分配到工具集才会暴露给 Agent。

### 2. 插件系统 (Plugin System)

两种插件面：

**通用插件** (`hermes_cli/plugins.py`):
- 生命周期钩子：`pre_tool_call`, `post_tool_call`, `pre_llm_call`, `post_llm_call`, `on_session_start`, `on_session_end`
- 注册工具：`ctx.register_tool(...)`
- 注册 CLI 子命令：`ctx.register_cli_command(...)`

**记忆提供者插件** (`plugins/memory/<name>/`):
- 实现 `MemoryProvider` ABC
- 生命周期：`sync_turn()`, `prefetch()`, `shutdown()`, `post_setup()`
- 当前内置：honcho, mem0, supermemory, byterover, hindsight 等

**核心原则**：插件**不得**修改核心文件。需要新能力时扩展通用插件表面。

### 3. 技能系统 (Skills System)

技能是 Hermes 最独特的特性——**程序性记忆**：

- `skills/` — 内置技能，按类别组织 (github, mlops, creative, research...)
- `optional-skills/` — 可选技能，需显式安装
- `~/.hermes/skills/` — 用户/Agent 创建的技能
- **Skill Hub** (`agentskills.io`) — 开放标准技能市场
- **Curator** — 后台自动管理技能生命周期（使用追踪、归档过期技能）

### 4. 委派模式 (Delegation)

```python
# delegate_task 支持两种形态：
# 1. 单任务：传 goal + context + toolsets
# 2. 批量并行：传 tasks: [...]，每个任务独立子代理并发执行

# 角色体系：
# - role="leaf" (默认) — 聚焦工作器，不能调用 delegate_task/clarify/memory 等
# - role="orchestrator" — 保留 delegate_task，可继续生成子代理
#   受 max_spawn_depth=2 限制
```

### 5. 上下文压缩 (Context Compression)

- 对话过长时自动压缩上下文
- Prompt 缓存感知：不中途改变工具集/系统提示
- 压缩是**唯一**允许改变上下文的时刻

### 6. 多配置面 (Configuration)

三种配置加载器：

| 加载器 | 使用场景 | 位置 |
|--------|---------|------|
| `load_cli_config()` | CLI 模式 | `cli.py` |
| `load_config()` | 大部分 CLI 子命令 | `hermes_cli/config.py` |
| 直接 YAML 加载 | 网关运行时 | `gateway/run.py` |

### 7. Profile 多实例

```python
# 核心机制：_apply_profile_override() 在模块导入前设置 HERMES_HOME
from hermes_constants import get_hermes_home, display_hermes_home

# 所有路径必须使用 get_hermes_home()，不能硬编码 ~/.hermes
config_path = get_hermes_home() / "config.yaml"
```

---

## 技术栈分析

### 后端 (Python)
- **核心依赖**：openai, httpx, pydantic, rich, prompt_toolkit, jinja2, tenacity
- **模型接入**：OpenAI SDK (统一接口)，各提供商插件
- **终端 UI**：prompt_toolkit (经典 CLI) + Ink/React (现代 TUI)
- **测试**：pytest + 子进程隔离插件 (~17k 测试，~900 文件)

### 前端 (TypeScript/React)
- **TUI**：Ink (React for CLI) + stdio JSON-RPC 通信 Python 后端
- **Dashboard**：xterm.js 嵌入真实 TUI，非重写

### 基础设施
- **部署**：Docker, SSH, Modal (Serverless), Daytona (Serverless), Singularity
- **消息网关**：Telegram, Discord, Slack, WhatsApp, Signal, Matrix, 企业微信等
- **定时任务**：内置 cron 调度器，支持自然语言定义

---

## 依赖安全策略

Hermes 对依赖安全极其严格（经历了 litellm 供应链攻击和 Mini Shai-Hulud 蠕虫事件后）：

| 来源 | 策略 | 示例 |
|------|------|------|
| PyPI 包 | `>=floor,<next_major` | `"httpx>=0.28.1,<1"` |
| Git URL | 提交 SHA | `git+https://...@<40-char-sha>` |
| GitHub Actions | 提交 SHA + 注释 | `uses: actions/checkout@<sha> # v4` |
| CI-only pip | `==exact` | `pyyaml==6.0.2` |

核心依赖使用**精确锁定** (`==X.Y.Z`)，非核心使用范围锁定但有上限。

---

## 值得学习的设计决策

### 1. 工具注册与工具集分离
注册（发现）和暴露（激活）是两个独立步骤，防止不必要的能力泄露给模型。

### 2. 插件不得修改核心
通过扩展插件表面而非硬编码插件逻辑到核心，保持核心简洁。

### 3. Prompt 缓存完整性
对话中不修改工具集/系统提示，避免破坏缓存导致成本飙升。

### 4. 子进程测试隔离
每个测试在独立 Python 子进程中运行，消除状态泄漏。

### 5. 技能生命周期管理 (Curator)
自动追踪技能使用频率，归档不活跃技能，但永不删除。

### 6. 委派深度限制
`max_spawn_depth=2` 防止无限递归生成子代理。

### 7. 凭据池 (Credential Pool)
支持多 API Key 轮换，避免单一 Key 速率限制。

### 8. 辅助客户端 (Auxiliary Client)
每项辅助任务（标题生成、视觉分析、嵌入等）可独立配置模型/提供商/参数。

---

## 与其他 Agent 框架对比

| 特性 | Hermes Agent | Claude Code | OpenAI Codex | OpenCode |
|------|-------------|-------------|-------------|---------|
| 自我改进/学习 | ✅ 技能系统 + Curator | ❌ | ❌ | ❌ |
| 多平台消息 | ✅ 6+ 平台 | ❌ CLI only | ❌ CLI only | ❌ CLI only |
| 多模型支持 | ✅ 任意模型 | ❌ Claude only | ❌ OpenAI only | ✅ 多模型 |
| 子代理委派 | ✅ 并行批处理 | ✅ | ✅ | ✅ |
| 技能市场 | ✅ agentskills.io | ❌ | ❌ | ❌ |
| 定时任务 | ✅ 内置 Cron | ❌ | ❌ | ❌ |
| 插件系统 | ✅ 完整 | ❌ | ❌ | ✅ MCP |
| 记忆系统 | ✅ 多后端 | ❌ | ❌ | ❌ |
| TUI | ✅ Ink + 经典 | ✅ | ✅ | ✅ |
| 开源 | ✅ MIT | ❌ | ❌ | ✅ |

---

## 快速上手

```bash
# 安装
curl -fsSL https://raw.githubusercontent.com/NousResearch/hermes-agent/main/scripts/install.sh | bash

# 从源码
git clone https://github.com/NousResearch/hermes-agent.git
cd hermes-agent
./setup-hermes.sh

# 使用
hermes                    # 开始对话
hermes model              # 选择模型
hermes tools              # 配置工具
hermes gateway            # 启动消息网关
hermes setup --portal     # 使用 Nous Portal (一站式配置)
```

---

## 参考资源

- 官方文档: https://hermes-agent.nousresearch.com/docs/
- GitHub: https://github.com/NousResearch/hermes-agent
- Skills Hub: https://agentskills.io
- Discord: https://discord.gg/NousResearch
