# TUI 与 Dashboard 架构：双进程模型、皮肤引擎与终端嵌入

> **项目**: [NousResearch/hermes-agent](https://github.com/NousResearch/hermes-agent) v0.15.1
> **核心源码**: `ui-tui/`、`tui_gateway/`、`hermes_cli/` (skin_engine / pty_bridge / web_server)、`web/`
> **分析日期**: 2026-05-29

---

## 一、双进程模型：Node 占有屏幕，Python 占有逻辑

Hermes Agent 的 `hermes --tui` 并非单一进程，而是一个**跨语言双进程架构**。启动时，Node.js 入口（`ui-tui/dist/entry.js`）作为前端进程使用 Ink（React for CLI）接管整个终端显示，然后 spawn 一个 Python 子进程（`python -m tui_gateway.entry`）作为 RPC 后端。两者通过 **stdio JSON-RPC** 通信——换行分隔的 JSON 消息在 stdin/stdout 管道上双向流动。

```
用户终端 ←→ Node.js (Ink/React)
                 ↕ stdio 管道 (newline-delimited JSON-RPC)
              Python (tui_gateway/server.py)
                 ↕
              AIAgent → OpenAI / Anthropic / 任意模型 API
```

这个分割反映了一个明确的设计决策：

| 层 | 语言 | 职责 |
|----|------|------|
| **前端（屏幕层）** | TypeScript / Ink | React 组件树渲染、键盘/鼠标输入、滚动、状态 UI |
| **后端（逻辑层）** | Python | 会话管理、工具调用、模型 API、斜杠命令执行、审批流 |

TypeScript 前端**永远不直接调用 OpenAI API**。所有产生副作用或需要 Python 运行时能力的操作（发送消息、切换模型、管理会话、执行斜杠命令）都通过 JSON-RPC 请求发往 Python 后端。Python 端则通过 `_emit()` 函数向 TypeScript 推送事件（消息增量、工具进度、审批请求等）。

### 1.1 两种传输模式

`GatewayClient`（`ui-tui/src/gatewayClient.ts`）支持两种传输模式，通过环境变量 `HERMES_TUI_GATEWAY_URL` 切换：

**Spawn 模式（默认）**：Node 直接 spawn Python 子进程。从 stdin 写入 JSON-RPC 请求，从 stdout 逐行读取 JSON 响应，stderr 被捕获为 `gateway.stderr` 事件：

```typescript
// gatewayClient.ts — spawn 模式读写
this.proc = spawn(python, ['-m', 'tui_gateway.entry'], { cwd, env, stdio: ['pipe', 'pipe', 'pipe'] })
this.stdoutRl = createInterface({ input: this.proc.stdout! })
this.stdoutRl.on('line', raw => {
  try { this.dispatch(JSON.parse(raw)) }
  catch { /* parse error → protocol_error event */ }
})

// 写入请求
this.proc.stdin!.write(JSON.stringify({ id, jsonrpc: '2.0', method, params }) + '\n')
```

**Attach 模式（可选）**：Node 通过 WebSocket 连接到一个已运行的 gateway 服务。此模式用于跨容器部署——gateway 可能在 Docker 中运行，而 TUI 在宿主机上。

### 1.2 请求分发与异步处理

Python 端的 `dispatch()` 函数（`tui_gateway/server.py`）根据方法名决定执行策略。绝大多数 RPC（`prompt.submit`、`config.get`、`clipboard.paste` 等）在当前线程**同步**处理——它们必须快速返回以保持 UI 响应性。少数长时间运行的方法（`slash.exec`、`session.resume`、`shell.exec`、`cli.exec`、`session.compress` 等）被**路由到线程池**异步执行：

```python
_LONG_HANDLERS = frozenset({
    "browser.manage", "cli.exec", "session.branch",
    "session.compress", "session.resume", "shell.exec",
    "skills.manage", "slash.exec",
})

_pool = concurrent.futures.ThreadPoolExecutor(
    max_workers=_rpc_pool_workers, thread_name_prefix="tui-rpc")
```

这种分离确保了一个长时间运行的 `/compress` 或 shell 命令不会阻塞 `approval.respond`（用户点击"允许"按钮）——后者仍在主线程的 JSON-RPC 读取循环中即时处理。

### 1.3 Panic 日志

Gateway 崩溃在 TUI 会话中是致命且无痕迹的——stdout 是 JSON-RPC 管道，stderr 通过事件泵转发到 Activity 面板，而根日志器只捕获已处理的警告。`tui_gateway/server.py` 通过在模块初始化时注册 `sys.excepthook` 和 `threading.excepthook` 解决了这个问题：所有未处理异常都被写入 `~/.hermes/logs/tui_gateway_crash.log`，同时第一行错误信息通过 stderr 发送到 TUI 的 Activity 面板。

---

## 二、关键通信接口

TUI 前端和后端之间的通信遵循 JSON-RPC 2.0 协议。前端发起 Request（带 `id`），后端返回 Response（带 `id` + `result` 或 `error`）。后端还可主动发送 Notification（`method: "event"`，无 `id`）向 TypeScript 推送事件。

### 2.1 核心 RPC 方法表

| 交互面 | Ink 组件 / Hook | Gateway 方法 | 方向 |
|--------|----------------|--------------|------|
| **聊天流式传输** | `app.tsx` + `messageLine.tsx` | `prompt.submit` → `message.delta` / `message.complete` | 请求 → 事件流 |
| **工具活动** | `thinking.tsx` | `tool.start` / `tool.progress` / `tool.complete` | 事件通知 |
| **审批** | `prompts.tsx` | `approval.respond` ← `approval.request` | 请求 → 响应（阻塞式） |
| **斜杠命令** | 本地处理器 + fallthrough | `slash.exec` → `command.dispatch` | 请求 → 响应 |
| **会话选择器** | `sessionPicker.tsx` | `session.list` / `session.resume` | 请求 → 响应 |
| **补全** | `useCompletion` hook | `complete.slash` / `complete.path` | 请求 → 响应 |
| **模型切换** | `modelPicker.tsx` | `config.set` + 内部 `switch_model` | 请求 → 响应 |
| **终端大小** | ResizeObserver | `terminal.resize` | 请求（通知后端 cols/rows 变化） |
| **剪贴板** | 快捷键处理 | `clipboard.paste` | 请求 → 响应 |

### 2.2 流式传输协议

对话流（prompt 提交后的流式响应）是 TUI 中最复杂的通信模式。流程如下：

1. **TypeScript 发送** `prompt.submit`（含消息文本、可选图片附件、模型参数）
2. **Python 创建 AIAgent**，启动 `run_conversation()`，注册流回调
3. **每个 token 到达时**，Python 调用 `_emit("message.delta", sid, payload)`，payload 包含 `text` 增量
4. **推理块到达时**，`_emit("reasoning.delta", sid, payload)`
5. **工具调用发生时**，`_emit("tool.start", ...)` → `_emit("tool.progress", ...)` → `_emit("tool.complete", ...)`
6. **子代理活动**：`_emit("subagent.start", ...)` / `_emit("subagent.delta", ...)` / `_emit("subagent.complete", ...)`
7. **消息完成**：`_emit("message.complete", sid, payload)`（含完整消息对象、token 使用情况、成本估算）

TypeScript 端的 `useMainApp` hook 通过 `createGatewayEventHandler` 订阅这些事件，将 delta 累积到 `turnController`，驱动 React 重渲染。流式渲染优化了抖动——多个高频 delta 被合并到单次 React commit 中，避免每收到一个 token 就重渲染整个组件树。

### 2.3 阻塞式审批提示

审批（`approval`）、提权密码（`sudo`）、澄清问题（`clarify`）和密钥输入（`secret`）使用**阻塞式请求-响应模式**——与简单的"fire and forget"事件不同。Python 端通过 `_block()` 工厂发送事件后，在 `threading.Event` 上阻塞等待回复：

```python
def _block(event: str, sid: str, payload: dict, timeout: int = 300) -> str:
    rid = uuid.uuid4().hex[:8]
    ev = threading.Event()
    _pending[rid] = (sid, ev)
    _emit(event, sid, payload)
    ev.wait(timeout=timeout)      # 阻塞直到前端返回
    return _answers.pop(rid, "")
```

TypeScript 端通过 `approval.respond` / `clarify.respond` / `sudo.respond` / `secret.respond` 方法发送用户的响应。一旦收到，Python 的 `_pending` 字典被查找，线程被唤醒，对话继续。

---

## 三、斜杠命令流程

斜杠命令（如 `/help`、`/model`、`/skin`、`/compress` 等）是 Hermes TUI 的核心交互原语。命令分为两类：**内置客户端命令**和**后端命令**。

### 3.1 内置客户端命令（本地处理）

以下命令在 TypeScript 端（`ui-tui/src/app/createSlashHandler.ts`）**本地处理**，完全不接触 Python 后端：

| 命令 | 处理逻辑 |
|------|---------|
| `/help` | 渲染命令列表面板（`panel` 组件），从 `catalog` 中获取描述 |
| `/quit` / `/exit` | 调用 `gw.kill()` 终止 gateway → 退出应用 |
| `/clear` | 清空可见历史记录（本地 state 操作） |
| `/resume` | 调用 `session.list` → 显示会话选择器覆盖层 |
| `/copy` | 通过终端 OSC 52 复制最后一条助手消息到系统剪贴板 |
| `/paste` | 从系统剪贴板读取图片并通过 `clipboard.paste` 发送 |

### 3.2 后端斜杠命令（通过 SlashWorker 执行）

所有不在内置列表中的命令（`/model`、`/config`、`/skin`、`/compress`、`/session` 等）通过 JSON-RPC `slash.exec` 方法发送到 Python 后端。后端使用一个**持久化子进程** `_SlashWorker`（而非每次命令都 spawn 新进程）来处理这些命令：

```python
class _SlashWorker:
    def __init__(self, session_key: str, model: str):
        self.proc = subprocess.Popen(
            [sys.executable, "-m", "tui_gateway.slash_worker",
             "--session-key", session_key, "--model", model],
            stdin=subprocess.PIPE, stdout=subprocess.PIPE,
            stderr=subprocess.PIPE, text=True, bufsize=1)
        # 后台线程负责 drain stdout/stderr
```

`_SlashWorker` 进程运行 `tui_gateway/slash_worker.py`，其中导入了 HermesCLI 命令注册表。每个 slash 请求包含：
- `id`（序列号，递增）
- `command`（原始命令字符串，如 `"/model anthropic/claude-opus-4.7"`）

worker 解析命令，调用对应的 CLI 处理器，然后通过 stdout 返回 JSON 结果（`{"id": N, "ok": true, "output": "..."}`）。gateway 在超时（默认 45 秒，通过 `HERMES_TUI_SLASH_TIMEOUT_S` 环境变量可调）后等待响应。

**为什么需要持久化子进程？** HermesCLI 的命令处理模块导入了大量依赖（配置加载、模型解析、插件系统等）。每次 import 都需要数百毫秒——对用户感知的斜杠命令延迟来说太慢。通过保持一个预热的 Python 进程，slash 命令在 10-50ms 内返回，远低于 45 秒超时限制。

### 3.3 模型切换特殊路径

`/model` 命令是一个特殊情况。虽然它通过 `_SlashWorker` 委托，但 `tui_gateway/server.py` 中的 `_apply_model_switch()` 函数实现了**完整的切换流程**：

1. 通过 `hermes_cli.model_switch.switch_model()` 解析用户输入并验证提供商/模型
2. 成功时调用 `agent.switch_model()` 热切换到新的模型/提供商/API Key
3. 重启 `_SlashWorker`（因为 worker 通过 `--model` 参数持有旧模型引用）
4. 将 `HERMES_MODEL` 和 `HERMES_INFERENCE_PROVIDER` 环境变量写入进程环境
5. 如果 `persist_global=True`，将更改保存到 `~/.hermes/config.yaml`

---

## 四、皮肤/主题系统

Hermes 的皮肤系统（`hermes_cli/skin_engine.py`）是一个**纯数据驱动**的 CLI 主题框架——添加新主题不需要修改任何 Python 代码，只需编写一个 YAML 文件。

### 4.1 SkinConfig 数据结构

```python
@dataclass
class SkinConfig:
    name: str
    description: str = ""
    colors: Dict[str, str] = field(default_factory=dict)
    spinner: Dict[str, Any] = field(default_factory=dict)
    branding: Dict[str, str] = field(default_factory=dict)
    tool_prefix: str = "┊"
    tool_emojis: Dict[str, str] = field(default_factory=dict)
    banner_logo: str = ""    # Rich-markup ASCII 艺术 logo
    banner_hero: str = ""    # Rich-markup hero 艺术
```

每个皮肤 YAML 可自定义以下维度：

| 维度 | 字段 | 说明 |
|------|------|------|
| **颜色** | `colors` | 18+ 个色槽（banner 边框/标题/文字、UI accent/label/ok/error/warn、提示符、输入线、响应边框、状态栏各状态色等） |
| **旋转器** | `spinner` | 等待时的 kaomoji 表情列表、思考时的表情列表、动词列表（如 "forging"、"marching"）、翅膀装饰 `[左, 右]` |
| **品牌化** | `branding` | Agent 名称、欢迎语、告别语、响应标签、提示符符号、帮助头部文字 |
| **工具** | `tool_prefix`、`tool_emojis` | 工具输出行前缀字符（默认 `┊`），按工具自定义 emoji 覆盖 |

颜色使用标准化键名（`banner_border`、`status_bar_good`、`completion_menu_bg` 等），一个皮肤的 `get_color(key, fallback)` 方法访问。如果皮肤未指定某颜色，自动继承自 `default` 皮肤。

### 4.2 内置皮肤

Hermes 内置了 9 种皮肤，覆盖从暗色到亮色的全频谱：

| 皮肤名 | 主题 | 特色 |
|--------|------|------|
| `default` | 金色经典 | 温暖的 Hermes 金，kawaii 表情旋转器 |
| `ares` | 深红战神 | 绯红+青铜色系，自定义 ASCII banner、翅膀装饰为剑盾 |
| `mono` | 灰度单色 | 洁净的专业灰阶，无表情装饰 |
| `slate` | 冷蓝开发者 | 蓝灰色调，面向开发者 |
| `daylight` | 亮色主题 | 为浅色终端设计的深色文字+蓝色点缀 |
| `warm-lightmode` | 暖光模式 | 棕金色文字，适合浅色背景终端 |
| `poseidon` | 海神深蓝 | 深蓝+海沫色，自定义 ASCII banner、波浪翅膀 |
| `sisyphus` | 西西弗斯灰度 | 克制的灰白色，带 "the boulder" 主题 |
| `charizard` | 火山橙 | 焦橙+火焰色，带炭火芝龙主题 |

每种内置皮肤都定义在 `skin_engine.py` 的 `_BUILTIN_SKINS` 字典中。以 `ares` 皮肤为例，它不仅重新映射了所有颜色，还定义了自定义 verb 列表（`"hammering plans"`、`"tempering steel"`、`"raising the shield"` 等）和翅膀对（`⟪⚔ ⚔⟫`），产生了一种"战神锻造"的主题氛围。

### 4.3 用户皮肤与加载流程

用户皮肤以 YAML 文件形式存放在 `~/.hermes/skins/<name>.yaml`。加载优先级为：

1. **用户皮肤优先**：`~/.hermes/skins/<name>.yaml` 存在时优先使用
2. **内置皮肤回退**：未找到用户皮肤时检查内置列表
3. **默认回退**：两者都不存在时使用 `default` 皮肤

```python
def load_skin(name: str) -> SkinConfig:
    skins_path = _skins_dir()
    user_file = skins_path / f"{name}.yaml"
    if user_file.is_file():
        data = _load_skin_from_yaml(user_file)
        if data:
            return _build_skin_config(data)
    if name in _BUILTIN_SKINS:
        return _build_skin_config(_BUILTIN_SKINS[name])
    return _build_skin_config(_BUILTIN_SKINS["default"])
```

启动流程：`init_skin_from_config()` 在 CLI 初始化时调用，从 `config.yaml` 的 `display.skin` 读取皮肤名，然后调用 `set_active_skin()` 加载。

```python
def init_skin_from_config(config: dict) -> None:
    display = config.get("display") or {}
    skin_name = display.get("skin", "default")
    set_active_skin(skin_name.strip())
```

运行时切换：用户执行 `/skin <name>` 时，`set_active_skin(name)` 立即替换缓存中的 `_active_skin`，所有后续的皮肤访问都通过 `get_active_skin()`（返回缓存的 `SkinConfig`）获取新皮肤的配置。

### 4.4 prompt_toolkit 样式桥接

皮肤系统通过 `get_prompt_toolkit_style_overrides()` 将皮肤颜色映射到 CLI 的 prompt_toolkit 样式字典。该函数从当前皮肤的 `colors` 中提取对应色值，生成 prompt_toolkit 可识别的样式字符串（如 `"bg:#1a1a2e #FFD700 bold"`）的字典。**关键设计约束**：用户输入的文本不使用皮肤颜色（继承终端默认前景色），只有提示符符号和 UI chrome 被上色——确保皮肤在浅色和深色 Terminal.app 中都可读。

---

## 五、Dashboard 嵌入：真实 TUI，非重写

Hermes Dashboard（通过 `hermes dashboard` 启动的 Web UI）的 Chat 页面采用了一个关键设计原则：**绝不在 React 中重新实现聊天体验**。相反，它通过 xterm.js 嵌入真实的 `hermes --tui` 进程。

### 5.1 架构全景

```
浏览器 ────────────────────────────────────── FastAPI ────── POSIX PTY
│                                              │                │
│  web/src/pages/ChatPage.tsx                  │  /api/pty      │ PtyBridge
│  ┌──────────────────────────────────┐        │  WebSocket     │  │
│  │ xterm.js Terminal (WebGL)        │◄──────►│  handler      │  ▼
│  │  · onData → ws.send(keystrokes)  │        │               │ node entry.js
│  │  · onResize → ws.send(RESIZE)    │        │               │   │ stdio JSON-RPC
│  │  · write(bytes) ← onmessage      │        │               │ python tui_gateway
│  │  · addon-fit (自适应)             │        │               │   │
│  │  · addon-unicode11 (宽字符)       │        │               │ AIAgent → API
│  │  · addon-webgl (硬件加速渲染)     │        │               │
│  └──────────────────────────────────┘        │                │
│  ChatSidebar (React)                          │                │
│   · 模型选择器                               │                │
│   · 工具调用列表                             │                │
│   · 会话信息                                 │                │
└──────────────────────────────────────────────┘                │
```

### 5.2 xterm.js 集成细节

`ChatPage.tsx` 创建一个 `xterm.js` `Terminal` 实例：

```typescript
const term = new Terminal({
  allowProposedApi: true,
  cursorBlink: true,
  fontFamily: "'JetBrains Mono', 'Cascadia Mono', ...",
  fontSize: terminalFontSizeForWidth(tierW0),
  lineHeight: terminalLineHeightForWidth(tierW0),
  macOptionIsMeta: true,
  macOptionClickForcesSelection: true,
  rightClickSelectsWord: true,
  scrollback: 5000,
  theme: TERMINAL_THEME,  // 暗绿背景 + 奶油前景，配合 dashboard 主题
});
```

加载的 addon：
- **`WebglAddon`**：在大屏设备上（>=768px 宽）使用 GPU 加速渲染。小屏使用 canvas/DOM 渲染器，保持字体尺寸准确
- **`FitAddon`**：响应容器大小变化，自动校准终端行列数。双 rAF 策略确保在 CSS 过渡/字体加载后的**最终稳定尺寸**上进行测量
- **`Unicode11Addon`**：支持 Unicode 11 宽字符（如 emoji 和 CJK 字符）
- **`WebLinksAddon`**：自动识别并高亮 URL

**剪贴板集成**：xterm 终端实现了三级剪贴板路径：
1. **Ink 选择 → OSC 52**：TUI 内选择文字时，Ink 发出 OSC 52 转义序列；xterm 的 `registerOscHandler(52)` 解码并写入浏览器剪贴板
2. **Ctrl/Cmd+Shift+C**：直接在 xterm 选择器上操作，绕过 Ink 选择模型（用于覆盖层/选择器场景）
3. **Ctrl/Cmd+Shift+V**：从浏览器剪贴板读取并以 bracketed-paste 格式送入终端

**SGR 鼠标报告过滤**：Web 嵌入中一个精妙的防御性设计——xterm.js 在鼠标追踪模式下会发出原始 CSI SGR 报告（`\x1b[<...`），如果将这些报告作为普通字节转发到 PTY，可能导致输入行中出现杂散字符。`onData` 处理器中的正则 `/^\x1b\[<(\d+);(\d+);(\d+)([Mm])$/` 匹配并丢弃这些报告。

### 5.3 PtyBridge：POSIX 伪终端桥接

`hermes_cli/pty_bridge.py` 是将 WebSocket 字节流连接到子进程 PTY 的核心组件。它是一个轻量级包装器，围绕 `ptyprocess.PtyProcess` 构建：

```python
class PtyBridge:
    def spawn(cls, argv, *, cwd=None, env=None, cols=80, rows=24) -> "PtyBridge":
        proc = ptyprocess.PtyProcess.spawn(list(argv), cwd=cwd, env=env, dimensions=(rows, cols))
        return cls(proc)

    def read(self, timeout=0.2) -> Optional[bytes]:
        # select.poll → os.read(65536) → 返回原始字节
        # 返回 None = 子进程已退出；返回 b"" = 无数据

    def write(self, data: bytes) -> None:
        # memoryview 循环直到写完，处理短写

    def resize(self, cols, rows) -> None:
        # TIOCSWINSZ ioctl → 通知子进程终端大小变化

    def close(self):
        # SIGHUP → SIGTERM → SIGKILL 升级，0.5s 间隔
```

**设计约束**：
- **纯 POSIX**：依赖 `fcntl`、`termios`、`ptyprocess`。Windows 本地不支持（需 WSL），导入失败时抛出 `PtyUnavailableError`，dashboard 的 `/chat` 标签显示 WSL 推荐横幅
- **零 Node 依赖（服务端）**：不需要 Node.js 作为中间层。浏览器直接连接到运行 `hermes --tui` 的同一二进制文件
- **字节安全 I/O**：所有读写通过 PTY master fd 直接进行原始字节操作。避免使用 `PtyProcessUnicode`——ANSI 流本质上是字节导向的，UTF-8 边界可能在读取中间断裂

### 5.4 WebSocket 端点

FastAPI 的 `/api/pty` WebSocket 端点（在 `web_server.py` 中）处理 chat 页面的连接：

1. 验证查询参数中的 `token`（在 loopback 模式下使用 session token，在 gated 模式下使用 minted ticket）
2. 检查 `channel` 参数——支持 sidecar 频道（用于 ChatSidebar 的独立 JSON-RPC 连接）
3. 调用 `PtyBridge.spawn()` 启动 `hermes --tui` 作为子进程
4. 一个 executor 线程循环读取 PTY 输出 → 通过 WebSocket 发送给浏览器
5. WebSocket 接收浏览器按键 → `bridge.write()` 写入 PTY

**崩溃恢复**：如果 PTY 子进程意外退出，WebSocket 保持打开。浏览器收到退出通知，可以在不刷新页面的情况下重新连接。

### 5.5 "不重写聊天"原则

Dashboard 的 ChatSidebar（`ChatPage.tsx` 中的 React 组件）通过**侧边栏频道**提供结构化 UI（模型切换器、工具调用日志、会话信息），但聊天**内容本身始终通过 xterm.js 终端渲染**。这意味着：

- 每个 TUI 功能（slash popover、model picker、tool rows、Markdown 渲染、skin engine、clarify/sudo/approval 提示）都自动在 Web 中可用——无需 React 重写
- 新 TUI 功能不需等待 Web UI 适配才能发布
- 用户看到的内容与 CLI 完全一致

---

## 六、经典 CLI 对比

作为对比，经典 CLI（`cli.py` → `prompt_toolkit`）的交互界面与 TUI/Dashboard 走的是完全不同的路径：

| 维度 | 经典 CLI | TUI（Ink） | Dashboard |
|------|----------|------------|-----------|
| **输入** | `prompt_toolkit` 的 `PromptSession`，支持自动补全、语法高亮 | Ink `useComposerState` + 原生 stdin 键盘处理 | xterm.js `onData` → WebSocket → PTY |
| **渲染** | Rich 库（Panel、Table、Markdown） | Ink React 组件树（`ScrollBox`、`Box`、`Text`） | xterm.js Terminal（WebGL canvas） + React 侧边栏 |
| **旋转器** | `KawaiiSpinner` — 动画 kaomoji 表情（`(◕‿◕)`、`(⚔)` 等），带皮肤自定义 | 同样的 spinner 逻辑，通过 `gateway.stderr` 事件显示在 state 中 | 通过 PTY ANSI 输出传递，在 xterm 中自然渲染 |
| **主题/换肤** | `skin_engine.py` — 纯数据驱动，初始化时加载，运行时通过 `/skin` 切换 | 皮肤的 `colors` 字典通过 `session.info` 事件同步到 TUI 的 `theme` store | Dashboard 有独立的 CSS 主题系统（default / midnight / ember / mono / cyberpunk / rose），终端部分使用皮肤颜色 |
| **横幅/Banner** | Rich-markup ASCII logo，带皮肤颜色 | 同样通过皮肤系统渲染 | Dashboard 有独立的 UI chrome，不显示 CLI 横幅 |
| **会话管理** | `PromptSession` 本地状态 | `useSessionLifecycle` hook → `session.create` / `session.resume` / `session.close` JSON-RPC | Dashboard 的 SessionsPage REST API |

经典 CLI 的 `prompt_toolkit` 自动补全是纯客户端的（从命令注册表中构建），而 TUI 模式下的补全通过 `complete.slash` 和 `complete.path` JSON-RPC 方法从 Python 后端**按需获取**——这确保了补全结果反映当前的会话状态（如会话列表、活跃工具集、当前目录文件等）。

---

## 七、总结：架构选择背后的设计哲学

Hermes 的 TUI/Dashboard 架构体现了几个核心设计决策：

1. **终端优先，Web 嵌入而非重写**：xterm.js + PTY 架构确保所有功能零成本到达 Web。TUI 新功能自动在 Dashboard 中可用。

2. **跨语言边界清晰**：TypeScript 负责交互和渲染，绝不做"业务逻辑"。Python 拥有全部会话状态、工具调用、模型通信和命令执行。

3. **事件驱动 + 阻塞提示混用**：流式 token 通过高频事件传递（无阻塞），但审批/提权/澄清通过阻塞式 request-response 模式实现——两种范式在同一条 JSON-RPC 通道上共存。

4. **皮肤系统纯数据驱动**：添加主题不需要代码变更——一个 YAML 文件即可完成颜色、表情、品牌文字和 ASCII art 的全面定制。第三方可以通过 `~/.hermes/skins/` 自由分发主题。

5. **持久化子进程降低延迟**：`_SlashWorker` 避免了每条 slash 命令都重新导入 HermesCLI 依赖的开销。这是"冷启动慢、热路径快"策略在 TUI 中的体现。

6. **故障隔离**：Gateway 崩溃（Python 进程退出）不会使整个 TUI 崩溃——TypeScript 端捕获 `exit` 事件并显示错误消息，用户可以重新启动。同理，PTY 子进程退出不会断开 WebSocket。

---

## 八、参考资料

- 源码：`ui-tui/`、`tui_gateway/`、`hermes_cli/skin_engine.py`、`hermes_cli/pty_bridge.py`、`hermes_cli/web_server.py`、`web/`
- 项目：https://github.com/NousResearch/hermes-agent
- 文档：https://hermes-agent.nousresearch.com/docs
