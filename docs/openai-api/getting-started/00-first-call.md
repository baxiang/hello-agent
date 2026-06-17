# 第一次调用：5 分钟跑通

> 本节目标：用一个 `curl` 命令跑通你的第一次大模型 API 调用，并看懂返回的每个字段。
>
> 全程只用 `curl`，不安装任何 SDK。学完这节，你就掌握了 OpenAI API 的最基本用法。

## 先理解：API 到底是什么

你可能用过 ChatGPT 网页版——在框里打字，AI 回答。API（Application Programming Interface）就是**让程序也能做这件事**的通道。

打个比方，API 就像**打电话**：

```
你的程序（拨号）  ──HTTPS 请求──▶  OpenAI 服务器（接听、处理）
        ◀──HTTPS 响应─────────────
```

- **拨号** = 你的程序发一个 HTTP 请求
- **对方接听处理** = OpenAI 服务器把你的问题喂给大模型
- **挂电话返回结果** = 服务器把模型的回答打包成 HTTP 响应传回来

网页版是「人点按钮」，API 是「程序发请求」。背后用的是**同一个**大模型，只是入口不同。

## 第一步：拿到 API Key

调 API 需要一张「通行证」——API Key。

1. 打开 `https://platform.openai.com/`，注册/登录
2. 进入 **API Keys** 页面，点 **Create new secret key**
3. 复制生成的 key（形如 `sk-xxxx...`）

::: warning ⚠️ 注意
API Key 是**计费凭证**，谁拿到就能花你账户里的钱。**绝不**把它提交到 git、发到聊天群、写进前端代码。
:::

拿到后，存为环境变量（这样后续命令可以直接引用，不用明文写在命令里）：

```bash
export OPENAI_API_KEY=sk-你刚才复制的那串
```

::: tip 验证是否设置成功
在终端运行 `echo $OPENAI_API_KEY`，如果打印出你的 key，说明设置好了。
:::

## 第二步：发第一个请求

打开终端，把下面这段**完整复制**进去回车：

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

几秒后，你会看到一大坨 JSON 返回——恭喜，你已经调通了！

## 逐行拆解这个请求

别被这一长串吓到，其实就四个部分：

| 部分 | 含义 | 通俗解释 |
|------|------|----------|
| `curl https://api.openai.com/v1/chat/completions` | 请求的网址（端点） | 你要拨的电话号码 |
| `-H "Content-Type: application/json"` | 告诉服务器我发的是 JSON | 「我说的是普通话」 |
| `-H "Authorization: Bearer $OPENAI_API_KEY"` | 身份凭证 | 「我是会员，这是我的卡」 |
| `-d '{...}'` | 请求体（body），真正的内容 | 你要说的话 |

请求体里有两个关键字段：

- **`model`**：用哪个模型。这里选 `gpt-4o-mini`，因为**便宜**（适合练习）、够用。后面可以换 `gpt-4o`（更强但更贵）。
- **`messages`**：对话内容。现在先理解成「你的问题」，下一节会详细讲它怎么组织。

> 为什么 URL 里是 `/v1/chat/completions`？
> - `/v1` 是版本号（API 第 1 版）
> - `/chat/completions` 表示「聊天补全」端点——给一段对话，模型补全下一条回复

## 第三步：看懂返回结果

你会收到类似这样的 JSON（字段值每次不同）：

```json
{
  "id": "chatcmpl-Bxxxxxxxxxxxx",
  "object": "chat.completion",
  "created": 1718600000,
  "model": "gpt-4o-mini-2024-07-18",
  "choices": [
    {
      "index": 0,
      "message": {
        "role": "assistant",
        "content": "我是一个 AI 助手，可以帮你回答问题、写作、编程……"
      },
      "finish_reason": "stop"
    }
  ],
  "usage": {
    "prompt_tokens": 12,
    "completion_tokens": 18,
    "total_tokens": 30
  }
}
```

别被这么多字段吓到，**你真正关心的只有一个**：

| 字段 | 含义 | 重点 |
|------|------|------|
| `choices[0].message.content` | 模型的回答 | ⭐ **这才是你要的东西** |
| `id` | 本次调用的唯一编号 | 出问题时给客服用 |
| `object` | 响应类型 | 固定值，不用管 |
| `created` | 时间戳 | 调用时间 |
| `model` | 实际用的模型 | 有时会带日期后缀 |
| `choices[0].finish_reason` | 为什么结束 | `stop`=正常说完，下节讲别的值 |
| `usage` | token 用量 | **计费依据**，下下节细讲 |

所以最快的取答案方式（把上面命令加个管道）：

```bash
curl ... | python3 -c "import sys,json; print(json.load(sys.stdin)['choices'][0]['message']['content'])"
```

## 最常见的 3 个错误

第一次调，大概率会遇到下面某个错误。别慌，对照修复：

### 401 Unauthorized（未授权）

```json
{"error": {"message": "Incorrect API key provided", "type": "invalid_request_error", "code": "invalid_api_key"}}
```

**原因**：API Key 错了、过期了、或没设置环境变量。
**修复**：运行 `echo $OPENAI_API_KEY`，确认打印出正确的 key。没有就重新 `export`。

### 404 Not Found（找不到）

```json
{"error": {"message": "The requested URL was not found", "type": "invalid_request_error"}}
```

**原因**：URL 拼错了。
**修复**：确认端点是 `https://api.openai.com/v1/chat/completions`，别漏了 `/v1`。

### 429 Too Many Requests（请求太多 / 余额不足）

```json
{"error": {"message": "You exceeded your current quota", "type": "insufficient_quota"}}
```

**原因**：账户没充值、或调用太频繁触发了速率限制。
**修复**：去 platform.openai.com 检查 **Billing** 是否已绑定付款方式、是否有余额。

## 动手实验

光看不练学不会，试试这两个：

1. **换个问题**：把 `"content": "用一句话介绍你自己"` 改成 `"content": "写一首关于秋天的五言绝句"`，看模型怎么回答。
2. **换个模型**：把 `"model": "gpt-4o-mini"` 改成 `"model": "gpt-4o"`，对比返回内容、速度、`usage` 里的 token 数有什么不同。

::: tip
你会发现 `gpt-4o` 更慢、token 更多——因为更强的模型「想」得更细。这是正常的，后面讲 token 会解释。
:::

