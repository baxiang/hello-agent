# 核心组件融合进示例工程 — 实施计划

> **For agentic workers:** 本计划用并行 agent 执行文档融合。每个任务是一个独立的 agent dispatch，产出是索引页的「深度原理」节。验证靠 `vitepress build` + 链接检查。

**Goal:** 将 17 篇核心组件深度文的精华融入 14 个目标索引页，然后删除源文件。

**Architecture:** 方案 A — 每篇核心组件的接口源码/设计哲学/配置速查融入对应分类索引页的新增 `## 深度原理` 节。分 3 批并行 + 1 批手动收尾。

**Tech Stack:** Markdown / VitePress / 并行 subagent

**Spec:** `docs/superpowers/specs/2026-06-17-merge-core-components-into-examples-design.md`

---

## 通用 Agent 指令模板

每个 agent 收到统一结构：
1. **源文件**：要读的核心组件文件（`docs/trpc-agent-go/NN-xxx.md`）
2. **目标文件**：要增节的索引页（`docs/trpc-agent-go/examples/NN-xxx/yyy.md`）
3. **Exemplar**：先读 `06-memory-system/memory.md` 看既有索引页结构
4. **融合规则**：保留接口源码签名 + 设计哲学"为什么" + 完整配置速查表；丢弃冗长源码走读 + 重复的"如何使用"
5. **新增节位置**：在 `## 学习路径建议` 之前插入 `## 深度原理`
6. **禁止**：删除/修改索引页现有内容；触碰非目标文件；提交 git

---

## 批次 1：试点（4 任务，并行 + review 点）

### Task 1: 新建 01-agent-basics/index.md

**Files:**
- Read: `docs/trpc-agent-go/01-agent.md`（439 行）、`docs/trpc-agent-go/03-runner.md`（388 行）
- Create: `docs/trpc-agent-go/examples/01-agent-basics/index.md`

**Agent 要点：**
- 这是新建索引页（该分类原本无 index）
- 结构：`# Agent 基础` → 顶部源码路径锚点 → `## 子示例导航`（8 篇）→ `## 选型建议` → `## 核心概念` → `## 深度原理`（融合 01+03）→ `## 学习路径建议` → `## 总结`
- 深度原理节合并 01-agent（Agent 接口、Invocation 上下文、设计原理）和 03-runner（Runner 生命周期、Session/Memory 编排、Completion 事件）

### Task 2: 增节 06-memory/memory.md

**Files:**
- Read: `docs/trpc-agent-go/08-memory.md`（314 行）
- Modify: `docs/trpc-agent-go/examples/06-memory-system/memory.md`
- Exemplar: 先读该文件看现有结构

**Agent 要点：**
- 在 `## 学习路径建议` 前插入 `## 深度原理`
- 保留：Memory Service 接口签名、Extractor 设计哲学、Agentic vs Auto 的深层设计考量、完整配置速查表
- 丢弃：与子示例重复的接线代码（simple/auto 子文章已详述）

### Task 3: 双源合并 02-tool/tool.md

**Files:**
- Read: `docs/trpc-agent-go/05-tool.md`（347 行）、`docs/trpc-agent-go/06-tool-advanced.md`（377 行）
- Modify: `docs/trpc-agent-go/examples/02-tool-system/tool.md`
- Exemplar: 先读该文件看现有结构

**Agent 要点：**
- 两篇源文件合并进同一索引页的 `## 深度原理` 节
- 保留：Tool 接口签名、FunctionTool 机制、ToolSet 设计、工具权限/过滤/管道的设计原理、配置速查
- 丢弃：冗长的 OpenAPI 工具走读、与子示例重复的代码

### Task 4: 顶层 examples/README.md 增"协议服务端"节

**Files:**
- Read: `docs/trpc-agent-go/12-server.md`（238 行）
- Modify: `docs/trpc-agent-go/examples/README.md`
- Exemplar: 先读该文件看现有结构

**Agent 要点：**
- 12-server 跨 A2A/AG-UI/MCP 三协议，README 顶层最合适
- 在 README 适当位置（19 分类后）新增 `## 协议服务端总览` 节
- 保留：Server 架构、SSE 流式、协议选择对比表
- 丢弃：具体示例代码（子文章已覆盖）

### 批次 1 Review 点

- [ ] **Step R1: 本地 vitepress build**

Run: `cd docs && npx vitepress build`
Expected: build complete，无错误

- [ ] **Step R2: 检查无断链**

Run: `python3 /tmp/check_sidebar.py`（已有脚本）
Expected: 所有 sidebar 链接有效

- [ ] **Step R3: 人工抽查**

用户过目 `memory.md` 的深度原理节，确认范式 OK 后放行批次 2-3

---

## 批次 2：主力（6 任务，并行）

### Task 5: 增节 03-mcp/mcptool.md ← 15-mcp.md
### Task 6: 增节 04-graph/graph.md ← 10-graph.md + 11-graph-advanced.md + 02-agent-types.md（GraphAgent 部分）
### Task 7: 增节 05-multi/multiagent.md ← 02-agent-types.md（Chain/Parallel/Cycle 部分）
### Task 8: 增节 07-session/session.md ← 07-session.md
### Task 9: 增节 12-knowledge/knowledge.md ← 09-knowledge.md
### Task 10: 增节 13-model/model.md ← 04-model.md

**所有 Task 同一模板：** 读源 + 读目标 exemplar + 插入 `## 深度原理` 节 + 保留接口/哲学/配置表 + 丢弃走读。

**注意 Task 6+7：** 02-agent-types.md 要拆分——GraphAgent 部分进 Task 6（graph 索引），Chain/Parallel/Cycle 部分进 Task 7（multiagent 索引）。两个 agent 不能同时读改，但这里只读不改源，无冲突。

---

## 批次 3：收尾（4 任务，并行）

### Task 11: 新建 09-a2a-protocol/index.md ← 17-a2a.md
### Task 12: 新建 10-agui-protocol/index.md ← 16-agui.md
### Task 13: 增节 16-observability/callbacks.md ← 13-observability.md
### Task 14: 增节 docs/trpc-agent-go/index.md ← 14-ecosystem.md

**Task 11/12 是新建索引页**（同 Task 1 结构）。

---

## 批次 4：手动收尾

### Task 15: 删除 17 篇源文件 + 更新 config.ts

- [ ] **Step 1: 删除源文件**

```bash
cd /Users/baxiang/Documents/hello-agent
rm docs/trpc-agent-go/01-agent.md docs/trpc-agent-go/02-agent-types.md
rm docs/trpc-agent-go/03-runner.md docs/trpc-agent-go/04-model.md
rm docs/trpc-agent-go/05-tool.md docs/trpc-agent-go/06-tool-advanced.md
rm docs/trpc-agent-go/07-session.md docs/trpc-agent-go/08-memory.md
rm docs/trpc-agent-go/09-knowledge.md docs/trpc-agent-go/10-graph.md
rm docs/trpc-agent-go/11-graph-advanced.md docs/trpc-agent-go/12-server.md
rm docs/trpc-agent-go/13-observability.md docs/trpc-agent-go/14-ecosystem.md
rm docs/trpc-agent-go/15-mcp.md docs/trpc-agent-go/16-agui.md
rm docs/trpc-agent-go/17-a2a.md
```

- [ ] **Step 2: 更新 config.ts sidebar**

移除 538-569 行的 01-17 条目（"Agent 系统"等）。
新增 3 个 index 页的 sidebar 条目：
- `01-agent-basics/index` → "Agent 基础（原理）"
- `09-a2a-protocol/index` → "A2A 协议（原理）"
- `10-agui-protocol/index` → "AG-UI 协议（原理）"

- [ ] **Step 3: 更新 docs/trpc-agent-go/index.md 的导览链接**

移除指向已删 01-17 的链接，改为指向对应 examples 索引页。

- [ ] **Step 4: 全量 build 验证**

Run: `cd docs && npx vitepress build`
Expected: build complete，无错误

- [ ] **Step 5: 链接校验**

检查所有 .md 文件无指向已删文件的断链。

- [ ] **Step 6: 提交**

```bash
git add -A docs/trpc-agent-go/ docs/.vitepress/config.ts
git commit -m "refactor(docs): 融合核心组件进示例索引页，删除 17 篇源文件"
git push origin main
```
