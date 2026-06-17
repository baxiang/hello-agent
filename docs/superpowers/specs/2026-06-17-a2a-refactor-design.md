# A2A 章节重构设计：仿照 openai-api 标准样式

> 日期：2026-06-17
> 主题：将 `docs/a2a/` 章节从「干涩列表式文档」重构为「仿 openai-api 的入门→详解两层结构 + 教学化包装」

## 背景与动机

`docs/openai-api/` 已完成完整重构（入门基础 4 篇 + 协议进阶 7 篇 + 工程实践 3 篇），形成了站点内一致的「标准样式」：
- `getting-started/` 子目录承载入门篇
- curl + JSON 为主角、生活化比喻贯穿
- 三件套（开篇引言/动手实验/速查衔接）
- index.md 风格（从哪开始表 + 分段式目录 + 学习路径）

`docs/a2a/` 现有 6 篇文档（约 1878 行）是干涩的协议说明，缺少入门引导、缺少动手实验、index.md 是纯文字列表。用户要求按 openai-api 标准样式做一致性重构。

## 目标受众

**有 Agent 经验但未接触过 A2A 的开发者**：
- 知道 Agent、Function Calling、MCP 等概念
- 但对 A2A（Agent2Agent 协议）完全陌生
- 需要从「为什么需要 Agent 间协议」讲起

## 设计决策

### 策略：加入门篇 + 现有 6 篇全教学化

不删除、不重写现有技术内容，仅：
1. **新增** 2 篇入门基础（curl + JSON 主角）
2. **重写** index.md 导航页（标题不改，其余仿 openai-api）
3. **教学化改造** 现有 6 篇（加三件套，技术内容全部保留）
4. **现有 00「从0」改名标题** 为「协议总览」，去掉与入门篇重叠的问题背景/核心角色部分

### 两层结构（非三层）

A2A 没有 openai-api 那样的「国产模型对比」横向内容，05-implementation-guide 本身就是工程实现指南，归入「协议详解」组自然。YAGNI——不做无意义的第三层。

```
docs/a2a/
├── index.md                      ← 重写（标题不改）
├── getting-started/              ← 【新增】入门基础（2 篇）
│   ├── 00-what-is-a2a.md
│   └── 01-first-call.md
├── 00-a2a-from-zero.md           ← 现有，标题改「协议总览」（文件名不动）
├── 01-agent-discovery-card.md    ← 现有，教学化
├── 02-message-task-model.md      ← 现有，教学化
├── 03-protocol-methods.md        ← 现有，教学化
├── 04-security-architecture.md   ← 现有，教学化
└── 05-implementation-guide.md    ← 现有，教学化
```

### 代码示例：curl + JSON 为主

入门篇全部用 `curl` + 原生 JSON 演示，不引入任何 SDK。现有 6 篇保留原有示例语言。

### 不加「下一节预告」「进阶篇深入讲什么」

与用户对 openai-api 入门篇的要求保持一致——入门篇每篇以「动手实验」自然收尾，不加预告小节。

## 入门篇 2 篇内容大纲

| 文件 | 标题 | 核心内容 |
|------|------|---------|
| `getting-started/00-what-is-a2a.md` | 什么是 A2A 协议 | ① 为什么需要 Agent 间协议（多 Agent 协作痛点，如客服转财务、IDE 转安全审计）② A2A 定义（「让一个 Agent 连接另一个 Agent 的开放协议」）③ 两个核心角色（Client Agent 发起方 / Remote Agent 执行方）④ Agent Card 是什么（「名片」比喻） |
| `getting-started/01-first-call.md` | 第一次调用 A2A：5 分钟跑通 | curl 演示最小闭环：① `GET /.well-known/agent.json` 拿 Agent Card ② `POST /` 发 JSON-RPC `message/send` ③ 看响应（messageId/taskId/artifacts）④ 常见错误（404/认证/JSON-RPC 格式） |

**比喻清单：** A2A = 公司间协作流程、Agent Card = 名片、Message = 工单、Task = 任务单、Artifact = 交付物

## index.md 导航页改写要点

1. **标题不改**（保留「A2A 协议系统学习」）
2. **顶部一句话定位**：温和措辞，如「用最简单的 curl 调用，一步步理解 Agent 间协作的底层协议」
3. **「从哪开始」表**（仿 openai-api）：零基础 / 想深入协议 / 想实现 Agent Server 三行
4. **两段式目录表**：入门基础（2 篇）+ 协议详解（6 篇）
5. **「为什么需要学这个」**：保留现有学习目标精华，改写为友好措辞
6. **学习路径**：先入门 2 篇 → 再协议详解 6 篇
7. **官方资料链接**保留

## 现有 6 篇教学化改造规范

每篇遵循 openai-api 协议进阶篇的三件套模板：

1. **开篇引言**：blockquote 形式，承上（连入门篇）+ 「本节你将学到」+ 生活化比喻
2. **中间技术内容全部保留**：JSON 示例、字段表格、代码不动
3. **结尾加**：动手实验（3-5 项）+ 速查/衔接下一节

特殊处理：
- **00-a2a-from-zero.md**：标题改「协议总览」，去掉与入门篇重叠的「问题背景」「核心角色」部分（入门篇已覆盖），保留状态机、流式事件等深度内容
- mermaid 图（若有）避免 openai-api 踩过的坑：不用 `[]`/`{}`/`<br/>`/全角括号

## 不破坏的承诺

- 现有 6 篇文件路径、git 历史、外部链接全部保留
- 不改任何现有文件名（仅改 00 的标题文本）
- 仅用 `getting-started/` 子目录承载新内容
- 同步 `README.md`（index.md ≡ README.md 约定）

## 验证方式

- 本地 `npm run docs:build` 构建通过、无报错
- 抽查 `dist/a2a/getting-started/` 生成 2 个 html
- 现有 6 篇 html 仍可达
- 侧边栏两组名正确渲染
- mermaid 图渲染正常

## YAGNI 检查

- 不加第三层「工程实践」组（A2A 无横向对比内容）
- 不加 MCP vs A2A 对比（用户明确不要）
- 不引入 Python/Go SDK 示例（curl + JSON 够入门）
- 不加交互式 playground
- 不动 `openai-api/` 章节（已完成）

## ⚠️ 关键约束：v1.0 规范事实纠正

经核实，**现有 6 篇文档大量使用 v0.x 旧规范**，与当前 v1.0 规范有多处重大出入。教学化改造**必须同时做事实纠正**，否则文档越改越错。主要差异：

| 维度 | 现有文档（v0.x 旧） | v1.0 正确 |
|------|---------------------|-----------|
| 角色术语 | Client Agent / Remote Agent | **A2A Client / A2A Server（Remote Agent）** |
| Agent Card 路径 | `/.well-known/agent.json` | **`/.well-known/agent-card.json`** |
| Card 顶层字段 | `url` 在顶层 | **`supportedInterfaces[].url`** |
| capabilities 字段 | 含 `stateTransitionHistory` | **仅 streaming / pushNotifications / extensions / extendedAgentCard** |
| Part 类型 | `kind: text/file/data` 区分 | **单一 Part，OneOf text / raw / url / data**（v1.0 移除 kind discriminator） |
| Message.role 值 | `user` / `agent` | **`ROLE_USER` / `ROLE_AGENT`** |
| Task 状态值 | `submitted` / `working` / ... | **`TASK_STATE_SUBMITTED` / `TASK_STATE_WORKING` / ...**（含 REJECTED、AUTH_REQUIRED） |
| JSON-RPC 方法名 | `message/send` / `message/stream` / `tasks/get` / `tasks/cancel` | **PascalCase：`SendMessage` / `SendStreamingMessage` / `GetTask` / `ListTasks`（新）/ `CancelTask` / `SubscribeToTask` / `CreateTaskPushNotificationConfig` 等** |
| 传输绑定 | 仅 HTTP+JSON-RPC + SSE | **gRPC + JSON-RPC + HTTP/REST + 自定义绑定**（SSE 是其中流式机制） |

**改造原则**：
- 现有 6 篇在加三件套的同时，**逐篇纠正上述旧规范**为新版
- 入门 2 篇直接用 v1.0 正确写法
- 保留现有文档的整体结构和讲解思路，只替换过时的方法名/字段名/枚举值

**参考来源**：A2A 官方规范 https://a2a-protocol.org/latest/specification/（Latest Released Version 1.0.0，2026-05-28 v1.0.1）
