# Tool 模块分析

## 源码位置

`src/agentscope/tool/` (13 文件)

## 类图

```
┌─────────────────────────────────────────────────────────────┐
│                        Toolkit                               │
├─────────────────────────────────────────────────────────────┤
│  tool_groups: list[ToolGroup]                                │
│  meta_tool_response_template: str                            │
│  skill_instruction_template: str                             │
│  builtin_meta_tool: RegisteredTool                           │
│  builtin_skill_viewer: RegisteredTool                        │
├─────────────────────────────────────────────────────────────┤
│  get_tool_schemas(groups) → list[dict]                       │
│  call_tool(tool_call, state) → AsyncGenerator                │
│  get_skill_instructions() → str                              │
│  check_tool_available(name, groups) → ToolBase               │
│  get_tool(name) → ToolBase | None                            │
│  _get_available_tools(groups) → dict[RegisteredTool]         │
│  _get_available_skills(groups) → dict[Skill]                 │
│  clear() → None                                              │
└─────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────┐
│                       ToolBase                               │
├─────────────────────────────────────────────────────────────┤
│  name: str                                                   │
│  description: str                                            │
│  input_schema: dict                                          │
│  is_concurrency_safe: bool                                   │
│  is_read_only: bool                                          │
│  is_state_injected: bool                                     │
│  is_external_tool: bool                                      │
│  is_mcp: bool                                                │
├─────────────────────────────────────────────────────────────┤
│  __call__(**kwargs) → ToolChunk | AsyncGenerator             │
│  get_tool_schema() → dict                                    │
└─────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────┐
│                       ToolGroup                              │
├─────────────────────────────────────────────────────────────┤
│  name: str                                                   │
│  description: str                                            │
│  instructions: str                                           │
│  tools: list[ToolBase]                                       │
│  skills_or_loaders: Sequence                                 │
│  mcps: list[MCPClient]                                       │
├─────────────────────────────────────────────────────────────┤
│  list_skills() → list[Skill]                                 │
└─────────────────────────────────────────────────────────────┘
```

## 内置工具

### Bash

```python
class Bash(ToolBase):
    name = "bash"
    description = "Execute bash commands"
    input_schema = {
        "type": "object",
        "properties": {
            "command": {"type": "string"},
            "timeout": {"type": "integer", "default": 30000},
        },
        "required": ["command"],
    }
    is_concurrency_safe = False
```

### Read

```python
class Read(ToolBase):
    name = "read"
    description = "Read file contents"
    input_schema = {
        "type": "object",
        "properties": {
            "file_path": {"type": "string"},
            "offset": {"type": "integer"},
            "limit": {"type": "integer"},
        },
        "required": ["file_path"],
    }
    is_read_only = True
    is_concurrency_safe = True
```

### Write

```python
class Write(ToolBase):
    name = "write"
    description = "Write content to file"
    input_schema = {
        "type": "object",
        "properties": {
            "file_path": {"type": "string"},
            "content": {"type": "string"},
        },
        "required": ["file_path", "content"],
    }
    is_concurrency_safe = False
```

## call_tool() 实现

```python
async def call_tool(
    self,
    tool_call: ToolCallBlock,
    state: AgentState,
) -> AsyncGenerator[ToolChunk | ToolResponse, None]:
    tool_response = ToolResponse(id=tool_call.id)
    
    # 检查工具可用性
    available_tools = await self._get_available_tools(state.tool_context.activated_groups)
    
    if tool_call.name not in available_tools:
        yield ToolChunk(content=[TextBlock(text="ToolNotFoundError...")], state=ERROR)
        yield tool_response.append_chunk(chunk)
        return
    
    # 获取工具函数
    tool_func = available_tools[tool_call.name].tool
    
    # 解析输入
    kwargs = _json_loads_with_repair(tool_call.input)
    
    # State 注入
    if tool_func.is_state_injected:
        kwargs["_agent_state"] = state
    
    # 执行工具
    if inspect.iscoroutinefunction(tool_func.__call__):
        res = await tool_func(**kwargs)
    else:
        res = tool_func(**kwargs)
    
    # 处理结果
    if isinstance(res, ToolChunk):
        yield res
        tool_response.append_chunk(res)
    elif isinstance(res, AsyncGenerator):
        async for chunk in res:
            yield chunk
            tool_response.append_chunk(chunk)
    
    # 返回完整响应
    yield tool_response
```

## ToolGroup 激活机制

### ResetTools

```python
class ResetTools(ToolBase):
    name = "reset_tools"
    
    def __call__(self, **groups: bool) -> ToolChunk:
        # groups 参数为动态生成
        # {"analysis": True, "editing": False} → 激活 analysis，停态 editing
        
        activated_groups = [name for name, active in groups.items() if active]
        
        # 返回激活状态
        return ToolChunk(content=[TextBlock(
            text=self._render_response(activated_groups)
        )])
```

### 动态 Schema 生成

```python
def _get_meta_tool_schema(self) -> Type[BaseModel]:
    fields = {}
    for group in self.tool_groups:
        if group.name == "basic":
            continue
        fields[group.name] = (
            bool,
            Field(default=False, description=group.description),
        )
    return create_model("_DynamicModel", **fields)
```

## MCP 工具集成

### MCP Client 工具发现

```python
for client in group.mcps:
    tools = await client.list_tools()
    cache_tools.extend(tools)
```

### MCP 工具调用

```python
try:
    # MCP 工具通过 mcp.call_tool 调用
    if tool_func.is_mcp:
        res = await tool_func(**kwargs)
except mcp.shared.exceptions.McpError as e:
    yield ToolChunk(content=[TextBlock(text=f"MCP Error: {e}")], state=ERROR)
```

## Skill 系统

### Skill 定义

```python
class Skill:
    name: str
    description: str
    dir: str
    instructions: str
    resources: list[str]
```

### Skill Viewer

```python
class SkillViewer(ToolBase):
    name = "skill_viewer"
    
    def __call__(self, skill_name: str) -> ToolChunk:
        skill = self._get_skill(skill_name)
        return ToolChunk(content=[TextBlock(text=skill.instructions)])
```

## 设计模式

| 模式 | 应用 |
|---|---|
| **工厂模式** | 动态 Schema 生成 |
| **策略模式** | ToolBase 不同实现 |
| **组合模式** | ToolGroup 组合 Tools + MCPs + Skills |
| **模板方法** | call_tool 固定流程 |