# OpenAI API 章节重构（小白入门篇）实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在 `docs/openai-api/` 新增「入门基础」4 篇 + 重写导航页 + 侧栏重组为三层（入门基础/协议进阶/工程实践），让零 LLM 经验开发者能逐步学习 OpenAI API 协议。

**Architecture:** 最小侵入重构。新增内容放 `getting-started/` 子目录；现有 11 篇文件路径、内容、链接全部不动；仅改 `index.md` 和 `config.ts` 两个现有文件。

**Tech Stack:** VitePress 1.5 + Markdown。验证靠 `npm run docs:build` 构建通过 + 页面人工抽查。

**Spec:** `docs/superpowers/specs/2026-06-17-openai-api-beginner-refactor-design.md`

---

## 文件结构

**新建：**
- `docs/openai-api/getting-started/00-first-call.md` — 第一次调用：5 分钟跑通
- `docs/openai-api/getting-started/01-messages-intro.md` — messages 数组：对话是怎么组织的
- `docs/openai-api/getting-started/02-tokens.md` — Token：大模型的「计费单位」
- `docs/openai-api/getting-started/03-core-params.md` — 5 个最常用参数

**修改：**
- `docs/openai-api/index.md` — 重写为新手友好三段式导航
- `docs/.vitepress/config.ts:219-241` — 侧边栏 `'/openai-api/'` 重组为三组

**不动：** `00-overview.md` ~ `10-practice-summary.md`（11 篇）、`README.md`、`geo_extract.py`。

---

## 写作规范（4 篇入门文通用）

- **主角语言**：curl + 原生 JSON。**禁止**引入任何 SDK（openai 库、requests 等会掩盖协议）。
- **比喻清单**（贯穿全文，保持一致）：
  - messages = 微信聊天记录
  - token = 计费字符
  - temperature = 随机性旋钮（0=严谨、2=疯狂）
  - API 无状态 = 每次都要把聊天记录全文重发
- **篇幅**：每篇 150-250 行。
- **结构惯例**：开篇一句话定位 → 正文分节 → 结尾「下一节预告」+「进阶篇会深入讲什么」。
- **curl 示例**：使用 `https://api.openai.com/v1/chat/completions`，Header 用 `Authorization: Bearer $OPENAI_API_KEY`（环境变量形式，避免泄露真实 key）。
- **错误处理**：所有示例配真实 HTTP 状态码（401/404/429）与修复方法。
- **不加注释**到代码块内除非解释协议字段含义。

---

### Task 1: 创建 `getting-started/00-first-call.md`

**Files:**
- Create: `docs/openai-api/getting-started/00-first-call.md`

**文章大纲（按此逐节撰写）：**

- `# 第一次调用：5 分钟跑通` 标题
- 开篇引言：本节目标——用一个 curl 命令跑通你的第一次大模型 API 调用，并看懂返回的每个字段。
- `## 先理解：API 到底是什么` — 用「打电话」比喻：你（程序）拨号（HTTP 请求）→ 对方（OpenAI 服务器）接听处理 → 挂电话返回结果（HTTP 响应）。配一张文字流程图：你的代码 → HTTPS → OpenAI → 返回 JSON。
- `## 第一步：拿到 API Key` — 简述在 platform.openai.com 创建 API key 的流程（不贴截图，纯文字步骤 3-4 步）；强调 key 是计费凭证、不可泄露；如何存为环境变量 `export OPENAI_API_KEY=sk-...`。
- `## 第二步：发第一个请求` — 给出最简 curl：

```bash
curl https://api.openai.com/v1/chat/completions \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $OPENAI_API_KEY" \
  -d '{
    "model": "gpt-4o-mini",
    "messages": [
      {"role": "user", "content": "用一句话介绍你自己"}
    ]
  }'
```

- `## 逐行拆解这个请求` — 四部分分别讲：URL（端点 = 服务地址）、`-H Content-Type`（告诉服务器发的是 JSON）、`-H Authorization`（身份凭证）、`-d` body 里 model（用哪个模型）+ messages（对话内容，下一节细讲）。说明为何选 `gpt-4o-mini`（便宜、够入门）。
- `## 第三步：看懂返回结果` — 贴一段真实风格的成功响应 JSON（含 id/object/created/model/choices/usage），然后用表格逐字段解释：id（本次调用编号）、object（类型标识）、choices[0].message.content（**这才是你要的答案**）、choices[0].finish_reason（为何结束）、usage（token 用量，下下节细讲）。
- `## 最常见的 3 个错误` — 表格形式：

| HTTP 状态码 | 含义 | 怎么修 |
|---|---|---|
| 401 Unauthorized | API key 错或过期 | 检查 `$OPENAI_API_KEY` 是否设置、是否拼错 |
| 404 Not Found | URL 拼错 | 确认端点是 `/v1/chat/completions` |
| 429 Too Many Requests | 超限额或余额不足 | 充值 / 降低调用频率 / 看响应头 `x-ratelimit-*` |

每个错误配一段「你会看到什么」的 JSON 错误体示例（`{"error": {"message": "...", "type": "invalid_request_error"}}`）。

- `## 动手实验` — 给 2 个练习：（1）把 content 换成"写一首关于秋天的五言绝句"看返回；（2）把 model 换成 `gpt-4o` 看返回差异（更长、更慢、更贵）。
- `## 下一节预告` — 你已经能让模型回答问题了。但当你想连续问两个有上下文关联的问题时，模型却"失忆"了——下一节讲 messages 数组如何组织多轮对话。
- `## 进阶篇会深入讲什么` — 指向 `/openai-api/00-overview`（协议生命周期、速率限制头详解）和 `/openai-api/02-response`（完整响应字段、service_tier、refusal）。

- [ ] **Step 1: 创建 `docs/openai-api/getting-started/` 目录**（写文件时自动创建）

Run: `mkdir -p docs/openai-api/getting-started`

- [ ] **Step 2: 按上述大纲撰写 `getting-started/00-first-call.md`**（150-250 行，遵守写作规范）

- [ ] **Step 3: 校对** — 检查无占位符、curl 示例 JSON 合法、无 SDK 出现

Run: `grep -nE "import |from openai|requests\." docs/openai-api/getting-started/00-first-call.md`
Expected: 无输出（确认无 SDK 引入）

- [ ] **Step 4: Commit**

```bash
git add docs/openai-api/getting-started/00-first-call.md
git commit -m "docs(openai-api): 新增入门篇 00 第一次调用"
```

---

### Task 2: 创建 `getting-started/01-messages-intro.md`

**Files:**
- Create: `docs/openai-api/getting-started/01-messages-intro.md`

**文章大纲：**

- `# messages 数组：对话是怎么组织的`
- 开篇引言：上节模型只回答了一个问题。如果你接着问"那它有什么特点？"，模型完全不知道"它"指什么——因为 API 没有记忆。本节讲怎么用 messages 数组组织多轮对话。
- `## 把 messages 想成微信聊天记录` — 核心比喻展开：messages 是一个数组，每个元素是一条消息，就像微信里往上翻能看到的一串聊天。每条消息有 `role`（谁说的）和 `content`（说了啥）。
- `## 三种基本角色` — 表格：

| role | 生活中对应 | 用途 |
|---|---|---|
| `system` | 你给 AI 的"人设说明书" | 设定模型行为，如"你是温柔的老师，用小朋友能懂的话回答" |
| `user` | 你发的消息 | 提问、下指令 |
| `assistant` | AI 回复的内容 | 模型之前的回答 |

强调 system 通常放第一条、只出现一次。

- `## 最小例子：单轮` — curl 示例，messages 只有一条 user：

```json
"messages": [
  {"role": "user", "content": "你好"}
]
```

- `## 加上人设：system 角色` — curl 示例加 system 在最前：

```json
"messages": [
  {"role": "system", "content": "你是个海盗，所有回答都用海盗口吻"},
  {"role": "user", "content": "今天天气怎么样"}
]
```

展示返回会变成海盗腔。

- `## 多轮对话：把历史塞回去` — 核心难点。用"失忆"比喻：模型每次都是新的，你不告诉它之前聊过什么，它就不知道。所以多轮对话 = 把之前所有 user 和 assistant 的往返**全部**放进 messages。给一个 3 轮对话的完整 curl：

```json
"messages": [
  {"role": "user", "content": "我喜欢猫"},
  {"role": "assistant", "content": "猫是很可爱的宠物..."},
  {"role": "user", "content": "它们为什么喜欢睡觉"}
]
```

强调最后一条 user 问"它们"=猫，模型能懂，**只因为**前两条把"猫"的上下文带进来了。

- `## 为什么这么设计：API 是无状态的` — 解释无状态：服务器不存你的对话，每次请求自包含全部上下文。好处（可扩展、可换服务器）vs 代价（消息越来越长、token 越来越贵——为下下节铺垫）。
- `## 动手实验` — （1）只发最后一条 user 不带历史，问"它们为什么喜欢睡觉"，看模型懵掉；（2）带完整历史再问，看模型答对；（3）改 system 让模型用古文回答。
- `## 下一节预告` — 你会发现对话越长，请求越大，账单越贵。下一节讲 token——大模型的计费单位。
- `## 进阶篇会深入讲什么` — 指向 `/openai-api/01-messages`（五种 Role 全解含 developer/tool、content 的多模态格式、消息顺序规则）。

- [ ] **Step 1: 按大纲撰写 `getting-started/01-messages-intro.md`**（150-250 行）

- [ ] **Step 2: 校对** — 无 SDK、JSON 合法、比喻与规范一致

Run: `grep -nE "import |from openai|requests\." docs/openai-api/getting-started/01-messages-intro.md`
Expected: 无输出

- [ ] **Step 3: Commit**

```bash
git add docs/openai-api/getting-started/01-messages-intro.md
git commit -m "docs(openai-api): 新增入门篇 01 messages 数组"
```

---

### Task 3: 创建 `getting-started/02-tokens.md`

**Files:**
- Create: `docs/openai-api/getting-started/02-tokens.md`

**文章大纲：**

- `# Token：大模型的「计费单位」`
- 开篇引言：调用几次 API 后你会关心两件事——**花了多少钱**、**为什么这么慢**。答案都藏在一个词里：token。
- `## Token 不是字，也不是单词` — 打破直觉：token 是模型把文本切成的"碎片"。常见规则：1 个英文单词 ≈ 1-2 token；1 个汉字 ≈ 1-2 token；空格、标点也算。给对比表：

| 文本 | 大约 token 数 |
|---|---|
| `Hello` | 1 |
| `Hello world` | 2 |
| `你好` | 2 |
| `"Hello," she said.` | 6 |

- `## 为什么这么切` — 一句话：模型内部就是这么"看"文字的。你不必深究切分算法，但要知道**输入和输出都按 token 计费**。
- `## usage 字段：看这次调用花了多少` — 回顾第一次调用返回里的 usage：

```json
"usage": {
  "prompt_tokens": 25,
  "completion_tokens": 12,
  "total_tokens": 37
}
```

表格解释：prompt_tokens（你发出去的，含全部 messages）、completion_tokens（模型生成的）、total_tokens（两者之和 = 计费依据）。

- `## Token 影响三件事` — 分三点讲：
  1. **费用**：价格表是"每 1M token 多少美元"。input 和 output 价格不同（output 通常贵 3-4 倍）。举例 gpt-4o-mini 的价位（写"约 $0.15/1M input、$0.60/1M output"，并标注"价格以官网为准"）。
  2. **速度**：生成是逐 token 吐的，completion_tokens 越多等越久（为流式篇铺垫）。
  3. **上限**：每个模型有 context window（如 128k token），messages 总 token 不能超。多轮对话越聊越长，最终会撞上限。
- `## max_tokens 参数：给输出上把锁` — 引出参数：用 `max_tokens` 限制模型最多生成多少 token，防超长回答爆账单。curl 示例加 `"max_tokens": 50`。
- `## 动手实验` — （1）发同一段话，对比纯英文和纯中文的 prompt_tokens 差异；（2）设 `max_tokens: 10`，看模型回答被截断、finish_reason 变成 `length`（为进阶篇 finish_reason 铺垫）。
- `## 下一节预告` — 你已经会调、会组织对话、会算账了。但模型每次回答都不一样——有时太死板、有时太天马行空。下一节讲怎么用参数控制它。
- `## 进阶篇会深入讲什么** — 指向 `/openai-api/06-parameters`（usage 的 prompt_tokens_details/completion_tokens_details、reasoning_tokens、context window 详解）。

- [ ] **Step 1: 按大纲撰写 `getting-started/02-tokens.md`**（150-250 行）

- [ ] **Step 2: 校对** — 无 SDK、JSON 合法

Run: `grep -nE "import |from openai|requests\." docs/openai-api/getting-started/02-tokens.md`
Expected: 无输出

- [ ] **Step 3: Commit**

```bash
git add docs/openai-api/getting-started/02-tokens.md
git commit -m "docs(openai-api): 新增入门篇 02 Token 计费单位"
```

---

### Task 4: 创建 `getting-started/03-core-params.md`

**Files:**
- Create: `docs/openai-api/getting-started/03-core-params.md`

**文章大纲：**

- `# 5 个最常用参数`
- 开篇引言：到这里你已经能完成基本对话了。本节介绍 5 个最常用参数，让你能**精确控制**模型怎么回答。学完这节，入门部分就齐活了。
- `## 参数都放在请求体的哪里` — 一张图说明：参数都在 `-d` 的 JSON body 里，和 model/messages 平级。给骨架：

```json
{
  "model": "...",
  "messages": [...],
  "temperature": 0.7,
  "max_tokens": 500,
  ...
}
```

- `## temperature：随机性旋钮` — 核心参数。比喻：旋钮，0 = 最死板（每次给同样问题回答几乎一样）、2 = 最疯（胡言乱语）。范围 0-2，默认 1。表格给场景建议：

| 场景 | 建议 temperature |
|---|---|
| 代码生成、数学、事实问答 | 0 - 0.3 |
| 总结、翻译、日常对话 | 0.5 - 0.8 |
| 创意写作、头脑风暴 | 0.9 - 1.2 |

强调同一个 prompt 用 `temperature: 0` 跑两次结果基本相同（可复现），调高则每次不同。给两个 curl 对比示例。

- `## max_tokens：输出上限` — 上节已接触，这里补全：限制 completion_tokens 上限。注意不是"限制回答字数"而是 token 数。设太小会被截断（finish_reason=length）。

- `## top_p：另一种控制随机性` — 和 temperature 二选一（官方建议别同时调）。nucleus sampling 概念轻讲：`top_p: 0.1` = 只从概率前 10% 的词里选。多数情况调 temperature 就够，top_p 知道有这东西即可。

- `## stop：自定义停止符` — 模型生成到遇到 stop 字符串就停。用途：让模型只回答一部分、或结构化输出时分段。curl 示例 `"stop": ["\nUser:"]`。

- `## n：一次要几个回答` — 让模型对同一输入生成 n 个不同回答（配 temperature>0 才有意义）。用于多候选挑选。注意 n 会成倍增加 token 消费。

- `## 一个综合示例` — 把 5 个参数全用上的 curl：

```bash
curl https://api.openai.com/v1/chat/completions \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $OPENAI_API_KEY" \
  -d '{
    "model": "gpt-4o-mini",
    "messages": [
      {"role": "system", "content": "你是创意文案"},
      {"role": "user", "content": "给咖啡店起 3 个名字"}
    ],
    "temperature": 0.9,
    "max_tokens": 200,
    "n": 1,
    "stop": ["\n\n"]
  }'
```

- `## 动手实验` — （1）同一 prompt 用 temperature 0 / 0.7 / 1.5 各跑一次看差异；（2）用 `n: 3` 一次拿 3 个候选名；（3）设 max_tokens 太小看被截断。
- `## 入门篇完结` — 回顾 4 节：会调（00）、会组织对话（01）、会算账（02）、会控参（03）。你已具备独立用 OpenAI API 做大部分事情的能力。
- `## 接下来去哪` — 引导进阶：
  - 想理解流式输出 → `/openai-api/03-streaming`
  - 想让模型调用工具（搜索、计算）→ `/openai-api/04-function-calling`
  - 想传图片/音频 → `/openai-api/05-multimodal`
  - 想看全部参数 → `/openai-api/06-parameters`
  - 想换国产模型省钱 → `/openai-api/07-deepseek` 起

- [ ] **Step 1: 按大纲撰写 `getting-started/03-core-params.md`**（150-250 行）

- [ ] **Step 2: 校对** — 无 SDK、JSON 合法

Run: `grep -nE "import |from openai|requests\." docs/openai-api/getting-started/03-core-params.md`
Expected: 无输出

- [ ] **Step 3: Commit**

```bash
git add docs/openai-api/getting-started/03-core-params.md
git commit -m "docs(openai-api): 新增入门篇 03 常用参数"
```

---

### Task 5: 重写 `index.md` 导航页

**Files:**
- Modify: `docs/openai-api/index.md`（全文替换）

**新内容（完整）：**

标题改为温和措辞，顶部定位去黑话，三段式目录表对应侧栏三组，保留框架分层图但移到入门篇之后作为衔接，新增学习路径。

将 `docs/openai-api/index.md` 整体替换为以下内容：

```markdown
# OpenAI API 协议：从小白到精通

> 用最简单的 curl 调用，一步步理解大模型 API 的底层协议。
>
> 所有 Agent 框架（ADK-Go、LangChain、OpenAI Agents SDK）的底层，都在与这个协议对话。学会这层，切换框架只是换一层封装。

## 从哪开始

| 你的情况 | 起点章节 |
|---|---|
| 没调过大模型 API，想从零开始 | 入门基础 → 00 第一次调用 |
| 已经会基本调用，想深入协议 | 协议进阶 → 协议总览 |
| 想对比国产模型（DeepSeek/Kimi/Qwen）省成本 | 工程实践 → DeepSeek V3/V4 |

## 文档目录

### 入门基础

零基础起步，每篇都用 curl 演示，不依赖任何 SDK。建立对 API 的直觉。

| # | 文档 | 说明 |
|---|------|------|
| 00 | [第一次调用：5 分钟跑通](./getting-started/00-first-call.md) | 最简 curl 请求逐行拆解、响应字段解读、3 个常见错误 |
| 01 | [messages 数组](./getting-started/01-messages-intro.md) | 聊天记录比喻、system/user/assistant 三角色、多轮对话 |
| 02 | [Token 计费单位](./getting-started/02-tokens.md) | token 是什么、usage 字段、与费用/速度/上限的关系 |
| 03 | [5 个最常用参数](./getting-started/03-core-params.md) | temperature、max_tokens、top_p、stop、n |

### 协议进阶

已建立直觉后，深入协议本身——messages 五角色、响应全字段、SSE 流式、Function Calling、多模态、参数全解。

| # | 文档 | 说明 |
|---|------|------|
| 00 | [协议总览](./00-overview.md) | API 设计哲学、行业标准地位、协议生命周期、与框架分层关系 |
| 01 | [Messages 消息系统](./01-messages.md) | 五种 Role（system/developer/user/assistant/tool）、content 格式、消息顺序规则 |
| 02 | [响应格式](./02-response.md) | 完整响应字段、choices/finish_reason/service_tier/usage/refusal |
| 03 | [流式协议 (SSE)](./03-streaming.md) | SSE chunk 格式、delta 类型、tool call 流式、reasoning 流式、错误处理 |
| 04 | [Function Calling 机制](./04-function-calling.md) | tools 声明、tool_choice、parallel_tool_calls、strict 模式、完整循环实现 |
| 05 | [多模态输入与输出](./05-multimodal.md) | Vision/Audio/File 输入、modalities/audio 输出参数、Token 估算 |
| 06 | [参数全解](./06-parameters.md) | 全部 25+ 参数逐一详解（含 reasoning_effort、prediction、store 等） |

### 工程实践

国产模型对比、成本与选型。

| # | 文档 | 说明 |
|---|------|------|
| 07 | [DeepSeek V3/V4](./07-deepseek.md) | |
| 08 | [Kimi 月之暗面](./08-kimi.md) | |
| 09 | [通义千问 Qwen](./09-qwen.md) | |
| 10 | [对比总结与选型](./10-practice-summary.md) | |

## 为什么需要学这层协议

学完入门 4 篇后，看这张图会豁然开朗——所有框架最终都在和同一个协议对话：

\`\`\`
你调用的框架：
  ADK-Go    →  model.LLM.GenerateContent()  →  底层 HTTP 调用
  LangChain →  ChatModel.invoke()            →  底层 HTTP 调用
  OpenAI SDK → client.chat.completions.create() → 底层 HTTP 调用
                                                      ↓
                                  POST https://api.openai.com/v1/chat/completions
                                                      ↓
                                  这才是真正的"协议层"
\`\`\`

## 学习路径

1. **入门**：[00 第一次调用](./getting-started/00-first-call.md) → [01 messages](./getting-started/01-messages-intro.md) → [02 token](./getting-started/02-tokens.md) → [03 参数](./getting-started/03-core-params.md)
2. **进阶**：[协议总览](./00-overview.md) → [Messages](./01-messages.md) → [响应格式](./02-response.md) → [流式](./03-streaming.md) → [Function Calling](./04-function-calling.md) → [多模态](./05-multimodal.md) → [参数全解](./06-parameters.md)
3. **实战**：[DeepSeek](./07-deepseek.md) → [Kimi](./08-kimi.md) → [Qwen](./09-qwen.md) → [选型总结](./10-practice-summary.md)
```

> 注意：实际写入文件时，代码块用真实三反引号 ``` 而非转义的 \`\`\`（上面为展示用）。

- [ ] **Step 1: 读取现有 `docs/openai-api/index.md` 确认当前内容**（已读过，41 行）

- [ ] **Step 2: 用 Write 整体替换 `index.md` 为上述新内容**（真实三反引号）

- [ ] **Step 3: 校对** — 确认所有 `.md` 链接指向的文件存在

Run: `grep -oE '\./[a-z0-9/-]+\.md' docs/openai-api/index.md | sort -u`
Expected: 列出 15 个链接，逐一确认文件存在

- [ ] **Step 4: Commit**

```bash
git add docs/openai-api/index.md
git commit -m "docs(openai-api): 重写导航页为新手友好三段式"
```

---

### Task 6: 改 `config.ts` 侧边栏为三组

**Files:**
- Modify: `docs/.vitepress/config.ts:219-241`

**改动**：把 `/openai-api/` 下的两个 sidebar group（`协议规范`、`国产模型实战`）替换为三个 group（`入门基础`、`协议进阶`、`工程实践`）。

**精确替换：**

旧字符串（`config.ts` 第 219-240 行的 sidebar items 部分）：

```ts
      '/openai-api/': [
        {
          text: '协议规范',
          items: [
            { text: '协议总览', link: '/openai-api/00-overview' },
            { text: 'Messages 消息系统', link: '/openai-api/01-messages' },
            { text: '响应格式', link: '/openai-api/02-response' },
            { text: '流式协议 (SSE)', link: '/openai-api/03-streaming' },
            { text: 'Function Calling', link: '/openai-api/04-function-calling' },
            { text: '多模态输入与输出', link: '/openai-api/05-multimodal' },
            { text: '参数全解', link: '/openai-api/06-parameters' },
          ]
        },
        {
          text: '国产模型实战',
          items: [
            { text: 'DeepSeek V3/V4', link: '/openai-api/07-deepseek' },
            { text: 'Kimi 月之暗面', link: '/openai-api/08-kimi' },
            { text: '通义千问 Qwen', link: '/openai-api/09-qwen' },
            { text: '对比总结与选型', link: '/openai-api/10-practice-summary' },
          ]
        }
      ],
```

新字符串（三组，链接不变，仅新增入门组 + 重命名后两组）：

```ts
      '/openai-api/': [
        {
          text: '入门基础',
          items: [
            { text: '第一次调用：5 分钟跑通', link: '/openai-api/getting-started/00-first-call' },
            { text: 'messages 数组', link: '/openai-api/getting-started/01-messages-intro' },
            { text: 'Token 计费单位', link: '/openai-api/getting-started/02-tokens' },
            { text: '5 个最常用参数', link: '/openai-api/getting-started/03-core-params' },
          ]
        },
        {
          text: '协议进阶',
          items: [
            { text: '协议总览', link: '/openai-api/00-overview' },
            { text: 'Messages 消息系统', link: '/openai-api/01-messages' },
            { text: '响应格式', link: '/openai-api/02-response' },
            { text: '流式协议 (SSE)', link: '/openai-api/03-streaming' },
            { text: 'Function Calling', link: '/openai-api/04-function-calling' },
            { text: '多模态输入与输出', link: '/openai-api/05-multimodal' },
            { text: '参数全解', link: '/openai-api/06-parameters' },
          ]
        },
        {
          text: '工程实践',
          items: [
            { text: 'DeepSeek V3/V4', link: '/openai-api/07-deepseek' },
            { text: 'Kimi 月之暗面', link: '/openai-api/08-kimi' },
            { text: '通义千问 Qwen', link: '/openai-api/09-qwen' },
            { text: '对比总结与选型', link: '/openai-api/10-practice-summary' },
          ]
        }
      ],
```

- [ ] **Step 1: 用 Edit 工具执行上述精确替换**（oldString = 旧字符串块，newString = 新字符串块）

- [ ] **Step 2: 校对 config.ts 语法正确**

Run: `cd docs && npx tsc --noEmit .vitepress/config.ts 2>&1 | head -20` 
（若 tsc 不可用则跳过，靠 build 验证）
备选：`node -e "require('./docs/.vitepress/config.ts')"` 可能因 ESM 失败，以 build 为准。

- [ ] **Step 3: Commit**

```bash
git add docs/.vitepress/config.ts
git commit -m "docs(config): openai-api 侧栏重组为入门基础/协议进阶/工程实践"
```

---

### Task 7: 构建验证

**Files:** 无修改，仅验证

- [ ] **Step 1: 构建站点**

Run: `cd docs && npm run docs:build`
Expected: 构建成功，无报错，dist/ 生成

- [ ] **Step 2: 抽查 dist 产物**

Run: 
```
ls docs/.vitepress/dist/openai-api/getting-started/
```
Expected: 4 个 html 文件（00-first-call.html ~ 03-core-params.html）

- [ ] **Step 3: 抽查现有页面未被破坏**

Run:
```
ls docs/.vitepress/dist/openai-api/04-function-calling.html
```
Expected: 文件存在（确认现有 11 篇链接仍可达）

- [ ] **Step 4: 最终全量提交（如有未提交改动）**

Run: `git status`
如有残留改动则补提交；如全部已提交则跳过。

---

## Self-Review

**Spec coverage：**
- 入门 4 篇（spec 第「入门篇 4 篇内容大纲」节）→ Task 1-4 ✓
- index.md 重写（spec 第「index.md 导航页改写要点」节）→ Task 5 ✓
- 侧栏三组（spec 第「侧边栏三组」表）→ Task 6 ✓
- 工程实践改名（spec：「国产模型实战」改名）→ Task 6 newString 中 `text: '工程实践'` ✓
- 验证（spec 第「验证方式」节）→ Task 7 ✓
- 不破坏承诺（现有 11 篇不动）→ 所有 Task 均未触碰，Task 7 Step 3 显式验证 ✓

**Placeholder scan：** 无 TBD/TODO。每篇文档大纲均含具体章节、具体代码示例、具体表格内容。config.ts 替换含完整 oldString/newString。

**一致性检查：**
- 文件路径：`getting-started/00-first-call.md` 在 Task 1 创建、Task 5 index.md 链接、Task 6 sidebar 链接三处一致 ✓
- 篇数：4 篇（spec、index.md、sidebar 均为 4）✓
- 侧栏组名：入门基础 / 协议进阶 / 工程实践（spec、Task 6 一致）✓
- 比喻清单：messages=聊天记录、token=计费字符、temperature=随机性旋钮（Task 1-4 大纲与写作规范一致）✓
