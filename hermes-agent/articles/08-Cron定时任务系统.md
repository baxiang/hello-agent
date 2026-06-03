# Cron 定时任务系统：Hermes Agent 的无人值守调度引擎

> **项目**: [NousResearch/hermes-agent](https://github.com/NousResearch/hermes-agent) v0.15.1
> **核心文件**: `cron/scheduler.py` · `cron/jobs.py` · `tools/cronjob_tools.py`
> **关键词**: Cron Scheduler · File Lock · Prompt Injection · Multi-Platform Delivery · no_agent Watchdog

---

## 引言：为什么 Agent 需要自己的调度器

传统 cron 调度系统（Linux crontab、systemd timer）只关心"何时触发"，不关心"触发后发生什么"——它们不知道 Agent 的工具集、技能上下文、交付目标。Hermes Agent 的 cron 系统填补了这一鸿沟：它不仅管理调度时间，还管理 **Agent 的完整执行环境**——从技能加载到提示注入扫描，从多平台投递到跨 Job 链式上下文。

更关键的是，cron 作业是**无人值守运行**的。没有用户在另一端等待回复，没有交互式澄清的机会，Agent 必须自主决策。这带来了独特的安全和韧性挑战，而 Hermes 的设计正是围绕这些挑战展开的。

---

## 一、调度器（Scheduler）：tick() 循环与文件锁

### 1.1 调用时机

```python
# gateway/run.py 中的后台线程，每 60 秒调用一次
def tick(verbose: bool = True, adapters=None, loop=None) -> int:
    """Check and run all due jobs. Returns number of jobs executed."""
```

Gateway 启动后，在一个后台线程中以 60 秒为周期调用 `tick()`。这不是异步调度，而是**轮询模型**——每次 tick 检查 `jobs.json` 中所有到期作业。

### 1.2 跨进程文件锁

当 Gateway 作为系统服务运行，同时用户手动执行 `hermes tick` 时，两个进程可能同时尝试调度。Hermes 使用**文件锁**防止重复 tick：

```python
lock_dir, lock_file = _get_lock_paths()  # ~/.hermes/cron/.tick.lock
lock_dir.mkdir(parents=True, exist_ok=True)

lock_fd = open(lock_file, "w", encoding="utf-8")
if fcntl:
    fcntl.flock(lock_fd, fcntl.LOCK_EX | fcntl.LOCK_NB)  # Unix
elif msvcrt:
    msvcrt.locking(lock_fd.fileno(), msvcrt.LK_NBLCK, 1)  # Windows
```

- **Unix**：`fcntl.LOCK_EX | LOCK_NB`（排他锁，非阻塞）
- **Windows**：`msvcrt.LK_NBLCK`（非阻塞锁）
- 获取锁失败时，tick 直接返回 0，不执行任何作业

锁在 finally 块中释放，确保异常不会导致死锁。文件锁路径通过 `_get_lock_paths()` 动态解析，支持 Profile 多实例场景。

### 1.3 tick() 内部流程

```
tick()
  │
  ├── 获取文件锁 (非阻塞)
  │     └── 失败 → return 0
  │
  ├── get_due_jobs()        # 从 jobs.json 读取到期作业
  │     └── catchup 窗口检查 # 跳过过期过久的作业
  │
  ├── advance_next_run()    # 预先把 next_run_at 推进到下一周期
  │                          # (at-most-once 语义，防止崩溃循环)
  │
  ├── 分区执行
  │   ├── 串行: workdir/profile 作业 (进程环境突变隔离)
  │   └── 并行: 其他作业 (ThreadPoolExecutor)
  │
  ├── 每个 Job: run → save → deliver → mark
  │
  └── 释放文件锁
```

**关键设计：先推进 next_run_at，再执行作业。** 如果 Agent 崩溃，下一次 Gateway 重启时不会重复触发同一个作业——宁可错过一次，也不要崩溃循环中触发数十次。

### 1.4 并行与串行分区

```python
sequential_jobs = [j for j in due_jobs if (j.get("workdir") or j.get("profile"))]
parallel_jobs  = [j for j in due_jobs if not (j.get("workdir") or j.get("profile"))]
```

- **串行分区**：配置了 `workdir` 或 `profile` 的作业会修改进程全局环境（`os.environ["TERMINAL_CWD"]`、Profile 的 `.env` 加载），必须串行执行以避免交叉污染
- **并行分区**：纯 prompt 作业在线程池中并发执行，最大并发数通过 `HERMES_CRON_MAX_PARALLEL` 或 `config.yaml` 的 `cron.max_parallel_jobs` 控制

---

## 二、支持的调度格式

`parse_schedule()` 函数支持四种调度表达方式，按优先级顺序解析：

### 2.1 Duration（一次性延迟）

```
"30m"   → 30 分钟后触发一次（one-shot）
"2h"    → 2 小时后
"1d"    → 1 天后
```

解析器匹配 `数字 + 时间单位`（`m/min/mins/minute/minutes` / `h/hr/hrs/hour/hours` / `d/day/days`），计算 `run_at = now + duration`。

### 2.2 "every" 短语（重复间隔）

```
"every 2h"      → 每 2 小时重复
"every 30m"     → 每 30 分钟重复
"every monday 9am"  → 每周一 9am（由 cron 表达式兜底）
```

以 `"every "` 开头时，剥除前缀后的部分按 Duration 解析，生成 `kind="interval"` 的重复作业。`"every monday 9am"` 这种自然语言形式不属于 Duration，会落入 cron 表达式分支（如果在系统 crontab 中已定义则会话用）。

### 2.3 5 字段 Cron 表达式

```
"0 9 * * *"     → 每天 9:00（标准 cron 格式）
"*/5 * * * *"   → 每 5 分钟
"0 0 * * 1"    → 每周一 0:00
```

通过 `croniter` 库解析和计算下次触发时间。如果 crontab 表达式包含大小写字母或中文日期名，则会在一系列兜底匹配中处理。

### 2.4 ISO 时间戳（一次性定点触发）

```
"2026-06-01T09:00:00Z"   → 指定 UTC 时间触发一次
"2026-06-01T09:00:00"    → 本地时区
```

包含 `T` 或以 `YYYY-MM-DD` 开头的字符串被当作 ISO 时间戳。Naive 时间戳（无时区）自动解释为本地时区。一个 one-shot 作业的 `repeat` 自动设为 1，完成后自动标记为 `completed`。

---

## 三、Cron 安全策略：纵深防御

Cron 作业在无人值守、自动批准工具调用的模式下运行，是最高风险的执行场景。Hermes 实施了多层安全策略：

### 3.1 三重禁用的工具集（Protected Toolsets）

```python
def _resolve_cron_disabled_toolsets(cfg):
    disabled = ["cronjob", "messaging", "clarify"]
    user_disabled = cfg.get("agent", {}).get("disabled_toolsets") or []
    for name in user_disabled:
        if name and name not in disabled:
            disabled.append(name)
    return disabled
```

三个始终禁用的受保护工具集：

| 工具集 | 风险 | 原因 |
|--------|------|------|
| `cronjob` | 递归调度 | 不允许 cron 作业创建更多 cron 作业 |
| `messaging` | 越权投递 | 交互式发送消息需要实时 Gateway 会话 |
| `clarify` | 死锁等待 | 澄清工具等待用户输入，无人值守时会永久阻塞 |

用户级别的 `agent.disabled_toolsets` 叠加在这三层之上，per-job 的 `enabled_toolsets` 无法绕过 denylist。

### 3.2 skip_memory=True——不污染用户画像

```python
agent = AIAgent(
    ...
    skip_memory=True,  # Cron system prompts would corrupt user representations
    platform="cron",
    ...
)
```

Cron 作业的系统提示词、工具调用模式、输出内容与用户画像（USER.md）的语义完全不同。将 cron 作业的记忆写入用户画像会污染持久化知识库——用户不会想看到"每天早上 9 点的服务器监控报告"被保存为"用户偏好"。

### 3.3 提示注入扫描：CronPromptInjectionBlocked

这是 cron 安全模型的核心创新。扫描分两层：

**第一层：创建/更新时扫描**（`_scan_cron_prompt`）
- 扫描用户手动输入的 prompt，使用严格模式（Strict Patterns）
- 匹配模式：`ignore previous instructions`、`cat .env`、`rm -rf /`、`disregard rules`、密钥泄露、SSH 后门
- 命中则拒绝创建/更新

**第二层：运行时组装扫描**（`_scan_assembled_cron_prompt`）
- 扫描完整的运行时 prompt——用户 prompt + 加载的技能内容 + cron 提示
- 这是对 #3968 漏洞的修复：恶意技能可以在 markdown 正文中携带注入载荷，因为在创建时只扫描 user prompt，技能内容从未被扫描
- 区分两种子模式：
  - `has_skills=False`：没有加载技能，使用严格模式
  - `has_skills=True`：加载了技能内容，使用**宽松模式**（`_scan_cron_skill_assembled`）——仅扫描明确的注入指令和隐形 Unicode 字符，避免将安全文档/事后分析中的攻击命令描述误判为正攻击

```python
class CronPromptInjectionBlocked(Exception):
    """Raised when the fully-assembled prompt trips the injection scanner."""
```

命中时抛出专用异常，被 `run_job` 捕获后生成详细的审计日志，交付给操作员一个清晰的阻断报告。

### 3.4 Cron 会话隔离

```python
# Cron 执行不设置 HERMES_SESSION_* 上下文变量（platform、chat_id 等）
# 避免工具将完成通知路由到 origin 聊天、TTS 工具根据 platform 选编码器等副作用
_cron_session_id = f"cron_{job_id}_{_hermes_now().strftime('%Y%m%d_%H%M%S')}"
```

Cron 会话有自己的 Session ID 格式（`cron_<job_id>_<timestamp>`），且**不**将 origin 的 `HERMES_SESSION_PLATFORM`、`HERMES_SESSION_CHAT_ID` 等上下文变量注入执行环境，防止：
- `terminal_tool` 的后台进程完成通知泄漏到 origin 聊天
- `tts_tool` 根据错误的 platform 调整输出编码
- `send_message_tool` 的镜像投递行为错乱

---

## 四、强化保护机制

### 4.1 活动超时：防止 Agent 失控循环

```python
_cron_timeout = float(os.getenv("HERMES_CRON_TIMEOUT", "600"))  # 默认 600s
```

Cron 作业不是硬限制执行时长，而是**基于活动（activity-based）的超时**：

- Agent 每次工具调用、API 调用、流式 token 到达时更新 `last_activity` 时间戳
- tick 每 5 秒轮询一次：`seconds_since_activity >= cron_timeout` 则中断
- 这意味着 Agent 可以连续工作数小时，只要它保持活动——但如果一个 API 调用挂起 10 分钟，作业会被终止
- 超时时记录详细诊断信息：`last_activity_desc`、`current_tool`、`api_call_count/max_iterations`

可通过 `HERMES_CRON_TIMEOUT` 环境变量调整，设为 0 表示无限制。

### 4.2 Catchup 窗口：防止重启后的任务雪崩

```python
def _compute_grace_seconds(schedule):
    period_seconds = schedule["minutes"] * 60  # 周期的一半
    grace = period_seconds // 2
    return max(120, min(grace, 7200))  # 钳制在 [120s, 2h]
```

当 Gateway 因维护重启、机器恢复后，大量错过了触发时间的作业会堆积。**Catchup 窗口**机制解决了这个问题：

- 每个作业的宽限时间为**其周期的一半**，最小值 120 秒，最大值 2 小时
- 例如：每 10 分钟的作业，宽限 5 分钟；每天的一次的作业，宽限 2 小时
- 超过了 catchup 窗口的过期作业被**快进到下一个未来触发时间**，不会立即触发
- 这避免了重启后的"作业雪崩"——几十个每小时一次的作业同时触发，消耗大量 API 额度

### 4.3 One-Shot 作业的 Grace Window

```python
ONESHOT_GRACE_SECONDS = 120
```

一次性作业有 120 秒的宽限期。如果用户在 `2026-06-01T09:00:00` 创建了一个 one-shot 作业，但 tick 在 `09:00:03` 才检查（Gateway 刚启动），这个作业仍然会被触发。宽限期使得"恰好错过"的场景得到宽容处理。

### 4.4 Cron 投递不镜像到 Gateway 会话

Cron 交付结果**不会**写入 Gateway 的实时会话状态（`HERMES_SESSION_*` 上下文变量被清空），而是直接通过目标平台的 Adapter 或 HTTP API 发送。它有自己的投递通道，不污染用户的活跃对话。

---

## 五、多平台交付系统

### 5.1 交付链路

```
Agent 输出
  │
  ├── final_response
  │   ├── [SILENT]  → 跳过投递（静默执行）
  │   └── 正常内容 → 进入投递管道
  │
  ├── 优先级: 实时 Adapter > 独立 HTTP 发送
  │     (E2EE 房间如 Matrix 必须用 Adapter 加密)
  │
  └── MEDIA: 语法支持 → 原生附件投递
        ├── .mp3/.ogg  → send_voice
        ├── .mp4/.mov  → send_video
        ├── .jpg/.png  → send_image_file
        └── 其他       → send_document
```

### 5.2 投递目标解析（deliver 字段）

```python
"local"                         # 仅本地保存，不投递
"origin"                        # 投递到创建作业的源聊天
"telegram"                      # 投递到 Telegram Home Channel
"telegram:-1001234567890:17585"  # 精确指定 chat_id:thread_id
"origin,all"                    # 源聊天 + 所有已连接平台的 Home Channel
"all"                           # 所有有 Home Channel 的平台
```

`all` 令牌在**触发时**才展开到已配置 Home Channel 的平台列表，这意味着作业创建后新增的平台会自动被纳入投递范围。

### 5.3 支持的交付平台

内置平台 + 插件平台，共计 20+ 种目标：

| 平台 | 环境变量（Home Channel） | 备注 |
|------|------------------------|------|
| Telegram | `TELEGRAM_HOME_CHANNEL` | 含 thread_id 支持 |
| Discord | `DISCORD_HOME_CHANNEL` | 原生文件附件 |
| Slack | `SLACK_HOME_CHANNEL` | Markdown 渲染 |
| WhatsApp | `WHATSAPP_HOME_CHANNEL` | 无 Markdown |
| Signal | `SIGNAL_HOME_CHANNEL` | 无 Markdown |
| Matrix | `MATRIX_HOME_ROOM` | E2EE 加密需 Adapter |
| Mattermost | `MATTERMOST_HOME_CHANNEL` | Markdown 渲染 |
| SMS | `SMS_HOME_CHANNEL` | 纯文本 ~1600 字符 |
| Email | `EMAIL_HOME_ADDRESS` | 纯文本 |
| Webhook | `WEBHOOK_URL` | HTTP POST |
| BlueBubbles | `BLUEBUBBLES_HOME_CHANNEL` | iMessage 桥接 |
| DingTalk | `DINGTALK_HOME_CHANNEL` | 钉钉 |
| Feishu | `FEISHU_HOME_CHANNEL` | 飞书 |
| WeCom | `WECOM_HOME_CHANNEL` | 企业微信 |
| Weixin | `WEIXIN_HOME_CHANNEL` | 微信 |
| QQBot | `QQBOT_HOME_CHANNEL` | QQ 机器人 |
| Yuanbao | `YUANBAO_HOME_CHANNEL` | 元宝 |
| HomeAssistant | `HASS_HOME_CHANNEL` | 智能家居 |

插件平台通过 `PlatformEntry.cron_deliver_env_var` 注册，无需修改 cron 核心代码。

---

## 六、Job 字段完整清单

`create_job()` 创建的作业包含以下字段：

| 字段 | 类型 | 说明 |
|------|------|------|
| `schedule` | dict | `{"kind": "once"/"interval"/"cron", ...}` 解析后的调度结构 |
| `prompt` | str | 主任务指令。在 `no_agent=True` 时仅作为名称提示 |
| `skills` | list[str] | 按顺序加载的技能列表（依次调用 `skill_view` 加载内容） |
| `deliver` | str | 投递目标：`"local"` / `"origin"` / `"telegram"` / `"all"` / 组合 |
| `enabled_toolsets` | list[str] | 限制 Agent 可用的工具集（减少 token 开销） |
| `model` | str | 每个作业可指定独立模型（不指定则使用系统默认） |
| `provider` | str | 每个作业可指定独立提供商 |
| `base_url` | str | 自定义 API endpoint |
| `script` | str | 数据收集脚本路径（`~/.hermes/scripts/` 内的相对路径） |
| `no_agent` | bool | `True` 时跳过 LLM 循环，只执行 script 并投递 stdout |
| `context_from` | list[str] | 前序作业 ID 列表，每轮触发前将其最后输出注入 prompt |
| `workdir` | str | 绝对路径。设置后注入该目录的 AGENTS.md 等项目上下文文件 |
| `profile` | str | Hermes Profile 名称。切换 `HERMES_HOME` 实现配置/凭据隔离 |
| `name` | str | 友好名称（用于 UI/日志） |
| `repeat` | dict | `{"times": int\|null, "completed": int}` 重复次数控制 |
| `origin` | dict | 创建来源（`{"platform", "chat_id", "thread_id"}`） |

### 6.1 no_agent：经典看门狗模式

```python
if job.get("no_agent"):
    ok, output = _run_job_script(script_path)
    if not ok:
        delivery_content = f"⚠ Cron watchdog '{job_name}' script failed\n\n{output}"
    elif not output.strip():
        # 空 stdout = 静默（无事发生，不投递）
        SILENT_MARKER
    else:
        delivery_content = output  # 逐字投递脚本 stdout
```

`no_agent=True` 完全绕过 LLM——不构造 AIAgent、不加载 System Prompt、不消耗 token。脚本的 stdout 即为投递内容。这个模式适用于固定的数据收集/告警类作业（内存使用监控、磁盘阈值检查、API 状态轮询）。

### 6.2 chain_from：跨作业链式上下文

```python
# Job A (收集数据) ──context_from──> Job B (处理数据)
context_from = ["abc123def456"]  # Job B 引用 Job A 的 ID

# 运行时，Job B 的 prompt 被预注入：
# "## Output from job 'abc123def456'\n"
# "The following is the most recent output from a preceding cron job..."
# "```\n{Job A 的最后输出}\n```"
```

`context_from` 让多个 cron 作业可以形成**数据管道**：Job A 每小时抓取 RSS 源摘要，Job B 每天对汇总内容执行 LLM 分析并生成摘要。注入前序输出时截断到 8K 字符，防止 prompt 膨胀。

### 6.3 workdir：项目上下文注入

```python
os.environ["TERMINAL_CWD"] = job_workdir
agent = AIAgent(
    skip_context_files=not bool(job_workdir),  # 有 workdir 时加载 AGENTS.md
    load_soul_identity=True,                    # 始终加载 SOUL.md
    ...
)
```

当设置 `workdir` 时，Agent 的行为等同于在该目录下启动：终端命令以该目录为 cwd，文件工具从此处解析路径，项目上下文文件（AGENTS.md / CLAUDE.md / .cursorrules）被注入系统提示。这让 cron 作业可以**感知项目环境**——例如代码仓库的测试脚本位置、构建命令约定、分支策略等。

---

## 七、作业生命周期

```
create_job()        state=scheduled, next_run_at=r1
    │
    ├── tick() 检查到期
    │   ├── 在 catchup 窗口内 → 执行
    │   └── 超过 catchup 窗口 → 快进到下一个未来触发时间
    │
    ├── advance_next_run()  提前推进 next_run_at  (at-most-once)
    │
    ├── run_job()
    │   ├── wakeAgent=false gate → 静默跳过
    │   ├── no_agent=True → 执行脚本，投递 stdout
    │   └── LLM 路径 → 构造 prompt → 构造 AIAgent → 运行对话循环
    │       ├── 活动超时 → 中断
    │       ├── 注入扫描命中 → CronPromptInjectionBlocked
    │       ├── 成功 → final_response 投递
    │       └── 失败 → 错误信息投递
    │
    ├── save_job_output()   保存到 ~/.hermes/cron/output/{job_id}/{timestamp}.md
    │
    ├── _deliver_result()   多平台投递
    │
    └── mark_job_run()
        ├── repeat.completed += 1
        ├── 达到次数上限 → 删除作业
        ├── 一次性作业 → state=completed
        └── 重复作业 → 计算下一个 next_run_at
```

---

## 八、设计亮点总结

| 设计模式 | 实现 | 解决的问题 |
|---------|------|-----------|
| at-most-once 语义 | `advance_next_run()` 先推进再执行 | 崩溃循环不会重复触发 |
| 文件锁防重入 | fcntl/msvcrt + 非阻塞排他锁 | 多进程/手动 tick 不会并发 |
| 活动超时（非硬超时） | 每 5 秒轮询 last_activity | 长时间任务不受影响，挂起任务及时终止 |
| Catchup 窗口 | 周期的一半，钳制 [120s, 2h] | 重启后不产生任务雪崩 |
| 运行时注入扫描 | 组装后扫描（含技能内容） | 防止恶意技能载荷进入无人值守 Agent |
| 串行/并行分区 | workdir/profile 作业串行，其余并行 | 避免进程环境交叉污染 |
| no_agent 看门狗 | 跳过 LLM，逐字投递脚本 stdout | 固定数据收集作业零 token 成本 |
| context_from 链 | 注入前序作业的输出 | 构建 cron 数据管道 |
| deliver=all 延迟解析 | 触发时才展开平台列表 | 后添加的平台自动纳入投递 |
| 配置文件感知 | workdir 注入项目上下文 | cron 作业可感知具体代码仓库 |

---

## 九、参考资料

- 源码: `cron/scheduler.py`、`cron/jobs.py`、`tools/cronjob_tools.py`
- 项目: https://github.com/NousResearch/hermes-agent
- 文档: https://hermes-agent.nousresearch.com/docs
