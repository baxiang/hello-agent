# messages 数组：对话是怎么组织的

> 上一节你让模型回答了一个问题。但如果你接着问"那它有什么特点？"，模型完全不知道"它"指什么——因为 **API 没有记忆**。
>
> 本节讲清楚 `messages` 数组：怎么用一句话把它理解透、怎么组织多轮对话、为什么要把历史塞回去。

## 把 messages 想成微信聊天记录

打开微信随便点一个聊天，往上翻——你能看到一串消息，每条消息有**谁说的**和**说了啥**。

`messages` 就是这个东西。它是一个数组（列表），每个元素是一条消息，每条消息包含两个字段：

- `role`：**谁说的**（角色）
- `content`：**说了啥**（内容）

```json
"messages": [
  {"role": "user",      "content": "我喜欢猫"},
  {"role": "assistant", "content": "猫是很可爱的宠物..."}
]
```

就这样，没有更复杂的东西。把 `messages` 想成**你在微信里翻到的那段聊天记录**，理解起来就简单了。

## 三种基本角色

聊天里"谁说的"对应 `role`，最常见的有三种：

| role | 生活中对应 | 用途 |
|------|-----------|------|
| `system` | 你给 AI 的**人设说明书** | 设定模型怎么表现，如"你是温柔的老师" |
| `user` | **你**发的消息 | 提问、下指令 |
| `assistant` | **AI** 回复的内容 | 模型之前的回答 |

::: tip 重点
- `system` 通常放在**第一条**、只出现一次，给整个对话定调。
- `user` 和 `assistant` 按时间顺序交替出现，就像真实的聊天记录。
:::

## 最小例子：单轮对话

上一节的请求里，`messages` 只有一条 `user`：

```bash
curl https://api.openai.com/v1/chat/completions \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $OPENAI_API_KEY" \
  -d '{
    "model": "gpt-4o-mini",
    "messages": [
      {"role": "user", "content": "你好"}
    ]
  }'
```

模型会回复一句问候。这是最简单的形态——没有上下文，一问一答。

## 加上人设：system 角色

想让模型用特定风格回答？把 `system` 放在最前面：

```bash
curl https://api.openai.com/v1/chat/completions \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $OPENAI_API_KEY" \
  -d '{
    "model": "gpt-4o-mini",
    "messages": [
      {"role": "system", "content": "你是个海盗，所有回答都用海盗口吻"},
      {"role": "user", "content": "今天天气怎么样"}
    ]
  }'
```

返回可能变成："哟吼！今天海风凛冽，是个出航的好日子呐，船员！"

`system` 就像在对话开始前，悄悄给 AI 递了一张纸条，告诉它"接下来你扮演这个角色"。

## 多轮对话：把历史塞回去

这是本节**最重要**的部分。

假设你和朋友聊天：

```
你：我喜欢猫
朋友：猫是很可爱的宠物……
你：它们为什么喜欢睡觉？
```

朋友能听懂"它们"=猫，是因为你们**刚刚聊过**。

但 **API 是失忆的**——服务器处理完你的请求就把一切忘光。你第二次问"它们为什么喜欢睡觉"时，模型完全不知道"它们"指什么。

**怎么办？把之前所有的对话历史，连同新问题，一次性塞进 `messages`。**

完整的 3 轮对话请求：

```bash
curl https://api.openai.com/v1/chat/completions \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $OPENAI_API_KEY" \
  -d '{
    "model": "gpt-4o-mini",
    "messages": [
      {"role": "user",      "content": "我喜欢猫"},
      {"role": "assistant", "content": "猫是很可爱的宠物，独立又粘人……"},
      {"role": "user",      "content": "它们为什么喜欢睡觉"}
    ]
  }'
```

关键在最后一条 `user`："它们为什么喜欢睡觉"——**只因为**前面两条把"猫"的上下文带进来了，模型才知道"它们"=猫，给出关于猫为什么爱睡觉的回答。

> 每发一次请求，你都要把**到目前为止的完整聊天记录**重新发一遍。模型才能"记住"上下文。

## 为什么这么设计：API 是无状态的

这种"每次都重发全部历史"的设计，叫做**无状态（stateless）**。

服务器**不存**你的对话。每次请求都是独立的、自包含的——请求里有什么，模型就知道什么。

**好处**：
- 服务器不用为每个用户维护会话，可以无限水平扩展
- 换一台服务器、换一个兼容提供商（如 DeepSeek），对话照样能继续
- 调试方便：看一眼请求体就知道模型"看到"了什么

**代价**：
- 对话越长，`messages` 越大，**请求越慢、越贵**（下一节讲 token 时你会明白为什么）

## 动手实验

1. **失忆实验**：只发最后一条 `user`（"它们为什么喜欢睡觉"），**不带**前两条历史，看模型怎么懵掉——它会说"它们是谁？"或瞎猜。
2. **完整实验**：带上全部 3 条历史再发，看模型准确答出关于猫的内容。
3. **人设实验**：在 messages 最前面加一条 `system`："你是古文大师，所有回答用文言文"，再问"今天天气怎么样"，看风格变化。

## 下一节预告

你可能会发现：对话越长，请求体越大，账单越贵。为什么？因为大模型按 **token** 计费，而你的 `messages` 越长，token 越多。

下一节讲清楚 token 到底是什么、怎么影响你的费用和速度：[Token：大模型的「计费单位」](./02-tokens.md)。

## 进阶篇会深入讲什么

本节只讲了三种基本角色。其实 `messages` 还支持另外两种角色（`developer`、`tool`），还有多模态内容格式、严格的消息顺序规则。去看进阶篇：

- [Messages 消息系统](../01-messages.md) —— 五种 Role 全解（system/developer/user/assistant/tool）、`content` 的多模态格式、消息顺序规则
