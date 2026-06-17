# OpenAI API 章节重构设计：从小白到精通

> 日期：2026-06-17
> 主题：将 `docs/openai-api/` 章节从「面向进阶读者的协议级深度剖析」重构为「面向零 LLM 经验开发者的渐进式学习路径」

## 背景与动机

当前 `https://baxiang.github.io/hello-agent/openai-api/` 首页定位为「协议级深入理解」，开篇即抛出框架抽象层（ADK-Go `model.LLM` 接口、LangChain `ChatModel`、OpenAI Agents SDK `Agent.run()`）→ messages 数组 → SSE 流式协议。这对有 Agent 框架经验的读者友好，但对**零 LLM 经验的开发者**形成认知断层：

- 跳过了「什么是大模型 API」「HTTP 请求长什么样」「什么是 token」等基础认知
- 直接进入协议细节，缺少从「会写代码」到「理解协议」的过渡桥梁
- 生活化比喻缺失，全篇是技术黑话

OpenAI API 协议是整个 Agent 生态的底层标准，重要性极高。本次重构目标：**让一个会写代码但从未调过 LLM 的开发者，能从零开始、逐步建立对协议的完整理解**。

## 目标受众

**零 LLM 经验的开发者**：
- 会写代码（任意语言），熟悉 HTTP/JSON/curl 的基本概念
- 从未调用过大模型 API，对 token/messages/流式等概念陌生
- 只用过 ChatGPT 网页版（或完全没用过）
- 需要大量生活化比喻（messages=聊天记录、token=计费字符、temperature=随机性旋钮）

非目标读者：纯编程新手（不懂 HTTP/JSON）、只会用 SDK 不关心协议的工程师。

## 设计决策

### 策略：重新排序 + 补充（非重写）

**保留现有 11 篇文档原样不动**（文件名、内容、git 历史、外部链接全部保留），仅：
1. 在前面**新增**入门基础章节
2. 重新组织侧边栏分组归属
3. 重写 `index.md` 导航页

不重命名、不删除、不改写任何现有文件。改动最小，破坏性最低。

### 用子目录隔离入门篇

新增内容放在 `docs/openai-api/getting-started/` 子目录，而非与现有文件混排。理由：
- 现有 11 篇之间有交叉引用，重命名会破坏链接
- 子目录形成天然的「层」边界，与三层结构对应
- 外部链接（如 `https://.../openai-api/04-function-calling.html`）完全不受影响

### 代码示例：curl + JSON 为主

入门篇全部用 `curl` + 原生 JSON 演示，**不引入任何 SDK**。理由：
- 与「协议层」定位一致——SDK 会把 HTTP 请求、messages 组装、流式解析全部封装成黑盒，掩盖协议本身
- curl 是跨语言、跨平台的「最小公倍数」，所有读者都能直接运行
- 进阶篇保持现有 Python + Go + curl 混合（面向已建立直觉的读者）

## 三层结构

```
docs/openai-api/
├── index.md                      ← 重写：新手友好三段式导航
├── getting-started/              ← 【新增】入门基础（4 篇）
│   ├── 00-first-call.md
│   ├── 01-messages-intro.md
│   ├── 02-tokens.md
│   └── 03-core-params.md
├── 00-overview.md                ← 现有保留（侧栏归「协议进阶」组）
├── 01-messages.md                ← 现有保留
├── 02-response.md                ← 现有保留
├── 03-streaming.md               ← 现有保留
├── 04-function-calling.md        ← 现有保留
├── 05-multimodal.md              ← 现有保留
├── 06-parameters.md              ← 现有保留
├── 07-deepseek.md                ← 现有保留（侧栏归「工程实践」组）
├── 08-kimi.md                    ← 现有保留
├── 09-qwen.md                    ← 现有保留
├── 10-practice-summary.md        ← 现有保留
├── geo_extract.py                ← 现有保留
└── README.md                     ← 现有保留
```

**侧边栏三组（改 `docs/.vitepress/config.ts`）：**

| 分组 | 文章 | 状态 |
|------|------|------|
| 入门基础 | getting-started/00 ~ 03（4 篇） | 新增 |
| 协议进阶 | 00-overview ~ 06-parameters（7 篇） | 现有，分组归属调整 |
| 工程实践 | 07-deepseek ~ 10-practice-summary（4 篇） | 现有，分组归属调整（原「国产模型实战」改名） |

## 入门篇 4 篇内容大纲

每篇独立小节，篇幅 150-250 行，curl + JSON 为主，生活化比喻贯穿，结尾有「下一节预告」+「进阶篇会深入讲什么」的衔接。

| 文件 | 标题 | 核心内容（小白视角） |
|------|------|---------------------|
| `getting-started/00-first-call.md` | 第一次调用：5 分钟跑通 | 环境准备（curl/Postman/终端）；最简 curl 请求逐行拆解（URL、Header、Body）；第一次成功响应长什么样；最常见 3 个错误（401/404/429）及修复 |
| `getting-started/01-messages-intro.md` | messages 数组：对话是怎么组织的 | 用「微信聊天记录」比喻 messages；system/user/assistant 三角色生活化解释；多轮对话为什么要把历史全部发回去（API 无状态）；动手实验：构造一个 3 轮对话 |
| `getting-started/02-tokens.md` | Token：大模型的「计费单位」 | token ≠ 单词 ≠ 字符；中文/英文/代码的 token 占用对比；为什么 max_tokens 重要；usage 字段解读；token 与费用、速度的关系 |
| `getting-started/03-core-params.md` | 5 个最常用参数 | temperature（0=严谨、2=疯狂）、max_tokens、top_p、stop、n；每个配「调高/调低会怎样」的对比例子；什么时候用哪个 |

**比喻清单（贯穿 4 篇）：**
- messages = 微信聊天记录
- token = 计费字符
- temperature = 随机性旋钮
- API 无状态 = 每次都要把聊天记录全文发给对方

## `index.md` 导航页改写要点

1. **标题**：从「OpenAI Chat Completions API — 协议级深入理解」改为更温和的「OpenAI API 协议：从小白到精通」
2. **顶部一句话定位**：去掉「剖析 POST v1/chat/completions 协议本身」这类吓退小白的表述，换成「用最简单的 curl 调用，一步步理解大模型 API 的底层协议」
3. **三段式目录表**（对应侧边栏三组）：
   - 入门基础（4 篇）— 零基础跑通第一次调用，建立直觉
   - 协议进阶（7 篇）— 深入 messages/响应/流式/Function Calling/多模态/参数全解
   - 工程实践（4 篇）— DeepSeek/Kimi/Qwen 对比与选型
4. **保留**「为什么需要学这个」那张框架分层图（有价值），但从文首移到入门篇之后，作为「学完基础后看这张图会豁然开朗」的衔接
5. **新增「学习路径」**：明确告诉新手「先入门 4 篇 → 再进阶 → 最后实战」

## 不破坏的承诺

- 现有 11 篇文件路径、git 历史、外部链接全部保留
- 不改任何现有文件名
- 不改写任何现有文件内容
- 仅用 `getting-started/` 子目录承载新内容
- 仅修改 `index.md` 和 `config.ts` 两个现有文件

## 验证方式

- 本地 `npm run docs:dev` 跑起来，点进 `/openai-api/` 确认三段式导航渲染正确
- 逐篇点开 4 篇新文章确认无 404、curl 示例无语法错误
- 确认现有进阶/实战篇链接全部可达
- 侧边栏「上一页/下一页」翻页顺序连贯（入门 00 → 01 → 02 → 03 → 协议总览 00 → ...）

## YAGNI 检查

以下内容本次**不做**（避免范围蔓延）：
- 不新增「SDK 入门篇」（Python/JS SDK 教程超出「协议层」定位）
- 不重写现有 11 篇进阶内容（保持稳定性）
- 不加交互式 playground 或在线运行功能（基础设施成本高，YAGNI）
- 不加多语言版本（i18n）
- 不动 `openai/`（OpenAI Agents SDK 章节）和 `anthropic-api/` 章节
