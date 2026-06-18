# tRPC-Agent-Go「Go 前置知识」模块设计

> **日期**：2026-06-18
> **状态**：已确认，待实施
> **作者**：baxiang + opencode

## 1. 目标

在 `docs/trpc-agent-go/` 下新增「Go 前置知识」模块，让读者在学习 trpc-agent-go 示例教程之前，先掌握框架所依赖的 Go 语言模式与 Agent 领域核心概念，避免在示例文章里被底层语言模式或领域术语卡住。

**动机**：
- 现有 trpc-agent-go 侧边栏只有「概览」+「示例教程」两组，缺少前置门槛说明
- 示例文章里频繁出现 `<-chan *event.Event`、`llmagent.WithModel(...)`、`Context` 取消等模式，没有 Go 基础铺垫会让读者卡在"语法"而非"概念"
- 仓库已有两个强先例：ADK-Go 的「Go 前置知识」(8 篇) 和 AgentScope Java 的「Java 前置知识」(11 篇，末篇含 LLM 概念)。本模块按相同约定补齐 trpc-agent-go 侧

## 2. 范围

### 读者画像
**会 Go 基础语法，首次接触 trpc-agent-go（或 AI Agent 框架）**。不需要讲 Go 基础语法（变量/控制流/结构体），默认读者已会。

### 模块定位
- **Go 模式篇**：只讲 trpc-agent-go 真实用到的语言模式（不是 Go 教程）
- **Agent 领域概念篇**：讲 LLM/Agent 通用概念（不是 trpc-agent-go 具体用法，具体用法在示例教程）

### 不写什么（YAGNI）
- Go 基础语法（变量、控制流、结构体、map、slice）
- trpc-agent-go 具体组件用法（Session/Memory/Graph 的实操，示例教程已深入）
- 具体 Provider 对接细节（教程覆盖）
- Go 1.21 以下的兼容写法

## 3. 方案：10 篇独立文章（方案 A）

放在 `docs/trpc-agent-go/go-fundamentals/`，每篇一个主题，仿 ADK-Go 约定。侧边栏新增「Go 前置知识」分组，置于「示例教程」之后（与 ADK-Go 顺序一致）。

### 3.1 Go 模式篇（6 篇）

| # | 文件 | 标题 | 为什么是前置 | 关键点 |
|---|------|------|------|------|
| 01 | `01-concurrency-channel.md` | 并发模型与 Channel 事件流 | **框架核心**：`<-chan *event.Event` 是 Agent 间通信的标准方式 | goroutine、unbuffered/buffered channel、`for range chan`、drain channel 防泄漏、`select` + ctx 取消 |
| 02 | `02-interfaces-pluggable.md` | 接口抽象与可插拔设计 | Agent/Model/Tool/Session/Memory/Knowledge 全是接口，理解"可替换"哲学 | 接口定义、隐式实现、依赖注入、小接口组合、`agent.Agent` 接口签名解读 |
| 03 | `03-functional-options.md` | 函数选项模式 | `NewRunner`、`llmagent.WithModel` 等所有构造 API 的统一写法 | 选项模式原理、与 Builder 对比、`WithXxx` 命名约定、可空参数 |
| 04 | `04-context-lifecycle.md` | Context 生命周期与取消 | Runner 的 ctx 取消、`ManagedRunner.Cancel`、DetachedCancel、超时控制 | `context.Context`、`WithCancel`/`WithTimeout`/`WithValue`、父子传播、trpc-agent-go 里 ctx 用法 |
| 05 | `05-generics-types.md` | 泛型与类型安全 | 泛型 Tool、ToolSet、`any` 约定 | 类型参数、约束、泛型函数/类型、trpc-agent-go 里 `any` 的角色 |
| 06 | （不新建文件，直接引用） | 迭代器（range-over-func） | Go 1.23+ 迭代器，框架部分 API 使用 | 侧边栏直接 link 到仓库共享页 `/go-iterators/`（与 ADK-Go 约定一致，避免重复） |

### 3.2 Agent 领域概念篇（4 篇）

| # | 文件 | 标题 | 为什么是前置 | 关键点 |
|---|------|------|------|------|
| 07 | `07-llm-chat-completion.md` | LLM 与 Chat Completion 基础 | 理解模型调用的最小单元 | token、`GenerationConfig`、temperature/max_tokens、system/user/assistant/tool 角色、消息结构 |
| 08 | `08-tool-calling.md` | Tool Calling 工作机制 | trpc-agent-go 的核心能力 | 模型如何决定调工具、function schema、`tool_call → tool_response` 循环、并行调用 |
| 09 | `09-streaming-sse.md` | 流式响应、SSE 与事件 | 理解为什么框架用 channel 通信 | partial events、`Done` 标志、chunk/delta、SSE 协议、为什么 trpc-agent-go 选 channel |
| 10 | `10-rag-embedding.md` | 向量检索与 RAG 概念 | 为 Knowledge 章节打底 | Embedding、向量库、相似度、重排（rerank）、chunking、检索增强生成的完整链路 |

## 4. 每篇文章的统一结构

为了与示例教程风格一致，每篇文章遵循统一结构：

1. **开篇 quote**：一句话点出"为什么学 trpc-agent-go 需要懂这个"
2. **核心概念**：理论解释，配最小可运行代码片段（不依赖 trpc-agent-go，纯 Go 或伪代码）
3. **在 trpc-agent-go 里长什么样**：从框架源码/示例里摘 1-2 段真实代码，标注出处
4. **常见陷阱**：典型错误 + 正确写法（例如"忘记 drain channel 导致 goroutine 泄漏"）
5. **小结 + 延伸阅读**：链接到 trpc-agent-go 对应示例章节、Go 官方文档

每篇目标长度：150-250 行（与示例教程索引页相当）。

## 5. 侧边栏接入

修改 `docs/.vitepress/config.ts`，在 `/trpc-agent-go/` 侧边栏块的「示例教程」组之后新增：

```typescript
{
  text: 'Go 前置知识',
  collapsed: true,
  items: [
    { text: '并发模型与 Channel 事件流', link: '/trpc-agent-go/go-fundamentals/01-concurrency-channel' },
    { text: '接口抽象与可插拔设计', link: '/trpc-agent-go/go-fundamentals/02-interfaces-pluggable' },
    { text: '函数选项模式', link: '/trpc-agent-go/go-fundamentals/03-functional-options' },
    { text: 'Context 生命周期与取消', link: '/trpc-agent-go/go-fundamentals/04-context-lifecycle' },
    { text: '泛型与类型安全', link: '/trpc-agent-go/go-fundamentals/05-generics-types' },
    { text: '迭代器', link: '/go-iterators/' },
    { text: 'LLM 与 Chat Completion', link: '/trpc-agent-go/go-fundamentals/07-llm-chat-completion' },
    { text: 'Tool Calling 工作机制', link: '/trpc-agent-go/go-fundamentals/08-tool-calling' },
    { text: '流式响应、SSE 与事件', link: '/trpc-agent-go/go-fundamentals/09-streaming-sse' },
    { text: '向量检索与 RAG', link: '/trpc-agent-go/go-fundamentals/10-rag-embedding' },
  ]
},
```

## 6. 实现顺序（分批）

由于工作量较大、风险高，按价值分 3 批实施，每批一个独立 commit：

- **批次 1（Go 模式核心 3 篇）**：01 并发/channel、03 函数选项、04 Context。这 3 篇覆盖示例里最高频出现的模式
- **批次 2（Go 模式补充 2 篇 + 1 引用）**：02 接口、05 泛型（新建），06 迭代器（侧边栏直接引用现有 `/go-iterators/`，不新建文件）
- **批次 3（Agent 领域概念 4 篇）**：07-10，作为 Agent 概念入门

每批完成后：
1. `npx vitepress build` 验证无构建错误
2. 检查所有内部链接可达
3. commit + push

## 7. 验收标准

- [ ] 9 篇新 .md 文件存在于 `docs/trpc-agent-go/go-fundamentals/`（第 6 篇「迭代器」直接引用现有共享页 `/go-iterators/`，不新建文件）
- [ ] 侧边栏「Go 前置知识」分组出现在「示例教程」之后，包含 10 个条目（9 个新文件 + 1 个引用 `/go-iterators/`）
- [ ] `npx vitepress build` 通过，无报错
- [ ] 每篇文章遵循统一结构（5 节）
- [ ] 每篇文章至少有 1 个可运行的最小代码示例
- [ ] 每篇文章至少有 1 处"在 trpc-agent-go 里"的真实代码引用
- [ ] 文章间交叉链接（如 channel 文章 → Context 文章）使用相对路径

## 8. 风险与缓解

| 风险 | 缓解 |
|------|------|
| 篇幅过大一次性写不完 | 分 3 批实施，批次 1 即可独立交付价值 |
| 与 ADK-Go 的 Go 前置知识内容重复 | 不重复；本文聚焦 trpc-agent-go 特有用法（channel 事件流、Runner ctx 模式），与 ADK-Go 共享的概念引用 `/go-iterators/` 等共享页 |
| 与示例教程内容重叠 | 前置知识只讲"是什么/为什么"，示例教程讲"怎么用"。前置知识的"在 trpc-agent-go 里"节只是摘抄示意，不展开实操 |

## 9. 后续可能扩展（不在本次范围）

- 增加「环境搭建」篇（Go 安装、IDE 配置、trpc-agent-go 引入）—— 待用户反馈
- 增加「调试技巧」篇（dlv、pprof）—— 待用户反馈
- 视频/图解版—— 视博客模块整体规划
