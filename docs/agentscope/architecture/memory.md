# Memory 模块分析

## 源码位置

- `src/agentscope/state/` (5 文件)
- `src/agentscope/workspace/` (11 文件)

## AgentState 类

```python
class AgentState:
    session_id: str              # 会话 ID
    reply_id: str                # 当前回复 ID
    context: list[Msg]           # 上下文消息
    summary: str                 # 压缩摘要
    cur_iter: int                # 当前迭代次数
    permission_context           # 权限上下文
    tool_context                 # 工具上下文
```

## Context 管理

### 上下文结构

```
AgentState.context:
[
    SystemMsg("system", "You're a helpful assistant..."),
    UserMsg("user", "Hello!"),
    AssistantMsg("assistant", [TextBlock("Hi!")]),
    AssistantMsg("assistant", [
        ToolCallBlock(id="tc1", name="bash", input="{...}"),
    ]),
    AssistantMsg("assistant", [
        ToolResultBlock(id="tc1", output=[TextBlock("...")]),
        TextBlock("The result is..."),
    ]),
    ...
]
```

### 上下文添加

```python
async def _handle_incoming_messages(self, msgs: Msg | list[Msg]):
    if msgs:
        copied_msgs = deepcopy(msgs)
        if isinstance(copied_msgs, Msg):
            copied_msgs = [copied_msgs]
        
        for msg in copied_msgs:
            # 验证消息类型
            if msg.role == "system" or msg.has_content_blocks(["tool_call", "tool_result"]):
                raise ValueError("Invalid message")
            
            # 添加到上下文
            self.state.context.append(msg)
```

## Context Compression

### ContextConfig

```python
class ContextConfig:
    trigger_ratio: float = 0.8     # 触发阈值比例
    reserve_ratio: float = 0.1     # 保留比例
    compression_prompt: str        # 压缩提示词
    summary_schema: dict           # 摘要 Schema
    summary_template: str          # 摘要模板
```

### 压缩流程

```python
async def compress_context(self, config: ContextConfig | None = None):
    cfg = config or self.context_config
    
    # 1. 计算 token
    kwargs = await self._prepare_model_input()
    estimated_tokens = await self.model.count_tokens(**kwargs)
    
    # 2. 检查阈值
    threshold = cfg.trigger_ratio * self.model.context_size
    if estimated_tokens < threshold:
        return
    
    # 3. 分割上下文
    msgs_to_compress, msgs_to_reserve = await self._split_context_for_compression(
        cfg.reserve_ratio * self.model.context_size,
        tools,
    )
    
    # 4. 准备压缩消息
    messages = [
        SystemMsg(content=await self._get_system_prompt()),
        *(self.state.summary ? [UserMsg(content=self.state.summary)] : []),
        *msgs_to_compress,
        UserMsg(content=cfg.compression_prompt),
    ]
    
    # 5. 生成结构化摘要
    res = await self.model.generate_structured_output(
        messages=messages,
        structured_model=cfg.summary_schema,
    )
    
    # 6. 更新状态
    self.state.summary = cfg.summary_template.format(**res.content)
    self.state.context = msgs_to_reserve
    
    # 7. 卸载到外部存储（如果有 offloader）
    if self.offloader:
        path = await self.offloader.offload_context(
            self.state.session_id,
            msgs=msgs_to_compress,
        )
        self.state.summary += f"\nContext offloaded to '{path}'"
```

## Workspace & Offloader

### Offloader 基类

```python
class Offloader:
    async def offload_context(
        self,
        session_id: str,
        msgs: list[Msg],
    ) -> str:
        """卸载上下文到外部存储"""
```

### MinIO Offloader

```python
class MinIOOffloader(Offloader):
    endpoint: str
    access_key: str
    secret_key: str
    bucket: str
    
    async def offload_context(self, session_id: str, msgs: list[Msg]) -> str:
        # 上传到 MinIO
        path = f"{session_id}/context_{timestamp}.json"
        await self.client.put_object(
            bucket=self.bucket,
            object_name=path,
            data=json.dumps([m.to_dict() for m in msgs]),
        )
        return path
```

### Local Offloader

```python
class LocalOffloader(Offloader):
    path: str
    
    async def offload_context(self, session_id: str, msgs: list[Msg]) -> str:
        # 写入本地文件
        file_path = f"{self.path}/{session_id}/context.json"
        with open(file_path, "w") as f:
            json.dump([m.to_dict() for m in msgs], f)
        return file_path
```

## State 持久化

### to_dict()

```python
state_dict = {
    "session_id": state.session_id,
    "context": [m.to_dict() for m in state.context],
    "summary": state.summary,
    "cur_iter": state.cur_iter,
}
```

### from_dict()

```python
state = AgentState(
    session_id=state_dict["session_id"],
)
state.context = [Msg.from_dict(m) for m in state_dict["context"]]
state.summary = state_dict["summary"]
state.cur_iter = state_dict["cur_iter"]
```

## 设计模式

| 模式 | 应用 |
|---|---|
| **状态模式** | AgentState 状态管理 |
| **策略模式** | 不同 Offloader 实现 |
| **模板方法** | compress_context 固定流程 |