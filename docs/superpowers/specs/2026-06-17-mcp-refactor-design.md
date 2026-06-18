# MCP 章节重构设计：仿照 openai-api / a2a 标准样式

> 日期：2026-06-17
> 主题：将 `docs/mcp/` 章节重构为「入门基础 3 篇 + 协议详解 6 篇 + 实践模块 4 篇」三层结构 + 教学化包装

## 背景与动机

`docs/openai-api/` 和 `docs/a2a/` 已完成完整重构，形成了站点内一致的「标准样式」：
- `getting-started/` 子目录承载入门篇
- curl + JSON / 真实 SDK 主角、生活化比喻贯穿
- 三件套（开篇引言/动手实验/速查衔接）
- index.md 风格（从哪开始表 + 分段式目录 + 学习路径）

`docs/mcp/` 现有 10 篇文档（约 3000 行）是干涩的协议说明，缺少入门引导、缺少动手实验、index.md 是纯文字列表。用户要求按标准样式做一致性重构。

## 目标受众

**有 AI 应用开发经验但未接触过 MCP 的开发者**：
- 知道 LLM API、Function Calling 等概念
- 但对 MCP（Model Context Protocol）完全陌生
- 需要从「为什么需要工具接入标准」讲起

## 设计决策

### 策略：加入门篇 + 现有 10 篇全教学化

不删除、不重写现有技术内容，仅：
1. **新增** 3 篇入门基础
2. **重写** index.md 导航页（标题不改）
3. **教学化改造** 现有 10 篇（加三件套，技术内容全部保留）
4. **现有 00「从0」改名标题** 为「协议总览」，去掉与入门篇重叠的问题背景/核心角色部分

### 三层结构（与 openai-api 一致）

MCP 本身就有协议 + 实践两块，天然适合三层：

```
mcp/  （源头，docs/mcp/ 由 sync-docs.sh 生成）
├── index.md                      ← 重写（标题不改）
├── getting-started/              ← 【新增】入门基础（3 篇）
│   ├── 00-what-is-mcp.md
│   ├── 01-first-server.md
│   └── 02-primitives-tour.md
├── 00-mcp-from-zero.md           ← 现有，标题改「协议总览」（文件名不动）
├── 01-protocol-architecture.md   ← 现有，教学化
├── 02-server-capabilities.md     ← 现有，教学化
├── 03-client-capabilities.md     ← 现有，教学化
├── 04-transports-security.md     ← 现有，教学化
├── 05-implementation-guide.md    ← 现有，教学化
├── 10-mcp-server-python.md       ← 现有，教学化
├── 11-mcp-server-go.md           ← 现有，教学化
├── 12-mcp-client-integration.md  ← 现有，教学化
└── 13-mcp-advanced.md            ← 现有，教学化
```

### 代码示例：真实 SDK 为主

和前两个章节的差异：MCP 的 stdio 传输不适合 curl 演示。入门篇 01/02 用真实可运行代码（Python `mcp` SDK 最简，官方主推）。

### 不加「下一节预告」「进阶篇深入讲什么」

与前两个章节保持一致——入门篇每篇以「动手实验」自然收尾。

## 入门篇 3 篇内容大纲

| 文件 | 标题 | 核心内容 |
|------|------|---------|
| `getting-started/00-what-is-mcp.md` | 什么是 MCP 协议 | 为什么需要 MCP、MCP 定义、三角色（Host/Client/Server）、和 Function Calling 的区别 |
| `getting-started/01-first-server.md` | 第一次写 MCP Server | 装 SDK、写最小 Server（1 个 Tool）、stdio 启动、用 Claude Desktop/inspector 连接、常见错误 |
| `getting-started/02-primitives-tour.md` | 三大原语初体验 | Resources / Tools / Prompts 各一个最小例子，对比差异 |

**比喻清单：** MCP = USB-C 标准接口、Host = 手机、Client = USB 数据线、Server = U 盘/外设、Resources = 文件柜、Tools = 工具箱、Prompts = 模板库

## index.md 导航页改写要点

1. **标题不改**（保留「MCP 协议系统学习」）
2. 顶部一句话定位（温和措辞）
3. 「从哪开始」表（三行）
4. 三段式目录表（入门基础/协议详解/实践模块）
5. 「为什么需要学这个」（保留现有 8 个学习目标问题，改写友好）
6. 学习路径
7. 官方资料链接保留

## 现有 10 篇教学化改造规范

每篇遵循三件套模板：
1. **开篇引言**：blockquote，承上 + 「本节你将学到」+ 生活化比喻
2. **中间技术内容全部保留**
3. **结尾加**：动手实验（3-5 项）+ 速查/衔接

特殊处理：
- `00-mcp-from-zero.md`：标题改「协议总览」，去掉与入门篇重叠的「问题背景」「核心角色」部分

## 源头同步机制（关键）

MCP 有 sync 机制（`sync-docs.sh` 用 `rsync --delete` 从根 `mcp/` 同步到 `docs/mcp/`）。
**所有改动必须先在根 `mcp/` 做**，sync 会自动生成 `docs/mcp/`。吸取 a2a 的教训。

## 不破坏的承诺

- 现有 10 篇文件路径、文件名、外部链接全部保留
- 所有改动先在根 `mcp/`（源头）做
- `docs/mcp/` 由 sync 自动生成，幂等稳定
- 同步 `README.md`（index.md ≡ README.md 约定）

## 验证方式

- 本地 `npm run docs:build` 构建通过（含 sync）
- `docs/mcp/getting-started/` 生成 3 个 html
- 现有 10 篇 html 仍可达
- 侧栏三组名正确渲染
- **关键**：构建后检查 `docs/mcp/` 内容未被 sync 覆盖

## YAGNI 检查

- 不加第四层
- 不加 MCP vs A2A 对比（a2a 已有类似约束）
- 入门 01/02 用 Python SDK（官方主推），不强行用 curl
- 不动其他章节
