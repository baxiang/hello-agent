# Hermes Agent Profile 多实例系统：一个 `os.environ` 技巧如何撑起全栈隔离

> **项目**: [NousResearch/hermes-agent](https://github.com/NousResearch/hermes-agent) v0.15.1
> **核心文件**: `hermes_cli/main.py` · `hermes_cli/profiles.py` · `hermes_constants.py` · `agent/credential_pool.py`
> **关键词**: Profile Isolation · HERMES_HOME Scoping · Token Lock · platform_registry · Subprocess Home

---

## 引言：一个 Hermes，多个 Agent

想象你有三个开发角色：一个用 Claude Sonnet 写代码的 "coder"，一个用 GPT-4o 做代码审查的 "reviewer"，一个用 Gemini 做文档翻译的 "translator"。每个角色有不同的 API Key、不同的系统提示（SOUL.md）、不同的技能集、不同的记忆。

传统做法：开三个终端窗口，手动设置环境变量。Hermes 的做法：`hermes -p coder`、`hermes -p reviewer`、`hermes -p translator`——每个都是**完全隔离的 Agent 实例**，共享同一套二进制但独立运行。

这就是 Hermes 的 Profile 多实例系统。它的核心实现只有一行魔法：在所有模块导入之前设置 `os.environ["HERMES_HOME"]`。但围绕这一行，构建了一整套隔离基础设施。

---

## 一、魔法时刻：`_apply_profile_override()`

### 1.1 问题：导入时机竞争

Python 模块在首次导入时执行顶层代码。如果某个模块在顶层写了：

```python
HERMES_HOME = Path.home() / ".hermes"
```

那么在 `_apply_profile_override()` 修改 `HERMES_HOME` 环境变量**之前**导入的模块就会锁定到错误的路径。这是整个系统的根问题。

### 1.2 解决方案：先覆盖，后导入

`hermes_cli/main.py` 在**所有 hermes 模块导入之前**调用 `_apply_profile_override()`：

```python
# hermes_cli/main.py 的最顶部

def _apply_profile_override() -> None:
    """Pre-parse --profile/-p and set HERMES_HOME before module imports."""
    argv = sys.argv[1:]
    profile_name = None
    consume = 0

    # 1. 检查显式的 -p / --profile 标志
    for i, arg in enumerate(argv):
        if arg in {"--profile", "-p"} and i + 1 < len(argv):
            profile_name = argv[i + 1]
            consume = 2
            break
        elif arg.startswith("--profile="):
            profile_name = arg.split("=", 1)[1]
            consume = 1
            break

    # 2. 如果没有显式标志，检查 active_profile 粘性文件
    if profile_name is None:
        active_path = get_default_hermes_root() / "active_profile"
        if active_path.exists():
            name = active_path.read_text().strip()
            if name and name != "default":
                profile_name = name

    # 3. 设置环境变量
    if profile_name is not None:
        hermes_home = resolve_profile_env(profile_name)
        os.environ["HERMES_HOME"] = hermes_home
        # 从 sys.argv 中移除 --profile 标志
        sys.argv = sys.argv[:start] + sys.argv[start + consume:]

_apply_profile_override()   # ← 在所有其他 import 之前执行

# 下面是正常导入
from hermes_cli.config import get_hermes_home
```

关键细节：

- 函数需要**手写** sys.argv 解析，不能用 argparse（argparse 还没导入）
- 解析后需要从 sys.argv 中**清理**掉 profile 相关参数，否则 argparse 会报 "unrecognized argument"
- 对 profile name 做了正则校验（`^[a-z0-9][a-z0-9_-]{0,63}$`），防止 pytest 的 `-p no:xdist` 被误读为 profile

### 1.3 粘性默认值

`~/.hermes/active_profile` 文件存储了用户最近选择的 profile。这意味着：

```bash
hermes profile use coder   # 写入 active_profile 文件
hermes chat                 # 自动使用 coder profile，无需 -p 标志
```

粘性默认值在每次 `_apply_profile_override()` 调用时检查。如果显式传入了 `-p` 标志，以显式标志为准；如果没有，以文件为准。

---

## 二、路径规则：两条黄金法则

### 2.1 代码路径：`get_hermes_home()`

所有读取文件、访问数据库、加载配置的**代码路径**必须使用 `get_hermes_home()`：

```python
from hermes_constants import get_hermes_home

config_path = get_hermes_home() / "config.yaml"
session_db  = get_hermes_home() / "state.db"
skills_dir  = get_hermes_home() / "skills"
plans_dir   = get_hermes_home() / "plans"
```

这个函数会自动返回当前活跃 profile 的路径。当 `-p coder` 起作用时，它返回 `~/.hermes/profiles/coder/`；当没有 profile 时，它返回 `~/.hermes/`。

### 2.2 用户可见消息：`display_hermes_home()`

在向用户展示路径时（错误消息、诊断输出、日志），使用 `display_hermes_home()`：

```python
from hermes_constants import display_hermes_home

print(f"Config loaded from {display_hermes_home()}/config.yaml")
# 用户看到: Config loaded from ~/.hermes/profiles/coder/config.yaml
# 而不是:    Config loaded from /home/user/.hermes/profiles/coder/config.yaml
```

`display_hermes_home()` 用 `~` 替换了 `$HOME` 前缀，提供更友好的路径展示。

### 2.3 绝对禁止

**永远不要硬编码**：

```python
# ❌ 绝对禁止
Path.home() / ".hermes"
Path("~/.hermes").expanduser()
os.path.expanduser("~/.hermes")

# ✅ 正确方式
get_hermes_home()
```

这个规则在项目中是强制性约定。不清楚的代码会被 CI 检查拒绝。

### 2.4 模块级常量的例外

模块级常量在导入时缓存，而导入发生在 `_apply_profile_override()` **之后**，所以它们可以安全地使用 `get_hermes_home()`：

```python
# ✅ 安全：这个常量在 import 时计算，此时 HERMES_HOME 已经被覆盖
DEFAULT_CONFIG_PATH = get_hermes_home() / "config.yaml"
PLUGIN_DIR = get_hermes_home() / "plugins"
```

---

## 三、Profile 数据模型与生命周期

### 3.1 目录结构

```
~/.hermes/                          # 默认 profile (= hermes 根目录)
├── config.yaml
├── .env
├── SOUL.md
├── memories/ MEMORY.md, USER.md
├── sessions/
├── skills/
├── profiles/                       # 命名 profile 存储
│   ├── coder/
│   │   ├── config.yaml
│   │   ├── .env
│   │   ├── SOUL.md
│   │   ├── memories/
│   │   ├── sessions/
│   │   ├── skills/
│   │   ├── home/                # 隔离的 HOME 目录
│   │   ├── logs/
│   │   └── workspace/
│   ├── reviewer/
│   └── translator/
├── active_profile                  # 粘性默认值
└── ...
```

每个命名 profile 是一个**完整的 HERMES_HOME**，包含自己的配置、凭据、记忆、会话、技能、日志和工作空间。

### 3.2 ProfileInfo 数据类

```python
@dataclass
class ProfileInfo:
    name: str                     # "coder"
    path: Path                    # ~/.hermes/profiles/coder/
    is_default: bool              # False
    gateway_running: bool         # 是否有活动的 gateway
    model: Optional[str]          # "claude-sonnet-4-20250514"
    provider: Optional[str]       # "anthropic"
    has_env: bool                 # .env 文件存在
    skill_count: int              # 42
    alias_path: Optional[Path]    # ~/.local/bin/coder (wrapper 脚本)
    distribution_name: Optional[str]     # 来自 distribution.yaml
    distribution_version: Optional[str]
    distribution_source: Optional[str]
    description: str              # profile.yaml 中的描述
    description_auto: bool        # 是否为 LLM 自动生成
```

### 3.3 CRUD 操作

`hermes profile` 子命令提供完整生命周期管理：

```bash
hermes profile create coder                     # 创建空 profile
hermes profile create coder --clone             # 从默认 profile 复制配置和技能
hermes profile create coder --clone-all         # 完整复制（含会话、记忆）
hermes profile create coder --no-skills         # 不种子技能
hermes profile describe coder "Writes backend code"  # 设置描述
hermes profile use coder                        # 设为粘性默认
hermes profile list                             # 列出所有 profile
hermes profile delete coder                     # 删除（停止 gateway、移除 wrapper、清理服务）
```

### 3.4 Wrapper 脚本

创建 profile 时，自动生成 shell wrapper：

```bash
# ~/.local/bin/coder
#!/bin/sh
exec hermes -p coder "$@"
```

这使得用户可以直接输入 `coder chat` 代替 `hermes -p coder chat`。Wrapper 会检测命令名冲突——如果 `coder` 已存在于 PATH 中，会发出警告。

---

## 四、Home 锚定：Profile 操作的固定点

### 4.1 核心概念：HOME 锚定

一个微妙但关键的设计：**Profile 管理操作（创建、删除、列出）锚定在 `~/.hermes`，而不是当前 `HERMES_HOME`**。

```python
def _get_profiles_root() -> Path:
    """总是返回 ~/.hermes/profiles/，即使当前在 profile 内部"""
    return _get_default_hermes_home() / "profiles"

def _get_default_hermes_home() -> Path:
    """总是返回 ~/.hermes，不受 profile 覆盖影响"""
    from hermes_constants import get_default_hermes_root
    return get_default_hermes_root()
```

为什么这样设计？因为当你用 `coder profile create reviewer` 时，你想在 `~/.hermes/profiles/` 下创建 reviewer，而不是在 `~/.hermes/profiles/coder/profiles/reviewer/` 下创建——后者会导致无限嵌套的俄罗斯套娃。

### 4.2 两种 hermes home 函数

| 函数 | 行为 | 用途 |
|------|------|------|
| `get_hermes_home()` | 返回当前活跃 profile 路径 | 代码逻辑：读配置、访问文件 |
| `get_default_hermes_root()` | 始终返回 `~/.hermes` | Profile 管理：列表、创建、删除 |
| `display_hermes_home()` | 返回格式化的当前路径 | 用户界面：日志、错误消息 |

---

## 五、子进程 HOME 隔离

每个 profile 有自己隔离的 `home/` 目录：

```python
_PROFILE_DIRS = [
    "memories", "sessions", "skills",
    "skins", "logs", "plans", "workspace",
    "cron",
    "home",  # ← 隔离的 HOME 目录
]
```

子进程（Worker、Dispatcher spawn 的 Agent 进程）使用 profile 的 `home/` 作为 `HOME` 环境变量。这确保：

- Git 配置不泄露到其他 profile（`~/.gitconfig` 是 profile 专属的）
- SSH 密钥隔离（`~/.ssh/` 是 profile 专属的）
- npm/gh 等工具的配置隔离
- Docker 部署中持久化到数据卷

---

## 六、凭据池与 Token 锁

### 6.1 问题：竞态条件

两个 profile 可能使用同一个 API 提供商但不同的 API Key。更麻烦的是，它们可能**共享同一个 API Key 的速率限制**。如果 coder 和 reviewer 同时频繁调用同一个 API Key，可能触发 rate limit，导致两者都失败。

### 6.2 Token 锁机制

Hermes 的凭据池系统引入了 Token 锁：

```python
# 伪代码示例
def acquire_scoped_lock(provider, credential_id):
    """获取一个凭据的排他锁，防止两个 profile 同时使用"""
    lock_file = lock_dir / f"{provider}_{credential_id}.lock"
    # ... 文件锁实现 ...

def release_scoped_lock(provider, credential_id):
    """释放凭据锁"""
```

Token 锁的作用域是提供商 + 凭据 ID。两个使用同一个 API Key 的 profile 会被串行化——不是一个 profile 阻塞另一个，而是排他锁确保同一时刻只有一个 profile 使用该 Key。

这是**可选的优化**而非强制机制。如果每个 profile 有独立的 API Key，token 锁不需要启用。

### 6.3 凭据池的多 Key 轮换

每个 profile 可以配置多个同类型凭据，凭据池自动轮换：

```yaml
# config.yaml
credentials:
  anthropic:
    - api_key: "sk-ant-aaa..."    # 主 Key
    - api_key: "sk-ant-bbb..."    # 备用 Key
```

轮换策略结合了速率限制追踪器和健康检查，当一个 Key 达到速率上限或连续失败时自动切换到下一个。

---

## 七、Platform Registry：Profile 感知的平台适配

### 7.1 什么是 Platform Registry

`platform_registry` 是一个运行时注册表，将平台名称映射到适配器配置。每个平台（Telegram、Discord、Slack 等）可以注册自己的工具集扩展和提示词。

### 7.2 Profile 感知

Platform Registry 的注册条目包含 profile 信息，使得同一个平台在不同 profile 下有不同行为：

```python
# 工具集自动生成中的 platform_registry 查询
if name.startswith("hermes-"):
    platform_name = name[len("hermes-"):]
    if platform_registry.is_registered(platform_name):
        plugin_tools = set(_HERMES_CORE_TOOLS)
        # 添加该平台注册的特有工具
        plugin_tools.update(registry_tools_for(platform_name))
        return list(plugin_tools)
```

当 coder profile 运行在 Telegram 平台上时，它会获得 Telegram 特有的消息工具；当 reviewer profile 运行在 Discord 上时，它会获得 Discord 特有的权限工具。这一切由 platform_registry 自动处理，无需手动配置。

### 7.3 在系统提示词中的角色

Platform Registry 还影响系统提示词的生成。不同平台有不同的消息格式规范（Telegram 支持 Markdown，WhatsApp 不支持），这些差异通过 profile 解析的 platform 配置注入到系统提示中。

---

## 八、Subprocess Home：工具执行的容器化

### 8.1 问题：工具命令污染

当 Agent 通过 `terminal` 工具执行 shell 命令时，这些命令运行在子进程的 HOME 环境中。如果多个 profile 共享同一个 HOME，一个 profile 安装的 npm 包可能影响另一个 profile 的工具执行。

### 8.2 解决方案

Hermes 提供了一个 `get_subprocess_home()` 函数，为每个 profile 返回独立的 HOME 路径。所有工具执行（terminal、文件操作、shell hooks）都在这个隔离的 HOME 下运行：

```python
# 工具执行时的环境设置
env["HOME"] = get_subprocess_home()  # ~/.hermes/profiles/coder/home/

# 子进程看到:
# ~/.gitconfig → ~/.hermes/profiles/coder/home/.gitconfig
# ~/.ssh/      → ~/.hermes/profiles/coder/home/.ssh/
# ~/.npm/      → ~/.hermes/profiles/coder/home/.npm/
```

配合 per-profile 的 `.env` 文件和 `config.yaml`，形成三层隔离：
1. **工具命令层**：subprocess HOME 隔离
2. **API 调用层**：profile 专属凭据 + token 锁
3. **文件系统层**：profile 专属目录（skills、memories、sessions）

---

## 九、Profile 分发与可移植性

### 9.1 distribution.yaml

Profile 可以从分发源安装（类似 Docker image registry），安装后记录在 `distribution.yaml` 中：

```yaml
# ~/.hermes/profiles/security-auditor/distribution.yaml
name: security-auditor
version: 1.2.0
source: https://profiles.hermes-agent.io/nous/security-auditor
```

这支持了 Profile 的版本管理和增量更新——`hermes update` 会检查分发源是否有新版本。

### 9.2 导出/导入

Profile 可以通过 tar.gz 导出和导入：

```bash
hermes profile export coder coder-profile.tar.gz
hermes profile import coder-profile.tar.gz
```

导出时自动剥离凭据文件（`auth.json`, `.env`），导入时解压到 `profiles/` 目录。支持路径穿越防护，防止恶意档案逃逸到文件系统其他位置。

### 9.3 默认 Profile 的特殊处理

默认 profile（`~/.hermes`）在导出时有额外的排除列表，因为它的顶层包含非 profile 数据（repo checkout、worktrees、node_modules、binaries 等）：

```python
_DEFAULT_EXPORT_EXCLUDE_ROOT = frozenset({
    "hermes-agent",   # repo checkout (multi-GB)
    ".worktrees",     # git worktrees
    "profiles",       # 其他 profile — 不递归导出
    "bin",            # 安装的二进制
    "node_modules",   # npm 包
    "state.db",       # 数据库
    "auth.json",      # 凭据
    "logs",           # 日志
    # ...
})
```

---

## 十、与 Gateway 的集成

### 10.1 每个 Profile 一个 Gateway

Gateway 是多平台消息入口。理论上，每个 profile 可以运行自己独立的 gateway 实例，监听不同的端口，服务不同的平台。

```bash
hermes -p coder gateway start     # 在 profile 目录下创建 gateway.pid
hermes -p reviewer gateway start  # 独立的 gateway 实例
```

### 10.2 s6 容器集成（Phase 4）

在容器部署中，profile 的 gateway 注册为 s6 监控树的一部分，由 `s6-supervise` 管理生命周期。

```python
def _maybe_register_gateway_service(profile_name):
    """在 s6 容器中注册 profile gateway 服务"""
    if detect_service_manager() != "s6":
        return  # 主机路径 — 无操作
    mgr = get_service_manager()
    if mgr.supports_runtime_registration():
        mgr.register_profile_gateway(profile_name)
```

主机（systemd、launchd、Windows）走不同的服务管理路径，s6 路径设计为对主机完全透明。

### 10.3 Gateway 健康检查

`_check_gateway_running()` 通过检查 PID 文件和进程存活状态来判断 gateway 是否运行：

```python
def _check_gateway_running(profile_dir):
    return get_running_pid(profile_dir / "gateway.pid", cleanup_stale=False) is not None
```

涉及 profile 删除时，系统会先停止 gateway，清理服务注册，再删除文件——确保不留下僵尸进程。

---

## 总结

Hermes 的 Profile 多实例系统展示了**一个优雅的隔离设计可以有多层**：

```
Layer 1: os.environ["HERMES_HOME"]     ← 入口：在所有 import 之前设置
Layer 2: get_hermes_home()             ← 所有代码路径的统一入口
Layer 3: get_default_hermes_root()     ← Profile 管理操作的固定锚点
Layer 4: get_subprocess_home()         ← 工具执行的 HOME 隔离
Layer 5: Token locks                   ← 凭据共享时的并发控制
Layer 6: platform_registry             ← 平台适配的 profile 感知
```

每一层解决一个特定的隔离问题，层与层之间通过简单的函数调用而非框架绑定。整个系统没有引入容器、虚拟机或嵌套 Python 解释器——它用 `os.environ` 这个最基础的工具，配合严格的使用约定，实现了一个**零依赖、零运行时开销**的多实例系统。

这就是 Hermes 设计哲学的精髓：**用最简单的工具解决正确的问题，然后把约定变成规则**。
