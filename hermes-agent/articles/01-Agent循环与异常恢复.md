# Hermes Agent 对话循环与异常恢复：一个生产级 Agent 的韧性工程

> **项目**: [NousResearch/hermes-agent](https://github.com/NousResearch/hermes-agent) v0.15.1
> **核心文件**: `agent/conversation_loop.py` · `run_agent.py` · `agent/iteration_budget.py`
> **关键词**: Agent Loop · Exception Recovery · Iteration Budget · Grace Call

---

## 引言：为什么 Agent 循环是真正的难题

当你写一个 `while True: call_llm()` 的 demo 时，一切都很美好。但当 Agent 跑在生产环境中——面对网络抖动、模型幻觉、截断响应、JSON 解析失败——你会发现，**80% 的工程量不在"调用 LLM"，而在"当 LLM 不配合时怎么办"**。

Hermes Agent 的 `conversation_loop.py` 正是这份工程量的结晶。它不是简单的循环包装，而是一个**多层异常恢复系统**——每一层都对应一种真实的生产故障模式。本文将逐层拆解这个设计。

---

## 一、核心循环：同步 While 驱动的一切

### 1.1 循环骨架

Hermes 的对话循环是一个**纯同步 while 循环**——没有 async/await，没有事件循环，没有协程。这不是技术债，而是刻意的设计选择：

```python
while (api_call_count < self.max_iterations
       and self.iteration_budget.remaining > 0) \
      or self._budget_grace_call:

    if self._interrupt_requested:
        break

    response = client.chat.completions.create(
        model=model, messages=messages, tools=tool_schemas
    )

    if response.tool_calls:
        for tool_call in response.tool_calls:
            result = handle_function_call(tool_call.name, tool_call.args, task_id)
            messages.append(tool_result_message(result))
        api_call_count += 1

        if compression_enabled and should_compress(real_tokens):
            messages = compress_context(messages, system_message)

        continue
    else:
        return response.content
```

### 1.2 循环条件拆解

```
+-----------------------------------------------------+
|            Loop Guard Condition                      |
|                                                     |
|  (api_call_count < max_iterations                   |
|   AND iteration_budget.remaining > 0)               |
|                        OR                           |
|         _budget_grace_call                          |
|                                                     |
|  +-------------+    +--------------+    +--------+ |
|  | API 调用上限 | AND| 迭代预算余额 | OR |宽限调用| |
|  +-------------+    +--------------+    +--------+ |
+-----------------------------------------------------+
```

三个维度控制循环退出：

| 条件 | 作用 | 典型值 |
|------|------|--------|
| `api_call_count < max_iterations` | 硬上限，防止无限循环 | 默认由模型配置决定 |
| `iteration_budget.remaining > 0` | 软上限，支持退费机制 | 默认 90 |
| `_budget_grace_call` | 预算耗尽后的"遗言"机会 | 布尔标志，仅一次 |

**为什么是双重上限？** `max_iterations` 是粗暴的硬墙——到了就停。`iteration_budget` 则是精细的资源管理器——可以退费、可以透支一次。两者配合，既防止失控又给 Agent 留下优雅退出的余地。

### 1.3 每轮循环的完整流程

```
+----------+    +----------+    +----------+    +----------+
| 中断检查  |--->| 调用 LLM |--->| 异常检测  |--->| 分支路由  |
+----------+    +----------+    +----------+    +----------+
                                                     |
                                    +----------------+----------------+
                                    |                                 |
                              tool_calls?                         content only
                                    |                                 |
                                    v                                 v
                            +--------------+                  +--------------+
                            | 执行工具调用  |                  | 返回最终响应  |
                            +------+-------+                  +--------------+
                                   |
                                   v
                            +--------------+
                            | 上下文压缩检查|
                            +------+-------+
                                   |
                                   v
                            +--------------+
                            |  continue     |
                            +--------------+
```

**中断检查**放在循环顶部而非底部，确保 `_interrupt_requested` 标志能在最多一轮延迟内生效。这是对长时间工具执行的防护——用户按下 Ctrl+C 时，Agent 不会卡在下一轮 LLM 调用里。

---

## 二、8 种异常恢复机制：从"空响应"到"全链路降级"

这是 Hermes 循环最精妙的部分。8 种异常不是理论上的分类，而是**从生产日志中提炼的真实故障模式**。每种异常都有独立的检测逻辑、恢复策略和重试上限。

### 2.1 完整异常恢复矩阵

| # | 异常场景 | 检测方式 | 恢复策略 | 最大重试 |
|---|---------|---------|---------|---------|
| 1 | **空响应** (无内容无推理) | `_has_content_after_think_block()` 返回 False | 重试同一 API 调用 | 3 次 |
| 2 | **仅推理无内容** (思考模型) | `reasoning` 字段有值但 `content` 为空 | 追加 assistant 消息触发 prefill 继续 | 2 次 |
| 3 | **无效 JSON 参数** | `json.loads()` 抛出异常 | 重试；3 次后注入恢复工具结果 | 3 次 |
| 4 | **截断响应** | `finish_reason="length"` + 参数不以 `}` 或 `]` 结尾 | 尽力返回 partial 结果 | 1 次 |
| 5 | **工具调用后空响应** | 工具结果返回后模型输出空 | 注入 nudge 用户消息 | 1 次 |
| 6 | **housekeeping 工具后空响应** | 上一轮有内容 + 本轮是 memory/todo 工具 | 复用上一轮内容作为响应 | 0 次 |
| 7 | **部分流恢复** | 流中断但已有部分内容到达 | 使用已流式传输的内容 | 0 次 |
| 8 | **所有重试耗尽** | 重试计数器达到上限 | 尝试 fallback provider 链 | 链长度 |

### 2.2 异常 1：空响应——模型"失语"

```python
def _has_content_after_think_block(response) -> bool:
    content = response.choices[0].message.content
    if not content:
        return False
    stripped = content.strip()
    if not stripped:
        return False
    return True
```

模型偶尔会返回完全空的响应——没有 `content`，没有 `reasoning`，什么都没有。这通常发生在上下文过长或模型过载时。Hermes 的策略简单直接：**重试**。连续 3 次空响应后放弃，转而尝试 fallback provider。

### 2.3 异常 2：仅推理无内容——"想了很多，什么也没说"

这是**思考模型（reasoning models）的特有故障**。模型在 `reasoning` 字段中进行了完整的思维链推理，但 `content` 字段为空——它"想完了就停了"。

Hermes 的恢复策略极其精妙：**prefill continuation**。

```python
if reasoning and not content:
    messages.append({"role": "assistant", "content": ""})
    response = client.chat.completions.create(
        model=model, messages=messages, tools=tool_schemas
    )
```

追加一条空的 assistant 消息，让模型以为它"已经开始说了"，从而继续生成 content。这利用了 LLM 的 **continuation instinct**——给它一个开头，它就会继续写下去。

### 2.4 异常 3：无效 JSON 参数——"手抖的工具调用"

模型声明了工具调用，但参数不是合法 JSON：

```
# 模型输出:
tool_call(name="read_file", arguments='{"path": "/etc/passwd"')  # 缺少闭合 }
```

恢复策略分两阶段：

```
重试 1-2 次: 重新调用 LLM，期望模型自行修正
    | 仍然失败
第 3 次: 注入恢复工具结果
    messages.append({
        "role": "tool",
        "tool_call_id": call.id,
        "content": "Error: Invalid JSON arguments. Please retry with valid JSON."
    })
```

**为什么不直接修复 JSON？** 因为补全 JSON 可能改变语义。缺少一个 `}` 可能意味着模型遗漏了整个字段，简单补全会产生错误的参数。让模型自己重试是最安全的。

### 2.5 异常 4：截断响应——"话没说完"

`finish_reason="length"` 意味着模型因为 token 上限而被迫中断输出。Hermes 检查参数是否以 `}` 或 `]` 结尾：

```python
if finish_reason == "length":
    args_str = tool_call.function.arguments
    if not args_str.rstrip().endswith(("}", "]")):
        return partial_result
```

如果参数的 JSON 结构不完整，Hermes 会**尽力解析并使用 partial 结果**。这是一种务实的折中——比起丢弃整个响应，使用部分结果通常更好。

### 2.6 异常 5 vs 异常 6：两种"空响应"的微妙区分

这是设计中最精细的区分：

**异常 5：工具调用后空响应**——Agent 执行了工具，拿到了结果，但模型返回空。这通常意味着模型"不知道接下来该做什么"。恢复策略：注入 **nudge 消息**。

```python
messages.append({
    "role": "user",
    "content": "Please continue with your analysis or provide a summary."
})
```

**异常 6：housekeeping 工具后空响应**——Agent 调用了 `memory` 或 `todo` 这类内务工具（没有用户可见的输出），然后返回空。这不是故障，而是模型认为"任务已完成"。恢复策略：**复用上一轮的内容**。

```python
if _last_assistant_content and _is_housekeeping_tool(last_tool_name):
    return _last_assistant_content
```

两者的关键区别在于**语义**：异常 5 是"模型卡住了"，需要推动；异常 6 是"模型认为没事可做了"，应该用已有内容收尾。混淆这两种情况会导致不必要的重试或丢失有效响应。

### 2.7 异常 7：部分流恢复——"说了半截话"

流式传输中网络中断，但用户已经看到了部分内容。Hermes 的策略：**使用已流式传输的内容**，而不是重试。

```python
if stream_interrupted and accumulated_content:
    return accumulated_content
```

这是**面向用户体验的设计**——用户已经看到了前半段回复，重试会产生重复内容，比不完整更糟糕。

### 2.8 异常 8：全链路降级——"最后的退路"

当所有重试都耗尽，Hermes 不直接报错，而是**沿着 fallback provider 链尝试**：

```
Primary Provider (OpenAI)
    | 失败
Fallback 1 (Anthropic)
    | 失败
Fallback 2 (本地模型)
    | 失败
返回错误信息
```

这依赖 `run_agent.py` 中的 provider 链配置。每条链可以有不同模型、不同 API endpoint、不同定价——形成一个**多层次的韧性网**。

### 2.9 恢复优先级链

8 种异常不是孤立处理的，它们构成一条**优先级链**——检测从最具体到最通用：

```
housekeeping 空响应 -> 部分流恢复 -> 仅推理无内容 -> 无效 JSON -> 截断响应 -> 工具后空响应 -> 空响应 -> 全链路降级
  (最具体)                                                                          (最通用)
```

越具体的异常越先检测，避免通用恢复策略误伤特殊情况。

---

## 三、迭代预算系统：不只是计数器

### 3.1 IterationBudget 类

```python
@dataclass
class IterationBudget:
    max_total: int = 90
    used: int = 0

    @property
    def remaining(self) -> int:
        return max(0, self.max_total - self.used)

    def consume(self):
        if self.remaining > 0:
            self.used += 1

    def refund(self):
        if self.used > 0:
            self.used -= 1
```

### 3.2 退费机制：execute_code 的特殊待遇

`execute_code` 是程序化工具调用——Agent 通过它执行 Python 代码来生成工具参数。这类调用的特点是：

1. **零上下文成本**：不增加对话上下文（结果是内部处理的）
2. **确定性高**：代码执行结果可预测，很少需要重试
3. **频率高**：Agent 可能频繁调用

因此，当一轮循环中**唯一的工具调用是 `execute_code`** 时，Hermes 自动退费：

```python
if all(tc.name == "execute_code" for tc in response.tool_calls):
    iteration_budget.refund()
```

这不是"白嫖"迭代次数，而是**精确计量**——execute_code 不消耗上下文窗口资源，不应该计入预算。

### 3.3 Grace Call：预算耗尽后的"遗言"

```python
_budget_grace_call = False

# 当预算耗尽时
if iteration_budget.remaining <= 0 and not _budget_grace_call:
    _budget_grace_call = True
    # 循环条件允许最后一次调用
```

Grace Call 让模型在预算耗尽后有一次机会生成**摘要或收尾**。没有它，Agent 可能在工具调用中间突然停止——上一条消息是 tool role，用户看到的是未完成的操作。

Grace Call 的设计哲学：**宁可多花一次 API 调用的钱，也不要给用户一个半成品的体验**。

### 3.4 预算系统的状态转换

```
                    consume()
  [remaining=N] -----------> [remaining=N-1]
       ^                          |
       |                          | refund()
       |     (仅 execute_code)    |
       +--------------------------+

                    remaining=0
  [remaining=1] -----------> [remaining=0]
                                  |
                                  | _budget_grace_call=True
                                  v
                            [Grace Call]
                                  |
                                  | 最后一次 LLM 调用
                                  v
                              [循环退出]
```

注意 `remaining` 属性用 `max(0, ...)` 保护，永远不会为负数。这比抛异常更健壮——预算耗尽不是错误，是正常状态。

---

## 四、Turn Exit 诊断：让每一次退出都可追溯

### 4.1 退出原因字段

每次循环退出时，Hermes 记录详细的 `turn_exit_reason`：

```python
_turn_exit_reason = "text_response(finish_reason=stop)"
_turn_exit_reason = "tool_calls(1)"
_turn_exit_reason = "max_iterations_reached"
_turn_exit_reason = "budget_exhausted(grace_call=True)"
_turn_exit_reason = "interrupt_requested"
_turn_exit_reason = "empty_response(retries_exhausted=3)"
```

这不是简单的枚举值，而是**结构化的诊断信息**——包含了关键上下文，让运维人员一眼就能判断退出是否正常。

### 4.2 Token 使用追踪

```python
result = {
    "final_response": final_response,
    "turn_exit_reason": _turn_exit_reason,
    "api_calls": api_call_count,
    "input_tokens": agent.session_input_tokens,
    "output_tokens": agent.session_output_tokens,
    "cache_read_tokens": agent.session_cache_read_tokens,
    "cache_write_tokens": agent.session_cache_write_tokens,
    "reasoning_tokens": agent.session_reasoning_tokens,
    "estimated_cost_usd": agent.session_estimated_cost_usd,
    "model": agent.model,
    "provider": agent.provider,
}
```

5 个维度的 token 计量覆盖了现代 LLM API 的全部计费维度。`cache_read_tokens` 和 `cache_write_tokens` 对 Anthropic 的 Prompt Cache 策略至关重要——命中率直接决定成本。

### 4.3 卡住检测：WARNING 级别的哨兵

```python
if messages and messages[-1]["role"] == "tool":
    logger.warning(
        "Turn ended with tool role message - agent may be stuck. "
        "exit_reason=%s, api_calls=%d",
        _turn_exit_reason, api_call_count
    )
```

对话的最后一条消息是 `tool` role，意味着 Agent 在工具调用后没有生成最终响应。这是 Agent **卡住的典型信号**——要么是循环被 max_iterations 强制终止，要么是异常恢复失败后放弃。

这条 WARNING 日志是运维的金矿——它可以触发告警、自动降级、或人工介入。

### 4.4 成本估算示例

一个典型的复杂任务（10 轮工具调用 + 1 次上下文压缩）的诊断输出：

```
turn_exit_reason: text_response(finish_reason=stop)
api_calls: 11
input_tokens: 84732
output_tokens: 3847
cache_read_tokens: 62100      <-- 73% 命中率
cache_write_tokens: 18900
reasoning_tokens: 12400
estimated_cost_usd: $0.0873
model: claude-sonnet-4-20250514
provider: anthropic
```

73% 的缓存命中率意味着近 3/4 的输入 token 以缓存价格计费，成本降低约 90%。

---

## 五、设计哲学：为什么这样设计

### 5.1 为什么是同步循环？

Hermes 的核心循环是纯同步的 `while` 循环，没有用 `asyncio`。这不是疏忽，而是深思熟虑：

1. **可调试性**：同步代码的调用栈是线性的，异常 traceback 一目了然。异步代码的异常传播是出了名的难追踪
2. **工具执行模型**：大部分工具（文件操作、终端命令）都是同步的。强行异步化反而增加复杂度
3. **状态管理简单**：没有协程切换，没有竞态条件，循环状态就是几个局部变量
4. **错误恢复天然串行**：8 种异常恢复策略必须按优先级串行检测，异步化没有收益

真正的并发放在了更高层——子代理委派使用 `ThreadPoolExecutor`，TUI 用双进程模型。核心循环保持同步，复杂度被隔离。

### 5.2 为什么 Nudge 和 Prefill 是不同的？

异常 5 用 **nudge**（注入用户消息），异常 2 用 **prefill**（注入空 assistant 消息）。两者都是"推动模型继续"，但机制完全不同：

| 维度 | Prefill | Nudge |
|------|---------|-------|
| 注入角色 | assistant | user |
| 利用心智 | 续写本能 | 对话惯性 |
| 适用场景 | "想完了但忘了说" | "不知道接下来做什么" |
| 代价风险 | 可能输出空字符串 | 可能从头推理（浪费 token） |

混用两者会导致灾难：对思考模型用 nudge 会让它从头推理（浪费 token），对卡住的模型用 prefill 会让它输出空字符串（无效循环）。

### 5.3 为什么需要 Grace Call？

没有 Grace Call 的 Agent 像一个被突然拔掉电源的工人——手上还拿着工具，桌上的文件还没整理。Grace Call 是**有序关机**的保证：

```
没有 Grace Call:
  user -> assistant(tool_call) -> tool(result) -> [强制退出，最后一条是 tool]

有 Grace Call:
  user -> assistant(tool_call) -> tool(result) -> assistant("我已完成了...") -> [正常退出]
```

Grace Call 的额外 API 调用成本通常不到 $0.01，但它避免了用户面对"半成品"响应的困惑。在 Agent 系统中，**用户体验的成本权重远高于 API 调用的货币成本**。

### 5.4 为什么是 8 种而不是 1 种通用恢复？

一个显而易见的简化是：所有异常都用同一种策略（比如"重试"）。Hermes 没有这样做，因为：

1. **语义不同**：housekeeping 空响应和普通空响应的语义完全不同，通用策略会误伤
2. **成本不同**：prefill 比 nudge 便宜（不需要重新推理），partial 结果比重试便宜
3. **副作用不同**：流式恢复不能用重试（用户已看到部分内容），JSON 修复不能自动化（语义风险）

8 种恢复策略的代价是代码复杂度，收益是**每种异常都获得最优解**。在一个 172k star 的生产系统中，这是正确的取舍。

---

## 总结：韧性工程的层次

Hermes 的对话循环不是"一个循环加一些异常处理"，而是一个**分层韧性系统**：

```
Layer 0: 循环防护 (max_iterations + iteration_budget + interrupt)
    |
Layer 1: 异常检测 (8 种故障模式识别)
    |
Layer 2: 精准恢复 (每种异常独立策略)
    |
Layer 3: 降级兜底 (fallback provider chain)
    |
Layer 4: 诊断审计 (turn_exit_reason + token tracking + stuck detection)
```

每一层都是独立的防线：Layer 0 防止失控，Layer 1 识别问题，Layer 2 解决问题，Layer 3 保证可用性，Layer 4 保障可观测性。没有任何一层是多余的——移除任何一层都会在特定场景下导致用户体验劣化。

这就是生产级 Agent 和 demo 级 Agent 的区别：**不是能不能跑起来，而是跑不动的时候怎么办**。
