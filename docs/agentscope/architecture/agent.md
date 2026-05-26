# Agent 模块分析

## 源码位置

`src/agentscope/agent/` (6 文件)

## 类图

```
┌─────────────────────────────────────────────────────────────┐
│                        Agent                                 │
├─────────────────────────────────────────────────────────────┤
│  name: str                                                   │
│  _system_prompt: str                                         │
│  model: ChatModelBase                                        │
│  toolkit: Toolkit                                            │
│  state: AgentState                                           │
│  model_config: ModelConfig                                   │
│  context_config: ContextConfig                               │
│  react_config: ReActConfig                                   │
│  offloader: Offloader                                        │
│  _engine: PermissionEngine                                   │
│  _middlewares: list[MiddlewareBase]                          │
├─────────────────────────────────────────────────────────────┤
│  reply(inputs) → Msg                                         │
│  reply_stream(inputs) → AsyncGenerator[AgentEvent]          │
│  observe(msgs) → None                                        │
│  compress_context(config) → None                             │
│  _reply(inputs) → AsyncGenerator                             │
│  _reasoning() → AsyncGenerator                               │
│  _acting(tool_call) → AsyncGenerator                         │
└─────────────────────────────────────────────────────────────┘
```

## 关键方法签名

### reply()

```python
async def reply(
    self,
    inputs: Msg | list[Msg] | UserConfirmResultEvent | None = None,
) -> Msg:
    """同步返回最终消息"""
```

### reply_stream()

```python
async def reply_stream(
    self,
    inputs: Msg | list[Msg] | UserConfirmResultEvent | None = None,
) -> AsyncGenerator[AgentEvent, None]:
    """流式返回事件"""
```

### _reply_impl()

```python
async def _reply_impl(
    self,
    inputs: Msg | list[Msg] | ...,
) -> AsyncGenerator[AgentEvent | Msg, None]:
    """核心回复逻辑"""
    # Step 1: 检查输入事件
    # Step 2: 处理输入消息
    # Step 3: ReAct 循环
    # Step 4: 处理最大迭代
```

## ReAct 循环实现

### 循环结构

```python
while self.state.cur_iter < self.react_config.max_iters:
    # Step 3.1: 检查下一动作
    action, data = self._check_next_action()
    if action == "exit":
        yield data
        return
    
    # Step 3.2: 执行推理
    if action == "reasoning":
        await self.compress_context()
        async for evt in self._reasoning():
            yield evt
    
    # Step 3.3: 执行工具调用
    for batch in await self._batch_tool_calls():
        async for evt in self._execute_tool_calls(batch):
            yield evt
    
    # 更新迭代计数
    self.state.cur_iter += 1
```

### 工具调用批次

```python
class _ToolCallBatch:
    type: Literal["sequential", "concurrent"]
    tool_calls: list[ToolCallBlock]
```

**批次策略**：
- `is_concurrency_safe=True` → concurrent 执行
- `is_concurrency_safe=False` → sequential 执行

## 中间件系统

### 中间件类型

```python
self._reply_middlewares = [
    mw for mw in middlewares if mw.is_implemented("on_reply")
]
self._reasoning_middlewares = [
    mw for mw in middlewares if mw.is_implemented("on_reasoning")
]
self._acting_middlewares = [
    mw for mw in middlewares if mw.is_implemented("on_acting")
]
self._model_call_middlewares = [
    mw for mw in middlewares if mw.is_implemented("on_model_call")
]
self._system_prompt_middlewares = [
    mw for mw in middlewares if mw.is_implemented("on_system_prompt")
]
```

### 中间件执行链

```python
async def execute_chain(index: int = 0, **kwargs):
    if index >= len(middlewares):
        async for item in self._reasoning_impl(**kwargs):
            yield item
    else:
        mw = middlewares[index]
        async for item in mw.on_reasoning(
            agent=self,
            input_kwargs=kwargs,
            next_handler=lambda **kw: execute_chain(index + 1, **kw),
        ):
            yield item
```

## 权限检查

### PermissionEngine

```python
self._engine = PermissionEngine(self.state.permission_context)

decision = await self._engine.check_permission(tool, parsed_input)

# 处理权限决策
if decision.behavior == PermissionBehavior.ASK:
    yield RequireUserConfirmEvent(...)
elif decision.behavior == PermissionBehavior.DENY:
    yield ToolResultBlock(state=ToolResultState.DENIED)
elif decision.behavior == PermissionBehavior.ALLOW:
    # 执行工具
```

## 上下文压缩

### compress_context()

```python
async def compress_context(self, config: ContextConfig | None = None):
    cfg = config or self.context_config
    
    # 计算当前 token
    estimated_tokens = await self.model.count_tokens(**kwargs)
    
    # 检查阈值
    threshold = cfg.trigger_ratio * self.model.context_size
    if estimated_tokens < threshold:
        return
    
    # 分割上下文
    msgs_to_compress, msgs_to_reserve = await self._split_context_for_compression(...)
    
    # 生成摘要
    res = await self.model.generate_structured_output(
        messages=[system, summary_prev, msgs_to_compress, compression_prompt],
        structured_model=cfg.summary_schema,
    )
    
    # 更新状态
    self.state.summary = cfg.summary_template.format(**res.content)
    self.state.context = msgs_to_reserve
```

## 设计模式

| 模式 | 应用 |
|---|---|
| **模板方法** | `_reply_impl` 固定流程 |
| **中间件** | 钩子点扩展 |
| **状态机** | `ToolCallState` 状态流转 |
| **观察者** | Event 流事件发射 |