# A2A 章节重构实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在 `docs/a2a/` 新增「入门基础」2 篇 + 重写导航页 + 侧栏重组为两层 + 现有 6 篇教学化改造并纠正 v0.x→v1.0 规范。

**Architecture:** 最小侵入。新内容放 `getting-started/`；现有 6 篇文件名不动（仅 00 标题改「协议总览」），加三件套同时逐篇纠正过时 API（方法名、字段、枚举）。

**Tech Stack:** VitePress 1.5 + Markdown + mermaid（注意避开 `[]`/`{}`/`<br/>`/全角括号）。

**Spec:** `docs/superpowers/specs/2026-06-17-a2a-refactor-design.md`

---

## ⚠️ v1.0 事实纠正清单（贯穿所有 Task）

**每次写示例/方法名/字段时，对照这张表**：

| 维度 | ❌ v0.x 旧（现有文档） | ✅ v1.0 正确 |
|------|------------------------|-------------|
| 角色 | Client Agent / Remote Agent | **A2A Client** / **A2A Server（别名 Remote Agent）** |
| Card 路径 | `/.well-known/agent.json` | **`/.well-known/agent-card.json`** |
| Card URL 字段 | 顶层 `url` | **`supportedInterfaces[].url`** |
| capabilities | 含 `stateTransitionHistory` | **仅 streaming / pushNotifications / extensions / extendedAgentCard** |
| Part | `kind: text/file/data` | **单 Part 对象，OneOf text / raw / url / data** |
| Message.role | `user` / `agent` | **`ROLE_USER` / `ROLE_AGENT`** |
| Task 状态 | `submitted` / `working` / ... | **`TASK_STATE_SUBMITTED` / `TASK_STATE_WORKING` / `TASK_STATE_COMPLETED` / `TASK_STATE_FAILED` / `TASK_STATE_CANCELED`（注意单 L）/ `TASK_STATE_INPUT_REQUIRED` / `TASK_STATE_REJECTED` / `TASK_STATE_AUTH_REQUIRED`** |
| 方法名 | `message/send` 等 | **`SendMessage` / `SendStreamingMessage` / `GetTask` / `ListTasks` / `CancelTask` / `SubscribeToTask` / `CreateTaskPushNotificationConfig` 等（PascalCase）** |
| 终态 | 部分遗漏 | **completed / failed / canceled / rejected 四个终态** |
| 传输 | 仅 HTTP+JSON-RPC+SSE | **gRPC + JSON-RPC + HTTP/REST + 自定义** |

---

### Task 1: 入门 00 `getting-started/00-what-is-a2a.md`

**Files:** Create `docs/a2a/getting-started/00-what-is-a2a.md`

**大纲（4 节，150-220 行，curl 演示，生活化比喻）：**

- `# 什么是 A2A 协议`
- 开篇引言：一句话定位 + 本节你将学到
- `## 为什么需要 Agent 间协议` — 真实场景（客服转财务、IDE 转安全审计），私有 API 对接痛点（适配爆炸、难发现、长任务无统一模型、易暴露内部）。比喻：**A2A 像「公司间协作流程」——不同公司用统一的外发公文格式，而不是各自发明**
- `## A2A 是什么` — 开放协议定义；核心特点（跨框架、跨厂商、不暴露内部）；一句话理解。强调 **opaque execution**（协作但不公开内部思考/工具/记忆）
- `## 两个核心角色` — 用「委托方/承包方」比喻：
  - **A2A Client**（发起方，委托方）：发现 Agent、读 Card、决定委派、发消息、追踪任务
  - **A2A Server**（Remote Agent，执行方，承包方）：暴露 Card、收消息、返回 Message/Task、更新状态、产出 Artifact。强调 Server 内部可以是任意实现（LangGraph/ADK/自研/人工），A2A 不管
- `## Agent Card：Agent 的「名片」` — 用「企业黄页」比喻。Card 是机器可读的能力声明（不是说明文档）。发现路径 `GET /.well-known/agent-card.json`（**v1.0 正确**）。贴极简 Card 示例（含 name/description/supportedInterfaces/capabilities/skills，**用 v1.0 字段**）：
  ```json
  {
    "name": "Code Review Agent",
    "description": "Reviews source code and returns findings.",
    "supportedInterfaces": [{"url": "https://agents.example.com/a2a"}],
    "capabilities": {"streaming": true, "pushNotifications": false},
    "skills": [{"id": "review_code", "name": "Review Code", "description": "...", "tags": ["security"]}]
  }
  ```
- 结尾动手实验 3 项（找官方 demo 的 Card、读字段、对比两个不同 Agent 的 Card）

- [ ] Step 1: 按大纲撰写文件（用 v1.0 术语）
- [ ] Step 2: 校对无 v0.x 旧术语
  Run: `grep -nE "Client Agent|agent\.json|message/send|stateTransitionHistory" docs/a2a/getting-started/00-what-is-a2a.md`
  Expected: 无输出
- [ ] Step 3: Commit
  `git add docs/a2a/getting-started/00-what-is-a2a.md && git commit -m "docs(a2a): 新增入门篇 00 什么是 A2A"`

---

### Task 2: 入门 01 `getting-started/01-first-call.md`

**Files:** Create `docs/a2a/getting-started/01-first-call.md`

**大纲（5 分钟跑通 A2A 最小闭环）：**

- `# 第一次调用 A2A：5 分钟跑通`
- 开篇：用 curl 跑通「发现 Agent → 发消息 → 拿结果」最小闭环
- `## 第一步：发现 Agent` — `curl https://agents.example.com/.well-known/agent-card.json`（**v1.0 路径**），逐字段解读返回 Card（supportedInterfaces[].url 是真正端点、capabilities 告诉你支不支持流式、skills 告诉你能力）
- `## 第二步：发消息` — 用 `SendMessage`（**v1.0 PascalCase**）方法名。完整 JSON-RPC 2.0 envelope：
  ```bash
  curl -X POST https://agents.example.com/a2a \
    -H "Content-Type: application/json" \
    -d '{
      "jsonrpc": "2.0",
      "id": "req-001",
      "method": "SendMessage",
      "params": {
        "message": {
          "messageId": "msg-001",
          "role": "ROLE_USER",
          "parts": [{"text": "请用一句话介绍你的能力"}]
        }
      }
    }'
  ```
  逐行拆解：jsonrpc 版本、id 请求追踪、method（**SendMessage**）、params.message（**messageId/role=ROLE_USER/parts**）
- `## 第三步：看返回` — 两种可能：直接 Message（短回答）/ Task（长任务）。分别贴响应 JSON，解读关键字段（result.kind=message/task、role=ROLE_AGENT、parts、或 status.state=**TASK_STATE_WORKING**）
- `## 最常见的 3 个错误`：
  - 404 — Card 路径错（用了 `agent.json` 旧路径）
  - 认证失败 — 没带 `securitySchemes` 要求的 Bearer Token
  - JSON-RPC 格式错 — 缺 `jsonrpc`/`id`，或方法名用了 `message/send` 旧名（**强调 v1.0 是 `SendMessage`**）
- 动手实验 3 项（用官方 demo 端点实跑、换不同 message 内容、故意用旧方法名看报错对比）

- [ ] Step 1: 按大纲撰写
- [ ] Step 2: 校对（同 Task 1 Step 2 的 grep，预期无输出）
- [ ] Step 3: Commit

---

### Task 3: 重写 `index.md`（标题不改）

**Files:** Modify `docs/a2a/index.md`（全文替换）+ 同步 `README.md`

**新内容要点（标题保留「A2A 协议系统学习」）：**

- 顶部一句话定位：温和措辞「用最简单的 curl 调用，一步步理解 Agent 间协作的底层协议」
- 「从哪开始」表（三行）：
  - 零基础 → 入门基础 → [00 什么是 A2A](./getting-started/00-what-is-a2a.md)
  - 想深入协议细节 → 协议详解 → [协议总览](./00-a2a-from-zero.md)
  - 想实现 Agent Server → 协议详解 → [实现指南](./05-implementation-guide.md)
- 两段式目录表：
  - **入门基础**（2 篇：00 什么是 A2A / 01 第一次调用）
  - **协议详解**（6 篇：协议总览 / Agent 发现与名片 / 消息与任务模型 / 协议方法 / 安全架构 / 实现指南）
- 「为什么需要学这个」：保留现有 6 个学习目标问题，措辞改友好
- 学习路径：先入门 2 篇 → 再协议详解 6 篇
- 官方资料链接保留

- [ ] Step 1: Write 整体替换 index.md
- [ ] Step 2: 校对所有链接文件存在
  Run: `grep -oE '\./[a-z0-9/-]+\.md' docs/a2a/index.md | sort -u` 后逐一对账
- [ ] Step 3: `cp index.md README.md` 同步
- [ ] Step 4: Commit

---

### Task 4: 改 `config.ts` 侧栏为两组 + 00 标题

**Files:** Modify `docs/.vitepress/config.ts:433-442`

**改动**：把 `/a2a/` 下单个 sidebar group 改为两个 group（入门基础 / 协议详解），并把 00 的 text 从「从零理解 A2A」改「协议总览」。

旧（line 433-442 区域）：
```ts
      '/a2a/': [
        {
          text: '协议规范',
          items: [
            { text: '从零理解 A2A', link: '/a2a/00-a2a-from-zero' },
            { text: 'Agent 发现与名片', link: '/a2a/01-agent-discovery-card' },
            { text: '消息与任务模型', link: '/a2a/02-message-task-model' },
            { text: '协议方法', link: '/a2a/03-protocol-methods' },
            { text: '安全架构', link: '/a2a/04-security-architecture' },
            { text: '实现指南', link: '/a2a/05-implementation-guide' },
          ]
        }
```

新：
```ts
      '/a2a/': [
        {
          text: '入门基础',
          items: [
            { text: '什么是 A2A', link: '/a2a/getting-started/00-what-is-a2a' },
            { text: '第一次调用 A2A', link: '/a2a/getting-started/01-first-call' },
          ]
        },
        {
          text: '协议详解',
          items: [
            { text: '协议总览', link: '/a2a/00-a2a-from-zero' },
            { text: 'Agent 发现与名片', link: '/a2a/01-agent-discovery-card' },
            { text: '消息与任务模型', link: '/a2a/02-message-task-model' },
            { text: '协议方法', link: '/a2a/03-protocol-methods' },
            { text: '安全架构', link: '/a2a/04-security-architecture' },
            { text: '实现指南', link: '/a2a/05-implementation-guide' },
          ]
        }
```

- [ ] Step 1: Edit 精确替换
- [ ] Step 2: Commit

---

### Task 5: 教学化 + v1.0 纠正 `00-a2a-from-zero.md`

**Files:** Modify `docs/a2a/00-a2a-from-zero.md`（557 行）

**改动**：
1. **标题改** `# 协议总览`（删去「00 - 从 0 开始学习」）
2. **删除 §1「A2A 解决什么问题」、§2「核心角色」**（与入门 00 重叠，入门篇已覆盖）——但保留 §2 里关于 Agent Card 的部分挪到 §3 前
3. **全篇 v1.0 纠正**：
   - `/.well-known/agent-card.json`（不是 agent.json 或 agent-card.json 旧路径混淆——现有文档 §2 用了 `agent-card.json`，但 §6 也用了同路径，统一确认）
   - `Client Agent` → `A2A Client`、`Remote Agent` → `A2A Server (Remote Agent)`
   - Message.role：`user`/`agent` → `ROLE_USER`/`ROLE_AGENT`
   - Part：去掉 `kind` discriminator，改为单一 Part（OneOf text/raw/url/data）
   - Task 状态表：全部加 `TASK_STATE_` 前缀，补充 `REJECTED`、`AUTH_REQUIRED`，标注 4 个终态
   - JSON-RPC 方法：`message/send`→`SendMessage`、`message/stream`→`SendStreamingMessage`、`tasks/get`→`GetTask`、`tasks/cancel`→`CancelTask`，补充 `ListTasks`、`SubscribeToTask`
   - `capabilities.stateTransitionHistory` → 删除（v1.0 无）
4. **加三件套**：
   - 开篇引言（承入门篇 01，点明本节是「协议全景地图」）
   - 保留 §3-§10 技术内容（数据模型/JSON-RPC/操作/流程/安全/实现清单/误区/术语）
   - 删除 §7「A2A 与 MCP 的区别」（用户明确不要 MCP 对比）
   - 结尾动手实验 4 项 + 速查表（保留并精简现有 §12 术语表）

- [ ] Step 1: 标题改、删 §1/§2 重叠内容、删 §7 MCP 对比
- [ ] Step 2: 全篇 v1.0 术语/字段/方法名纠正（用 `grep` 逐一确认无残留）
- [ ] Step 3: 加开篇引言 + 结尾动手实验
- [ ] Step 4: 校对
  Run: `grep -nE "Client Agent|agent\.json(?!-card)|message/send|tasks/get|tasks/cancel|stateTransitionHistory" docs/a2a/00-a2a-from-zero.md`
  Expected: 无输出（注意 agent.json 是 agent-card.json 的前缀，正则用负向先行）
- [ ] Step 5: Commit

---

### Task 6: 教学化 + v1.0 纠正 `01-agent-discovery-card.md`

**Files:** Modify `docs/a2a/01-agent-discovery-card.md`（234 行）

**改动**：
1. **v1.0 纠正**：
   - `/.well-known/agent-card.json`（统一）
   - Card 字段：顶层 `url` → `supportedInterfaces[].url`；`capabilities` 去掉 `stateTransitionHistory`
   - 补充 v1.0 新字段：`signatures`、`iconUrl`、`extendedAgentCard`
2. **加三件套**：
   - 开篇引言（承协议总览，点明本节深入 Agent Card 这个「名片」）
   - 技术内容保留（Card 字段全解、Skill 定义、SecuritySchemes、发现机制、版本兼容）
   - 结尾动手实验 3 项 + 衔接下一节

- [ ] Step 1: v1.0 字段纠正
- [ ] Step 2: 加引言 + 动手实验
- [ ] Step 3: 校对（grep 同 Task 5）
- [ ] Step 4: Commit

---

### Task 7: 教学化 + v1.0 纠正 `02-message-task-model.md`

**Files:** Modify `docs/a2a/02-message-task-model.md`（288 行）

**改动**：
1. **v1.0 纠正**：
   - Message.role：`ROLE_USER`/`ROLE_AGENT`
   - Part：去掉 `kind` discriminator，改为单 Part OneOf text/raw/url/data
   - Task 状态枚举：全部 `TASK_STATE_` 前缀，补 `REJECTED`/`AUTH_REQUIRED`，标终态
2. **加三件套**（开篇引言 + 动手实验 + 衔接）

- [ ] Step 1: v1.0 Part/role/状态枚举纠正
- [ ] Step 2: 加引言 + 动手实验
- [ ] Step 3: 校对 + Commit

---

### Task 8: 教学化 + v1.0 纠正 `03-protocol-methods.md`

**Files:** Modify `docs/a2a/03-protocol-methods.md`（315 行，**重灾区**）

**改动**：
1. **v1.0 方法名纠正（最关键）**：
   - `message/send` → `SendMessage`
   - `message/stream` → `SendStreamingMessage`
   - `tasks/get` → `GetTask`
   - `tasks/cancel` → `CancelTask`
   - 补充 `ListTasks`、`SubscribeToTask`
   - `tasks/pushNotification/set` → `CreateTaskPushNotificationConfig`（+ Get/List/Delete）
2. **传输绑定纠正**：补充 gRPC、HTTP/REST（`POST /message:send` 等）、自定义绑定
3. **加三件套**

- [ ] Step 1: 全篇方法名 PascalCase 化（用 grep 逐一确认）
- [ ] Step 2: 加引言 + 动手实验
- [ ] Step 3: 校对
  Run: `grep -nE "message/send|message/stream|tasks/get|tasks/cancel|pushNotification/set" docs/a2a/03-protocol-methods.md`
  Expected: 无输出
- [ ] Step 4: Commit

---

### Task 9: 教学化 `04-security-architecture.md`（v1.0 纠正少）

**Files:** Modify `docs/a2a/04-security-architecture.md`（192 行）

**改动**：
1. **v1.0 纠正**（本篇偏安全概念，技术细节少，主要纠正术语）：
   - `Client Agent` → `A2A Client`、`Remote Agent` → `A2A Server`
   - 任何 Card 字段引用对齐 v1.0
2. **加三件套**

- [ ] Step 1: 术语纠正 + 加引言 + 动手实验
- [ ] Step 2: 校对 + Commit

---

### Task 10: 教学化 + v1.0 纠正 `05-implementation-guide.md`

**Files:** Modify `docs/a2a/05-implementation-guide.md`（292 行）

**改动**：
1. **v1.0 纠正**：
   - 所有 JSON-RPC 方法名 PascalCase 化
   - 所有示例 JSON 的 role/状态/Part 字段对齐 v1.0
   - Agent Card 示例对齐 v1.0（supportedInterfaces 等）
2. **加三件套**（开篇引言 + 动手实验 + 完整闭环表）

- [ ] Step 1: 全篇 v1.0 纠正
- [ ] Step 2: 加引言 + 动手实验
- [ ] Step 3: 校对 + Commit

---

### Task 11: 构建验证

- [ ] Step 1: `cd docs && npm run docs:build`
  Expected: 构建成功，无报错
- [ ] Step 2: `ls docs/.vitepress/dist/a2a/getting-started/` 确认 2 个 html
- [ ] Step 3: `ls docs/.vitepress/dist/a2a/00-a2a-from-zero.html docs/.vitepress/dist/a2a/05-implementation-guide.html` 确认现有 6 篇可达
- [ ] Step 4: 检查 mermaid 图（若有）渲染——grep 产物里 mermaid 标记数量正常
- [ ] Step 5: 最终全量 `git status` 确认无残留

---

## Self-Review

**Spec coverage：**
- 入门 2 篇（spec 入门篇大纲）→ Task 1-2 ✓
- index.md 重写（spec 第 3 节，标题不改）→ Task 3 ✓
- 侧栏两组（spec 第 1 节）→ Task 4 ✓
- 现有 6 篇教学化（spec 现有 6 篇改造规范）→ Task 5-10 ✓
- v1.0 事实纠正（spec ⚠️ 关键约束）→ Task 5-10 各自的 grep 校对 ✓
- 验证 → Task 11 ✓

**一致性检查：**
- `getting-started/` 路径在 Task 1-2 创建、Task 3 index 链接、Task 4 sidebar 三处一致 ✓
- 「协议总览」标题：Task 4 sidebar + Task 5 文件标题 两处一致 ✓
- v1.0 纠正清单在每个 Task 的 grep 校对里反复核对 ✓
