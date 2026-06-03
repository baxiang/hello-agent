# 技能系统与 Curator：Hermes Agent 的程序性记忆引擎

> 源码版本: v0.15.1 | 核心文件: `agent/system_prompt.py`, `agent/curator.py`, `agent/skill_commands.py`, `tools/skill_usage.py`, `tools/skills_tool.py`, `agent/skill_utils.py`

## 引言

大多数 AI Agent 是无状态的——每次对话从零开始，过去的经验随风而逝。Hermes Agent 的技能系统打破了这一局限：它是 Agent 的**程序性记忆**，让 Agent 从经验中创建技能、在使用中改进技能、跨会话持久化知识。本文深入剖析技能的索引构建、条件激活、Curator 生命周期管理，以及 Skill 作者标准。

---

## 一、技能是什么

技能是 Markdown 文件（`SKILL.md`），包含 YAML frontmatter 元数据 + 自由格式的指令正文。Agent 通过 `skill_view(name)` 按需加载——技能不驻留在系统提示中，只在需要时注入对话。

```yaml
---
name: axolotl
description: Fine-tune LLMs with Axolotl framework.
platforms: [macos, linux]
metadata:
  hermes:
    tags: [fine-tuning, llm]
    related_skills: [peft, lora]
---
```

技能的目录结构遵循 agentskills.io 开放标准：

```
skills/
├── my-skill/
│   ├── SKILL.md           # 主指令（必需）
│   ├── references/        # 支撑文档
│   ├── templates/         # 模板文件
│   ├── scripts/           # 可执行脚本
│   └── assets/            # 补充资源
└── category/
    └── another-skill/
        └── SKILL.md
```

技能来源有三个层级：`skills/`（内置，按类别组织）、`optional-skills/`（可选，需显式安装）、`~/.hermes/skills/`（用户/Agent 创建）。所有来源在运行时合并为统一的技能库。

---

## 二、技能索引构建：三层缓存架构

`build_skills_system_prompt()` 负责构建技能索引并注入系统提示。这是高频调用路径——每次会话启动、上下文压缩后重建都会触发。为了将索引构建成本从 O(n) 文件系统扫描降至近乎零，Hermes 实现了三层缓存：

```
Layer 1: 进程内 LRU 缓存 (_SKILLS_PROMPT_CACHE, max 8)
    ↓ miss
Layer 2: 磁盘快照 (.skills_prompt_snapshot.json)
    ↓ miss (mtime/size manifest 不匹配)
Layer 3: 完整文件系统扫描（冷路径，扫描后写入快照）
```

### 2.1 Layer 1：进程内 LRU

`_SKILLS_PROMPT_CACHE` 是一个以 `(frozenset(available_tools), frozenset(available_toolsets))` 为键的 LRU 字典，最多保留 8 条。命中时直接返回已构建的提示字符串，零 I/O 开销。

### 2.2 Layer 2：磁盘快照与 Manifest 验证

快照文件 `.skills_prompt_snapshot.json` 存储两样东西：构建好的提示字符串，以及一份文件 manifest（每个 SKILL.md/DESCRIPTION.md 的 `mtime_ns + st_size`）。

验证逻辑：

```python
for path, expected_mtime, expected_size in manifest:
    stat = path.stat()
    if stat.st_mtime_ns != expected_mtime or stat.st_size != expected_size:
        return None  # manifest 不匹配，降级到 Layer 3
```

选择 `mtime_ns`（纳秒精度）而非 `mtime`（秒精度）是为了避免 1 秒窗口内的竞态——连续两次快速编辑可能在同一秒内发生，纳秒精度消除了这个盲区。`st_size` 作为辅助验证，捕捉 `mtime_ns` 在极端情况下未变但内容已更新的场景。

### 2.3 Layer 3：冷路径与快照写入

当 Layer 2 验证失败时，执行完整的文件系统扫描。扫描完成后，将构建好的提示 + 新的 manifest 原子写入快照文件（tempfile + os.replace），确保下次启动能命中 Layer 2。

### 2.4 外部技能目录支持

`skills.external_dirs` 配置项允许用户在 `config.yaml` 中声明额外的技能目录：

```yaml
skills:
  external_dirs:
    - ~/my-team-skills
    - /opt/shared-skills
```

`get_external_skills_dirs()` 读取并验证这些路径——展开 `~` 和 `${VAR}`、解析为绝对路径、跳过不存在的目录和与本地 `~/.hermes/skills/` 重复的路径。结果以 `(config_path, mtime_ns)` 为键缓存在进程内，因为每次技能分类查找都调用此函数，而 YAML 解析一个 15KB 的配置文件约需 85ms，缓存后降至约 2μs。

### 2.5 禁用技能过滤与平台门控

索引构建时依次过滤：

1. **禁用技能**：`config.yaml` 中的 `skills.disabled`（全局）和 `skills.platform_disabled.<platform>`（按消息平台）排除列表
2. **平台门控**：frontmatter 中的 `platforms` 字段限定技能的操作系统兼容性

平台匹配逻辑在 `agent/skill_utils.py` 中实现，支持 macOS、Linux、Windows 三种标识，并特殊处理 Termux（Android 上的 Linux 用户态）——`sys.platform` 在 Python 3.13+ 下返回 `"android"` 而非 `"linux"`，但 Termux 本质上运行 Linux 用户态，所以 `platforms: [linux]` 的技能在 Termux 上仍可使用。

---

## 三、条件激活系统

技能不是全量暴露的。Hermes 实现了一套基于 frontmatter 的条件激活机制，让技能根据运行时环境动态显隐：

### 3.1 fallback_for_toolsets：降级技能

```yaml
metadata:
  hermes:
    fallback_for_toolsets: ["browser"]
```

含义：当 `browser` 工具集可用时，此技能**隐藏**；当 `browser` 不可用时，此技能作为降级方案**显示**。典型用例：一个纯命令行的网页搜索技能，在有浏览器工具时无需暴露。

### 3.2 requires_tools：工具依赖

```yaml
metadata:
  hermes:
    requires_tools: ["terminal"]
```

含义：当 `terminal` 工具不可用时，此技能**隐藏**。技能的指令假设了某些工具的存在，缺少这些工具时加载技能只会误导模型。

### 3.3 requires_toolsets：工具集依赖

```yaml
metadata:
  hermes:
    requires_toolsets: ["docker"]
```

与 `requires_tools` 类似，但以工具集为粒度。当 `docker` 工具集中的所有工具都不可用时，此技能隐藏。

条件提取在 `extract_skill_conditions()` 中统一完成，索引构建时根据当前会话的 `available_tools` 和 `available_toolsets` 逐一评估。

---

## 四、系统提示词中的技能注入

### 4.1 紧凑索引格式

技能以 `<available_skills>` XML 标签注入系统提示的 **stable 层**，格式极简：

```
<available_skills>
  - axolotl: Fine-tune LLMs with Axolotl framework.
  - pr-triage: Triage and review pull requests.
  - docker-debug: Debug Docker containers and images.
</available_skills>
```

每行一个技能，冒号分隔名称和描述。描述截断至 60 字符（`extract_skill_description()` 的上限），确保索引的 token 开销最小。模型看到索引后，通过 `skill_view(name)` 按需加载完整指令——这是**渐进式披露**架构的核心：元数据常驻，完整内容按需加载。

### 4.2 技能内容作为用户消息注入

当模型调用 `skill_view(name)` 时，返回的技能内容**不注入系统提示**，而是作为**用户消息**追加到对话历史中。这个设计决策至关重要：

- **保护 Prompt Cache**：系统提示在整个会话中保持不变，避免因技能加载导致的缓存失效
- **语义准确**：技能是 Agent 的参考文档而非身份指令，放在用户消息中更符合其语义角色

`build_skill_invocation_message()` 构建注入消息，格式为：

```
[IMPORTANT: The user has invoked the "axolotl" skill, indicating they want
you to follow its instructions. The full skill content is loaded below.]

<SKILL.md 完整内容>

[Skill directory: /home/user/.hermes/skills/axolotl]
[This skill has supporting files:]
- references/dataset-formats.md  ->  /home/user/.hermes/skills/axolotl/references/dataset-formats.md
```


---

## 五、Curator 后台维护系统 (agent/curator.py)

Curator 是 Hermes 最独特的子系统——一个后台自动维护技能集合的"图书管理员"。它不是 cron 守护进程，而是**空闲触发**的：当 Agent 空闲且距离上次 Curator 运行超过 `interval_hours`（默认 168 小时/7 天）时，自动启动一轮审查。

### 5.1 生命周期状态机

每个 Agent 创建的技能经历三个状态：

```
active ──(30 天未使用)──→ stale ──(90 天未使用)──→ archived
   ↑                        │
   └──(重新被使用)──────────┘
```

状态转换规则：
- **active → stale**：最近活动时间超过 `stale_after_days`（默认 30 天）
- **stale → archived**：最近活动时间超过 `archive_after_days`（默认 90 天）
- **stale → active**：被标记为 stale 的技能被重新使用，自动复活
- **pinned 技能豁免**：所有自动转换

活动时间由 `tools/skill_usage.py` 的 sidecar 文件 `.usage.json` 追踪，取 `last_used_at`、`last_viewed_at`、`last_patched_at` 中的最大值。`created_at` 不算活动——新建但从未使用的技能不应因"太老"而被归档，所以状态转换代码以 `last_activity_at` 为主锚点，`created_at` 为备选。

### 5.2 严格不变量

Curator 遵守四条铁律：

1. **只触碰 Agent 创建的技能**：通过 `created_by: "agent"` 标记判断来源。内置技能和 Hub 安装的技能由上游维护，Curator 不碰
2. **永不删除，只归档**：归档 = 移动到 `~/.hermes/skills/.archive/`，可通过 `restore` 命令恢复
3. **Pinned 技能豁免**：`pinned: true` 的技能跳过所有自动转换
4. **使用辅助客户端**：Curator 的 LLM 审查通过 `auxiliary_client` 运行，绝不触碰主会话的 Prompt Cache

来源判断逻辑：

```python
def is_agent_created(skill_name: str) -> bool:
    off_limits = _read_bundled_manifest_names() | _read_hub_installed_names()
    return skill_name not in off_limits
```

`_read_bundled_manifest_names()` 读取 `.bundled_manifest`（格式：`name:hash` 每行），`_read_hub_installed_names()` 读取 `.hub/lock.json`——两者合并为"不可触碰"集合。

### 5.3 空闲触发调度

`should_run_now()` 实现调度门控：

```python
def should_run_now(now=None) -> bool:
    if not is_enabled(): return False
    if is_paused(): return False
    state = load_state()
    last = _parse_iso(state.get("last_run_at"))
    if last is None:
        # 首次运行：播种 last_run_at 为 now，推迟一个完整间隔
        state["last_run_at"] = now.isoformat()
        save_state(state)
        return False
    interval = timedelta(hours=get_interval_hours())
    return (now - last) >= interval
```

**首次运行策略**：新安装或从未运行过 Curator 的系统，不会立即执行审查——而是将 `last_run_at` 播种为当前时间，推迟一个完整间隔后才运行。这避免了 `hermes update` 后的首次后台 tick 就自动修改技能库。用户可通过 `hermes curator run --dry-run` 预览。

空闲检查（`min_idle_hours`，默认 2 小时）在调用站点执行，而非 `should_run_now()` 内部——因为调用站点才知道 Agent 是否正在活跃运行。

### 5.4 .curator_state 持久化

状态文件位于 `~/.hermes/skills/.curator_state`，采用原子写入（tempfile + os.replace + fsync）：

```python
def save_state(data):
    fd, tmp = tempfile.mkstemp(dir=str(path.parent), ...)
    with os.fdopen(fd, "w") as f:
        json.dump(data, f, indent=2, sort_keys=True)
        f.flush()
        os.fsync(f.fileno())
    os.replace(tmp, path)
```

存储的字段：`last_run_at`、`last_run_duration_seconds`、`last_run_summary`、`paused`、`run_count` 等。

### 5.5 LLM 审查：伞形合并策略

Curator 的 LLM 审查不是简单的"删除不活跃技能"，而是一套**伞形合并**（umbrella consolidation）策略。核心思想：技能库的目标是**类级指令集合**，而非数百个只记录单次会话具体 bug 的窄技能。

审查提示词（`CURATOR_REVIEW_PROMPT`）要求 LLM：

1. **扫描前缀集群**：识别共享首个单词或领域关键词的技能组（如 `hermes-config-*`、`gateway-*`、`mcp-*`）
2. **判断伞形类**：对每个 2+ 成员的集群，判断"人类维护者会写一个技能还是 N 个？"
3. **选择合并方式**：
   - **合并到已有伞形**：补丁扩展现有技能，添加标记子节
   - **创建新伞形**：`skill_manage(action=create)` 新建类级技能
   - **降级为支撑文件**：将窄技能移入伞形的 `references/`、`templates/` 或 `scripts/`

合并分类采用三层信号仲裁：

1. **模型声明**（最权威）：`skill_manage(action=delete)` 时的 `absorbed_into=<umbrella>` 参数
2. **结构化 YAML 块**：模型最终响应中的 `consolidations` / `prunings` 列表
3. **工具调用启发式**：扫描 `skill_manage` 调用中目标技能引用了被归档技能名称的证据

### 5.6 报告与 Cron 引用迁移

每次 Curator 运行生成报告到 `~/.hermes/logs/curator/{YYYYMMDD-HHMMSS}/`，包含 `run.json`（机器可读）和 `REPORT.md`（人类可读）。

关键细节：当技能 X 被合并到伞形 Y 时，Curator 会自动**重写 Cron 任务的技能引用**——否则引用 X 的定时任务会在运行时找不到技能。`cron.jobs.rewrite_skill_refs()` 将 `consolidated_map` 中的旧名称替换为新名称。

### 5.7 Curator CLI 命令

| 命令 | 用途 |
|------|------|
| `hermes curator status` | 查看状态、上次运行摘要、技能统计 |
| `hermes curator run` | 立即执行一轮审查（含 LLM 合并） |
| `hermes curator run --dry-run` | 预览模式：读取但不修改技能库 |
| `hermes curator pause` | 暂停自动调度 |
| `hermes curator resume` | 恢复自动调度 |
| `hermes curator pin <name>` | 固定技能，豁免所有自动转换 |
| `hermes curator unpin <name>` | 取消固定 |
| `hermes curator archive <name>` | 手动归档 |
| `hermes curator restore <name>` | 从 .archive/ 恢复 |
| `hermes curator prune` | 清理过期的 .curator_state 历史 |
| `hermes curator backup` | 备份技能库 |
| `hermes curator rollback` | 回滚到上次备份 |

---

## 六、使用量追踪 Sidecar (tools/skill_usage.py)

技能使用量数据存储在 `~/.hermes/skills/.usage.json` 中，与 SKILL.md 分离。这是有意为之的设计决策：

- **Sidecar 而非 frontmatter**：将运行遥测数据与用户创作内容分离，避免对内置/Hub 技能的 frontmatter 产生写入冲突
- **原子写入**：tempfile + os.replace + fsync，与 `.curator_state` 同一模式
- **跨进程文件锁**：使用 `fcntl.flock`（Unix）或 `msvcrt.locking`（Windows）序列化 read-modify-write 周期

每条记录结构：

```python
{
    "created_by": "agent",
    "use_count": 5,
    "view_count": 12,
    "patch_count": 2,
    "last_used_at": "2026-05-29T10:30:00+00:00",
    "last_viewed_at": "2026-05-28T14:00:00+00:00",
    "last_patched_at": "2026-05-20T09:00:00+00:00",
    "created_at": "2026-05-01T08:00:00+00:00",
    "state": "active",
    "pinned": false,
    "archived_at": null
}
```

计数器通过 `bump_view()`、`bump_use()`、`bump_patch()` 递增，均通过 `_mutate()` 统一执行——加载、修改、原子保存。所有写操作都是 best-effort：失败时 DEBUG 级别日志，绝不阻断上层工具调用。

归档与恢复通过 `archive_skill()` / `restore_skill()` 实现。归档将技能目录移入 `.archive/`（扁平化，不保留原始分类嵌套），恢复时检查名称冲突——如果同名技能已被内置或 Hub 安装，拒绝恢复以避免遮蔽上游版本。

---

## 七、Skill 作者标准

Hermes 对技能的格式和质量有严格标准，确保技能在索引、加载和执行各环节的一致性。

### 7.1 Frontmatter 规范

| 字段 | 要求 | 说明 |
|------|------|------|
| `name` | <= 64 字符 | 技能唯一标识 |
| `description` | <= 60 字符，一句话，句号结尾 | 索引中的显示文本 |
| `platforms` | 可选 | `[macos]`, `[macos, linux]` 等，缺省则全平台 |
| `metadata.hermes.tags` | 可选 | 发现性标签 |
| `metadata.hermes.related_skills` | 可选 | 关联技能 |
| `metadata.hermes.fallback_for_toolsets` | 可选 | 降级激活条件 |
| `metadata.hermes.requires_tools` | 可选 | 工具依赖 |
| `metadata.hermes.requires_toolsets` | 可选 | 工具集依赖 |

**工具引用规则**：正文中引用的工具必须是 Hermes 原生工具（如 `terminal`、`write_file`），不能假设第三方 CLI 已安装。

**平台门控审计**：`platforms` 字段应与脚本实际导入对齐——声明 `platforms: [macos]` 的技能，其 `scripts/` 下的脚本必须真的只在 macOS 上运行。

**作者署名**：`author` 字段优先列出人类贡献者，而非 Agent。

### 7.2 SKILL.md 正文结构

现代技能遵循以下节顺序：

```markdown
# Title

简短介绍（1-2 段）

## When to Use

触发场景描述

## Prerequisites

前置条件（环境变量、工具依赖）

## How to Run

执行步骤

## Quick Reference

常用命令/参数速查

## Procedure

完整操作流程

## Pitfalls

已知陷阱和避坑指南

## Verification

验证结果的方法
```

### 7.3 支撑文件组织

```
my-skill/
├── SKILL.md
├── references/       # 会话特定细节、API 文档摘录、领域笔记
│   └── api-design.md
├── templates/        # 可复制修改的启动文件
│   └── config.yaml
├── scripts/          # 可静态重运行的动作（验证脚本、探测脚本）
│   └── verify.sh
└── assets/           # 补充资源
```

### 7.4 测试要求

技能测试位于 `tests/skills/test_<skill>_skill.py`，验证：
- Frontmatter 解析正确性
- 条件激活逻辑
- 支撑文件引用完整性
- 平台门控行为

---

## 八、Skills Hub：agentskills.io 开放标准市场

Skills Hub (`agentskills.io`) 是 Hermes 的技能分发平台，定义了一套开放标准：

- **安装**：`hermes skills install <name>`，安装到 `~/.hermes/skills/.hub/`
- **锁文件**：`.hub/lock.json` 追踪已安装技能的来源、版本和路径
- **卸载**：`hermes skills uninstall <name>`，移除锁文件条目和技能目录
- **来源隔离**：Hub 安装的技能标记在 `.hub/` 命名空间下，Curator 不会触碰

这套机制确保了内置技能、Hub 技能和 Agent 创建的技能三者和平共处，各自由不同的维护流程管理，互不干扰。

---

## 九、关键设计模式总结

| 模式 | 实现 | 解决的问题 |
|------|------|-----------|
| 三层缓存 | LRU + 磁盘快照 + 文件扫描 | 索引构建性能 |
| 渐进式披露 | 索引常驻 + 内容按需加载 | Token 开销控制 |
| 条件激活 | fallback/requires 声明 | 避免暴露不适用的技能 |
| 用户消息注入 | 技能内容不进系统提示 | 保护 Prompt Cache |
| Sidecar 遥测 | .usage.json 与 SKILL.md 分离 | 避免遥测数据与创作内容冲突 |
| 伞形合并 | Curator LLM 审查 + 三层信号仲裁 | 防止技能库碎片化 |
| 永不删除 | 只归档到 .archive/ | 数据安全 |
| 原子写入 | tempfile + os.replace + fsync | 防止状态文件损坏 |
| 来源隔离 | bundled/hub/agent 三级来源 | 防止 Curator 误操作上游技能 |
| 空闲触发 | 非 cron 守护进程 | 不干扰活跃会话 |
| 平台门控 | platforms frontmatter | 避免加载不兼容的技能 |

---

## 十、参考资料

- 源码: https://github.com/NousResearch/hermes-agent (v0.15.1)
- Skills Hub: https://agentskills.io
- agentskills.io 标准: https://agentskills.io/spec
- 核心文件: `agent/system_prompt.py`, `agent/curator.py`, `agent/skill_commands.py`, `tools/skill_usage.py`, `tools/skills_tool.py`, `agent/skill_utils.py`
