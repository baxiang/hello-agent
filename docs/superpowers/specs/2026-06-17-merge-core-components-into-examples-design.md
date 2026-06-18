# 核心组件融合进示例工程设计

> **日期**：2026-06-17
> **状态**：已确认，待实施
> **作者**：baxiang + opencode

## 1. 目标

将 `docs/trpc-agent-go/` 顶层的 17 篇「核心组件深度文」（`01-agent.md` ~ `17-a2a.md`，共 7650 行）的精华内容，融合进 `docs/trpc-agent-go/examples/` 对应分类的索引页，然后删除这 17 篇源文件。

**动机**：
- 核心组件文偏「为什么这么设计 + 接口源码」，示例偏「怎么用」，两者互补但分离导致读者跳转成本高
- 示例文章已沉淀了实操内容，但缺少「设计原理 / 接口源码 / 配置速查」这类深度资料
- 融合后，每个分类的索引页升级为「原理 + 选型 + 导航」综合体，一处看全

## 2. 范围

### 删除（17 篇）
`docs/trpc-agent-go/01-agent.md` ~ `17-a2a.md`

### 保留（不动）
- `docs/trpc-agent-go/18-architecture.md`（跨组件架构综述）
- `docs/trpc-agent-go/19-diagrams.md`（跨组件 Mermaid 图集）
- `docs/trpc-agent-go/index.md`（顶层导览，会增节吸收 14-ecosystem）

## 3. 方案：进分类索引页（方案 A）

每篇核心组件的精华融入对应分类索引页的新增 `## 深度原理` 节。索引页从「纯导航」升级为「原理 + 选型 + 导航」。

### 3.1 映射表（17 源 → 14 目标）

| # | 目标索引页 | 源核心组件 | 类型 |
|---|----------|-----------|------|
| 1 | `examples/01-agent-basics/index.md` | `01-agent.md` + `03-runner.md` | 新建 |
| 2 | `examples/02-tool-system/tool.md` | `05-tool.md` + `06-tool-advanced.md` | 增节 |
| 3 | `examples/03-mcp-tools/mcptool.md` | `15-mcp.md` | 增节 |
| 4 | `examples/04-graph-workflow/graph.md` | `10-graph.md` + `11-graph-advanced.md` + `02-agent-types.md`（GraphAgent 部分） | 增节 |
| 5 | `examples/05-multi-agent/multiagent.md` | `02-agent-types.md`（Chain/Parallel/Cycle 部分） | 增节 |
| 6 | `examples/06-memory-system/memory.md` | `08-memory.md` | 增节 |
| 7 | `examples/07-session-management/session.md` | `07-session.md` | 增节 |
| 8 | `examples/09-a2a-protocol/index.md` | `17-a2a.md` | 新建 |
| 9 | `examples/10-agui-protocol/index.md` | `16-agui.md` | 新建 |
| 10 | `examples/12-knowledge-rag/knowledge.md` | `09-knowledge.md` | 增节 |
| 11 | `examples/13-model-provider/model.md` | `04-model.md` | 增节 |
| 12 | `examples/16-observability/callbacks.md` | `13-observability.md` | 增节 |
| 13 | `examples/README.md` | `12-server.md`（新增「协议服务端总览」节） | 增节 |
| 14 | `docs/trpc-agent-go/index.md` | `14-ecosystem.md`（融入生态总览） | 增节 |

**汇总**：
- 8 个已有索引页：增 `## 深度原理` 节
- 3 个新建索引页：`01-agent-basics/`、`09-a2a-protocol/`、`10-agui-protocol/`
- 2 处顶层：`examples/README.md`（server 总览）、`docs/trpc-agent-go/index.md`（生态）

### 3.2 「深度原理」节模板

```markdown
## 深度原理

> 本节源自原「核心组件」深度文，整合接口源码、设计哲学与配置速查。

### 核心接口

[关键接口/数据结构的 Go 源码签名，如 Invocation、Session、MemoryService]
[每个字段的简要说明]

### 设计哲学

[原「设计原理」节精华：为什么选 channel 而非回调、为什么分开计数等]
[保留有教学价值的"为什么"，删纯实现细节]

### 配置速查

[完整的 functional options 配置表，工具型内容]
| 配置 | 说明 | 默认值 |
|------|------|--------|
```

### 3.3 保留 / 丢弃分界

**保留**（核心组件独有、示例文章没有的）：
- ✅ 接口/数据结构的源码签名（`Invocation`、`Agent` 接口、`Session` 等）
- ✅ 设计原理的"为什么"（决策对比表、设计考量）
- ✅ 完整配置速查表（工具型，读者会回查）

**丢弃**（核心组件冗余、示例文章已覆盖的）：
- ❌ 冗长的源码逐行走读（示例文章有更实际的真实代码）
- ❌ 重复的"如何使用"代码（示例文章的主场）
- ❌ 过时截图、临时性内容

### 3.4 体量预测
- 现有索引页：~130-220 行
- 融入深度原理后：~350-450 行（+150-250 行）
- 仍小于原核心组件单篇（因为删了冗余走读）

## 4. 执行计划（分 3+1 批）

### 批次 1（试点，4 任务）— 验证范式
覆盖 4 种场景：新建 / 增节 / 双源合并 / 顶层
1. 新建 `examples/01-agent-basics/index.md`（← 01-agent + 03-runner）
2. 增节 `examples/06-memory-system/memory.md`（← 08-memory）
3. 双源合并 `examples/02-tool-system/tool.md`（← 05-tool + 06-tool-advanced）
4. 顶层 `examples/README.md`（← 12-server，新增「协议服务端总览」节）

**Review 点**：批次 1 完成后，用户过目一篇（如 `memory.md`），认可范式再放行后续。

### 批次 2（主力，6 任务）
5. `examples/03-mcp-tools/mcptool.md`（← 15-mcp）
6. `examples/04-graph-workflow/graph.md`（← 10-graph + 11-graph-advanced + 02 部分）
7. `examples/05-multi-agent/multiagent.md`（← 02-agent-types）
8. `examples/07-session-management/session.md`（← 07-session）
9. `examples/12-knowledge-rag/knowledge.md`（← 09-knowledge）
10. `examples/13-model-provider/model.md`（← 04-model）

### 批次 3（收尾，4 任务）
11. 新建 `examples/09-a2a-protocol/index.md`（← 17-a2a）
12. 新建 `examples/10-agui-protocol/index.md`（← 16-agui）
13. `examples/16-observability/callbacks.md`（← 13-observability）
14. `docs/trpc-agent-go/index.md`（← 14-ecosystem）

### 批次 4（手动收尾）
- 删除 17 篇核心组件源文件
- 更新 `docs/.vitepress/config.ts` sidebar（移除 01-17 条目；给 3 个新 index 页加 sidebar）
- 本地 `vitepress build` 验证
- 提交 + 推送

## 5. Sidebar 调整

`config.ts` 当前 538-569 行有 01-17 的 sidebar 条目。删除后：
- **移除** 这些条目（指向已删文件）
- **新增** 3 个 index 页的 sidebar 条目：
  - `01-agent-basics/index` → 加进现有「01 - Agent 基础」分类顶部
  - `09-a2a-protocol/index` → 加进现有「09 - A2A 协议」分类顶部
  - `10-agui-protocol/index` → 加进现有「10 - AG-UI 协议」分类顶部
- **保留** 18-architecture、19-diagrams、index 的 sidebar 条目

## 6. 验证标准

每批完成后：
1. 所有新增 `## 深度原理` 节包含真实接口源码（非杜撰）
2. 索引页内部链接、源码路径链接零断链
3. 本地 `vitepress build` 通过（关键：检查 Vue 模板语法 `{{}}` 等是否被误解析）

最终（批次 4 后）：
4. 17 篇源文件全部删除，git status 干净
5. sidebar 无指向已删文件的断链
6. `vitepress build` 全量通过
7. 提交并推送

## 7. 风险与缓解

| 风险 | 缓解 |
|------|------|
| 融合后索引页过大（>500 行） | 严格按模板删冗余走读；超出则拆为「原理」子文章 |
| 14 个 agent 并行质量不齐 | 分批 + 批次 1 review 点；agent prompt 内嵌模板和 exemplar |
| 02-agent-types 跨 multiagent + graph 两处 | 任务 4（graph）和任务 5（multiagent）分别明确取哪部分 |
| 新建 3 个 index 页缺 sidebar 入口 | 批次 4 集中处理 config.ts，统一加 sidebar |
| 删除后才发现融合遗漏 | 批次 4 删除前再过一遍源文件；git 历史可恢复 |

## 8. 非目标（YAGNI）

- 不重写示例子文章（它们已达标）
- 不动 18-architecture / 19-diagrams
- 不调整 examples/ 顶层 README 的分类结构（只增「协议服务端总览」一节）
- 不引入新的文档工具或主题
